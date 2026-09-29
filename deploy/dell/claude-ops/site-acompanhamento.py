"""Site antes da venda depois do envio (29/09/2026). Idempotente: recria pelo nome.

- "05 · Acompanhamento" (todo dia, 09:00): lead "enviado" sem respondeu_em,
  enviado a partir de 29/09/2026 e com a pasta ainda na raiz de ~/auto-site:
  no 3º dia, um aviso ao Rômulo com o follow-up pronto (wa.me com o texto, mesmo
  tom da variação A do Balcão, em site-mensagem.js) e followup_em na planilha;
  no 10º dia, status "expirado" (a pasta vai para _concluidos/ pelo site-pastas
  na hora seguinte, depois que o Balcão listar).
- "06 · Funil semanal" (segunda, 08:00): por nicho (vertical + cidade) leads,
  sites, enviados, responderam, em conversa, recusados e concluídos; buscas
  ativas com 5+ enviados e nenhuma resposta viram candidatas a desativar (a
  aba Buscas não muda sozinha). Aviso pelo Hermes e estado/site-funil.json
  (sem "itens": o dell-status e o Hermes não o leem como pendência).

O que foi enviado antes de 29/09/2026 é acervo: nada automático; o resumo único
sai por `--resumo-backlog`.

Uso: python3 site-acompanhamento.py              publica e ativa os dois fluxos
     python3 site-acompanhamento.py --testar     roda cópias sem gravar nada (planilha de mentira no 05)
     python3 site-acompanhamento.py --resumo-backlog [--enviar]   o resumo do acervo (--enviar põe na fila)
"""
import copy
import importlib.util
import json
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from n8n import api, aviso_nodes, put

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("site_antes_da_venda", AQUI / "site-antes-da-venda.py")
sv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sv)

PLANILHA, SHEETS, CORTE = sv.PLANILHA, sv.SHEETS, sv.CORTE
LEADS_GID, BUSCAS_GID = "396728619", "52197070"
LINK_PLANILHA = f"https://docs.google.com/spreadsheets/d/{PLANILHA}/edit#gid={LEADS_GID}"
FOLLOWUP_DIAS, EXPIRA_DIAS, MIN_ENVIADOS = 3, 10, 5
FILA = Path.home() / ".local/share/avisos/fila"
AUTO = Path.home() / "auto-site"


def ler_aba(no_id, nome, gid, aba, pos):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": pos,
            "credentials": SHEETS, "executeOnce": True, "alwaysOutputData": True, "retryOnFail": True, "maxTries": 3,
            "waitBetweenTries": 5000,
            "parameters": {"resource": "sheet", "operation": "read",
                           "documentId": {"__rl": True, "mode": "id", "value": PLANILHA, "cachedResultName": "Leads — Site antes da venda"},
                           "sheetName": {"__rl": True, "mode": "id", "value": gid, "cachedResultName": aba}, "options": {}}}


def recibos(x=220):
    """Os mesmos nomes do Balcão: PASTA_DO_LEAD_JS lê estes dois nós."""
    return [
        {"id": "ler", "name": "Ler recibos da pasta auto", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [x, 0], "parameters": {"operation": "read", "fileSelector": "/home/node/.n8n-files/auto/**/publicado.json", "options": {}}},
        {"id": "json", "name": "Ler o JSON do recibo", "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1.1,
         "position": [x + 220, 0], "parameters": {"operation": "fromJson", "destinationKey": "recibo"}},
    ]


def code(no_id, nome, js, pos):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos,
            "parameters": {"mode": "runOnceForAllItems", "jsCode": js}}


def em_fila(nomes):
    return {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(nomes, nomes[1:])}


# ------------------------------------------------------------------ 05 · Acompanhamento

DIAS_JS = """// Dias corridos no fuso de São Paulo (sem horário de verão desde 2019).
const DIA = 24 * 60 * 60 * 1000;
const diaSP = (ms) => Math.floor((ms - 3 * 60 * 60 * 1000) / DIA);"""

