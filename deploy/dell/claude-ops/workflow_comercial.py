"""Deltas comerciais puros: sem API, configuração de ambiente ou execução de modelo.

Aplicar depois de workflow_confiabilidade.preparar; preservar o objeto original.
Endpoint/credencial do classificador são dependências explícitas, nunca descobertas aqui.
"""
import copy
from urllib.parse import urlsplit

CRM_ID = 'AsjxktRCqRJSmj9P'
RESPOSTA_ID = 'IiuekGDVnjFaZpD1'
CRM_NOME = '08 · CRM: retrato e registros (Site antes da venda + PRUMO)'
RESPOSTA_NOME = 'WhatsApp — resposta de lead (classifica)'
MARCA_NOTA = '// [comercial-nota-integral-v1]'
PREPARAR = 'Comercial: preparar envelopes'
TEM = 'Comercial: há envelopes?'
SEPARAR = 'Comercial: separar envelopes'
RECEBER = 'Comercial: receber evento'
CONFERIR = 'Comercial: conferir recibos'

PREPARAR_JS = """// [comercial-envelope-v1] Nenhum texto é copiado para o estado comercial.
const b = $('Resposta no WhatsApp').first().json.body ?? {};
const eventos = b.envelopesComerciais ?? [];
if (!Array.isArray(eventos) || eventos.length > 500) throw new Error('Lista de envelopes comerciais inválida.');
return [{json:{eventos}}];"""
SEPARAR_JS = 'return $input.first().json.eventos.map(e => ({json:e}));'
CONFERIR_JS = """// HTTP 202 só vale como recibo da entrada durável, nunca como ação humana.
const itens = $input.all();
if (!itens.length || itens.some(i => i.json.statusCode !== 202 || i.json.body?.ok !== true || i.json.body?.persistido !== true || !['pendente','repetido'].includes(i.json.body?.estado))) throw new Error('Entrada comercial sem recibo durável.');
return [{json:{recebidos:itens.length}}];"""


def _no(wf, nome):
    encontrados = [n for n in wf['nodes'] if n['name'] == nome]
    if len(encontrados) != 1:
        raise ValueError('Nó obrigatório ausente ou repetido: ' + nome)
    return encontrados[0]


def _destino(nome):
    return {'node': nome, 'type': 'main', 'index': 0}


