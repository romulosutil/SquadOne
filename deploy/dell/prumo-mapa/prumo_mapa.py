#!/usr/bin/env python3
"""O Mapa do PRUMO a partir do diagnóstico (pendência P3 de ~/prumo).

O fluxo "PRUMO — Diagnóstico do dono" do n8n grava, para cada resposta
completa do formulário "Roteiro do Mapa", um pacote JSON em
~/.local/share/n8n-estado/mapa-fila/. O prumo-mapa.path dispara este script
(--fila), que para cada pacote:

  1. consolida as respostas pelo método (regra do MIN, divergência dono x
     time, rollup dos 16 IDs nos 6 blocos, Índice do Prumo X/18);
  2. grava ~/prumo-entregas/<AAAA-MM-DD>-<empresa>/dados.json (o pacote mais
     os campos que só a entrevista e a coleta dão, vazios);
  3. gera o documento (7 páginas A4, como o exemplo Vale Norte) em HTML e PDF;
  4. avisa o Rômulo pela fila de avisos (WhatsApp pelo Hermes).

O que o formulário não dá (mapa de dependência, inventário, travas em reais,
recomendação) sai como [PREENCHER]. Para completar: editar dados.json e rodar
`prumo-mapa <pasta>/dados.json`, que refaz HTML e PDF sem avisar ninguém.
Nada é enviado ao cliente: o Rômulo revisa e envia.

Método: ~/prumo/05-entrega-mapa (framework-mapa.md, roteiro-mapa-execucao.md,
simulacao-mapa-vale-norte.md). Exemplo completo em exemplos/.

Uso:
    prumo-mapa --fila                 processa a fila (o que o systemd roda)
    prumo-mapa <dados.json|pacote>    gera ao lado do arquivo (pasta de entrega)
    prumo-mapa <pacote> --saida DIR   gera em DIR
    prumo-mapa <arquivo> --sem-pdf    só o HTML
"""
import copy
import json
import re
import sys
import time
import unicodedata
from datetime import date, datetime
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

import modelo_mapa  # noqa: E402
from modelo_mapa import num  # noqa: E402
import prumo_pdf  # noqa: E402

HOME = Path.home()
FILA = HOME / ".local/share/n8n-estado/mapa-fila"
# Fora da fila: o gatilho é "diretório não vazio", e um erro/ ali dentro o
# dispararia em loop (mesma razão do auto-entrada).
ERRO = HOME / ".local/share/prumo-mapa-erro"
ENTREGAS = HOME / "prumo-entregas"
FILA_AVISOS = HOME / ".local/share/avisos/fila"

# ------------------------------------------------------------------ o método

# ID -> (área, camada, tema curto para o cliente). Temas a partir dos títulos
# do roteiro-mapa-execucao.md.
IDS = {
    "AR1": ("A", "Regra", "Desconto"),
    "AR2": ("A", "Regra", "Crédito para cliente novo"),
    "AD1": ("A", "Dado", "Preço de tabela"),
    "AM1": ("A", "Memória", "Exceções de preço"),
    "BR1": ("B", "Regra", "Escolha de fornecedor"),
    "BR2": ("B", "Regra", "Teto de compra"),
    "BD1": ("B", "Dado", "Cadastro de fornecedor"),
    "BM1": ("B", "Memória", "Troca de fornecedor"),
    "CR1": ("C", "Regra", "Entrega para quem deve"),
    "CR2": ("C", "Regra", "Régua de cobrança"),
    "CD1": ("C", "Dado", "Quem está inadimplente"),
    "CM1": ("C", "Memória", "Corte de cliente"),
    "DR1": ("D", "Regra", "Substituto de função-chave"),
    "DR2": ("D", "Regra", "Limites de decisão"),
    "DD1": ("D", "Dado", "Quem faz o quê"),
    "DM1": ("D", "Memória", "Decisões repetidas"),
}

