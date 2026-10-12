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
import importlib.util
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


# A lib de aviso (deploy/dell/lib/aviso.py, 11/10/2026): no repo, em lib/ ao
# lado deste arquivo; no Dell, instalada em ~/.local/lib/mel/ (instalados.json).
# Primeiro a do repo, para o teste nunca pegar uma cópia instalada.
PASTAS_DA_LIB = [Path(__file__).resolve().parent / "lib", HOME / ".local/lib/mel"]


def lib_de_aviso():
    """O módulo da lib, ou None quando nenhuma cópia existe ou carrega: aí o
    avisar() volta ao jeito antigo e o aviso sai do mesmo modo que antes."""
    for pasta in PASTAS_DA_LIB:
        arquivo = pasta / "aviso.py"
        if not arquivo.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", arquivo)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # noqa: BLE001 — cópia quebrada não derruba a entrada: tenta a próxima
            continue
    return None


def avisar(texto: str) -> None:
    aviso = {"titulo": "🌐 Sites", "texto": texto, "origem": "auto-entrada"}
    lib = lib_de_aviso()
    if lib is not None:
        # Valida, grava atômico, não cria a pasta da fila e nunca levanta: o que
        # não foi gravado (recusado, fila ausente) vai ao journal pelo stderr.
        lib.gravar(aviso, fila=FILA_AVISOS, prefixo="auto-entrada")
        return
    # Sem a lib instalada: o jeito de antes, sem mudar nada.
    FILA_AVISOS.mkdir(parents=True, exist_ok=True)
    nome = FILA_AVISOS / f"auto-entrada-{time.time_ns()}.json"
    nome.write_text(json.dumps(aviso, ensure_ascii=False))


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
