"""Pesquisa sob demanda para o Encontrado, via RSS público do Google Notícias."""

import copy


TRIGGER_ID = 'pesquisa-google-webhook'
PATH = 'prumo-pesquisa-google'
MONTAR = 'Montar consultas Google'
BUSCAR = 'Buscar no Google Notícias'
ISOLAR = 'Isolar resposta RSS'
LER = 'Ler fontes do Google Notícias'
TRIAR = 'Entregar evidências para revisão'

PLANOS = r"""
const planos = [
  {
    nicho: 'servicos-tecnicos',
    tipo: 'mudanca-comercial',
    busca: '("inaugura" OR "nova unidade" OR "muda de endereço") ("dedetizadora" OR "centro automotivo" OR "controle de pragas")'
  },
  {
    nicho: 'servicos-tecnicos',
    tipo: 'mudanca-comercial',
    busca: '("inaugura" OR "nova unidade") ("oficina mecânica" OR "auto center" OR "centro automotivo")'
  },
  {
    nicho: 'escritorios',
    tipo: 'mudanca-comercial',
    busca: '("inaugura" OR "novo escritório" OR "nova sede") ("escritório de advocacia" OR "escritório de contabilidade") -OAB'
  },
  {
    nicho: 'escritorios',
    tipo: 'mudanca-comercial',
    busca: '("novo escritório" OR "nova unidade" OR "muda de endereço") ("assessoria contábil" OR "escritório contábil")'
  },
  {
    nicho: 'agencias',
    tipo: 'pedido-publico',
    busca: '("buscamos parceiro" OR "procuramos fornecedor" OR "procuro freelancer") ("site institucional" OR "landing page")'
  },
  {
    nicho: 'agencias',
    tipo: 'pedido-publico',
    busca: '("agência digital" OR "agência de marketing") ("busca fornecedor" OR "busca freelancer" OR "terceirização") ("site" OR "landing page")'
  }
];
const dias = entradas.dias ?? 45;
const selecionados = planos.filter(p => entradas.nicho === undefined || p.nicho === entradas.nicho);
if (!Number.isInteger(dias) || dias < 7 || dias > 60 || !selecionados.length) {
  throw new Error('Use janela de 7 a 60 dias e nicho servicos-tecnicos, escritorios ou agencias.');
}
const desde = new Date(Date.now() - dias * 86400000).toISOString();
return selecionados.map(p => ({json: {...p, desde, dias, consulta: p.busca + ' when:' + dias + 'd'}}));
"""
CONSULTAS = "const entradas = $('Pesquisa Google autenticada').first().json.body ?? {};\n" + PLANOS

