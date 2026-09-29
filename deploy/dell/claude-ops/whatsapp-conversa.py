"""Conversa no WhatsApp marca o lead sozinho (idempotente).

O Rômulo aborda os leads direto no WhatsApp, sem passar pelos links
rastreados, e não tem tempo de voltar à planilha. O observador
(`deploy/dell/whatsapp-observador/observador.py`) lê o log da bridge do Hermes,
que já está vinculado ao número dele, e avisa este n8n quando um número das
planilhas escreve:

- GET  /webhook/whatsapp-telefones  -> {"chaves": [...]}: os números dos leads,
  que o observador usa como filtro (conversa com quem não é lead nunca sai dele);
- POST /webhook/whatsapp-conversa   {"chave", "direcao": "saida"|"entrada", "em"}:
  PRUMO: saída ou resposta com Etapa "Revisar" -> "Convite enviado"; resposta
  com Etapa "Convite enviado" -> Próxima ação "Respondeu no WhatsApp ...".
  Site antes da venda (29/09/2026): saída ou resposta com status "novo" ou
  "pronto" -> "enviado" (+ enviado_em se vazio; o Balcão completa site_url de
  quem virou enviado antes de ele passar); resposta a 5 min ou mais do envio ->
  respondeu_em (e "expirado" volta a "enviado"). A pasta do lead vai para
  _em-conversa pelo site-pastas do Dell (o Balcão lista o que mover).
  Hoje só chegam RESPOSTAS (observador.py lê o log da bridge do Hermes, que
  não traz o número das mensagens enviadas); a saída fica pronta para quando houver.

Por que 5 min: em 28/09/2026 dez leads "responderam" entre 16:30 e 16:49, na
ordem e no ritmo em que o Rômulo mandava, cada um segundos depois do envio. É a
saudação automática do WhatsApp Business, não gente. Por isso a primeira
mensagem de um lead "pronto" só prova o envio, e resposta é mensagem que chega a
5 min ou mais do envio. O observador manda um segundo aviso ("seguinte": true)
quando o lead volta a escrever depois desses 5 min; o PRUMO ignora esse
segundo aviso e continua marcando uma vez por janela, como antes.

Só número, direção e hora: o conteúdo das mensagens nunca sai do observador.
Os dois webhooks exigem o header X-Observador (credencial "Observador
WhatsApp"); o segredo mora em ~/.config/claude-ops/whatsapp-observador-segredo.

Chave de um número = DDD + últimos 8 dígitos: o WhatsApp guarda celulares
antigos sem o 9 da frente, e a planilha às vezes com; os dois lados batem.
"""
import secrets
from pathlib import Path

from n8n import api, put

SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
PRUMO, PROSPECTS_GID = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U", "1838781376"
SITE, LEADS_GID = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o", "396728619"
SEGREDO = Path.home() / ".config/claude-ops/whatsapp-observador-segredo"
CREDENCIAL = "Observador WhatsApp"

# Mesma regra do observador (observador.py, chave_do_numero).
CHAVE_JS = """const chave = (bruto) => {
  let d = String(bruto ?? '').replace(/\\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return '';
  return d.slice(0, 2) + d.slice(-8);
};
const numeroDoSite = (l) => String(l.wa_me ?? '').match(/wa\\.me\\/(\\d+)/)?.[1] ?? l.telefone ?? '';"""


def doc(planilha, gid, aba):
    return {"documentId": {"__rl": True, "mode": "id", "value": planilha},
            "sheetName": {"__rl": True, "mode": "id", "value": gid, "cachedResultName": aba}}


def schema(colunas, chave):
    return [{"id": c, "displayName": c, "required": False, "defaultMatch": c == chave, "display": True,
             "type": "string", "canBeUsedToMatch": c == chave} for c in colunas]


def ler(no_id, nome, planilha, gid, aba, x, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [x, y],
            "credentials": SHEETS, "alwaysOutputData": True, "executeOnce": True, "retryOnFail": True, "maxTries": 3,
            "parameters": {"resource": "sheet", "operation": "read", **doc(planilha, gid, aba), "options": {}}}


def credencial():
    """Credencial de header do webhook. O segredo nasce aqui, uma vez, e nunca é impresso."""
    if not SEGREDO.exists():
        SEGREDO.parent.mkdir(parents=True, exist_ok=True)
        SEGREDO.write_text(secrets.token_urlsafe(32))
        SEGREDO.chmod(0o600)
    segredo = SEGREDO.read_text().strip()
    existentes = [c for c in api("GET", "/credentials?limit=100")["data"] if c["name"] == CREDENCIAL]
    if existentes:
        return {"httpHeaderAuth": {"id": existentes[0]["id"], "name": CREDENCIAL}}
    criada = api("POST", "/credentials", {"name": CREDENCIAL, "type": "httpHeaderAuth",
                                          "data": {"name": "X-Observador", "value": segredo}})
    return {"httpHeaderAuth": {"id": criada["id"], "name": CREDENCIAL}}


