"""Transformação pura da posse exclusiva dos três caçadores.

A guarda envolve apenas o núcleo após os gatilhos/contexto Prumo e aguarda todas
as ramificações. Não muda critérios, IDs, settings ou estado ativo. A ausência
inicial da configuração mantém compatibilidade; um fluxo já protegido nunca é
publicado sem a configuração válida. O cliente n8n aplica esta etapa por último.
"""
import copy
import json
import re
from pathlib import Path

NOMES = frozenset(('01 · Caçador', 'PRUMO · Iris — Caçador de clínicas',
                  'PRUMO · CRM de estamparia — Caçador de estamparias'))
PREFIXO = 'aquisicao-guarda-'
CLAIM = 'Reservar aquisição exclusiva'
IF = 'Posse da aquisição confirmada?'
CORE = 'Executar aquisição reservada'
RELEASE = 'Concluir posse da aquisição'
ENTRADA = 'Iniciar aquisição reservada'
CONTEXTO = 'Prumo · organização · Iniciar aquisição reservada'


def cfg_valida(c):
    if (not isinstance(c, dict) or set(c) != {'v', 'enabled', 'url', 'credentialId', 'credentialName'}
            or type(c['v']) is not int or c['v'] != 1 or c['enabled'] is not True
            or c['url'] != 'http://172.23.0.1:8791'
            or not isinstance(c['credentialId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', c['credentialId'])
            or not isinstance(c['credentialName'], str) or not 1 <= len(c['credentialName']) <= 100):
        raise ValueError('Configuração da guarda de aquisição inválida; nenhuma publicação.')
    return c


def protegido(wf):
    return any(n.get('id') == PREFIXO + 'executar' for n in wf.get('nodes', []))


def destinos(nome):
    return {'main': [[{'node': nome, 'type': 'main', 'index': 0}]]}


def unico_destino(con, nome):
    v = con.get(nome)
    if (not isinstance(v, dict) or set(v) != {'main'} or len(v['main']) != 1 or len(v['main'][0]) != 1
            or v['main'][0][0].get('type') != 'main' or v['main'][0][0].get('index') != 0):
        raise ValueError('Entrada do caçador fora do contrato da guarda.')
    return v['main'][0][0]['node']


def desembrulhar(wf):
    if not protegido(wf): return copy.deepcopy(wf)
    if wf.get('name') not in NOMES: raise ValueError('Guarda em workflow não autorizado.')
    out = copy.deepcopy(wf)
    caller = next(n for n in out['nodes'] if n.get('id') == PREFIXO + 'executar')
    try: child = json.loads(caller['parameters']['workflowJson'])
    except (KeyError, ValueError, TypeError) as e: raise ValueError('Núcleo reservado inválido.') from e
    own = {n['name'] for n in out['nodes'] if str(n.get('id', '')).startswith(PREFIXO)}
    if own != {CLAIM, IF, CORE, RELEASE}: raise ValueError('Guarda estruturalmente divergente.')
    entry = unico_destino(child['connections'], ENTRADA)
    if entry == CONTEXTO: entry = unico_destino(child['connections'], CONTEXTO)
    outside = [n for n in out['nodes'] if n['name'] not in own]
    if any(n.get('type', '').split('.')[-1] not in ('manualTrigger', 'scheduleTrigger')
           and not str(n.get('id', '')).startswith('prumo-organizacao-') for n in outside):
        raise ValueError('Nó externo inesperado na guarda; conferir antes de publicar.')
    core_nodes = [n for n in child['nodes'] if not str(n.get('id', '')).startswith(PREFIXO) and n.get('id') != 'prumo-organizacao-' + PREFIXO + 'entrada']
    core_names = {n['name'] for n in core_nodes}
    if entry not in core_names: raise ValueError('Entrada reservada ausente.')
    out['nodes'] = outside + core_nodes
    con = {k: copy.deepcopy(v) for k, v in child['connections'].items() if k in core_names}
    for n in outside:
        if n['name'] in out['connections']:
            val = copy.deepcopy(out['connections'][n['name']])
            for outputs in val.values():
                for branch in outputs:
                    for d in branch:
                        if d['node'] == CLAIM: d['node'] = entry
            con[n['name']] = val
    out['connections'] = con
    return out


def preparar(wf, config):
    if wf.get('name') not in NOMES: return copy.deepcopy(wf)
    c = cfg_valida(config)
    out = desembrulhar(wf)
    nodes = out.get('nodes', []); byname = {n['name']: n for n in nodes}; con = out.get('connections', {})
    if len(byname) != len(nodes): raise ValueError('Nós duplicados na aquisição.')
    triggers = [n for n in nodes if n.get('type', '').split('.')[-1] in ('manualTrigger', 'scheduleTrigger')]
    if not triggers or any(n.get('type', '').split('.')[-1].endswith('Trigger') and n not in triggers for n in nodes):
        raise ValueError('Gatilhos da aquisição fora do contrato.')
    frontier = {n['name'] for n in triggers}; entries = set(); contexts = []
    for t in triggers:
        current = unico_destino(con, t['name']); visited = set()
        while current in byname and str(byname[current].get('id', '')).startswith('prumo-organizacao-'):
            if current in visited: raise ValueError('Ciclo no contexto da aquisição.')
            visited.add(current); frontier.add(current); contexts.append(byname[current]); current = unico_destino(con, current)
        entries.add(current)
    if len(entries) != 1: raise ValueError('Aquisição exige uma entrada comum após contexto.')
    entry = entries.pop()
    if (entry not in byname or byname[entry].get('type') != 'n8n-nodes-base.googleSheets'
            or byname[entry].get('parameters', {}).get('operation', 'read') != 'read'):
        raise ValueError('Primeira operação deve ser a leitura de aquisição existente.')
    core = [copy.deepcopy(n) for n in nodes if n['name'] not in frontier]
    def conferir_espera(nos):
        for no in nos:
            tipo = no.get('type', '')
            if tipo == 'n8n-nodes-base.wait':
                raise ValueError('Aquisição não pode suspender e liberar posse por espera.')
            if tipo == 'n8n-nodes-base.executeWorkflow' and no.get('parameters', {}).get('options', {}).get('waitForSubWorkflow') is not True:
                raise ValueError('Subaquisição deve aguardar todos os ramos.')
            if tipo == 'n8n-nodes-base.googleSheets' and no.get('parameters', {}).get('operation', 'read') != 'read':
                if no.get('continueOnFail') or no.get('onError') not in (None, 'stopWorkflow'):
                    raise ValueError('Persistência incerta deve manter a posse fechada.')
            filho = no.get('parameters', {}).get('workflowJson')
            if isinstance(filho, str):conferir_espera(json.loads(filho).get('nodes', []))
    conferir_espera(core)
    core_names = {n['name'] for n in core}
    connections = {k: copy.deepcopy(v) for k, v in con.items() if k in core_names}
    trigger = {'id': PREFIXO + 'entrada', 'name': ENTRADA, 'type': 'n8n-nodes-base.executeWorkflowTrigger',
               'typeVersion': 1.1, 'position': [-300, 0], 'parameters': {'inputSource': 'passthrough'}}
    core.insert(0, trigger)
    if contexts:
        ctx = copy.deepcopy(contexts[0]); ctx.update({'id': 'prumo-organizacao-' + PREFIXO + 'entrada', 'name': CONTEXTO, 'position': [-100, 0]})
        core.insert(1, ctx); connections[ENTRADA] = destinos(CONTEXTO); connections[CONTEXTO] = destinos(entry)
    else: connections[ENTRADA] = destinos(entry)
    child = {'name': out['name'], 'nodes': core, 'connections': connections,
             'settings': {k: v for k, v in out.get('settings', {}).items() if k in ('executionOrder', 'timezone')}}
    # Os critérios e estado estático original continuam no núcleo. Contexto Prumo
    # é reinjetado também nele, pois cada inline tem seu próprio escopo global.
    if 'staticData' in out: child['staticData'] = copy.deepcopy(out['staticData'])
    original_frontier = [copy.deepcopy(n) for n in nodes if n['name'] in frontier]
    outer_con = {k: copy.deepcopy(v) for k, v in con.items() if k in frontier}
    for val in outer_con.values():
        for outputs in val.values():
            for branch in outputs:
                for d in branch:
                    if d['node'] == entry: d['node'] = CLAIM
    def http(id_, name, action, body, position):
        return {'id': PREFIXO + id_, 'name': name, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2,
                'position': position, 'executeOnce': True, 'retryOnFail': False,
                'credentials': {'httpHeaderAuth': {'id': c['credentialId'], 'name': c['credentialName']}},
                'parameters': {'method': 'POST', 'url': c['url'] + action, 'authentication': 'genericCredentialType',
                               'genericAuthType': 'httpHeaderAuth', 'sendBody': True, 'contentType': 'json',
                               'specifyBody': 'json', 'jsonBody': body, 'options': {'timeout': 15000}}}
    claim_body = '={{ { workflow: $workflow.name, execution: String($execution.id) } }}'
    release_body = "={{ { workflow: $workflow.name, execution: String($execution.id), token: $('" + CLAIM + "').first().json.token } }}"
    gate = {'id': PREFIXO + 'confirmar', 'name': IF, 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2,
            'position': [380, 0], 'parameters': {'conditions': {'options': {'caseSensitive': True,
            'leftValue': '', 'typeValidation': 'strict', 'version': 2}, 'combinator': 'and',
            'conditions': [{'id': 'acquired', 'leftValue': '={{ $json.acquired }}',
                            'rightValue': True, 'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}]}, 'options': {}}}
    call = {'id': PREFIXO + 'executar', 'name': CORE, 'type': 'n8n-nodes-base.executeWorkflow', 'typeVersion': 1.3,
            'position': [600, -100], 'alwaysOutputData': True, 'retryOnFail': False,
            'parameters': {'source': 'parameter', 'mode': 'once', 'workflowJson': json.dumps(child, ensure_ascii=False),
                           'options': {'waitForSubWorkflow': True}}}
    out['nodes'] = original_frontier + [http('claim', CLAIM, '/claim', claim_body, [160, 0]), gate, call,
                                          http('release', RELEASE, '/release', release_body, [820, -100])]
    outer_con[CLAIM] = destinos(IF)
    outer_con[IF] = {'main': [[{'node': CORE, 'type': 'main', 'index': 0}], []]}
    outer_con[CORE] = destinos(RELEASE)
    out['connections'] = outer_con
    return out


def conferir_escopo(wf):
    """Um clone/publicador auxiliar não pode mudar só o nome para fugir da posse."""
    if wf.get('name') in NOMES: return
    def nomes(w):
        result=set()
        for n in w.get('nodes',[]):
            result.add(n.get('name'))
            child=n.get('parameters',{}).get('workflowJson')
            if isinstance(child,str):
                try:result.update(nomes(json.loads(child)))
                except (ValueError,TypeError):pass
        return result
    names = nomes(wf)
    if (protegido(wf) or {'Triar e checar sites', 'Buscar no Google Places'}.issubset(names)
            or {'Não está na planilha', 'Salvar lead na planilha'}.issubset(names)):
        raise ValueError('Aquisição fora dos três workflows reservados; clone/publicação recusado.')

def preparar_se_configurado(wf, obrigatoria=False, arquivo=None):
    conferir_escopo(wf)
    if wf.get('name') not in NOMES: return wf
    path = Path(arquivo) if arquivo is not None else Path.home() / '.config/claude-ops/workflow-aquisicao.json'
    if not path.exists():
        if obrigatoria or protegido(wf): raise ValueError('Guarda existente sem configuração; publicação recusada.')
        return wf
    try: config = cfg_valida(json.loads(path.read_text(encoding='utf-8')))
    except (ValueError, UnicodeError) as e: raise ValueError('Configuração da guarda ilegível; publicação recusada.') from e
    return preparar(wf, config)