#!/usr/bin/env python3
"""Script do job do Hermes (`no_agent`, a cada 5 min) em ~/.hermes/scripts/: organiza a fila da Entrada.
Fila vazia = não imprime nada e não gasta token. Veja organizar.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".local/lib/mel-entrada"))
from organizar import principal  # noqa: E402

sys.exit(principal())
