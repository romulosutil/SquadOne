"""Instala os dois workflows do serviço público do PRUMO, sem enviar mensagens.

Segredos são credenciais cifradas do n8n. Os nomes são estáveis para atualização
idempotente. Perguntas e respostas da Fonte não ficam no histórico de execuções
(nem nas com erro: por isso a Fonte guarda saveDataErrorExecution "none"; a Medição só
conta eventos e guarda as execuções com erro, "all", para a falha deixar rastro).

Cadência (19/10/2026): a Fonte consulta a fila de perguntas a cada 30 s (era 5 s, 17.280
execuções por dia para um trabalho raro; a demo responde em até 30 s). A Medição roda a
cada minuto, mas só reenvia a lista de origens quando ela muda, ou a cada 30 min por
garantia (o serviço público pode reiniciar e perder a lista). A memória disso é o
staticData do fluxo; se o n8n não a gravar, o fluxo volta a reenviar a cada minuto, o
que é só barulho, nunca perda.
"""
import json
from pathlib import Path

PUBLICO = 'https://aladdin-prumo-automacoes.jicnzg.easypanel.host'


def destino(nome):
    return {'node': nome, 'type': 'main', 'index': 0}


def http(nome, caminho, credencial, metodo='GET', corpo=None, privado=False):
    parametros = {'url': ('http://luna-workflows:8766' if privado else PUBLICO) + caminho,
                  'method': metodo, 'authentication': 'genericCredentialType',
                  'genericAuthType': 'httpHeaderAuth', 'options': {'timeout': 140000 if privado else 20000}}
    if corpo is not None:
        parametros.update(sendBody=True, specifyBody='json', jsonBody=corpo)
    return {'id': nome, 'name': nome, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.4,
            'position': [300, 0], 'parameters': parametros,
            'credentials': {'httpHeaderAuth': {'id': credencial, 'name': 'PRUMO operação pública' if not privado else 'Luna dos workflows (Dell)'}}}


def code(nome, js):
    return {'id': nome, 'name': nome, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
            'position': [600, 0], 'parameters': {'jsCode': js}}


def base(nome, nos, segundos=None, ligacoes=None, guardar_erro='none'):
    """`ligacoes`: {nome: [próximos]} no lugar da cadeia linear. `guardar_erro`: o que salvar das execuções com erro."""
    gatilho = {'id': 'agenda', 'name': 'A cada ciclo', 'type': 'n8n-nodes-base.scheduleTrigger',
               'typeVersion': 1.2, 'position': [0, 0], 'parameters': {'rule': {'interval': [
                   {'field': 'seconds', 'secondsInterval': segundos} if segundos else {'field': 'minutes', 'minutesInterval': 1}]}}}
    manual = {'id': 'manual', 'name': 'Executar manualmente', 'type': 'n8n-nodes-base.manualTrigger',
              'typeVersion': 1, 'position': [0, 200], 'parameters': {}}
    if ligacoes is None:
        conexoes = {n['name']: {'main': [[destino(prox['name'])]]} for n, prox in zip(nos, nos[1:])}
    else:
        conexoes = {de: {'main': [[destino(p) for p in saida] for saida in saidas]} for de, saidas in ligacoes.items()}
    for n in [gatilho, manual]:
        conexoes[n['name']] = {'main': [[destino(nos[0]['name'])]]}
    for i, n in enumerate(nos):
        n['position'] = [300 + i * 260, 0]
    return {'name': nome, 'nodes': [gatilho, manual, *nos], 'connections': conexoes,
            'settings': {'executionOrder': 'v1', 'timezone': 'America/Sao_Paulo',
                         'saveDataErrorExecution': guardar_erro, 'saveDataSuccessExecution': 'none',
                         'saveManualExecutions': False, 'saveExecutionProgress': False,
                         'executionTimeout': 170}}


