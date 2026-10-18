"""PRUMO simples (decisão do Rômulo, 23/09/2026). Idempotente.

- Planilha: aba "Prospects" é a única que o Rômulo usa (11 colunas visíveis e
  uma coluna Etapa: Revisar -> Convite enviado -> Diagnóstico pronto ->
  Concluído | Sem interesse). "Descartados" guarda quem não serve só para a
  automação não reavaliar; ela e a antiga "Leads" ficam ocultas.
- Diagnóstico só com o dono: o link do formulário já vem com a empresa e o
  papel "Dono"; uma resposta completa fecha o diagnóstico.
- Lead Scout grava prospect com o convite pronto (link rastreado) e descarte
  na aba oculta. A sincronização de aceites deixa de existir.
- Clique em "Enviar convite": Etapa -> Convite enviado e abre o WhatsApp.
- Pontuação (de hora em hora): diagnóstico pronto -> Índice + Briefing na
  linha e aviso pelo Hermes; também grava as pendências para a Central.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

from n8n import api, aviso_nodes, put
from sheets_proxy import SheetsProxy

AQUI = Path(__file__).resolve().parent
PLANILHA = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U"
RESPOSTAS = "17YaTuRFLSWyhRCcEE1LL4qSP81OLQHtZPV-jLO-xZXE"
RESPOSTAS_GID = "1819422736"
LEADS_ANTIGA = 957714022
FORM = "https://docs.google.com/forms/d/e/1FAIpQLScknF_YOBUHrX94tfgykv37NaEryAzqzIdc55Hel8RX1wp2Sg/viewform"
ENTRY_EMPRESA, ENTRY_PAPEL = "171063854", "1936869861"
SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
LEAD_SCOUT = "e02c6f43-17ce-430b-9238-0b997a7656ce"
PONTUACAO = "b091d18b-106b-4f4d-ad4e-f77cdeaa7a5f"
CONVITE_URL = "https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook/convite?id="  # tailnet desde 29/09/2026: abre no celular

PROSPECTS = ["ID", "Empresa", "Cidade", "Segmento", "WhatsApp", "Site", "Nota Google", "Etapa", "Enviar convite",
             "Índice PRUMO", "Próxima ação", "Briefing", "Google Maps", "Encontrado em", "Convite enviado em", "Diagnóstico em"]
DESCARTADOS = ["ID", "Empresa", "Cidade", "Segmento", "Motivo", "Encontrado em"]
ETAPAS = ["Revisar", "Convite enviado", "Diagnóstico pronto", "Concluído", "Sem interesse"]
LARGURAS = {"Empresa": 280, "Cidade": 150, "Segmento": 220, "WhatsApp": 140, "Site": 220, "Nota Google": 110,
            "Etapa": 170, "Enviar convite": 150, "Índice PRUMO": 110, "Próxima ação": 330, "Briefing": 380}
OCULTAS = ["ID", "Google Maps", "Encontrado em", "Convite enviado em", "Diagnóstico em"]
PROXIMA_REVISAR = "Veja o site; se fizer sentido, clique em Enviar convite."


def formatar_whatsapp(bruto):
    d = re.sub(r"\D", "", str(bruto or ""))
    if d.startswith("55") and len(d) in (12, 13):
        d = d[2:]
    if len(d) == 11:
        return f"({d[:2]}) {d[2:7]}-{d[7:]}"
    if len(d) == 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    return d


# ------------------------------------------------------------------ planilha

def planilha():
    with SheetsProxy([PLANILHA]) as s:
        abas = {a["properties"]["title"]: a["properties"] for a in
                s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets.properties")["sheets"]}
        novas = []
        if "Prospects" not in abas:
            novas.append({"addSheet": {"properties": {"title": "Prospects", "index": 0,
                                                      "gridProperties": {"rowCount": 1000, "columnCount": len(PROSPECTS), "frozenRowCount": 1}}}})
        if "Descartados" not in abas:
            novas.append({"addSheet": {"properties": {"title": "Descartados",
                                                      "gridProperties": {"rowCount": 2000, "columnCount": len(DESCARTADOS), "frozenRowCount": 1}}}})
        if novas:
            s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": novas})
            abas = {a["properties"]["title"]: a["properties"] for a in
                    s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets.properties")["sheets"]}
        pid, did = abas["Prospects"]["sheetId"], abas["Descartados"]["sheetId"]

        s.post(f"/v4/spreadsheets/{PLANILHA}/values:batchUpdate", {"valueInputOption": "RAW", "data": [
            {"range": "Prospects!A1:P1", "values": [PROSPECTS]}, {"range": "Descartados!A1:F1", "values": [DESCARTADOS]}]})

        cabecalho = {"backgroundColor": {"red": 0.08, "green": 0.25, "blue": 0.21}, "horizontalAlignment": "CENTER",
                     "verticalAlignment": "MIDDLE", "wrapStrategy": "WRAP",
                     "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 1, "green": 1, "blue": 1}}}
        col = PROSPECTS.index
        req = [
            {"repeatCell": {"range": {"sheetId": pid, "startRowIndex": 0, "endRowIndex": 1}, "cell": {"userEnteredFormat": cabecalho},
                            "fields": "userEnteredFormat"}},
            {"repeatCell": {"range": {"sheetId": did, "startRowIndex": 0, "endRowIndex": 1}, "cell": {"userEnteredFormat": cabecalho},
                            "fields": "userEnteredFormat"}},
            {"repeatCell": {"range": {"sheetId": pid, "startRowIndex": 1, "endRowIndex": 1000},
                            "cell": {"userEnteredFormat": {"verticalAlignment": "MIDDLE", "wrapStrategy": "CLIP", "textFormat": {"fontSize": 10}}},
                            "fields": "userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy,userEnteredFormat.textFormat.fontSize"}},
            {"updateSheetProperties": {"properties": {"sheetId": pid, "gridProperties": {"frozenRowCount": 1, "frozenColumnCount": 2}},
                                       "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"}},
            {"updateDimensionProperties": {"range": {"sheetId": pid, "dimension": "ROWS", "startIndex": 0, "endIndex": 1},
                                           "properties": {"pixelSize": 40}, "fields": "pixelSize"}},
            {"setDataValidation": {"range": {"sheetId": pid, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": col("Etapa"), "endColumnIndex": col("Etapa") + 1},
                                   "rule": {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": e} for e in ETAPAS]},
                                            "strict": True, "showCustomUi": True}}},
            # Aba do dia a dia só com o que se usa; as outras escondidas.
            {"updateSheetProperties": {"properties": {"sheetId": did, "hidden": True}, "fields": "hidden"}},
            {"updateSheetProperties": {"properties": {"sheetId": LEADS_ANTIGA, "hidden": True}, "fields": "hidden"}},
        ]
        for nome, px in LARGURAS.items():
            req.append({"updateDimensionProperties": {"range": {"sheetId": pid, "dimension": "COLUMNS", "startIndex": col(nome), "endIndex": col(nome) + 1},
                                                      "properties": {"pixelSize": px}, "fields": "pixelSize"}})
        for nome in OCULTAS:
            req.append({"updateDimensionProperties": {"range": {"sheetId": pid, "dimension": "COLUMNS", "startIndex": col(nome), "endIndex": col(nome) + 1},
                                                      "properties": {"hiddenByUser": True}, "fields": "hiddenByUser"}})
        cores = {"Revisar": (1, 0.95, 0.65), "Convite enviado": (0.8, 0.88, 1), "Diagnóstico pronto": (0.73, 0.96, 0.8),
                 "Concluído": (0.85, 0.85, 0.85), "Sem interesse": (0.95, 0.85, 0.85)}
        existentes = s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets(properties.sheetId,conditionalFormats)")
        ja_tem = any(a["properties"]["sheetId"] == pid and a.get("conditionalFormats") for a in existentes["sheets"])
        if not ja_tem:
            for etapa, (r, g, b) in cores.items():
                req.append({"addConditionalFormatRule": {"index": 0, "rule": {
                    "ranges": [{"sheetId": pid, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": col("Etapa"), "endColumnIndex": col("Etapa") + 1}],
                    "booleanRule": {"condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": etapa}]},
                                    "format": {"backgroundColor": {"red": r, "green": g, "blue": b}}}}}})
        s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": req})

        # Migração única da aba antiga: só roda com Prospects e Descartados vazias.
        vazias = all(len(s.get(f"/v4/spreadsheets/{PLANILHA}/values/{quote(a + '!A2:A5')}").get("values", [])) == 0
                     for a in ("Prospects", "Descartados"))
        migrados = (0, 0)
        if vazias:
            antiga = s.get(f"/v4/spreadsheets/{PLANILHA}/values/{quote('Leads!A1:AX1000')}").get("values", [])
            if antiga:
                cab = antiga[0]
                linhas = [dict(zip(cab, l + [""] * (len(cab) - len(l)))) for l in antiga[1:] if any(l)]
                prospects, descartes = [], []
                for l in linhas:
                    cid = l.get("ID da empresa") or l.get("ID do lead") or ""
                    if not cid:
                        continue
                    if l.get("Etapa") in ("Revisar", "Contato aceito", "Convite pronto"):
                        wa = re.search(r"(\d{10,15})", l.get("Destino do contato", "")) or re.search(r"(\d{10,15})", l.get("Telefone", ""))
                        nota = l.get("Nota no Google", "")
                        prospects.append([cid, l.get("Empresa", ""), l.get("Cidade", ""), l.get("Segmento", ""),
                                          formatar_whatsapp(wa.group(1) if wa else l.get("Telefone", "")), l.get("Site", ""),
                                          f"{nota} ({l.get('Avaliações no Google', '')})" if nota else "", "Revisar",
                                          CONVITE_URL + quote(cid, safe=""), "", PROXIMA_REVISAR, "",
                                          f"https://www.google.com/maps/place/?q=place_id:{l.get('Google Place ID', '')}",
                                          l.get("Encontrado em", ""), "", ""])
                    else:
                        descartes.append([cid, l.get("Empresa", ""), l.get("Cidade", ""), l.get("Segmento", ""),
                                          l.get("Próxima verificação", "") or l.get("Etapa", ""), l.get("Encontrado em", "")])
                # Posição explícita: o append da API inseriu as linhas acima do cabeçalho numa aba nova.
                ultima = {"Prospects": "P", "Descartados": "F"}
                for aba, valores in (("Prospects", prospects), ("Descartados", descartes)):
                    if valores:
                        s.post(f"/v4/spreadsheets/{PLANILHA}/values:batchUpdate", {"valueInputOption": "RAW", "data": [
                            {"range": f"{aba}!A2:{ultima[aba]}{1 + len(valores)}", "values": valores}]})
                migrados = (len(prospects), len(descartes))
        print(f"Planilha: Prospects gid={pid}, Descartados gid={did}; migrados {migrados[0]} prospects e {migrados[1]} descartes")
        return pid, did


# ------------------------------------------------------------------ workflows

def doc(gid, nome):
    return {"documentId": {"__rl": True, "mode": "id", "value": PLANILHA},
            "sheetName": {"__rl": True, "mode": "id", "value": str(gid), "cachedResultName": nome}}


def ler(nome, gid, aba, pos):
    return {"id": nome.lower().replace(" ", "-"), "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
            "position": pos, "credentials": SHEETS, "executeOnce": True, "alwaysOutputData": True,
            "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
            "parameters": {"resource": "sheet", "operation": "read", **doc(gid, aba), "filtersUI": {"values": []}, "options": {}}}


def anexar(nome, gid, aba, colunas, pos):
    return {"id": nome.lower().replace(" ", "-"), "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
            "position": pos, "credentials": SHEETS, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
            "parameters": {"resource": "sheet", "operation": "append", **doc(gid, aba),
                           "columns": {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [],
                                       "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": False, "display": True,
                                                   "type": "string", "canBeUsedToMatch": True} for c in colunas]},
                           "options": {"cellFormat": "RAW", "handlingExtraData": "ignoreIt", "useAppend": True}}}


def se(nome, expr, pos):
    return {"id": nome.lower().replace(" ", "-"), "name": nome, "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": pos,
            "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                                          "combinator": "and", "conditions": [{"id": "c", "leftValue": expr, "rightValue": "",
                                                                               "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]},
                           "options": {}}}


def code(nome, js, pos):
    return {"id": nome.lower().replace(" ", "-"), "name": nome, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos,
            "parameters": {"mode": "runOnceForAllItems", "jsCode": js}}


def liga(con, de, para, saida=0):
    main = con.setdefault(de, {}).setdefault("main", [])
    while len(main) <= saida:
        main.append([])
    if not any(d["node"] == para for d in main[saida]):
        main[saida].append({"node": para, "type": "main", "index": 0})


def lead_scout(pid, did):
    wf = api("GET", f"/workflows/{LEAD_SCOUT}")
    sai = {"Sincronizar aceites — 5 min", "Ler fila para convites", "Preparar convite do diagnóstico", "Atualizar convite na fila",
           "Pendências do PRUMO", "Gravar pendências do PRUMO", "Enviar para revisão?", "Humanizar linha da fila",
           "Persistir fila PRUMO", "Registrar falha de descoberta"}
    nos = [n for n in wf["nodes"] if n["name"] not in sai]
    por = {n["name"]: n for n in nos}
    con = {de: {t: [[d for d in (s or []) if d["node"] not in sai] for s in saidas] for t, saidas in tipos.items()}
           for de, tipos in wf["connections"].items() if de not in sai}

    lidos = por["Ler empresas já registradas"]
    lidos["parameters"] = ler("x", pid, "Prospects", [0, 0])["parameters"]
    x, y = lidos["position"]
    descartados = ler("Ler descartados", did, "Descartados", [x + 110, y + 160])
    prep = por["Preparar descoberta sem repetidos"]
    prep["parameters"]["jsCode"] = ("const cfg = $('Config — mercado-alvo').first().json;\n"
                                    "// Prospects + Descartados: quem já foi visto não volta para a revisão.\n"
                                    "const linhas = [...$('Ler empresas já registradas').all(), ...$input.all()];\n"
                                    "const existingCompanyIds = [...new Set(linhas\n"
                                    "  .map(({ json }) => String(json['ID'] ?? json['ID da empresa'] ?? json.company_id ?? '').trim().toLowerCase())\n"
                                    "  .filter(Boolean))];\n"
                                    "return [{ json: { ...cfg, existingCompanyIds } }];")
    con["Ler empresas já registradas"] = {"main": [[{"node": "Ler descartados", "type": "main", "index": 0}]]}
    con["Ler descartados"] = {"main": [[{"node": "Preparar descoberta sem repetidos", "type": "main", "index": 0}]]}

    px, py = por["Pontuar para revisão humana"]["position"]
    e_prospect = se("É prospect?", "={{ $json.status === 'REVIEW' }}", [px + 220, py])
    linha_p = code("Linha de prospect", "\n".join([
        "const fmt = (bruto) => {",
        "  let d = String(bruto ?? '').replace(/\\D/g, '');",
        "  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);",
        "  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;",
        "  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;",
        "  return d;",
        "};",
        "return $input.all().map(({ json: l }) => ({ json: {",
        "  'ID': l.company_id, 'Empresa': l.company_name, 'Cidade': l.city, 'Segmento': l.target_vertical,",
        "  'WhatsApp': fmt(l.whatsapp_number), 'Site': l.website ?? '',",
        "  'Nota Google': l.rating ? `${l.rating} (${l.review_count})` : '',",
        f"  'Etapa': 'Revisar', 'Enviar convite': '{CONVITE_URL}' + encodeURIComponent(l.company_id),",
        f"  'Índice PRUMO': '', 'Próxima ação': '{PROXIMA_REVISAR}', 'Briefing': '',",
        "  'Google Maps': 'https://www.google.com/maps/place/?q=place_id:' + (l.place_id ?? ''), 'Encontrado em': l.discovered_at,",
        "} }));"]), [px + 440, py - 120])
    linha_d = code("Linha de descarte", "\n".join([
        "return $input.all().map(({ json: l }) => ({ json: {",
        "  'ID': l.company_id, 'Empresa': l.company_name, 'Cidade': l.city, 'Segmento': l.target_vertical,",
        "  'Motivo': l.research_note ?? '', 'Encontrado em': l.discovered_at,",
        "} }));"]), [px + 440, py + 120])
    grava_p = anexar("Gravar prospect", pid, "Prospects", PROSPECTS, [px + 660, py - 120])
    grava_d = anexar("Gravar descarte", did, "Descartados", DESCARTADOS, [px + 660, py + 120])
    gx, gy = por["Google Places — busca pública"]["position"]
    fm, fg = aviso_nodes("Falha do Places", gx + 240, gy + 420,
                         "'Lead Scout: a busca no Google Places falhou (' + String(item.json.error?.message ?? item.json.message ?? 'sem detalhe').slice(0, 200) + '). Tenta de novo na próxima execução.'",
                         "📊 PRUMO")
    nos += [descartados, e_prospect, linha_p, linha_d, grava_p, grava_d, fm, fg]
    con["Pontuar para revisão humana"] = {"main": [[{"node": "É prospect?", "type": "main", "index": 0}]]}
    con["É prospect?"] = {"main": [[{"node": "Linha de prospect", "type": "main", "index": 0}],
                                   [{"node": "Linha de descarte", "type": "main", "index": 0}]]}
    con["Linha de prospect"] = {"main": [[{"node": "Gravar prospect", "type": "main", "index": 0}]]}
    con["Linha de descarte"] = {"main": [[{"node": "Gravar descarte", "type": "main", "index": 0}]]}
    places = con["Google Places — busca pública"]["main"]
    while len(places) < 2:
        places.append([])
    places[1] = [{"node": fm["name"], "type": "main", "index": 0}]
    liga(con, fm["name"], fg["name"])
    wf["nodes"], wf["connections"] = nos, con
    put(wf)
    api("POST", f"/workflows/{LEAD_SCOUT}/activate")
    print("Lead Scout simplificado:", len(nos), "nós")


def perguntas_atuais():
    """As 16 perguntas (prefixo, área, opções) vêm do código em produção, sem redigitar."""
    wf = api("GET", f"/workflows/{PONTUACAO}")
    for n in wf["nodes"]:
        m = re.search(r"const (?:questions|QUESTIONS) = (\[.*?\n\]);", n["parameters"].get("jsCode", ""), re.S)
        if m:
            return m.group(1)
    arquivo = AQUI / "prumo-perguntas.js"
    return arquivo.read_text(encoding="utf-8")


def pontuacao(pid):
    spec = importlib.util.spec_from_file_location("prumo_aviso_unico", AQUI / "prumo-aviso-unico.py")
    aviso = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(aviso)  # memória dos avisos de resposta fora da lista
    perguntas = perguntas_atuais()
    (AQUI / "prumo-perguntas.js").write_text(perguntas, encoding="utf-8")  # cópia para a próxima recriação
    planilha_url = f"https://docs.google.com/spreadsheets/d/{PLANILHA}/edit#gid={pid}"
    calcular = f"""// Diagnóstico só com o dono: a resposta mais recente de cada empresa, completa, fecha o índice.
