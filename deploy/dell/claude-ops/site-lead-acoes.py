"""Página do lead com os botões Recusou / Fechou / Desfazer (30/09/2026). Idempotente: recria pelo nome.

Decisão do Rômulo (29/09/2026): o Hermes não manda mensagem a lead nenhum
(risco de banimento do WhatsApp), mas o Rômulo quer marcar o desfecho de cada
lead com um toque no celular. Os botões só mudam a planilha e a pasta; nada é
enviado a ninguém.

"07 · Lead: página e ações (Site antes da venda)", três entradas:

- GET /webhook/lead?id=<place_id>: página pequena (nome, link do demo, estado
  atual e os botões). id desconhecido: "lead não encontrado", nada gravado.
- /webhook/lead-acao?id=<place_id>&acao=recusou|fechou|desfazer|gerar_demo: o toque. Na publicação,
  workflow_confiabilidade.confirmar_acao (regra [confirmacao-http]) muda o desenho: o GET NÃO grava,
  só mostra uma página de confirmação com o formulário; quem grava é o POST do botão "Confirmar", que
  precisa vir da mesma origem (tailnet ou loopback) e com o contexto (o estado do lead) igual ao da
  página, senão 403 (origem) ou 409 (o lead mudou, reabra). Link aberto, recarregado ou pré-visualizado
  nunca escreve. O nó "Decidir a ação" abaixo descreve a decisão; o guard vem na frente dele.
  recusou -> status "recusado" + recusado_em; fechou -> "fechado" + fechado_em;
  os dois guardam em status_anterior o que o Desfazer devolve. Desfazer volta a
  status_anterior (sem ele, "enviado") e apaga a data. A pasta muda pelo
  site-pastas do Dell (pacote em estado/site-acoes/): recusou -> _recusados/,
  fechou -> _fechados/, desfazer -> onde estava; o site-pastas também anota a
  linha no registro.md. Repetir o toque não muda nada ("já estava assim"). O
  lead em _recusados/ sem status "recusado" (recusa anotada à mão, acervo de
  25/09) já conta como recusado; Desfazer nele só tira a pasta de lá (vai para
  _em-conversa/). Depois do toque, volta para a página com o estado novo.
- A cada hora (:20): retrato da planilha em estado/site-leads.json (status,
  datas, pasta, grupo e link de cada lead com site), que o resumo das 10:30
  (sites_e_pendencias.py) usa para pôr o link de cada lead; e a coluna acoes_link da planilha com o link de cada lead
  que tem site (só grava as que faltam). Desde 07/10/2026 o retrato leva também
  resposta_tipo, mensagem_variante e site_versao (o funil compara o que cada
  lead recebeu com o que respondeu; o site-demos-limpeza --exclusao confere o
  pedido de exclusão nele).

Links pela tailnet (tailscale serve /webhook), como o wa_link: abrem no celular
com o Tailscale ligado.

Uso: python3 site-lead-acoes.py                 colunas que faltam + publica e ativa o 07
     python3 site-lead-acoes.py --colunas       só acrescenta as colunas que faltam na aba Leads
     python3 site-lead-acoes.py --retrato-agora roda o retrato (e a coluna acoes_link) agora
     python3 site-lead-acoes.py --testar [--mostrar]
                                                cópia com planilha de mentira, sem gravar nada:
                                                confere cada botão e a página (sem credencial Google),
                                                depois de --testar-retrato
     python3 site-lead-acoes.py --testar-retrato
                                                só o código do retrato no node (sem n8n nem planilha)
     python3 site-lead-acoes.py --verificar [place_id_em_recusados]
                                                id inexistente e um lead já em _recusados/
                                                (recusou de novo = nada muda); não grava nada
"""
import copy
import importlib.util
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from urllib.parse import quote

from n8n import api, put

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("site_antes_da_venda", AQUI / "site-antes-da-venda.py")
sv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sv)

PLANILHA, SHEETS = sv.PLANILHA, sv.SHEETS
LEADS_GID = sv.LEADS_GID
NOME = "07 · Lead: página e ações (Site antes da venda)"
LINKS = sv.LINKS
LOCAL = "http://127.0.0.1:5679/webhook"
COLUNAS_NOVAS = ["status_anterior", "recusado_em", "fechado_em", "acoes_link"]
ESTADO = "/home/node/.n8n-files/estado/"
BACKUPS = Path.home() / ".local/share/claude-ops/backups" / date.today().isoformat()


def pasta_js(ler, extrair):
    """PASTA_DO_LEAD_JS do Balcão, lendo os nós de recibo desta entrada."""
    return (sv.PASTA_DO_LEAD_JS.replace("$('Ler recibos da pasta auto')", f"$('{ler}')")
            .replace("$('Ler o JSON do recibo')", f"$('{extrair}')"))


