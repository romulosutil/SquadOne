"""Ofertas do PRUMO além da consultoria: Iris (clínicas) e CRM de estamparia. 14/10/2026. Idempotente.

Pedido do Rômulo (14/10/2026): o PRUMO fica sob o SquadOne, e o Site antes da
venda, os serviços do PRUMO, o Iris e o CRM de estamparia ficam sob o PRUMO,
dividindo o mesmo funil no CRM da Central. Plano: docs/superpowers/plans/
2026-10-13-prumo-holding.md (Fluxo A = Iris, Fluxo B/B0 = estamparias).

Para cada oferta de prumo-ofertas.json:

- Aba na planilha do PRUMO (Clínicas, Estamparias) com o contrato de colunas do
  Prospects, Etapa com lista (Revisar -> Convite enviado -> Em conversa ->
  Concluído | Sem interesse) e as colunas técnicas ocultas. Descartes vão para a
  aba Descartados que já existe (Motivo começa pelo nome da oferta).
- "PRUMO · <oferta> — Caçador de ...": uma busca nicho × cidade por rodada
  (rodízio pelo dia), Google Places (New) com a chave do PRUMO, site da empresa
  lido para achar o WhatsApp publicado e os sinais do segmento, dedupe contra
  todos os funis do PRUMO (place_id e WhatsApp), até teto_por_rodada prospects
  por rodada e um aviso pelo Hermes com quantos entraram. NASCE DESLIGADO
  (princípio 5 do plano): roda à mão, confere a lista, só então liga o
  agendamento (dias úteis, 9h) no n8n.
- "PRUMO · <oferta> — Clique em Enviar convite (marca enviado)": GET
  /webhook/convite-<oferta>?id=<ID>, abre o WhatsApp com o convite da oferta e
  marca Etapa = Convite enviado (só a partir de Revisar). Ativo: só roda quando
  o Rômulo toca o link (Central ou planilha).

O CRM lê as abas pelo 08 · CRM (crm.py, rode depois deste) e mostra as ofertas
no mesmo funil (server/crm.ts, OFERTA_DE_PROSPECCAO).

Uso: python3 prumo-ofertas.py              abas + caçadores (desligados) + cliques
     python3 prumo-ofertas.py --rodar iris  roda o caçador agora (efeito real: grava na planilha e avisa)
     python3 prumo-ofertas.py --codigo      só imprime o código dos nós Code (para node --check)
"""
import importlib.util
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import quote

from n8n import aviso_nodes

AQUI = Path(__file__).resolve().parent
CONFIG = json.loads((AQUI / "prumo-ofertas.json").read_text(encoding="utf-8"))
TRIAR = (AQUI / "prumo-ofertas-triar.js").read_text(encoding="utf-8")

PLANILHA = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U"  # PRUMO — Fila de revisão
PROSPECTS_GID = "1838781376"
SITE, LEADS_GID = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o", "396728619"
SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
PLACES = {"httpHeaderAuth": {"id": "v7aU1q4PRbTSOYZu", "name": "Google Maps API Key — PRUMO"}}
WEBHOOK = "https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook"
CAMPOS_DO_PLACES = ("places.id,places.displayName,places.addressComponents,places.websiteUri,places.rating,places.userRatingCount,"
                    "places.googleMapsUri,places.primaryTypeDisplayName,places.businessStatus,nextPageToken")


def _modulo(nome, arquivo):
    spec = importlib.util.spec_from_file_location(nome, AQUI / arquivo)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ------------------------------------------------------------------ planilha