const QUESTIONS = {perguntas};
const prospects = new Map($('Ler prospects').all()
  .map(i => [String(i.json['ID'] ?? '').trim().toLowerCase(), i.json]).filter(([k]) => k));
const ultima = new Map();
for (const r of $input.all().map(i => i.json)) {{
  const ref = String(r['Empresa'] ?? '').trim();
  const papel = String(Object.entries(r).find(([k]) => k.startsWith('Sessão / papel'))?.[1] ?? 'Dono').trim();
  const completa = QUESTIONS.every(q => q.choices.includes(String(r[Object.keys(r).find(k => k.startsWith(q.prefix))] ?? '').trim()));
  // O briefing é do dono; as demais sessões seguem integralmente ao ramo do Mapa.
  if (ref && (!papel || papel.toLowerCase() === 'dono') && completa) ultima.set(ref.split('::')[0].trim().toLowerCase(), r);
}}
{aviso.MEMORIA}const saida = [];
for (const r of ultima.values()) {{
  const ref = String(r['Empresa']).trim();
  const sep = ref.indexOf('::');
  const id = sep > 0 ? ref.slice(0, sep).trim() : '';
  const empresa = sep > 0 ? ref.slice(sep + 2).trim() : ref;
  const p = prospects.get(id.toLowerCase());
{aviso.FORA_DEPOIS}  const respostas = [];
  const porArea = {{}};
  for (const q of QUESTIONS) {{
    const coluna = Object.keys(r).find(k => k.startsWith(q.prefix));
    const resposta = coluna ? String(r[coluna] ?? '').trim() : '';
    const nota = q.choices.indexOf(resposta) + 1;
    if (nota > 0) {{ respostas.push({{ ...q, nota, resposta }}); (porArea[q.area] ??= []).push(nota); }}
  }}
  if (respostas.length < QUESTIONS.length) continue;  // incompleta: espera
  const indice = Math.round(respostas.reduce((t, a) => t + a.nota, 0) / (4 * respostas.length) * 1000) / 10;
  const carimbo = String(r['Carimbo de data/hora'] ?? r.row_number ?? '');
  const assinatura = '[resposta:' + carimbo + '|' + respostas.map(a => a.id + ':' + a.nota).join('|') + ']';
  if (String(p['Briefing'] ?? '').includes(assinatura)) continue;
  const areas = Object.entries(porArea).map(([a, n]) => [a, Math.round(n.reduce((t, x) => t + x, 0) / (4 * n.length) * 1000) / 10])
    .sort((a, b) => a[1] - b[1]);
  const faixa = indice < 45 ? 'dependência e informalidade altas' : indice < 70 ? 'processos parcialmente definidos, com aderência inconsistente' : 'base operacional padronizada, com oportunidades pontuais';
  const lacunas = respostas.filter(a => a.nota <= 2).slice(0, 6).map(a => `- [${{a.id}}] ${{a.resposta}}`).join('\\n') || '- Nenhuma resposta com nota 1 ou 2.';
  const briefing = [
    `Índice PRUMO: ${{indice}}/100 — ${{faixa}}.`,
    'Prioridades para o workshop:',
    ...areas.slice(0, 3).map(([a, n], i) => `${{i + 1}}. ${{a}} (${{n}}/100): validar regra, responsável e fonte de dados antes de automatizar.`),
    'Evidências de menor maturidade:', lacunas, assinatura,
  ].join('\\n');
  const podeMudar = ['', 'Revisar', 'Convite enviado'].includes(String(p['Etapa'] ?? '').trim());
  saida.push({{ json: {{
    naFila: true, empresa, 'ID': p['ID'], 'Etapa': podeMudar ? 'Diagnóstico pronto' : p['Etapa'],
    'Índice PRUMO': indice, 'Briefing': briefing,
    'Próxima ação': podeMudar ? 'Leia o briefing e marque a devolutiva com o dono.' : p['Próxima ação'], 'Diagnóstico em': new Date().toISOString(),
  }} }});
}}
return saida;"""
    pendencias = f"""// O que depende do Rômulo no PRUMO; a Central lê via dell-status.