def fonte(credencial, luna, falha_id=None):
    w = base('PRUMO · Fonte com IA (Luna do Hermes)', [
        http('Buscar próxima pergunta', '/operacao/reivindicar', credencial, 'POST', '{}'),
        code('Separar pergunta', "return ($input.first().json.pedidos ?? []).map(p => ({json:p,pairedItem:{item:0}}));"),
        http('Consultar base com Luna', '/fonte', luna, 'POST',
             '={{ JSON.stringify({empresa:$json.empresa,perfil:$json.perfil,pergunta:$json.pergunta}) }}', privado=True),
        http('Confirmar resposta salva', '/operacao/concluir', credencial, 'POST',
             "={{ JSON.stringify({id:$('Separar pergunta').item.json.id,lease:$('Separar pergunta').item.json.lease,resposta:$json}) }}"),
    ], segundos=30)
    if falha_id:
        w['settings']['errorWorkflow'] = falha_id
    return w


ORIGENS_JS = r'''
const dados = $input.first().json.data ?? $input.first().json;
const leads = Array.isArray(dados) ? dados : (dados.leads ?? []);
const origens = new Set(['https://prumo.services','https://www.prumo.services','https://prumo-piloto-cdl.vercel.app']);
for (const l of leads) {
  for (const url of [l.site_url,l.raio_x_url,l.link,l.vercel_project ? 'https://' + l.vercel_project + '.vercel.app' : '']) {
    const m = String(url ?? '').match(/^https:\/\/([a-z0-9-]+\.vercel\.app)(?:[/?#]|$)/);
    if (m) origens.add('https://' + m[1]);
  }
}
const lista = [...origens].sort();
const hash = lista.join('|');
// Só reenvia quando a lista mudou, ou a cada 30 min (o serviço público pode ter reiniciado e perdido a lista).
const estado = $getWorkflowStaticData('global');
const velho = !(Date.now() - (estado.enviadoEm ?? 0) < 30 * 60 * 1000);
return [{json:{origens:lista, hash, mudou: estado.origens !== hash || velho}}];
'''

# Depois de o serviço aceitar a lista: a memória só avança com o envio feito, para a falha voltar na rodada seguinte.
LEMBRAR_ORIGENS_JS = r'''
const estado = $getWorkflowStaticData('global');
estado.origens = $('Registrar origens das páginas').first().json.hash;
estado.enviadoEm = Date.now();
return $input.all();
'''


