"""Distingue transcrição derivada do áudio original, comprovado pelo webhook.

Não altera conversas, provas ou inbox; corrige somente o envelope de transporte.
"""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re


def _instante(valor):
    if not isinstance(valor, str):
        return None
    try:
        t = datetime.fromisoformat(valor.replace('Z', '+00:00'))
        return t if t.tzinfo is not None else None
    except ValueError:
        return None


def _sha(texto):
    return hashlib.sha256(texto.encode('utf-8')).hexdigest()


def _original_comprovado(evento, marcador, config, provas, agora):
    if not isinstance(config, dict) or set(config) != {'v', 'identidadePrumoHash', 'desde'} or config['v'] != 1:
        return False
    conta, desde = config['identidadePrumoHash'], _instante(config['desde'])
    ocorrido, recebido = _instante(evento.get('ocorridoEm')), _instante(evento.get('recebidoEm'))
    if (not isinstance(conta, str) or not re.fullmatch(r'[a-f0-9]{64}', conta) or desde is None or desde > agora
            or ocorrido is None or recebido is None or not ocorrido <= recebido <= agora):
        return False
    mensagem = {'idOriginal': evento['idOriginal'], 'direcao': 'entrada',
                'ocorridoEm': evento['ocorridoEm'], 'conteudoHash': _sha(marcador)}
    for prova in provas:
        if not isinstance(prova, dict) or set(prova) != {'v', 'coletor', 'contaHash', 'garantia', 'sessaoHash', 'instancia', 'capturadoEm', 'mensagem'}:
            continue
        captura = _instante(prova['capturadoEm'])
        if (prova['v'] == 1 and prova['coletor'] == 'evolution' and prova['garantia'] == 'webhook-evolution'
                and prova['instancia'] == 'prumo' and prova['sessaoHash'] is None and prova['contaHash'] == conta
                and captura is not None and desde <= captura <= agora and ocorrido <= captura and prova['mensagem'] == mensagem):
            return True
    return False


def conciliar_lote(lote, linhas, config, provas, agora, *, registros=()):
    """PURO. Mantém texto classificado e IDs; só usa o hash do áudio atestado.

    Prefixo escrito pelo interlocutor não basta: exige a prova exata do marcador,
    mesma conta, ID, direção e horário. Conteúdo divergente sem prova não muda.
    """
    if not isinstance(lote, dict) or not re.fullmatch(r'[1-9][0-9]{9}', str(lote.get('chave', ''))):
        return lote, 0
    novo, corrigidos = deepcopy(lote), 0
    for evento in novo.get('envelopesComerciais', []):
        if (not isinstance(evento, dict) or evento.get('tipo') != 'resposta' or evento.get('direcao') != 'entrada'
                or evento.get('conta') != 'prumo' or evento.get('canal') != 'whatsapp' or evento.get('origem') != 'whatsapp'
                or evento.get('conversa') != lote['chave'] or evento.get('fonteId') != evento.get('idOriginal')):
            continue
        candidatas = [r for r in linhas if isinstance(r, dict) and r.get('id') == evento.get('idOriginal')
                      and r.get('direcao') == 'entrada']
        if len(candidatas) != 1:
            continue
        linha = candidatas[0]
        if linha.get('origem') != 'prumo' or linha.get('em') != evento.get('ocorridoEm') or not isinstance(linha.get('texto'), str):
            continue
        texto = linha['texto']
        audio = re.match(r'^(\[áudio(?: [0-9]{1,5}s)?\])(?: |\n)\S', texto)
        if not audio or evento.get('conteudoHash') != _sha(texto):
            continue
        marcador = audio.group(1)
        # A inbox é imutável: reenviar sua mesma identidade, não escolher outro
        # formato só porque existe uma transcrição ou um segundo coletor.
        campos = set(evento) - {'recebidoEm', 'conteudoHash'}
        anteriores = [r['evento'] for r in registros if isinstance(r, dict) and isinstance(r.get('evento'), dict)
                      and r.get('estado') in ('pendente', 'processando', 'concluido', 'ambiguo')
                      and set(r['evento']) == set(evento) and all(r['evento'][k] == evento[k] for k in campos)]
        if len(anteriores) != 1 or anteriores[0]['conteudoHash'] != _sha(marcador):
            continue
        if _original_comprovado(evento, marcador, config, provas, agora):
            evento['conteudoHash'] = _sha(marcador)
            corrigidos += 1
    return (novo if corrigidos else lote), corrigidos


def conciliar_com_provas(lote, linhas, home, agora):
    """Somente leitura de metadados privados existentes; indisponível mantém fila."""
    chave = lote.get('chave') if isinstance(lote, dict) else None
    if not isinstance(chave, str) or not re.fullmatch(r'[1-9][0-9]{9}', chave):
        return lote, 0
    try:
        raiz = Path(home) / '.local/share/whatsapp-identidades'
        config = json.loads((raiz / 'config.json').read_text(encoding='utf-8'))
        arquivo = raiz / (chave + '.jsonl')
        if arquivo.stat().st_size > 8 * 1024 * 1024:
            return lote, 0
        provas = [json.loads(l) for l in arquivo.read_text(encoding='utf-8').splitlines() if l.strip()]
        inbox = Path(home) / '.local/share/squadone-operations/atendimento-comercial-inbox.json'
        if inbox.stat().st_size > 32 * 1024 * 1024:
            return lote, 0
        estado = json.loads(inbox.read_text(encoding='utf-8'))
        if not isinstance(estado, dict) or estado.get('v') != 1 or not isinstance(estado.get('registros'), list):
            return lote, 0
        return conciliar_lote(lote, linhas, config, provas, datetime.fromtimestamp(agora, timezone.utc), registros=estado['registros'])
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        return lote, 0
