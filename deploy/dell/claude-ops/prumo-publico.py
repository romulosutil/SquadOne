"""Instala os dois workflows do serviço público do PRUMO, sem enviar mensagens.

Segredos são credenciais cifradas do n8n. Os nomes são estáveis para atualização
idempotente. Perguntas e respostas da Fonte não ficam no histórico de execuções.
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


def base(nome, nos, segundos=None):
    gatilho = {'id': 'agenda', 'name': 'A cada ciclo', 'type': 'n8n-nodes-base.scheduleTrigger',
               'typeVersion': 1.2, 'position': [0, 0], 'parameters': {'rule': {'interval': [
                   {'field': 'seconds', 'secondsInterval': segundos} if segundos else {'field': 'minutes', 'minutesInterval': 1}]}}}
    manual = {'id': 'manual', 'name': 'Executar manualmente', 'type': 'n8n-nodes-base.manualTrigger',
              'typeVersion': 1, 'position': [0, 200], 'parameters': {}}
    conexoes = {n['name']: {'main': [[destino(prox['name'])]]} for n, prox in zip(nos, nos[1:])}
    for n in [gatilho, manual]:
        conexoes[n['name']] = {'main': [[destino(nos[0]['name'])]]}
    for i, n in enumerate(nos):
        n['position'] = [300 + i * 260, 0]
    return {'name': nome, 'nodes': [gatilho, manual, *nos], 'connections': conexoes,
            'settings': {'executionOrder': 'v1', 'timezone': 'America/Sao_Paulo',
                         'saveDataErrorExecution': 'none', 'saveDataSuccessExecution': 'none',
                         'saveManualExecutions': False, 'saveExecutionProgress': False,
                         'executionTimeout': 170}}


def fonte(credencial, luna):
    return base('PRUMO · Fonte com IA (Luna do Hermes)', [
        http('Buscar próxima pergunta', '/operacao/reivindicar', credencial, 'POST', '{}'),
        code('Separar pergunta', "return ($input.first().json.pedidos ?? []).map(p => ({json:p}));"),
        http('Consultar base com Luna', '/fonte', luna, 'POST',
             '={{ JSON.stringify({empresa:$json.empresa,perfil:$json.perfil,pergunta:$json.pergunta}) }}', privado=True),
        http('Confirmar resposta salva', '/operacao/concluir', credencial, 'POST',
             "={{ JSON.stringify({id:$('Separar pergunta').first().json.id,lease:$('Separar pergunta').first().json.lease,resposta:$json}) }}"),
    ], segundos=5)


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
return [{json:{origens:[...origens]}}];
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
    return base('PRUMO · Medição de eventos', [ler, extrair, code('Registrar origens das páginas', ORIGENS_JS),
        http('Autorizar páginas publicadas', '/operacao/origens', credencial, 'POST', '={{ JSON.stringify($json) }}'),
        http('Ler contagens duráveis', '/operacao/metricas', credencial), pacote, salvar])


def instalar():
    from n8n import api, put
    pasta = Path.home() / '.config/claude-ops'
    credencial = (pasta / 'prumo-publico-cred').read_text().strip()
    luna = (pasta / 'luna-workflows-cred').read_text().strip()
    existentes = api('GET', '/workflows?limit=100')['data']
    for w in [fonte(credencial, luna), metricas(credencial)]:
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