const linhas = $input.all().map(i => i.json).filter(l => l['ID']);
const etapa = (l) => String(l['Etapa'] ?? '').trim();
const conta = (e) => linhas.filter(l => etapa(l) === e).length;
const planilha = '{planilha_url}';
const estado = {{ geradoEm: new Date().toISOString(), itens: [
  {{ id: 'prumo-revisar', nome: 'PRUMO: prospects para revisar', quantidade: conta('Revisar'),
    detalhe: 'Veja o site; se fizer sentido, clique em Enviar convite.', link: planilha }},
  {{ id: 'prumo-diagnostico', nome: 'PRUMO: diagnósticos prontos', quantidade: conta('Diagnóstico pronto'),
    detalhe: 'Leia o briefing e marque o workshop com o dono.', link: planilha }},
  {{ id: 'prumo-aguardando', nome: 'PRUMO: convites sem resposta', quantidade: conta('Convite enviado'),
    detalhe: 'O dono ainda não respondeu; vale um lembrete.', link: planilha }},
] }};
return [{{ json: estado, binary: {{ data: {{ data: Buffer.from(JSON.stringify(estado), 'utf8').toString('base64'), mimeType: 'application/json', fileName: 'prumo.json' }} }} }}];"""

    nos = [
        {"id": "hora", "name": "A cada hora", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
         "parameters": {"rule": {"interval": [{"field": "hours", "hoursInterval": 1}]}}},
        {"id": "manual", "name": "Rodar manualmente", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 200], "parameters": {}},
        ler("Ler prospects", pid, "Prospects", [220, 100]),
        code("Pendências do PRUMO", pendencias, [440, 300]),
        {"id": "gravar-pendencias", "name": "Gravar pendências do PRUMO", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [660, 300], "parameters": {"operation": "write", "dataPropertyName": "data", "fileName": "/home/node/.n8n-files/estado/prumo.json"}},
        {**ler("Ler respostas do formulário", RESPOSTAS_GID, "Respostas ao formulário 1", [440, 100]),
         "parameters": {"resource": "sheet", "operation": "read",
                        "documentId": {"__rl": True, "mode": "id", "value": RESPOSTAS},
                        "sheetName": {"__rl": True, "mode": "id", "value": RESPOSTAS_GID}, "filtersUI": {"values": []}, "options": {}}},
        code("Calcular diagnóstico", calcular, [660, 100]),
        se("Está nos prospects?", "={{ $json.naFila }}", [880, 100]),
        {"id": "gravar-diagnostico", "name": "Gravar diagnóstico", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
         "position": [1100, 0], "credentials": SHEETS, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
         "parameters": {"resource": "sheet", "operation": "update", **doc(pid, "Prospects"),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["ID"],
                                    "value": {c: "={{ $json['" + c + "'] }}" for c in ("ID", "Etapa", "Índice PRUMO", "Briefing", "Próxima ação", "Diagnóstico em")},
                                    "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": c == "ID", "display": True,
                                                "type": "string", "canBeUsedToMatch": c == "ID"}
                                               for c in ("ID", "Etapa", "Índice PRUMO", "Briefing", "Próxima ação", "Diagnóstico em")]},
                        "options": {"cellFormat": "RAW"}}},
    ]
    pm, pg = aviso_nodes("Diagnóstico pronto", 1320, 0,
                         "(() => { const d = $('Calcular diagnóstico').all().filter(x => x.json.naFila)[i]?.json ?? {};"
                         " return 'Diagnóstico pronto: ' + d.empresa + ' · Índice PRUMO ' + d['Índice PRUMO'] + '/100.' + NL"
                         " + 'O briefing está na planilha, aba Prospects. Próximo passo: workshop com o dono.'; })()", "📊 PRUMO")
    om, og = aviso_nodes("Resposta fora da lista", 1100, 250,
                         "'Diagnóstico PRUMO recebeu resposta de uma empresa que não está nos prospects: ' + item.json.empresa"
                         " + ' (ID ' + item.json.id + '). Confira o link usado no formulário.'", "📊 PRUMO")
    nos += [pm, pg, om, og]
    con = {}
    liga(con, "A cada hora", "Ler prospects")
    liga(con, "Rodar manualmente", "Ler prospects")
    liga(con, "Ler prospects", "Pendências do PRUMO")
    liga(con, "Pendências do PRUMO", "Gravar pendências do PRUMO")
    liga(con, "Ler prospects", "Ler respostas do formulário")
    liga(con, "Ler respostas do formulário", "Calcular diagnóstico")
    liga(con, "Calcular diagnóstico", "Está nos prospects?")
    liga(con, "Está nos prospects?", "Gravar diagnóstico", 0)
    liga(con, "Está nos prospects?", om["name"], 1)
    liga(con, om["name"], og["name"])
    liga(con, "Gravar diagnóstico", pm["name"])
    liga(con, pm["name"], pg["name"])
    nos += aviso.nos_memoria()
    aviso.ligar_memoria(con, aviso_gravado=og["name"])
    # Resposta completa vira pacote do Mapa (P3); sem isto, recriar o fluxo apagaria o ramo.
    spec = importlib.util.spec_from_file_location("prumo_mapa_n8n", AQUI / "prumo-mapa-n8n.py")
    mapa = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mapa)
    nos += mapa.nos(perguntas)
    mapa.ligar(con)
    wf = api("GET", f"/workflows/{PONTUACAO}")
    wf["name"] = "PRUMO — Diagnóstico do dono"
    wf["nodes"], wf["connections"] = nos, con
    mapa.marcar_diagnostico(wf)
    put(wf)
    api("POST", f"/workflows/{PONTUACAO}/activate")
    print("Pontuação simplificada:", len(nos), "nós")


def convite(pid):
    spec = importlib.util.spec_from_file_location("fecha_ciclos", AQUI / "fecha-ciclos.py")
    fc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fc)
    decidir = f"""const q = $('Clique (convite)').first().json.query ?? {{}};
