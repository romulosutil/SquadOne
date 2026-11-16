"""Política autorizada de envio, compartilhada com a Central e a interface."""
import json
from pathlib import Path

_local = Path(__file__).with_name('politica-envios.json')
_arquivo = _local if _local.exists() else Path(__file__).resolve().parents[2]/'config/politica-envios.json'
POLITICA = json.loads(_arquivo.read_text(encoding='utf-8'))
LIMITES_OPERACIONAIS = POLITICA['limitesOperacionais']
APROVACOES_COMERCIAIS = POLITICA['aprovacoesComerciais']