DECIDIR = f"""// Follow-up no {FOLLOWUP_DIAS}º dia e expiração no {EXPIRA_DIAS}º, só para o que foi enviado desde o corte.
{sv.PASTA_DO_LEAD_JS}
{DIAS_JS}
const CORTE = Date.parse('{CORTE}');
const hoje = diaSP(Date.now());
const saida = [];
for (const l of $input.all().map(i => i.json)) {{
  if (String(l.status ?? '').trim() !== 'enviado' || String(l.respondeu_em ?? '').trim()) continue;
  const enviado = Date.parse(String(l.enviado_em ?? '').trim());
  // Acervo (antes do corte ou sem data): só no resumo único, nada automático.
  if (!Number.isFinite(enviado) || enviado < CORTE) continue;
  // Pasta em _recusados/ ou _em-conversa/: o Rômulo já decidiu, não cobra nem expira.
  if (!naRaiz(l.place_id)) continue;
  const dias = hoje - diaSP(enviado);
  const followup = String(l.followup_em ?? '').trim();
  const base = {{ place_id: String(l.place_id), nome: String(l.nome ?? ''), cidade: String(l.cidade ?? ''),
    site_url: String(l.site_url ?? ''), telefone: String(l.telefone ?? ''), dias }};
  if (dias >= {EXPIRA_DIAS}) {{
    saida.push({{ json: {{ ...base, acao: 'expirar', status: 'expirado', followup_em: followup }} }});
  }} else if (dias >= {FOLLOWUP_DIAS} && !followup) {{
    const f = followupDe(l);
    saida.push({{ json: {{ ...base, acao: 'followup', status: 'enviado', followup_em: new Date().toISOString(), link: f.link, texto: f.texto }} }});
  }}
}}
return saida;"""

AVISOS = """// Um aviso por follow-up (o texto fica sozinho para copiar) e um só para os expirados.
const NL = String.fromCharCode(10);
const arquivo = (titulo, texto) => ({ json: { titulo, texto }, binary: { data: {
  data: Buffer.from(JSON.stringify({ titulo, texto }), 'utf8').toString('base64'), mimeType: 'application/json', fileName: 'aviso.json' } } });
const itens = $('Decidir').all().map(i => i.json);
const onde = (l) => l.nome + (l.cidade ? ' (' + l.cidade + ')' : '');
const saida = itens.filter(l => l.acao === 'followup').map(l => arquivo('🔁 Site antes da venda: follow-up', [
  '*' + onde(l) + '* não respondeu em ' + l.dias + ' dias.',
  'Site: ' + l.site_url,
  l.link ? 'WhatsApp com a mensagem pronta: ' + l.link : 'Sem WhatsApp válido na planilha (telefone: ' + (l.telefone || '—') + ').',
  '',
  'Mensagem:',
  l.texto,
  '',
  'Se já respondeu, preencha respondeu_em na planilha. Sem resposta, expira no 10º dia.',
].join(NL)));
const expirados = itens.filter(l => l.acao === 'expirar');
if (expirados.length) saida.push(arquivo('⏳ Site antes da venda: expirados', [
  expirados.length + ' lead(s) sem resposta em 10 dias viraram "expirado"; a pasta vai para _concluidos/ na próxima hora:',
  ...expirados.map(l => '• ' + onde(l) + ': ' + l.site_url),
  '',
  'Se algum respondeu, preencha respondeu_em: a pasta vai para _em-conversa/.',
].join(NL)));
return saida;"""