const id = String(q.id ?? '');
// 05/10/2026: dois passos. "convite" (padrão, o botão Enviar convite): pede para
// falar com o responsável, sem link. "diagnostico" (botão da ficha do CRM e do
// aviso do Hermes, depois do "sim"): o formulário. Medido até 05/10: o convite de
// cinco parágrafos com link encurtado na primeira mensagem teve 0 respostas de
// gente em 45 envios; o roteiro (prumo/03-captacao/roteiro-ate-o-convite.md)
// sempre disse "uma pergunta por mensagem" e "apresentar-se antes de pedir".
const passo = String(q.passo ?? '') === 'diagnostico' ? 'diagnostico' : 'convite';
const l = $input.first()?.json ?? {{}};
const achou = id !== '' && String(l['ID'] ?? '') === id;
const empresa = String(l['Empresa'] ?? '');
// Formulário já com a empresa (liga a resposta à linha) e o papel Dono.
const form = '{FORM}?usp=pp_url&entry.{ENTRY_EMPRESA}=' + encodeURIComponent(id + '::' + empresa) + '&entry.{ENTRY_PAPEL}=' + encodeURIComponent('Dono');
// Link curto no TinyURL (API sem conta), com apelido legível "prumo-<empresa>-<4>".
// Apelido já usado (segundo clique) -> tenta sem apelido; serviço fora -> link longo.
const slug = empresa.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase()
  .replace(/\\b(ltda|me|epp|eireli|s\\/?a)\\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 18).replace(/-+$/, '');
