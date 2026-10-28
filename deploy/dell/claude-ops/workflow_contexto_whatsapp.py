"""Contexto WhatsApp comum, puro e fresco: um Sheets por fonte (quatro com Iris e estampa), sem cache.

Move as leituras e o Code consumidor para um subfluxo aguardado. O nome do
consumidor fica no pai: referências e shapes legados continuam iguais, sem
proxy de `$`, novo banco ou inferência. Não publica nem executa nada.

Hook futuro: depois de workflow_confiabilidade e antes de prumo_contexto,
para que o contexto canônico seja injetado também no trigger interno.
"""
import copy
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ofertas as registro  # noqa: E402

# Prospects, Leads do site e uma aba por oferta do registro (prumo-ofertas.json), na ordem dele. Era a
# tupla escrita ('Ler Prospects', 'Ler Leads do site', 'Ler Clínicas', 'Ler Estamparias') até 28/10/2026:
# uma 5ª aba ficava fora da guarda de completude, e o fluxo podia confirmar "não é lead" sem tê-la lido.
# Para Iris e estampa o resultado é o mesmo, e o GUARDA_JS publicado também.
LEITURAS = ('Ler Prospects', 'Ler Leads do site', *registro.leituras())
_QUANTAS = {4: 'Quatro', 5: 'Cinco', 6: 'Seis', 7: 'Sete', 8: 'Oito', 9: 'Nove', 10: 'Dez'}
MARCA = '[contexto-whatsapp-fontes-v1]'
GUARDA = 'Contexto WhatsApp: conferir fontes'
ESPECIFICACOES = {
    'IiuekGDVnjFaZpD1': ('WhatsApp — resposta de lead (classifica)', 'Resposta no WhatsApp', 'Montar pergunta'),
    'fd8gz4uDQkJtEd9W': ('WhatsApp — conversa com lead (marca sozinho)', 'Conversa no WhatsApp', 'Decidir'),
    'AGqVS4KoeqGqdey5': ('WhatsApp — números dos leads (para o observador)', 'Observador pede os números', 'Montar chaves'),
}
GUARDA_JS = """// [contexto-whatsapp-fontes-v1] Falha de uma fonte nunca significa não-lead.
for (const nome of %s) {
  const itens = $(nome).all(); // nó ausente/não executado também falha fechado
  if (!Array.isArray(itens) || itens.some(i => !i || !i.json || typeof i.json !== 'object' || Array.isArray(i.json) || i.json.error)) throw new Error('Contexto WhatsApp incompleto: ' + nome);
}
return $input.all();""" % json.dumps(LEITURAS, ensure_ascii=False)


def _no(wf, nome):
    achados = [n for n in wf.get('nodes', []) if n.get('name') == nome]
    if len(achados) != 1:
        raise ValueError('Contexto WhatsApp exige nó único: ' + nome)
    return achados[0]


def _especificacao(wf):
    id_ = wf.get('id')
    if id_ is not None:
        spec = ESPECIFICACOES.get(id_)
        return spec if spec and wf.get('name') == spec[0] else None
    return next((s for s in ESPECIFICACOES.values() if s[0] == wf.get('name')), None)


def _arestas(conexoes):
    for origem, tipos in conexoes.items():
        for tipo, saidas in tipos.items():
            for indice, destinos in enumerate(saidas):
                for destino in destinos:
                    yield origem, tipo, indice, destino


def _destino(nome):
    return {'node': nome, 'type': 'main', 'index': 0}


def _textos(valor):
    if isinstance(valor, str):
        yield valor
    elif isinstance(valor, dict):
        for v in valor.values():
            yield from _textos(v)
    elif isinstance(valor, list):
        for v in valor:
            yield from _textos(v)


def _referencias(parametros):
    encontrados = set()
    for texto in _textos(parametros):
        for padrao in (r'''\$\(\s*(['"])(.*?)\1\s*\)''', r'''\$node\[\s*(['"])(.*?)\1\s*\]''', r'''\$items\(\s*(['"])(.*?)\1\s*[,)]'''):
            encontrados.update(m.group(2) for m in re.finditer(padrao, texto))
    return encontrados


def _conexoes_filho(gatilho, consumidor, organizacao=None):
    con = {gatilho: {'main': [[_destino(organizacao or LEITURAS[0])]]}}
    if organizacao:
        con[organizacao] = {'main': [[_destino(LEITURAS[0])]]}
    for a, b in zip(LEITURAS, (*LEITURAS[1:], GUARDA)):
        con[a] = {'main': [[_destino(b)]]}
    con[GUARDA] = {'main': [[_destino(consumidor)]]}
    return con


