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
# Telefone desde 14/10/2026: sem ele, quem não tem site perdia o único contato (e o celular do Google
# é o WhatsApp "não confirmado" de quem não publica link nenhum).
CAMPOS_DO_PLACES = ("places.id,places.displayName,places.addressComponents,places.websiteUri,places.rating,places.userRatingCount,"
                    "places.googleMapsUri,places.primaryTypeDisplayName,places.businessStatus,places.nationalPhoneNumber,"
                    "places.internationalPhoneNumber,nextPageToken")


def _letra(n):
    """Letra da coluna n (1 = A, 27 = AA)."""
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def garantir_cabecalho(s, aba, propriedades, colunas):
    """Cabeçalho vazio: grava. Cabeçalho que é começo do contrato: acrescenta o que falta no fim (colunas
    novas entram sempre no fim). Qualquer outro: para sem mudar nada. Alarga a grade se precisar."""
    cab = (s.get(f"/v4/spreadsheets/{PLANILHA}/values/" + quote(f"{aba}!1:1")).get("values") or [[]])[0]
    if cab and cab != colunas[:len(cab)]:
        raise SystemExit(f"aba {aba} tem outro cabeçalho: {cab}. Nada foi mudado.")
    if len(cab) >= len(colunas):
        return False
    falta = len(colunas) - propriedades.get("gridProperties", {}).get("columnCount", 0)
    if falta > 0:
        s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": [{"appendDimension": {
            "sheetId": propriedades["sheetId"], "dimension": "COLUMNS", "length": falta}}]})
    s.post(f"/v4/spreadsheets/{PLANILHA}/values:batchUpdate", {"valueInputOption": "RAW", "data": [
        {"range": f"{aba}!{_letra(len(cab) + 1)}1:{_letra(len(colunas))}1", "values": [colunas[len(cab):]]}]})
    print(f"aba {aba}: cabeçalho {'gravado' if not cab else 'completado com ' + ', '.join(colunas[len(cab):])}")
    return True


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
            garantir_cabecalho(s, aba, abas[aba], colunas)
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
        if "Descartados" not in abas:
            raise SystemExit("aba Descartados não existe na planilha do PRUMO (prumo-simples.py a cria).")
        # Descartados ganhou site, telefone, Maps, tipo e busca (14/10/2026): sem eles não dava para resgatar ninguém.
        garantir_cabecalho(s, "Descartados", abas["Descartados"], CONFIG["descartados"])
        return gids, abas["Descartados"]["sheetId"]


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


def buscas_de(o):
    """Nicho × cidade, o nicho na frente: o melhor nicho passa por todas as cidades antes do segundo."""
    return [{"nicho": n, "cidade": c, "query": f"{n} em {c}"} for n in o["nichos"] for c in o["cidades"]]


def escolher_js(o, leitura_propria):
    return "\n".join([
        "// A busca da vez é a usada há mais tempo (14/10/2026): o rodízio pelo dia repetia a mesma busca",
        "// numa segunda rodada à mão no mesmo dia, e a ordem errada punha a melhor busca do Iris por último.",
        "// Quando cada busca rodou sai da coluna Busca da aba e de Descartados (Encontrado em); nunca rodou",
        "// vem primeiro, na ordem de prumo-ofertas.json (nicho na frente). Para mudar: o JSON e republicar.",
        "const BUSCAS = " + json.dumps(buscas_de(o), ensure_ascii=False) + ";",
        "const ROTULO = " + json.dumps(o["rotulo"] + ":", ensure_ascii=False) + ";",
        "const ultima = new Map();",
        "const ler = (no) => { try { return $(no).all().map((i) => i.json ?? {}); } catch (e) { return []; } };",
        f"for (const l of [...ler({json.dumps(leitura_propria, ensure_ascii=False)}), ...ler('Ler Descartados').filter((d) => String(d['Motivo'] ?? '').startsWith(ROTULO))]) {{",
        "  const q = String(l['Busca'] ?? '').trim();",
        "  const t = Date.parse(l['Encontrado em'] ?? '');",
        "  if (q && Number.isFinite(t)) ultima.set(q, Math.max(ultima.get(q) ?? 0, t));",
        "}",
        "let b = BUSCAS[0];",
        "for (const x of BUSCAS) if ((ultima.get(x.query) ?? -1) < (ultima.get(b.query) ?? -1)) b = x;",
        "return [{ json: { ...b, rodadas: ultima.size, total: BUSCAS.length } }];",
    ])