ESTADO_JS = f"""const LINKS = '{LINKS}';
const txt = (v) => String(v ?? '').trim();
const linkDoLead = (pid) => LINKS + '/lead?id=' + encodeURIComponent(pid);
const topoDe = (pid) => {{ const p = pasta[pid] ?? ''; return !p ? '' : (p.includes('/') ? p.split('/')[0] : 'raiz'); }};
// Estado do lead: a planilha decide recusado/fechado/expirado; a pasta cobre a
// recusa anotada à mão (acervo de 25/09/2026, só _recusados/) e a conversa.
const estadoDe = (l) => {{
  const s = txt(l.status), topo = topoDe(txt(l.place_id));
  if (s === 'fechado') return 'fechado';
  if (s === 'recusado' || topo === '_recusados') return 'recusado';
  if (s === 'expirado') return 'expirado';
  if (topo === '_em-conversa' || (s === 'enviado' && txt(l.respondeu_em))) return 'conversa';
  return s || 'novo';
}};
// 14/10/2026 (demo sob pedido): o lead sem demo (sem site_url) pode pedir o demo; quem recusou, fechou ou
// foi descartado, não. O site-pastas confere de novo (e ignora repetição).
// 15/10/2026: sem exigir publicado.json. O lead que recebeu a A sem demo (gerador que falhou, fila antiga)
// não tem recibo nenhum; o site-pastas acha a pasta dele pelo place_id do content.md.
const podeGerarDemo = (l) => !txt(l.site_url) && Boolean(txt(l.place_id))
  && !['recusado', 'fechado', 'descartado'].includes(estadoDe(l));"""

PAGINA_JS = """// Página do lead: estado atual e os botões. Nada aqui grava.
const q = $('Abrir a página do lead').first().json.query ?? {};
const pid = txt(q.id), feito = txt(q.feito);
const l = $input.all().map(i => i.json).find(r => pid && txt(r.place_id) === pid);
const esc = (t) => txt(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const quando = (iso) => { const t = Date.parse(txt(iso)); return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR',
  { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : ''; };
const em = (iso) => quando(iso) ? ' em ' + quando(iso) : '';
const CSS = `:root{--fundo:#f6f5f2;--cartao:#fff;--texto:#1d1d1b;--suave:#6b6a66;--linha:#e3e1dc;--recusou:#b3261e;--fechou:#1e7d4f;--neutro:#3d3d3a}
@media (prefers-color-scheme:dark){:root{--fundo:#161615;--cartao:#211f1e;--texto:#f1efe9;--suave:#a19f99;--linha:#34322f;--recusou:#f2877f;--fechou:#6fd3a0;--neutro:#d6d4ce}}
*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--texto);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:30rem;margin:0 auto;padding:1.25rem 1rem 2.5rem}h1{font-size:1.35rem;line-height:1.25;margin:.25rem 0 .35rem}
.sub,.nota{color:var(--suave);font-size:.9rem;margin:.2rem 0}.sub a{color:inherit}
.cartao{background:var(--cartao);border:1px solid var(--linha);border-radius:14px;padding:1rem;margin:1rem 0}
.estado{font-size:1.05rem;margin:0}.estado b{font-weight:650}
.aviso{border-radius:12px;padding:.7rem .9rem;margin:0 0 .9rem;background:var(--cartao);border:1px solid var(--linha)}
.botoes{display:grid;gap:.6rem;margin-top:1rem}
.b{display:block;text-align:center;text-decoration:none;font-weight:650;font-size:1.05rem;padding:.95rem 1rem;border-radius:12px;border:2px solid currentColor}
.b.recusou{color:var(--recusou)}.b.fechou{color:var(--fechou)}.b.desfazer{color:var(--neutro);font-weight:550}.b.gerar_demo{color:var(--neutro)}
.b.atual{opacity:.45;pointer-events:none}.b:active{transform:translateY(1px)}`;
const pagina = (titulo, corpo) => '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
  + '<title>' + esc(titulo) + '</title><style>' + CSS + '</style></head><body><main>' + corpo + '</main></body></html>';

if (!l) {
  return [{ json: { codigo: 404, html: pagina('Lead não encontrado', '<h1>Lead não encontrado</h1><p class="nota">Nenhuma linha da planilha tem o id '
    + '<code>' + esc(pid || '(vazio)') + '</code>. Nada foi gravado.</p>') } }];
}
const estado = estadoDe(l), topo = topoDe(pid);
const DESCRICAO = {
  fechado: '<b>Fechou</b>' + em(l.fechado_em),
  recusado: '<b>Recusou</b>' + (txt(l.recusado_em) ? em(l.recusado_em) : ' (anotado à mão, antes deste link)'),
  expirado: '<b>Expirou</b>: __DIAS__ dias sem resposta' + (txt(l.enviado_em) ? ' (enviado' + em(l.enviado_em) + ')' : ''),
  conversa: '<b>Em conversa</b>' + (txt(l.respondeu_em) ? ': respondeu' + em(l.respondeu_em) : ''),
  enviado: '<b>Enviado</b>' + em(l.enviado_em) + ', esperando resposta',
  pronto: txt(l.site_url) ? '<b>Site pronto</b>, ainda não enviado' : '<b>Primeira mensagem pronta</b>, ainda sem demo',
  novo: '<b>Sem site</b> ainda',
  descartado: '<b>Descartado</b>',
};
const AVISO = {
  recusou: 'Marcado: recusou. A pasta foi para _recusados/.',
  fechou: 'Marcado: fechou. A pasta foi para _fechados/.',
  desfazer: 'Desfeito: o lead voltou ao estado de antes.',
  gerar_demo: 'Demo pedido: o gerador começou agora (uns 20 a 40 minutos). O aviso chega quando estiver no ar.',
  igual: 'Já estava assim: nada mudou.',
  invalido: 'Botão desconhecido: nada mudou.',
};
const acao = (a) => LINKS + '/lead-acao?id=' + encodeURIComponent(pid) + '&acao=' + a;
const botao = (a, rotulo, atual) => '<a class="b ' + a + (atual ? ' atual' : '') + '" href="' + acao(a) + '">' + (atual ? '✓ ' : '') + rotulo + '</a>';
const site = txt(l.site_url), raioX = txt(l.raio_x_url);
const corpo = (AVISO[feito] ? '<p class="aviso">' + AVISO[feito] + '</p>' : '')
  + '<h1>' + esc(l.nome || pid) + '</h1>'
  + '<p class="sub">' + [esc(l.cidade), site ? '<a href="' + esc(site) + '">abrir o demo</a>' : '',
    raioX ? '<a href="' + esc(raioX) + '">abrir o raio-x</a>' : ''].filter(Boolean).join(' · ') + '</p>'
  + '<div class="cartao"><p class="estado">' + (DESCRICAO[estado] ?? esc(estado)) + '</p>'
  + '<p class="nota">Pasta: ' + (topo ? (topo === 'raiz' ? 'raiz' : topo + '/') : 'sem site publicado') + '</p>'
  + '<div class="botoes">' + (podeGerarDemo(l) ? botao('gerar_demo', 'Gerar demo', feito === 'gerar_demo') : '')
  + botao('recusou', 'Recusou', estado === 'recusado') + botao('fechou', 'Fechou', estado === 'fechado')
  + (['recusado', 'fechado'].includes(estado) ? botao('desfazer', 'Desfazer', false) : '') + '</div></div>'
  + '<p class="nota">Nada é enviado ao lead: os botões só mudam a planilha e a pasta. Quem está em Perdido há 2 dias '
  + '(recusou, não respondeu em __DIAS__ dias, parou de responder) tem o demo apagado da Vercel; a pasta e o conteúdo '
  + 'ficam no Dell. Desfazer não traz o demo de volta.</p>';
return [{ json: { codigo: 200, html: pagina(txt(l.nome) || 'Lead', corpo) } }];"""
PAGINA_JS = PAGINA_JS.replace("__DIAS__", str(sv.EXPIRA_DIAS))


