"""CRM da Central (Site antes da venda + PRUMO), 30/09/2026. Idempotente: recria pelo nome.

14/10/2026, PRUMO como holding: o retrato também lê as abas Clínicas (Iris) e
Estamparias (CRM de estamparia) da planilha do PRUMO, criadas por
prumo-ofertas.py. Aba que falta ou não lê não segura o retrato (só Leads e
Prospects seguram): a Central mostra a fonte com o erro. O nome do fluxo fica o
mesmo de propósito: publicar() troca pelo nome, e um nome novo deixaria o antigo
ligado ao lado.

28/10/2026: as ofertas saem de prumo-ofertas.json (ofertas.py). A leitura "Ler <aba>",
a contagem, `links.<link_retrato>`, `fontes.<id>` e a lista de produtos do registro
(VALIDAR_JS) derivam do registro; antes, oferta fora da lista escrita aqui tinha
todo registro recusado como "Produto inválido". Oferta sem tabela de preço própria
(OFERTAS_COM_TABELA) tem valor e pagamento recusados, como a estampa.

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
  texto, data, origem} com tipo spiced (qualificação confirmada pelo operador, JSON até 1000) | nota | proximo_passo | proposta |
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

import ofertas as registro
from n8n import api

AQUI = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("site_antes_da_venda", AQUI / "site-antes-da-venda.py")
sv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sv)

NOME = "08 · CRM: retrato e registros (Site antes da venda + PRUMO)"
SITE, SHEETS = sv.PLANILHA, sv.SHEETS
LEADS_GID = "396728619"
PRUMO, PROSPECTS_GID = "1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U", "1838781376"
# Ofertas do PRUMO (prumo-ofertas.json via ofertas.py): lidas pelo nome da aba, o gid só serve ao link.
# Falta ou erro no JSON derruba o gerador aqui: publicar o 08 sem as ofertas as tiraria do funil caladas.
REGISTRO = registro.carregar()
OFERTAS = registro.ids(REGISTRO)
ABAS_DAS_OFERTAS = registro.abas(REGISTRO)
# Ofertas com preço na tabela do VALIDAR_JS (o Iris por faixa de clínicas). As outras não têm preço
# aprovado: valor_proposta e pagamento_confirmado são recusados ("A condição não pertence à oferta"),
# como a estampa desde o começo. Oferta nova entra assim até o Rômulo aprovar um preço.
OFERTAS_COM_TABELA = ("iris",)
PLANILHA_DO_PRUMO = "PRUMO — Fila de revisão"
ABA_CRM = "CRM"
COLUNAS_CRM = ["em", "produto", "id", "empresa", "tipo", "texto", "data", "origem"]
LINKS = "https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook"
LOCAL = "http://127.0.0.1:5679/webhook"
ESTADO = "/home/node/.n8n-files/estado/"
SEGREDO = Path.home() / ".config/claude-ops/crm-segredo"
CREDENCIAL = "CRM Central"
BACKUPS = Path.home() / ".local/share/claude-ops/backups" / date.today().isoformat()

def montar_js(gids=None, config=None):
    """O código do "Montar retrato"; `gids` ({"iris": "123"...}) só completa os links das abas das ofertas.

    Um trecho por oferta do registro, na ordem do JSON: `const <id> = ler('Ler <aba>', 'ID')`, a contagem no
    arquivo, `links.<link_retrato>` e `fontes.<id>`. Para Iris e estampa o texto sai igual ao escrito à mão até
    28/10/2026 (conferido byte a byte antes da troca)."""
    gids = gids or {}
    config = REGISTRO if config is None else config
    ids = registro.ids(config)
    link = lambda oferta: f"https://docs.google.com/spreadsheets/d/{PRUMO}/edit" + (f"#gid={gids[oferta]}" if gids.get(oferta) else "")
    aba = lambda k: registro.js_texto(registro.campo(k, "aba", config))
    trechos = {
        "OFERTAS_LER": "\n".join(f"const {k} = ler({registro.js_texto('Ler ' + registro.campo(k, 'aba', config))}, 'ID');" for k in ids),
        "OFERTAS_CONTAGEM": ",\n  ".join(f"{k}: {k}.linhas.length" for k in ids) + ",",
        "OFERTAS_LINKS": ", ".join(f"{registro.campo(k, 'link_retrato', config)}: {registro.js_texto(link(k))}" for k in ids) + ",",
        "OFERTAS_FONTES": "\n".join(f"    {k}: {{ planilha: {registro.js_texto(PLANILHA_DO_PRUMO)}, aba: {aba(k)}, ...{k} }}," for k in ids),
    }
    js = MONTAR_JS
    for chave, trecho in trechos.items():
        js = js.replace(f"__{chave}__", trecho)
    return js


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
    .map(l => ({ ...Object.fromEntries(colunas.map(k => [k, ['spiced','cadencia_enviada','valor_proposta','pagamento_confirmado','receita_desfeita','origem','motivo_perda','retencao_3m','indicacao_pedida','indicacao_recebida'].includes(l.tipo) && norm(k) === 'texto' && String(l[k] ?? '').length > 1000
      ? '' : txt(l[k]).slice(0, norm(k).startsWith('wa_') ? 4000 : norm(k) === 'texto' ? 1000 : 500)])),
      ...(extra ? extra(l) : {}) }));
  return { colunas: extra ? [...colunas, ...Object.keys(extra({}))] : colunas, linhas };
};
const site = ler('Ler Leads', 'place_id');
const prumo = ler('Ler Prospects', 'ID', (l) => ({ porte: porteDoBriefing(l) }));
// Iris e estamparias (14/10/2026): aba que falha vira fonte com erro, sem segurar o retrato.
__OFERTAS_LER__
const registros = ler('Ler aba CRM', 'id');
const agora = new Date().toISOString();
const arquivo = (nome, dados) => [{ json: { arquivo: nome, site: site.linhas.length, prumo: prumo.linhas.length, __OFERTAS_CONTAGEM__ registros: registros.linhas.length,
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
    __OFERTAS_LINKS__
    planilhaCrm: 'https://docs.google.com/spreadsheets/d/%(SITE)s/edit' },
  fontes: {
    site: { planilha: 'Leads — Site antes da venda', aba: 'Leads', ...site },
    prumo: { planilha: 'PRUMO — Fila de revisão', aba: 'Prospects', ...prumo },
__OFERTAS_FONTES__
    registros: { planilha: 'Leads — Site antes da venda', aba: '%(ABA_CRM)s', ...registros },
  },
});""" % {"LINKS": LINKS, "SITE": SITE, "LEADS_GID": LEADS_GID, "PRUMO": PRUMO, "PROSPECTS_GID": PROSPECTS_GID, "ABA_CRM": ABA_CRM}