TRIAGEM = r"""
const limpar = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const chave = value => limpar(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const grupos = {
  'servicos-tecnicos': /\b(dedetiz\w*|controle de pragas|centro automotivo|oficina(s)? (mecanica|central|automotiva)|auto\s?cent[eo]r)\b/,
  escritorios: /\b(escritorio (de )?(advocacia|contabilidade|contabil)|advogados associados|assessoria contabil)\b/,
};
const evento = /\b(inaugur\w*|nov[ao] (sede|unidade|escritorio|endereco)|mud\w+ de endereco|abre (uma )?nova unidade)\b/;
const novaSede = /\b(inaugur\w*|abre|anuncia) (uma )?(nova sede|novo escritorio)\b/;
const compra = /\b(busca(mos)? (um |uma )?(parceir[oa]|fornecedor|freelancer)|procur\w+ (um |uma )?(fornecedor|freelancer)|recebimento de propostas|solicitacao de proposta)\b/;
const entrega = /\b(landing page|site institucional|criacao de sites?)\b/;
const fora = /\b(oab|forum|prefeit[oa]\w*|universidade|vaga clt|processo seletivo|portal da transparencia|e-commerce|licitacao|franquia|ar[- ]condicionado)\b/;
const pendencias = {
  'mudanca-comercial': ['confirmar o fato na publicação original', 'validar empresa, canal público e uma lacuna concreta no caminho até o orçamento'],
  'pedido-publico': ['confirmar quem compra, se o pedido está aberto e o canal de proposta', 'validar que o escopo é um site simples, com WhatsApp e sem integrações'],
};
const google = query => 'https://www.google.com/search?hl=pt-BR&q=' + encodeURIComponent(query);
const links = new Set();
const recibos = [];
const achados = [];
const planos = $('Montar consultas Google').all().map(item => item.json);
const respostas = $input.all();
// HTTP em modo texto devolve um item por plano em ordem. O loop de XML
// conserva esses lugares, inclusive com o item vazio de uma resposta inválida.
const alinhadas = respostas.length === planos.length;
for (const [i, plano] of planos.entries()) {
  const canal = alinhadas ? respostas[i].json?.rss?.channel : undefined;
  const dados = canal?.item ?? [];
  const noticias = Array.isArray(dados) ? dados : [dados];
  const recibo = {nicho: plano.nicho, consulta: plano.consulta, estado: canal ? 'ok' : 'falhou', lidas: noticias.length, filtradas: 0, duplicadas: 0};
  recibos.push(recibo);
  for (const noticia of noticias) {
    const veiculo = limpar(noticia?.source?._);
    const manchete = limpar(noticia?.title);
    const titulo = veiculo && manchete.endsWith(' - ' + veiculo) ? manchete.slice(0, -(veiculo.length + 3)) : manchete;
    const texto = chave(titulo);
    const urlGoogleNoticias = limpar(noticia?.link);
    const urlVeiculo = limpar(noticia?.source?.url);
    const publicada = Date.parse(noticia?.pubDate);
    const ramoNoTitulo = grupos[plano.nicho]?.test(texto) ?? false;
    const ramoParaRevisar = plano.nicho === 'escritorios' && !ramoNoTitulo && novaSede.test(texto);
    const combina = plano.tipo === 'pedido-publico' ? compra.test(texto) && entrega.test(texto) :
      (ramoNoTitulo || ramoParaRevisar) && evento.test(texto);
    if (!combina || fora.test(texto) || !/^https:\/\/news\.google\.com\/rss\/articles\//.test(urlGoogleNoticias) ||
        !Number.isFinite(publicada) || publicada < Date.parse(plano.desde) || publicada > Date.now()) {
      recibo.filtradas++;
      continue;
    }
    if (links.has(texto) || links.has(urlGoogleNoticias)) {
      recibo.duplicadas++;
      continue;
    }
    links.add(texto);
    links.add(urlGoogleNoticias);
    achados.push({
      nicho: plano.nicho, tipo: plano.tipo, titulo, publicadaEm: new Date(publicada).toISOString(),
      veiculo, urlVeiculo, urlGoogleNoticias, buscaFonteOriginal: google('"' + titulo + '"'),
      nichoAMapear: ramoParaRevisar || plano.tipo === 'pedido-publico',
      intencaoCompra: 'a-confirmar', escopoEncontrado: 'a-confirmar',
      pendencias: ramoParaRevisar ? ['confirmar o ramo da empresa no artigo', ...pendencias[plano.tipo]] : pendencias[plano.tipo],
    });
  }
}
achados.sort((a, b) => a.tipo === b.tipo ? b.publicadaEm.localeCompare(a.publicadaEm) :
  a.tipo === 'pedido-publico' ? -1 : 1);
const buscasComplementares = planos.map(p => ({
  nicho: p.nicho, estado: 'para-pesquisar', url: google(
    (p.nicho === 'agencias' ? 'site:linkedin.com/posts ' : '') + p.busca + ' after:' + p.desde.slice(0, 10)),
}));
const exitos = recibos.filter(r => r.estado === 'ok').length;
return [{json: {
  ok: exitos > 0,
  estado: !exitos ? 'indisponivel' : exitos === recibos.length ? 'concluida' : 'parcial',
  fonte: 'Google Notícias RSS', geradoEm: new Date().toISOString(),
  janelaDias: planos[0]?.dias ?? null, politicaCusto: 'zero',
  mensagensEnviadas: 0, registrosComerciaisAlterados: 0, oportunidadesConfirmadas: 0,
  consultas: recibos, sinaisEncontrados: achados.length, sinais: achados.slice(0, 15), buscasComplementares,
}}];
"""


