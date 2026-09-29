#!/usr/bin/env python3
"""Move as pastas do Site antes da venda conforme a planilha (Dell).

O n8n não move diretórios (mesmo motivo do auto-entrada). A cada hora o Balcão
grava em ~/.local/share/n8n-estado/site-pastas.json o que mudou de lugar:

- respondeu no WhatsApp (respondeu_em a partir de 29/09/2026) -> _em-conversa/;
- expirado (10 dias sem resposta, enviados a partir de 29/09/2026) -> _concluidos/.

Este script, disparado pelo site-pastas.path quando o arquivo muda, move. Só
tira pasta da raiz (ou de _concluidos/ para _em-conversa/, quando um expirado
responde), só se o publicado.json dela tem o mesmo place_id e nunca sobrescreve
destino. _recusados/ e _descartados/ não entram: são decisão do Rômulo.

Uso: site-pastas [--listar]   (--listar mostra o que faria, sem mover)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HOME = Path.home()
AUTO = HOME / "auto-site"
PEDIDO = HOME / ".local/share/n8n-estado/site-pastas.json"
SLUG = re.compile(r"^[a-z0-9][a-z0-9._-]{0,179}$")
ORIGENS = {"", "_concluidos"}
DESTINOS = {"_em-conversa", "_concluidos"}


def separar(relativo: str) -> tuple[str, str] | None:
    """"slug" -> ("", slug); "_concluidos/slug" -> ("_concluidos", slug); o resto não vale."""
    partes = str(relativo or "").split("/")
    if len(partes) == 1:
        partes = ["", partes[0]]
    if len(partes) != 2 or not SLUG.match(partes[1]):
        return None
    return partes[0], partes[1]


def place_id_de(pasta: Path) -> str:
    try:
        return str(json.loads((pasta / "publicado.json").read_text(encoding="utf-8")).get("place_id") or "")
    except (OSError, ValueError, AttributeError):
        return ""


def main() -> int:
    listar = "--listar" in sys.argv
    try:
        pedido = json.loads(PEDIDO.read_text(encoding="utf-8"))
    except OSError:
        print(f"sem pedido em {PEDIDO}")
        return 0
    except ValueError as e:
        print(f"{PEDIDO} ilegível: {e}")
        return 1
    movidas = 0
    for m in pedido.get("mover", []):
        de, para = separar(m.get("de")), separar(m.get("para"))
        nome = m.get("nome") or m.get("place_id")
        if not de or not para or de[0] not in ORIGENS or para[0] not in DESTINOS or de[1] != para[1] or de[0] == para[0]:
            print(f"ignorado (caminho fora da regra): {m.get('de')} -> {m.get('para')}")
            continue
        origem, destino = AUTO / de[0] / de[1], AUTO / para[0] / para[1]
        if not origem.is_dir():
            continue  # já foi movida (o pedido se repete a cada hora até a planilha mudar)
        if place_id_de(origem) != m.get("place_id"):
            print(f"ignorado (place_id não bate com o publicado.json): {origem.relative_to(AUTO)}")
            continue
        if destino.exists():
            print(f"ignorado (destino já existe): {destino.relative_to(AUTO)}")
            continue
        if listar:
            print(f"moveria {origem.relative_to(AUTO)} -> {destino.relative_to(AUTO)} ({nome}: {m.get('motivo')})")
            continue
        destino.parent.mkdir(exist_ok=True)
        origem.rename(destino)
        movidas += 1
        print(f"movida {origem.relative_to(AUTO)} -> {destino.relative_to(AUTO)} ({nome}: {m.get('motivo')})")
    if movidas:
        print(f"{movidas} pasta(s) movida(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
