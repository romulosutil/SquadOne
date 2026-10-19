"""Links rastreados e pendências (idempotente).

- "Clique no wa_link" (GET /webhook/enviar?place_id=): redireciona para o wa.me
  guardado em wa_me e, num lead "pronto", grava `clique_em` (19/10/2026: o rastro
  do clique, nunca o envio). Quem marca "enviado" é o observador, quando a mensagem
  sai de verdade; com um clique até 15 min antes, ele mantém a letra do Balcão em
  mensagem_variante (o texto que saiu é o do wa_me), e sem clique grava "manual".
  Até 18/10/2026 o clique marcava "enviado" (status + enviado_em) direto; a regra
  [abrir-nao-envia] de workflow_confiabilidade.py tirou isso, e o A/B da 1ª
  mensagem parou de contar (todo envio virava "manual") até o clique_em.
  Histórico: Com `&marcar=nao` (01/10/2026) só redireciona:
  é o caminho do operador do Dell, que envia pelo WhatsApp Web, e o lead vira
  "enviado" pelo observador quando a mensagem sai de verdade (owner_sent), nunca
  no clique. Assim um envio que falha depois do clique não deixa o lead marcado.
  Limite conhecido (07/10/2026): o observador não sabe desse clique, então o
  envio que vem depois grava mensagem_variante "manual", e não a letra do
  Balcão. Até 07/10 nenhum clique usou `marcar=nao`; quem automatizar o envio
  por esse caminho precisa deixar o rastro do clique para o observador.
- "Clique em Enviar convite" (GET /webhook/convite?id=): marca o convite do PRUMO
  como enviado e redireciona para o WhatsApp/e-mail/formulário do lead.
- Lead Scout: "Enviar convite" vira o link rastreado e a sincronização horária
  grava as pendências do PRUMO para a Central.

Até 29/09/2026 os links usavam 127.0.0.1:5679, que só abria no Dell (ou pelo
túnel do PC). Desde então passam pela tailnet: `tailscale serve` publica
/webhook do n8n em LINKS, só para aparelhos da tailnet (não é Funnel), então o
link abre no celular com o Tailscale ligado. `--tailnet` troca a base no Lead
Scout e reescreve os "Enviar convite" do PRUMO ainda em "Revisar"; o wa_link do
Site é remontado pelo Balcão a cada hora (balcao-cruzar.js).

Desde 23/09/2026 o fluxo do convite PRUMO e o Lead Scout vêm de prumo-simples.py
(que usa webhook_workflow daqui); rodar este arquivo sem opção refaz só o 04.

Uso: python3 fecha-ciclos.py [--tailnet]
"""
import sys
from urllib.parse import quote

from n8n import api, put

SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
SITE = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o"
PRUMO = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U"
LEAD_SCOUT = "e02c6f43-17ce-430b-9238-0b997a7656ce"
LINKS = "https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook"
LOCAL = "http://127.0.0.1:5679/webhook"


def doc(planilha, gid, aba):
    return {"documentId": {"__rl": True, "mode": "id", "value": planilha},
            "sheetName": {"__rl": True, "mode": "id", "value": gid, "cachedResultName": aba}}


def schema(colunas, chave):
    return [{"id": c, "displayName": c, "required": False, "defaultMatch": c == chave, "display": True,
             "type": "string", "canBeUsedToMatch": c == chave} for c in colunas]


