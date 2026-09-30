"""Conversa no WhatsApp marca o lead sozinho (idempotente).

O Rômulo aborda os leads direto no WhatsApp, sem passar pelos links
rastreados, e não tem tempo de voltar à planilha. O observador
(`deploy/dell/whatsapp-observador/observador.py`) lê o log da bridge do Hermes,
que já está vinculado ao número dele, e avisa este n8n quando a conversa é com
um número das planilhas:

- GET  /webhook/whatsapp-telefones  -> {"chaves": [...]}: os números dos leads,
  que o observador usa como filtro (conversa com quem não é lead nunca sai dele);
- POST /webhook/whatsapp-conversa   {"chave", "direcao", "em", "seguinte"?}
  -> {"ok", "marcados": [{"planilha", "nome", "acao", "antes"}]}, respondido
  depois de ler as planilhas e antes de gravar (o observador usa "marcados"
  para avisar "você abordou ..."; um erro na gravação vira aviso de falha).

`direcao`:
- "saida" (30/09/2026): o Rômulo escreveu (linha owner_sent da bridge,
  remendada por deploy/hermes/scripts/patch_bridge_envios.py). Site antes da
  venda: "novo"/"pronto" -> "enviado" + enviado_em (acao "abordou", como o
  clique no wa_link); "recusado"/"expirado" -> "enviado" + enviado_em de agora
  (acao "retomou": o acompanhamento conta de novo; a pasta não muda);
  "enviado"/"fechado": conversa normal, nada muda. PRUMO: Etapa "Revisar" ->
  "Convite enviado" (como o clique em "Enviar convite").
- "entrada": o lead escreveu. PRUMO: Etapa "Revisar" -> "Convite enviado";
  "Convite enviado" -> Próxima ação "Respondeu no WhatsApp ...". Site
  (29/09/2026): "novo"/"pronto" -> "enviado" (+ enviado_em se vazio); resposta a
  5 min ou mais do envio -> respondeu_em (e "expirado" volta a "enviado"). A
  pasta do lead vai para _em-conversa pelo site-pastas do Dell (o Balcão lista
  o que mover).
- "lido" (30/09/2026): o lead leu uma mensagem do Rômulo (recibo azul). Site:
  visto_em, só a primeira vez (lido em "novo"/"pronto" também prova o envio e
  marca "enviado"). PRUMO com "Convite enviado": Próxima ação "Leu o convite em
  ...", se ainda não diz "Respondeu"/"Leu". Quem desligou a confirmação de
  leitura nunca aparece como lido: "entregue sem lido" é "não sei", não "não viu".

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

Uso: python3 whatsapp-conversa.py            publica os dois fluxos e cria a coluna visto_em
     python3 whatsapp-conversa.py --colunas  só a coluna visto_em na aba Leads
     python3 whatsapp-conversa.py --testar   roda o código dos nós no node com planilhas de mentira
     python3 whatsapp-conversa.py --testar-n8n  cópia do fluxo no n8n com planilhas de mentira, sem gravar
"""
import json
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

SHEETS = {"googleSheetsOAuth2Api": {"id": "5Dy1tDUiFtAq7PHj", "name": "Google Sheets account"}}
PRUMO, PROSPECTS_GID = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U", "1838781376"
SITE, LEADS_GID = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o", "396728619"
SEGREDO = Path.home() / ".config/claude-ops/whatsapp-observador-segredo"
CREDENCIAL = "Observador WhatsApp"
COLUNAS_NOVAS = ["visto_em"]

# Mesma regra do observador (observador.py, chave_do_numero).
CHAVE_JS = """const chave = (bruto) => {
  let d = String(bruto ?? '').replace(/\\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return '';
  return d.slice(0, 2) + d.slice(-8);
};
const numeroDoSite = (l) => String(l.wa_me ?? '').match(/wa\\.me\\/(\\d+)/)?.[1] ?? l.telefone ?? '';"""

# Site: "recusado" entra no filtro para o envio do Rômulo poder retomar a conversa (30/09/2026).
MONTAR_JS = CHAVE_JS + """
const prumo = $('Ler Prospects').all().map(i => i.json)
  .filter(l => !['Concluído', 'Sem interesse'].includes(String(l['Etapa'] ?? '').trim()))
  .map(l => chave(l['WhatsApp']));
const site = $('Ler Leads do site').all().map(i => i.json)
  .filter(l => ['novo', 'pronto', 'enviado', 'expirado', 'recusado'].includes(String(l.status ?? '').trim()))
  .map(l => chave(numeroDoSite(l)));
return [{ json: { chaves: [...new Set([...prumo, ...site].filter(Boolean))] } }];"""