DECIDIR_JS = """// O toque num botão. Só grava quando muda algo; id ou botão desconhecido não grava nada.
const q = $('Botão da página').first().json.query ?? {};
const pid = txt(q.id), acao = txt(q.acao).toLowerCase();
const l = $input.all().map(i => i.json).find(r => pid && txt(r.place_id) === pid);
const volta = (feito) => linkDoLead(pid) + '&feito=' + feito;
const nada = (feito) => [{ json: { resultado: feito, planilha: false, pasta: false, destino: volta(feito) } }];
if (!l) return nada('desconhecido');
if (!['recusou', 'fechou', 'desfazer', 'gerar_demo'].includes(acao)) return nada('invalido');
const agora = new Date().toISOString();
const s = txt(l.status), estado = estadoDe(l);
const linha = { place_id: pid, status: s, status_anterior: txt(l.status_anterior), recusado_em: txt(l.recusado_em), fechado_em: txt(l.fechado_em) };
let planilha = false, moverPasta = false;
if (acao === 'gerar_demo') {
  // Não muda a planilha: o pacote vai ao site-pastas, que grava o PEDIDO-DEMO.json e acorda o gerador.
  moverPasta = podeGerarDemo(l);
} else if (acao === 'recusou' && estado !== 'recusado') {
  // status_anterior guarda o que o Desfazer devolve.
  Object.assign(linha, { status: 'recusado', status_anterior: s, recusado_em: agora });
  planilha = moverPasta = true;
} else if (acao === 'fechou' && estado !== 'fechado') {
  Object.assign(linha, { status: 'fechado', status_anterior: s, fechado_em: agora });
  planilha = moverPasta = true;
} else if (acao === 'desfazer' && (s === 'recusado' || s === 'fechado')) {
  // Volta ao status de antes do botão; sem ele (marcado à mão na planilha), "enviado", o de quem conversava.
  linha.status = txt(l.status_anterior) || 'enviado';
  linha.status_anterior = '';
  linha[s === 'recusado' ? 'recusado_em' : 'fechado_em'] = '';
  planilha = moverPasta = true;
} else if (acao === 'desfazer' && estado === 'recusado') {
  // Recusa anotada à mão (pasta em _recusados/, planilha sem "recusado"): só a pasta sai de lá.
  moverPasta = true;
}
const resultado = planilha || moverPasta ? acao : 'igual';
// O pedido de demo vai mesmo sem recibo conhecido: o site-pastas procura a pasta pelo content.md.
const pacoteVai = moverPasta && (acao === 'gerar_demo' || Boolean(pasta[pid]));
return [{ json: { resultado, planilha, pasta: pacoteVai, linha, destino: volta(resultado),
  pacote: { place_id: pid, acao, nome: txt(l.nome), em: agora, status: linha.status } } }];"""

PACOTE_JS = """// Pacote para o site-pastas do Dell (o n8n não move diretórios).
const d = $('Decidir a ação').first().json;
const nome = Date.now() + '-' + String(d.pacote.place_id).replace(/[^a-zA-Z0-9_-]+/g, '_') + '.json';
return [{ json: { nome }, binary: { data: { data: Buffer.from(JSON.stringify(d.pacote), 'utf8').toString('base64'),
  mimeType: 'application/json', fileName: nome } } }];"""