def anexar_google(workflow, *, janela_interna=None):
    """Acrescenta uma entrada autenticada independente dos gatilhos existentes."""
    if any(node['id'] == TRIGGER_ID for node in workflow['nodes']):
        return
    def node(id_, name, kind, version, x, parameters, **options):
        return {'id': id_, 'name': name, 'type': 'n8n-nodes-base.' + kind, 'typeVersion': version,
                'position': [x, 650], 'parameters': parameters, **options}

    if janela_interna is None:
        revisao = next(node for node in workflow['nodes'] if node['id'] == 'webhook')
        entrada = node(TRIGGER_ID, 'Pesquisa Google autenticada', 'webhook', 2, 0,
                       {'httpMethod': 'POST', 'path': PATH, 'authentication': 'headerAuth',
                        'responseMode': 'lastNode', 'options': {}},
                       credentials=copy.deepcopy(revisao['credentials']), webhookId='prumo-pesquisa-google-20261118')
        consultas = CONSULTAS
    else:
        if type(janela_interna) is not int or not 7 <= janela_interna <= 60:
            raise ValueError('Janela interna fora do intervalo da pesquisa.')
        entrada = node('pesquisa-google-interna', 'Receber pesquisa diária', 'executeWorkflowTrigger', 1.1, 0,
                       {'inputSource': 'passthrough'})
        consultas = f'const entradas = {{dias: {janela_interna}}};\n' + PLANOS

    nodes = [
        entrada,
        node('pesquisa-google-consultas', MONTAR, 'code', 2, 240, {'jsCode': consultas}),
        node('pesquisa-google-http', BUSCAR, 'httpRequest', 4.4, 480, {
            'method': 'GET', 'url': 'https://news.google.com/rss/search',
            'sendQuery': True, 'queryParameters': {'parameters': [
                {'name': 'q', 'value': '={{ $json.consulta }}'}, {'name': 'hl', 'value': 'pt-BR'},
                {'name': 'gl', 'value': 'BR'}, {'name': 'ceid', 'value': 'BR:pt-419'},
            ]},
            'options': {'timeout': 10000, 'redirect': {'redirect': {'followRedirects': False}},
                        'response': {'response': {'responseFormat': 'text', 'outputPropertyName': 'data'}}},
        }, onError='continueRegularOutput'),
        node('pesquisa-google-isolar', ISOLAR, 'splitInBatches', 3, 720, {'batchSize': 1, 'options': {}}),
        node('pesquisa-google-xml', LER, 'xml', 1, 960,
             {'mode': 'xmlToJson', 'dataPropertyName': 'data', 'options': {}},
             onError='continueRegularOutput', alwaysOutputData=True),
        node('pesquisa-google-evidencias', TRIAR, 'code', 2, 1200, {'jsCode': TRIAGEM}),
    ]
    workflow['nodes'].extend(nodes)
    for origem, destino in ((entrada['name'], MONTAR), (MONTAR, BUSCAR), (BUSCAR, ISOLAR), (LER, ISOLAR)):
        workflow['connections'][origem] = {'main': [[{'node': destino, 'type': 'main', 'index': 0}]]}
    workflow['connections'][ISOLAR] = {'main': [
        [{'node': TRIAR, 'type': 'main', 'index': 0}],
        [{'node': LER, 'type': 'main', 'index': 0}],
    ]}