DECIDIR_JS = CHAVE_JS + """
const ev = $('Conversa no WhatsApp').first().json.body ?? {};
const alvo = chave(ev.chave);
// saida: o Rômulo escreveu; entrada: o lead escreveu; lido: o lead leu (recibo azul). Outra coisa: nada.
const direcao = ['saida', 'entrada', 'lido'].includes(ev.direcao) ? ev.direcao : '';
// Segundo aviso do observador na mesma conversa: só serve ao Site (resposta depois da saudação).
const seguinte = ev.seguinte === true;
const recebido = ev.em ? new Date(ev.em) : new Date();
const em = Number.isFinite(recebido.getTime()) ? recebido : new Date();
// Saudação automática do WhatsApp Business chega segundos depois do envio; gente demora mais.
const SAUDACAO_MS = 5 * 60 * 1000;
const quando = em.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const txt = (v) => String(v ?? '').trim();
const CONVITE = 'Aguarde o dono responder (16 perguntas, uns 10 minutos). Sem resposta em 3 dias, ofereça fazer por telefone.';
const saida = [];
for (const l of $('Ler Prospects').all().map(i => i.json)) {
  if (!alvo || !direcao || seguinte || chave(l['WhatsApp']) !== alvo) continue;
  const etapa = txt(l['Etapa']);
  const base = { planilha: 'prumo', ID: String(l['ID']), nome: txt(l['Empresa']) || String(l['ID']), antes: etapa };
  if (direcao === 'saida' && etapa === 'Revisar') {
    // O Rômulo escreveu ao prospect: vale o clique em "Enviar convite".
    saida.push({ json: { ...base, acao: 'abordou', 'Etapa': 'Convite enviado', 'Convite enviado em': em.toISOString(), 'Próxima ação': CONVITE } });
  } else if (direcao === 'entrada' && etapa === 'Revisar') {
    // Resposta prova que o contato aconteceu, mesmo sem o link rastreado.
    saida.push({ json: { ...base, acao: 'respondeu', 'Etapa': 'Convite enviado', 'Convite enviado em': em.toISOString(),
      'Próxima ação': 'Respondeu no WhatsApp em ' + quando + '. Continue a conversa.' } });
  } else if (direcao === 'entrada' && etapa === 'Convite enviado') {
    // Reescreve a data do convite com ela mesma: o update grava todas as colunas mapeadas.
    saida.push({ json: { ...base, acao: 'respondeu', 'Etapa': etapa, 'Convite enviado em': String(l['Convite enviado em'] ?? ''),
      'Próxima ação': 'Respondeu no WhatsApp em ' + quando + '. Continue a conversa.' } });
  } else if (direcao === 'lido' && etapa === 'Convite enviado' && !/^(Respondeu|Leu)/.test(txt(l['Próxima ação']))) {
    // Primeira leitura depois do convite; "Respondeu" vale mais e não é sobrescrito.
    saida.push({ json: { ...base, acao: 'leu', 'Etapa': etapa, 'Convite enviado em': String(l['Convite enviado em'] ?? ''),
      'Próxima ação': 'Leu o convite em ' + quando + '. Sem resposta em 3 dias, ofereça fazer por telefone.' } });
  }
}
for (const l of $('Ler Leads do site').all().map(i => i.json)) {
  if (!alvo || !direcao || chave(numeroDoSite(l)) !== alvo) continue;
  const status = txt(l.status);
  const enviadoAntes = txt(l.enviado_em);
  const respondeuAntes = txt(l.respondeu_em);
  const vistoAntes = txt(l.visto_em);
  // O update grava todas as colunas mapeadas: o que não muda vai com o valor de antes.
  const base = { planilha: 'site', place_id: String(l.place_id), nome: txt(l.nome) || String(l.place_id), antes: status,
    status, enviado_em: enviadoAntes, respondeu_em: respondeuAntes, visto_em: vistoAntes };
  // "novo" com site publicado: o Rômulo manda a demo assim que o Hermes avisa, antes de o Balcão passar.
  const aEnviar = status === 'novo' || status === 'pronto';
  if (direcao === 'saida') {
    // Enviado e fechado: conversa normal. Recusado/expirado: retomou, e o acompanhamento conta de novo.
    if (aEnviar) saida.push({ json: { ...base, acao: 'abordou', status: 'enviado', enviado_em: em.toISOString() } });
    else if (status === 'recusado' || status === 'expirado') {
      saida.push({ json: { ...base, acao: 'retomou', status: 'enviado', enviado_em: em.toISOString() } });
    }
    continue;
  }
  if (direcao === 'lido') {
    // Só a primeira leitura. Lido em novo/pronto prova um envio que passou batido.
    if (vistoAntes || !['novo', 'pronto', 'enviado', 'expirado', 'recusado'].includes(status)) continue;
    saida.push({ json: { ...base, acao: 'leu', visto_em: em.toISOString(),
      ...(aEnviar ? { status: 'enviado', enviado_em: enviadoAntes || em.toISOString() } : {}) } });
    continue;
  }
  if (!['novo', 'pronto', 'enviado', 'expirado'].includes(status)) continue;
  // Resposta: prova que o site chegou ao lead.
  const enviado = enviadoAntes || (aEnviar ? em.toISOString() : '');
  // Enviado sem data legível (marcado à mão) conta como envio antigo.
  const desde = Date.parse(enviado);
  const longe = !Number.isFinite(desde) || em.getTime() - desde >= SAUDACAO_MS;
  const respondeu = respondeuAntes || (longe ? em.toISOString() : '');
  const novoStatus = aEnviar || (status === 'expirado' && respondeu) ? 'enviado' : status;
  if (novoStatus === status && enviado === enviadoAntes && respondeu === respondeuAntes) continue;
  saida.push({ json: { ...base, acao: 'respondeu', status: novoStatus, enviado_em: enviado, respondeu_em: respondeu } });
}
// Sempre um item, para a resposta ao observador sair; "nenhuma" não bate em nenhuma saída do switch.
return saida.length ? saida : [{ json: { planilha: 'nenhuma' } }];"""