def gatilho(no_id, nome, metodo, caminho, webhook_id, auth):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
            "webhookId": webhook_id, "credentials": auth,
            "parameters": {"httpMethod": metodo, "path": caminho, "authentication": "headerAuth",
                           "responseMode": "responseNode", "options": {}}}


def responder(no_id, nome, corpo_expr, x, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [x, y],
            "parameters": {"respondWith": "json", "responseBody": corpo_expr, "options": {}}}


def publicar(wf):
    erro = next(w["id"] for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == "00 · Avisar falha pelo Hermes")
    wf["settings"] = {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro, **wf.get("settings", {})}
    existentes = [w for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == wf["name"]]
    if existentes:
        wf["id"] = existentes[0]["id"]
        put(wf)
        wid = wf["id"]
    else:
        wid = api("POST", "/workflows", wf)["id"]
    api("POST", f"/workflows/{wid}/activate")
    print(wf["name"], "->", wid)


def telefones(auth):
    montar = CHAVE_JS + """
const prumo = $('Ler Prospects').all().map(i => i.json)
  .filter(l => !['Concluído', 'Sem interesse'].includes(String(l['Etapa'] ?? '').trim()))
  .map(l => chave(l['WhatsApp']));
const site = $('Ler Leads do site').all().map(i => i.json)
  .filter(l => ['novo', 'pronto', 'enviado', 'expirado'].includes(String(l.status ?? '').trim()))
  .map(l => chave(numeroDoSite(l)));
return [{ json: { chaves: [...new Set([...prumo, ...site].filter(Boolean))] } }];"""
    nos = [
        gatilho("pedir", "Observador pede os números", "GET", "whatsapp-telefones", "7c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e501", auth),
        ler("prumo", "Ler Prospects", PRUMO, PROSPECTS_GID, "Prospects", 220, 0),
        ler("site", "Ler Leads do site", SITE, LEADS_GID, "Leads", 440, 0),
        {"id": "montar", "name": "Montar chaves", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": montar}},
        responder("resp", "Responder", "={{ $json }}", 880, 0),
    ]
    con = {"Observador pede os números": {"main": [[{"node": "Ler Prospects", "type": "main", "index": 0}]]},
           "Ler Prospects": {"main": [[{"node": "Ler Leads do site", "type": "main", "index": 0}]]},
           "Ler Leads do site": {"main": [[{"node": "Montar chaves", "type": "main", "index": 0}]]},
           "Montar chaves": {"main": [[{"node": "Responder", "type": "main", "index": 0}]]}}
    # Roda a cada 10 min só para devolver números: guardar cada execução é ruído.
    publicar({"name": "WhatsApp — números dos leads (para o observador)", "nodes": nos, "connections": con,
              "settings": {"saveDataSuccessExecution": "none"}})


def conversa(auth):
    decidir = CHAVE_JS + """
const ev = $('Conversa no WhatsApp').first().json.body ?? {};
const alvo = chave(ev.chave);
const direcao = ev.direcao === 'entrada' ? 'entrada' : 'saida';
// Segundo aviso do observador na mesma conversa: só serve ao Site (resposta depois da saudação).
const seguinte = ev.seguinte === true;
const em = ev.em ? new Date(ev.em) : new Date();
// Saudação automática do WhatsApp Business chega segundos depois do envio; gente demora mais.
const SAUDACAO_MS = 5 * 60 * 1000;
const quando = em.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const saida = [];
for (const l of $('Ler Prospects').all().map(i => i.json)) {
  if (!alvo || seguinte || chave(l['WhatsApp']) !== alvo) continue;
  const etapa = String(l['Etapa'] ?? '').trim();
  if (direcao === 'saida' && etapa === 'Revisar') {
    saida.push({ json: { planilha: 'prumo', ID: String(l['ID']), 'Etapa': 'Convite enviado', 'Convite enviado em': em.toISOString(),
      'Próxima ação': 'Aguarde o dono responder (16 perguntas, uns 5 minutos).' } });
  } else if (direcao === 'entrada' && etapa === 'Revisar') {
    // Resposta prova que o contato aconteceu, mesmo sem o link rastreado.
    saida.push({ json: { planilha: 'prumo', ID: String(l['ID']), 'Etapa': 'Convite enviado', 'Convite enviado em': em.toISOString(),
      'Próxima ação': 'Respondeu no WhatsApp em ' + quando + '. Continue a conversa.' } });
  } else if (direcao === 'entrada' && etapa === 'Convite enviado') {
    // Reescreve a data do convite com ela mesma: o update grava todas as colunas mapeadas.
    saida.push({ json: { planilha: 'prumo', ID: String(l['ID']), 'Etapa': etapa, 'Convite enviado em': String(l['Convite enviado em'] ?? ''),
      'Próxima ação': 'Respondeu no WhatsApp em ' + quando + '. Continue a conversa.' } });
  }
}
for (const l of $('Ler Leads do site').all().map(i => i.json)) {
  if (!alvo || chave(numeroDoSite(l)) !== alvo) continue;
  // "novo" com site publicado: o Rômulo manda a demo assim que o Hermes avisa, antes de o Balcão passar.
  const status = String(l.status ?? '').trim();
  if (!['novo', 'pronto', 'enviado', 'expirado'].includes(status)) continue;
  const aEnviar = status === 'novo' || status === 'pronto';
  const enviadoAntes = String(l.enviado_em ?? '').trim();
  const respondeuAntes = String(l.respondeu_em ?? '').trim();
  // Saída ou resposta: as duas provam que o site chegou ao lead.
  const enviado = enviadoAntes || (aEnviar ? em.toISOString() : '');
  // Enviado sem data legível (marcado à mão) conta como envio antigo.
  const desde = Date.parse(enviado);
  const longe = !Number.isFinite(desde) || em.getTime() - desde >= SAUDACAO_MS;
  const respondeu = respondeuAntes || (direcao === 'entrada' && longe ? em.toISOString() : '');
  const novoStatus = aEnviar || (status === 'expirado' && respondeu) ? 'enviado' : status;
  if (novoStatus === status && enviado === enviadoAntes && respondeu === respondeuAntes) continue;
  saida.push({ json: { planilha: 'site', place_id: String(l.place_id), status: novoStatus, enviado_em: enviado, respondeu_em: respondeu } });
}
return saida;"""
    marca_prumo = {"ID": "={{ $json.ID }}", "Etapa": "={{ $json['Etapa'] }}",
                   "Convite enviado em": "={{ $json['Convite enviado em'] }}", "Próxima ação": "={{ $json['Próxima ação'] }}"}
    nos = [
        gatilho("evento", "Conversa no WhatsApp", "POST", "whatsapp-conversa", "7c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e502", auth),
        # Responde já: o observador não espera a planilha, e um erro abaixo não o faz reenviar.
        responder("ok", "Recebido", '={{ { "ok": true } }}', 220, -200),
        ler("prumo", "Ler Prospects", PRUMO, PROSPECTS_GID, "Prospects", 220, 0),
        ler("site", "Ler Leads do site", SITE, LEADS_GID, "Leads", 440, 0),
        {"id": "decidir", "name": "Decidir", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": decidir}},
        {"id": "qual", "name": "Qual planilha?", "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": [880, 0],
         "parameters": {"rules": {"values": [
             {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2}, "combinator": "and",
                             "conditions": [{"leftValue": "={{ $json.planilha }}", "rightValue": "prumo", "operator": {"type": "string", "operation": "equals"}}]},
              "renameOutput": True, "outputKey": "PRUMO"},
             {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2}, "combinator": "and",
                             "conditions": [{"leftValue": "={{ $json.planilha }}", "rightValue": "site", "operator": {"type": "string", "operation": "equals"}}]},
              "renameOutput": True, "outputKey": "Site"}]}, "options": {}}},
        {"id": "marcar-prumo", "name": "Marcar no PRUMO", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [1100, -100],
         "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(PRUMO, PROSPECTS_GID, "Prospects"),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["ID"], "value": marca_prumo,
                                    "schema": schema(list(marca_prumo), "ID")},
                        "options": {"cellFormat": "RAW"}}},
        {"id": "marcar-site", "name": "Marcar no Site antes da venda", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
         "position": [1100, 100], "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(SITE, LEADS_GID, "Leads"),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["place_id"],
                                    "value": {"place_id": "={{ $json.place_id }}", "status": "={{ $json.status }}",
                                              "enviado_em": "={{ $json.enviado_em }}", "respondeu_em": "={{ $json.respondeu_em }}"},
                                    "schema": schema(["place_id", "status", "enviado_em", "respondeu_em"], "place_id")},
                        "options": {"cellFormat": "RAW"}}},
    ]
    con = {"Conversa no WhatsApp": {"main": [[{"node": "Recebido", "type": "main", "index": 0}]]},
           "Recebido": {"main": [[{"node": "Ler Prospects", "type": "main", "index": 0}]]},
           "Ler Prospects": {"main": [[{"node": "Ler Leads do site", "type": "main", "index": 0}]]},
           "Ler Leads do site": {"main": [[{"node": "Decidir", "type": "main", "index": 0}]]},
           "Decidir": {"main": [[{"node": "Qual planilha?", "type": "main", "index": 0}]]},
           "Qual planilha?": {"main": [[{"node": "Marcar no PRUMO", "type": "main", "index": 0}],
                                       [{"node": "Marcar no Site antes da venda", "type": "main", "index": 0}]]}}
    publicar({"name": "WhatsApp — conversa com lead (marca sozinho)", "nodes": nos, "connections": con})


if __name__ == "__main__":
    auth = credencial()
    telefones(auth)
    conversa(auth)
