"""CRM da Central (Site antes da venda + PRUMO), 30/09/2026. Idempotente: recria pelo nome.

14/10/2026, PRUMO como holding: o retrato também lê as abas Clínicas (Iris) e
Estamparias (CRM de estamparia) da planilha do PRUMO, criadas por
prumo-ofertas.py. Aba que falta ou não lê não segura o retrato (só Leads e
Prospects seguram): a Central mostra a fonte com o erro. O nome do fluxo fica o
mesmo de propósito: publicar() troca pelo nome, e um nome novo deixaria o antigo
ligado ao lado.

Pedido do Rômulo: "não sei quem viu, quem não viu, quem já respondeu, quem
recusou" e "pense numa forma simplificada de um CRM" para os leads do Site
antes da venda e os prospects do PRUMO. A fonte da verdade continua sendo as
planilhas; a Central só lê um retrato delas e, para o que um CRM precisa à mão
(nota, próximo passo com data, proposta enviada), grava pela aba CRM.

"08 · CRM: retrato e registros (Site antes da venda + PRUMO)", três entradas:

- A cada 10 min e POST /webhook/crm-atualizar (header X-CRM): hoje só o
  `python3 crm.py --agora` o chama, para pedir um retrato na hora; nenhum outro fluxo
  o usa (o registro da Central já refaz o retrato sozinho). Lê as abas Leads (Site), Prospects
  (PRUMO) e CRM e grava estado/crm.json (versão 1: as linhas com o cabeçalho
  como veio, sem colunas pesadas ou de contato cru; a Central decide as
  etapas em server/crm.ts). Leitura que falha (credencial do Google, cota)
  não apaga o retrato bom: grava estado/crm-falha.json e a Central mostra o
  retrato anterior com o aviso.
- POST /webhook/crm-registro (header X-CRM; só o servidor da Central tem o
  segredo): acrescenta uma linha na aba CRM {em, produto, id, empresa, tipo,
  texto, data, origem} com tipo nota | proximo_passo | proposta |
  proposta_desfeita | sem_contato | sem_contato_desfeito | segunda_enviada |
  followup_enviado (14/10/2026: o toque em "Mandar o link"/"Mandar o follow-up"
  na Central anota o envio) | plus_enviado | plus_respondeu (15/10/2026: o filtro
  Plus, produto "plus", não tem planilha: o estado dele sai só destas linhas) |
  recusou | recusou_desfeito (17/10/2026, OT-06 do blueprint: o desfecho que a
  conversa sugere e o Rômulo confirma na Central; texto e data vazios, como
  sem_contato) | ganhou | ganhou_desfeito | dispensado | dispensado_desfeito
  (17/10/2026, AC-08 e AC-10 da auditoria: o "Fechou" de qualquer oferta,
  Plus incluído, e o "Dispensar" da Triagem; texto opcional, data do dia que a
  Central manda), responde {ok} e refaz o retrato na hora. Nada vai
  para lead nenhum.

Segredo: ~/.config/claude-ops/crm-segredo (600), nasce aqui e nunca é impresso;
credencial "CRM Central" (Header Auth X-CRM) no n8n. O "Atualizar agora" atende
POST http://127.0.0.1:5679/webhook/crm-atualizar (a porta é a do host, LOCAL abaixo)
com essa credencial; quem quiser pedir o retrato depois de um evento usa o mesmo caminho.

Uso: python3 crm.py              aba CRM (se faltar) + credencial + publica e ativa o 08
     python3 crm.py --aba        só cria a aba CRM com o cabeçalho (precisa da credencial do Google viva)
     python3 crm.py --testar     cópia com planilhas de mentira, sem gravar nada: retrato, falha de leitura,
                                 registro válido, inválido e sem segredo
     python3 crm.py --agora      pede um retrato agora ao fluxo publicado (loopback)
"""
import copy
import importlib.util
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from urllib.parse import quote

from n8n import api

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("site_antes_da_venda", AQUI / "site-antes-da-venda.py")
sv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sv)