let h = 0;
for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
const apelido = ['prumo', slug, h.toString(36).slice(-4)].filter(Boolean).join('-');
const encurtar = async (qs) => {{
  try {{
    const r = String(await this.helpers.httpRequest({{ method: 'GET', url: 'https://tinyurl.com/api-create.php', qs, timeout: 5000 }})).trim();
    return r.startsWith('https://tinyurl.com/') ? r : '';
  }} catch (e) {{ return ''; }}
}};
// Só o passo do diagnóstico leva link: o convite não gasta o TinyURL.
const link = achou && passo === 'diagnostico' ? (await encurtar({{ url: form, alias: apelido }}) || await encurtar({{ url: form }}) || form) : form;
// Áreas por segmento vêm do roteiro (passo 2).
const seg = String(l['Segmento'] ?? '').trim().toLowerCase();
const distribuidora = /^distribuidoras? /.test(seg);
const publico = distribuidora ? seg.replace(/^distribuidoras? /, 'distribuidoras ') : 'empresas como a de vocês';
const areas = !distribuidora ? 'do dia a dia'
  : /autope/.test(seg) ? 'de orçamento, preço e compras'
  : /constru/.test(seg) ? 'de preço, desconto e crédito'
  : /aliment|bebida/.test(seg) ? 'de preço, prazo e cobrança'
  : 'de preço, crédito e entregas';
