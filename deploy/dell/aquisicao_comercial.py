"""Trava de aquisição: não existe liberação por configuração nesta versão."""
import json
from pathlib import Path

_local = Path(__file__).with_name('aquisicao-comercial.json')
_padrao = _local if _local.exists() else Path(__file__).resolve().parents[2] / 'config/aquisicao-comercial.json'
_MOTIVO = 'restricao-apos-envios-em-massa-2026-11-13'


def bloqueio_aquisicao(arquivo=None):
    try:
        p = json.loads(Path(arquivo or _padrao).read_text(encoding='utf-8'))
        if isinstance(p, dict) and type(p.get('versao')) is int and p.get('versao') == 1 and p.get('estado') == 'bloqueado' and p.get('motivo') == _MOTIVO:
            return {'bloqueado': True, 'motivo': _MOTIVO}
    except (OSError, ValueError, TypeError):
        pass
    return {'bloqueado': True, 'motivo': 'politica-de-aquisicao-indisponivel-ou-invalida'}