RETRATO_JS = """// Retrato da planilha para o Dell: o resumo das 10:30 (link de cada lead) e o
// site-demos-limpeza (datas). Sem "itens": o dell-status e a Central não o leem como pendência.
const linhas = $input.all().map(i => i.json).filter(l => txt(l.place_id) && !/^TESTE/.test(txt(l.place_id)));
const grupoDe = (l, e) => e === 'conversa' ? 'conversa'
  : (e === 'enviado' && topoDe(txt(l.place_id)) === 'raiz' && !txt(l.respondeu_em) ? 'resposta' : '');
// 07/10/2026: o que o lead recebeu e o que respondeu, para o funil comparar (mensagem_variante e
// site_versao vêm do Balcão; resposta_tipo, do classificador do WhatsApp, e "exclusao" é o que o
// site-demos-limpeza --exclusao confere antes de apagar um demo a pedido).
const leads = linhas.filter(l => pasta[txt(l.place_id)] || txt(l.site_url)).map(l => {
  const pid = txt(l.place_id), estado = estadoDe(l);
  return { place_id: pid, nome: txt(l.nome), cidade: txt(l.cidade), status: txt(l.status), estado, grupo: grupoDe(l, estado),
    pasta: pasta[pid] ?? '', enviado_em: txt(l.enviado_em), respondeu_em: txt(l.respondeu_em), recusado_em: txt(l.recusado_em),
    fechado_em: txt(l.fechado_em), site_url: txt(l.site_url), vercel_project: txt(l.vercel_project), link: linkDoLead(pid),
    resposta_tipo: txt(l.resposta_tipo), mensagem_variante: txt(l.mensagem_variante), site_versao: txt(l.site_versao) };
});
const retrato = { geradoEm: new Date().toISOString(), leads };
return [{ json: { leads: leads.length }, binary: { data: { data: Buffer.from(JSON.stringify(retrato), 'utf8').toString('base64'),
  mimeType: 'application/json', fileName: 'site-leads.json' } } }];"""

LINKS_JS = """// Coluna acoes_link: o link da página de cada lead com site. Só as que faltam (ou mudaram).
return $input.all().map(i => i.json)
  .filter(l => txt(l.place_id) && !/^TESTE/.test(txt(l.place_id)) && (pasta[txt(l.place_id)] || txt(l.site_url)))
  .filter(l => txt(l.acoes_link) !== linkDoLead(txt(l.place_id)))
  .map(l => ({ json: { place_id: txt(l.place_id), acoes_link: linkDoLead(txt(l.place_id)) } }));"""


# ------------------------------------------------------------------ nós

def doc():
    return {"documentId": {"__rl": True, "mode": "id", "value": PLANILHA, "cachedResultName": "Leads — Site antes da venda"},
            "sheetName": {"__rl": True, "mode": "id", "value": LEADS_GID, "cachedResultName": "Leads"}}


def recibos(prefixo, x, y):
    ler, extrair = f"{prefixo}: recibos da pasta auto", f"{prefixo}: JSON dos recibos"
    return ler, extrair, [
        {"id": f"{prefixo}-ler".lower(), "name": ler, "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [x, y], "alwaysOutputData": True,
         "parameters": {"operation": "read", "fileSelector": "/home/node/.n8n-files/auto/**/publicado.json", "options": {}}},
        {"id": f"{prefixo}-json".lower(), "name": extrair, "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1.1,
         "position": [x + 220, y], "alwaysOutputData": True,
         "parameters": {"operation": "fromJson", "destinationKey": "recibo"}},
    ]


def ler_linhas(no_id, nome, x, y, gatilho=None):
    """Lê a aba Leads; com `gatilho`, só a linha do place_id da query (?id=)."""
    p = {"resource": "sheet", "operation": "read", **doc(), "options": {}}
    if gatilho:
        p["filtersUI"] = {"values": [{"lookupColumn": "place_id",
                                      "lookupValue": "={{ $('" + gatilho + "').first().json.query?.id || '-' }}"}]}
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [x, y],
            "credentials": SHEETS, "alwaysOutputData": True, "executeOnce": True, "retryOnFail": True, "maxTries": 3,
            "waitBetweenTries": 3000, "parameters": p}


def atualizar(no_id, nome, colunas, x, y, origem="$json"):
    valor = {c: "={{ " + origem + "." + c + " }}" for c in colunas}
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.7, "position": [x, y],
            "credentials": SHEETS, "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 3000,
            "parameters": {"resource": "sheet", "operation": "update", **doc(),
                           "columns": {"mappingMode": "defineBelow", "matchingColumns": ["place_id"], "value": valor,
                                       "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": c == "place_id",
                                                   "display": True, "type": "string", "canBeUsedToMatch": c == "place_id"}
                                                  for c in colunas]},
                           "options": {"cellFormat": "RAW"}}}


def code(no_id, nome, js, x, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, y],
            "parameters": {"mode": "runOnceForAllItems", "jsCode": js}}


def se(no_id, nome, expr, x, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [x, y],
            "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                                          "combinator": "and",
                                          "conditions": [{"id": no_id, "leftValue": expr, "rightValue": "",
                                                          "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]},
                           "options": {}}}


def webhook(no_id, nome, caminho, webhook_id, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, y],
            "webhookId": webhook_id, "parameters": {"httpMethod": "GET", "path": caminho, "responseMode": "responseNode", "options": {}}}


def gravar(no_id, nome, arquivo_expr, x, y):
    return {"id": no_id, "name": nome, "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1, "position": [x, y],
            "parameters": {"operation": "write", "dataPropertyName": "data", "fileName": arquivo_expr}}


def liga(con, a, b, saida=0):
    lista = con.setdefault(a, {"main": []})["main"]
    while len(lista) <= saida:
        lista.append([])
    lista[saida].append({"node": b, "type": "main", "index": 0})