let nome = empresa.trim();
for (let i = 0; i < 2; i++) nome = nome.replace(/[\\s,.-]+(ltda|me|epp|eireli|s\\.?\\/?a\\.?)\\.?$/i, '').trim();
// Nome todo em maiúsculas ("CACAU PEÇAS PARA MOTORES") denuncia mensagem automática.
if (nome === nome.toUpperCase() && /\\p{{Lu}}{{4}}/u.test(nome)) nome = nome.toLowerCase()
  .replace(/(^|\\s)(\\p{{L}})/gu, (m, a, b) => a + b.toUpperCase()).replace(/ (D[aeo]s?|E|Para|Em) /g, (m) => m.toLowerCase());
// Cumprimento da hora de São Paulo (o clique é a hora do envio).
const hora = Number(new Date().toLocaleString('en-US', {{ timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }}));
const ola = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
const mensagem = passo === 'convite'
  ? ola + '! Aqui é o Rômulo, do Prumo. Ajudo donos de ' + publico + ' a passar para a equipe as decisões '
    + areas + ' que hoje dependem só deles.\\n\\nConsigo falar com o responsável pela ' + (nome || 'empresa') + ' por aqui?'
  : 'Obrigado! Eu faço um diagnóstico gratuito da rotina: 16 perguntas de marcar, uns 10 minutos, sem nenhum dado financeiro.\\n'
    + link + '\\n\\nEm até 3 dias úteis eu devolvo o resultado, mostrando o que dá para passar para a equipe sem perder o controle.';
