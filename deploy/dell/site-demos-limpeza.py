#!/usr/bin/env python3
"""Apaga na Vercel o demo de quem nunca interagiu (Dell, 07/10/2026).

Decisão do Rômulo (07/10/2026), a outra ponta do `site-demos-pausa`: lead que
recebeu o demo, não respondeu, não fechou e não recusou, e já passou dos 10 dias
do "expirado" (EXPIRA_DIAS, a regra do 05 · Acompanhamento), tem o projeto da
Vercel APAGADO. Os projetos são o limite do plano (hobby): demo parado ocupa
vaga que o gerador precisa.

Quem entra, tudo ao mesmo tempo (retrato da planilha que o fluxo 07 grava a
cada hora, site-leads.json):
- status `enviado` (ou `expirado`), com a pasta na raiz de ~/auto-site ou em
  _concluidos/: lead em _recusados/, _em-conversa/ ou _fechados/ nunca entra;
- sem `respondeu_em`, `fechado_em` nem `recusado_em` (recusar é interação: esses
  o `site-demos-pausa` pausa, e pausar é reversível);
- `enviado_em` + 10 dias já passou;
- projeto `demo-*`, igual ao do publicado.json da pasta (a pasta é a prova, não só a planilha).
Retrato com mais de 3 h não vale: uma resposta de hoje poderia estar de fora.

O que NÃO apaga: a pasta do lead em ~/auto-site (conteúdo, fotos, DESIGN.md)
fica, para regerar ou republicar. Só ganha `apagado_em` no publicado.json, e o
`site-demos-pausa` passa a ignorar o lead (projeto que não existe seria falha).

Padrão = só LISTAR. O timer diário (09:50) lista e manda UM aviso quando aparece
candidato novo; apagar é sempre ordem explícita:

    site-demos-limpeza                      lista quem entra e, se há novo, manda UM aviso (é o que o timer roda)
    site-demos-limpeza --simular            só lista, sem aviso e sem gravar estado
    site-demos-limpeza --apagar             apaga todos os que entram
    site-demos-limpeza --apagar demo-a demo-b   apaga só esses (têm de estar entre os que entram)
    site-demos-limpeza --dias 7             ensaio com outro prazo (só lista, nunca apaga)

Token: o da Vercel CLI (auth.json), renovado pela própria CLI; nunca é impresso.
Estado em ~/.local/state/site-demos-limpeza/ (avisados.json, historico.jsonl).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HOME = Path.home()
AUTO = HOME / "auto-site"
RETRATO = HOME / ".local/share/n8n-estado/site-leads.json"
ESTADO = HOME / ".local/state/site-demos-limpeza/avisados.json"
HISTORICO = ESTADO.with_name("historico.jsonl")
FILA_AVISOS = HOME / ".local/share/avisos/fila"
AUTH = HOME / ".local/share/com.vercel.cli/auth.json"
VERCEL_CLI = HOME / ".local/bin/vercel"
TIME_VERCEL = "team_fgUUHtNBYtsrwTNGwn2gzxF2"  # romulodesigns
API = "https://api.vercel.com"

EXPIRA_DIAS = 10  # site-acompanhamento.py: expirado no 10º dia depois do envio
RETRATO_VELHO = timedelta(hours=3)  # o fluxo 07 grava de hora em hora (:20)
MAX_NOMES = 25
SP = timezone(timedelta(hours=-3))  # São Paulo, sem horário de verão desde 2019
STATUS_QUE_ENTRAM = ("enviado", "expirado")
PASTAS_QUE_ENTRAM = ("", "_concluidos")  # raiz ou expirado; o resto está no jogo ou já recusou
INTERACAO = ("respondeu_em", "fechado_em", "recusado_em")
SLUG = re.compile(r"^[a-z0-9][a-z0-9._-]{0,179}$")


def ler_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def dia_de(iso: str, hoje_tz=SP) -> date | None:
    try:
        t = datetime.fromisoformat(str(iso).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (t if t.tzinfo else t.replace(tzinfo=hoje_tz)).astimezone(SP).date()


def escolher(leads: list[dict], hoje: date, dias: int = EXPIRA_DIAS) -> tuple[list[dict], list[tuple[str, str]]]:
    """PURO: (quem entra, [(nome, por que não entrou)]) a partir das linhas do retrato."""
    eleitos, guardados = [], []
    for l in leads:
        nome = str(l.get("nome") or l.get("pasta") or "?")
        if l.get("status") not in STATUS_QUE_ENTRAM:
            guardados.append((nome, f"status {l.get('status')}"))
            continue
        pasta = str(l.get("pasta") or "")
        topo, _, resto = pasta.rpartition("/")
        if topo not in PASTAS_QUE_ENTRAM or not SLUG.match(resto or ""):
            guardados.append((nome, f"pasta {pasta or '?'}"))
            continue
        if any(l.get(c) for c in INTERACAO):
            guardados.append((nome, "teve interação"))
            continue
        projeto = str(l.get("vercel_project") or "")
        if not projeto.startswith("demo-"):
            guardados.append((nome, f"projeto {projeto or '?'} não é demo-*"))
            continue
        enviado = dia_de(l.get("enviado_em", ""))
        if enviado is None:
            guardados.append((nome, "enviado_em ilegível"))
            continue
        if hoje < enviado + timedelta(days=dias):
            guardados.append((nome, f"entra em {enviado + timedelta(days=dias):%d/%m}"))
            continue
        eleitos.append({"nome": nome, "projeto": projeto, "pasta": pasta, "enviado_em": enviado.isoformat()})
    return eleitos, guardados


def ler_retrato() -> list[dict]:
    d = ler_json(RETRATO)
    if not isinstance(d, dict):
        raise RuntimeError("sem retrato da planilha (site-leads.json)")
    try:
        gerado = datetime.fromisoformat(str(d.get("geradoEm")).replace("Z", "+00:00"))
    except ValueError:
        raise RuntimeError("retrato da planilha sem data") from None
    if datetime.now(timezone.utc) - gerado > RETRATO_VELHO:
        raise RuntimeError(f"retrato da planilha velho ({gerado.astimezone(SP):%d/%m %H:%M}); uma resposta recente "
                           "poderia estar de fora. O fluxo 07 grava de hora em hora")
    return [l for l in d.get("leads", []) if isinstance(l, dict)]


def ja_apagado(pasta: str) -> bool:
    return bool((ler_json(AUTO / pasta / "publicado.json") or {}).get("apagado_em"))


# ---------------------------------------------------------------- Vercel

def token() -> str:
    """Token da Vercel CLI; a própria CLI renova quando está para vencer (nunca imprime)."""
    d = ler_json(AUTH) or {}
    if not d.get("token") or float(d.get("expiresAt") or 0) < time.time() + 600:
        subprocess.run([str(VERCEL_CLI), "whoami", "--non-interactive"], capture_output=True, timeout=120, check=False,
                       env={"PATH": f"{HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin", "HOME": str(HOME)})
        d = ler_json(AUTH) or {}
    if not d.get("token") or float(d.get("expiresAt") or 0) < time.time():
        raise RuntimeError("token da Vercel CLI vencido e não renovou (rode `vercel login` no Dell)")
    return str(d["token"])


def vercel(metodo: str, caminho: str, chave: str) -> dict:
    url = f"{API}{caminho}{'&' if '?' in caminho else '?'}teamId={TIME_VERCEL}"
    req = urllib.request.Request(url, method=metodo, headers={"Authorization": f"Bearer {chave}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        corpo = e.read().decode(errors="replace")[:200]
        raise RuntimeError(f"{metodo} {caminho.split('?')[0]} -> {e.code}: {corpo}") from None


def projeto_na_vercel(nome: str, chave: str) -> dict | None:
    try:
        return vercel("GET", f"/v9/projects/{urllib.parse.quote(nome)}", chave)
    except RuntimeError as e:
        if " -> 404" in str(e):
            return None
        raise


# ---------------------------------------------------------------- rodada

def avisar(texto: str) -> None:
    FILA_AVISOS.mkdir(parents=True, exist_ok=True)
    (FILA_AVISOS / f"site-demos-limpeza-{time.time_ns()}.json").write_text(
        json.dumps({"titulo": "🧹 Site antes da venda: demos sem interação", "texto": texto,
                    "origem": "site-demos-limpeza"}, ensure_ascii=False), encoding="utf-8")


def anotar(evento: dict) -> None:
    HISTORICO.parent.mkdir(parents=True, exist_ok=True)
    with HISTORICO.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"em": datetime.now(SP).isoformat(timespec="seconds"), **evento}, ensure_ascii=False) + "\n")


def marcar_apagado(pasta: str) -> None:
    recibo = AUTO / pasta / "publicado.json"
    r = ler_json(recibo)
    if not isinstance(r, dict):
        return
    r["apagado_em"] = datetime.now(SP).isoformat(timespec="seconds")
    tmp = recibo.with_name(".publicado.json.tmp")
    tmp.write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(recibo)


def apagar(alvos: list[dict]) -> int:
    chave = token()
    apagados, falhas = [], []
    for e in alvos:
        r = ler_json(AUTO / e["pasta"] / "publicado.json") or {}
        if r.get("vercel_project") != e["projeto"]:
            falhas.append(f"{e['nome']}: o publicado.json da pasta não confirma o projeto {e['projeto']}")
            continue
        try:
            info = projeto_na_vercel(e["projeto"], chave)
            if info is not None:
                vercel("DELETE", f"/v9/projects/{info['id']}", chave)  # a API apaga pelo id (prj_...)
            marcar_apagado(e["pasta"])
            apagados.append(e)
            anotar({"acao": "apagou" if info is not None else "ja_nao_existia", "projeto": e["projeto"],
                    "nome": e["nome"], "enviado_em": e["enviado_em"]})
            print(f"{'apagado' if info is not None else 'já não existia'}: {e['projeto']}")
        except RuntimeError as err:
            falhas.append(f"{e['nome']}: {err}")
    if apagados or falhas:
        linhas = []
        if apagados:
            linhas += [f"Apaguei {len(apagados)} demo(s) na Vercel (enviado há {EXPIRA_DIAS}+ dias, sem nenhuma "
                       "interação). A pasta continua em ~/auto-site."]
            linhas += [f"• {e['nome']}" for e in apagados[:MAX_NOMES]]
            if len(apagados) > MAX_NOMES:
                linhas.append(f"• e mais {len(apagados) - MAX_NOMES} (lista em {HISTORICO})")
        if falhas:
            linhas += ([""] if linhas else []) + [f"Não consegui ({len(falhas)}):"] + [f"• {f}" for f in falhas]
        avisar("\n".join(linhas))
    return 1 if falhas else 0


def main(argv: list[str]) -> int:
    dias, quero_apagar, nomes, simular = EXPIRA_DIAS, False, [], False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--apagar":
            quero_apagar = True
        elif a == "--simular":
            simular = True  # lista sem mandar aviso nem gravar o que já foi avisado
        elif a == "--dias" and i + 1 < len(argv):
            i += 1
            dias = int(argv[i])
        elif a.startswith("demo-"):
            nomes.append(a)
        else:
            print(__doc__)
            return 2
        i += 1
    if quero_apagar and dias != EXPIRA_DIAS:
        print("--dias é só ensaio: apagar usa sempre o prazo de 10 dias")
        return 2
    if nomes and not quero_apagar:
        print("nomes de projeto só com --apagar")
        return 2

    hoje = datetime.now(SP).date()
    leads = [l for l in ler_retrato() if not (l.get("pasta") and ja_apagado(str(l["pasta"])))]
    eleitos, guardados = escolher(leads, hoje, dias)
    print(f"{len(eleitos)} entram (enviado há {dias}+ dias, sem nenhuma interação)")
    for e in eleitos:
        print(f"  {e['projeto']}  ({e['nome']}, enviado {e['enviado_em']})")
    futuros = sorted(m for _, m in guardados if m.startswith("entra em"))
    print(f"{len(guardados)} ficam de fora; {len(futuros)} deles ainda dentro do prazo")

    if quero_apagar:
        if nomes:
            desconhecidos = [n for n in nomes if n not in {e['projeto'] for e in eleitos}]
            if desconhecidos:
                print("não entram nos critérios, nada foi apagado: " + ", ".join(desconhecidos))
                return 2
            eleitos = [e for e in eleitos if e["projeto"] in nomes]
        return apagar(eleitos)

    if dias == EXPIRA_DIAS and eleitos and not simular:
        avisados = ler_json(ESTADO) or {}
        novos = [e for e in eleitos if e["projeto"] not in (avisados.get("projetos") or [])]
        if novos:
            linhas = [f"{len(eleitos)} demo(s) enviado(s) há {EXPIRA_DIAS}+ dias sem nenhuma interação. "
                      "Nada foi apagado. Para apagar, no Dell: site-demos-limpeza --apagar",
                      "(ou só alguns: site-demos-limpeza --apagar demo-x demo-y)"]
            linhas += [f"• {e['nome']}" for e in eleitos[:MAX_NOMES]]
            if len(eleitos) > MAX_NOMES:
                linhas.append(f"• e mais {len(eleitos) - MAX_NOMES}")
            avisar("\n".join(linhas))
            ESTADO.parent.mkdir(parents=True, exist_ok=True)
            tmp = ESTADO.with_suffix(".tmp")
            tmp.write_text(json.dumps({"projetos": sorted(e["projeto"] for e in eleitos)}, ensure_ascii=False), encoding="utf-8")
            tmp.replace(ESTADO)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except RuntimeError as e:
        print(e)
        sys.exit(1)
