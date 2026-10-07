#!/usr/bin/env python3
"""Caixa de entrada da pasta auto (Site antes da venda).

O n8n do Dell não cria pastas (o nó de arquivo só grava em diretório que já
existe), e o Caçador precisa de uma pasta por lead com Fotos/ e Logotipo/.
Então o n8n grava pacotes em ~/.local/share/auto-entrada/*.json:

    {"caminho": "<slug>/content.md", "base64": "...", "pastas": ["Fotos", "Logotipo"]?}

e este script materializa cada um em ~/auto-site/<caminho>, criando as pastas.
~/auto-site é a pasta de verdade. O Syncthing a espelhava em G:\\Meu Drive\\auto
no PC (e dali para o Drive); o PC queimou em 25/09/2026 e o espelho do Drive
ficou parado até o PC novo (deploy/pc/README.md).

Pacote inválido vai para ~/.local/share/auto-entrada-erro/ e gera aviso pelo
Hermes (fila de avisos).
"""
import base64
import json
import time
from pathlib import Path

HOME = Path.home()
ENTRADA = HOME / ".local/share/auto-entrada"
# Fora da entrada: o gatilho systemd é "diretório não vazio", e um erro/ ali
# dentro o dispararia em loop.
ERRO = HOME / ".local/share/auto-entrada-erro"
AUTO = HOME / "auto-site"
FILA_AVISOS = HOME / ".local/share/avisos/fila"


def destino_seguro(caminho: str) -> Path:
    rel = Path(caminho)
    if not caminho or rel.is_absolute() or ".." in rel.parts or rel.parts[0].startswith("_"):
        raise ValueError(f"caminho recusado: {caminho!r}")
    return AUTO / rel


def avisar(texto: str) -> None:
    FILA_AVISOS.mkdir(parents=True, exist_ok=True)
    nome = FILA_AVISOS / f"auto-entrada-{time.time_ns()}.json"
    nome.write_text(json.dumps({"titulo": "🌐 Sites", "texto": texto, "origem": "auto-entrada"}, ensure_ascii=False))


def main() -> None:
    ERRO.mkdir(parents=True, exist_ok=True)
    for pacote in sorted(ENTRADA.glob("*.json")):
        try:
            d = json.loads(pacote.read_text(encoding="utf-8"))
            destino = destino_seguro(str(d["caminho"]))
            destino.parent.mkdir(parents=True, exist_ok=True)
            for pasta in d.get("pastas") or []:
                (destino.parent / Path(str(pasta)).name).mkdir(exist_ok=True)
            tmp = destino.with_name(destino.name + ".parcial")
            tmp.write_bytes(base64.b64decode(d["base64"]))
            tmp.replace(destino)
            pacote.unlink()
        except Exception as e:  # noqa: BLE001 — um pacote ruim não trava os outros
            pacote.replace(ERRO / pacote.name)
            avisar(f"Pacote da pasta auto não pôde ser gravado ({pacote.name}): {e}")


if __name__ == "__main__":
    main()
