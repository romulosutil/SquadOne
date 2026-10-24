"""Contrato auditável dos adaptadores de aquisição, sem executor ou acesso à rede.

O motor existente Iris/Estampa é parametrizado em prumo-ofertas.py. O Site
continua legado e tem verificações próprias. Este módulo descreve/verifica
fronteiras; não substitui suas regras, não decide cadência e não ativa nada.
"""
import copy
import json

ETAPAS = ('busca', 'normalizacao', 'identificacaoDedupe', 'criterios', 'persistencia')


def contrato_oferta(config, oferta):
    """Uma oferta nova usa a fábrica existente; não exige cópia de workflow."""
    try:
        o = config['ofertas'][oferta]
        obrigatorios = ('rotulo', 'aba', 'fluxo', 'plural', 'segmento', 'fora', 'perfil',
                        'perfil_motivo', 'fora_sem_perfil', 'fora_sem_perfil_motivo',
                        'convite', 'proxima_enviado', 'mensagem')
        if any(not isinstance(o.get(k), str) or not o[k].strip() for k in obrigatorios):
            raise ValueError('Configuração de oferta incompleta.')
        if type(o.get('teto_por_rodada')) is not int or o['teto_por_rodada'] <= 0:
            raise ValueError('Teto por rodada deve ser inteiro positivo explícito.')
        for k in ('nichos', 'cidades'):
            if not isinstance(o.get(k), list) or not o[k] or any(not isinstance(s, str) or not s.strip() for s in o[k]):
                raise ValueError('Busca exige nichos e cidades explícitos.')
        if not isinstance(o.get('sinais'), list) or any(not isinstance(s, list) or len(s) != 2 or any(not isinstance(v, str) or not v for v in s) for s in o['sinais']):
            raise ValueError('Sinais de oferta inválidos.')
        for k in ('colunas', 'descartados'):
            if not isinstance(config.get(k), list) or len(set(config[k])) != len(config[k]) or not config[k]:
                raise ValueError('Contrato de colunas inválido.')
        for campo in ('ID', 'Empresa', 'WhatsApp', 'Etapa', 'Busca'):
            if campo not in config['colunas']: raise ValueError('Coluna de identidade/jornada ausente.')
        if 'ID' not in config['descartados'] or 'Motivo' not in config['descartados']:
            raise ValueError('Descarte precisa preservar identidade e motivo.')
        abas = [v['aba'] for v in config['ofertas'].values()]
        fluxos = [v['fluxo'] for v in config['ofertas'].values()]
        if len(abas) != len(set(abas)) or len(fluxos) != len(set(fluxos)):
            raise ValueError('Ofertas não podem compartilhar aba ou identidade de workflow.')
    except (KeyError, TypeError) as erro:
        raise ValueError('Configuração de aquisição inválida.') from erro
    leitores = [f"Ler {o['aba']}", *[f"Ler {v['aba']}" for k, v in config['ofertas'].items() if k != oferta],
                'Ler Descartados', 'Ler Prospects', 'Ler Leads do Site']
    return {'v': 1, 'oferta': oferta, 'adaptador': 'prumo-ofertas-v1', 'workflow': o['fluxo'],
            'etapas': {'busca': ['Escolher a busca', 'Buscar no Google Places'],
                       'normalizacao': ['Triar e checar sites'], 'identificacaoDedupe': ['Triar e checar sites'],
                       'criterios': ['Triar e checar sites', 'É prospect?'],
                       'persistencia': [f"Gravar na aba {o['aba']}", 'Gravar em Descartados']},
            'leiturasDedupe': leitores, 'tetoPorRodada': o['teto_por_rodada'],
            'identidade': ['place_id', 'whatsapp-legado-ddd-ultimos8'],
            'colunas': copy.deepcopy(config['colunas']), 'colunasDescarte': copy.deepcopy(config['descartados']),
            'geracaoCompleta': True, 'ativacaoAutorizada': False}