def fluxo(erro):
    nos, con = [], {}
    # --- página
    ler_p, json_p, rec_p = recibos("Página", 220, 0)
    nos += [webhook("pagina", "Abrir a página do lead", "lead", "5b1c2d3e-4f50-4a61-8b72-c3d4e5f60007", 0), *rec_p,
            ler_linhas("pagina-linha", "Página: ler a linha", 660, 0, "Abrir a página do lead"),
            code("pagina-montar", "Montar a página", ESTADO_JS + "\n" + pasta_js(ler_p, json_p) + "\n" + PAGINA_JS, 880, 0),
            {"id": "pagina-mostrar", "name": "Mostrar a página", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1,
             "position": [1100, 0], "parameters": {"respondWith": "text", "responseBody": "={{ $json.html }}", "options": {
                 "responseCode": "={{ $json.codigo }}",
                 "responseHeaders": {"entries": [{"name": "Content-Type", "value": "text/html; charset=utf-8"},
                                                 {"name": "Cache-Control", "value": "no-store"}]}}}}]
    for a, b in zip(["Abrir a página do lead", ler_p, json_p, "Página: ler a linha", "Montar a página"],
                    [ler_p, json_p, "Página: ler a linha", "Montar a página", "Mostrar a página"]):
        liga(con, a, b)

    # --- botão
    y = 320
    ler_a, json_a, rec_a = recibos("Botão", 220, y)
    nos += [webhook("botao", "Botão da página", "lead-acao", "5b1c2d3e-4f50-4a61-8b72-c3d4e5f60008", y), *rec_a,
            ler_linhas("botao-linha", "Botão: ler a linha", 660, y, "Botão da página"),
            code("botao-decidir", "Decidir a ação", ESTADO_JS + "\n" + pasta_js(ler_a, json_a) + "\n" + DECIDIR_JS, 880, y),
            se("botao-planilha", "Grava na planilha?", "={{ $json.planilha }}", 1100, y),
            atualizar("botao-gravar", "Gravar na planilha", ["place_id", *COLUNAS_NOVAS[:3], "status"], 1320, y - 100, "$json.linha"),
            se("botao-pasta", "Muda a pasta?", "={{ $('Decidir a ação').first().json.pasta }}", 1540, y),
            code("botao-pacote", "Pacote da pasta", PACOTE_JS, 1760, y - 100),
            gravar("botao-pedir", "Pedir a mudança de pasta", "={{ '" + ESTADO + "site-acoes/' + $json.nome }}", 1980, y - 100),
            # O site-pastas move em ~1 s; a página que vem depois já mostra a pasta nova.
            {"id": "botao-esperar", "name": "Esperar a pasta", "type": "n8n-nodes-base.wait", "typeVersion": 1.1,
             "position": [2200, y - 100], "webhookId": "5b1c2d3e-4f50-4a61-8b72-c3d4e5f60009",
             "parameters": {"resume": "timeInterval", "amount": 2, "unit": "seconds"}},
            {"id": "botao-voltar", "name": "Voltar para a página", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1,
             "position": [2420, y], "parameters": {"respondWith": "redirect",
                                                   "redirectURL": "={{ $('Decidir a ação').first().json.destino }}", "options": {}}}]
    for a, b in zip(["Botão da página", ler_a, json_a, "Botão: ler a linha", "Decidir a ação"],
                    [ler_a, json_a, "Botão: ler a linha", "Decidir a ação", "Grava na planilha?"]):
        liga(con, a, b)
    liga(con, "Grava na planilha?", "Gravar na planilha", 0)
    liga(con, "Grava na planilha?", "Muda a pasta?", 1)
    liga(con, "Gravar na planilha", "Muda a pasta?")
    liga(con, "Muda a pasta?", "Pacote da pasta", 0)
    liga(con, "Muda a pasta?", "Voltar para a página", 1)
    liga(con, "Pacote da pasta", "Pedir a mudança de pasta")
    liga(con, "Pedir a mudança de pasta", "Esperar a pasta")
    liga(con, "Esperar a pasta", "Voltar para a página")

    # --- retrato de hora em hora
    y = 700
    ler_r, json_r, rec_r = recibos("Retrato", 220, y)
    nos += [{"id": "retrato-hora", "name": "A cada hora (:20)", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2,
             "position": [0, y], "parameters": {"rule": {"interval": [{"field": "hours", "hoursInterval": 1, "triggerAtMinute": 20}]}}},
            *rec_r,
            ler_linhas("retrato-planilha", "Retrato: ler a planilha", 660, y),
            code("retrato-montar", "Retrato", ESTADO_JS + "\n" + pasta_js(ler_r, json_r) + "\n" + RETRATO_JS, 880, y - 100),
            gravar("retrato-gravar", "Gravar retrato", ESTADO + "site-leads.json", 1100, y - 100),
            code("retrato-links", "Links que faltam", ESTADO_JS + "\n" + pasta_js(ler_r, json_r) + "\n" + LINKS_JS, 880, y + 100),
            atualizar("retrato-coluna", "Gravar acoes_link", ["place_id", "acoes_link"], 1100, y + 100)]
    for a, b in zip(["A cada hora (:20)", ler_r, json_r], [ler_r, json_r, "Retrato: ler a planilha"]):
        liga(con, a, b)
    liga(con, "Retrato: ler a planilha", "Retrato")
    liga(con, "Retrato: ler a planilha", "Links que faltam")
    liga(con, "Retrato", "Gravar retrato")
    liga(con, "Links que faltam", "Gravar acoes_link")
    return {"name": NOME, "nodes": nos, "connections": con,
            "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo", "errorWorkflow": erro}}