def _code(id_, nome, js, x):
    return {'id': id_, 'name': nome, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
            'position': [x, -100], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': js}}


def proteger_crm(workflow):
    wf = copy.deepcopy(workflow)
    validar = _no(wf, 'Validar registro')
    codigo = validar['parameters']['jsCode']
    if MARCA_NOTA not in codigo:
        ponto = 'let texto = txt(b.texto, 1000);'
        if codigo.count(ponto) != 1:
            raise ValueError('Validação do 08 mudou; não foi possível localizar o limite da nota.')
        # Guard já presente em uma regeneração recente: não duplicar nem reescrever.
        if "b.tipo === 'nota' && (typeof b.texto !== 'string' || b.texto.length > 1000)" not in codigo:
            codigo = codigo.replace(ponto, MARCA_NOTA + "\nif (b.tipo === 'nota' && (typeof b.texto !== 'string' || b.texto.length > 1000)) return recusa('Nota deve ser texto de até 1000 caracteres; nada foi cortado ou gravado.');\n" + ponto)
        validar['parameters']['jsCode'] = codigo
    append = _no(wf, 'Gravar na aba CRM')
    if append.get('type') != 'n8n-nodes-base.googleSheets' or append.get('parameters', {}).get('operation') != 'append':
        raise ValueError('O append do 08 mudou; preservar e revisar antes de publicar.')
    append['retryOnFail'] = False  # um timeout não autoriza outro append oculto
    return wf


def integrar_respostas(workflow, endpoint, credencial_crm):
    url = urlsplit(endpoint or '')
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('/api/operations/crm/atendimento/evento', '/comercial/evento'):
        raise ValueError('Endpoint comercial explícito e sem segredo na URL é obrigatório.')
    cred = (credencial_crm or {}).get('httpHeaderAuth')
    if not isinstance(cred, dict) or not cred.get('id') or not cred.get('name') or set(cred) - {'id', 'name'}:
        raise ValueError('Referência à credencial HTTP Header CRM existente é obrigatória; não informe segredo.')
    wf = copy.deepcopy(workflow)
    persistir = _no(wf, 'Persistir antes de confirmar')
    _no(wf, 'Resposta no WhatsApp'); _no(wf, 'Responder ao observador')
    if persistir.get('parameters', {}).get('options', {}).get('waitForSubWorkflow') is not True:
        raise ValueError('Aplicar a persistência aguardada antes da integração comercial.')
    nomes = {n['name'] for n in wf['nodes']}
    novos = {PREPARAR, TEM, SEPARAR, RECEBER, CONFERIR}
    if nomes & novos:
        if not novos <= nomes:
            raise ValueError('Integração comercial parcial; conferir antes de regenerar.')
        http = _no(wf, RECEBER)
        if http['parameters'].get('url') != endpoint or http.get('credentials') != credencial_crm:
            raise ValueError('Integração existente usa outro endpoint/credencial; alteração exige revisão explícita.')
        return wf
    saidas = wf.get('connections', {}).get(persistir['name'], {}).get('main', [])
    arestas = [d for s in saidas for d in s if d['node'] == 'Responder ao observador']
    if len(arestas) != 1:
        raise ValueError('Recibo original não é sucessor único da persistência; conferir grafo.')
    if any(n.get('id') in {'comercial-preparar', 'comercial-tem', 'comercial-separar', 'comercial-receber', 'comercial-conferir'} for n in wf['nodes']):
        raise ValueError('Identificador de nó comercial já ocupado.')
    arestas[0]['node'] = PREPARAR  # conserva todas as demais arestas/ramos
    wf['nodes'] += [
        _code('comercial-preparar', PREPARAR, PREPARAR_JS, 1800),
        {'id': 'comercial-tem', 'name': TEM, 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2,
         'position': [2020, -100], 'parameters': {'conditions': {'options': {'typeValidation': 'strict', 'version': 2}, 'combinator': 'and', 'conditions': [{'id': 'tem-envelope', 'leftValue': '={{ $json.eventos.length > 0 }}', 'rightValue': '', 'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}]}, 'options': {}}},
        _code('comercial-separar', SEPARAR, SEPARAR_JS, 2240),
        {'id': 'comercial-receber', 'name': RECEBER, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2,
         'position': [2460, -100], 'retryOnFail': False, 'credentials': copy.deepcopy(credencial_crm),
         'parameters': {'method': 'POST', 'url': endpoint, 'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth',
                        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ $json }}',
                        'options': {'timeout': 15000, 'response': {'response': {'fullResponse': True, 'responseFormat': 'json', 'neverError': False}}}}},
        _code('comercial-conferir', CONFERIR, CONFERIR_JS, 2680),
    ]
    con = wf['connections']
    for a, b in [(PREPARAR, TEM), (SEPARAR, RECEBER), (RECEBER, CONFERIR), (CONFERIR, 'Responder ao observador')]:
        con[a] = {'main': [[_destino(b)]]}
    con[TEM] = {'main': [[_destino(SEPARAR)], [_destino('Responder ao observador')]]}
    return wf


def preparar(workflow, *, endpoint=None, credencial_crm=None):
    nome, id_ = workflow.get('name'), workflow.get('id')
    if nome == CRM_NOME and id_ in (None, CRM_ID):
        return proteger_crm(workflow)
    if nome == RESPOSTA_NOME and id_ in (None, RESPOSTA_ID):
        return integrar_respostas(workflow, endpoint, credencial_crm)
    return copy.deepcopy(workflow)
