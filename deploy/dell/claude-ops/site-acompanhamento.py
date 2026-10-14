"""Site antes da venda depois do envio (29/09/2026). Idempotente: recria pelo nome.

- "05 · Acompanhamento" (todo dia, 09:00): lead "enviado" sem respondeu_em,
  enviado a partir de 29/09/2026 e com a pasta ainda na raiz de ~/auto-site:
  no 3º dia, um aviso ao Rômulo com o follow-up pronto (wa.me com o texto, mesmo
  tom da variação A do Balcão, em site-mensagem.js) e followup_em na planilha;
  no 10º dia, status "expirado" (a pasta vai para _concluidos/ pelo site-pastas
  na hora seguinte, depois que o Balcão listar).
- "06 · Funil semanal" (segunda, 08:00): por nicho (vertical + cidade) leads,
  sites, enviados, responderam, em conversa, recusados e concluídos. Aviso pelo
  Hermes e estado/site-funil.json (sem "itens": o dell-status e o Hermes não o
  leem como pendência).

Desde 08/10/2026 também pausa o que não tem sinal de compra (site-funil-regra.js): a
busca (segmento × cidade) ou o nicho inteiro (coluna vertical da aba Buscas, todas as
cidades) com 20+ enviados e nenhuma resposta "interesse", pedido de preço, proposta
(aba CRM) ou ganho (status "fechado"). Negativa, exclusão, robô e neutra não são sinal:
pousada chegou a 35 enviados, 8 respostas (6 negativas, 2 neutras) e nenhum interesse, e
a regra do silêncio abaixo não a pegava. Sem a aba CRM lida, essa regra fica parada na
semana (o aviso diz). O aviso de segunda lista os nichos sem sinal e por quê.

Desde 05/10/2026 o funil pausa a busca que não paga o site: ativa, 5+
enviados e nenhuma resposta humana (respondeu_em a 5 min ou mais do envio,
RULES 17, ou pasta em _em-conversa) vira `ativa` FALSE na aba Buscas, com
`pausada_em` e `pausa_motivo`. Antes ela só aparecia no aviso como candidata e
o Caçador seguia rodando a busca; 83 enviados, 11 respostas, e odontologia,
pilates, academia, vidraçaria e marcenaria somavam 0 de 21. Busca com
`pausada_em` não é pausada de novo: religar `ativa` à mão é a palavra final do
Rômulo. O retrato ganha `nao_gerar`: leads `novo` de busca desligada, que o
gerador de sites deixa fora da fila (gerador-de-sites.py).

Na mesma data, depois da migração de nicho: resposta com `resposta_tipo`
negativa ou bot não segura a busca. As 11 respostas até ali eram todas "não
tenho interesse", e pousada e eventos seguiam ativas por causa delas. Desde
07/10/2026 "exclusao" (pediu para apagar o demo) conta como negativa.

O que foi enviado antes de 29/09/2026 é acervo: nada automático; o resumo único
sai por `--resumo-backlog`.

Uso: python3 site-acompanhamento.py              colunas que faltam na aba Buscas + publica e ativa os dois fluxos
     python3 site-acompanhamento.py --colunas    só acrescenta pausada_em e pausa_motivo na aba Buscas
     python3 site-acompanhamento.py --testar     roda cópias sem gravar nada (planilha de mentira no 05)
     python3 site-acompanhamento.py --testar-regra   a regra da pausa no node, sem n8n nem planilha
     python3 site-acompanhamento.py --simular    cópia do 06 com as abas reais: o que pausaria, sem gravar nada
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
# Escritas pelo funil quando pausa uma busca; o resto da aba Buscas é do Rômulo e do Caçador.
COLUNAS_BUSCAS = ["pausada_em", "pausa_motivo"]
FILA = Path.home() / ".local/share/avisos/fila"
AUTO = Path.home() / "auto-site"


def ler_aba(no_id, nome, gid, aba, pos):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": pos,
            "credentials": SHEETS, "executeOnce": True, "alwaysOutputData": True, "retryOnFail": True, "maxTries": 3,
            "waitBetweenTries": 5000,
            "parameters": {"resource": "sheet", "operation": "read",
                           "documentId": {"__rl": True, "mode": "id", "value": PLANILHA, "cachedResultName": "Leads — Site antes da venda"},
                           "sheetName": {"__rl": True, "mode": "id", "value": gid, "cachedResultName": aba}, "options": {}}}


def ler_aba_crm(pos):
    """A aba CRM (notas e propostas da Central, crm.py) pelo nome, como o "08 · CRM" a lê.
    Falha vira item com `error`: o Funil roda sem a regra do sinal de compra e o aviso diz."""
    return {"id": "crm", "name": "Ler aba CRM", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": pos,
            "credentials": SHEETS, "executeOnce": True, "alwaysOutputData": True, "onError": "continueRegularOutput",
            "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
            "parameters": {"resource": "sheet", "operation": "read",
                           "documentId": {"__rl": True, "mode": "id", "value": PLANILHA},
                           "sheetName": {"__rl": True, "mode": "name", "value": "CRM"}, "options": {}}}


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
    site_url: String(l.site_url ?? ''), raio_x_url: String(l.raio_x_url ?? ''), telefone: String(l.telefone ?? ''), dias }};
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
  data: Buffer.from(JSON.stringify({ titulo, texto, origem: ('n8n:' + $workflow.name).slice(0, 80) }), 'utf8').toString('base64'), mimeType: 'application/json', fileName: 'aviso.json' } } });
const itens = $('Decidir').all().map(i => i.json);
const onde = (l) => l.nome + (l.cidade ? ' (' + l.cidade + ')' : '');
// 14/10/2026 (demo sob pedido): quem recebeu só o Raio-X não tem site_url; o aviso mostra o Raio-X.
const pagina = (l) => l.site_url ? 'Site: ' + l.site_url : 'Raio-X: ' + (l.raio_x_url || '—');
const saida = itens.filter(l => l.acao === 'followup').map(l => arquivo('🔁 Site antes da venda: follow-up', [
  '*' + onde(l) + '* não respondeu em ' + l.dias + ' dias.',
  pagina(l),
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
  ...expirados.map(l => '• ' + onde(l) + ': ' + (l.site_url || l.raio_x_url)),
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

FUNIL = sv.codigo_js("site-funil-regra.js") + f"""
// Funil por nicho (vertical + cidade) e buscas a pausar. Só calcula: quem grava a
// pausa na aba Buscas é "Pausar na aba Buscas", com o que sai daqui. A regra da pausa
// mora em site-funil-regra.js (decidirPausas), colado acima.
{sv.PASTA_DO_LEAD_JS}
const DIA = 24 * 60 * 60 * 1000;
const agora = Date.now();
const MIN_ENVIADOS = {MIN_ENVIADOS};
const recente = (v) => {{ const t = Date.parse(txt(v)); return Number.isFinite(t) && agora - t <= 7 * DIA; }};