def acompanhamento(erro):
    marca = {"place_id": "={{ $json.place_id }}", "status": "={{ $json.status }}", "followup_em": "={{ $json.followup_em }}"}
    _, gravar = aviso_nodes("acompanhamento", 1540, 0, "''")
    gravar["name"] = "Avisar pelo Hermes"
    nos = [
        {"id": "dia", "name": "Todo dia 09:00", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
         "parameters": {"rule": {"interval": [{"field": "days", "triggerAtHour": 9, "triggerAtMinute": 0}]}}},
        *recibos(),
        ler_aba("planilha", "Ler a planilha", LEADS_GID, "Leads", [660, 0]),
        code("decidir", "Decidir", sv.codigo_js("site-mensagem.js") + "\n" + DECIDIR, [880, 0]),
        {"id": "marcar", "name": "Marcar na planilha", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [1100, 0],
         "credentials": SHEETS, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
         "parameters": {"resource": "sheet", "operation": "update",
                        "documentId": {"__rl": True, "mode": "id", "value": PLANILHA},
                        "sheetName": {"__rl": True, "mode": "id", "value": LEADS_GID, "cachedResultName": "Leads"},
                        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["place_id"], "value": marca,
                                    "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": c == "place_id",
                                                "display": True, "type": "string", "canBeUsedToMatch": c == "place_id"} for c in marca]},
                        "options": {"cellFormat": "RAW"}}},
        # Avisa depois de marcar: se a planilha falhar, amanhã não sai aviso repetido.
        code("avisos", "Montar avisos", AVISOS, [1320, 0]),
        gravar,
    ]
    con = em_fila([n["name"] for n in nos])
    return {"name": "05 · Acompanhamento (Site antes da venda)", "nodes": nos, "connections": con,
            "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}


# ------------------------------------------------------------------ 06 · Funil semanal

FUNIL = f"""// Funil por nicho (vertical + cidade) e buscas candidatas a desativar. Só lê.
{sv.PASTA_DO_LEAD_JS}
const DIA = 24 * 60 * 60 * 1000;
const agora = Date.now();
const MIN_ENVIADOS = {MIN_ENVIADOS};
const txt = (v) => String(v ?? '').trim();
const norm = (t) => txt(t).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Radicais de 5 letras: "espaço para eventos" e "espaço de eventos" batem; palavras genéricas não contam.
const GENERICAS = new Set(['para', 'clinica', 'loja', 'particular', 'medida', 'servicos', 'centro']);
const radicais = (...t) => new Set(t.flatMap(x => norm(x).split(' ')).filter(p => p.length >= 4 && !GENERICAS.has(p)).map(p => p.slice(0, 5)));
const cruza = (a, b) => [...a].some(r => b.has(r));
const recente = (v) => {{ const t = Date.parse(txt(v)); return Number.isFinite(t) && agora - t <= 7 * DIA; }};

const publicadoEm = {{}};
for (const r of $('Ler o JSON do recibo').all()) if (r.json.recibo?.place_id) publicadoEm[r.json.recibo.place_id] = r.json.recibo.publicado_em;
const leads = $('Ler a planilha').all().map(i => i.json).filter(l => txt(l.place_id) && !/^TESTE/.test(txt(l.place_id)));
const topo = (l) => {{ const p = pasta[l.place_id] ?? ''; return p.includes('/') ? p.split('/')[0] : (p ? 'raiz' : ''); }};
const enviado = (l) => ['enviado', 'expirado'].includes(txt(l.status)) || Boolean(txt(l.enviado_em));
const respondeu = (l) => Boolean(txt(l.respondeu_em)) || topo(l) === '_em-conversa';
const medir = (ls) => ({{
  leads: ls.filter(l => txt(l.status) !== 'descartado').length,
  descartados: ls.filter(l => txt(l.status) === 'descartado').length,
  sites: ls.filter(l => txt(l.site_url)).length,
  enviados: ls.filter(enviado).length,
  responderam: ls.filter(l => txt(l.respondeu_em)).length,
  em_conversa: ls.filter(l => topo(l) === '_em-conversa').length,
  recusados: ls.filter(l => topo(l) === '_recusados').length,
  concluidos: ls.filter(l => topo(l) === '_concluidos').length,
}});

const grupos = {{}};
for (const l of leads) {{
  const chave = txt(l.vertical).toLowerCase() + ' · ' + (txt(l.cidade) || 'sem cidade');
  (grupos[chave] = grupos[chave] ?? []).push(l);
}}
const nichos = Object.entries(grupos).map(([nicho, ls]) => ({{ nicho, ...medir(ls) }}))
  .sort((a, b) => b.enviados - a.enviados || b.sites - a.sites || a.nicho.localeCompare(b.nicho));

// Busca -> leads. A planilha não guarda de qual busca veio o lead: vale o radical do ramo
// e a cidade da busca, que é a do primeiro lote de leads criado depois da última rodada
// dela (até 90 min; o lote sai do mesmo "Montar lead", com o mesmo criado_em).
const criado = (l) => Date.parse(txt(l.criado_em));
const buscas = $input.all().map(i => i.json).filter(b => txt(b.query)).map(b => {{
  const r = radicais(b.query, b.vertical);
  const rodada = Date.parse(txt(b.ultima_rodada) + ':00-03:00');
  const depois = Number.isFinite(rodada) ? leads.filter(l => cruza(r, radicais(l.vertical)) && txt(l.cidade)
    && criado(l) >= rodada && criado(l) - rodada <= 90 * 60 * 1000) : [];
  const lote = depois.length ? Math.min(...depois.map(criado)) : 0;
  const daRodada = depois.filter(l => criado(l) - lote <= 60 * 1000);
  const conta = {{}};
  for (const l of daRodada) conta[txt(l.cidade)] = (conta[txt(l.cidade)] ?? 0) + 1;
  const cidade = Object.entries(conta).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return {{ query: txt(b.query), vertical: txt(b.vertical), lat: txt(b.lat), lng: txt(b.lng),
    ativa: ['true', 'verdadeiro', 'sim', 'x', '1'].includes(norm(b.ativa)), cidade, r, leads: [] }};
}});
for (const l of leads) {{
  const rl = radicais(l.vertical);
  const candidatas = buscas.filter(b => cruza(b.r, rl));
  const naCidade = candidatas.filter(b => b.cidade && b.cidade === txt(l.cidade));
  const dona = naCidade[0] ?? (candidatas.length === 1 && !candidatas[0].cidade ? candidatas[0] : null);
  if (dona) dona.leads.push(l);
}}
const porBusca = buscas.map(({{ r, leads: ls, ...b }}) => {{
  const enviados = ls.filter(enviado).length, respostas = ls.filter(respondeu).length;
  return {{ ...b, leads: ls.filter(l => txt(l.status) !== 'descartado').length, enviados, respostas,
    candidata: b.ativa && enviados >= MIN_ENVIADOS && respostas === 0 }};
}});

const semana = {{
  leads: leads.filter(l => txt(l.status) !== 'descartado' && recente(l.criado_em)).length,
  sites: leads.filter(l => recente(publicadoEm[l.place_id])).length,
  enviados: leads.filter(l => recente(l.enviado_em)).length,
  responderam: leads.filter(l => recente(l.respondeu_em)).length,
}};
const estado = {{ geradoEm: new Date().toISOString(), regra: {{ min_enviados: MIN_ENVIADOS }},
  semana, totais: medir(leads), nichos, buscas: porBusca }};
return [{{ json: estado, binary: {{ data: {{ data: Buffer.from(JSON.stringify(estado), 'utf8').toString('base64'),
  mimeType: 'application/json', fileName: 'site-funil.json' }} }} }}];"""

AVISO_FUNIL = f"""const NL = String.fromCharCode(10);
const f = $('Funil').first().json;
const linha = (m) => [m.leads, m.sites, m.enviados, m.responderam, m.em_conversa, m.recusados, m.concluidos].join(' · ');
const nichos = f.nichos.filter(n => n.sites > 0);
const candidatas = f.buscas.filter(b => b.candidata);
const texto = [
  'Últimos 7 dias: ' + f.semana.leads + ' leads, ' + f.semana.sites + ' sites, ' + f.semana.enviados + ' enviados, ' + f.semana.responderam + ' respostas.',
  '',
  'Por nicho (leads · sites · enviados · responderam · em conversa · recusados · concluídos):',
  ...nichos.map(n => '• ' + n.nicho + ': ' + linha(n)),
  '*Total:* ' + linha(f.totais),
  '',
  candidatas.length
    ? 'Buscas para pensar em desativar ({MIN_ENVIADOS}+ enviados, nenhuma resposta):' + NL
      + candidatas.map(b => '• "' + b.query + '"' + (b.cidade ? ' em ' + b.cidade : '') + ' (' + b.lat + ', ' + b.lng + '): '
        + b.enviados + ' enviados, 0 respostas').join(NL)
      + NL + 'A aba Buscas não muda sozinha: para desativar, ponha FALSE em ativa.'
    : 'Nenhuma busca ativa com {MIN_ENVIADOS}+ enviados sem resposta.',
  '',
  'Planilha: {LINK_PLANILHA}',
].join(NL);
const titulo = '📊 Site antes da venda: funil da semana';
return [{{ json: {{ titulo, texto }}, binary: {{ data: {{ data: Buffer.from(JSON.stringify({{ titulo, texto }}), 'utf8').toString('base64'),
  mimeType: 'application/json', fileName: 'aviso.json' }} }} }}];"""


def funil(erro):
    _, gravar = aviso_nodes("funil", 1540, 120, "''")
    gravar["name"] = "Avisar pelo Hermes"
    nos = [
        {"id": "segunda", "name": "Segunda 08:00", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
         "parameters": {"rule": {"interval": [{"field": "weeks", "weeksInterval": 1, "triggerAtDay": [1],
                                               "triggerAtHour": 8, "triggerAtMinute": 0}]}}},
        *recibos(),
        ler_aba("planilha", "Ler a planilha", LEADS_GID, "Leads", [660, 0]),
        ler_aba("buscas", "Ler Buscas", BUSCAS_GID, "Buscas", [880, 0]),
        code("funil", "Funil", FUNIL, [1100, 0]),
        {"id": "gravar-funil", "name": "Gravar funil", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [1320, -120], "parameters": {"operation": "write", "dataPropertyName": "data",
                                                  "fileName": "/home/node/.n8n-files/estado/site-funil.json"}},
        code("aviso-funil", "Montar aviso", AVISO_FUNIL, [1320, 120]),
        gravar,
    ]
    con = em_fila(["Segunda 08:00", "Ler recibos da pasta auto", "Ler o JSON do recibo", "Ler a planilha", "Ler Buscas", "Funil"])
    con["Funil"] = {"main": [[{"node": "Gravar funil", "type": "main", "index": 0}, {"node": "Montar aviso", "type": "main", "index": 0}]]}
    con["Montar aviso"] = {"main": [[{"node": "Avisar pelo Hermes", "type": "main", "index": 0}]]}
    return {"name": "06 · Funil semanal (Site antes da venda)", "nodes": nos, "connections": con,
            "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}


# ------------------------------------------------------------------ publicar e testar

def publicar(wf):
    wid = sv.criar_ou_trocar(wf)
    api("POST", f"/workflows/{wid}/activate")
    print(wf["name"], "->", wid, f"({len(wf['nodes'])} nós, ativo)")
    return wid


def testar(wf, trocar):
    """Roda uma cópia agora, com os nós de `trocar` ({nome: nó}) no lugar dos que gravam. Nada é escrito."""
    nos = [copy.deepcopy(trocar.get(n["name"], n)) for n in wf["nodes"] if n["type"] != "n8n-nodes-base.scheduleTrigger"]
    gatilho = next(n["name"] for n in wf["nodes"] if n["type"] == "n8n-nodes-base.scheduleTrigger")
    caminho = "testar-" + re.sub(r"[^a-z0-9]+", "-", wf["name"].lower())[:40].strip("-")
    nos.append({"id": "testar", "name": "Testar", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [-220, 0],
                "webhookId": "00000000-0000-4000-8000-" + str(abs(hash(caminho)))[:12].rjust(12, "0"),
                "parameters": {"httpMethod": "POST", "path": caminho, "responseMode": "onReceived"}})
    con = {k: v for k, v in wf["connections"].items() if k != gatilho}
    con["Testar"] = wf["connections"][gatilho]
    t = api("POST", "/workflows", {"name": f"ZZ testar: {wf['name']} (apagar)", "nodes": nos, "connections": con,
                                   "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo"}})
    try:
        api("POST", f"/workflows/{t['id']}/activate")
        time.sleep(2)
        urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:5679/webhook/{caminho}", data=b"{}", method="POST",
                                                      headers={"Content-Type": "application/json"}), timeout=30).read()
        for _ in range(24):
            ex = api("GET", f"/executions?workflowId={t['id']}&limit=1")["data"]
            if ex and ex[0]["status"] not in ("running", "new", "waiting"):
                break
            time.sleep(5)
        e = api("GET", f"/executions/{ex[0]['id']}?includeData=true")
        rd = e["data"]["resultData"]["runData"]
        print(wf["name"], "->", e["status"])
        for nome, runs in rd.items():
            erro = next(((r.get("error") or {}).get("message") for r in runs if r.get("error")), "")
            print(f"  {nome}: itens={len(((runs[-1].get('data') or {}).get('main') or [[]])[0] or [])} {erro}")
        return {nome: [i["json"] for i in ((runs[-1].get("data") or {}).get("main") or [[]])[0] or []] for nome, runs in rd.items()}
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")