NOME = "08 · CRM: retrato e registros (Site antes da venda + PRUMO)"
SITE, SHEETS = sv.PLANILHA, sv.SHEETS
LEADS_GID = "396728619"
PRUMO, PROSPECTS_GID = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U", "1838781376"
# Ofertas novas do PRUMO (prumo-ofertas.py): lidas pelo nome da aba, o gid só serve ao link.
ABAS_DAS_OFERTAS = {"iris": "Clínicas", "estampa": "Estamparias"}
ABA_CRM = "CRM"
COLUNAS_CRM = ["em", "produto", "id", "empresa", "tipo", "texto", "data", "origem"]
LINKS = "https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook"
LOCAL = "http://127.0.0.1:5679/webhook"
ESTADO = "/home/node/.n8n-files/estado/"
SEGREDO = Path.home() / ".config/claude-ops/crm-segredo"
CREDENCIAL = "CRM Central"
BACKUPS = Path.home() / ".local/share/claude-ops/backups" / date.today().isoformat()

def montar_js(gids=None):
    """O código do "Montar retrato"; `gids` ({"iris": "123"...}) só completa os links das abas novas."""
    gids = gids or {}
    link = lambda oferta: f"https://docs.google.com/spreadsheets/d/{PRUMO}/edit" + (f"#gid={gids[oferta]}" if gids.get(oferta) else "")
    return MONTAR_JS.replace("%(IRIS_LINK)s", link("iris")).replace("%(ESTAMPA_LINK)s", link("estampa"))