def metricas(credencial):
    ler = {'id': 'ler-site', 'name': 'Ler páginas publicadas', 'type': 'n8n-nodes-base.readWriteFile',
           'typeVersion': 1.1, 'position': [300, 0], 'parameters': {'operation': 'read',
               'fileSelector': '/home/node/.n8n-files/estado/site-leads.json', 'options': {}}}
    extrair = {'id': 'extrair-site', 'name': 'Ler registro de páginas', 'type': 'n8n-nodes-base.extractFromFile',
               'typeVersion': 1.1, 'position': [560, 0], 'parameters': {'operation': 'fromJson', 'options': {}}}
    pacote = code('Preparar retrato da medição', """const d = $input.first().json;
if (!Array.isArray(d.eventos) || !Number.isInteger(d.total) || d.total < 0) throw Error('Medição inválida');
return [{json:{total:d.total},binary:{data:{data:Buffer.from(JSON.stringify(d),'utf8').toString('base64'),mimeType:'application/json',fileName:'prumo-metricas.json'}}}];""")
    salvar = {'id': 'gravar-metricas', 'name': 'Salvar medição no painel privado',
              'type': 'n8n-nodes-base.readWriteFile', 'typeVersion': 1.1, 'position': [1800, 0],
              'parameters': {'operation': 'write', 'dataPropertyName': 'data',
                             'fileName': '/home/node/.n8n-files/estado/prumo-metricas.json'}}
    mudou = {'id': 'origens-mudaram', 'name': 'Origens mudaram?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2,
             'position': [0, 0], 'parameters': {'conditions': {
                 'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 2},
                 'combinator': 'and', 'conditions': [{'id': 'mudou', 'leftValue': '={{ $json.mudou }}', 'rightValue': '',
                                                      'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}]},
                 'options': {}}}
    nos = [ler, extrair, code('Registrar origens das páginas', ORIGENS_JS), mudou,
           http('Autorizar páginas publicadas', '/operacao/origens', credencial, 'POST', '={{ JSON.stringify({origens:$json.origens}) }}'),
           code('Lembrar origens enviadas', LEMBRAR_ORIGENS_JS),
           http('Ler contagens duráveis', '/operacao/metricas', credencial), pacote, salvar]
    # As contagens são lidas em toda rodada; a autorização só quando a lista mudou (ou venceu os 30 min).
    ligacoes = {'Ler páginas publicadas': [['Ler registro de páginas']], 'Ler registro de páginas': [['Registrar origens das páginas']],
                'Registrar origens das páginas': [['Origens mudaram?']],
                'Origens mudaram?': [['Autorizar páginas publicadas'], ['Ler contagens duráveis']],
                'Autorizar páginas publicadas': [['Lembrar origens enviadas']],
                'Lembrar origens enviadas': [['Ler contagens duráveis']],
                'Ler contagens duráveis': [['Preparar retrato da medição']],
                'Preparar retrato da medição': [['Salvar medição no painel privado']]}
    return base('PRUMO · Medição de eventos', nos, ligacoes=ligacoes, guardar_erro='all')


FALHA_JS = r"""
const id = String($input.first().json.execution?.id ?? 'indisponivel').replace(/[^0-9]/g,'').slice(0,20) || 'indisponivel';
const aviso = {titulo:'Fonte: consulta interrompida', origem:'n8n:Fonte',
  texto:'A Fonte falhou na execucao ' + id + '. Verifique provedor, base e fila. A fila tenta novamente ate 3 vezes; nenhuma resposta foi inventada. Nao encaminhe perguntas ou credenciais no alerta.'};
return [{json:{execucao:id},binary:{data:{data:Buffer.from(JSON.stringify(aviso),'utf8').toString('base64'),mimeType:'application/json',fileName:'fonte-falha.json'}}}];
"""


def falha_fonte():
    trigger = {'id':'falha','name':'Falha da Fonte','type':'n8n-nodes-base.errorTrigger',
               'typeVersion':1,'position':[0,0],'parameters':{}}
    montar = code('Montar aviso sem pergunta', FALHA_JS)
    gravar = {'id':'avisar','name':'Avisar operacao','type':'n8n-nodes-base.readWriteFile',
              'typeVersion':1.1,'position':[800,0],'parameters':{'operation':'write','dataPropertyName':'data',
              'fileName':"={{ '/home/node/.n8n-files/avisos/fonte-' + $execution.id + '.json' }}"}}
    return {'name':'PRUMO · Fonte — falha sem dados','nodes':[trigger,montar,gravar],
            'connections':{trigger['name']:{'main':[[destino(montar['name'])]]},
                           montar['name']:{'main':[[destino(gravar['name'])]]}},
            'settings':{'executionOrder':'v1','timezone':'America/Sao_Paulo',
                        'saveDataErrorExecution':'none','saveDataSuccessExecution':'none',
                        'saveManualExecutions':False,'saveExecutionProgress':False,'executionTimeout':30}}


def instalar():
    from n8n import api, put
    pasta = Path.home() / '.config/claude-ops'
    credencial = (pasta / 'prumo-publico-cred').read_text().strip()
    luna = (pasta / 'luna-workflows-cred').read_text().strip()
    existentes = api('GET', '/workflows?limit=250')['data']
    falha = falha_fonte()
    antes_falha = next((e for e in existentes if e['name'] == falha['name']), None)
    if antes_falha:
        falha['id'] = antes_falha['id']
        instalado = put(falha)
    else:
        instalado = api('POST', '/workflows', falha)
    api('POST', '/workflows/' + instalado['id'] + '/activate')
    for w in [fonte(credencial, luna, instalado['id']), metricas(credencial)]:
        antes = next((e for e in existentes if e['name'] == w['name']), None)
        if antes:
            w['id'] = antes['id']
            novo = put(w)
        else:
            novo = api('POST', '/workflows', w)
        api('POST', '/workflows/' + novo['id'] + '/activate')
        print(w['name'], novo['id'], 'ativo')


if __name__ == '__main__':
    instalar()