def _ja_preparado(wf, final, gatilho):
    if MARCA not in final.get('notes', ''):
        return False
    p = final.get('parameters', {})
    if final.get('type') != 'n8n-nodes-base.executeWorkflow' or p.get('source') != 'parameter' or p.get('options', {}).get('waitForSubWorkflow') is not True:
        raise ValueError('Subfluxo de contexto comercial modificado: revisar antes de publicar.')
    if final.get('disabled'):
        raise ValueError('Chamada de contexto desabilitada.')
    try:
        filho = json.loads(p['workflowJson'])
        for nome in (*LEITURAS, GUARDA, gatilho):
            _no(filho, nome)
        folha = _no(filho, final['name'])
        organizacao = 'Prumo · organização · ' + gatilho
        esperados = {gatilho, *LEITURAS, GUARDA, final['name']}
        if any(n.get('name') == organizacao for n in filho['nodes']):
            org = _no(filho, organizacao)
            if org.get('id') != 'prumo-organizacao-contexto-wpp-entrada' or org.get('type') != 'n8n-nodes-base.code':
                raise ValueError('Contexto canônico interno modificado.')
            if org.get('disabled') or org.get('onError') not in (None, 'stopWorkflow') or org.get('continueOnFail'):
                raise ValueError('Contexto canônico interno não pode ser ignorado.')
            esperados.add(organizacao)
        else:
            organizacao = None
        if {n.get('name') for n in filho['nodes']} != esperados or len(filho['nodes']) != len(esperados):
            raise ValueError('Subfluxo contém nó inesperado; não permitir modelos ou escrita.')
        if filho.get('connections') != _conexoes_filho(gatilho, final['name'], organizacao):
            raise ValueError('Subfluxo de contexto tem desvio ou ignora alguma fonte/guarda.')
        for nome in LEITURAS:
            leitura = _no(filho, nome)
            if leitura.get('type') != 'n8n-nodes-base.googleSheets' or leitura.get('parameters', {}).get('operation', 'read') != 'read' or leitura.get('onError') not in (None, 'stopWorkflow') or leitura.get('continueOnFail') or leitura.get('disabled'):
                raise ValueError('Fonte de contexto deixou de falhar fechado.')
        if _no(filho, GUARDA).get('parameters', {}).get('jsCode') != GUARDA_JS or final.get('alwaysOutputData') or final.get('onError') not in (None, 'stopWorkflow') or final.get('continueOnFail'):
            raise ValueError('Guarda de contexto modificada.')
        if _no(filho, gatilho).get('type') != 'n8n-nodes-base.executeWorkflowTrigger':
            raise ValueError('Entrada de contexto modificada.')
        if folha.get('type') != 'n8n-nodes-base.code' or not isinstance(folha.get('parameters', {}).get('jsCode'), str):
            raise ValueError('Consumidor de contexto ausente.')
        for nome in (GUARDA, final['name'], gatilho):
            node = _no(filho, nome)
            if node.get('disabled') or node.get('onError') not in (None, 'stopWorkflow') or node.get('continueOnFail'):
                raise ValueError('Entrada/guarda/consumidor não pode ser ignorado.')
        if _no(filho, gatilho).get('parameters') != {'inputSource': 'passthrough'}:
            raise ValueError('Entrada de contexto deve preservar o pedido integral.')
        assinatura = hashlib.sha256(folha['parameters']['jsCode'].encode()).hexdigest()
        if 'consumidorSHA256=' + assinatura not in final.get('notes', ''):
            raise ValueError('Código consumidor difere da assinatura preservada.')
        for n in [*[_no(filho, nome) for nome in LEITURAS], folha]:
            if _referencias(n.get('parameters', {})) - esperados:
                raise ValueError('Subfluxo depende de nó que não está disponível no filho.')
        if any(n.get('name') in LEITURAS for n in wf['nodes']):
            raise ValueError('Leituras duplicadas no pai e no filho.')
    except (KeyError, TypeError, json.JSONDecodeError) as erro:
        raise ValueError('Subfluxo de contexto inválido.') from erro
    return True