def noop(nome):
    return {"id": "noop-" + re.sub(r"\W+", "-", nome.lower()), "name": nome, "type": "n8n-nodes-base.noOp", "typeVersion": 1,
            "position": [0, 400], "parameters": {}}


def planilha_de_mentira(linhas):
    """Nó Code com o nome "Ler a planilha": o fluxo lê estas linhas em vez da planilha real."""
    return {"id": "planilha", "name": "Ler a planilha", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0],
            "parameters": {"mode": "runOnceForAllItems", "jsCode": "return " + json.dumps([{"json": l} for l in linhas], ensure_ascii=False) + ";"}}


def recibos_na_raiz(n):
    """place_id de n leads com a pasta na raiz, para a planilha de mentira bater com recibos reais."""
    achados = []
    for p in sorted(AUTO.glob("*/publicado.json")):
        if p.parent.name.startswith(("_", ".")):
            continue
        try:
            achados.append(json.loads(p.read_text(encoding="utf-8")))
        except ValueError:
            continue
        if len(achados) == n:
            break
    return achados


def cenario_acompanhamento():
    agora = datetime.now(timezone.utc)
    dia = lambda d: datetime.fromtimestamp(agora.timestamp() - d * 86400, timezone.utc).isoformat()
    r = recibos_na_raiz(4)
    base = lambda rec, **k: {"place_id": rec["place_id"], "nome": rec["nome"] + " [teste]", "cidade": "Cidade", "telefone": "(19) 99000-0000",
                             "site_url": rec["site_url"], "status": "enviado", "respondeu_em": "", "followup_em": "", **k}
    linhas = [
        base(r[0], enviado_em=dia(3.2)),                                  # follow-up
        base(r[1], enviado_em=dia(10.5), followup_em=dia(7)),             # expira
        base(r[2], enviado_em=dia(4), respondeu_em=dia(3)),               # respondeu: nada
        base(r[3], enviado_em="2026-08-20T10:00:00Z"),                    # acervo (antes do corte do teste): nada
        {"place_id": "SEM-PASTA", "nome": "Sem pasta [teste]", "status": "enviado", "enviado_em": dia(5)},  # sem recibo: nada
    ]
    return linhas