# Rollup para a apresentação (roteiro, "Regra de consolidação").
BLOCOS = [
    ("vendemos", "Como vendemos", ["AR1", "AR2"]),
    ("compramos", "Como compramos", ["BR1", "BR2"]),
    ("entregamos", "Entrega e cobrança", ["CR1", "CR2"]),
    ("quem", "Quem faz o quê", ["DR1", "DR2"]),
    ("cadastros", "Cadastros oficiais", ["AD1", "BD1", "CD1", "DD1"]),
    ("decisoes", "Decisões", ["AM1", "BM1", "CM1", "DM1"]),
]

# Aprofundamentos do roteiro que viram linha do mapa de dependência ou trava.
DECISOES = {  # decisão que chega ao dono (mapa de dependência)
    "AR1": "Desconto ou prazo fora do padrão",
    "AR2": "Crédito para cliente novo",
    "CR1": "Liberar entrega para cliente com título vencido",
}
TRAVAS_CANDIDATAS = {  # ID -> fórmula do kit (framework-mapa.md) e campos que ela pede
    "AD1": ("margem", {"base_mes": None, "fracao_pct": None, "taxa_pct": None}),
    "BR1": ("margem", {"base_mes": None, "fracao_pct": None, "taxa_pct": None}),
    "AR1": ("tempo_dono", {"por_semana": None, "minutos": None}),
    "AR2": ("tempo_dono", {"por_semana": None, "minutos": None}),
    "CR1": ("tempo_dono", {"por_semana": None, "minutos": None}),
    "DM1": ("retrabalho", {"por_trimestre": None, "minutos": None, "pessoas": None}),
}
RISCOS_CANDIDATOS = ("DR1", "CR2")

# Inventário: as informações do dia a dia, uma por célula da matriz.
INVENTARIO = [
    ("AD1", "Preço de venda"),
    ("AR1", "Desconto que cada vendedor pode dar"),
    ("AR2", "Crédito para cliente novo"),
    ("BD1", "Cadastro de fornecedor e preço negociado"),
    ("CD1", "Quem está inadimplente hoje"),
    ("CR2", "Régua de cobrança"),
    ("DD1", "Quem faz o quê e quem cobre quem"),
    ("AM1", "Por que abrimos aquela exceção"),
]

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro",
         "outubro", "novembro", "dezembro"]

COMO_USAR = ("Rascunho do Mapa gerado do formulário. Campos null viram [PREENCHER] no documento. "
             "Complete o que a coleta e as entrevistas deram e rode: prumo-mapa <este arquivo>. "
             "Mais sessões (time, coleta direta) entram em 'sessoes' e a regra do MIN se aplica sozinha. "
             "Travas: formula tempo_dono (por_semana, minutos), margem (base_mes, fracao_pct, taxa_pct) "
             "ou retrabalho (por_mes|por_trimestre, minutos, pessoas); ou valor_mes direto. O documento mostra "
             "as 5 de maior valor. Inventário: vive | nao_confiavel | nao_existe. Recomendação depois.formato: "
             "ia | simplificada | ainda_nao. Um campo com false some do documento (ex.: nao_recomendado).")


def eh_dono(sessao: dict) -> bool:
    return str(sessao.get("papel") or "").strip().lower().startswith("dono")


def eh_coleta(sessao: dict) -> bool:
    return "coleta" in str(sessao.get("papel") or "").lower()


def nota_de(valor) -> int | None:
    """Resposta de uma sessão: {"resposta", "nota"} ou só a nota (0 a 3)."""
    n = valor.get("nota") if isinstance(valor, dict) else valor
    if isinstance(n, bool) or n is None:
        return None
    if not isinstance(n, (int, float)) or not 0 <= n <= 3 or int(n) != n:
        raise ValueError(f"nota fora de 0 a 3: {n!r}")
    return int(n)