MONTAR_JS = """// Retrato para a Central (server/crm.ts decide as etapas). Linhas como vieram da planilha,
// menos colunas pesadas e contato cru: o link do WhatsApp sai de wa_me (Site) e WhatsApp (PRUMO).
const txt = (v) => String(v ?? '').trim();
const norm = (k) => String(k).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
// Google Maps e Nota Google entram desde 14/10/2026: a revisão dos prospects (Iris, estamparias, PRUMO)
// mostra a nota e abre o Maps. O telefone do Google segue fora (contato cru; o WhatsApp vem na coluna dele).
const FORA = new Set(['briefing', 'endereco', 'telefone', 'telefone_no_google', 'instagram', 'maps_url', 'nota', 'avaliacoes', 'content_md']);
// Porte pelo CNPJ (15/10/2026): o Briefing fica fora (texto longo), mas a classe da Receita que o filtro de
// porte do Lead Scout grava no começo dele ("CNPJ 12.345.678/0001-90 · EPP · capital ...", prumo-porte-cnpj.js)
// vai sozinha na coluna porte: "EPP", "DEMAIS" ou vazia (não conferido). server/crm.ts decide o resto.
const porteDoBriefing = (l) => {
  const partes = txt(l['Briefing']).split(' · ');
  if (!partes[0].startsWith('CNPJ ')) return '';
  return partes[1] === 'EPP' ? 'EPP' : partes[1] === 'porte DEMAIS' ? 'DEMAIS' : '';
};
// `extra`: colunas calculadas da linha crua (antes de tirar as de FORA).
const ler = (no, chave, extra) => {
  let itens;
  try { itens = $(no).all(); } catch (e) { return { colunas: [], linhas: [], erro: 'o nó "' + no + '" não rodou' }; }
  const falha = itens.map(i => i.json && i.json.error).find(Boolean);
  if (falha) return { colunas: [], linhas: [], erro: String(falha.message ?? falha).slice(0, 300) };
  const colunas = [...new Set(itens.flatMap(i => Object.keys(i.json ?? {})))].filter(k => !FORA.has(norm(k)));
  const linhas = itens.map(i => i.json ?? {}).filter(l => txt(l[chave]))
    // wa_me e wa_link levam a mensagem inteira codificada: cortados em 500, a fila de envio
    // mostrava a primeira mensagem pela metade (26 de 39 em 08/10/2026).
    // Notas e propostas aceitam 1000 caracteres no registro; o retrato deve preservá-los.
    // Cortar JSON do aprendizado em 500 fazia a nota salva sumir na próxima leitura.
    .map(l => ({ ...Object.fromEntries(colunas.map(k => [k, txt(l[k]).slice(0, norm(k).startsWith('wa_') ? 4000 : norm(k) === 'texto' ? 1000 : 500)])),
      ...(extra ? extra(l) : {}) }));
  return { colunas: extra ? [...colunas, ...Object.keys(extra({}))] : colunas, linhas };
};
const site = ler('Ler Leads', 'place_id');
const prumo = ler('Ler Prospects', 'ID', (l) => ({ porte: porteDoBriefing(l) }));
// Iris e estamparias (14/10/2026): aba que falha vira fonte com erro, sem segurar o retrato.
const iris = ler('Ler Clínicas', 'ID');
const estampa = ler('Ler Estamparias', 'ID');
const registros = ler('Ler aba CRM', 'id');
const agora = new Date().toISOString();
const arquivo = (nome, dados) => [{ json: { arquivo: nome, site: site.linhas.length, prumo: prumo.linhas.length, iris: iris.linhas.length,
  estampa: estampa.linhas.length, registros: registros.linhas.length,
  porte: prumo.linhas.filter(l => l.porte).length, erro: dados.erro ?? '' }, binary: { data: { data: Buffer.from(JSON.stringify(dados), 'utf8').toString('base64'),
  mimeType: 'application/json', fileName: nome } } }];
// Sem Leads ou sem Prospects o retrato ficaria vazio: o anterior continua valendo e a Central mostra a falha.
if (site.erro || prumo.erro) {
  return arquivo('crm-falha.json', { falhouEm: agora, erro: site.erro ? 'Leads: ' + site.erro : 'Prospects: ' + prumo.erro });
}
return arquivo('crm.json', {
  versao: 1, geradoEm: agora, origem: $execution.mode,
  links: { webhook: '%(LINKS)s', planilhaSite: 'https://docs.google.com/spreadsheets/d/%(SITE)s/edit#gid=%(LEADS_GID)s',
    planilhaPrumo: 'https://docs.google.com/spreadsheets/d/%(PRUMO)s/edit#gid=%(PROSPECTS_GID)s',
    planilhaIris: '%%(IRIS_LINK)s', planilhaEstampa: '%%(ESTAMPA_LINK)s',
    planilhaCrm: 'https://docs.google.com/spreadsheets/d/%(SITE)s/edit' },
  fontes: {
    site: { planilha: 'Leads — Site antes da venda', aba: 'Leads', ...site },
    prumo: { planilha: 'PRUMO — Fila de revisão', aba: 'Prospects', ...prumo },
    iris: { planilha: 'PRUMO — Fila de revisão', aba: 'Clínicas', ...iris },
    estampa: { planilha: 'PRUMO — Fila de revisão', aba: 'Estamparias', ...estampa },
    registros: { planilha: 'Leads — Site antes da venda', aba: '%(ABA_CRM)s', ...registros },
  },
});""" % {"LINKS": LINKS, "SITE": SITE, "LEADS_GID": LEADS_GID, "PRUMO": PRUMO, "PROSPECTS_GID": PROSPECTS_GID, "ABA_CRM": ABA_CRM}

VALIDAR_JS = """// Registro da Central. O servidor dela já validou; aqui confere de novo antes da planilha.
const b = $('Registro da Central').first().json.body ?? {};
const txt = (v, n) => String(v ?? '').replace(/[\\u0000-\\u0008\\u000b-\\u001f\\u007f]/g, ' ').trim().slice(0, n);
const TIPOS = ['nota', 'proximo_passo', 'proposta', 'proposta_desfeita', 'sem_contato', 'sem_contato_desfeito',
  'segunda_enviada', 'followup_enviado', 'plus_enviado', 'plus_respondeu', 'recusou', 'recusou_desfeito',
  'ganhou', 'ganhou_desfeito', 'dispensado', 'dispensado_desfeito'];
const recusa = (erro) => [{ json: { ok: false, erro } }];
if (!['site', 'prumo', 'iris', 'estampa', 'plus'].includes(b.produto)) return recusa('Produto inválido.');
const id = txt(b.id, 200);
if (!/^[A-Za-z0-9_-]{3,200}$/.test(id)) return recusa('Lead inválido.');
if (!TIPOS.includes(b.tipo)) return recusa('Tipo de registro inválido.');
const texto = txt(b.texto, 1000);
const data = txt(b.data, 10);
if (data && !/^\\d{4}-\\d{2}-\\d{2}$/.test(data)) return recusa('Data inválida.');
if (b.tipo === 'nota' && !texto) return recusa('Nota vazia.');
const em = new Date().toISOString();
return [{ json: { ok: true, em, linha: { em, produto: b.produto, id, empresa: txt(b.empresa, 120), tipo: b.tipo, texto, data, origem: 'Central' } } }];"""


