"""O agente envia apenas a abertura; Rômulo assume qualquer resposta."""
import json
from pathlib import Path

_local = Path(__file__).with_name('aquisicao-comercial.json')
_padrao = _local if _local.exists() else Path(__file__).resolve().parents[2] / 'config/aquisicao-comercial.json'
_MOTIVO = 'restricao-apos-envios-em-massa-2026-11-13'


def bloqueio_aquisicao(arquivo=None):
    try:
        p = json.loads(Path(arquivo or _padrao).read_text(encoding='utf-8'))
        if isinstance(p, dict) and type(p.get('versao')) is int and p.get('versao') == 2 and p.get('estado') == 'preparado-pausado' and p.get('respostasAutomaticas') is False:
            return {'bloqueado': True, 'motivo': 'operacao-preparada-aguardando-retomada'}
        if isinstance(p, dict) and type(p.get('versao')) is int and p.get('versao') == 2 and p.get('estado') == 'primeiro-contato' and p.get('respostasAutomaticas') is False:
            return {'bloqueado': False, 'motivo': 'primeiro-contato-depois-romulo'}
        if isinstance(p, dict) and type(p.get('versao')) is int and p.get('versao') == 1 and p.get('estado') == 'bloqueado' and p.get('motivo') == _MOTIVO:
            return {'bloqueado': True, 'motivo': _MOTIVO}
    except (OSError, ValueError, TypeError):
        pass
    return {'bloqueado': True, 'motivo': 'politica-de-aquisicao-indisponivel-ou-invalida'}


def limite_diario_whatsapp(arquivo=None):
    """Cota de tentativas de primeiro contato no dia de São Paulo."""
    try:
        limite = json.loads(Path(arquivo or _padrao).read_text(encoding='utf-8')).get('limiteDiarioWhatsApp')
        if type(limite) is int and 1 <= limite <= 20:
            return limite
    except (OSError, ValueError, AttributeError):
        pass
    return 10
