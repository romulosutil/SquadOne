#!/usr/bin/env python3
"""Retorno do aparelho -> arquivo do lead. Nunca chama n8n, classificador ou Hermes."""
import importlib.machinery
import importlib.util
import json
import sys
import time
from pathlib import Path

home = Path.home()
loader = importlib.machinery.SourceFileLoader('observador_historico', str(home / '.local/bin/whatsapp-observador'))
spec = importlib.util.spec_from_loader(loader.name, loader)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
loader.exec_module(mod)
lista = set(json.loads((home / '.local/state/whatsapp-observador/leads.json').read_text()))
try:
    escopo = json.loads((home / '.local/share/squadone-operations/historico-leads.json').read_text())
    if abs(time.time() * 1000 - escopo['geradoEm']) < 30 * 60_000:
        lista.update(c for c in escopo['chaves'][:3000] if isinstance(c, str) and len(c) == 10 and c.isdigit())
except (OSError, ValueError, KeyError, TypeError):
    pass
dados = json.loads(sys.stdin.read(2_000_001))
if not isinstance(dados, list) or len(dados) > 200:
    raise ValueError('Lote inválido')
conversas = mod.Conversas(origem='hermes-historico')
gravadas = 0
for m in dados:
    if m.get('chave') not in lista or m.get('direcao') not in ('entrada', 'saida'):
        continue
    gravadas += bool(conversas.anexar(m['chave'], m['direcao'], float(m['ts']), m.get('texto', ''), m.get('id')))
print(json.dumps({'gravadas': gravadas}))
