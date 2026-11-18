"""Relatório diário de pesquisa para a triagem comercial do WhatsApp."""

from copy import deepcopy
import json

from pesquisa_google import anexar_google

NOME = 'PRUMO · Pesquisa diária para WhatsApp'
PATH = 'prumo-pesquisa-diaria-whatsapp'
PREFIXO = '/home/node/.n8n-files/estado/prumo-radar-whatsapp-'
BUSCA = 'Consultar pesquisa Google do Prumo'
RELATORIO = 'Preparar relatório para Rômulo'
GRAVAR = 'Gravar pesquisa do dia'

MONTAR = r"""
const pesquisa = $('Consultar pesquisa Google do Prumo').first().json;
const estados = ['concluida', 'parcial', 'indisponivel'];
if (pesquisa.fonte !== 'Google Notícias RSS' || !estados.includes(pesquisa.estado) ||
    pesquisa.politicaCusto !== 'zero' || pesquisa.mensagensEnviadas !== 0 ||
    pesquisa.registrosComerciaisAlterados !== 0 || !Array.isArray(pesquisa.sinais)) {
  throw new Error('A pesquisa Google não devolveu um resultado verificável.');
}
const hoje = $now.setZone('America/Sao_Paulo').toISODate();
const errosLeitura = $('Ler relatórios recentes').all().map(item => item.json.error).filter(Boolean);
if (errosLeitura.some(erro => erro !== 'No file(s) found')) {
  throw new Error('Não foi possível ler o histórico da pesquisa diária.');
}
const anteriores = new Map();
for (const item of $input.all()) {
  const recibo = item.json.data ?? item.json;
  for (const sinal of recibo.sinaisParaRevisao ?? []) {
    const primeiro = anteriores.get(sinal.urlGoogleNoticias);
    if (!primeiro || sinal.primeiraObservacao < primeiro) {
      anteriores.set(sinal.urlGoogleNoticias, sinal.primeiraObservacao);
    }
  }
}
const nichos = ['servicos-tecnicos', 'escritorios'];
const sinais = pesquisa.sinais.filter(item => nichos.includes(item.nicho)).map(sinal => ({
  ...sinal,
  primeiraObservacao: anteriores.get(sinal.urlGoogleNoticias) ?? hoje,
  whatsapp: 'aguarda-iniciativa-ou-permissao-do-cliente',
}));
const porNicho = nichos.map(nicho => ({
  nicho,
  sinais: sinais.filter(item => item.nicho === nicho).length,
  novosSinais: sinais.filter(item => item.nicho === nicho && item.primeiraObservacao === hoje).length,
  consultas: pesquisa.consultas.filter(item => item.nicho === nicho),
}));
const recibo = {
  versao: 1, dia: hoje, geradoEm: $now.toISO(), execucaoN8n: String($execution.id),
  estadoDaFonte: pesquisa.estado, fonte: pesquisa.fonte, janelaDias: pesquisa.janelaDias,
  novosSinais: porNicho.reduce((total, grupo) => total + grupo.novosSinais, 0),
  leadsQualificadosPelaPesquisa: 0, mensagensEnviadas: 0, registrosComerciaisAlterados: 0,
  porNicho, sinaisParaRevisao: sinais,
  buscasGoogleWebParaRevisao: pesquisa.buscasComplementares.filter(item => nichos.includes(item.nicho)),
};
return [{json: recibo, binary: {data: {
  data: Buffer.from(JSON.stringify(recibo, null, 2)).toString('base64'),
  mimeType: 'application/json', fileName: 'prumo-radar-whatsapp-' + hoje + '.json',
}}}];
"""


def workflow(credencial, error_workflow):
    def node(id_, name, kind, version, x, params, y=0, **options):
        return {'id': id_, 'name': name, 'type': 'n8n-nodes-base.' + kind, 'typeVersion': version,
                'position': [x, y], 'parameters': params, **options}

    agenda = node('agenda', 'Todo dia às 08h15', 'scheduleTrigger', 1.2, 0, {
        'rule': {'interval': [{'field': 'cronExpression', 'expression': '15 8 * * *'}]},
    })
    revisao = node('revisao', 'Rodar a pesquisa diária agora', 'webhook', 2, 0, {
        'httpMethod': 'POST', 'path': PATH, 'authentication': 'headerAuth',
        'responseMode': 'lastNode', 'options': {},
    }, y=180, credentials=deepcopy(credencial), webhookId='prumo-radar-whatsapp-20261118')
    pesquisa = {'name': 'Pesquisa Google para a revisão diária', 'nodes': [], 'connections': {}}
    anexar_google(pesquisa, janela_interna=14)
    busca = node('google', BUSCA, 'executeWorkflow', 1.2, 240, {
        'source': 'parameter', 'mode': 'once', 'workflowJson': json.dumps(pesquisa, ensure_ascii=False),
        'options': {'waitForSubWorkflow': True},
    })
    # Basta cobrir a mesma janela que a consulta. Inclui o recibo do dia em uma nova execução.
    ultimos_dias = ("={{ '" + PREFIXO + "' + '{' + Array.from({length: 15}, (_, i) => "
                    "$now.setZone('America/Sao_Paulo').minus({days: i}).toISODate()).join(',') + '}.json' }}")
    historico = node('historico', 'Ler relatórios recentes', 'readWriteFile', 1.1, 480, {
        'operation': 'read', 'fileSelector': ultimos_dias, 'options': {},
    }, alwaysOutputData=True, onError='continueRegularOutput')
    extrair = node('extrair', 'Ler JSON dos relatórios', 'extractFromFile', 1.1, 720, {
        'operation': 'fromJson', 'binaryPropertyName': 'data', 'options': {},
    }, alwaysOutputData=True, onError='continueRegularOutput')
    montar = node('relatorio', RELATORIO, 'code', 2, 960, {'jsCode': MONTAR})
    gravar = node('gravar', GRAVAR, 'readWriteFile', 1.1, 1200, {
        'operation': 'write', 'dataPropertyName': 'data',
        'fileName': "={{ '" + PREFIXO + "' + $json.dia + '.json' }}",
    })
    caminho = [busca, historico, extrair, montar, gravar]
    conexoes = [(agenda, busca), (revisao, busca), *zip(caminho, caminho[1:])]
    return {
        'name': NOME, 'nodes': [agenda, revisao, *caminho],
        'connections': {a['name']: {'main': [[{'node': b['name'], 'type': 'main', 'index': 0}]]}
                        for a, b in conexoes},
        'settings': {'timezone': 'America/Sao_Paulo', 'executionOrder': 'v1',
                     'executionTimeout': 70, 'saveDataSuccessExecution': 'none',
                     'saveDataErrorExecution': 'all', 'saveManualExecutions': False,
                     'errorWorkflow': error_workflow},
    }
