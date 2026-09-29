"""Acabamento da aba Prospects (idempotente) e dedupe por WhatsApp no Lead Scout.

- Formatação das linhas de dados, congelamento, validação e cores da Etapa
  refeitas do zero (o append da API tinha herdado o estilo do cabeçalho).
- Cadastros duplicados no Google (mesmo WhatsApp) saem dos Prospects para os
  Descartados.
- "Enviar convite" vira link com texto (HYPERLINK com ";", planilha pt_BR).
- Lead Scout: descarta prospect com WhatsApp já visto e grava o link com texto.
"""
import re
from urllib.parse import quote

from n8n import api, put
from sheets_proxy import SheetsProxy

PLANILHA = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U"
PID, DID = 1838781376, 1418162405
LEAD_SCOUT = "e02c6f43-17ce-430b-9238-0b997a7656ce"
CONVITE_URL = "https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook/convite?id="  # tailnet desde 29/09/2026: abre no celular
ETAPA_COL = 7
CORES = {"Revisar": (1, 0.95, 0.65), "Convite enviado": (0.8, 0.88, 1), "Diagnóstico pronto": (0.73, 0.96, 0.8),
         "Concluído": (0.85, 0.85, 0.85), "Sem interesse": (0.95, 0.85, 0.85)}


def link(cid):
    return f'=HYPERLINK("{CONVITE_URL}{quote(cid, safe="")}";"Enviar convite ↗")'


def digitos(w):
    d = re.sub(r"\D", "", str(w or ""))
    return d[2:] if d.startswith("55") and len(d) in (12, 13) else d


def planilha():
    with SheetsProxy([PLANILHA]) as s:
        v = s.get(f"/v4/spreadsheets/{PLANILHA}/values/" + quote("Prospects!A1:P1000") + "?valueRenderOption=FORMULA").get("values", [])
        cab, linhas = v[0], [l + [""] * (16 - len(l)) for l in v[1:] if any(l)]
        vistos, mantidas, duplicadas = {}, [], []
        for l in linhas:
            w = digitos(l[cab.index("WhatsApp")])
            if w and w in vistos:
                duplicadas.append([l[0], l[1], l[2], l[3], f"Cadastro duplicado no Google (mesmo WhatsApp de {vistos[w]})", l[13]])
                continue
            if w:
                vistos[w] = l[1]
            l[cab.index("Enviar convite")] = link(l[0])
            mantidas.append(l)
        d = s.get(f"/v4/spreadsheets/{PLANILHA}/values/" + quote("Descartados!A1:A3000")).get("values", [])
        prox = len([x for x in d if any(x)]) + 1
        s.post(f"/v4/spreadsheets/{PLANILHA}/values:batchClear", {"ranges": ["Prospects!A2:P1000"]})
        dados = [{"range": f"Prospects!A2:P{1 + len(mantidas)}", "values": mantidas}]
        if duplicadas:
            dados.append({"range": f"Descartados!A{prox}:F{prox + len(duplicadas) - 1}", "values": duplicadas})
        s.post(f"/v4/spreadsheets/{PLANILHA}/values:batchUpdate", {"valueInputOption": "USER_ENTERED", "data": dados})

        regras = next(a for a in s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets(properties.sheetId,conditionalFormats)")["sheets"]
                      if a["properties"]["sheetId"] == PID).get("conditionalFormats", [])
        faixa = lambda c0, c1: {"sheetId": PID, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": c0, "endColumnIndex": c1}
        req = [{"deleteConditionalFormatRule": {"sheetId": PID, "index": 0}} for _ in regras]
        req += [
            {"repeatCell": {"range": faixa(0, 16), "cell": {"userEnteredFormat": {
                "backgroundColor": {"red": 1, "green": 1, "blue": 1}, "horizontalAlignment": "LEFT", "verticalAlignment": "MIDDLE",
                "wrapStrategy": "CLIP", "textFormat": {"bold": False, "fontSize": 10, "foregroundColor": {"red": 0.1, "green": 0.1, "blue": 0.1}}}},
                "fields": "userEnteredFormat"}},
            {"updateSheetProperties": {"properties": {"sheetId": PID, "gridProperties": {"frozenRowCount": 1, "frozenColumnCount": 2}},
                                       "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"}},
            {"updateDimensionProperties": {"range": {"sheetId": PID, "dimension": "ROWS", "startIndex": 1, "endIndex": 1000},
                                           "properties": {"pixelSize": 28}, "fields": "pixelSize"}},
            {"setDataValidation": {"range": faixa(ETAPA_COL, ETAPA_COL + 1), "rule": {
                "condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": e} for e in CORES]}, "strict": True, "showCustomUi": True}}},
        ]
        for etapa, (r, g, b) in CORES.items():
            req.append({"addConditionalFormatRule": {"index": 0, "rule": {"ranges": [faixa(ETAPA_COL, ETAPA_COL + 1)], "booleanRule": {
                "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": etapa}]},
                "format": {"backgroundColor": {"red": r, "green": g, "blue": b}}}}}})
        s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": req})
        print(f"Prospects: {len(mantidas)} mantidos, {len(duplicadas)} duplicados movidos para Descartados")


