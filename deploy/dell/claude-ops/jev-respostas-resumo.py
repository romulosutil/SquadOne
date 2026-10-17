#!/usr/bin/env python3
"""Jev x Gemini nas respostas de lead: resumo da sombra e regra de promoção (SOMENTE LEITURA).

O ramo "Jev: ..." do fluxo "WhatsApp — resposta de lead (classifica)" (whatsapp-conversa.py, 11/10/2026)
grava uma linha por resposta na Data Table `jev_sombra_respostas` do n8n da Mel: o tipo que o Gemini deu,
o que o Jev (typesafe/jev-1.13) escolheu, as probabilidades, a confiança, a nota de injeção, modelo,
tokens, custo e latência. O lead aparece só como sha256(sal + chave); o texto não é guardado.

Este script só lê: a tabela (GET pela API do n8n, ou um arquivo exportado pelo editor) e, para
mostrar o trecho de cada resposta ao revisar, o retrato local do CRM (~/.local/share/n8n-estado/crm.json),
casando o hash e a hora da resposta. O vínculo lead <-> resultado fica só aqui, do lado do Rômulo.

Revisão humana: na Data Table, coluna `revisao_humana`, escreva o tipo certo da linha (bot, exclusao,
negativa, interesse ou neutra). `--revisar` lista as linhas ainda sem revisão com o id e o trecho.

Regra de promoção (o Jev só sai da sombra se TUDO valer):
  1. pelo menos 60 LEADS com resposta revista por humano (um lead que respondeu várias vezes conta uma vez, pela
     linha mais recente; a Data Table tem uma linha por execução);
  2. concordância do Jev com a revisão humana >= 95 % nessas respostas;
  3. NENHUM "interesse" (do Gemini, em qualquer linha, ou da revisão humana) que o Jev tenha chamado de
     negativa ou exclusao: perder um lead que quer ver é o erro que não se aceita.
A concordância Jev x Gemini (todas as linhas) aparece para informação; ela sozinha não promove nada,
porque o Gemini também erra. Promover exige ainda o DPA da TypeSafe (ver deploy/dell/README.md).

Uso: python3 jev-respostas-resumo.py                    resumo, lendo a tabela pelo n8n
     python3 jev-respostas-resumo.py --arquivo X.csv      resumo de um CSV/JSON exportado da Data Table
     python3 jev-respostas-resumo.py --revisar            linhas sem revisão, das mais úteis às menos (perigosas, divergentes,
                                                          pouca confiança, resto), com o trecho (do crm.json: prumo, iris, estampa)
     python3 jev-respostas-resumo.py --hash 27999887766   hash de um número (para achar o lead na tabela)
     python3 jev-respostas-resumo.py --testar
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

TABELA = "jev_sombra_respostas"
# O mesmo sal de whatsapp-conversa.py (JEV_SAL); o --testar de lá confere que os dois batem.
SAL = "squadone:jev-sombra:v1"
# licenca (17/10/2026): tipo novo do Gemini; o Jev não o tem (segue com os 5), mas a revisão humana pode usá-lo.
TIPOS = ("bot", "exclusao", "negativa", "interesse", "licenca", "neutra")
PERIGOSOS = ("negativa", "exclusao")
MIN_REVISTAS = 60
MIN_CONCORDANCIA = 0.95
RETRATO = Path.home() / ".local/share/n8n-estado/crm.json"


def chave_do_numero(bruto) -> str:
    """Mesma regra do observador e do fluxo (CHAVE_JS): DDD + últimos 8 dígitos."""
    d = re.sub(r"\D", "", str(bruto or ""))
    if len(d) >= 12 and d.startswith("55"):
        d = d[2:]
    if len(d) < 10 or len(d) > 11:
        return ""
    return d[:2] + d[-8:]


def hash_do_lead(numero) -> str:
    c = chave_do_numero(numero)
    return hashlib.sha256(f"{SAL}:{c}".encode()).hexdigest() if c else ""


def instante(texto) -> float | None:
    """ISO 8601 com Z, -03:00 ou -0300 (a planilha mistura os três) -> epoch; ilegível = None."""
    t = str(texto or "").strip()
    if not t:
        return None
    t = re.sub(r"Z$", "+00:00", t)
    t = re.sub(r"([+-]\d\d)(\d\d)$", r"\1:\2", t)
    try:
        d = datetime.fromisoformat(t)
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()


def numero(v) -> float | None:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def normalizar(linha: dict) -> dict:
    """Linha da API (tipos certos) ou do CSV (tudo texto) -> o mesmo formato."""
    txt = lambda k: str(linha.get(k) or "").strip()
    return {"id": txt("id"), "lead_hash": txt("lead_hash"), "planilha": txt("planilha"),
            "n_mensagens": numero(linha.get("n_mensagens")), "resposta_em": txt("resposta_em"),
            "tipo_gemini": txt("tipo_gemini"), "jev_choice": txt("jev_choice"),
            "jev_confidence": numero(linha.get("jev_confidence")), "jev_injecao": numero(linha.get("jev_injecao")),
            "jev_model": txt("jev_model"), "cost": numero(linha.get("cost")), "latencia_ms": numero(linha.get("latencia_ms")),
            "em": txt("em"), "revisao_humana": txt("revisao_humana").lower()}


def ler_arquivo(caminho: Path) -> list[dict]:
    texto = caminho.read_text(encoding="utf-8-sig")
    if texto.lstrip().startswith(("[", "{")):
        dados = json.loads(texto)
        return [normalizar(l) for l in (dados.get("data", []) if isinstance(dados, dict) else dados)]
    return [normalizar(l) for l in csv.DictReader(texto.splitlines())]


def ler_do_n8n(api) -> list[dict]:
    """Só GET: acha a tabela pelo nome e pagina as linhas. `api` é n8n.api (ou um dublê no teste)."""
    tabelas = api("GET", "/data-tables?limit=100&filter=" + quote(json.dumps({"name": TABELA}))).get("data", [])
    tabela = next((t for t in tabelas if t.get("name") == TABELA), None)
    if not tabela:
        raise SystemExit(f"Data Table {TABELA!r} não existe no n8n (a sombra nunca foi ligada?)")
    linhas, cursor = [], None
    while True:
        r = api("GET", f"/data-tables/{tabela['id']}/rows?limit=250" + (f"&cursor={quote(cursor)}" if cursor else ""))
        linhas += [normalizar(l) for l in r.get("data", [])]
        cursor = r.get("nextCursor")
        if not cursor:
            return linhas


def trechos_do_retrato(retrato: dict) -> dict:
    """(hash do lead, instante da resposta) -> trecho que o fluxo gravou na planilha. Só para revisar."""
    fontes = retrato.get("fontes", {})
    achados = {}
    for l in fontes.get("site", {}).get("linhas", []):
        m = re.search(r"wa\.me/(\d+)", str(l.get("wa_me") or ""))
        h, t = hash_do_lead(m.group(1) if m else l.get("telefone")), instante(l.get("resposta_em"))
        if h and t is not None:
            achados[(h, t)] = str(l.get("resposta_trecho") or "")
    # PRUMO, Iris e estamparias têm o mesmo contrato de colunas (Prospects, OFERTA_DE_PROSPECCAO em server/crm.ts);
    # ler só "prumo" deixava a resposta de uma clínica ou de uma estamparia sempre "fora do retrato".
    for fonte in ("prumo", "iris", "estampa"):
        for l in fontes.get(fonte, {}).get("linhas", []):
            h, t = hash_do_lead(l.get("WhatsApp")), instante(l.get("Resposta em"))
            if h and t is not None:
                achados[(h, t)] = str(l.get("Resposta") or "")
    return achados


def um_por_lead(linhas: list[dict]) -> list[dict]:
    """A Data Table tem uma linha por execução do fluxo, e um lead que responde várias vezes gera várias linhas
    (27 leads viraram 40 linhas em 15/10/2026). Contar linhas faria 60 revisões valerem bem menos de 60 leads:
    fica a linha mais recente de cada lead. Linha sem hash (não deveria ocorrer) conta sozinha."""
    escolhida: dict = {}
    for i, l in enumerate(linhas):
        chave = l["lead_hash"] or f"sem-hash-{i}"
        quando = instante(l["resposta_em"]) or instante(l["em"]) or 0.0
        if chave not in escolhida or quando >= escolhida[chave][0]:
            escolhida[chave] = (quando, l)
    return [l for _, l in escolhida.values()]


def resumir(linhas: list[dict]) -> dict:
    validas = [l for l in linhas if l["jev_choice"]]
    # A regra de promoção conta LEADS revistos, não linhas; o "perigoso" abaixo continua olhando todas as linhas
    # (um interesse perdido numa linha antiga ainda é um interesse perdido).
    revistas = um_por_lead([l for l in validas if l["revisao_humana"] in TIPOS])
    pct = lambda a, b: (a / b) if b else None
    perigosos = [l for l in validas if l["jev_choice"] in PERIGOSOS
                 and (l["tipo_gemini"] == "interesse" or l["revisao_humana"] == "interesse")]
    matriz: dict = {}
    for l in validas:
        matriz.setdefault(l["tipo_gemini"] or "?", {}).setdefault(l["jev_choice"], 0)
        matriz[l["tipo_gemini"] or "?"][l["jev_choice"]] += 1
    lat = sorted(l["latencia_ms"] for l in validas if l["latencia_ms"] is not None)
    quantil = lambda q: lat[min(len(lat) - 1, int(q * len(lat)))] if lat else None
    return {
        "linhas": len(validas),
        "jev_x_gemini": pct(sum(l["jev_choice"] == l["tipo_gemini"] for l in validas), len(validas)),
        "uma_mensagem_jev_x_gemini": pct(sum(l["jev_choice"] == l["tipo_gemini"] for l in validas if l["n_mensagens"] == 1),
                                         sum(1 for l in validas if l["n_mensagens"] == 1)),
        "revistas": len(revistas),
        "jev_x_humano": pct(sum(l["jev_choice"] == l["revisao_humana"] for l in revistas), len(revistas)),
        "gemini_x_humano": pct(sum(l["tipo_gemini"] == l["revisao_humana"] for l in revistas), len(revistas)),
        "perigosos": [l["id"] or "?" for l in perigosos],
        "injecao": sum(1 for l in validas if (l["jev_injecao"] or 0) >= 0.5),
        "matriz": matriz,
        "custo": sum(l["cost"] or 0 for l in validas),
        "latencia_p50": quantil(0.5), "latencia_p95": quantil(0.95),
        "modelos": sorted({l["jev_model"] for l in validas if l["jev_model"]}),
    }


def veredito(r: dict) -> tuple[bool, list[str]]:
    faltas = []
    if r["revistas"] < MIN_REVISTAS:
        faltas.append(f"só {r['revistas']} de {MIN_REVISTAS} leads com resposta revista por humano")
    if r["jev_x_humano"] is None or r["jev_x_humano"] < MIN_CONCORDANCIA:
        faltas.append("concordância Jev x humano abaixo de 95 %" if r["jev_x_humano"] is not None
                      else "sem revisão humana, não há concordância")
    if r["perigosos"]:
        faltas.append(f"{len(r['perigosos'])} 'interesse' que o Jev chamou de negativa/exclusao (linhas {', '.join(r['perigosos'][:10])})")
    return not faltas, faltas


def formatar(r: dict) -> str:
    p = lambda v: "—" if v is None else f"{100 * v:.1f} %"
    tipos = sorted({t for linha in r["matriz"].values() for t in linha} | set(r["matriz"]))
    l = [f"Sombra do Jev: {r['linhas']} respostas classificadas pelos dois",
         f"  Jev x Gemini (todas): {p(r['jev_x_gemini'])}   só conversas de 1 mensagem: {p(r['uma_mensagem_jev_x_gemini'])}",
         f"  Leads revistos por humano: {r['revistas']}   Jev x humano: {p(r['jev_x_humano'])}   Gemini x humano: {p(r['gemini_x_humano'])}",
         f"  Injeção (noul >= 0,5): {r['injecao']}   custo: US$ {r['custo']:.5f}   latência p50/p95: "
         f"{r['latencia_p50'] or '—'}/{r['latencia_p95'] or '—'} ms   modelos: {', '.join(r['modelos']) or '—'}",
         "", "Gemini (linha) x Jev (coluna):", "  " + "".ljust(10) + "".join(t[:9].ljust(10) for t in tipos)]
    for g in tipos:
        if g in r["matriz"]:
            l.append("  " + g[:9].ljust(10) + "".join(str(r["matriz"][g].get(t, "")).ljust(10) for t in tipos))
    ok, faltas = veredito(r)
    l += ["", "PROMOVER: sim, pela regra (falta o DPA da TypeSafe antes de sair da sombra)" if ok
          else "PROMOVER: não. " + "; ".join(faltas) + "."]
    return "\n".join(l)


GRUPOS_DA_REVISAO = (
    "1. Perigosas: o Gemini viu interesse e o Jev chamou de negativa/exclusao (é o que barra a promoção)",
    "2. Divergem: Gemini e Jev discordam (uma delas está errada; a mais confiante do Jev primeiro)",
    "3. Concordam, mas o Jev tem pouca confiança (< 0,5)",
    "4. Concordam com confiança (conferir por amostra)",
)


def grupo_da_revisao(x: dict) -> int:
    """0..3, o índice em GRUPOS_DA_REVISAO. Ordem de utilidade da revisão: o que pode barrar vem antes do que diverge,
    e só depois entra o que os dois acham igual."""
    if x["tipo_gemini"] == "interesse" and x["jev_choice"] in PERIGOSOS:
        return 0
    if x["tipo_gemini"] != x["jev_choice"]:
        return 1
    if x["jev_confidence"] is not None and x["jev_confidence"] < 0.5:
        return 2
    return 3


def para_revisar(linhas: list[dict], trechos: dict) -> str:
    pendentes = [x for x in linhas if x["jev_choice"] and x["revisao_humana"] not in TIPOS]
    por_lead: dict = {}
    for x in pendentes:
        por_lead[x["lead_hash"]] = por_lead.get(x["lead_hash"], 0) + 1
    # Dentro do grupo: divergências pela confiança do Jev decrescente, o resto pela crescente; id como desempate.
    def chave(x):
        g, c = grupo_da_revisao(x), x["jev_confidence"] if x["jev_confidence"] is not None else 0.0
        return (g, -c if g <= 1 else c, int(x["id"]) if x["id"].isdigit() else 0)
    l = ["Linhas sem revisao_humana (escreva o tipo certo na Data Table, pelo id), das mais úteis às menos:",
         "  Revisar só as divergências deixa a concordância medida mais baixa do que a real: é a estimativa conservadora.",
         "  A regra de promoção conta LEADS revistos, não linhas."]
    atual = None
    for x in sorted(pendentes, key=chave):
        g = grupo_da_revisao(x)
        if g != atual:
            atual = g
            l.append(f"\n{GRUPOS_DA_REVISAO[g]}")
        t = instante(x["resposta_em"])
        trecho = trechos.get((x["lead_hash"], t)) if t is not None else None
        aviso = "" if (x["n_mensagens"] or 0) <= 1 else f" ({int(x['n_mensagens'])} mensagens: o Jev viu só a última)"
        repetido = f" [lead com {por_lead[x['lead_hash']]} linhas a revisar]" if x["lead_hash"] and por_lead[x["lead_hash"]] > 1 else ""
        l.append(f"  id {x['id']}  Gemini {x['tipo_gemini']:<9}  Jev {x['jev_choice']:<9}"
                 f"({'—' if x['jev_confidence'] is None else round(x['jev_confidence'], 2)}){aviso}{repetido}\n"
                 f"      {json.dumps(trecho, ensure_ascii=False) if trecho is not None else '(trecho fora do retrato: confira no WhatsApp)'}")
    return "\n".join(l)


def main(argv: list[str]) -> int:
    if "--hash" in argv:
        h = hash_do_lead(argv[argv.index("--hash") + 1] if argv.index("--hash") + 1 < len(argv) else "")
        print(h or "número ilegível (precisa de DDD)")
        return 0 if h else 1
    if "--arquivo" in argv:
        linhas = ler_arquivo(Path(argv[argv.index("--arquivo") + 1]))
    else:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from n8n import api  # só aqui: o módulo lê a chave do n8n ao ser importado
        linhas = ler_do_n8n(api)
    if "--revisar" in argv:
        retrato = json.loads(RETRATO.read_text(encoding="utf-8")) if RETRATO.exists() else {}
        print(para_revisar(linhas, trechos_do_retrato(retrato)))
        return 0
    print(formatar(resumir(linhas)))
    return 0


# ---------------------------------------------------------------- testes (sem n8n, sem crm.json real)

def testar() -> int:
    import tempfile
    import unittest

    def linha(i, gemini, jev, humano="", **k):
        return normalizar({"id": i, "lead_hash": "h" + str(i), "tipo_gemini": gemini, "jev_choice": jev,
                           "revisao_humana": humano, "n_mensagens": 1, "jev_confidence": 0.9, "cost": 0.00002,
                           "latencia_ms": 500, "jev_model": "typesafe/jev-1.13-20260917", **k})

    class Regra(unittest.TestCase):
        def test_60_revistas_e_tudo_certo_promove(self):
            ok, faltas = veredito(resumir([linha(i, "neutra", "neutra", "neutra") for i in range(60)]))
            self.assertTrue(ok, faltas)

        def test_59_revistas_nao_promove(self):
            ok, faltas = veredito(resumir([linha(i, "neutra", "neutra", "neutra") for i in range(59)]))
            self.assertFalse(ok)
            self.assertIn("só 59 de 60", faltas[0])

        def test_95_por_cento_exato_passa_e_abaixo_nao(self):
            certas = [linha(i, "bot", "bot", "bot") for i in range(57)]
            self.assertTrue(veredito(resumir(certas + [linha(90 + i, "bot", "neutra", "bot") for i in range(3)]))[0])
            self.assertFalse(veredito(resumir(certas + [linha(90 + i, "bot", "neutra", "bot") for i in range(4)]))[0])

        def test_um_interesse_virando_negativa_ou_exclusao_barra(self):
            base = [linha(i, "neutra", "neutra", "neutra") for i in range(100)]
            for jev in PERIGOSOS:
                ok, faltas = veredito(resumir(base + [linha("x", "interesse", jev)]))  # nem precisa estar revista
                self.assertFalse(ok)
                self.assertIn("linhas x", faltas[-1])
            # Interesse da revisão humana também conta, mesmo que o Gemini tenha errado.
            self.assertFalse(veredito(resumir(base + [linha("y", "neutra", "negativa", "interesse")]))[0])
            # Interesse que o Jev chamou de neutra não barra (só conta na concordância).
            self.assertTrue(veredito(resumir(base + [linha("z", "interesse", "neutra")]))[0])

        def test_concordancia_jev_x_gemini_nao_promove_sozinha(self):
            r = resumir([linha(i, "neutra", "neutra") for i in range(200)])
            self.assertEqual(r["jev_x_gemini"], 1.0)
            self.assertFalse(veredito(r)[0])

        def test_linha_sem_jev_nao_conta(self):
            self.assertEqual(resumir([linha(1, "bot", ""), linha(2, "bot", "bot")])["linhas"], 1)

        def test_matriz_e_formato(self):
            r = resumir([linha(1, "interesse", "interesse", "interesse"), linha(2, "bot", "neutra")])
            self.assertEqual(r["matriz"], {"interesse": {"interesse": 1}, "bot": {"neutra": 1}})
            texto = formatar(r)
            self.assertIn("PROMOVER: não", texto)
            self.assertIn("typesafe/jev-1.13-20260917", texto)

    class Leitura(unittest.TestCase):
        def test_csv_exportado(self):
            with tempfile.TemporaryDirectory() as d:
                arq = Path(d) / "t.csv"
                arq.write_text("id,lead_hash,tipo_gemini,jev_choice,jev_confidence,revisao_humana,n_mensagens\n"
                               "1,abc,bot,bot,0.8,Bot,1\n2,def,negativa,exclusao,,,2\n", encoding="utf-8")
                linhas = ler_arquivo(arq)
            self.assertEqual((linhas[0]["revisao_humana"], linhas[0]["jev_confidence"], linhas[1]["jev_confidence"]),
                             ("bot", 0.8, None))

        def test_n8n_so_com_get_e_pagina(self):
            chamadas = []

            def api(metodo, caminho, corpo=None):
                chamadas.append((metodo, caminho))
                if caminho.startswith("/data-tables?"):
                    return {"data": [{"id": "T1", "name": TABELA}]}
                if "cursor=" not in caminho:
                    return {"data": [{"id": 1, "jev_choice": "bot", "tipo_gemini": "bot"}], "nextCursor": "c2"}
                return {"data": [{"id": 2, "jev_choice": "neutra", "tipo_gemini": "bot"}], "nextCursor": None}
            linhas = ler_do_n8n(api)
            self.assertEqual([l["id"] for l in linhas], ["1", "2"])
            self.assertEqual({m for m, _ in chamadas}, {"GET"})

        def test_hash_e_chave(self):
            for n in ("27999887766", "+55 27 99988-7766", "(27) 9988-7766", "552799887766"):
                self.assertEqual(chave_do_numero(n), "2799887766")
            self.assertEqual(hash_do_lead("27999887766"), hashlib.sha256(b"squadone:jev-sombra:v1:2799887766").hexdigest())
            self.assertEqual(hash_do_lead("12345"), "")

        def test_trecho_de_iris_e_estampa(self):
            retrato = {"fontes": {
                "iris": {"linhas": [{"WhatsApp": "(27) 99988-7766", "Resposta em": "2026-10-14T10:00:00Z", "Resposta": "pode sim"}]},
                "estampa": {"linhas": [{"WhatsApp": "(11) 98888-7777", "Resposta em": "2026-10-14T11:00:00Z", "Resposta": "quem é?"}]}}}
            trechos = trechos_do_retrato(retrato)
            linhas = [linha(1, "interesse", "interesse", lead_hash=hash_do_lead("27999887766"), resposta_em="2026-10-14T10:00:00Z"),
                      linha(2, "neutra", "neutra", lead_hash=hash_do_lead("11988887777"), resposta_em="2026-10-14T11:00:00Z")]
            texto = para_revisar(linhas, trechos)
            self.assertIn('"pode sim"', texto)
            self.assertIn('"quem é?"', texto)
            self.assertNotIn("trecho fora do retrato", texto)

        def test_revisao_ordena_perigosas_divergentes_pouca_confianca_e_resto(self):
            texto = para_revisar([
                linha(1, "neutra", "neutra", jev_confidence=0.9),
                linha(2, "neutra", "neutra", jev_confidence=0.3),
                linha(3, "bot", "interesse", jev_confidence=0.6),
                linha(4, "bot", "interesse", jev_confidence=0.9),
                linha(5, "interesse", "negativa", jev_confidence=0.7),
                linha(6, "bot", "bot", "bot"),  # já revista: fora
            ], {})
            ordem = [int(m) for m in re.findall(r"  id (\d+) ", texto)]
            self.assertEqual(ordem, [5, 4, 3, 2, 1])
            self.assertLess(texto.index("1. Perigosas"), texto.index("2. Divergem"))
            self.assertLess(texto.index("2. Divergem"), texto.index("3. Concordam, mas"))
            self.assertLess(texto.index("3. Concordam, mas"), texto.index("4. Concordam com"))

        def test_revisao_avisa_lead_com_varias_linhas(self):
            texto = para_revisar([linha(1, "bot", "bot", lead_hash="mesmo"), linha(2, "bot", "neutra", lead_hash="mesmo"),
                                  linha(3, "bot", "bot", lead_hash="outro")], {})
            self.assertEqual(texto.count("lead com 2 linhas a revisar"), 2)

        def test_regra_conta_leads_e_nao_linhas(self):
            # 40 linhas revistas, mas só 20 leads: não chega a 60 nem a 40.
            linhas_ = [linha(i, "neutra", "neutra", "neutra", lead_hash=f"lead{i // 2}", resposta_em=f"2026-10-14T10:{i % 60:02d}:00Z")
                       for i in range(40)]
            self.assertEqual(resumir(linhas_)["revistas"], 20)
            # Do mesmo lead vale a linha mais recente: aqui a antiga discordava do humano, a nova concorda.
            antiga = linha(1, "bot", "neutra", "bot", lead_hash="L", resposta_em="2026-10-10T10:00:00Z")
            nova = linha(2, "bot", "bot", "bot", lead_hash="L", resposta_em="2026-10-14T10:00:00Z")
            r = resumir([antiga, nova])
            self.assertEqual((r["revistas"], r["jev_x_humano"]), (1, 1.0))
            # Interesse perdido numa linha antiga ainda barra, mesmo que a linha mais recente do lead esteja certa.
            perdida = linha("x", "interesse", "negativa", "interesse", lead_hash="L", resposta_em="2026-10-10T10:00:00Z")
            self.assertEqual(resumir([perdida, nova])["perigosos"], ["x"])

        def test_trecho_casa_hash_e_hora(self):
            retrato = {"fontes": {
                "site": {"linhas": [{"wa_me": "https://wa.me/5527999887766", "resposta_em": "2026-10-05T09:30:00-0300",
                                     "resposta_trecho": "pode mandar"}]},
                "prumo": {"linhas": [{"WhatsApp": "(11) 98888-7777", "Resposta em": "2026-10-05T12:40:00Z", "Resposta": "não"}]}}}
            trechos = trechos_do_retrato(retrato)
            linhas = [linha(1, "interesse", "interesse", lead_hash=hash_do_lead("27999887766"), resposta_em="2026-10-05T12:30:00.000Z"),
                      linha(2, "negativa", "negativa", lead_hash=hash_do_lead("11988887777"), resposta_em="2026-10-05T12:40:00Z", n_mensagens=3),
                      linha(3, "bot", "bot", lead_hash=hash_do_lead("11988887777"), resposta_em="2026-10-01T12:00:00Z"),
                      linha(4, "bot", "bot", "bot")]
            texto = para_revisar(linhas, trechos)
            self.assertIn('"pode mandar"', texto)
            self.assertIn('"não"', texto)
            self.assertIn("3 mensagens: o Jev viu só a última", texto)
            self.assertIn("trecho fora do retrato", texto)
            self.assertNotIn("id 4 ", texto)  # já revista
            self.assertNotIn("27999887766", texto)

    carga = unittest.TestLoader()
    suite = unittest.TestSuite(carga.loadTestsFromTestCase(c) for c in (Regra, Leitura))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(testar() if "--testar" in sys.argv else main(sys.argv[1:]))