let digitos = String(l['WhatsApp'] ?? '').replace(/\\D/g, '');
if (digitos.length === 10 || digitos.length === 11) digitos = '55' + digitos;
let destino = digitos.length >= 12 && digitos.length <= 13 ? 'https://wa.me/' + digitos + '?text=' + encodeURIComponent(mensagem) : form;
if (!achou) destino = 'https://docs.google.com/spreadsheets/d/{PLANILHA}/edit#gid={pid}';
return [{{ json: {{ chave: id, destino, marcar: false, agora: new Date().toISOString() }} }}];"""
    fc.webhook_workflow("PRUMO — Clique em Enviar convite (marca enviado)", "convite", "5b1c2d3e-4f50-4a61-8b72-c3d4e5f60002",
                        PLANILHA, str(pid), "Prospects", "ID", "id", decidir,
                        {"Etapa": "Convite enviado", "Convite enviado em": "={{ $json.agora }}",
                         "Próxima ação": "Aguarde a resposta (do dono ou de quem atende o número). Quando aceitarem, "
                                         "faça o Raio-X e mande pelo botão da ficha no CRM. Sem resposta em 3 dias, um lembrete só."})


if __name__ == "__main__":
    if sys.argv[1:2] == ["--convite"]:
        # Só o texto do convite: não mexe na planilha, no Lead Scout nem na Pontuação.
        with SheetsProxy([PLANILHA]) as s:
            abas = s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets.properties")["sheets"]
        convite(next(a["properties"]["sheetId"] for a in abas if a["properties"]["title"] == "Prospects"))
        sys.exit(0)
    pid, did = planilha()
    if "--lead-scout-legado" in sys.argv:
        lead_scout(pid, did)
    pontuacao(pid)
    convite(pid)