def planilha():
    """Cria as abas que faltam e aplica cabeçalho, lista da Etapa e colunas ocultas. Nunca mexe em linha."""
    from sheets_proxy import SheetsProxy
    colunas = CONFIG["colunas"]
    ultima = chr(ord("A") + len(colunas) - 1)
    with SheetsProxy([PLANILHA]) as s:
        abas = {a["properties"]["title"]: a["properties"] for a in
                s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets.properties")["sheets"]}
        faltam = [o["aba"] for o in CONFIG["ofertas"].values() if o["aba"] not in abas]
        if faltam:
            s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": [
                {"addSheet": {"properties": {"title": aba, "gridProperties": {"rowCount": 1000, "columnCount": len(colunas), "frozenRowCount": 1}}}}
                for aba in faltam]})
            abas = {a["properties"]["title"]: a["properties"] for a in
                    s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets.properties")["sheets"]}
        gids = {}
        for oferta, o in CONFIG["ofertas"].items():
            aba, gid = o["aba"], abas[o["aba"]]["sheetId"]
            gids[oferta] = gid
            cab = (s.get(f"/v4/spreadsheets/{PLANILHA}/values/" + quote(f"{aba}!1:1")).get("values") or [[]])[0]
            if cab and cab[:len(colunas)] != colunas:
                raise SystemExit(f"aba {aba} já tem outro cabeçalho: {cab}. Nada foi mudado.")
            if not cab:
                s.post(f"/v4/spreadsheets/{PLANILHA}/values:batchUpdate",
                       {"valueInputOption": "RAW", "data": [{"range": f"{aba}!A1:{ultima}1", "values": [colunas]}]})
            col = colunas.index
            cabecalho = {"backgroundColor": {"red": 0.08, "green": 0.25, "blue": 0.21}, "horizontalAlignment": "CENTER",
                         "verticalAlignment": "MIDDLE", "wrapStrategy": "WRAP",
                         "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 1, "green": 1, "blue": 1}}}
            req = [
                {"repeatCell": {"range": {"sheetId": gid, "startRowIndex": 0, "endRowIndex": 1}, "cell": {"userEnteredFormat": cabecalho},
                                "fields": "userEnteredFormat"}},
                {"updateSheetProperties": {"properties": {"sheetId": gid, "gridProperties": {"frozenRowCount": 1, "frozenColumnCount": 2}},
                                           "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"}},
                {"setDataValidation": {"range": {"sheetId": gid, "startRowIndex": 1, "endRowIndex": 1000,
                                                 "startColumnIndex": col("Etapa"), "endColumnIndex": col("Etapa") + 1},
                                       "rule": {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": e} for e in CONFIG["etapas"]]},
                                                "strict": True, "showCustomUi": True}}},
            ]
            for nome in CONFIG["ocultas"]:
                req.append({"updateDimensionProperties": {"range": {"sheetId": gid, "dimension": "COLUMNS", "startIndex": col(nome), "endIndex": col(nome) + 1},
                                                          "properties": {"hiddenByUser": True}, "fields": "hiddenByUser"}})
            for nome, px in {"Empresa": 260, "Segmento": 200, "Etapa": 160, "Sinais": 260, "Próxima ação": 320}.items():
                req.append({"updateDimensionProperties": {"range": {"sheetId": gid, "dimension": "COLUMNS", "startIndex": col(nome), "endIndex": col(nome) + 1},
                                                          "properties": {"pixelSize": px}, "fields": "pixelSize"}})
            s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": req})
            print(f"aba {aba}: pronta (gid {gid}){' — criada agora' if aba in faltam else ''}")
        descartados = abas.get("Descartados", {}).get("sheetId")
        if descartados is None:
            raise SystemExit("aba Descartados não existe na planilha do PRUMO (prumo-simples.py a cria).")
        return gids, descartados


# ------------------------------------------------------------------ nós

def doc(planilha_id, gid=None, aba=None):
    return {"documentId": {"__rl": True, "mode": "id", "value": planilha_id},
            "sheetName": ({"__rl": True, "mode": "id", "value": str(gid)} if gid is not None else {"__rl": True, "mode": "name", "value": aba})}


def ler(nome, planilha_id, pos, gid=None, aba=None, tolerante=True):
    """Leitura para o dedupe. A da própria oferta não é tolerante: sem ela o caçador gravaria repetidos."""
    no = {"id": re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFD", nome.lower()).encode("ascii", "ignore").decode()), "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
          "position": pos, "credentials": SHEETS, "executeOnce": True, "alwaysOutputData": True,
          "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
          "parameters": {"resource": "sheet", "operation": "read", **doc(planilha_id, gid, aba), "filtersUI": {"values": []}, "options": {}}}
    if tolerante:
        no["onError"] = "continueRegularOutput"
    return no


def anexar(no_id, nome, gid, colunas, pos):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": pos,
            "credentials": SHEETS, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
            "parameters": {"resource": "sheet", "operation": "append", **doc(PLANILHA, gid),
                           "columns": {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [],
                                       "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": False, "display": True,
                                                   "type": "string", "canBeUsedToMatch": True} for c in colunas]},
                           # RAW: nome de empresa que começa com "=" fica texto. ignoreIt: o _tipo não vira coluna.
                           "options": {"cellFormat": "RAW", "handlingExtraData": "ignoreIt", "useAppend": True}}}