def triar_js(oferta, o, leitores):
    cfg = {"rotulo": o["rotulo"], "plural": o["plural"], "segmento": o["segmento"], "fora": o["fora"], "clientes": CONFIG["clientes"], "sinais": o["sinais"],
           "perfil": o["perfil"], "perfil_motivo": o["perfil_motivo"], "fora_sem_perfil": o["fora_sem_perfil"],
           "fora_sem_perfil_motivo": o["fora_sem_perfil_motivo"], "solo": o.get("solo", ""), "instituicao": o.get("instituicao", ""),
           "teto_por_rodada": o["teto_por_rodada"], "proxima_revisar": CONFIG["proxima_revisar"], "leitores": leitores,
           "convite_url": f"{WEBHOOK}/{o['convite']}?id="}
    return TRIAR.replace("__CONFIG__", json.dumps(cfg, ensure_ascii=False))


def cacador(oferta, gids, descartados, erro, busca_fixa=None):
    """O fluxo do caçador. `busca_fixa` (só para --rodar/--reavaliar, numa cópia temporária) troca o rodízio por uma busca."""
    o = CONFIG["ofertas"][oferta]
    outras = [(k, v) for k, v in CONFIG["ofertas"].items() if k != oferta]
    leitura_propria = f"Ler {o['aba']}"
    leitores = [leitura_propria, *[f"Ler {v['aba']}" for _, v in outras], "Ler Descartados", "Ler Prospects", "Ler Leads do Site"]
    escolher = escolher_js(o, leitura_propria) if not busca_fixa else (
        "return [{ json: " + json.dumps({"nicho": busca_fixa.split(" em ")[0], "cidade": busca_fixa.split(" em ")[-1],
                                         "query": busca_fixa}, ensure_ascii=False) + " }];")
    x = 220
    nos = [
        {"id": "manual", "name": "Executar manualmente", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, -100], "parameters": {}},
        {"id": "agenda", "name": "Dias úteis às 9h", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 100],
         "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 9 * * 1-5"}]}}},
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
    # Depois das leituras: a escolha da busca olha quando cada uma rodou (coluna Busca).
    nos.append(code("escolher", "Escolher a busca", escolher, [x, 0]))
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
        anexar("gravar-descarte", "Gravar em Descartados", descartados, CONFIG["descartados"], [x + 660, 120]),
    ]
    # O aviso conta também o que ficou para a próxima vez que a busca rodar (site fora do ar, teto da rodada).
    texto = ("itens.length ? " + json.dumps(f"Caçador ({o['rotulo']}): ", ensure_ascii=False)
             + " + itens.length + (itens.length === 1 ? ' empresa nova' : ' empresas novas') + ' para revisar ('"
             + " + $('Escolher a busca').first().json.query + ').'"
             + " + (() => { const r = $('Triar e checar sites').first().json; const f = [];"
             + " if (r._cortados) f.push(r._cortados + ' passaram do teto da rodada');"
             + " if (r._adiados) f.push(r._adiados + ' com site fora do ar agora');"
             + " return f.length ? ' Ficaram para a próxima vez desta busca: ' + f.join(' e ') + '.' : ''; })() + NL"
             + " + 'Na Central: CRM do PRUMO, Hoje, Prospects para revisar. Nada foi enviado a ninguém.' : ''")
    am, ag = aviso_nodes("Aviso", x + 880, -120, texto, "📊 PRUMO", agregado=True)
    nos += [am, ag]
    con = {}
    liga(con, "Executar manualmente", leitura_propria)
    liga(con, "Dias úteis às 9h", leitura_propria)
    cadeia = [*leitores, "Escolher a busca", "Buscar no Google Places", "Triar e checar sites", "É prospect?"]
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


def rodar_busca(oferta, busca, gids, descartados, erro):
    """Roda o caçador numa busca escolhida, numa cópia temporária (o publicado não muda). Efeito real."""
    from n8n import api
    wf = cacador(oferta, gids, descartados, erro, busca_fixa=busca)
    t = api("POST", "/workflows", {"name": f"ZZ busca escolhida: {wf['name']} (apagar)", "nodes": wf["nodes"],
                                   "connections": wf["connections"], "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo"}})
    try:
        return _modulo("rodar_agora", "rodar-agora.py").main(t["id"])
    finally:
        api("DELETE", f"/workflows/{t['id']}")


