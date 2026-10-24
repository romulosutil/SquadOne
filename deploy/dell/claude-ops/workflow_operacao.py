"""Política operacional pura de pausa: não lê segredo, não publica ou desativa.

O cliente n8n fornece o JSON local opt-in a cada mutação. Uma pausa reserva
ID/nome e bloqueia ativação; editar o workflow existente não remove a reserva.
Configuração ausente mantém o comportamento legado.
"""
import copy
import re
import unicodedata
from urllib.parse import unquote, urlsplit


def _texto(valor, limite):
    return isinstance(valor, str) and 0 < len(valor) <= limite and valor == valor.strip() and not re.search(r'[\x00-\x1f\x7f]', valor)


def _nome(valor):
    return ' '.join(unicodedata.normalize('NFKC', valor).casefold().split()) if isinstance(valor, str) else ''


def validar_config(config):
    """Schema estrito; erro sanitizado antes de qualquer tentativa de mutação."""
    if not isinstance(config, dict) or set(config) != {'v', 'pausados'} or type(config['v']) is not int or config['v'] != 1 or not isinstance(config['pausados'], list):
        raise ValueError('Configuração de operação inválida; nenhuma mutação autorizada.')
    ids, nomes = set(), set()
    for item in config['pausados']:
        if not isinstance(item, dict) or set(item) != {'id', 'nome', 'motivo'} or not _texto(item['id'], 128) or not re.fullmatch(r'[A-Za-z0-9_-]+', item['id']) or not _texto(item['nome'], 200) or not _texto(item['motivo'], 500):
            raise ValueError('Pausa operacional inválida; nenhuma mutação autorizada.')
        normal = _nome(item['nome'])
        if item['id'] in ids or normal in nomes:
            raise ValueError('Pausa operacional duplicada ou ambígua; nenhuma mutação autorizada.')
        ids.add(item['id']); nomes.add(normal)
    return copy.deepcopy(config)


def conferir_pedido(metodo, caminho, corpo=None, *, config=None):
    """None permite; dict é recusa de ativação; colisão de criação/ID levanta.

    Não transforma corpo/grafo/settings, não apaga execução nem desativa algo.
    A guarda é do cliente Python, não substitui ACL administrativa do n8n.
    """
    if config is None:
        return None
    regras = validar_config(config)['pausados']
    metodo = metodo.upper()
    partes = [unquote(p) for p in urlsplit(caminho).path.strip('/').split('/')]
    if not partes or partes[0] != 'workflows':
        return None
    por_id = {r['id']: r for r in regras}
    if metodo == 'DELETE' and len(partes) == 2 and partes[1] in por_id:
        raise ValueError('Pausa operacional preserva o histórico; não excluir o workflow reservado.')
    if metodo == 'POST' and len(partes) == 3 and partes[2] == 'activate' and partes[1] in por_id:
        r = por_id[partes[1]]
        return {'active': False, 'desligado': True, 'operacao': True, 'motivo': r['motivo']}
    criacao = metodo == 'POST' and len(partes) == 1
    edicao = metodo in ('PUT', 'PATCH') and len(partes) == 2
    if not (criacao or edicao):
        return None
    alvo = partes[1] if edicao else None
    nome = corpo.get('name') if isinstance(corpo, dict) else None
    for r in regras:
        reservado = _nome(nome) == _nome(r['nome'])
        # O executor manual existente gera esta cópia e consultava só a pausa legada.
        copia_manual = _nome(nome) == _nome('ZZ rodar agora: ' + r['nome'] + ' (apagar)')
        if criacao and (reservado or copia_manual or isinstance(corpo, dict) and corpo.get('id') == r['id']):
            raise ValueError('Workflow pausado tem ID/nome reservado; não criar outra execução ou cópia.')
        if edicao and (reservado or copia_manual) and alvo != r['id']:
            raise ValueError('Nome de workflow pausado não pode ser aplicado a outro ID.')
        if edicao and alvo == r['id']:
            if not isinstance(corpo, dict) or not reservado or corpo.get('id', alvo) != alvo:
                raise ValueError('Identidade do workflow pausado diverge; preservar ID e nome originais.')
            if corpo.get('active') not in (None, False):
                raise ValueError('Workflow pausado não pode ser ativado pelo corpo da edição.')
    return None
