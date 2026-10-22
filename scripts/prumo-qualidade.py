"""Adaptador do SquadOne para a qualidade da Prumo; não publica nem envia."""
import argparse
from pathlib import Path
import subprocess
import sys


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, add_help=False)
    ap.add_argument("--prumo", type=Path, default=Path(__file__).resolve().parents[1].parent / "prumo")
    args, restantes = ap.parse_known_args(argv)
    script = args.prumo / "06-qualidade" / "qualidade.py"
    if not script.is_file():
        print("Qualidade indisponível: informe --prumo com o checkout canônico. Entrega bloqueada.", file=sys.stderr)
        return 2
    squadone = Path(__file__).resolve().parents[1]
    return subprocess.run([sys.executable, str(script), "--squadone", str(squadone), *restantes], check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