def consolidar(sessoes: list[dict]) -> dict:
    """Regra do MIN por ID; divergência quando dono e time dão notas diferentes."""
    por_id = {}
    for s in sessoes:
        for id_, valor in (s.get("respostas") or {}).items():
            if id_ not in IDS:
                raise ValueError(f"ID desconhecido na sessão {s.get('papel')!r}: {id_}")
            n = nota_de(valor)
            if n is None:
                continue
            resposta = valor.get("resposta", "") if isinstance(valor, dict) else ""
            por_id.setdefault(id_, []).append({"papel": s.get("papel") or "?", "dono": eh_dono(s),
                                               "nota": n, "resposta": resposta})
    final, divergencias = {}, []
    for id_ in IDS:
        votos = por_id.get(id_)
        if not votos:
            continue
        final[id_] = min(v["nota"] for v in votos)
        dono = [v for v in votos if v["dono"]]
        time_ = [v for v in votos if not v["dono"]]
        if dono and time_ and any(v["nota"] != dono[0]["nota"] for v in time_):
            menor = min(v["nota"] for v in time_)
            divergencias.append({"id": id_, "tema": IDS[id_][2], "dono": dono[0],
                                 "time": [v for v in time_ if v["nota"] == menor]})
    return {"final": final, "votos": por_id, "divergencias": divergencias}


def rollup(final: dict) -> tuple[list[dict], float | None]:
    blocos = []
    for chave, nome, ids in BLOCOS:
        notas = [final[i] for i in ids if i in final]
        blocos.append({"chave": chave, "nome": nome, "ids": ids,
                       "nota": sum(notas) / len(notas) if notas else None, "faltam": [i for i in ids if i not in final]})
    indice = sum(b["nota"] for b in blocos) if all(b["nota"] is not None for b in blocos) else None
    return blocos, indice


def valor_trava(t: dict, dados: dict) -> float | None:
    """Kit de fórmulas de custo (framework-mapa.md). Mensal, em reais."""
    if num(t.get("valor_mes")) is not None:
        return num(t["valor_mes"])
    f = t.get("formula")
    if f == "tempo_dono":
        n, m = num(t.get("por_semana")), num(t.get("minutos"))
        vh = num(t.get("valor_hora")) or valor_hora_dono(dados)
        return None if None in (n, m, vh) else n * m / 60 * 4.33 * vh
    if f == "margem":
        b, fr, tx = num(t.get("base_mes")), num(t.get("fracao_pct")), num(t.get("taxa_pct"))
        return None if None in (b, fr, tx) else b * fr / 100 * tx / 100
    if f == "retrabalho":
        n = num(t.get("por_mes"))
        if n is None and num(t.get("por_trimestre")) is not None:
            n = num(t["por_trimestre"]) / 3
        m, p = num(t.get("minutos")), num(t.get("pessoas"))
        vh = num(t.get("valor_hora")) or num(dados.get("valor_hora_time"))
        return None if None in (n, m, p, vh) else n * m / 60 * p * vh
    return None


def valor_hora_dono(dados: dict) -> float | None:
    """Pró-labore mensal ÷ 160 h, ou o valor perguntado direto."""
    if num(dados.get("valor_hora_dono")) is not None:
        return num(dados["valor_hora_dono"])
    pl = num(dados.get("pro_labore_dono"))
    return pl / 160 if pl is not None else None