def resumo_backlog():
    """Resumo único do acervo: enviados antes do corte, sem resposta, com a pasta na raiz."""
    from sheets_proxy import SheetsProxy
    with SheetsProxy([PLANILHA]) as s:
        v = s.get(f"/v4/spreadsheets/{PLANILHA}/values/" + quote("Leads"))["values"]
    cab, linhas = v[0], [dict(zip(v[0], l + [""] * (len(v[0]) - len(l)))) for l in v[1:]]
    pasta = {}
    for p in AUTO.glob("**/publicado.json"):
        try:
            pasta[json.loads(p.read_text(encoding="utf-8")).get("place_id")] = str(p.parent.relative_to(AUTO))
        except ValueError:
            continue
    corte = datetime.fromisoformat(CORTE)
    acervo = [l for l in linhas if l["status"].strip() == "enviado" and l["enviado_em"].strip()
              and datetime.fromisoformat(l["enviado_em"].replace("Z", "+00:00")) < corte]
    raiz = [l for l in acervo if "/" not in pasta.get(l["place_id"], "/")]
    fora = {}
    for l in acervo:
        if l not in raiz:
            onde = pasta.get(l["place_id"], "sem pasta").split("/")[0]
            fora[onde] = fora.get(onde, 0) + 1
    # Follow-up com o mesmo texto do Acompanhamento (site-mensagem.js, pelo node do Dell).
    js = sv.codigo_js("site-mensagem.js") + "\nconsole.log(JSON.stringify(" + json.dumps(raiz, ensure_ascii=False) + ".map(followupDe)));"
    followups = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    hoje = datetime.now().astimezone()
    sem, com = [], []
    for l, f in sorted(zip(raiz, followups), key=lambda p: p[0]["enviado_em"]):
        dias = (hoje - datetime.fromisoformat(l["enviado_em"].replace("Z", "+00:00"))).days
        rotulo = f"• {l['nome']} ({l['cidade']}), {dias} dia(s): {l['site_url']}"
        if l["respondeu_em"].strip():
            com.append(rotulo)
        else:
            sem.append(rotulo + (f"\n  follow-up: {f['link']}" if f["link"] else ""))
    texto = "\n".join([
        f"Enviados antes de 29/09 ficam fora do follow-up automático. Estes {len(raiz)} ainda estão na raiz de ~/auto-site:",
        "", f"*Sem resposta ({len(sem)})*, com o follow-up pronto no link:", *sem,
        *(["", f"*Responderam pelo log do WhatsApp ({len(com)})*; a pasta não muda sozinha, mova para _em-conversa/ se fizer sentido:", *com] if com else []),
        "", "Fora da lista (status enviado na planilha, pasta já decidida): "
        + ", ".join(f"{n} em {k}" for k, n in sorted(fora.items())) + ".",
    ])
    return {"titulo": "🗂️ Site antes da venda: acervo sem automação", "texto": texto}


