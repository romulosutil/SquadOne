"""Calendário de primeiros contatos; a pesquisa interna continua nos feriados."""
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from politica_envios import LIMITES_OPERACIONAIS

SP = ZoneInfo('America/Sao_Paulo')


def feriados():
    local = Path(__file__).with_name('feriados-nacionais.json')
    p = local if local.exists() else Path(__file__).resolve().parents[2] / 'config/feriados-nacionais.json'
    return set(json.loads(p.read_text())['datas'])


def proximo_expediente(now):
    if not LIMITES_OPERACIONAIS: return now.astimezone(SP)
    local = now.astimezone(SP); datas = feriados()
    def util(d): return d.weekday() < 5 and d.date().isoformat() not in datas
    minutos = local.hour * 60 + local.minute
    if util(local) and 480 <= minutos < 1080: return local
    alvo = local.replace(hour=8, minute=0, second=0, microsecond=0)
    if minutos >= 1080: alvo += dt.timedelta(days=1)
    for _ in range(370):
        if util(alvo): return alvo
        alvo += dt.timedelta(days=1)
    raise ValueError('Calendário sem expediente disponível')