def calcular(dados: dict) -> dict:
    """Tudo o que o documento mostra e é conta, a partir de dados.json."""
    sessoes = dados.get("sessoes") or []
    if not sessoes:
        raise ValueError("pacote sem sessões de resposta")
    c = consolidar(sessoes)
    blocos, indice = rollup(c["final"])
    travas = []
    for t in dados.get("travas") or []:
        v = valor_trava(t, dados)
        travas.append({**t, "valor": round(v) if v is not None else None})
    # Ranqueadas por custo; as que ainda não têm conta vão para o fim.
    travas.sort(key=lambda t: (t["valor"] is None, -(t["valor"] or 0)))
    travas = travas[:5]
    completas = [t for t in travas if t["valor"] is not None]
    total = sum(t["valor"] for t in completas) if completas and len(completas) == len(travas) else None
    dep = []
    for linha in (dados.get("dependencia") or {}).get("linhas") or []:
        dep.append({**linha, "por_semana": num(linha.get("por_semana")), "minutos": num(linha.get("minutos"))})
    dep_ok = bool(dep) and all(l["por_semana"] is not None and l["minutos"] is not None
                               and l.get("delegavel") in (True, False) for l in dep)
    dep_tot = None
    if dep_ok:
        horas = sum(l["por_semana"] * l["minutos"] for l in dep) / 60
        deleg_n = sum(l["por_semana"] for l in dep if l["delegavel"])
        deleg_h = sum(l["por_semana"] * l["minutos"] for l in dep if l["delegavel"]) / 60
        total_n = sum(l["por_semana"] for l in dep)
        dep_tot = {"n": total_n, "horas": horas, "delegaveis": deleg_n,
                   "pct": deleg_n / total_n * 100 if total_n else 0, "sobra": horas - deleg_h}
    pessoas = [s for s in sessoes if not eh_coleta(s)]
    return {
        "final": c["final"], "votos": c["votos"], "divergencias": c["divergencias"],
        "blocos": blocos, "indice": indice,
        "pessoas": len(pessoas), "coletas": sum(len(s.get("respostas") or {}) for s in sessoes if eh_coleta(s)),
        "so_dono": all(eh_dono(s) for s in sessoes),
        "travas": travas, "total_mes": total, "dependencia": dep, "dependencia_total": dep_tot,
        "valor_hora_dono": valor_hora_dono(dados),
    }


# ------------------------------------------------------------------ pacote -> dados.json

def texto_data(carimbo: str) -> str | None:
    """'23/09/2026 19:45:59' ou '2026-09-23...' -> '23 de setembro'."""
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", carimbo or "") or re.match(r"(\d{4})-(\d{2})-(\d{2})", carimbo or "")
    if not m:
        return None
    a, b, c = m.groups()
    dia, mes = (int(a), int(b)) if len(a) <= 2 else (int(c), int(b))
    return f"{dia} de {MESES[mes - 1]}" if 1 <= mes <= 12 else None


def preparar(pacote: dict, hoje: date | None = None) -> dict:
    """Pacote do n8n -> dados.json: acrescenta vazios os campos que o formulário não dá.

    Não sobrescreve o que já veio preenchido: rodar de novo sobre um dados.json
    editado não perde nada.
    """
    hoje = hoje or date.today()
    d = copy.deepcopy(pacote)
    sessoes = d.get("sessoes") or []
    if not sessoes:
        raise ValueError("pacote sem sessões de resposta")
    calc = consolidar(sessoes)  # valida IDs e notas já na entrada
    abaixo = {i for i, n in calc["final"].items() if n < 3}
    aprof = {}
    for s in sessoes:
        for i, t in (s.get("aprofundamentos") or {}).items():
            if str(t or "").strip():
                aprof.setdefault(i, []).append(f"{s.get('papel') or '?'}: {str(t).strip()}")
    ctx = lambda i: " | ".join(aprof.get(i, [])) or None  # noqa: E731

    d.setdefault("_como_usar", COMO_USAR)
    d.setdefault("descricao", [])
    datas = d.setdefault("datas", {})
    primeira = next((s.get("data") for s in sessoes if s.get("data")), None)
    datas.setdefault("coleta", texto_data(primeira) or texto_data(d.get("carimbo", "")))
    for k in ("analise", "devolutiva", "decisao", "inicio"):
        datas.setdefault(k, None)
    datas.setdefault("documento", f"{MESES[hoje.month - 1].capitalize()} de {hoje.year}")
    for k in ("pro_labore_dono", "valor_hora_dono", "valor_hora_time", "leitura_indice", "recomendacao_resumo",
              "preco_mapa"):
        d.setdefault(k, None)
    d.setdefault("achados", [])
    d.setdefault("scorecard", {})
    d.setdefault("divergencias_texto", {})
    d.setdefault("dependencia", {"nota": None, "linhas": [
        {"decisao": DECISOES[i], "por_semana": None, "minutos": None, "delegavel": None, "id": i,
         "resposta_do_formulario": ctx(i)} for i in DECISOES if i in abaixo]})
    d.setdefault("inventario", {"linhas": [
        {"informacao": nome, "sistema": None, "planilha": None, "cabeca": None, "id": i} for i, nome in INVENTARIO],
        "destaque": None, "fonte": None})
    d.setdefault("travas", [
        {"id": i, "titulo": None, "formula": f, **copy.deepcopy(campos), "conta": None,
         "resposta_do_formulario": ctx(i)} for i, (f, campos) in TRAVAS_CANDIDATAS.items() if i in abaixo])
    d.setdefault("riscos", [
        {"id": i, "valor": None, "texto": None, "resposta_do_formulario": ctx(i)}
        for i in RISCOS_CANDIDATOS if i in abaixo])
    d.setdefault("recomendacao", {"primeiro": [], "resumo": None,
                                  "depois": {"formato": None, "titulo": None, "texto": None},
                                  "nao_recomendado": None})
    return d