# __PRODUTOS__ e __SEM_PRECO__ vêm do registro (validar_js): a lista de produtos aceitos e a recusa de
# preço para oferta sem tabela. Os testes (crm.test.py, crm-nota-estruturada.test.py) usam VALIDAR_JS já montado.
VALIDAR_JS_MODELO = """// Registro da Central. O servidor dela já validou; aqui confere de novo antes da planilha.
const b = $('Registro da Central').first().json.body ?? {};
const txt = (v, n) => String(v ?? '').replace(/[\\u0000-\\u0008\\u000b-\\u001f\\u007f]/g, ' ').trim().slice(0, n);
const TIPOS = ['nota', 'proximo_passo', 'proposta', 'proposta_desfeita', 'sem_contato', 'sem_contato_desfeito',
  'valor_proposta','pagamento_confirmado','receita_desfeita','origem','motivo_perda','retencao_3m','indicacao_pedida','indicacao_recebida',
  'spiced', 'cadencia_enviada',
  'segunda_enviada', 'followup_enviado', 'plus_enviado', 'plus_respondeu', 'recusou', 'recusou_desfeito',
  'ganhou', 'ganhou_desfeito', 'dispensado', 'dispensado_desfeito'];
const recusa = (erro) => [{ json: { ok: false, erro } }];
if (!__PRODUTOS__.includes(b.produto)) return recusa('Produto inválido.');
const id = txt(b.id, 200);
if (!/^[A-Za-z0-9_-]{3,200}$/.test(id)) return recusa('Lead inválido.');
if (!TIPOS.includes(b.tipo)) return recusa('Tipo de registro inválido.');
// Notas estruturadas precisam chegar inteiras: nunca cortar um JSON até parecer outro fato.
if (b.tipo === 'nota' && (typeof b.texto !== 'string' || b.texto.length > 1000)) return recusa('Nota deve ser texto de até 1000 caracteres; nada foi cortado ou gravado.');
let texto = txt(b.texto, 1000);
let data = txt(b.data, 10);
const AARR = ['valor_proposta','pagamento_confirmado','receita_desfeita','origem','motivo_perda','retencao_3m','indicacao_pedida','indicacao_recebida'];
if (AARR.includes(b.tipo)) {
  let v;
  try { v = JSON.parse(b.texto); } catch { return recusa('Registro comercial inválido.'); }
  const keys = ks => Object.keys(v).every(k => ks.includes(k));
  const real = d => typeof d === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(d) && Number.isFinite(Date.parse(d+'T12:00:00Z')) && new Date(d+'T12:00:00Z').toISOString().slice(0,10) === d;
  const hoje = new Date(Date.now()-10800000).toISOString().slice(0,10);
  if (typeof b.texto !== 'string' || b.texto.length > 1000 || !v || Array.isArray(v) || v.versao !== 1) return recusa('Registro comercial inválido.');
  if (['origem','motivo_perda'].includes(b.tipo)) {
    // motivo_perda: a lista fechada de 28/10/2026 (src/operations/motivos-de-perda.ts). A Central já grava
    // traduzido; "sem-dor" e "concorrente" antigos continuam na aba e são lidos lá, nunca regravados aqui.
    const valores = b.tipo === 'origem' ? ['cacador','plus','indicacao','CDL','anuncio'] : ['preco','timing','decisor','ja_tem','sem_dor','sumiu','contato_errado'];
    if (!keys(['versao','valor']) || !valores.includes(v.valor)) return recusa('Categoria comercial inválida.');
    v = {versao:1,valor:v.valor}; data = '';
  } else {
    const max = ['receita_desfeita','indicacao_pedida'].includes(b.tipo) ? 400 : 200;
    if (typeof v.referencia !== 'string' || !v.referencia.trim() || v.referencia.length > max || /[\\u0000-\\u001f\\u007f]/.test(v.referencia) || !real(v.data) || v.data > hoje) return recusa('Confira referência e data real até hoje.');
    if (['valor_proposta','pagamento_confirmado'].includes(b.tipo)) {
      if (!keys(['versao','oferta','componente','quantidade','valor_centavos','referencia','data'])) return recusa('Condição comercial inválida.');
      const tabela = {'encontrado:implantacao':69000,'encontrado:mensalidade':3900,'respondido:implantacao':240000,'respondido:mensalidade':29000,
        'anuncios:mensalidade':59000,'anuncios-duas:mensalidade':98000,'redes:mensalidade':79000,'fonte:implantacao':150000,'fonte:parcela-1':75000,'fonte:parcela-2':75000,'fonte-em-dia:mensalidade':19000};
      let valor = tabela[v.oferta+':'+v.componente];
      if (v.oferta === 'iris' && v.componente === 'mensalidade' && Number.isSafeInteger(v.quantidade) && v.quantidade > 0) valor = Math.min(v.quantidade,15)*3900+Math.max(0,Math.min(v.quantidade,40)-15)*3200+Math.max(0,v.quantidade-40)*2500;
      if (!Number.isSafeInteger(valor) || valor <= 0 || (v.valor_centavos !== undefined && v.valor_centavos !== valor) || (v.oferta !== 'iris' && v.quantidade !== undefined)) return recusa('Valor fora do catálogo.');
      if (__SEM_PRECO__b.produto === 'iris' && v.oferta !== 'iris' || b.produto === 'site' && v.oferta !== 'encontrado' || b.produto === 'prumo' && v.oferta === 'iris') return recusa('A condição não pertence à oferta.');
      v = {versao:1,oferta:v.oferta,componente:v.componente,...(v.oferta==='iris'?{quantidade:v.quantidade}:{}),valor_centavos:valor,referencia:v.referencia.trim(),data:v.data};
    } else if (b.tipo === 'receita_desfeita') {
      if (!keys(['versao','tipo','referencia','data']) || !['pagamento_confirmado','valor_proposta'].includes(v.tipo)) return recusa('Reversão inválida.');
      v = {versao:1,tipo:v.tipo,referencia:v.referencia.trim(),data:v.data};
    } else if (b.tipo === 'retencao_3m') {
      if (!keys(['versao','referencia','inicio','data','ativa']) || !real(v.inicio) || typeof v.ativa !== 'boolean') return recusa('Retenção inválida.');
      const [a,m,d] = v.inicio.split('-').map(Number); const mes = new Date(Date.UTC(a,m+1,1));
      mes.setUTCDate(Math.min(d,new Date(Date.UTC(mes.getUTCFullYear(),mes.getUTCMonth()+1,0)).getUTCDate()));
      if (v.data < mes.toISOString().slice(0,10)) return recusa('Ainda não chegou ao terceiro mês.');
      v = {versao:1,referencia:v.referencia.trim(),inicio:v.inicio,data:v.data,ativa:v.ativa};
    } else {
      if (!keys(['versao','referencia','data'])) return recusa('Indicação inválida.');
      v = {versao:1,referencia:v.referencia.trim(),data:v.data};
    }
    data = v.data;
  }
  texto = JSON.stringify(v);
}
if (b.tipo === 'spiced') {
  // Espelho de src/operations/spiced.ts: nada é truncado ou confirmado pelo modelo.
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const keys = (v, ks) => Object.keys(v).length === ks.length && ks.every(k => Object.hasOwn(v, k));
  const campo = v => typeof v === 'string' && v.length <= 200 && !/[\\u0000-\\u0008\\u000b-\\u001f\\u007f]/.test(v);
  const dia = v => v === '' || typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
  if (typeof b.texto !== 'string' || b.texto.length > 1000) return recusa('SPICED deve caber em 1000 caracteres.');
  let s;
  try { s = JSON.parse(b.texto); } catch { return recusa('SPICED inválido.'); }
  if (!obj(s) || !keys(s, ['situacao','dor','impacto','evento_critico','decisao'])
    || ![s.situacao,s.dor,s.impacto].every(campo)
    || !obj(s.evento_critico) || !keys(s.evento_critico, ['fato','data']) || !campo(s.evento_critico.fato) || !dia(s.evento_critico.data)
    || !obj(s.decisao) || !keys(s.decisao, ['decisor_confirmado','quem','como_paga'])
    || !['sim','nao','nao-sei'].includes(s.decisao.decisor_confirmado) || !campo(s.decisao.quem) || !campo(s.decisao.como_paga)) return recusa('SPICED inválido.');
  texto = JSON.stringify({situacao:s.situacao.trim(),dor:s.dor.trim(),impacto:s.impacto.trim(),
    evento_critico:{fato:s.evento_critico.fato.trim(),data:s.evento_critico.data},
    decisao:{decisor_confirmado:s.decisao.decisor_confirmado,quem:s.decisao.quem.trim(),como_paga:s.decisao.como_paga.trim()}});
  if (texto.length > 1000) return recusa('SPICED deve caber em 1000 caracteres.');
  data = '';
}
if (data && !/^\\d{4}-\\d{2}-\\d{2}$/.test(data)) return recusa('Data inválida.');
if (b.tipo === 'cadencia_enviada') {
  let r;
  try { r = JSON.parse(String(b.texto)); } catch { return recusa('Cadência inválida.'); }
  if (String(b.texto).length > 1000 || !r || Array.isArray(r) || r.versao !== 1 || !['proposta','conversa'].includes(r.tipo)
    || typeof r.origem !== 'string' || !Number.isFinite(Date.parse(r.origem))
    || Object.keys(r).some(k => !['versao','tipo','origem','degrau','base'].includes(k))
    || (r.tipo === 'proposta' ? !['dia-1','dia-4','dia-8'].includes(r.degrau) : r.degrau !== 'dia-2' || typeof r.base !== 'string' || !Number.isFinite(Date.parse(r.base)))) return recusa('Cadência inválida.');
}
if (b.tipo === 'nota' && !texto) return recusa('Nota vazia.');
const em = new Date().toISOString();
return [{ json: { ok: true, em, linha: { em, produto: b.produto, id, empresa: txt(b.empresa, 120), tipo: b.tipo, texto, data, origem: 'Central' } } }];"""