const publicadoEm = {{}};
for (const r of $('Ler o JSON do recibo').all()) if (r.json.recibo?.place_id) publicadoEm[r.json.recibo.place_id] = r.json.recibo.publicado_em;
const leads = $('Ler a planilha').all().map(i => i.json).filter(l => txt(l.place_id) && !/^TESTE/.test(txt(l.place_id)));
// Proposta mora na aba CRM (server/crm.ts). Sem ela lida, a regra do sinal de compra fica
// parada nesta semana: uma proposta escondida pausaria um nicho que está vendendo.
const crm = $('Ler aba CRM').all().map(i => i.json ?? {{}});
const crmErro = crm.map(r => r.error).find(Boolean);
const propostas = propostasAbertas(crmErro ? [] : crm);
const topo = (l) => {{ const p = pasta[l.place_id] ?? ''; return p.includes('/') ? p.split('/')[0] : (p ? 'raiz' : ''); }};
// Resposta humana (RULES 17): a 5 min ou mais do envio; antes pode ser a saudação
// automática do WhatsApp Business. O observador já só grava assim; a conta de novo
// cobre o preenchimento à mão. Só a data (sem hora), escrita à mão, vale como resposta.
const respondeuHumano = (l) => {{
  const r = txt(l.respondeu_em);
  if (!r) return false;
  if (/^\\d{{4}}-\\d{{2}}-\\d{{2}}$/.test(r)) return true;
  const em = Date.parse(r), env = Date.parse(txt(l.enviado_em));
  return !Number.isFinite(em) || !Number.isFinite(env) || em - env >= 5 * 60 * 1000;
}};
// Para a pausa, "não tenho interesse" e robô não pagam o site (migração de nicho de
// 05/10/2026: 11 respostas em 83 envios, as 11 negativas, e pousada seguia rodando
// porque a regra contava qualquer resposta). Vale interesse, neutra ("quem é?"),
// resposta ainda sem tipo e conversa aberta à mão. "exclusao" (pediu para apagar o demo,
// 07/10/2026) é uma negativa para o funil.
const respondeu = (l) => topo(l) === '_em-conversa'
  || (respondeuHumano(l) && !['negativa', 'exclusao', 'bot'].includes(txt(l.resposta_tipo).toLowerCase()));
const medir = (ls) => ({{
  leads: ls.filter(l => txt(l.status) !== 'descartado').length,
  descartados: ls.filter(l => txt(l.status) === 'descartado').length,
  sites: ls.filter(l => txt(l.site_url)).length,
  enviados: ls.filter(enviado).length,
  responderam: ls.filter(respondeuHumano).length,
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
    ativa: ehVerdade(b.ativa), cidade, r, leads: [], linha: b.row_number, pausada_em: txt(b.pausada_em) }};
}});
for (const l of leads) {{
  const rl = radicais(l.vertical);
  const candidatas = buscas.filter(b => cruza(b.r, rl));
  const naCidade = candidatas.filter(b => b.cidade && b.cidade === txt(l.cidade));
  const dona = naCidade[0] ?? (candidatas.length === 1 && !candidatas[0].cidade ? candidatas[0] : null);
  if (dona) dona.leads.push(l);
}}
// Quem já tem pausada_em e está ativa foi religada pelo Rômulo: nenhuma regra pausa de novo.
const decisao = decidirPausas(buscas, leads, propostas, {{ respondeu, minEnviados: MIN_ENVIADOS, agora, semSinalLigada: !crmErro }});
const porBusca = decisao.buscas, nao_gerar = decisao.nao_gerar;

const semana = {{
  leads: leads.filter(l => txt(l.status) !== 'descartado' && recente(l.criado_em)).length,
  sites: leads.filter(l => recente(publicadoEm[l.place_id])).length,
  enviados: leads.filter(l => recente(l.enviado_em)).length,
  responderam: leads.filter(l => recente(l.respondeu_em)).length,
}};
const estado = {{ geradoEm: new Date().toISOString(),
  regra: {{ min_enviados: MIN_ENVIADOS, resposta_min: 5, sem_sinal_max: SEM_SINAL_MAX, dias_para_responder: DIAS_PARA_RESPONDER }},
  crm: crmErro ? {{ lido: false, erro: String(crmErro.message ?? crmErro).slice(0, 200) }} : {{ lido: true, propostas: propostas.size }},
  semana, totais: medir(leads), nichos, segmentos: decisao.segmentos, buscas: porBusca, nao_gerar }};