# ------------------------------------------------------------------ nós

def rl(planilha, gid=None, nome=None):
    return {"documentId": {"__rl": True, "mode": "id", "value": planilha},
            "sheetName": ({"__rl": True, "mode": "id", "value": gid} if gid else {"__rl": True, "mode": "name", "value": nome})}


def ler(no_id, nome, planilha, x, y, gid=None, aba=None):
    # Falha de leitura vira item com "error" (o Montar decide); sem isso cada rodada de 10 min
    # com a credencial caída viraria um WhatsApp do Error Workflow.
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [x, y],
            "credentials": SHEETS, "executeOnce": True, "alwaysOutputData": True, "onError": "continueRegularOutput",
            "retryOnFail": True, "maxTries": 2, "waitBetweenTries": 3000,
            "parameters": {"resource": "sheet", "operation": "read", **rl(planilha, gid, aba), "options": {}}}


def code(no_id, nome, js, x, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, y],
            "parameters": {"mode": "runOnceForAllItems", "jsCode": js}}


def se(no_id, nome, expr, x, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [x, y],
            "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                                          "combinator": "and",
                                          "conditions": [{"id": no_id, "leftValue": expr, "rightValue": "",
                                                          "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]},
                           "options": {}}}


def webhook(no_id, nome, caminho, webhook_id, y, auth, modo):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, y],
            "webhookId": webhook_id, "credentials": auth,
            "parameters": {"httpMethod": "POST", "path": caminho, "authentication": "headerAuth", "responseMode": modo, "options": {}}}


def responder(no_id, nome, corpo, x, y, codigo=200):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [x, y],
            "parameters": {"respondWith": "json", "responseBody": corpo, "options": {"responseCode": codigo}}}


def liga(con, a, b, saida=0):
    lista = con.setdefault(a, {"main": []})["main"]
    while len(lista) <= saida:
        lista.append([])
    lista[saida].append({"node": b, "type": "main", "index": 0})


def gids_das_ofertas():
    """gid das abas Clínicas e Estamparias, só para o link; sem a credencial viva, link sem gid."""
    try:
        from sheets_proxy import SheetsProxy
        with SheetsProxy([PRUMO]) as s:
            abas = {a["properties"]["title"]: str(a["properties"]["sheetId"])
                    for a in s.get(f"/v4/spreadsheets/{PRUMO}?fields=sheets.properties")["sheets"]}
        return {oferta: abas[aba] for oferta, aba in ABAS_DAS_OFERTAS.items() if aba in abas}
    except (SystemExit, Exception) as e:  # noqa: BLE001
        print(f"gids das ofertas: não deu para ler agora ({str(e)[:120]}); links sem gid.")
        return {}