# ------------------------------------------------------------------ geração

def slug(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:60] or "empresa"


def gerar(dados: dict, pasta: Path, com_pdf: bool = True) -> dict:
    """Grava dados.json, o HTML e (se der) o PDF em `pasta`. Devolve o resumo."""
    calc = calcular(dados)
    html, preencher = modelo_mapa.documento(dados, calc, fonte_base64(), {i: v[2] for i, v in IDS.items()})
    pasta.mkdir(parents=True, exist_ok=True)
    nome = f"prumo-mapa-{slug(dados.get('empresa') or 'empresa')}"
    gravar(pasta / "dados.json", json.dumps(dados, ensure_ascii=False, indent=1) + "\n")
    gravar(pasta / f"{nome}.html", html)
    resumo = {"pasta": pasta, "html": pasta / f"{nome}.html", "pdf": None, "preencher": preencher,
              "indice": calc["indice"], "erro_pdf": None}
    if com_pdf:
        try:
            resumo["pdf"] = prumo_pdf.html_para_pdf(resumo["html"], pasta / f"{nome}.pdf")
        except RuntimeError as e:
            resumo["erro_pdf"] = str(e)
    return resumo


def gravar(caminho: Path, texto: str) -> None:
    tmp = caminho.with_name(caminho.name + ".parcial")
    tmp.write_text(texto, encoding="utf-8")
    tmp.replace(caminho)


def fonte_base64() -> str | None:
    """Archivo variável embutida: o HTML e o PDF não dependem do Google Fonts."""
    import base64
    for p in (AQUI / "archivo.woff2", HOME / ".local/share/prumo-mapa/archivo.woff2"):
        if p.is_file():
            return base64.b64encode(p.read_bytes()).decode()
    return None


def indice_txt(v) -> str:
    return "?" if v is None else f"{v:.1f}".replace(".", ",")


# ------------------------------------------------------------------ fila

def avisar(texto: str, teste: bool = False) -> None:
    FILA_AVISOS.mkdir(parents=True, exist_ok=True)
    if teste:
        texto = "[teste] " + texto
    arq = FILA_AVISOS / f"prumo-mapa-{time.time_ns()}.json"
    arq.write_text(json.dumps({"titulo": "📊 PRUMO", "texto": texto, "origem": "prumo-mapa"}, ensure_ascii=False), encoding="utf-8")


def ja_feito(resposta_id: str) -> Path | None:
    """Pasta de entrega que já veio desta resposta (não regrava o que o Rômulo editou)."""
    if not resposta_id or not ENTREGAS.is_dir():
        return None
    for dj in ENTREGAS.glob("*/dados.json"):
        try:
            if json.loads(dj.read_text(encoding="utf-8")).get("resposta_id") == resposta_id:
                return dj.parent
        except (OSError, ValueError):
            continue
    return None


def pasta_nova(dados: dict, hoje: date) -> Path:
    base = f"{hoje.isoformat()}-{'teste-' if dados.get('teste') else ''}{slug(dados.get('empresa') or 'empresa')}"
    pasta, n = ENTREGAS / base, 2
    while pasta.exists():
        pasta, n = ENTREGAS / f"{base}-{n}", n + 1
    return pasta