def contrato_site_legado():
    """Fronteiras do Site preservadas; não afirma possuir uma fábrica completa."""
    return {'v': 1, 'oferta': 'site', 'adaptador': 'site-legado-v1', 'workflow': '01 · Caçador',
            'etapas': {'busca': ['Escolher a busca', 'Montar área da busca', 'Buscar no Google Places'],
                       'normalizacao': ['Normalizar campos'], 'identificacaoDedupe': ['Não está na planilha'],
                       'criterios': ['Dentro do raio', 'Tem telefone', '5+ avaliações', 'Não é rede/franquia',
                                    'Portão', 'Checar site próprio', 'Site no ar?', 'Pontuar', 'Aprovado?'],
                       'persistencia': ['Salvar lead na planilha', 'Salvar descartado na planilha', 'Entregar content.md', 'Entregar foto']},
            'leiturasDedupe': ['Ler leads existentes'], 'identidade': ['place_id', 'normalizacao-legada-site'],
            'geracaoCompleta': False, 'ativacaoAutorizada': False}


def _nos(workflow):
    """Percorre inline sem desembrulhar/reconectar nem alterar o export."""
    for n in workflow.get('nodes', []):
        yield n
        filho = n.get('parameters', {}).get('workflowJson')
        if isinstance(filho, str):
            try: yield from _nos(json.loads(filho))
            except (ValueError, TypeError) as erro: raise ValueError('Subworkflow de aquisição inválido.') from erro


def auditar_adaptador(workflow, contrato):
    """Verifica componentes e operações; não certifica comportamento/conversão.

    Riscos do legado são explícitos. Resultado nunca concede ativação. Não
    retorna códigos, contatos, credenciais ou os parâmetros das planilhas.
    """
    if (type(contrato.get('v')) is not int or contrato['v'] != 1 or set(contrato.get('etapas', {})) != set(ETAPAS)
            or contrato.get('adaptador') not in ('prumo-ofertas-v1', 'site-legado-v1')
            or workflow.get('name') != contrato.get('workflow')):
        raise ValueError('Contrato/adaptador não corresponde ao workflow.')
    nodes = list(_nos(workflow)); por_nome = {}
    for n in nodes: por_nome.setdefault(n.get('name'), []).append(n)
    def unico(nome):
        achados = por_nome.get(nome, [])
        if len(achados) != 1 or achados[0].get('disabled'):
            raise ValueError('Componente esperado ausente, duplicado ou desabilitado.')
        return achados[0]
    for nomes in contrato['etapas'].values():
        for nome in nomes: unico(nome)
    riscos = []
    for nome in contrato['leiturasDedupe']:
        n = unico(nome)
        if n.get('type') != 'n8n-nodes-base.googleSheets' or n.get('parameters', {}).get('operation', 'read') != 'read':
            raise ValueError('Dedupe exige leitura de fonte declarada.')
        if n.get('continueOnFail') or n.get('onError') not in (None, 'stopWorkflow'):
            riscos.append('leitura-dedupe-tolerante')
    for nome in contrato['etapas']['persistencia']:
        n = unico(nome); p = n.get('parameters', {})
        esperado = 'write' if nome in ('Entregar content.md', 'Entregar foto') else 'append'
        tipo = 'n8n-nodes-base.readWriteFile' if esperado == 'write' else 'n8n-nodes-base.googleSheets'
        if n.get('type') != tipo or p.get('operation') != esperado:
            raise ValueError('Destino de persistência fora do contrato.')
        if n.get('retryOnFail'): riscos.append('persistencia-com-retry-requer-recibo')
    busca = unico('Buscar no Google Places')
    if busca.get('type') != 'n8n-nodes-base.httpRequest' or busca.get('parameters', {}).get('url') != 'https://places.googleapis.com/v1/places:searchText':
        raise ValueError('Provedor de busca fora do contrato.')
    return {'v': 1, 'adaptador': contrato['adaptador'], 'componentesPresentes': True,
            'geracaoCompleta': contrato['geracaoCompleta'], 'riscosLegados': sorted(set(riscos)),
            'estadoAtivoPreservado': workflow.get('active'), 'ativacaoAutorizada': False}