def code(no_id, nome, js, pos):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos,
            "parameters": {"mode": "runOnceForAllItems", "jsCode": js}}


def liga(con, de, para, saida=0):
    main = con.setdefault(de, {}).setdefault("main", [])
    while len(main) <= saida:
        main.append([])
    main[saida].append({"node": para, "type": "main", "index": 0})


def escolher_js(o):
    buscas = [{"nicho": n, "cidade": c} for c in o["cidades"] for n in o["nichos"]]
    return "\n".join([
        "// Uma busca nicho × cidade por rodada, em rodízio pelo dia (hora de São Paulo). A ordem é a do",
        "// plano: as cidades do ES primeiro e, em cada cidade, os nichos na ordem do ICP.",
        "// Para mudar a lista: prumo-ofertas.json e `python3 prumo-ofertas.py`.",
        "const BUSCAS = " + json.dumps(buscas, ensure_ascii=False) + ";",
        "const dia = Math.floor((Date.now() - 3 * 3600e3) / 864e5);",
        "const b = BUSCAS[dia % BUSCAS.length];",
        "return [{ json: { ...b, query: b.nicho + ' em ' + b.cidade, indice: dia % BUSCAS.length, total: BUSCAS.length } }];",
    ])


def triar_js(oferta, o, leitores):
    cfg = {"rotulo": o["rotulo"], "plural": o["plural"], "segmento": o["segmento"], "fora": o["fora"], "clientes": CONFIG["clientes"], "sinais": o["sinais"],
           "teto_por_rodada": o["teto_por_rodada"], "proxima_revisar": CONFIG["proxima_revisar"], "leitores": leitores,
           "convite_url": f"{WEBHOOK}/{o['convite']}?id="}
    return TRIAR.replace("__CONFIG__", json.dumps(cfg, ensure_ascii=False))