def webhook_workflow(nome, caminho, webhook_id, planilha, gid, aba, coluna_chave, parametro, decidir_js, marca):
    gatilho = f"Clique ({caminho})"
    nos = [
        {"id": "clique", "name": gatilho, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
         "webhookId": webhook_id, "parameters": {"httpMethod": "GET", "path": caminho, "responseMode": "responseNode", "options": {}}},
        {"id": "ler", "name": "Ler a linha", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [220, 0],
         "credentials": SHEETS, "alwaysOutputData": True, "executeOnce": True, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "read", **doc(planilha, gid, aba),
                        "filtersUI": {"values": [{"lookupColumn": coluna_chave,
                                                  "lookupValue": "={{ $json.query." + parametro + " }}"}]}, "options": {}}},
        {"id": "decidir", "name": "Decidir", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 0],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": decidir_js}},
        {"id": "primeiro", "name": "Primeiro clique?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [660, 0],
         "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                                       "combinator": "and", "conditions": [{"id": "marcar", "leftValue": "={{ $json.marcar }}", "rightValue": "",
                                                                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]},
                        "options": {}}},
        {"id": "marcar", "name": "Marcar como enviado", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [880, -120],
         "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(planilha, gid, aba),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": [coluna_chave],
                                    "value": {coluna_chave: "={{ $json.chave }}", **marca},
                                    "schema": schema([coluna_chave, *marca.keys()], coluna_chave)},
                        "options": {"cellFormat": "RAW"}}},
        {"id": "abrir", "name": "Abrir o canal", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [1100, 0],
         "parameters": {"respondWith": "redirect", "redirectURL": "={{ $('Decidir').first().json.destino }}", "options": {}}},
    ]
    con = {
        gatilho: {"main": [[{"node": "Ler a linha", "type": "main", "index": 0}]]},
        "Ler a linha": {"main": [[{"node": "Decidir", "type": "main", "index": 0}]]},
        "Decidir": {"main": [[{"node": "Primeiro clique?", "type": "main", "index": 0}]]},
        "Primeiro clique?": {"main": [[{"node": "Marcar como enviado", "type": "main", "index": 0}],
                                      [{"node": "Abrir o canal", "type": "main", "index": 0}]]},
        "Marcar como enviado": {"main": [[{"node": "Abrir o canal", "type": "main", "index": 0}]]},
    }
    erro = next(w["id"] for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == "00 · Avisar falha pelo Hermes")
    wf = {"name": nome, "nodes": nos, "connections": con,
          "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}
    existentes = [w for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == nome]
    if existentes:
        wf["id"] = existentes[0]["id"]
        put(wf)
        wid = wf["id"]
    else:
        wid = api("POST", "/workflows", wf)["id"]
    api("POST", f"/workflows/{wid}/activate")
    print(nome, "->", wid, f"{LINKS}/{caminho}")


DECIDIR_SITE = """const q = $('Clique (enviar)').first().json.query ?? {};
const pid = String(q.place_id ?? '');
// marcar=nao: só abre o WhatsApp, sem rastro (o observador grava "manual"). Sem ele, o clique num
// lead "pronto" grava clique_em: é o que o observador usa para manter a letra (nunca marca enviado).
const soAbrir = String(q.marcar ?? '') === 'nao';
const l = $input.first()?.json ?? {};
const achou = pid !== '' && l.place_id === pid;
const waMe = String(l.wa_me || '').trim() || (String(l.wa_link || '').startsWith('https://wa.me/') ? String(l.wa_link) : '');
// Sem wa.me (lead sem telefone ou não achado): abre a planilha para decidir à mão.
const destino = achou && waMe ? waMe : 'https://docs.google.com/spreadsheets/d/""" + SITE + """/edit#gid=396728619';
return [{ json: { chave: pid, destino, marcar: !soAbrir && achou && waMe !== '' && String(l.status).trim() === 'pronto', agora: new Date().toISOString() } }];"""

DECIDIR_PRUMO = """const id = String($('Clique (convite)').first().json.query?.id ?? '');
const l = $input.first()?.json ?? {};
const achou = id !== '' && String(l['ID do lead'] ?? '') === id;
const planilha = 'https://docs.google.com/spreadsheets/d/""" + PRUMO + """/edit#gid=957714022';
const canal = String(l['Canal de contato'] ?? '').toLowerCase();
const destinoContato = String(l['Destino do contato'] ?? '').trim();
const mensagem = String(l['Mensagem do convite'] ?? '');
let destino = String(l['Formulário do diagnóstico'] ?? '') || planilha;
if (canal.includes('whatsapp')) {
  const direto = destinoContato.match(/(?:wa\\.me\\/|[?&]phone=)(\\d{10,15})/i)?.[1] ?? '';
  let digitos = direto || destinoContato.replace(/\\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) digitos = '55' + digitos;
  if (digitos.length >= 12 && digitos.length <= 15) destino = 'https://wa.me/' + digitos + '?text=' + encodeURIComponent(mensagem);
} else if (canal.includes('email') || destinoContato.includes('@')) {
  destino = 'mailto:' + destinoContato.replace(/^mailto:/i, '') + '?subject=' + encodeURIComponent('Diagnóstico PRUMO — ' + (l['Empresa'] ?? '')) + '&body=' + encodeURIComponent(mensagem);
}
if (!achou) destino = planilha;
return [{ json: { chave: id, destino, marcar: achou && String(l['Situação do diagnóstico'] ?? '').trim() === 'Convite pronto', agora: new Date().toISOString() } }];"""

PENDENCIAS_PRUMO = """// O que depende do Rômulo no PRUMO. A Central lê este arquivo via dell-status.
const linhas = $input.all().map(i => i.json);
const planilha = 'https://docs.google.com/spreadsheets/d/""" + PRUMO + """/edit#gid=957714022';
const etapa = (l) => String(l['Etapa'] ?? '').trim();
const conta = (f) => linhas.filter(f).length;
const estado = { geradoEm: new Date().toISOString(), itens: [
  { id: 'prumo-revisar', nome: 'PRUMO: empresas para revisar', quantidade: conta(l => etapa(l) === 'Revisar'),
    detalhe: 'Aborde as que fizerem sentido e mude a Etapa para "Contato aceito" quando aceitarem.', link: planilha },
  { id: 'prumo-convite', nome: 'PRUMO: convites prontos para enviar', quantidade: conta(l => String(l['Situação do diagnóstico'] ?? '').trim() === 'Convite pronto'),
    detalhe: 'Clique em "Enviar convite": abre o canal com a mensagem e marca como enviado.', link: planilha },
  { id: 'prumo-diagnostico', nome: 'PRUMO: diagnósticos para revisar', quantidade: conta(l => etapa(l) === 'Diagnóstico para revisar'),
    detalhe: 'O briefing está na linha; prepare o workshop.', link: planilha },
] };
return [{ json: estado, binary: { data: { data: Buffer.from(JSON.stringify(estado), 'utf8').toString('base64'), mimeType: 'application/json', fileName: 'prumo.json' } } }];"""


def lead_scout():
    wf = api("GET", f"/workflows/{LEAD_SCOUT}")
    nos = {n["name"]: n for n in wf["nodes"]}
    conv = nos["Preparar convite do diagnóstico"]["parameters"]
    antigo = "    'Enviar convite': actionUrl,\n"
    if antigo in conv["jsCode"]:
        conv["jsCode"] = conv["jsCode"].replace(antigo,
            "    // Link rastreado: o clique marca o convite como enviado e abre o canal (actionUrl).\n"
            "    'Enviar convite': '" + LINKS + "/convite?id=' + encodeURIComponent(String(value(lead, 'ID do lead', 'dedupe_key') || companyId)),\n")
        conv["jsCode"] = conv["jsCode"].replace(
            "'Envie o convite pelo canal validado. Depois, marque a situação do diagnóstico como “Convite enviado”.'",
            "'Clique em “Enviar convite”: abre o canal com a mensagem pronta e marca o convite como enviado.'")
    ler = nos["Ler fila para convites"]
    x, y = ler["position"]
    if "Pendências do PRUMO" not in nos:
        wf["nodes"] += [
            {"id": "pendencias-prumo", "name": "Pendências do PRUMO", "type": "n8n-nodes-base.code", "typeVersion": 2,
             "position": [x + 220, y + 220], "parameters": {"mode": "runOnceForAllItems", "jsCode": PENDENCIAS_PRUMO}},
            {"id": "gravar-pendencias-prumo", "name": "Gravar pendências do PRUMO", "type": "n8n-nodes-base.readWriteFile",
             "typeVersion": 1.1, "position": [x + 440, y + 220],
             "parameters": {"operation": "write", "dataPropertyName": "data", "fileName": "/home/node/.n8n-files/estado/prumo.json"}},
        ]
        wf["connections"]["Ler fila para convites"]["main"][0].append({"node": "Pendências do PRUMO", "type": "main", "index": 0})
        wf["connections"]["Pendências do PRUMO"] = {"main": [[{"node": "Gravar pendências do PRUMO", "type": "main", "index": 0}]]}
    put(wf)
    api("POST", f"/workflows/{LEAD_SCOUT}/activate")
    print("Lead Scout: convite rastreado + pendências")


def tailnet():
    """Base dos links rastreados do PRUMO: Lead Scout (só a string) e convites pendentes na planilha."""
    wf = api("GET", f"/workflows/{LEAD_SCOUT}")
    trocados = 0
    for n in wf["nodes"]:
        codigo = n["parameters"].get("jsCode", "")
        if LOCAL + "/convite?id=" in codigo:
            n["parameters"]["jsCode"] = codigo.replace(LOCAL + "/convite?id=", LINKS + "/convite?id=")
            trocados += 1
    if trocados:
        put(wf)
        api("POST", f"/workflows/{LEAD_SCOUT}/activate")
    print(f"Lead Scout: {trocados} nó(s) com a base nova")

    from sheets_proxy import SheetsProxy
    with SheetsProxy([PRUMO]) as s:
        v = s.get(f"/v4/spreadsheets/{PRUMO}/values/" + quote("Prospects!A1:P1000") + "?valueRenderOption=FORMULA")["values"]
        cab = v[0]
        etapa, convite = cab.index("Etapa"), cab.index("Enviar convite")
        coluna = chr(ord("A") + convite)
        dados = []
        for n, linha in enumerate(v[1:], start=2):
            linha = linha + [""] * (len(cab) - len(linha))
            if str(linha[etapa]).strip() == "Revisar" and LOCAL + "/convite?id=" in str(linha[convite]):
                dados.append({"range": f"Prospects!{coluna}{n}",
                              "values": [[str(linha[convite]).replace(LOCAL + "/convite?id=", LINKS + "/convite?id=")]]})
        if dados:
            s.post(f"/v4/spreadsheets/{PRUMO}/values:batchUpdate", {"valueInputOption": "USER_ENTERED", "data": dados})
        print(f"Prospects: {len(dados)} convite(s) em Revisar com a base nova")


if __name__ == "__main__":
    if "--tailnet" in sys.argv:
        tailnet()
        sys.exit(0)
    webhook_workflow("04 · Clique no wa_link (marca enviado)", "enviar", "5b1c2d3e-4f50-4a61-8b72-c3d4e5f60001",
                     SITE, "396728619", "Leads", "place_id", "place_id", DECIDIR_SITE,
                     {"clique_em": "={{ $json.agora }}"})
    # O convite PRUMO (aba Leads antiga, DECIDIR_PRUMO) e o lead_scout() abaixo são de antes de
    # prumo-simples.py: rodá-los hoje desfaria o PRUMO simples. Ficam só como histórico.