def preparar(workflow):
    """Retorna cópia, conservando active/settings/credenciais/grafos não relacionados.

    Somente as quatro leituras mudam de escopo. Sua opção de tolerar falha é
    retirada explicitamente: contexto parcial não pode gerar ACK de não-lead.
    """
    spec = _especificacao(workflow)
    if spec is None:
        return copy.deepcopy(workflow)
    _, gatilho, consumidor = spec
    wf = copy.deepcopy(workflow)
    final = _no(wf, consumidor)
    _no(wf, gatilho)
    if _ja_preparado(wf, final, gatilho):
        return wf
    if final.get('type') != 'n8n-nodes-base.code' or not isinstance(final.get('parameters', {}).get('jsCode'), str):
        raise ValueError('Consumidor não é o Code esperado: ' + consumidor)
    if final.get('disabled'):
        raise ValueError('Consumidor de contexto desabilitado; manter estado e revisar.')
    if final.get('onError') not in (None, 'stopWorkflow') or final.get('continueOnFail'):
        raise ValueError('Consumidor de contexto deve falhar fechado.')
    leituras = [_no(wf, nome) for nome in LEITURAS]
    for n in leituras:
        p = n.get('parameters', {})
        if n.get('type') != 'n8n-nodes-base.googleSheets' or p.get('operation', 'read') != 'read' or n.get('disabled'):
            raise ValueError('Fonte de contexto não é leitura ativa de Sheets: ' + n['name'])
    sequencia = [*LEITURAS, consumidor]
    for origem, destino in zip(sequencia, sequencia[1:]):
        if wf.get('connections', {}).get(origem) != {'main': [[_destino(destino)]]}:
            raise ValueError('Cadeia de contexto mudou: ' + origem)
    internas = set(LEITURAS)
    entradas = []
    for origem, tipo, indice, destino in _arestas(wf.get('connections', {})):
        alvo = destino.get('node')
        if origem not in internas and alvo in internas | {consumidor}:
            if alvo != LEITURAS[0] or tipo != 'main' or indice != 0 or destino.get('index') != 0:
                raise ValueError('Entrada alternativa no contexto; revisar grafo.')
            entradas.append(destino)
    if not entradas:
        raise ValueError('Contexto sem entrada; não criar conexão implícita.')
    # Expressões de outros nós não podem perder o acesso aos leitores movidos.
    for n in wf['nodes']:
        if n['name'] in internas | {consumidor}:
            continue
        if _referencias(n.get('parameters', {})) & internas:
            raise ValueError('Outro nó depende diretamente da leitura movida: ' + n['name'])
    disponiveis_filho = {gatilho, *LEITURAS, GUARDA, consumidor}
    for n in [*leituras, final]:
        if _referencias(n.get('parameters', {})) - disponiveis_filho:
            raise ValueError('Consumidor/leitura depende de nó indisponível no subfluxo: ' + n['name'])
    trigger = {'id': 'contexto-wpp-entrada', 'name': gatilho, 'type': 'n8n-nodes-base.executeWorkflowTrigger',
               'typeVersion': 1.1, 'position': [-220, 0], 'parameters': {'inputSource': 'passthrough'}}
    guarda = {'id': 'contexto-wpp-guarda', 'name': GUARDA, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
              'position': [1100, 0], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': GUARDA_JS}}
    filho_nos = [trigger]
    for i, n in enumerate(leituras):
        copia = copy.deepcopy(n)
        copia.pop('onError', None)  # erro deve propagar; nunca continuar com fonte parcial
        copia.pop('continueOnFail', None)
        copia['position'] = [i * 240, 0]
        filho_nos.append(copia)
    filho_nos += [guarda, copy.deepcopy(final)]
    filho_nos[-1]['position'] = [1340, 0]
    if len({n['id'] for n in filho_nos}) != len(filho_nos) or len({n['name'] for n in filho_nos}) != len(filho_nos):
        raise ValueError('Identidade de nó duplicada no subfluxo de contexto.')
    filho_con = _conexoes_filho(gatilho, consumidor)
    filho = {'name': wf['name'] + ' — contexto fresco', 'nodes': filho_nos, 'connections': filho_con,
             'settings': {'executionOrder': 'v1', 'timezone': wf.get('settings', {}).get('timezone', 'America/Sao_Paulo')}}
    chamada = {k: copy.deepcopy(v) for k, v in final.items() if k not in ('type', 'typeVersion', 'parameters', 'credentials', 'alwaysOutputData', 'onError', 'continueOnFail', 'retryOnFail', 'maxTries', 'waitBetweenTries')}
    chamada.update(type='n8n-nodes-base.executeWorkflow', typeVersion=1.3, retryOnFail=False,
                   notes=(final.get('notes', '') + '\n' + MARCA + ' consumidorSHA256=' + hashlib.sha256(final['parameters']['jsCode'].encode()).hexdigest() + ' ' + _QUANTAS.get(len(LEITURAS), str(len(LEITURAS))) + ' Sheets frescos; sem cache ou redução de chamadas.').strip(),
                   parameters={'source': 'parameter', 'mode': 'once', 'workflowJson': json.dumps(filho, ensure_ascii=False), 'options': {'waitForSubWorkflow': True}})
    wf['nodes'] = [chamada if n['name'] == consumidor else n for n in wf['nodes'] if n['name'] not in internas]
    for entrada in entradas:
        entrada['node'] = consumidor
    for nome in LEITURAS:
        wf['connections'].pop(nome)
    return wf