def fluxo(erro, auth, gids=None):
    gravar_registro = {
        "id": "registro-gravar", "name": "Gravar na aba CRM", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
        "position": [880, 300], "credentials": SHEETS, "onError": "continueRegularOutput", "retryOnFail": True, "maxTries": 2,
        "waitBetweenTries": 2000,
        "parameters": {"resource": "sheet", "operation": "append", **rl(SITE, nome=ABA_CRM),
                       "columns": {"mappingMode": "defineBelow", "matchingColumns": [],
                                   "value": {c: "={{ $json.linha." + c + " }}" for c in COLUNAS_CRM},
                                   "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": False, "display": True,
                                               "type": "string", "canBeUsedToMatch": False} for c in COLUNAS_CRM]},
                       # RAW: texto que começa com "=" fica texto, nunca vira fórmula.
                       "options": {"cellFormat": "RAW"}}}
    nos = [
        {"id": "dez", "name": "A cada 10 min", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
         "parameters": {"rule": {"interval": [{"field": "minutes", "minutesInterval": 10}]}}},
        webhook("atualizar", "Atualizar agora", "crm-atualizar", "8c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e801", 150, auth, "onReceived"),
        webhook("registro", "Registro da Central", "crm-registro", "8c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e802", 300, auth, "responseNode"),
        code("registro-validar", "Validar registro", VALIDAR_JS, 220, 300),
        se("registro-valido", "Registro válido?", "={{ $json.ok }}", 440, 300),
        responder("registro-recusa", "Responder recusa", '={{ { "ok": false, "erro": $json.erro } }}', 660, 450, 400),
        gravar_registro,
        se("registro-gravou", "Gravou?", "={{ !$json.error }}", 1100, 300),
        responder("registro-ok", "Responder ok", '={{ { "ok": true, "em": $(\'Validar registro\').first().json.em } }}', 1320, 250),
        responder("registro-falha", "Responder falha",
                  '={{ { "ok": false, "erro": "A planilha não gravou: " + String($json.error?.message ?? $json.error ?? "erro desconhecido").slice(0, 200) } }}',
                  1320, 450, 502),
        ler("ler-leads", "Ler Leads", SITE, 1540, 0, gid=LEADS_GID),
        ler("ler-prospects", "Ler Prospects", PRUMO, 1760, 0, gid=PROSPECTS_GID),
        ler("ler-clinicas", "Ler Clínicas", PRUMO, 1980, 0, aba=ABAS_DAS_OFERTAS["iris"]),
        ler("ler-estamparias", "Ler Estamparias", PRUMO, 2200, 0, aba=ABAS_DAS_OFERTAS["estampa"]),
        ler("ler-crm", "Ler aba CRM", SITE, 2420, 0, aba=ABA_CRM),
        code("montar", "Montar retrato", montar_js(gids), 2640, 0),
        {"id": "gravar", "name": "Gravar retrato", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1, "position": [2860, 0],
         "parameters": {"operation": "write", "dataPropertyName": "data", "fileName": "={{ '" + ESTADO + "' + $json.arquivo }}"}},
    ]
    con = {}
    liga(con, "A cada 10 min", "Ler Leads")
    liga(con, "Atualizar agora", "Ler Leads")
    liga(con, "Registro da Central", "Validar registro")
    liga(con, "Validar registro", "Registro válido?")
    liga(con, "Registro válido?", "Gravar na aba CRM", 0)
    liga(con, "Registro válido?", "Responder recusa", 1)
    liga(con, "Gravar na aba CRM", "Gravou?")
    liga(con, "Gravou?", "Responder ok", 0)
    liga(con, "Gravou?", "Responder falha", 1)
    # Depois de responder, o retrato é refeito: a Central vê a nota em segundos.
    liga(con, "Responder ok", "Ler Leads")
    cadeia = ["Ler Leads", "Ler Prospects", "Ler Clínicas", "Ler Estamparias", "Ler aba CRM", "Montar retrato", "Gravar retrato"]
    for a, b in zip(cadeia, cadeia[1:]):
        liga(con, a, b)
    return {"name": NOME, "nodes": nos, "connections": con,
            # Roda a cada 10 min: guardar toda execução bem-sucedida é ruído (as com erro ficam).
            "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro,
                         "saveDataSuccessExecution": "none"}}


# ------------------------------------------------------------------ credencial, aba, publicar

def segredo():
    if not SEGREDO.exists():
        SEGREDO.parent.mkdir(parents=True, exist_ok=True)
        SEGREDO.write_text(secrets.token_urlsafe(32))
        SEGREDO.chmod(0o600)
    return SEGREDO.read_text().strip()


