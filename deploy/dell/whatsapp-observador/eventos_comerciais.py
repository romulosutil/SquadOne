"""Envelopes PRUMO puros a partir da linha JSONL preservada, nunca do recorte do modelo.

Não lê arquivos/ambiente, não gera ID, não envia e não inclui texto na saída.
"""
import hashlib
import re
from datetime import datetime


def _instante(valor):
    if not isinstance(valor, str):
        return None
    try:
        dt = datetime.fromisoformat(valor.replace('Z', '+00:00'))
        return dt if dt.tzinfo is not None else None
    except ValueError:
        return None


def envelope_prumo(conversa, linha, recebido_em, *, tipo='resposta'):
    """None = metadados insuficientes; jamais cria identidade/horário substitutos."""
    if not isinstance(linha, dict) or linha.get('origem') != 'prumo' or not isinstance(conversa, str) or not re.fullmatch(r'[1-9][0-9]{9}', conversa):
        return None
    id_ = linha.get('id')
    if not isinstance(id_, str) or not id_ or len(id_) > 200 or id_.strip() != id_ or any(ord(c) < 32 for c in id_):
        return None
    ocorrido, recebido = _instante(linha.get('em')), _instante(recebido_em)
    if ocorrido is None or recebido is None or recebido < ocorrido or linha.get('direcao') not in ('entrada', 'saida') or tipo not in ('resposta', 'mensagem', 'entrega', 'leitura'):
        return None
    if tipo == 'resposta' and linha['direcao'] != 'entrada' or tipo in ('entrega', 'leitura') and linha['direcao'] != 'saida':
        return None
    texto = linha.get('texto')
    if not isinstance(texto, str):
        return None
    return {'idOriginal': id_, 'origem': 'whatsapp', 'conta': 'prumo', 'canal': 'whatsapp',
            'conversa': conversa, 'tipo': tipo, 'direcao': linha['direcao'], 'ocorridoEm': linha['em'],
            'recebidoEm': recebido_em, 'conteudoHash': hashlib.sha256(texto.encode('utf-8')).hexdigest(), 'fonteId': id_}


def envelopes_prumo(conversa, linhas, ids, recebido_em, *, origem):
    """Retorna lista + contagem técnica sem dados privados; IDs ausentes não são adivinhados.

    Somente entrada com identidade real desta instância, sem repetir IDs no lote.
    Filas antigas sem IDs continuam classificáveis, porém sem envelope comercial.
    """
    if origem != 'prumo':
        return {'eventos': [], 'ignorados': 0, 'motivo': 'origem_fora_do_escopo'}
    if not isinstance(ids, list) or not ids:
        return {'eventos': [], 'ignorados': 1, 'motivo': 'metadados_insuficientes'}
    eventos, ignorados, vistos = [], 0, set()
    for id_ in ids:
        if not isinstance(id_, str) or id_ in vistos:
            ignorados += 1
            continue
        vistos.add(id_)
        correspondentes = [r for r in linhas if isinstance(r, dict) and r.get('id') == id_ and r.get('direcao') == 'entrada']
        # Mais de uma linha contraditória é revisão, não escolha silenciosa.
        if len(correspondentes) != 1:
            ignorados += 1
            continue
        evento = envelope_prumo(conversa, correspondentes[0], recebido_em)
        if evento is None:
            ignorados += 1
        else:
            eventos.append(evento)
    return {'eventos': eventos, 'ignorados': ignorados, 'motivo': 'metadados_insuficientes' if ignorados else ''}