return [{{ json: estado, binary: {{ data: {{ data: Buffer.from(JSON.stringify(estado), 'utf8').toString('base64'),
  mimeType: 'application/json', fileName: 'site-funil.json' }} }} }}];"""

AVISO_FUNIL = f"""const NL = String.fromCharCode(10);
const f = $('Funil').first().json;
const linha = (m) => [m.leads, m.sites, m.enviados, m.responderam, m.em_conversa, m.recusados, m.concluidos].join(' · ');
const nichos = f.nichos.filter(n => n.sites > 0);
const pausadas = f.buscas.filter(b => b.pausar);
const naoGerar = f.nao_gerar ?? [];
// Nicho sem sinal de compra: o que pausou agora, o que já estava parado e o que o Rômulo religou.
const semSinal = (f.segmentos ?? []).filter(s => s.sem_sinal);
const situacao = (s) => s.religado ? 'religado por você, segue rodando'
  : s.pausadas_agora ? 'pausado agora (' + s.pausadas_agora + ' busca(s))'
  : s.buscas_ligadas ? 'segue com ' + s.buscas_ligadas + ' busca(s) ligada(s)' : 'já estava pausado';
const texto = [
  'Últimos 7 dias: ' + f.semana.leads + ' leads, ' + f.semana.sites + ' sites, ' + f.semana.enviados + ' enviados, ' + f.semana.responderam + ' respostas.',
  '',
  'Por nicho (leads · sites · enviados · responderam · em conversa · recusados · concluídos):',
  ...nichos.map(n => '• ' + n.nicho + ': ' + linha(n)),
  '*Total:* ' + linha(f.totais),
  '',
  ...(f.crm && !f.crm.lido ? ['A aba CRM não foi lida (' + f.crm.erro + '): a pausa por falta de sinal de compra ficou para a próxima segunda.', ''] : []),
  semSinal.length
    ? 'Nichos sem sinal de compra (' + f.regra.sem_sinal_max + '+ enviados e nenhum interesse, pedido de preço, proposta ou ganho; negativa e robô não contam):' + NL
      + semSinal.map(s => '• ' + s.nicho + ': ' + s.porque + ', em ' + s.cidades + ' cidade(s). ' + situacao(s) + '.').join(NL)
    : 'Nenhum nicho com ' + f.regra.sem_sinal_max + '+ enviados sem sinal de compra.',
  '',
  pausadas.length
    ? 'Buscas pausadas agora (o Caçador não as roda mais):' + NL
      + pausadas.map(b => '• "' + b.query + '"' + (b.cidade ? ' em ' + b.cidade : '') + ' (' + b.lat + ', ' + b.lng + '): '
        + b.pausa_motivo).join(NL)
      + NL + 'Para religar, ponha TRUE em ativa na aba Buscas: com pausada_em preenchida a regra não pausa de novo.'
    : 'Nenhuma busca pausada esta semana.',
  ...(naoGerar.length ? ['', naoGerar.length + ' lead(s) novo(s) de busca ou nicho desligado ficam fora da fila do gerador de sites.'] : []),
  '',
  'Planilha: {LINK_PLANILHA}',
].join(NL);
const titulo = '📊 Site antes da venda: funil da semana';
return [{{ json: {{ titulo, texto }}, binary: {{ data: {{ data: Buffer.from(JSON.stringify({{ titulo, texto, origem: ('n8n:' + $workflow.name).slice(0, 80) }}), 'utf8').toString('base64'),
  mimeType: 'application/json', fileName: 'aviso.json' }} }} }}];"""


BUSCAS_A_PAUSAR = """// Uma linha por busca pausada agora; sem nenhuma, "Pausar na aba Buscas" nem roda.
const agora = $now.toFormat("yyyy-MM-dd'T'HH:mm");
return $('Funil').first().json.buscas.filter(b => b.pausar && b.linha).map(b => ({ json: {
  row_number: Number(b.linha), ativa: 'FALSE', pausada_em: agora, pausa_motivo: b.pausa_motivo,
} }));"""


def pausar_buscas(x, y):
    """Update da aba Buscas pela linha, como o "Registrar ultima_rodada" do Caçador.
    USER_ENTERED: FALSE vira booleano (checkbox ou texto, o Caçador lê os dois)."""
    colunas = ["row_number", "ativa", *COLUNAS_BUSCAS]
    return {"id": "pausar-buscas", "name": "Pausar na aba Buscas", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7,
            "position": [x, y], "credentials": SHEETS, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
            "parameters": {"resource": "sheet", "operation": "update",
                           "documentId": {"__rl": True, "mode": "id", "value": PLANILHA},
                           "sheetName": {"__rl": True, "mode": "id", "value": BUSCAS_GID, "cachedResultName": "Buscas"},
                           "columns": {"mappingMode": "defineBelow", "matchingColumns": ["row_number"],
                                       "value": {c: "={{ $json." + c + " }}" for c in colunas},
                                       "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": False,
                                                   "display": True, "type": "number" if c == "row_number" else "string",
                                                   "canBeUsedToMatch": True, **({"readOnly": True} if c == "row_number" else {})}
                                                  for c in colunas]},
                           "options": {"cellFormat": "USER_ENTERED"}}}


def funil(erro):
    _, gravar = aviso_nodes("funil", 1540, 120, "''")
    gravar["name"] = "Avisar pelo Hermes"
    nos = [
        {"id": "segunda", "name": "Segunda 08:00", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0],
         "parameters": {"rule": {"interval": [{"field": "weeks", "weeksInterval": 1, "triggerAtDay": [1],
                                               "triggerAtHour": 8, "triggerAtMinute": 0}]}}},
        *recibos(),
        ler_aba("planilha", "Ler a planilha", LEADS_GID, "Leads", [660, 0]),
        ler_aba_crm([770, 200]),
        ler_aba("buscas", "Ler Buscas", BUSCAS_GID, "Buscas", [880, 0]),
        code("funil", "Funil", FUNIL, [1100, 0]),
        {"id": "gravar-funil", "name": "Gravar funil", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [1320, -120], "parameters": {"operation": "write", "dataPropertyName": "data",
                                                  "fileName": "/home/node/.n8n-files/estado/site-funil.json"}},
        code("aviso-funil", "Montar aviso", AVISO_FUNIL, [1320, 120]),
        gravar,
        code("buscas-a-pausar", "Buscas a pausar", BUSCAS_A_PAUSAR, [1320, 360]),
        pausar_buscas(1540, 360),
    ]
    con = em_fila(["Segunda 08:00", "Ler recibos da pasta auto", "Ler o JSON do recibo", "Ler a planilha", "Ler aba CRM",
                   "Ler Buscas", "Funil"])
    con["Funil"] = {"main": [[{"node": n, "type": "main", "index": 0}
                              for n in ("Gravar funil", "Montar aviso", "Buscas a pausar")]]}
    con["Montar aviso"] = {"main": [[{"node": "Avisar pelo Hermes", "type": "main", "index": 0}]]}
    con["Buscas a pausar"] = {"main": [[{"node": "Pausar na aba Buscas", "type": "main", "index": 0}]]}
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


def colunas_buscas():
    """Acrescenta no fim do cabeçalho da aba Buscas as colunas da pausa, se faltarem
    (o fluxo escreve pelo nome; coluna que não existe é ignorada pelo n8n)."""
    from sheets_proxy import SheetsProxy
    with SheetsProxy([PLANILHA]) as s:
        meta = s.get(f"/v4/spreadsheets/{PLANILHA}?fields=sheets.properties")
        props = next(x["properties"] for x in meta["sheets"] if str(x["properties"]["sheetId"]) == BUSCAS_GID)
        aba = props["title"]
        cab = (s.get(f"/v4/spreadsheets/{PLANILHA}/values/" + quote(f"{aba}!1:1")).get("values") or [[]])[0]
        faltam = [c for c in COLUNAS_BUSCAS if c not in cab]
        if not faltam:
            print(f"{aba}: colunas já existem:", ", ".join(COLUNAS_BUSCAS))
            return
        grade = props["gridProperties"]["columnCount"]
        if len(cab) + len(faltam) > grade:
            s.post(f"/v4/spreadsheets/{PLANILHA}:batchUpdate", {"requests": [{"appendDimension": {
                "sheetId": int(BUSCAS_GID), "dimension": "COLUMNS", "length": len(cab) + len(faltam) - grade}}]})
        letra = lambda n: (letra(n // 26 - 1) if n >= 26 else "") + chr(ord("A") + n % 26)
        faixa = f"{aba}!{letra(len(cab))}1:{letra(len(cab) + len(faltam) - 1)}1"
        s.post(f"/v4/spreadsheets/{PLANILHA}/values:batchUpdate",
               {"valueInputOption": "RAW", "data": [{"range": faixa, "values": [faltam]}]})
        print(f"{aba}: colunas novas em {faixa}:", ", ".join(faltam))


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
    return {"titulo": "🗂️ Site antes da venda: acervo sem automação", "texto": texto, "origem": "site-acompanhamento"}


# A lib de aviso (deploy/dell/lib/aviso.py, 11/10/2026): no repo, em ../lib ao
# lado desta pasta; no Dell, instalada em ~/.local/lib/mel/ (instalados.json).
# Primeiro a do repo, para o teste nunca pegar uma cópia instalada.
PASTAS_DA_LIB = [AQUI.parent / "lib", Path.home() / ".local/lib/mel"]


def lib_de_aviso():
    """O módulo da lib, ou None quando nenhuma cópia existe ou carrega: aí o
    --enviar volta ao jeito antigo e o aviso sai do mesmo modo que antes."""
    for pasta in PASTAS_DA_LIB:
        arquivo = pasta / "aviso.py"
        if not arquivo.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", arquivo)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # noqa: BLE001 — cópia quebrada não derruba o script: tenta a próxima
            continue
    return None


def enviar_para_a_fila(aviso: dict) -> bool:
    """O `--resumo-backlog --enviar`: põe o aviso pronto (titulo, texto, origem)
    na fila do dell-status e diz o que aconteceu. True se entrou na fila.

    Com a lib: grava atômico, nome sem colisão, pasta da fila ausente vira uma
    mensagem (e não um traceback) e o texto do acervo, que pode passar de 4000
    caracteres, é cortado com marca em vez de o dell-status recusar o arquivo."""
    lib = lib_de_aviso()
    if lib is None:
        # Sem a lib instalada: o jeito de antes, sem mudar nada.
        # (utf-8 explícito: antes dependia do locale; no Dell já era utf-8, o arquivo é o mesmo.)
        (FILA / f"site-acervo-{int(time.time())}.json").write_text(json.dumps(aviso, ensure_ascii=False), encoding="utf-8")
        print("\n-> na fila de avisos")
        return True
    aviso = dict(aviso)
    if lib.VALOR_EM_REAIS.search(aviso["texto"]):
        aviso["texto"] = lib.sem_valores(aviso["texto"])
        print("\n(um valor em R$ do texto virou [valor]: a fila de avisos não leva valor)")
    longo = len(aviso["texto"]) > lib.MAX_CARACTERES["texto"]
    r = lib.gravar(aviso, fila=FILA, prefixo="site-acervo")
    if not r.gravado:
        print(f"\n-> NÃO entrou na fila de avisos ({r.estado}): {r.motivo}")
        return False
    print("\n-> na fila de avisos" + (f" (texto cortado em {lib.MAX_CARACTERES['texto']} caracteres; o resumo inteiro está acima)"
                                       if longo else ""))
    return True


def rodar_no(codigo: str, dados: dict, entrada: list) -> list:
    """Roda o código de um nó Code no node do Dell: `$('Nó')` devolve `dados[nó]`
    (lista = .all(), objeto = .first()) e `$input.all()` devolve `entrada`."""
    import shutil
    import tempfile
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    prog = ("const dados = " + json.dumps(dados, ensure_ascii=False) + ";\n"
            "const $ = (n) => ({ all: () => (dados[n] ?? []).map(json => ({ json })), first: () => ({ json: dados[n] }) });\n"
            "const $input = { all: () => " + json.dumps(entrada, ensure_ascii=False) + ".map(json => ({ json })) };\n"
            "const $now = { toFormat: () => '2026-10-05T08:00' };\n"
            # O aviso leva a origem (n8n.ORIGEM_JS, 06/10/2026), que lê o nome do fluxo.
            "const $workflow = { name: '06 · Funil semanal (teste)' };\n"
            "const itens = (() => {\n" + codigo + "\n})();\n"
            "console.log(JSON.stringify(itens.map(i => i.json)));\n")
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "no.mjs"
        arq.write_text(prog, encoding="utf-8")
        r = subprocess.run([str(exe), str(arq)], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def testar_regra() -> int:
    """A regra da pausa sem n8n nem planilha: o código dos nós Funil e "Buscas a
    pausar" no node, com uma aba Buscas e uma aba Leads de mentira."""
    import unittest

    def busca(linha, query, vertical, rodada, ativa="TRUE", pausada_em=""):
        return {"row_number": linha, "query": query, "vertical": vertical, "lat": "0", "lng": "0", "ativa": ativa,
                "ultima_rodada": rodada, "pausada_em": pausada_em}

    def leads(prefixo, vertical, cidade, criado, n, **k):
        return [{"place_id": f"{prefixo}{i}", "nome": f"{prefixo}{i}", "vertical": vertical, "cidade": cidade,
                 "criado_em": criado, "status": "enviado", "site_url": "https://x", "enviado_em": "2026-10-01T10:00:00-03:00",
                 "respondeu_em": "", **k} for i in range(n)]

    buscas = [
        busca(2, "vidraçaria", "vidracaria", "2026-09-23T06:00"),
        busca(3, "pousada", "pousada", "2026-09-25T06:00"),
        busca(4, "espaço para eventos", "eventos", "2026-09-24T06:00"),
        busca(5, "academia", "fitness", "2026-09-18T06:00", pausada_em="2026-09-28T08:00"),  # religada pelo Rômulo
        busca(6, "clínica odontológica", "odontologia", "2026-09-15T06:00", ativa="FALSE"),
        busca(7, "buffet infantil", "eventos", "2026-09-26T06:00"),
    ]
    planilha = (
        leads("vid", "vidraçaria", "Joinville", "2026-09-23T06:05:00-03:00", 5)
        + [{**leads("vidnovo", "vidraçaria", "Joinville", "2026-09-23T06:05:00-03:00", 1)[0], "status": "novo", "site_url": "", "enviado_em": ""}]
        # Só a saudação automática (2 min depois do envio): não é resposta humana.
        + leads("pou", "pousada", "Ubatuba", "2026-09-25T06:05:00-03:00", 5, respondeu_em="2026-10-01T10:02:00-03:00")
        + leads("eve", "espaço de eventos", "Campinas", "2026-09-24T06:05:00-03:00", 4)
        + leads("evr", "espaço de eventos", "Campinas", "2026-09-24T06:05:00-03:00", 1, respondeu_em="2026-10-01T11:00:00-03:00")
        # Só "não tenho interesse": responderam, mas a busca não paga o site.
        + leads("buf", "buffet infantil", "Ribeirão Preto", "2026-09-26T06:05:00-03:00", 4)
        + leads("bun", "buffet infantil", "Ribeirão Preto", "2026-09-26T06:05:00-03:00", 2,
                respondeu_em="2026-10-01T12:00:00-03:00", resposta_tipo="negativa")
        # Pediu para apagar o demo (07/10/2026): para o funil é negativa.
        + leads("bux", "buffet infantil", "Ribeirão Preto", "2026-09-26T06:05:00-03:00", 1,
                respondeu_em="2026-10-01T12:00:00-03:00", resposta_tipo="exclusao")
        + leads("aca", "academia", "Belo Horizonte", "2026-09-18T06:05:00-03:00", 5)
        + [{**leads("odo", "odontologia", "São Paulo", "2026-09-15T06:05:00-03:00", 1)[0], "status": "novo", "site_url": "", "enviado_em": ""}]
    )
    # Sem sinal de compra (08/10/2026). Cada busca roda num horário próprio para o lote dela
    # cair só nela; `resp` é uma resposta humana (1 h depois do envio).
    resp = {"respondeu_em": "2026-10-01T11:00:00-03:00"}
    novo = {"status": "novo", "site_url": "", "enviado_em": ""}
    buscas += [
        # Nicho dedetização: Sorocaba sozinha passa de 20 sem sinal; Curitiba cai pelo nicho.
        busca(20, "dedetizadora", "dedetização", "2026-10-02T06:00"),
        busca(21, "dedetizadora", "dedetização", "2026-10-02T08:00"),
        # Nicho camping: já parado em Paraty, religado em Ubatuba; Ilhabela (nunca rodou) segue.
        busca(22, "camping", "camping", "2026-10-02T10:00", ativa="FALSE", pausada_em="2026-10-05T20:03"),
        busca(23, "camping", "camping", "2026-10-02T12:00", pausada_em="2026-10-06T09:00"),
        busca(24, "camping", "camping", ""),
        # Cada um tem 21 enviados e um único sinal; engenharia tem uma proposta desfeita, que não vale.
        busca(25, "empresa de reformas", "reformas", "2026-10-02T14:00"),
        busca(26, "escritório de contabilidade", "contabilidade", "2026-10-02T16:00"),
        busca(27, "usinagem", "usinagem", "2026-10-02T18:00"),
        busca(28, "advogado", "advocacia", "2026-10-02T20:00"),
        busca(29, "escritório de engenharia", "engenharia", "2026-10-02T22:00"),
        # Advocacia em Brasília, 08/10/2026: 5 envios do mesmo dia, sem resposta. Ainda não é silêncio.
        busca(30, "advogado trabalhista", "trabalhista", "2026-10-03T06:00"),
    ]
    ontem = datetime.fromtimestamp(time.time() - 86400, timezone.utc).isoformat()
    planilha += (
        # Neutras seguravam a busca pela regra do silêncio; para o sinal de compra não contam.
        leads("ded", "dedetização", "Sorocaba", "2026-10-02T06:05:00-03:00", 16)
        + leads("den", "dedetização", "Sorocaba", "2026-10-02T06:05:00-03:00", 3, **resp, resposta_tipo="neutra",
                resposta_trecho="quem é você?")
        + leads("deg", "dedetização", "Sorocaba", "2026-10-02T06:05:00-03:00", 1, **resp, resposta_tipo="negativa",
                resposta_trecho="não temos interesse no valor")
        + leads("dcu", "dedetização", "Curitiba", "2026-10-02T08:05:00-03:00", 2, **resp, resposta_tipo="neutra")
        + [{**leads("dlo", "dedetização", "Londrina", "2026-10-07T06:05:00-03:00", 1)[0], **novo}]  # sem busca: cai pelo nicho
        + leads("cap", "camping", "Paraty", "2026-10-02T10:05:00-03:00", 20)
        + leads("cau", "camping", "Ubatuba", "2026-10-02T12:05:00-03:00", 2, **resp, resposta_tipo="bot")
        + [{**leads("cil", "camping", "Ilhabela", "2026-10-07T06:05:00-03:00", 1)[0], **novo}]
        + leads("ref", "reformas", "Jundiaí", "2026-10-02T14:05:00-03:00", 21)  # ref0 tem proposta aberta na aba CRM
        + leads("con", "contabilidade", "Londrina", "2026-10-02T16:05:00-03:00", 20)
        + [{**leads("cof", "contabilidade", "Londrina", "2026-10-02T16:05:00-03:00", 1)[0], "status": "fechado"}]
        + leads("usi", "usinagem", "Caxias do Sul", "2026-10-02T18:05:00-03:00", 20)
        + leads("usx", "usinagem", "Caxias do Sul", "2026-10-02T18:05:00-03:00", 1, **resp, resposta_tipo="interesse")
        + leads("adv", "advocacia", "Brasília", "2026-10-02T20:05:00-03:00", 20, **resp, resposta_tipo="bot")
        + leads("adp", "advocacia", "Brasília", "2026-10-02T20:05:00-03:00", 1, **resp, resposta_tipo="neutra",
                resposta_trecho="Qual o preço?")
        + leads("eng", "engenharia", "Curitiba", "2026-10-02T22:05:00-03:00", 21)
        + leads("trb", "trabalhista", "Goiânia", "2026-10-03T06:05:00-03:00", 5, enviado_em=ontem)
    )
    crm = [
        {"em": "2026-10-03T10:00:00Z", "produto": "site", "id": "ref0", "tipo": "proposta", "data": "2026-10-03"},
        {"em": "2026-10-03T10:00:00Z", "produto": "site", "id": "eng0", "tipo": "proposta", "data": "2026-10-03"},
        {"em": "2026-10-04T10:00:00Z", "produto": "site", "id": "eng0", "tipo": "proposta_desfeita"},
        {"em": "2026-10-04T10:00:00Z", "produto": "prumo", "id": "eng1", "tipo": "proposta"},  # outro produto
    ]
    dados = {"Ler o JSON do recibo": [], "Ler recibos da pasta auto": [], "Ler a planilha": planilha, "Ler aba CRM": crm}

    class Regra(unittest.TestCase):
        @classmethod
        def setUpClass(cls):
            cls.f = rodar_no(FUNIL, dados, buscas)[0]
            cls.por = {b["linha"]: b for b in cls.f["buscas"]}
            cls.seg = {s["nicho"]: s for s in cls.f["segmentos"]}
            cls.pausas = rodar_no(BUSCAS_A_PAUSAR, {"Funil": cls.f}, [])
            cls.aviso = rodar_no(AVISO_FUNIL, {"Funil": cls.f}, [])[0]["texto"]

        def test_pausa_so_sem_resposta_humana(self):
            por = self.por
            self.assertEqual(por[2]["regra"], "silencio")  # vidraçaria
            self.assertTrue(por[3]["pausar"])  # pousada: resposta a 2 min do envio não conta
            self.assertFalse(por[4]["pausar"])  # eventos: 1 resposta humana
            self.assertFalse(por[5]["pausar"])  # academia: pausada_em + ativa, o Rômulo religou
            self.assertFalse(por[6]["pausar"])  # odontologia: já desligada
            self.assertTrue(por[7]["pausar"])  # buffet: só respostas negativas
            self.assertEqual({p["ativa"] for p in self.pausas}, {"FALSE"})
            self.assertTrue(all(p["pausada_em"] and p["pausa_motivo"].endswith("(funil semanal)") for p in self.pausas))
            self.assertIn("nenhuma resposta humana", por[2]["pausa_motivo"])

        def test_busca_e_nicho_sem_sinal_de_compra(self):
            self.assertEqual(self.por[20]["regra"], "busca_sem_sinal")  # 20 enviados, 3 neutras e 1 negativa
            self.assertIn("20 enviados; respostas: 3 neutras, 1 negativa", self.por[20]["pausa_motivo"])
            self.assertEqual(self.por[21]["regra"], "nicho_sem_sinal")  # 2 enviados, mas o nicho tem 22
            self.assertIn("nicho dedetizacao sem sinal de compra: 22 enviados", self.por[21]["pausa_motivo"])
            self.assertIn("em 2 cidade(s)", self.por[21]["pausa_motivo"])
            d = self.seg["dedetizacao"]
            self.assertEqual((d["enviados"], d["sinais"], d["ruim"], d["pausadas_agora"]), (22, 0, True, 2))

        def test_cada_sinal_de_compra_segura_o_nicho(self):
            for linha in (25, 26, 27, 28):  # proposta aberta, fechado, interesse, pedido de preço
                self.assertFalse(self.por[linha]["pausar"], self.por[linha]["query"])
                self.assertEqual(self.por[linha]["sinais"], 1, self.por[linha]["query"])
            self.assertEqual(self.por[29]["regra"], "busca_sem_sinal")  # proposta desfeita não é sinal

        def test_envio_de_menos_de_3_dias_nao_conta(self):
            self.assertFalse(self.por[30]["pausar"])  # 5 envios de ontem, sem resposta
            self.assertEqual(self.por[30]["enviados"], 0)

        def test_negativa_e_robo_nao_sao_sinal(self):
            self.assertEqual(self.seg["dedetizacao"]["tipos"], {"neutra": 5, "negativa": 1})  # "valor" na negativa
            self.assertEqual(self.seg["advocacia"]["sinais"], 1)  # o preço, não os 20 robôs

        def test_religar_e_o_que_ja_estava_parado(self):
            c = self.seg["camping"]
            self.assertTrue(c["sem_sinal"] and c["religado"])
            self.assertFalse(c["ruim"])
            self.assertFalse(self.por[22]["pausar"])  # já desligada
            self.assertFalse(self.por[23]["pausar"])  # religada
            self.assertFalse(self.por[24]["pausar"])  # nicho religado: a busca nova segue

        def test_nao_gerar_leva_os_novos_de_busca_ou_nicho_desligado(self):
            self.assertEqual(sorted(x["place_id"] for x in self.f["nao_gerar"]), ["dlo0", "odo0", "vidnovo0"])
            self.assertEqual(next(x["busca"] for x in self.f["nao_gerar"] if x["place_id"] == "dlo0"), "nicho dedetizacao")

        def test_linhas_gravadas(self):
            self.assertEqual([p["row_number"] for p in self.pausas], [2, 3, 7, 20, 21, 29])

        def test_aviso_diz_quais_nichos_e_por_que(self):
            self.assertIn("Nichos sem sinal de compra (20+ enviados", self.aviso)
            self.assertIn("• dedetizacao: 22 enviados; respostas: 5 neutras, 1 negativa, em 2 cidade(s). pausado agora (2 busca(s)).", self.aviso)
            self.assertIn("• camping: 22 enviados; respostas: 2 robôs, em 2 cidade(s). religado por você", self.aviso)
            self.assertIn("Buscas pausadas agora", self.aviso)
            self.assertIn('"vidraçaria" em Joinville', self.aviso)
            self.assertIn("3 lead(s) novo(s) de busca ou nicho desligado", self.aviso)

        def test_sem_a_aba_crm_so_vale_o_silencio(self):
            f = rodar_no(FUNIL, {**dados, "Ler aba CRM": [{"error": {"message": "credencial caída"}}]}, buscas)[0]
            por = {b["linha"]: b for b in f["buscas"]}
            self.assertEqual(por[2]["regra"], "silencio")
            self.assertFalse(any(b["regra"] in ("busca_sem_sinal", "nicho_sem_sinal") for b in f["buscas"]))
            aviso = rodar_no(AVISO_FUNIL, {"Funil": f}, [])[0]["texto"]
            self.assertIn("A aba CRM não foi lida (credencial caída)", aviso)

    class Sinal(unittest.TestCase):
        def test_tabela(self):
            casos = [  # (lead, proposta aberta?, sinal)
                ({"status": "fechado", "resposta_tipo": "negativa"}, False, "ganho"),
                ({"resposta_tipo": "negativa"}, True, "proposta"),
                ({"resposta_tipo": "Interesse"}, False, "interesse"),
                ({"resposta_tipo": "neutra", "resposta_trecho": "Quanto custa?"}, False, "preço"),
                ({"resposta_tipo": "", "resposta_trecho": "me passa um orçamento"}, False, "preço"),
                ({"resposta_tipo": "neutra", "resposta_trecho": "quem é?"}, False, ""),
                ({"resposta_tipo": "negativa", "resposta_trecho": "não tenho interesse, qual o valor disso?"}, False, ""),
                ({"resposta_tipo": "bot", "resposta_trecho": "Veja nossos preços no catálogo"}, False, ""),
                ({"resposta_tipo": "exclusao", "resposta_trecho": "apague, não quero orçamento"}, False, ""),
                ({"resposta_tipo": "neutra", "resposta_trecho": "valorizamos seu contato"}, False, ""),
            ]
            js = sv.codigo_js("site-funil-regra.js") + "\nreturn " + json.dumps(
                [{"json": {"l": {"place_id": "p", **l}, "p": p}} for l, p, _ in casos], ensure_ascii=False
            ) + ".map(c => ({ json: { s: sinalDeCompra(c.json.l, new Set(c.json.p ? ['p'] : [])) } }));"
            self.assertEqual([x["s"] for x in rodar_no(js, {}, [])], [s for _, _, s in casos])

    class Trava(unittest.TestCase):
        def test_fluxo_desligado_nao_e_religado(self):
            import n8n
            for wid in n8n.DESLIGADOS:
                self.assertEqual(n8n.api("POST", f"/workflows/{wid}/activate"), {"active": False, "desligado": True})

    carregar = unittest.defaultTestLoader.loadTestsFromTestCase
    r = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([carregar(c) for c in (Regra, Sinal, Trava)]))
    return 0 if r.wasSuccessful() else 1