# Resposta ao observador (expressão do nó "Responder ao observador").
RESPOSTA_JS = ("{ ok: true, marcados: $input.all().filter(i => ['prumo', 'site'].includes(i.json.planilha))"
               ".map(i => ({ planilha: i.json.planilha, nome: i.json.nome, acao: i.json.acao, antes: i.json.antes })) }")


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
    from n8n import api
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
    from n8n import api, put
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
    nos = [
        gatilho("pedir", "Observador pede os números", "GET", "whatsapp-telefones", "7c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e501", auth),
        ler("prumo", "Ler Prospects", PRUMO, PROSPECTS_GID, "Prospects", 220, 0),
        ler("site", "Ler Leads do site", SITE, LEADS_GID, "Leads", 440, 0),
        {"id": "montar", "name": "Montar chaves", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": MONTAR_JS}},
        responder("resp", "Responder", "={{ $json }}", 880, 0),
    ]
    con = {"Observador pede os números": {"main": [[{"node": "Ler Prospects", "type": "main", "index": 0}]]},
           "Ler Prospects": {"main": [[{"node": "Ler Leads do site", "type": "main", "index": 0}]]},
           "Ler Leads do site": {"main": [[{"node": "Montar chaves", "type": "main", "index": 0}]]},
           "Montar chaves": {"main": [[{"node": "Responder", "type": "main", "index": 0}]]}}
    # Roda a cada 10 min só para devolver números: guardar cada execução é ruído.
    publicar({"name": "WhatsApp — números dos leads (para o observador)", "nodes": nos, "connections": con,
              "settings": {"saveDataSuccessExecution": "none"}})


def montar_conversa(auth):
    marca_prumo = {"ID": "={{ $json.ID }}", "Etapa": "={{ $json['Etapa'] }}",
                   "Convite enviado em": "={{ $json['Convite enviado em'] }}", "Próxima ação": "={{ $json['Próxima ação'] }}"}
    marca_site = {c: "={{ $json." + c + " }}" for c in ["place_id", "status", "enviado_em", "respondeu_em", "visto_em"]}
    nos = [
        gatilho("evento", "Conversa no WhatsApp", "POST", "whatsapp-conversa", "7c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e502", auth),
        ler("prumo", "Ler Prospects", PRUMO, PROSPECTS_GID, "Prospects", 220, 0),
        ler("site", "Ler Leads do site", SITE, LEADS_GID, "Leads", 440, 0),
        {"id": "decidir", "name": "Decidir", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0],
         "parameters": {"mode": "runOnceForAllItems", "jsCode": DECIDIR_JS}},
        # Responde depois de ler e antes de gravar: o observador recebe o que vai mudar (para o aviso
        # "você abordou"); leitura que falha volta como erro e o observador tenta de novo mais tarde.
        responder("ok", "Responder ao observador", "={{ " + RESPOSTA_JS + " }}", 880, 0),
        {"id": "qual", "name": "Qual planilha?", "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": [1100, 0],
         "parameters": {"rules": {"values": [
             {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2}, "combinator": "and",
                             "conditions": [{"leftValue": "={{ $json.planilha }}", "rightValue": "prumo", "operator": {"type": "string", "operation": "equals"}}]},
              "renameOutput": True, "outputKey": "PRUMO"},
             {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2}, "combinator": "and",
                             "conditions": [{"leftValue": "={{ $json.planilha }}", "rightValue": "site", "operator": {"type": "string", "operation": "equals"}}]},
              "renameOutput": True, "outputKey": "Site"}]}, "options": {}}},
        {"id": "marcar-prumo", "name": "Marcar no PRUMO", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [1320, -100],
         "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(PRUMO, PROSPECTS_GID, "Prospects"),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["ID"], "value": marca_prumo,
                                    "schema": schema(list(marca_prumo), "ID")},
                        "options": {"cellFormat": "RAW"}}},
        # visto_em só é gravado se a coluna existir (--colunas); sem ela, o n8n ignora o campo.
        {"id": "marcar-site", "name": "Marcar no Site antes da venda", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
         "position": [1320, 100], "credentials": SHEETS, "retryOnFail": True, "maxTries": 3,
         "parameters": {"resource": "sheet", "operation": "update", **doc(SITE, LEADS_GID, "Leads"),
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["place_id"], "value": marca_site,
                                    "schema": schema(list(marca_site), "place_id")},
                        "options": {"cellFormat": "RAW"}}},
    ]
    con = {"Conversa no WhatsApp": {"main": [[{"node": "Ler Prospects", "type": "main", "index": 0}]]},
           "Ler Prospects": {"main": [[{"node": "Ler Leads do site", "type": "main", "index": 0}]]},
           "Ler Leads do site": {"main": [[{"node": "Decidir", "type": "main", "index": 0}]]},
           "Decidir": {"main": [[{"node": "Responder ao observador", "type": "main", "index": 0}]]},
           "Responder ao observador": {"main": [[{"node": "Qual planilha?", "type": "main", "index": 0}]]},
           "Qual planilha?": {"main": [[{"node": "Marcar no PRUMO", "type": "main", "index": 0}],
                                       [{"node": "Marcar no Site antes da venda", "type": "main", "index": 0}]]}}
    return {"name": "WhatsApp — conversa com lead (marca sozinho)", "nodes": nos, "connections": con}