def credencial():
    """Header Auth X-CRM. O segredo nasce em SEGREDO e nunca é impresso."""
    valor = segredo()
    existentes = [c for c in api("GET", "/credentials?limit=100")["data"] if c["name"] == CREDENCIAL]
    if existentes:
        return {"httpHeaderAuth": {"id": existentes[0]["id"], "name": CREDENCIAL}}
    criada = api("POST", "/credentials", {"name": CREDENCIAL, "type": "httpHeaderAuth", "data": {"name": "X-CRM", "value": valor}})
    return {"httpHeaderAuth": {"id": criada["id"], "name": CREDENCIAL}}


def aba():
    """Cria a aba CRM com o cabeçalho, se faltar. Não mexe em nenhuma outra aba."""
    from sheets_proxy import SheetsProxy
    with SheetsProxy([SITE]) as s:
        meta = s.get(f"/v4/spreadsheets/{SITE}?fields=sheets.properties")
        existentes = {x["properties"]["title"]: x["properties"]["sheetId"] for x in meta["sheets"]}
        if ABA_CRM not in existentes:
            r = s.post(f"/v4/spreadsheets/{SITE}:batchUpdate", {"requests": [{"addSheet": {"properties": {
                "title": ABA_CRM, "gridProperties": {"rowCount": 1000, "columnCount": len(COLUNAS_CRM), "frozenRowCount": 1}}}}]})
            print(f"aba {ABA_CRM}: criada (gid {r['replies'][0]['addSheet']['properties']['sheetId']})")
        cab = (s.get(f"/v4/spreadsheets/{SITE}/values/" + quote(f"{ABA_CRM}!1:1")).get("values") or [[]])[0]
        if cab[:len(COLUNAS_CRM)] != COLUNAS_CRM:
            if any(cab):
                raise SystemExit(f"aba {ABA_CRM} já existe com outro cabeçalho: {cab}. Nada foi mudado.")
            s.post(f"/v4/spreadsheets/{SITE}/values:batchUpdate",
                   {"valueInputOption": "RAW", "data": [{"range": f"{ABA_CRM}!A1", "values": [COLUNAS_CRM]}]})
            print(f"aba {ABA_CRM}: cabeçalho gravado ({', '.join(COLUNAS_CRM)})")
        else:
            print(f"aba {ABA_CRM}: já pronta")


def backup(wid, sufixo):
    BACKUPS.mkdir(parents=True, exist_ok=True)
    wf = api("GET", f"/workflows/{wid}")
    arquivo = BACKUPS / f"crm-{wid}-{sufixo}.json"
    arquivo.write_text(json.dumps(wf, ensure_ascii=False, indent=1))
    return arquivo


def publicar(wf):
    existentes = [w for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == wf["name"]]
    if existentes:
        backup(existentes[0]["id"], f"antes-{int(time.time())}")
    wid = sv.criar_ou_trocar(wf)
    api("POST", f"/workflows/{wid}/activate")
    print(wf["name"], "->", wid, f"({len(wf['nodes'])} nós, ativo)")
    print("backup:", backup(wid, "publicado"))
    return wid


# ------------------------------------------------------------------ testar