if __name__ == "__main__":
    erro = sv.erro_wf()
    if "--resumo-backlog" in sys.argv:
        aviso = resumo_backlog()
        print(aviso["titulo"], "\n" + aviso["texto"])
        if "--enviar" in sys.argv:
            (FILA / f"site-acervo-{int(time.time())}.json").write_text(json.dumps(aviso, ensure_ascii=False))
            print("\n-> na fila de avisos")
    elif "--testar" in sys.argv:
        wf = acompanhamento(erro)
        # O corte real (hoje) deixaria tudo como acervo: no teste ele volta para 01/09.
        decidir = copy.deepcopy(next(n for n in wf["nodes"] if n["name"] == "Decidir"))
        decidir["parameters"]["jsCode"] = decidir["parameters"]["jsCode"].replace(CORTE, "2026-09-01T00:00:00-03:00")
        s = testar(wf, {"Ler a planilha": planilha_de_mentira(cenario_acompanhamento()), "Decidir": decidir,
                        "Marcar na planilha": noop("Marcar na planilha"), "Avisar pelo Hermes": noop("Avisar pelo Hermes")})
        print(json.dumps({"Decidir": s.get("Decidir"), "Montar avisos": s.get("Montar avisos")}, ensure_ascii=False, indent=1))
        s = testar(funil(erro), {"Gravar funil": noop("Gravar funil"), "Avisar pelo Hermes": noop("Avisar pelo Hermes")})
        f = (s.get("Funil") or [{}])[0]
        print(json.dumps({k: f.get(k) for k in ("semana", "totais", "buscas")}, ensure_ascii=False, indent=1))
        print((s.get("Montar aviso") or [{}])[0].get("texto"))
    else:
        publicar(acompanhamento(erro))
        publicar(funil(erro))