if __name__ == "__main__":
    if "--testar-regra" in sys.argv:
        sys.exit(testar_regra())
    erro = sv.erro_wf()
    if "--resumo-backlog" in sys.argv:
        aviso = resumo_backlog()
        print(aviso["titulo"], "\n" + aviso["texto"])
        if "--enviar" in sys.argv and not enviar_para_a_fila(aviso):
            sys.exit(1)
    elif "--testar" in sys.argv:
        wf = acompanhamento(erro)
        # O corte real (hoje) deixaria tudo como acervo: no teste ele volta para 01/09.
        decidir = copy.deepcopy(next(n for n in wf["nodes"] if n["name"] == "Decidir"))
        decidir["parameters"]["jsCode"] = decidir["parameters"]["jsCode"].replace(CORTE, "2026-09-01T00:00:00-03:00")
        s = testar(wf, {"Ler a planilha": planilha_de_mentira(cenario_acompanhamento()), "Decidir": decidir,
                        "Marcar na planilha": noop("Marcar na planilha"), "Avisar pelo Hermes": noop("Avisar pelo Hermes")})
        print(json.dumps({"Decidir": s.get("Decidir"), "Montar avisos": s.get("Montar avisos")}, ensure_ascii=False, indent=1))
        s = testar(funil(erro), {"Gravar funil": noop("Gravar funil"), "Avisar pelo Hermes": noop("Avisar pelo Hermes"),
                                 "Pausar na aba Buscas": noop("Pausar na aba Buscas")})
        f = (s.get("Funil") or [{}])[0]
        print(json.dumps({k: f.get(k) for k in ("semana", "totais", "buscas", "nao_gerar")}, ensure_ascii=False, indent=1))
        print("pausaria:", json.dumps(s.get("Buscas a pausar") or [], ensure_ascii=False))
        print((s.get("Montar aviso") or [{}])[0].get("texto"))
    elif "--simular" in sys.argv:
        s = testar(funil(erro), {"Gravar funil": noop("Gravar funil"), "Avisar pelo Hermes": noop("Avisar pelo Hermes"),
                                 "Pausar na aba Buscas": noop("Pausar na aba Buscas")})
        f = (s.get("Funil") or [{}])[0]
        print("\naba CRM:", json.dumps(f.get("crm"), ensure_ascii=False))
        print("\nSegmentos (enviados / sinais de compra):")
        for x in f.get("segmentos") or []:
            if x["enviados"]:
                print(f"  {x['nicho']}: {x['porque']}; sinais {x['sinais']}; {x['cidades']} cidade(s); ligadas depois "
                      f"{x['buscas_ligadas']}{' · SEM SINAL' if x['sem_sinal'] else ''}{' · religado' if x['religado'] else ''}")
        print("\nPausaria agora:")
        for b in f.get("buscas") or []:
            if b["pausar"]:
                print(f"  linha {b['linha']} \"{b['query']}\" {b['cidade'] or '(sem cidade)'} [{b['regra']}]: {b['pausa_motivo']}")
        print("\nnao_gerar:", len(f.get("nao_gerar") or []), json.dumps(f.get("nao_gerar") or [], ensure_ascii=False))
        print("\n" + str((s.get("Montar aviso") or [{}])[0].get("texto")))
    elif "--colunas" in sys.argv:
        colunas_buscas()
    else:
        try:
            colunas_buscas()
        except (SystemExit, Exception) as e:  # sem as colunas a pausa funciona, só não lembra quem o Rômulo religou
            print(f"colunas da aba Buscas não criadas ({e}); rode de novo com --colunas")
        publicar(acompanhamento(erro))
        publicar(funil(erro))
