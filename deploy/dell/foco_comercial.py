"""Perfil de descoberta por fatos públicos; não representa intenção de compra."""
import json
from pathlib import Path
import re
import unicodedata


def ler_foco():
    instalado = Path(__file__).with_name('foco-comercial.json')
    fonte = instalado if instalado.exists() else Path(__file__).resolve().parents[2] / 'config/foco-comercial.json'
    dado = json.loads(fonte.read_text(encoding='utf-8'))
    if dado.get('versao') != 1 or not dado.get('segmentos') or not dado.get('cidades'):
        raise ValueError('Foco comercial inválido')
    return dado


def normalizar(valor):
    return ''.join(c for c in unicodedata.normalize('NFD', valor.lower()) if not unicodedata.combining(c))


def perfil_no_foco(perfil, consulta, foco):
    segmento = next((s for s in foco['segmentos'] if s['consulta'] == consulta), None)
    if not segmento:
        return None
    texto = normalizar(perfil.get('nome', '') + ' ' + perfil.get('categoria', ''))
    if re.search(foco['excluir'], texto) or not re.search(segmento['perfil'], texto):
        return None
    return {'segmento': segmento['id'], 'categoriaPublica': perfil.get('categoria', ''),
            'hipotese': segmento['hipotese'], 'necessidadeConfirmada': False}
