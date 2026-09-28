"""Migra a esteira Site antes da venda (Caçador e Balcão) do n8n do Easypanel
para o n8n do Dell. Idempotente: recria pelo nome.

- Sheets: credencial Google do Dell (lê a mesma planilha de leads).
- Places: chave do Dell. Gemini: credencial criada a partir de GOOGLE_API_KEY
  do Hermes, sem passar a chave por nenhum outro lugar.
- Drive saiu: o Caçador grava pacotes em /home/node/.n8n-files/auto-entrada e
  o auto-entrada do Dell cria as pastas em ~/auto-site (o espelho em G:\\Meu
  Drive\\auto, pelo PC, parou em 25/09/2026). O Balcão lê os publicado.json
  direto de ~/auto-site.
- Error Workflow: o aviso único pelo Hermes.

Estado em 23/09/2026: Caçador (oow8TkxrAf4fVvTj) e Balcão (wjuoIknp2qlWo0QI)
ativos no Dell; as versões do Easypanel e o "00 · Alerta" de lá foram
despublicados. A credencial "Google Gemini (Dell)" precisa de chave com cota
para busca no Google (grounding); a do Hermes não tem.

Uso: python3 site-antes-da-venda.py cacador-easypanel.json [--ativar]
"""
import copy
import json
import sys
from pathlib import Path

from n8n import api, put

PLANILHA = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o"
SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
PLACES = {"httpHeaderAuth": {"id": "v7aU1q4PRbTSOYZu", "name": "Google Maps API Key — PRUMO"}}
ENTRADA = "/home/node/.n8n-files/auto-entrada/"
AQUI = Path(__file__).resolve().parent


def erro_wf():
    return next(w["id"] for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == "00 · Avisar falha pelo Hermes")


def credencial_gemini():
    nome = "Google Gemini (Dell)"
    existentes = [c for c in api("GET", "/credentials?limit=100").get("data", []) if c["name"] == nome]
    if existentes:
        return {"googlePalmApi": {"id": existentes[0]["id"], "name": nome}}
    env = (Path.home() / ".hermes/.env").read_text().splitlines()
    chave = next(l.split("=", 1)[1].strip().strip('"') for l in env if l.startswith("GOOGLE_API_KEY="))
    c = api("POST", "/credentials", {"name": nome, "type": "googlePalmApi",
                                      "data": {"host": "https://generativelanguage.googleapis.com", "apiKey": chave}})
    return {"googlePalmApi": {"id": c["id"], "name": nome}}


def criar_ou_trocar(wf):
    existentes = [w for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == wf["name"]]
    if existentes:
        wf["id"] = existentes[0]["id"]
        put(wf)
        return wf["id"]
    return api("POST", "/workflows", wf)["id"]


def pacote_code(expr_caminho, expr_base64, extra=""):
    return "\n".join([
        "const saida = [];",
        "const itens = $input.all();",
        "for (let i = 0; i < itens.length; i++) {",
        "  const item = itens[i];",
        extra,
        f"  const pacote = {{ caminho: {expr_caminho}, base64: {expr_base64} }};",
        "  if (item.json.pastas) pacote.pastas = item.json.pastas;",
        "  const nome = String(pacote.caminho).replace(/[^a-zA-Z0-9._-]+/g, '_') + '.json';",
        "  saida.push({ json: { caminho: pacote.caminho, nome }, binary: { data: { data: Buffer.from(JSON.stringify(pacote), 'utf8').toString('base64'), mimeType: 'application/json', fileName: nome } } });",
        "}",
        "return saida;",
    ])


def gravar_na_entrada(nome, pos):
    return {"id": nome.lower().replace(" ", "-"), "name": nome, "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
            "position": pos, "parameters": {"operation": "write", "dataPropertyName": "data",
                                            "fileName": "={{ '" + ENTRADA + "' + $execution.id + '-' + $json.nome }}"}}