def lead_scout():
    wf = api("GET", f"/workflows/{LEAD_SCOUT}")
    por = {n["name"]: n for n in wf["nodes"]}
    lp = por["Linha de prospect"]["parameters"]
    lp["jsCode"] = re.sub(r"'Enviar convite': [^\n]*?,\n",
                          "'Enviar convite': '=HYPERLINK(\"" + CONVITE_URL + "' + encodeURIComponent(l.company_id) + '\";\"Enviar convite ↗\")',\n",
                          lp["jsCode"]).replace("  'Índice PRUMO'", "  'Índice PRUMO'")
    if "'Etapa': 'Revisar', 'Enviar convite'" in lp["jsCode"]:
        lp["jsCode"] = lp["jsCode"].replace(
            "'Etapa': 'Revisar', 'Enviar convite': '" + CONVITE_URL + "' + encodeURIComponent(l.company_id),",
            "'Etapa': 'Revisar',\n  'Enviar convite': '=HYPERLINK(\"" + CONVITE_URL + "' + encodeURIComponent(l.company_id) + '\";\"Enviar convite ↗\")',")
    por["Gravar prospect"]["parameters"]["options"]["cellFormat"] = "USER_ENTERED"

    if "Remover duplicados" not in por:
        x, y = por["Pontuar para revisão humana"]["position"]
        wf["nodes"].append({"id": "remover-duplicados", "name": "Remover duplicados", "type": "n8n-nodes-base.code", "typeVersion": 2,
                            "position": [x + 110, y - 200], "parameters": {"mode": "runOnceForAllItems", "jsCode": "\n".join([
            "// O Google tem cadastros repetidos da mesma loja (mesmo WhatsApp): só o primeiro vira prospect.",
            "const so = (w) => { let d = String(w ?? '').replace(/\\D/g, ''); if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2); return d; };",
            "const vistos = new Map($('Ler empresas já registradas').all().map(i => [so(i.json['WhatsApp']), i.json['Empresa']]).filter(([w]) => w));",
            "return $input.all().map(({ json: l }) => {",
            "  const w = so(l.whatsapp_number);",
            "  if (l.status !== 'REVIEW' || !w) return { json: l };",
            "  if (vistos.has(w)) return { json: { ...l, status: 'DESCARTAR', research_note: 'Cadastro duplicado no Google (mesmo WhatsApp de ' + vistos.get(w) + ')' } };",
            "  vistos.set(w, l.company_name);",
            "  return { json: l };",
            "});"])}})
        wf["connections"]["Pontuar para revisão humana"] = {"main": [[{"node": "Remover duplicados", "type": "main", "index": 0}]]}
        wf["connections"]["Remover duplicados"] = {"main": [[{"node": "É prospect?", "type": "main", "index": 0}]]}
    put(wf)
    api("POST", f"/workflows/{LEAD_SCOUT}/activate")
    novo = next(n for n in api("GET", f"/workflows/{LEAD_SCOUT}")["nodes"] if n["name"] == "Linha de prospect")["parameters"]["jsCode"]
    print("Lead Scout: dedupe por WhatsApp; link com texto:", "HYPERLINK" in novo)


if __name__ == "__main__":
    planilha()
    lead_scout()
