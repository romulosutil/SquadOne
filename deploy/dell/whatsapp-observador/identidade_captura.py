"""Prova operacional privada da captura Evolution; nunca contém texto ou credencial.

O chamador deve fornecer somente o contexto do webhook já autenticado e as rows
normalizadas de respostas/enviadas do adaptador. Não consulta rede, modelos ou DB.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

try:
    import fcntl
except ImportError:
    fcntl = None

_TRAVA = threading.RLock()
_HASH = re.compile(r'[a-f0-9]{64}')


def jid_canonico(valor):
    """Apenas JID telefônico da conta; nunca aceita LID/grupo/alias c.us."""
    if not isinstance(valor, str):
        return None
    m = re.fullmatch(r'([0-9]{10,15})(?::[0-9]+)?@s\.whatsapp\.net', valor)
    return m.group(1) + '@s.whatsapp.net' if m else None


def chave_br10(jid):
    """Só PN explicitamente brasileiro, nunca a normalização permissiva legada."""
    canon = jid_canonico(jid)
    if canon is None or not re.fullmatch(r'55[0-9]{10,11}@s\.whatsapp\.net', canon):
        return None
    numero = canon.split('@')[0][2:]
    chave = numero[:2] + numero[-8:]
    return chave if re.fullmatch(r'[1-9][0-9]{9}', chave) else None


def chave_br10_do_evento(item):
    """PN55 do PRÓPRIO webhook: mapas de outras sessões nunca são testemunha."""
    if not isinstance(item, dict):
        return None
    key = item.get('key') if isinstance(item.get('key'), dict) else {}
    principal = key.get('remoteJid') or item.get('remoteJid')
    if not isinstance(principal, str) or principal.partition('@')[2] not in ('s.whatsapp.net', 'lid'):
        return None  # Em grupo o alternate pode ser só o remetente.
    candidatos = [onde.get(k) for onde in (key, item) for k in ('remoteJid', 'remoteJidAlt')]
    pns = {canon for v in candidatos if (canon := jid_canonico(v)) is not None}
    if len(pns) != 1:
        return None
    return chave_br10(next(iter(pns)))


def _instante(valor):
    if not isinstance(valor, str):
        return None
    try:
        t = datetime.fromisoformat(valor.replace('Z', '+00:00'))
        return t.astimezone(timezone.utc) if t.tzinfo is not None else None
    except ValueError:
        return None


def iso_utc(segundos):
    return datetime.fromtimestamp(int(segundos), timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def iso_captura(segundos):
    return datetime.fromtimestamp(segundos, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def timestamp_original_valido(valor, capturado_em):
    """Não confunde a hora substituta do parser legado com timestamp recebido."""
    captura = _instante(capturado_em)
    if captura is None or isinstance(valor, bool):
        return False
    try:
        t = float(valor)
        if t > 1e12:
            t /= 1000
        return math.isfinite(t) and 1e9 < t <= captura.timestamp()
    except (TypeError, ValueError, OverflowError):
        return False


def carregar_config(pasta):
    """Ausência é opt-out; configuração inválida vira status, nunca prova."""
    try:
        dado = json.loads((Path(pasta) / 'config.json').read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None
    except (ValueError, UnicodeError):
        return {'invalida': True}
    if not isinstance(dado, dict) or type(dado.get('v')) is not int or dado.get('v') != 1 or not isinstance(dado.get('identidadePrumoHash'), str) or not _HASH.fullmatch(dado['identidadePrumoHash']) or _instante(dado.get('desde')) is None:
        return {'invalida': True}
    return dado


def contexto_captura(corpo, capturado_em, config, *, autenticado):
    """PURO: guarda no spool só metadados mínimos, sem sender/JID/texto bruto."""
    if config is None:
        return None
    base = {'v': 1, 'capturadoEm': capturado_em}
    if config.get('invalida') or _instante(capturado_em) is None:
        return {**base, 'estado': 'configuracaoInvalida'}
    if not autenticado:
        return {**base, 'estado': 'capturaNaoAutenticada'}
    if not isinstance(corpo, dict) or corpo.get('instance') != 'prumo':
        return {**base, 'estado': 'instanciaDiferente'}
    canon = jid_canonico(corpo.get('sender'))
    if canon is None:
        return {**base, 'estado': 'senderAusenteOuInvalido'}
    if _instante(config['desde']) > _instante(capturado_em):
        return {**base, 'estado': 'antesDoInicio'}
    return {**base, 'estado': 'apta', 'contaHash': hashlib.sha256(canon.encode('utf-8')).hexdigest()}


def montar_provas(contexto, traducao, config):
    """PURO: rows EXATAS e contagens; outra conta é prova, não rótulo PRUMO."""
    provas, contagens = [], {}
    def contar(motivo, n=1):
        contagens[motivo] = contagens.get(motivo, 0) + n
    if config is None:
        return provas, contagens
    if config.get('invalida'):
        return [], {'configuracaoInvalida': 1}
    if not isinstance(contexto, dict):
        return [], {'capturaSemAtestacao': 1}
    if contexto.get('estado') != 'apta':
        permitidos = {'configuracaoInvalida', 'capturaNaoAutenticada', 'instanciaDiferente', 'senderAusenteOuInvalido', 'antesDoInicio'}
        motivo = contexto.get('estado')
        return [], {motivo if motivo in permitidos else 'contextoInvalido': 1}
    capturado = _instante(contexto.get('capturadoEm'))
    if capturado is None or _instante(config['desde']) > capturado or not isinstance(contexto.get('contaHash'), str) or not _HASH.fullmatch(contexto['contaHash']):
        return [], {'contextoInvalido': 1}
    rows = [('entrada', r) for r in traducao.respostas] + [('saida', r) for r in traducao.enviadas]
    if contexto.get('ambigua'):
        return [], {'capturaAmbigua': max(1, len(rows))}
    if contexto.get('horarioOriginalValido') is not True:
        return [], {'horarioOriginalInvalido': max(1, len(rows))}
    if not isinstance(contexto.get('conversaBR10'), str) or not re.fullmatch(r'[1-9][0-9]{9}', contexto['conversaBR10']):
        return [], {'conversaNaoComprovada': max(1, len(rows))}
    vistos = {}
    for direcao, r in rows:
        if not isinstance(r, dict):
            contar('metadadosInsuficientes'); continue
        chave, id_, texto, ts = r.get('chave'), r.get('id'), r.get('texto'), r.get('ts')
        if not isinstance(chave, str) or not re.fullmatch(r'[1-9][0-9]{9}', chave) or not isinstance(id_, str) or not 0 < len(id_) <= 200 or id_.strip() != id_ or re.search(r'[\x00-\x1f\x7f]', id_) or not isinstance(texto, str) or not texto.strip() or not timestamp_original_valido(ts, contexto['capturadoEm']):
            contar('metadadosInsuficientes'); continue
        ocorrido = iso_utc(ts)
        if chave != contexto['conversaBR10'] or id_ != contexto.get('idOriginal') or direcao != contexto.get('direcao') or ocorrido != contexto.get('ocorridoEm'):
            contar('vinculoDaMensagemDivergente'); continue
        mensagem = {'idOriginal': id_, 'direcao': direcao, 'ocorridoEm': ocorrido,
                    'conteudoHash': hashlib.sha256(texto.strip()[:2000].encode('utf-8')).hexdigest()}
        row = {'v': 1, 'coletor': 'evolution', 'contaHash': contexto['contaHash'],
               'garantia': 'webhook-evolution', 'sessaoHash': None, 'instancia': 'prumo',
               'capturadoEm': contexto['capturadoEm'], 'mensagem': mensagem}
        identidade = (chave, id_, direcao)
        if identidade in vistos and vistos[identidade] != row:
            contar('capturaAmbigua')
            # Não escolher uma das versões contraditórias da mesma mensagem.
            provas = [(c, p) for c, p in provas if (c, p['mensagem']['idOriginal'], p['mensagem']['direcao']) != identidade]
            vistos[identidade] = None
            continue
        if identidade not in vistos:
            vistos[identidade] = row
            provas.append((chave, row))
            contar('provas')
            if contexto['contaHash'] != config['identidadePrumoHash']:
                contar('foraDaAncora')
    contagens['provas'] = len(provas)
    contagens['foraDaAncora'] = sum(p['contaHash'] != config['identidadePrumoHash'] for _, p in provas)
    return provas, {k: v for k, v in contagens.items() if v}


def _pasta_privada(pasta):
    pasta.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(pasta, 0o700)


def _fsync_pasta(pasta):
    if os.name != 'nt':
        fd = os.open(pasta, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def _append(pasta, chave, rows):
    arquivo = pasta / (chave + '.jsonl')
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(arquivo, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise OSError('destino de prova invalido')
        if hasattr(os, 'fchmod'):
            os.fchmod(fd, 0o600)
        else:
            os.chmod(arquivo, 0o600)
        dados = b''.join((json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8') for r in rows)
        if os.write(fd, dados) != len(dados):
            raise OSError('prova incompleta')
        os.fsync(fd)
    finally:
        os.close(fd)
    _fsync_pasta(pasta)


@contextmanager
def _trava_status(pasta):
    with _TRAVA:
        fd = os.open(pasta / '.status-evolution.lock', os.O_WRONLY | os.O_CREAT, 0o600)
        try:
            if fcntl:
                fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)


def _status(pasta, contagens, capturado_em):
    if not contagens:
        return
    with _trava_status(pasta):
        path = pasta / 'status-evolution.json'
        try:
            anterior = json.loads(path.read_text(encoding='utf-8'))
            acumuladas = anterior['contagens']
            if not isinstance(acumuladas, dict) or any(not isinstance(k, str) or type(v) is not int or v < 0 for k, v in acumuladas.items()):
                raise ValueError('status invalido')
        except FileNotFoundError:
            acumuladas = {}
        for k, v in contagens.items():
            acumuladas[k] = acumuladas.get(k, 0) + v
        data = json.dumps({'v': 1, 'coletor': 'evolution', 'capturadoEm': capturado_em, 'contagens': acumuladas}, separators=(',', ':')).encode()
        fd, nome = tempfile.mkstemp(prefix='.status-evolution-', dir=pasta)
        try:
            if hasattr(os, 'fchmod'):
                os.fchmod(fd, 0o600)
            else:
                os.chmod(nome, 0o600)
            with os.fdopen(fd, 'wb') as f:
                f.write(data); f.flush(); os.fsync(f.fileno())
            os.replace(nome, path)
            _fsync_pasta(pasta)
        finally:
            try:
                os.unlink(nome)
            except FileNotFoundError:
                pass


def registrar_provas(contexto, traducao, *, pasta):
    """Append+fsync e status atômico antes de confirmar posse/ACK do chamador.

    Repetir a mesma prova é permitido. Toda falha de persistência propaga: nunca
    consumir o spool nem confirmar o webhook depois de um append não confirmado.
    """
    pasta = Path(pasta)
    config = carregar_config(pasta)
    provas, contagens = montar_provas(contexto, traducao, config)
    if config is None:
        return contagens
    _pasta_privada(pasta)
    grupos = {}
    for chave, prova in provas:
        grupos.setdefault(chave, []).append(prova)
    for chave, rows in grupos.items():
        _append(pasta, chave, rows)
    _status(pasta, contagens, contexto.get('capturadoEm') if isinstance(contexto, dict) else None)
    return contagens