def cacador(fonte, gemini, erro):
    wf = json.loads(Path(fonte).read_text())["workflow"]
    sai = {"Criar pasta do lead", "ID da pasta", "Lead + pasta", "Criar subpasta Fotos", "ID de Fotos",
           "Criar subpasta Logotipo", "ID de Logotipo", "Lead + subpastas", "Escrever content.md", "Fila de fotos",
           "Uma foto por item", "Loop fotos", "Foto + destino", "Enviar foto para o Drive", "Pausa 1s"}
    nos = [copy.deepcopy(n) for n in wf["nodes"] if n["name"] not in sai]
    for n in nos:
        if n["type"] == "n8n-nodes-base.googleSheets":
            n["credentials"] = SHEETS
        elif n["type"].endswith(".googleGemini"):  # @n8n/n8n-nodes-langchain.googleGemini
            n["credentials"] = gemini
        elif (n.get("credentials") or {}).get("httpHeaderAuth"):
            n["credentials"] = PLACES
    baixar = next(n for n in nos if n["name"] == "Baixar foto (Places Media)")
    baixar["parameters"].setdefault("options", {})["batching"] = {"batch": {"batchSize": 1, "batchInterval": 1000}}
    baixar["onError"] = "continueRegularOutput"

    x, y = next(n for n in nos if n["name"] == "Lead salvo")["position"]
    content = {"id": "pacote-content", "name": "Pacote content.md", "type": "n8n-nodes-base.code", "typeVersion": 2,
               "position": [x + 240, y - 120], "parameters": {"mode": "runOnceForAllItems", "jsCode": pacote_code(
                   "item.json.slug + '/content.md'", "Buffer.from(String(item.json.content_md ?? ''), 'utf8').toString('base64')",
                   "  item.json.pastas = ['Fotos', 'Logotipo'];")}}
    fila = {"id": "fila-fotos", "name": "Fila de fotos", "type": "n8n-nodes-base.code", "typeVersion": 2,
            "position": [x + 240, y + 120], "parameters": {"mode": "runOnceForAllItems", "jsCode": "\n".join([
                "// Até 5 fotos do Google Places em Fotos/ e a primeira de novo como capa em Logotipo/.",
                "return $input.all().flatMap(item => {",
                "  const l = item.json;",
                "  const fotos = (l.fotos_places ?? []).filter(Boolean);",
                "  return fotos.map((foto, i) => ({ json: { foto, caminho: l.slug + '/Fotos/' + l.slug + '-foto-' + (i + 1) + '.jpg' } }))",
                "    .concat(fotos.slice(0, 1).map(foto => ({ json: { foto, caminho: l.slug + '/Logotipo/' + l.slug + '-capa.jpg' } })));",
                "});"])}}
    baixar["position"] = [x + 480, y + 120]
    foto = {"id": "pacote-foto", "name": "Pacote foto", "type": "n8n-nodes-base.code", "typeVersion": 2,
            "position": [x + 720, y + 120], "parameters": {"mode": "runOnceForAllItems", "jsCode": "\n".join([
                "// Foto que não baixou (onError contínuo) fica de fora; o resto segue.",
                "const fila = $('Fila de fotos').all();",
                "const saida = [];",
                "const itens = $input.all();",
                "for (let i = 0; i < itens.length; i++) {",
                "  if (!itens[i].binary?.data) continue;",
                "  const origem = fila[itens[i].pairedItem?.item ?? i]?.json ?? {};",
                "  const buf = await this.helpers.getBinaryDataBuffer(i, 'data');",
                "  const pacote = { caminho: origem.caminho, base64: buf.toString('base64') };",
                "  const nome = String(pacote.caminho).replace(/[^a-zA-Z0-9._-]+/g, '_') + '.json';",
                "  saida.push({ json: { caminho: pacote.caminho, nome }, binary: { data: { data: Buffer.from(JSON.stringify(pacote), 'utf8').toString('base64'), mimeType: 'application/json', fileName: nome } } });",
                "}",
                "return saida;"])}}
    g1 = gravar_na_entrada("Entregar content.md", [x + 480, y - 120])
    g2 = gravar_na_entrada("Entregar foto", [x + 960, y + 120])
    nos += [content, fila, foto, g1, g2]

    nomes = {n["name"] for n in nos}
    con = {}
    for de, tipos in wf["connections"].items():
        if de not in nomes:
            continue
        for tipo, saidas in tipos.items():
            con.setdefault(de, {})[tipo] = [[d for d in (s or []) if d["node"] in nomes] for s in saidas]
    ligar = lambda a, b: con.setdefault(a, {}).setdefault("main", [[]])[0].append({"node": b, "type": "main", "index": 0})
    con["Lead salvo"] = {"main": [[]]}
    ligar("Lead salvo", "Pacote content.md")
    ligar("Pacote content.md", "Entregar content.md")
    ligar("Lead salvo", "Fila de fotos")
    ligar("Fila de fotos", "Baixar foto (Places Media)")
    con["Baixar foto (Places Media)"] = {"main": [[]]}
    ligar("Baixar foto (Places Media)", "Pacote foto")
    ligar("Pacote foto", "Entregar foto")

    return {"name": "01 · Caçador", "nodes": nos, "connections": con,
            "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}


def balcao(erro):
    ler_planilha = {"resource": "sheet", "operation": "read",
                    "documentId": {"__rl": True, "mode": "id", "value": PLANILHA, "cachedResultName": "Leads — Site antes da venda"},
                    "sheetName": {"__rl": True, "mode": "id", "value": "396728619", "cachedResultName": "Leads"}}
    colunas = [{"id": c, "displayName": c, "required": False, "defaultMatch": c == "place_id", "display": True,
                "type": "string", "canBeUsedToMatch": c == "place_id"} for c in ("place_id", "status", "site_url", "vercel_project", "wa_me", "wa_link")]
    pendencias = "\n".join([
        "// O que depende do Rômulo nesta esteira. A Central lê este arquivo via dell-status.",
        "const linhas = $input.all().map(i => i.json);",
        "const planilha = 'https://docs.google.com/spreadsheets/d/" + PLANILHA + "/edit#gid=396728619';",
        "const conta = (f) => linhas.filter(f).length;",
        "const estado = { geradoEm: new Date().toISOString(), itens: [",
        "  { id: 'site-enviar', nome: 'Sites prontos para enviar', quantidade: conta(l => String(l.status).trim() === 'pronto'),",
        "    detalhe: 'Clique no wa_link do lead: abre o WhatsApp com a mensagem e marca como enviado.', link: planilha },",
        "  { id: 'site-resposta', nome: 'Enviados esperando resposta', quantidade: conta(l => String(l.status).trim() === 'enviado' && !l.respondeu_em),",
        "    detalhe: 'Quando o cliente responder, preencha respondeu_em.', link: planilha },",
        "] };",
        "return [{ json: estado, binary: { data: { data: Buffer.from(JSON.stringify(estado), 'utf8').toString('base64'), mimeType: 'application/json', fileName: 'site-antes-da-venda.json' } } }];",
    ])
    nos = [
        {"id": "hora", "name": "A cada hora", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
         "parameters": {"rule": {"interval": [{"field": "hours", "hoursInterval": 1, "triggerAtMinute": 10}]}}},
        {"id": "ler", "name": "Ler recibos da pasta auto", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1, "position": [220, 0],
         "parameters": {"operation": "read", "fileSelector": "/home/node/.n8n-files/auto/**/publicado.json", "options": {}}},
        {"id": "json", "name": "Ler o JSON do recibo", "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1.1, "position": [440, 0],
         "parameters": {"operation": "fromJson", "destinationKey": "recibo"}},
        {"id": "planilha", "name": "Ler a planilha", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [660, 0],
         "parameters": ler_planilha, "credentials": SHEETS, "executeOnce": True, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000},
        {"id": "cruzar", "name": "Cruzar recibos e montar abordagem", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [880, 0],
         "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": (AQUI / "balcao-cruzar.js").read_text(encoding="utf-8")}},
        {"id": "atualizar", "name": "Atualizar lead na planilha", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [1100, 0],
         "parameters": {**{k: v for k, v in ler_planilha.items() if k != "operation"}, "operation": "update",
                        "columns": {"mappingMode": "autoMapInputData", "matchingColumns": ["place_id"], "value": {}, "schema": colunas},
                        "options": {"cellFormat": "RAW", "handlingExtraData": "insertInNewColumn"}},
         "credentials": SHEETS, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000},
    ]
    ordem = [n["name"] for n in nos]
    con = {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(ordem, ordem[1:])}
    nos += [
        {"id": "pendencias", "name": "Pendências da esteira", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [880, 220], "parameters": {"mode": "runOnceForAllItems", "jsCode": pendencias}},
        {"id": "gravar-pendencias", "name": "Gravar pendências", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [1100, 220], "parameters": {"operation": "write", "dataPropertyName": "data",
                                                 "fileName": "/home/node/.n8n-files/estado/site-antes-da-venda.json"}},
    ]
    con["Ler a planilha"]["main"][0].append({"node": "Pendências da esteira", "type": "main", "index": 0})
    con["Pendências da esteira"] = {"main": [[{"node": "Gravar pendências", "type": "main", "index": 0}]]}
    return {"name": "03 · Balcão (Site antes da venda)", "nodes": nos, "connections": con,
            "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}


if __name__ == "__main__":
    erro = erro_wf()
    gemini = credencial_gemini()
    ids = {}
    for wf in (cacador(sys.argv[1], gemini, erro), balcao(erro)):
        ids[wf["name"]] = criar_ou_trocar(wf)
        print(wf["name"], "->", ids[wf["name"]], f"({len(wf['nodes'])} nós)")
    Path(AQUI / "site-antes-da-venda.ids.json").write_text(json.dumps(ids, ensure_ascii=False))
    if "--ativar" in sys.argv:
        for nome, i in ids.items():
            api("POST", f"/workflows/{i}/activate")
            print("ativo:", nome)