# ------------------------------------------------------------------ planilha, publicar, verificar

def colunas():
    """Acrescenta no fim do cabeçalho da aba Leads as colunas que faltam (todo fluxo escreve pelo nome)."""
    sv.acrescentar_colunas(PLANILHA, LEADS_GID, "Leads", COLUNAS_NOVAS)


def testar_retrato() -> bool:
    """Código do retrato no node (sem n8n nem planilha): campos novos de 07/10/2026 e a cópia _v1
    do modo personalizado, que não é a pasta do lead."""
    recibos = sv.nos_de_arquivos("Retrato: recibos da pasta auto", "Retrato: JSON dos recibos", "recibo", [
        ("padaria", {"place_id": "pid-1"}), ("padaria/_v1", {"place_id": "pid-1"}), ("_recusados/escola", {"place_id": "pid-2"})])
    planilha = [{"json": {"place_id": "pid-1", "nome": "Padaria", "status": "enviado", "enviado_em": "2026-10-07T12:00:00Z",
                          "mensagem_variante": "manual", "site_versao": "personalizado-v2", "resposta_tipo": ""}},
                {"json": {"place_id": "pid-2", "nome": "Escola", "status": "recusado", "recusado_em": "2026-10-07T13:00:00Z",
                          "mensagem_variante": "A", "site_versao": "padrão", "resposta_tipo": "exclusao",
                          "vercel_project": "demo-escola"}},
                {"json": {"place_id": "TESTE-x", "site_url": "https://x"}}]
    codigo = ESTADO_JS + "\n" + pasta_js("Retrato: recibos da pasta auto", "Retrato: JSON dos recibos") + "\n" + RETRATO_JS
    item = sv.rodar_js(codigo, recibos, planilha)[0]
    leads = {l["place_id"]: l for l in json.loads(__import__("base64").b64decode(item["binary"]["data"]["data"]))["leads"]}
    esperado = {
        "pid-1": {"pasta": "padaria", "grupo": "resposta", "mensagem_variante": "manual", "site_versao": "personalizado-v2", "resposta_tipo": ""},
        "pid-2": {"pasta": "_recusados/escola", "estado": "recusado", "resposta_tipo": "exclusao", "mensagem_variante": "A",
                  "site_versao": "padrão", "vercel_project": "demo-escola"},
    }
    ok = sorted(leads) == ["pid-1", "pid-2"]
    for pid, campos in esperado.items():
        obtido = {k: leads.get(pid, {}).get(k) for k in campos}
        certo = obtido == campos
        ok &= certo
        print(f"{'ok ' if certo else 'ERRO'} retrato {pid}: {obtido}")
    return ok


def publicar(wf):
    existentes = [w for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == wf["name"]]
    if existentes:
        BACKUPS.mkdir(parents=True, exist_ok=True)
        atual = api("GET", f"/workflows/{existentes[0]['id']}")
        (BACKUPS / f"{existentes[0]['id']}-{int(time.time())}.json").write_text(json.dumps(atual, ensure_ascii=False, indent=1))
    wid = sv.criar_ou_trocar(wf)
    api("POST", f"/workflows/{wid}/activate")
    print(wf["name"], "->", wid, f"({len(wf['nodes'])} nós, ativo)", f"{LINKS}/lead?id=<place_id>")
    return wid


def retrato_agora(erro):
    """Cópia só com o ramo do retrato, disparada por webhook (o rodar-agora.py copiaria os webhooks do 07)."""
    wf = fluxo(erro)
    fica = {n["name"] for n in wf["nodes"] if n["name"].startswith(("Retrato", "Links que", "Gravar retrato", "Gravar acoes_link"))}
    nos = [copy.deepcopy(n) for n in wf["nodes"] if n["name"] in fica]
    caminho = "zz-retrato-agora"
    nos.append({"id": "agora", "name": "Agora", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 900],
                "webhookId": "00000000-0000-4000-8000-000000007007",
                "parameters": {"httpMethod": "POST", "path": caminho, "responseMode": "onReceived"}})
    con = {k: v for k, v in wf["connections"].items() if k in fica}
    con["Agora"] = {"main": [[{"node": "Retrato: recibos da pasta auto", "type": "main", "index": 0}]]}
    t = api("POST", "/workflows", {"name": "ZZ retrato agora (apagar)", "nodes": nos, "connections": con,
                                   "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo"}})
    try:
        api("POST", f"/workflows/{t['id']}/activate")
        time.sleep(2)
        urllib.request.urlopen(urllib.request.Request(f"{LOCAL}/{caminho}", data=b"{}", method="POST",
                                                      headers={"Content-Type": "application/json"}), timeout=30).read()
        for _ in range(60):
            ex = api("GET", f"/executions?workflowId={t['id']}&limit=1")["data"]
            if ex and ex[0]["status"] not in ("running", "new", "waiting"):
                break
            time.sleep(3)
        e = api("GET", f"/executions/{ex[0]['id']}?includeData=true")
        print("retrato:", e["status"])
        for nome, runs in e["data"]["resultData"]["runData"].items():
            erro_no = next(((r.get("error") or {}).get("message") for r in runs if r.get("error")), "")
            print(f"  {nome}: itens={len(((runs[-1].get('data') or {}).get('main') or [[]])[0] or [])} {erro_no}")
        return e["status"] == "success"
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")


class SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def pedir(url, seguir=True):
    abrir = urllib.request.urlopen if seguir else urllib.request.build_opener(SemRedirecionar).open
    try:
        with abrir(url, timeout=60) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode(errors="replace")


def testar(erro):
    """Cópia com planilha de mentira (linhas de leads reais da pasta) e sem gravar nada: página e botões."""
    auto = Path.home() / "auto-site"
    rec = lambda p: json.loads((auto / p / "publicado.json").read_text(encoding="utf-8"))
    # Desde o demo sob pedido (14/10/2026) a raiz tem recibo só de Raio-X, sem site_url: os cenários
    # abaixo contam com o demo no ar, então o lead de exemplo é o primeiro que tem um.
    raiz = next(p.parent.name for p in sorted(auto.glob("*/publicado.json"))
                if str(rec(p.parent.name).get("site_url") or "").startswith("https://"))
    recusado = next(p.parent.name for p in sorted(auto.glob("_recusados/*/publicado.json")))
    r1, r2 = rec(raiz), rec(f"_recusados/{recusado}")
    linha = lambda r, **k: {"place_id": r["place_id"], "nome": r["nome"] + " [teste]", "cidade": "Cidade", "site_url": r["site_url"],
                            "status": "enviado", "enviado_em": "2026-09-29T15:00:00Z", "respondeu_em": "", "status_anterior": "",
                            "recusado_em": "", "fechado_em": "", **k}
    cenarios = [  # (linha, ação, esperado: resultado, planilha, pasta, status novo)
        (linha(r1), "recusou", ("recusou", True, True, "recusado")),
        (linha(r1, status="recusado", status_anterior="enviado", recusado_em="2026-09-30T12:00:00Z"), "recusou", ("igual", False, False, "recusado")),
        (linha(r1, status="recusado", status_anterior="enviado", recusado_em="2026-09-30T12:00:00Z"), "desfazer", ("desfazer", True, True, "enviado")),
        (linha(r1, status="recusado", status_anterior="fechado", recusado_em="2026-09-30T12:00:00Z"), "desfazer", ("desfazer", True, True, "fechado")),
        (linha(r1), "fechou", ("fechou", True, True, "fechado")),
        (linha(r1), "desfazer", ("igual", False, False, "enviado")),
        (linha(r1), "apagar", ("invalido", False, False, None)),
        (linha(r2, status="pronto"), "recusou", ("igual", False, False, "pronto")),
        (linha(r2, status="pronto"), "desfazer", ("desfazer", False, True, "pronto")),
        (linha(r2, status="pronto"), "fechou", ("fechou", True, True, "fechado")),
        # Demo sob pedido (14/10/2026): sem site_url, o toque vira pacote; com demo ou recusado, nada.
        (linha(r1, site_url=""), "gerar_demo", ("gerar_demo", False, True, "enviado")),
        (linha(r1), "gerar_demo", ("igual", False, False, "enviado")),
        (linha(r2, site_url="", status="recusado"), "gerar_demo", ("igual", False, False, "recusado")),
        # 15/10/2026: lead sem recibo (recebeu a A sem demo): o pacote vai, e o site-pastas acha a pasta pelo content.md.
        ({**linha(r1, site_url="", status="pronto"), "place_id": "zz-sem-recibo"}, "gerar_demo", ("gerar_demo", False, True, "pronto")),
        ({"place_id": "outro"}, "recusou", ("desconhecido", False, False, None)),
    ]
    wf = fluxo(erro)
    fica = [n for n in wf["nodes"] if not n["name"].startswith(("Retrato", "Links que", "Gravar retrato", "Gravar acoes_link", "A cada hora"))]
    troca = {"Gravar na planilha": "noOp", "Pedir a mudança de pasta": "noOp"}
    nos = []
    for n in copy.deepcopy(fica):
        if n["name"] in troca:
            n = {"id": n["id"], "name": n["name"], "type": "n8n-nodes-base.noOp", "typeVersion": 1, "position": n["position"], "parameters": {}}
        elif n["name"] in ("Página: ler a linha", "Botão: ler a linha"):
            gatilho = "Abrir a página do lead" if n["name"].startswith("Página") else "Botão da página"
            # A linha vem da query (?linha=<n>) para cada cenário usar a sua.
            n = {"id": n["id"], "name": n["name"], "type": "n8n-nodes-base.code", "typeVersion": 2, "position": n["position"],
                 "parameters": {"mode": "runOnceForAllItems", "jsCode": "const todas = " + json.dumps([c[0] for c in cenarios], ensure_ascii=False)
                                + ";\nconst q = $('" + gatilho + "').first().json.query ?? {};\n"
                                + "const l = todas[Number(q.linha)];\nreturn l && l.place_id === q.id ? [{ json: l }] : [{ json: {} }];"}}
        elif n["type"] == "n8n-nodes-base.webhook":
            n["parameters"]["path"] = "zz-teste-" + n["parameters"]["path"]
            n["webhookId"] = n["webhookId"][:-4] + "7e57"
        elif n["type"] == "n8n-nodes-base.wait":
            n["webhookId"] = n["webhookId"][:-4] + "7e58"
        nos.append(n)
    nomes = {n["name"] for n in nos}
    con = {a: v for a, v in wf["connections"].items() if a in nomes}
    t = api("POST", "/workflows", {"name": "ZZ testar 07 (apagar)", "nodes": nos, "connections": con,
                                   "settings": {"executionOrder": "v1", "timezone": "America/Sao_Paulo"}})
    ok = True
    try:
        api("POST", f"/workflows/{t['id']}/activate")
        time.sleep(2)
        for i, (l, acao, (resultado, planilha, pasta, status)) in enumerate(cenarios):
            antes = {x["id"] for x in api("GET", f"/executions?workflowId={t['id']}&limit=50")["data"]}
            pid = l["place_id"] if i != len(cenarios) - 1 else "nao-existe"
            c, h, _ = pedir(f"{LOCAL}/zz-teste-lead-acao?id={quote(pid)}&acao={acao}&linha={i}", seguir=False)
            time.sleep(1)
            ex = [x for x in api("GET", f"/executions?workflowId={t['id']}&limit=50")["data"] if x["id"] not in antes][0]
            rd = api("GET", f"/executions/{ex['id']}?includeData=true")["data"]["resultData"]["runData"]
            d = rd["Decidir a ação"][0]["data"]["main"][0][0]["json"]
            obtido = (d["resultado"], d["planilha"], d["pasta"], (d.get("linha") or {}).get("status"))
            rodou = [n for n in ("Gravar na planilha", "Pedir a mudança de pasta") if n in rd]
            certo = obtido == (resultado, planilha, pasta, status) and rodou == [n for n, v in
                    (("Gravar na planilha", planilha), ("Pedir a mudança de pasta", pasta)) if v]
            ok &= certo and c in (302, 303, 307) and (h.get("Location") or h.get("location", "")).endswith("feito=" + resultado)
            print(f"{'ok ' if certo else 'ERRO'} {acao:9} status={l.get('status', '-'):9} -> {obtido} nós={rodou} {c}")
        for i, marca in ((0, "Enviado"), (7, "anotado à mão"), (len(cenarios) - 1, "não encontrado")):
            pid = cenarios[i][0]["place_id"] if i != len(cenarios) - 1 else "nao-existe"
            c, h, corpo = pedir(f"{LOCAL}/zz-teste-lead?id={quote(pid)}&linha={i}&feito=igual")
            certo = marca in corpo and "text/html" in (h.get("Content-Type") or h.get("content-type", ""))
            ok &= certo
            print(f"{'ok ' if certo else 'ERRO'} página linha {i}: {c} contém '{marca}'")
        if "--mostrar" in sys.argv:
            print(pedir(f"{LOCAL}/zz-teste-lead?id={quote(cenarios[2][0]['place_id'])}&linha=2&feito=recusou")[2])
    finally:
        api("POST", f"/workflows/{t['id']}/deactivate")
        api("DELETE", f"/workflows/{t['id']}")
    print("tudo certo" if ok else "HÁ ERROS")
    return ok