def cacador(oferta, gids, descartados, erro):
    o = CONFIG["ofertas"][oferta]
    outras = [(k, v) for k, v in CONFIG["ofertas"].items() if k != oferta]
    leitura_propria = f"Ler {o['aba']}"
    leitores = [leitura_propria, *[f"Ler {v['aba']}" for _, v in outras], "Ler Descartados", "Ler Prospects", "Ler Leads do Site"]
    x = 440
    nos = [
        {"id": "manual", "name": "Executar manualmente", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, -100], "parameters": {}},
        {"id": "agenda", "name": "Dias úteis às 9h", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 100],
         "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 9 * * 1-5"}]}}},
        code("escolher", "Escolher a busca", escolher_js(o), [220, 0]),
        ler(leitura_propria, PLANILHA, [x, 0], gid=gids[oferta], tolerante=False),
    ]
    for k, v in outras:
        x += 220
        nos.append(ler(f"Ler {v['aba']}", PLANILHA, [x, 0], gid=gids[k]))
    for nome, planilha_id, gid in (("Ler Descartados", PLANILHA, descartados), ("Ler Prospects", PLANILHA, PROSPECTS_GID),
                                   ("Ler Leads do Site", SITE, LEADS_GID)):
        x += 220
        nos.append(ler(nome, planilha_id, [x, 0], gid=gid))
    x += 220
    nos += [
        {"id": "places", "name": "Buscar no Google Places", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, 0],
         "credentials": PLACES, "executeOnce": True, "retryOnFail": True, "maxTries": 2, "waitBetweenTries": 3000,
         "parameters": {
             "method": "POST", "url": "https://places.googleapis.com/v1/places:searchText",
             "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
             "sendHeaders": True, "specifyHeaders": "keypair",
             "headerParameters": {"parameters": [{"name": "X-Goog-FieldMask", "value": CAMPOS_DO_PLACES}]},
             "sendBody": True, "contentType": "json", "specifyBody": "json",
             "jsonBody": "={{ { \"textQuery\": $('Escolher a busca').first().json.query, \"languageCode\": \"pt-BR\", \"regionCode\": \"BR\", \"pageSize\": 20 } }}",
             "options": {"pagination": {"pagination": {
                 "paginationMode": "updateAParameterInEachRequest",
                 "parameters": {"parameters": [{"type": "body", "name": "pageToken", "value": "={{ $response.body.nextPageToken }}"}]},
                 "paginationCompleteWhen": "other", "completeExpression": "={{ !$response.body.nextPageToken }}",
                 "limitPagesFetched": True, "maxRequests": 3, "requestInterval": 1500}}}}},
        code("triar", "Triar e checar sites", triar_js(oferta, o, leitores), [x + 220, 0]),
        {"id": "e-prospect", "name": "É prospect?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [x + 440, 0],
         "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                                       "combinator": "and",
                                       "conditions": [{"id": "c", "leftValue": "={{ $json._tipo }}", "rightValue": "prospect",
                                                       "operator": {"type": "string", "operation": "equals"}}]}, "options": {}}},
        anexar("gravar-prospect", f"Gravar na aba {o['aba']}", gids[oferta], CONFIG["colunas"], [x + 660, -120]),
        anexar("gravar-descarte", "Gravar em Descartados", descartados, ["ID", "Empresa", "Cidade", "Segmento", "Motivo", "Encontrado em"], [x + 660, 120]),
    ]
    texto = ("itens.length ? " + json.dumps(f"Caçador ({o['rotulo']}): ", ensure_ascii=False)
             + " + itens.length + (itens.length === 1 ? ' empresa nova' : ' empresas novas') + ' para revisar ('"
             + " + $('Escolher a busca').first().json.query + ').' + NL"
             + " + 'Na Central: CRM do PRUMO, Hoje, Prospects para revisar. Nada foi enviado a ninguém.' : ''")
    am, ag = aviso_nodes("Aviso", x + 880, -120, texto, "📊 PRUMO", agregado=True)
    nos += [am, ag]
    con = {}
    liga(con, "Executar manualmente", "Escolher a busca")
    liga(con, "Dias úteis às 9h", "Escolher a busca")
    cadeia = ["Escolher a busca", *leitores, "Buscar no Google Places", "Triar e checar sites", "É prospect?"]
    for a, b in zip(cadeia, cadeia[1:]):
        liga(con, a, b)
    liga(con, "É prospect?", f"Gravar na aba {o['aba']}", 0)
    liga(con, "É prospect?", "Gravar em Descartados", 1)
    liga(con, f"Gravar na aba {o['aba']}", am["name"])
    liga(con, am["name"], ag["name"])
    return {"name": o["fluxo"], "nodes": nos, "connections": con,
            "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}


def decidir_js(o, gid):
    return "\n".join([
        f"// Clique em Enviar convite ({o['rotulo']}): abre o WhatsApp com o convite e marca a linha.",
        "// Texto em prumo-ofertas.json: voz PRUMO, sem nome, sem R$, sem link, uma pergunta.",
        f"const q = $('Clique ({o['convite']})').first().json.query ?? {{}};",
        "const id = String(q.id ?? '');",
        "const l = $input.first()?.json ?? {};",
        "const achou = id !== '' && String(l['ID'] ?? '') === id;",
        "let nome = String(l['Empresa'] ?? '').trim();",
        "for (let i = 0; i < 2; i++) nome = nome.replace(/[\\s,.-]+(ltda|me|epp|eireli|s\\.?\\/?a\\.?)\\.?$/i, '').trim();",
        "// Nome todo em maiúsculas denuncia mensagem automática.",
        "if (nome === nome.toUpperCase() && /\\p{Lu}{4}/u.test(nome)) nome = nome.toLowerCase()",
        "  .replace(/(^|\\s)(\\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/ (D[aeo]s?|E|Para|Em) /g, (m) => m.toLowerCase());",
        "const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }));",
        "const ola = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';",
        "const mensagem = " + json.dumps(o["mensagem"], ensure_ascii=False)
        + ".replace('{OLA}', ola).replace('{NOME}', nome || " + json.dumps(o["empresa"], ensure_ascii=False) + ");",
        "let digitos = String(l['WhatsApp'] ?? '').replace(/\\D/g, '');",
        "if (digitos.length === 10 || digitos.length === 11) digitos = '55' + digitos;",
        "// Sem a linha ou sem celular: abre a aba, para decidir à mão.",
        "const planilha = " + json.dumps(f"https://docs.google.com/spreadsheets/d/{PLANILHA}/edit#gid={gid}") + ";",
        "const destino = achou && digitos.length >= 12 && digitos.length <= 13 ? 'https://wa.me/' + digitos + '?text=' + encodeURIComponent(mensagem) : planilha;",
        "return [{ json: { chave: id, destino, marcar: achou && destino !== planilha && String(l['Etapa'] ?? '').trim() === 'Revisar', agora: new Date().toISOString() } }];",
    ])


def clique(oferta, gids):
    o = CONFIG["ofertas"][oferta]
    fc = _modulo("fecha_ciclos", "fecha-ciclos.py")
    fc.webhook_workflow(o["clique"], o["convite"], o["webhook_id"], PLANILHA, str(gids[oferta]), o["aba"], "ID", "id", decidir_js(o, gids[oferta]),
                        {"Etapa": "Convite enviado", "Convite enviado em": "={{ $json.agora }}", "Próxima ação": o["proxima_enviado"]})


# ------------------------------------------------------------------ publicar e rodar

def publicar_cacador(wf):
    """Cria ou troca pelo nome, SEM ativar: ligar o agendamento é decisão do Rômulo depois da rodada manual."""
    from n8n import api, put
    existentes = [w for w in api("GET", "/workflows?limit=250")["data"] if w["name"] == wf["name"]]
    if existentes:
        wf["id"] = existentes[0]["id"]
        put(wf)
        wid, ativo = wf["id"], existentes[0]["active"]
    else:
        wid, ativo = api("POST", "/workflows", wf)["id"], False
    print(f"{wf['name']} -> {wid} ({len(wf['nodes'])} nós, {'ATIVO (já estava)' if ativo else 'desligado'})")
    return wid


def ids_dos_cacadores():
    from n8n import api
    nomes = {o["fluxo"]: k for k, o in CONFIG["ofertas"].items()}
    return {nomes[w["name"]]: w["id"] for w in api("GET", "/workflows?limit=250")["data"] if w["name"] in nomes}


if __name__ == "__main__":
    if "--codigo" in sys.argv:
        o = CONFIG["ofertas"]["iris"]
        print(triar_js("iris", o, ["Ler Clínicas"]))
        print(escolher_js(o))
        print(decidir_js(o, 0))
        sys.exit(0)
    if "--rodar" in sys.argv:
        oferta = sys.argv[sys.argv.index("--rodar") + 1]
        wid = ids_dos_cacadores().get(oferta) or sys.exit(f"caçador de {oferta} não publicado: rode sem --rodar antes.")
        sys.exit(0 if _modulo("rodar_agora", "rodar-agora.py").main(wid) else 1)
    from n8n import api
    erro = next(w["id"] for w in api("GET", "/workflows?limit=250")["data"] if w["name"] == "00 · Avisar falha pelo Hermes")
    gids, descartados = planilha()
    for oferta in CONFIG["ofertas"]:
        publicar_cacador(cacador(oferta, gids, descartados, erro))
        clique(oferta, gids)
    print("Agora: python3 crm.py (o 08 · CRM passa a ler as abas novas).")