def ler_pacote(arq: Path) -> dict:
    # O gatilho pode chegar com o n8n ainda escrevendo: uma segunda leitura.
    for tentativa in range(3):
        try:
            d = json.loads(arq.read_text(encoding="utf-8"))
            if not isinstance(d, dict):
                raise ValueError("o pacote não é um objeto JSON")
            return d
        except json.JSONDecodeError:
            if tentativa == 2:
                raise
            time.sleep(3)
    raise AssertionError


def processar_fila() -> int:
    ERRO.mkdir(parents=True, exist_ok=True)
    ENTREGAS.mkdir(parents=True, exist_ok=True)
    leia = ENTREGAS / "LEIA-ME.txt"
    if not leia.exists():
        gravar(leia, "Entregas do PRUMO geradas no Dell (prumo-mapa). Uma pasta por diagnóstico:\n"
                     "dados.json (edite e rode `prumo-mapa <pasta>/dados.json`), o HTML e o PDF.\n"
                     "Dados de cliente: fora do Git. Nada aqui é enviado sozinho.\n")
    feitos = 0
    for arq in sorted(FILA.glob("*.json")):
        teste = False
        try:
            pacote = ler_pacote(arq)
            teste = bool(pacote.get("teste"))
            existente = ja_feito(pacote.get("resposta_id") or "")
            if existente:
                arq.unlink()  # mesma resposta de novo: o n8n reenviou; nada a fazer
                continue
            hoje = date.today()
            dados = preparar(pacote, hoje)
            r = gerar(dados, pasta_nova(dados, hoje))
            arq.unlink()
            feitos += 1
            empresa = dados.get("empresa") or "?"
            if r["erro_pdf"]:
                avisar(f"Mapa de {empresa}: o HTML saiu, o PDF não ({r['erro_pdf']}). "
                       f"Pasta: {r['pasta']}. Para tentar de novo: prumo-mapa {r['pasta']}/dados.json", teste)
            else:
                avisar(f"Rascunho do Mapa pronto: {empresa} · Índice do Prumo {indice_txt(r['indice'])}/18.\n"
                       f"PDF: {r['pdf']}\n"
                       f"{r['preencher']} campos [PREENCHER] (entrevistas, coleta, travas, recomendação). "
                       f"Complete o dados.json da pasta e rode: prumo-mapa {r['pasta']}/dados.json\n"
                       "Nada foi enviado ao cliente.", teste)
        except Exception as e:  # noqa: BLE001 — um pacote ruim não trava os outros
            destino = ERRO / f"{datetime.now():%Y%m%d-%H%M%S}-{arq.name}"
            try:
                arq.replace(destino)
            except OSError:
                arq.unlink(missing_ok=True)
            avisar(f"Mapa do PRUMO não pôde ser gerado ({arq.name}): {e}. Pacote em {destino}.", teste)
    return feitos


# ------------------------------------------------------------------ CLI

def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    if argv[0] == "--fila":
        n = processar_fila()
        print(f"prumo-mapa: {n} mapa(s) gerado(s)")
        return 0
    arq = Path(argv[0]).expanduser().resolve()
    saida = None
    if "--saida" in argv:
        saida = Path(argv[argv.index("--saida") + 1]).expanduser().resolve()
    try:
        dados = preparar(ler_pacote(arq))
        pasta = saida or arq.parent
        r = gerar(dados, pasta, com_pdf="--sem-pdf" not in argv)
    except (OSError, ValueError, KeyError) as e:
        print(f"prumo-mapa: {e}", file=sys.stderr)
        return 1
    print(f"Índice do Prumo {indice_txt(r['indice'])}/18 · {r['preencher']} campos [PREENCHER]")
    print(f"HTML: {r['html']}")
    if r["pdf"]:
        print(f"PDF:  {r['pdf']} ({prumo_pdf.paginas(r['pdf'])} páginas)")
    elif r["erro_pdf"]:
        print(f"PDF falhou: {r['erro_pdf']}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