def validar_js(config=None):
    """VALIDAR_JS com os produtos do registro e a recusa de preço das ofertas sem tabela."""
    config = REGISTRO if config is None else config
    produtos = "[" + ", ".join(registro.js_texto(p) for p in registro.produtos_do_crm(config)) + "]"
    sem_preco = "".join(f"b.produto === {registro.js_texto(k)} || " for k in registro.ids(config) if k not in OFERTAS_COM_TABELA)
    return VALIDAR_JS_MODELO.replace("__PRODUTOS__", produtos).replace("__SEM_PRECO__", sem_preco)


VALIDAR_JS = validar_js()


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
    """gid da aba de cada oferta, só para o link; sem a credencial viva, link sem gid."""
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
    abas = registro.abas(REGISTRO)
    # x das leituras e do resto da cadeia: a 1ª oferta em 1980, uma coluna de 220 por oferta.
    x_depois = 1980 + 220 * len(abas)
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
        # Uma leitura por oferta do registro ("Ler Clínicas", "Ler Estamparias"...), pelo nome da aba.
        *(ler("ler-" + registro.slug(aba), "Ler " + aba, PRUMO, 1980 + 220 * i, 0, aba=aba)
          for i, aba in enumerate(abas.values())),
        ler("ler-crm", "Ler aba CRM", SITE, x_depois, 0, aba=ABA_CRM),
        code("montar", "Montar retrato", montar_js(gids), x_depois + 220, 0),
        {"id": "gravar", "name": "Gravar retrato", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1.1,
         "position": [x_depois + 440, 0],
         "parameters": {"operation": "write", "dataPropertyName": "data", "fileName": "={{ '" + ESTADO + "' + $json.arquivo }}"}},
    ]
    nomes = [n["name"] for n in nos]
    if len(nomes) != len(set(nomes)) or len({n["id"] for n in nos}) != len(nos):
        raise registro.RegistroInvalido("aba de oferta gera nó com nome ou id repetido no 08 · CRM")
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
    cadeia = ["Ler Leads", "Ler Prospects", *registro.leituras(REGISTRO), "Ler aba CRM", "Montar retrato", "Gravar retrato"]
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
    primeira = OFERTAS[0]
    troca = {
        "Ler Leads": "return " + json.dumps([{"json": l} for l in site], ensure_ascii=False) + ";",
        "Ler Prospects": falhar_prumo + "return " + json.dumps([{"json": l} for l in prumo], ensure_ascii=False) + ";",
        # A 1ª oferta do registro com uma linha; as outras como aba ainda inexistente: o retrato sai igual,
        # com a fonte marcada.
        **{f"Ler {aba}": ("return " + json.dumps([{"json": {**prumo[0], "ID": f"teste-{k}-1", "Empresa": "Empresa teste"}}],
                                                  ensure_ascii=False) + ";" if k == primeira
                          else f"return [{{ json: {{ error: {{ message: {json.dumps('aba ' + aba + ' não encontrada', ensure_ascii=False)} }} }} }}];")
           for k, aba in ABAS_DAS_OFERTAS.items()},
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
        contagem = ("site", "prumo", *OFERTAS, "registros", "porte")
        conferir(f"execução {status}, arquivo {m.get('arquivo')}, " + " ".join(f"{k}={m.get(k)}" for k in contagem),
                 status == "success" and m.get("arquivo") == "crm.json"
                 and tuple(m.get(k) for k in contagem) == (3, 1, *(1 if k == primeira else 0 for k in OFERTAS), 1, 1))

        antes = ultimo_id()
        post(f"{LOCAL}/zz-teste-crm-atualizar", {"falhar": True}, chave)
        status, saidas = ultima_execucao(antes)
        m = (saidas.get("Montar retrato") or [{}])[0]
        conferir(f"Prospects caída -> {m.get('arquivo')} ({m.get('erro')})", m.get("arquivo") == "crm-falha.json")

        codigo, corpo = post(f"{LOCAL}/zz-teste-crm-registro",
                             {"produto": "site", "id": "TESTE-SITE-1", "empresa": "Loja teste 1", "tipo": "proximo_passo",
                              "texto": "=ligar amanhã", "data": "2026-10-01"}, chave)
        conferir(f"registro válido -> {codigo} {corpo[:80]}", codigo == 200 and json.loads(corpo).get("ok") is True)
        # Toda oferta do registro tem o registro aceito (antes de 28/10 a lista era escrita aqui e no VALIDAR_JS).
        for k in OFERTAS:
            codigo, corpo = post(f"{LOCAL}/zz-teste-crm-registro",
                                 {"produto": k, "id": f"teste-{k}-1", "empresa": "Empresa teste", "tipo": "nota", "texto": "ok"}, chave)
            conferir(f"registro de {k} -> {codigo} {corpo[:80]}", codigo == 200)
        # OT-06 (recusou) e AC-08/AC-10, 17/10/2026 (ganhou, dispensado): texto opcional, data do dia ou vazia.
        for tipo, produto, extra in (("recusou", "plus", {}), ("recusou_desfeito", "prumo", {}),
                                     ("ganhou", "plus", {"data": "2026-10-17"}), ("ganhou_desfeito", "site", {}),
                                     ("dispensado", OFERTAS[0], {"texto": "é franquia", "data": "2026-10-17"}),
                                     ("dispensado_desfeito", OFERTAS[-1], {})):
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
    # Registro fora do contrato (aba repetida, id que colide com o código gerado...) para antes de tocar o n8n.
    registro.conferir(REGISTRO)
    erro = sv.erro_wf()
    auth = credencial()
    if "--testar" in sys.argv:
        sys.exit(0 if testar(erro, auth) else 1)
    try:
        aba()
    except (SystemExit, Exception) as e:  # noqa: BLE001 — a aba pode esperar a credencial do Google voltar
        print(f"aba {ABA_CRM}: não deu para conferir agora ({str(e)[:160]}). Rode `python3 crm.py --aba` depois.")
    publicar(fluxo(erro, auth, gids_das_ofertas()))