def post(url, corpo, cabecalhos=None):
    req = urllib.request.Request(url, data=json.dumps(corpo).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **(cabecalhos or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def linhas_de_mentira():
    """Leads e prospects inventados (ids TESTE-*): só existem dentro da execução de teste."""
    site = [{"row_number": str(i + 2), "place_id": f"TESTE-SITE-{i}", "nome": f"Loja teste {i}", "vertical": "pilates", "cidade": "Cidade",
             "telefone": "(00) 0000-0000", "briefing": "texto longo", "status": s, "site_url": "https://exemplo.invalid",
             "enviado_em": e, "respondeu_em": "", "visto_em": "", "wa_me": "", "wa_link": ""}
            for i, (s, e) in enumerate([("pronto", ""), ("enviado", "2026-09-29T12:00:00Z"), ("descartado", "")])]
    prumo = [{"row_number": "2", "ID": "teste-prumo-1", "Empresa": "Prospect teste", "WhatsApp": "(00) 0000-0000",
              "Etapa": "Revisar", "Briefing": "CNPJ 11.222.333/0001-81 · EPP · capital R$ 100 mil", "Nota Google": "4,5 (10)"}]
    crm = [{"em": "2026-09-30T12:00:00Z", "produto": "site", "id": "TESTE-SITE-1", "empresa": "Loja teste 1", "tipo": "nota",
            "texto": "nota de teste", "data": "", "origem": "Central"}]
    return site, prumo, crm


def testar(erro, auth):
    """Cópia do 08 com as leituras e a gravação na planilha trocadas por nós Code; nada é gravado em planilha nem arquivo."""
    site, prumo, crm = linhas_de_mentira()
    wf = fluxo(erro, auth)
    falhar_prumo = ("let falhar = false;\ntry { falhar = $('Atualizar agora').first().json.body?.falhar === true; } catch (e) {}\n"
                    "if (falhar) return [{ json: { error: { message: 'credencial de mentira caída' } } }];\n")
    troca = {
        "Ler Leads": "return " + json.dumps([{"json": l} for l in site], ensure_ascii=False) + ";",
        "Ler Prospects": falhar_prumo + "return " + json.dumps([{"json": l} for l in prumo], ensure_ascii=False) + ";",
        "Ler Clínicas": "return " + json.dumps([{"json": {**prumo[0], "ID": "teste-iris-1", "Empresa": "Clínica teste"}}], ensure_ascii=False) + ";",
        # Aba ainda inexistente: o retrato sai igual, com a fonte marcada.
        "Ler Estamparias": "return [{ json: { error: { message: 'aba Estamparias não encontrada' } } }];",
        "Ler aba CRM": "return " + json.dumps([{"json": l} for l in crm], ensure_ascii=False) + ";",
        "Gravar na aba CRM": "return $input.all().map(i => ({ json: i.json.linha }));",
    }
    nos = []
    for n in copy.deepcopy(wf["nodes"]):
        if n["name"] in troca:
            n = {"id": n["id"], "name": n["name"], "type": "n8n-nodes-base.code", "typeVersion": 2, "position": n["position"],
                 "parameters": {"mode": "runOnceForAllItems", "jsCode": troca[n["name"]]}}
        elif n["name"] == "Gravar retrato":
            n = {"id": n["id"], "name": n["name"], "type": "n8n-nodes-base.noOp", "typeVersion": 1, "position": n["position"], "parameters": {}}
        elif n["type"] == "n8n-nodes-base.webhook":
            n["parameters"]["path"] = "zz-teste-" + n["parameters"]["path"]
            n["webhookId"] = n["webhookId"][:-4] + "7e57"
        nos.append(n)
    con = {k: v for k, v in wf["connections"].items() if k != "A cada 10 min"}
    nos = [n for n in nos if n["name"] != "A cada 10 min"]
    t = api("POST", "/workflows", {"name": f"ZZ testar: {NOME} (apagar)", "nodes": nos, "connections": con,
                                   "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo"}})
    chave = {"X-CRM": segredo()}
    ok = True

    def ultima_execucao(depois):
        for _ in range(30):
            ex = [e for e in api("GET", f"/executions?workflowId={t['id']}&limit=5")["data"] if int(e["id"]) > depois]
            if ex and ex[0]["status"] not in ("running", "new", "waiting"):
                e = api("GET", f"/executions/{ex[0]['id']}?includeData=true")
                rd = e["data"]["resultData"]["runData"]
                return e["status"], {nome: [i["json"] for i in ((runs[-1].get("data") or {}).get("main") or [[]])[0] or []] for nome, runs in rd.items()}
            time.sleep(2)
        return "sem execução", {}

    def ultimo_id():
        ex = api("GET", f"/executions?workflowId={t['id']}&limit=1")["data"]
        return int(ex[0]["id"]) if ex else 0

    def conferir(nome, cond):
        nonlocal ok
        ok = ok and cond
        print(("  ok   " if cond else "  FALHOU ") + nome)

    try:
        api("POST", f"/workflows/{t['id']}/activate")
        time.sleep(2)
        antes = ultimo_id()
        print("retrato:", post(f"{LOCAL}/zz-teste-crm-atualizar", {}, chave)[0])
        status, saidas = ultima_execucao(antes)
        m = (saidas.get("Montar retrato") or [{}])[0]
        conferir(f"execução {status}, arquivo {m.get('arquivo')}, site={m.get('site')} prumo={m.get('prumo')} iris={m.get('iris')}"
                 f" estampa={m.get('estampa')} registros={m.get('registros')} porte={m.get('porte')}",
                 status == "success" and m.get("arquivo") == "crm.json"
                 and (m.get("site"), m.get("prumo"), m.get("iris"), m.get("estampa"), m.get("registros"), m.get("porte"))
                 == (3, 1, 1, 0, 1, 1))

        antes = ultimo_id()
        post(f"{LOCAL}/zz-teste-crm-atualizar", {"falhar": True}, chave)
        status, saidas = ultima_execucao(antes)
        m = (saidas.get("Montar retrato") or [{}])[0]
        conferir(f"Prospects caída -> {m.get('arquivo')} ({m.get('erro')})", m.get("arquivo") == "crm-falha.json")

        codigo, corpo = post(f"{LOCAL}/zz-teste-crm-registro",
                             {"produto": "site", "id": "TESTE-SITE-1", "empresa": "Loja teste 1", "tipo": "proximo_passo",
                              "texto": "=ligar amanhã", "data": "2026-10-01"}, chave)
        conferir(f"registro válido -> {codigo} {corpo[:80]}", codigo == 200 and json.loads(corpo).get("ok") is True)
        codigo, corpo = post(f"{LOCAL}/zz-teste-crm-registro",
                             {"produto": "iris", "id": "teste-iris-1", "empresa": "Clínica teste", "tipo": "nota", "texto": "ok"}, chave)
        conferir(f"registro do Iris -> {codigo} {corpo[:80]}", codigo == 200)
        # OT-06 (recusou) e AC-08/AC-10, 17/10/2026 (ganhou, dispensado): texto opcional, data do dia ou vazia.
        for tipo, produto, extra in (("recusou", "plus", {}), ("recusou_desfeito", "prumo", {}),
                                     ("ganhou", "plus", {"data": "2026-10-17"}), ("ganhou_desfeito", "site", {}),
                                     ("dispensado", "iris", {"texto": "é franquia", "data": "2026-10-17"}), ("dispensado_desfeito", "estampa", {})):
            codigo, corpo = post(f"{LOCAL}/zz-teste-crm-registro",
                                 {"produto": produto, "id": "TESTE-SITE-1", "empresa": "Loja teste 1", "tipo": tipo, **extra}, chave)
            conferir(f"registro {tipo} -> {codigo} {corpo[:80]}", codigo == 200 and json.loads(corpo).get("ok") is True)
        codigo, corpo = post(f"{LOCAL}/zz-teste-crm-registro", {"produto": "site", "id": "TESTE-SITE-1", "tipo": "apagar"}, chave)
        conferir(f"registro inválido -> {codigo} {corpo[:80]}", codigo == 400)
        codigo, _ = post(f"{LOCAL}/zz-teste-crm-registro", {"produto": "site", "id": "TESTE-SITE-1", "tipo": "nota", "texto": "x"})
        conferir(f"registro sem segredo -> {codigo}", codigo in (401, 403))
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")
    print("teste:", "tudo certo" if ok else "com falhas")
    return ok


if __name__ == "__main__":
    if "--aba" in sys.argv:
        aba()
        sys.exit(0)
    if "--agora" in sys.argv:
        codigo, corpo = post(f"{LOCAL}/crm-atualizar", {}, {"X-CRM": segredo()})
        print("crm-atualizar ->", codigo, corpo[:120])
        sys.exit(0 if codigo == 200 else 1)
    erro = sv.erro_wf()
    auth = credencial()
    if "--testar" in sys.argv:
        sys.exit(0 if testar(erro, auth) else 1)
    try:
        aba()
    except (SystemExit, Exception) as e:  # noqa: BLE001 — a aba pode esperar a credencial do Google voltar
        print(f"aba {ABA_CRM}: não deu para conferir agora ({str(e)[:160]}). Rode `python3 crm.py --aba` depois.")
    publicar(fluxo(erro, auth, gids_das_ofertas()))