def execucoes_desde(wid, inicio):
    return [x for x in api("GET", f"/executions?workflowId={wid}&limit=10")["data"] if x["startedAt"] >= inicio]


def verificar(pid_recusado):
    """Nada grava: id inexistente e "recusou" num lead já em _recusados/ (acervo)."""
    wid = next(w["id"] for w in api("GET", "/workflows?limit=200")["data"] if w["name"] == NOME)
    acoes = Path.home() / ".local/share/n8n-estado/site-acoes"
    antes = sorted(p.name for p in acoes.glob("*.json")) if acoes.is_dir() else []
    inicio = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 2))
    falso = "TESTE-nao-existe-" + str(int(time.time()))
    c, _, corpo = pedir(f"{LOCAL}/lead?id={falso}")
    print("página, id inexistente:", c, "não encontrado" in corpo.lower())
    c, h, _ = pedir(f"{LOCAL}/lead-acao?id={falso}&acao=recusou", seguir=False)
    print("botão, id inexistente:", c, h.get("Location") or h.get("location"))
    if pid_recusado:
        c, _, corpo = pedir(f"{LOCAL}/lead?id={quote(pid_recusado)}")
        print("página, lead em _recusados/:", c, "Recusou" in corpo, "anotado à mão" in corpo)
        c, h, _ = pedir(f"{LOCAL}/lead-acao?id={quote(pid_recusado)}&acao=recusou", seguir=False)
        print("botão Recusou de novo:", c, h.get("Location") or h.get("location"))
        c, _, corpo = pedir(f"{LOCAL}/lead?id={quote(pid_recusado)}&feito=igual")
        print("página depois:", c, "nada mudou" in corpo)
    time.sleep(2)
    for x in execucoes_desde(wid, inicio):
        e = api("GET", f"/executions/{x['id']}?includeData=true")
        rodaram = list(e["data"]["resultData"]["runData"])
        gravou = [n for n in rodaram if n in ("Gravar na planilha", "Pedir a mudança de pasta")]
        print(f"  execução {x['id']}: {e['status']}; gravou: {gravou or 'nada'}")
    depois = sorted(p.name for p in acoes.glob("*.json")) if acoes.is_dir() else []
    print("pacotes novos em site-acoes/:", [n for n in depois if n not in antes] or "nenhum")


if __name__ == "__main__":
    if "--colunas" in sys.argv:
        colunas()
    elif "--retrato-agora" in sys.argv:
        sys.exit(0 if retrato_agora(sv.erro_wf()) else 1)
    elif "--testar-retrato" in sys.argv:
        sys.exit(0 if testar_retrato() else 1)
    elif "--testar" in sys.argv:
        sys.exit(0 if testar_retrato() & testar(sv.erro_wf()) else 1)
    elif "--verificar" in sys.argv:
        resto = [a for a in sys.argv[1:] if not a.startswith("--")]
        verificar(resto[0] if resto else "")
    else:
        colunas()
        publicar(fluxo(sv.erro_wf()))
