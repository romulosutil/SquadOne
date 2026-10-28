"""Contrato auditável dos adaptadores de aquisição, sem executor ou acesso à rede.

O motor existente Iris/Estampa é parametrizado em prumo-ofertas.py. O Site
continua legado e tem verificações próprias. Este módulo descreve/verifica
fronteiras; não substitui suas regras, não decide cadência e não ativa nada.
"""
import copy
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ofertas as registro  # noqa: E402

ETAPAS = ('busca', 'normalizacao', 'identificacaoDedupe', 'criterios', 'persistencia')
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
SALA = re.compile(r'^prumo--[a-z0-9]+(?:-[a-z0-9]+)*$')
LINK = re.compile(r'^planilha[A-Z][A-Za-z0-9]*$')
# Nós de leitura que os geradores já usam: "ler-<slug da aba>" de uma oferta não pode cair num deles.
SLUGS_DE_ABA_RESERVADOS = frozenset({'leads', 'prospects', 'crm', 'descartados', 'aba-crm', 'leads-do-site'})


def _unicos(config, campo, msg):
    valores = [v.get(campo) for v in config['ofertas'].values()]
    if len(valores) != len(set(valores)):
        raise ValueError(msg)


def contrato_oferta(config, oferta):
    """Uma oferta nova usa a fábrica existente; não exige cópia de workflow.

    28/10/2026: confere também o que prumo-ofertas.py, crm.py, whatsapp-conversa.py e a Central usam
    de cada oferta (antes um webhook_id repetido ou um convite fora do padrão passavam calados)."""
    try:
        o = config['ofertas'][oferta]
        obrigatorios = ('rotulo', 'aba', 'fluxo', 'plural', 'segmento', 'fora', 'perfil',
                        'perfil_motivo', 'fora_sem_perfil', 'fora_sem_perfil_motivo',
                        'convite', 'proxima_enviado', 'mensagem',
                        'clique', 'webhook_id', 'empresa', 'sigla', 'tipo', 'sala', 'cacador_rotulo', 'fonte', 'link_retrato')
        if any(not isinstance(o.get(k), str) or not o[k].strip() for k in obrigatorios):
            raise ValueError('Configuração de oferta incompleta.')
        if not isinstance(oferta, str) or not registro.ID.fullmatch(oferta) or oferta in registro.RESERVADOS:
            raise ValueError('Id de oferta deve ter 3 a 12 letras minúsculas e não colidir com site, prumo, plus ou o código gerado.')
        if o['aba'] in registro.ABAS_RESERVADAS or registro.slug(o['aba']) in SLUGS_DE_ABA_RESERVADOS:
            raise ValueError('Aba de oferta não pode ser Prospects, Descartados, CRM ou Leads.')
        for k in ('aba', 'rotulo', 'fluxo', 'clique'):
            registro.js_texto(o[k])  # vai literal para o código do n8n: sem aspas, barra ou quebra de linha
        if o['convite'] != 'convite-' + oferta:
            raise ValueError('Convite deve ser "convite-<id>".')
        if not UUID.fullmatch(o['webhook_id']):
            raise ValueError('webhook_id deve ser um UUID em minúsculas.')
        if not o['fluxo'].startswith('PRUMO') or not o['clique'].startswith('PRUMO') or o['fluxo'] == o['clique']:
            raise ValueError('Caçador e clique começam com "PRUMO" (contexto canônico) e têm nomes diferentes.')
        if o['tipo'] != 'propria':
            raise ValueError('Tipo de oferta desconhecido (só "propria").')
        if not SALA.fullmatch(o['sala']):
            raise ValueError('Sala deve ser "prumo--<slug>".')
        if not LINK.fullmatch(o['link_retrato']) or o['link_retrato'] in registro.LINKS_RESERVADOS:
            raise ValueError('link_retrato deve ser "planilha<Nome>" e não pode ser de Site, PRUMO ou CRM.')
        c = o.get('conversa')
        if not isinstance(c, dict) or any(not isinstance(c.get(k), str) or not c[k].strip() for k in ('o_que_foi', 'interesse')):
            raise ValueError('Conversa da oferta exige o_que_foi e interesse.')
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
        nomes = [*fluxos, *[v['clique'] for v in config['ofertas'].values()]]
        if len(nomes) != len(set(nomes)):
            raise ValueError('Ofertas não podem compartilhar aba ou identidade de workflow.')
        if len({registro.slug(a) for a in abas}) != len(abas):
            raise ValueError('Ofertas não podem compartilhar aba ou identidade de workflow.')
        # Dois nós Webhook com o mesmo id colidem no n8n sem aviso.
        _unicos(config, 'webhook_id', 'Ofertas não podem compartilhar webhook_id.')
        for campo in ('sala', 'link_retrato', 'sigla', 'rotulo'):
            _unicos(config, campo, f'Ofertas não podem compartilhar {campo}.')
    except (KeyError, TypeError, AttributeError) as erro:
        raise ValueError('Configuração de aquisição inválida.') from erro
    leitores = [f"Ler {o['aba']}", *[f"Ler {v['aba']}" for k, v in config['ofertas'].items() if k != oferta],
                'Ler Descartados', 'Ler Prospects', 'Ler Leads do Site']
    return {'v': 1, 'oferta': oferta, 'adaptador': 'prumo-ofertas-v1', 'workflow': o['fluxo'],
            'etapas': {'busca': ['Escolher a busca', 'Buscar no Google Places'],
                       'normalizacao': ['Triar e checar sites'], 'identificacaoDedupe': ['Triar e checar sites'],
                       'criterios': ['Triar e checar sites', 'É prospect?'],
                       'persistencia': [f"Gravar na aba {o['aba']}", 'Gravar em Descartados']},
            'leiturasDedupe': leitores, 'tetoPorRodada': o['teto_por_rodada'],
            'chavePersistencia': 'ID', 'identidade': ['place_id', 'whatsapp-legado-ddd-ultimos8'],
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
            'leiturasDedupe': ['Ler leads existentes'], 'chavePersistencia': 'place_id',
            'identidade': ['place_id', 'normalizacao-legada-site'],
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
        arquivo = nome in ('Entregar content.md', 'Entregar foto')
        esperado = 'write' if arquivo else 'appendOrUpdate'
        tipo = 'n8n-nodes-base.readWriteFile' if arquivo else 'n8n-nodes-base.googleSheets'
        if n.get('type') != tipo or p.get('operation') != esperado:
            raise ValueError('Destino de persistência fora do contrato.')
        if not arquivo:
            colunas = p.get('columns', {})
            chave = contrato.get('chavePersistencia')
            schema = colunas.get('schema', [])
            if (not chave or colunas.get('matchingColumns') != [chave]
                    or not any(c.get('id') == chave and c.get('canBeUsedToMatch') for c in schema)):
                raise ValueError('Persistência exige upsert pela identidade durável do prospect.')
            if n.get('retryOnFail'):
                raise ValueError('Upsert de aquisição não pode repetir automaticamente após resultado ambíguo.')
            riscos.append('concorrencia-google-sheets-upsert')
    busca = unico('Buscar no Google Places')
    if busca.get('type') != 'n8n-nodes-base.httpRequest' or busca.get('parameters', {}).get('url') != 'https://places.googleapis.com/v1/places:searchText':
        raise ValueError('Provedor de busca fora do contrato.')
    return {'v': 1, 'adaptador': contrato['adaptador'], 'componentesPresentes': True,
            'geracaoCompleta': contrato['geracaoCompleta'], 'riscosLegados': sorted(set(riscos)),
            'estadoAtivoPreservado': workflow.get('active'), 'ativacaoAutorizada': False}