def tirar_para_reavaliar(oferta, desde):
    """Tira da aba da oferta o que ainda está em Revisar, sem convite, achado a partir de `desde`
    (AAAA-MM-DD), e de Descartados os descartes da oferta desde então: a próxima rodada decide de novo,
    com as regras atuais. Linha com convite enviado ou Etapa mudada à mão nunca sai."""
    from sheets_proxy import SheetsProxy
    o = CONFIG["ofertas"][oferta]
    with SheetsProxy([PLANILHA]) as s:
        abas = {a["properties"]["title"]: a["properties"]["sheetId"] for a in s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets.properties")["sheets"]}
        for aba, sai in ((o["aba"], lambda d: d.get("Etapa") == "Revisar" and not d.get("Convite enviado em")),
                         ("Descartados", lambda d: str(d.get("Motivo", "")).startswith(o["rotulo"] + ":"))):
            v = s.get(f"/v4/spreadsheets/{PLANILHA}/values/" + quote(f"{aba}!A1:Z3000")).get("values", [])
            cab = v[0] if v else []
            linhas = [(i, dict(zip(cab, l + [""] * (len(cab) - len(l))))) for i, l in enumerate(v[1:], start=1)]
            fora = [(i, d) for i, d in linhas if str(d.get("Encontrado em", ""))[:10] >= desde and sai(d)]
            # Um pedido só, de baixo para cima (o índice de cima não muda): uma escrita por linha estourou a
            # cota de escritas por minuto do Sheets em 14/10/2026.
            if fora:
                s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": [{"deleteDimension": {"range": {
                    "sheetId": abas[aba], "dimension": "ROWS", "startIndex": i, "endIndex": i + 1}}}
                    for i, _ in sorted(fora, key=lambda x: -x[0])]})
            print(f"{aba}: {len(fora)} linha(s) de {o['rotulo']} desde {desde} tiradas para reavaliar")


if __name__ == "__main__":
    if "--codigo" in sys.argv:
        o = CONFIG["ofertas"]["iris"]
        print(triar_js("iris", o, ["Ler Clínicas"]))
        print(escolher_js(o, "Ler Clínicas"))
        print(decidir_js(o, 0))
        sys.exit(0)
    if "--rodar" in sys.argv and "--busca" not in sys.argv:
        oferta = sys.argv[sys.argv.index("--rodar") + 1]
        wid = ids_dos_cacadores().get(oferta) or sys.exit(f"caçador de {oferta} não publicado: rode sem --rodar antes.")
        sys.exit(0 if _modulo("rodar_agora", "rodar-agora.py").main(wid) else 1)
    from n8n import api
    erro = next(w["id"] for w in api("GET", "/workflows?limit=250")["data"] if w["name"] == "00 · Avisar falha pelo Hermes")
    if "--rodar" in sys.argv or "--reavaliar" in sys.argv:
        # --rodar <oferta> --busca "<nicho> em <cidade>": uma busca escolhida, numa cópia temporária.
        # --reavaliar <oferta> AAAA-MM-DD "<busca>" ["<busca>"...]: tira o que ainda está em Revisar e os
        # descartes desde a data, e roda essas buscas de novo com as regras atuais.
        gids, descartados = planilha()
        if "--reavaliar" in sys.argv:
            i = sys.argv.index("--reavaliar")
            oferta, desde, buscas = sys.argv[i + 1], sys.argv[i + 2], sys.argv[i + 3:]
            tirar_para_reavaliar(oferta, desde)
        else:
            oferta, buscas = sys.argv[sys.argv.index("--rodar") + 1], [sys.argv[sys.argv.index("--busca") + 1]]
        ok = True
        for busca in buscas:
            print("==", oferta, "·", busca)
            ok = rodar_busca(oferta, busca, gids, descartados, erro) and ok
        sys.exit(0 if ok else 1)
    gids, descartados = planilha()
    for oferta in CONFIG["ofertas"]:
        publicar_cacador(cacador(oferta, gids, descartados, erro))
        clique(oferta, gids)
    print("Agora: python3 crm.py (o 08 · CRM passa a ler as abas novas).")