def conversa(auth):
    publicar(montar_conversa(auth))


def colunas():
    """Acrescenta visto_em no fim do cabeçalho da aba Leads, se faltar (os fluxos escrevem pelo nome)."""
    from sheets_proxy import SheetsProxy
    with SheetsProxy([SITE]) as s:
        meta = s.get(f"/v4/spreadsheets/{SITE}?fields=sheets.properties")
        props = next(x["properties"] for x in meta["sheets"] if str(x["properties"]["sheetId"]) == LEADS_GID)
        cab = (s.get(f"/v4/spreadsheets/{SITE}/values/" + quote("Leads!1:1")).get("values") or [[]])[0]
        faltam = [c for c in COLUNAS_NOVAS if c not in cab]
        if not faltam:
            print("Leads: coluna já existe:", ", ".join(COLUNAS_NOVAS))
            return
        grade = props["gridProperties"]["columnCount"]
        if len(cab) + len(faltam) > grade:
            s.post(f"/v4/spreadsheets/{SITE}:batchUpdate", {"requests": [{"appendDimension": {
                "sheetId": int(LEADS_GID), "dimension": "COLUMNS", "length": len(cab) + len(faltam) - grade}}]})
        letra = lambda n: (letra(n // 26 - 1) if n >= 26 else "") + chr(ord("A") + n % 26)
        faixa = f"Leads!{letra(len(cab))}1:{letra(len(cab) + len(faltam) - 1)}1"
        s.post(f"/v4/spreadsheets/{SITE}/values:batchUpdate",
               {"valueInputOption": "RAW", "data": [{"range": faixa, "values": [faltam]}]})
        print(f"Leads: coluna nova em {faixa}:", ", ".join(faltam))


# ---------------------------------------------------------------- testes (sem n8n nem planilha)

def rodar_no(codigo: str, dados: dict):
    """Roda o código de um nó Code no node, com `$('Nó')` devolvendo `dados`."""
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    prog = ("const dados = " + json.dumps(dados, ensure_ascii=False) + ";\n"
            "const $ = (n) => ({ all: () => (dados[n] ?? []).map(json => ({ json })), first: () => ({ json: dados[n] }) });\n"
            "const itens = (() => {\n" + codigo + "\n})();\n"
            "const $input = { all: () => itens };\n"
            "console.log(JSON.stringify({ itens: itens.map(i => i.json), resposta: " + RESPOSTA_JS + " }));\n")
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "no.mjs"
        arq.write_text(prog, encoding="utf-8")
        r = subprocess.run([str(exe), str(arq)], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def testar() -> int:
    import unittest

    LEAD, OUTRO = "27999887766", "11988887777"  # números de mentira
    AGORA = "2026-09-30T10:00:00-0300"

    def site(status, **k):
        return {"place_id": "pid-1", "nome": "Padaria Teste", "wa_me": f"https://wa.me/55{LEAD}", "status": status,
                "enviado_em": "", "respondeu_em": "", "visto_em": "", **k}

    def prumo(etapa, **k):
        return {"ID": "ID-1", "Empresa": "Oficina Teste", "WhatsApp": f"({LEAD[:2]}) {LEAD[2:]}", "Etapa": etapa,
                "Convite enviado em": "", "Próxima ação": "", **k}

    def decidir(direcao, sites=(), prumos=(), chave=LEAD, **ev):
        dados = {"Conversa no WhatsApp": {"body": {"chave": chave, "direcao": direcao, "em": AGORA, **ev}},
                 "Ler Prospects": list(prumos), "Ler Leads do site": list(sites)}
        r = rodar_no(DECIDIR_JS, dados)
        return [i for i in r["itens"] if i.get("planilha") != "nenhuma"], r["resposta"]

    class Envio(unittest.TestCase):
        def test_site_novo_e_pronto_viram_enviado(self):
            for st in ("novo", "pronto"):
                itens, resp = decidir("saida", [site(st)])
                self.assertEqual(len(itens), 1)
                self.assertEqual((itens[0]["status"], itens[0]["enviado_em"], itens[0]["acao"]),
                                 ("enviado", "2026-09-30T13:00:00.000Z", "abordou"))
                self.assertEqual(resp["marcados"], [{"planilha": "site", "nome": "Padaria Teste", "acao": "abordou", "antes": st}])

        def test_site_recusado_e_expirado_voltam_a_enviado(self):
            for st in ("recusado", "expirado"):
                itens, _ = decidir("saida", [site(st, enviado_em="2026-09-01T12:00:00Z", respondeu_em="2026-09-02T12:00:00Z")])
                self.assertEqual((itens[0]["status"], itens[0]["acao"], itens[0]["enviado_em"], itens[0]["respondeu_em"]),
                                 ("enviado", "retomou", "2026-09-30T13:00:00.000Z", "2026-09-02T12:00:00Z"))

        def test_conversa_normal_nao_muda_nada(self):
            for st in ("enviado", "fechado"):
                itens, resp = decidir("saida", [site(st, enviado_em="2026-09-29T12:00:00Z")])
                self.assertEqual(itens, [])
                self.assertEqual(resp, {"ok": True, "marcados": []})

        def test_prumo_revisar_vira_convite_enviado(self):
            itens, resp = decidir("saida", prumos=[prumo("Revisar")])
            self.assertEqual((itens[0]["Etapa"], itens[0]["acao"]), ("Convite enviado", "abordou"))
            self.assertTrue(itens[0]["Próxima ação"].startswith("Aguarde o dono responder"))
            self.assertEqual(resp["marcados"][0]["nome"], "Oficina Teste")
            self.assertEqual(decidir("saida", prumos=[prumo("Convite enviado")])[0], [])

        def test_numero_que_nao_e_lead(self):
            self.assertEqual(decidir("saida", [site("novo")], [prumo("Revisar")], chave=OUTRO)[0], [])
            self.assertEqual(decidir("saida", [site("novo")], chave="")[0], [])

        def test_direcao_desconhecida_nao_vira_envio(self):
            self.assertEqual(decidir("outra", [site("novo")], [prumo("Revisar")])[0], [])

    class Lido(unittest.TestCase):
        def test_site_primeira_leitura(self):
            itens, resp = decidir("lido", [site("enviado", enviado_em="2026-09-29T12:00:00Z")])
            self.assertEqual((itens[0]["visto_em"], itens[0]["status"], itens[0]["acao"]),
                             ("2026-09-30T13:00:00.000Z", "enviado", "leu"))
            self.assertEqual(decidir("lido", [site("enviado", visto_em="2026-09-29T15:00:00Z")])[0], [])
            self.assertEqual(decidir("lido", [site("fechado")])[0], [])

        def test_site_lido_em_pronto_prova_o_envio(self):
            itens, _ = decidir("lido", [site("pronto")])
            self.assertEqual((itens[0]["status"], itens[0]["enviado_em"]), ("enviado", "2026-09-30T13:00:00.000Z"))

        def test_prumo_leu_o_convite(self):
            itens, _ = decidir("lido", prumos=[prumo("Convite enviado", **{"Convite enviado em": "2026-09-29T12:00:00Z"})])
            self.assertTrue(itens[0]["Próxima ação"].startswith("Leu o convite em 30/09"))
            self.assertEqual(itens[0]["Convite enviado em"], "2026-09-29T12:00:00Z")
            respondeu = prumo("Convite enviado", **{"Próxima ação": "Respondeu no WhatsApp em 29/09, 10:00."})
            self.assertEqual(decidir("lido", prumos=[respondeu])[0], [])
            self.assertEqual(decidir("lido", prumos=[prumo("Revisar")])[0], [])

    class Resposta(unittest.TestCase):
        """A regra de 29/09 não mudou."""

        def test_saudacao_so_prova_o_envio(self):
            itens, _ = decidir("entrada", [site("pronto")])
            self.assertEqual((itens[0]["status"], itens[0]["respondeu_em"]), ("enviado", ""))

        def test_resposta_depois_de_5_min(self):
            itens, _ = decidir("entrada", [site("enviado", enviado_em="2026-09-30T12:50:00Z")])
            self.assertEqual(itens[0]["respondeu_em"], "2026-09-30T13:00:00.000Z")
            self.assertEqual(decidir("entrada", [site("enviado", enviado_em="2026-09-30T12:58:00Z")])[0], [])

        def test_recusado_nao_responde(self):
            self.assertEqual(decidir("entrada", [site("recusado", enviado_em="2026-09-01T12:00:00Z")])[0], [])

        def test_prumo_ignora_o_segundo_aviso(self):
            self.assertEqual(decidir("entrada", prumos=[prumo("Revisar")], seguinte=True)[0], [])
            itens, _ = decidir("entrada", prumos=[prumo("Convite enviado")])
            self.assertTrue(itens[0]["Próxima ação"].startswith("Respondeu no WhatsApp"))

    class Numeros(unittest.TestCase):
        def test_filtro(self):
            dados = {"Ler Prospects": [prumo("Revisar"), prumo("Sem interesse", WhatsApp="11 91111-2222")],
                     "Ler Leads do site": [site("recusado"), site("fechado", wa_me="https://wa.me/5521933334444")]}
            prog = MONTAR_JS
            exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
            with tempfile.TemporaryDirectory() as d:
                arq = Path(d) / "m.mjs"
                arq.write_text("const dados = " + json.dumps(dados) + ";\nconst $ = (n) => ({ all: () => dados[n].map(json => ({ json })) });\n"
                               "console.log(JSON.stringify((() => {\n" + prog + "\n})()[0].json));", encoding="utf-8")
                r = json.loads(subprocess.run([str(exe), str(arq)], capture_output=True, text=True, check=True).stdout)
            self.assertEqual(r["chaves"], [LEAD[:2] + LEAD[-8:]])  # recusado entra; fechado e "Sem interesse", não

    carga = unittest.TestLoader()
    suite = unittest.TestSuite(carga.loadTestsFromTestCase(c) for c in (Envio, Lido, Resposta, Numeros))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


def testar_n8n() -> int:
    """Cópia do fluxo no n8n com planilhas de mentira (nós Code) e gravação desligada (NoOp), num
    webhook temporário, sem header e sem Error Workflow: confere a fiação (resposta no meio, switch com
    "nenhuma") sem credencial Google e sem gravar nada. Apaga a cópia no fim."""
    import time
    import urllib.request
    import uuid
    from n8n import api
    lead, outro = "27999887766", "11900001111"  # fictícios
    prospects = [{"ID": "ID-T", "Empresa": "Oficina Teste", "WhatsApp": lead, "Etapa": "Revisar",
                  "Convite enviado em": "", "Próxima ação": ""}]
    leads = [{"place_id": "pid-T", "nome": "Padaria Teste", "wa_me": f"https://wa.me/55{lead}", "status": "enviado",
              "enviado_em": "2026-09-29T12:00:00Z", "respondeu_em": "", "visto_em": ""}]
    caminho = f"whatsapp-conversa-teste-{int(time.time())}"
    wf = montar_conversa(None)
    for n in wf["nodes"]:
        if n["name"] == "Conversa no WhatsApp":
            n.pop("credentials", None)
            n["webhookId"] = str(uuid.uuid4())
            n["parameters"] = {**n["parameters"], "path": caminho, "authentication": "none"}
        elif n["name"] in ("Ler Prospects", "Ler Leads do site"):
            linhas = prospects if n["name"] == "Ler Prospects" else leads
            n.update(type="n8n-nodes-base.code", typeVersion=2,
                     parameters={"mode": "runOnceForAllItems", "jsCode": "return " + json.dumps(linhas) + ".map(json => ({ json }));"})
            n.pop("credentials", None)
        elif n["name"].startswith("Marcar"):
            n.update(type="n8n-nodes-base.noOp", typeVersion=1, parameters={})
            n.pop("credentials", None)
    t = api("POST", "/workflows", {"name": "ZZ testar conversa WhatsApp (apagar)", "nodes": wf["nodes"],
                                   "connections": wf["connections"], "settings": {"executionOrder": "v1"}})
    casos = [
        ({"chave": outro, "direcao": "saida", "em": "2026-09-30T10:00:00-0300"}, []),
        ({"chave": lead, "direcao": "saida", "em": "2026-09-30T10:00:00-0300"},
         [{"planilha": "prumo", "nome": "Oficina Teste", "acao": "abordou", "antes": "Revisar"}]),
        ({"chave": lead, "direcao": "lido", "em": "2026-09-30T10:05:00-0300"},
         [{"planilha": "site", "nome": "Padaria Teste", "acao": "leu", "antes": "enviado"}]),
        ({"chave": lead, "direcao": "entrada", "em": "2026-09-30T10:10:00-0300"},
         [{"planilha": "prumo", "nome": "Oficina Teste", "acao": "respondeu", "antes": "Revisar"},
          {"planilha": "site", "nome": "Padaria Teste", "acao": "respondeu", "antes": "enviado"}]),
    ]
    ok = True
    try:
        api("POST", f"/workflows/{t['id']}/activate")
        time.sleep(2)
        for corpo, esperado in casos:
            req = urllib.request.Request(f"http://127.0.0.1:5679/webhook/{caminho}", method="POST",
                                         data=json.dumps(corpo).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                resposta = json.loads(r.read() or b"{}")
            certo = resposta == {"ok": True, "marcados": esperado}
            ok &= certo
            print("ok  " if certo else "ERRO", corpo["direcao"], "numero de mentira", "->", json.dumps(resposta, ensure_ascii=False))
        time.sleep(2)
        execs = api("GET", f"/executions?workflowId={t['id']}&limit=20")["data"]
        status = sorted(e["status"] for e in execs)
        print("execuções:", status)
        ok &= status == ["success"] * len(casos)
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--testar" in sys.argv:
        sys.exit(testar())
    if "--testar-n8n" in sys.argv:
        sys.exit(testar_n8n())
    if "--colunas" in sys.argv:
        colunas()
        sys.exit(0)
    auth = credencial()
    telefones(auth)
    conversa(auth)
    try:
        colunas()
    except Exception as e:  # noqa: BLE001 — os fluxos já estão no ar; a coluna pode vir depois
        print(f"coluna visto_em não criada ({e}); rode de novo com --colunas quando a credencial Google estiver ok")
