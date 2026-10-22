"""Instala a trava e a sincronização no Dell, com backup e conferência de cópias."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aplicar", action="store_true")
    args = ap.parse_args()
    home = Path.home().resolve()
    repo = Path(__file__).resolve().parents[2]
    prumo = home / "prumo"
    if not (prumo / "06-qualidade/publicacao.py").is_file() or not (prumo / "00-contexto/organizacao.md").is_file():
        raise SystemExit("Fonte Prumo incompleta; não instalar")
    for unidade in ("gerador-de-sites.service", "gerador-de-sites-pedido.service", "raio-x.service"):
        r = subprocess.run(["systemctl", "--user", "is-active", unidade], capture_output=True, text=True)
        if r.stdout.strip() in ("active", "activating"):
            raise SystemExit("Publicador em execução; aguardar antes de instalar: " + unidade)
    pares = [("deploy/dell/lib/qualidade_prumo.py", ".local/lib/mel/qualidade_prumo.py", 0o644)]
    pares += [("deploy/dell/claude-ops/" + n, ".local/share/claude-ops/" + n, 0o644) for n in
              ("prumo_contexto.py", "prumo-contexto-sincronizar.py", "prumo-contexto-validar.py", "n8n.py")]
    pares += [("deploy/dell/" + n + ".py", ".local/bin/" + n, 0o755) for n in ("gerador-de-sites", "raio-x")]
    pares += [("deploy/dell/" + n, ".config/systemd/user/" + n, 0o644) for n in ("prumo-contexto.service", "prumo-contexto.timer")]
    backup = home / ".local/state/prumo-qualidade/backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    for fonte, destino, _ in pares:
        if not (repo / fonte).is_file() or home not in (home / destino).resolve().parents:
            raise SystemExit("Fonte ou destino inválido")
        if fonte.endswith(".py"):
            compile((repo / fonte).read_bytes(), fonte, "exec")
    if not args.aplicar:
        print(json.dumps({"aplicar": False, "arquivos": [d for _, d, _ in pares]}))
        return
    backup.mkdir(parents=True, mode=0o700)
    instalados = []
    for fonte, destino, modo in pares:
        alvo = home / destino
        if alvo.exists():
            salvo = backup / destino
            salvo.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(alvo, salvo)
        alvo.parent.mkdir(parents=True, exist_ok=True)
        temporario = alvo.with_name(alvo.name + ".qualidade-tmp")
        temporario.write_bytes((repo / fonte).read_bytes())
        temporario.chmod(modo)
        temporario.replace(alvo)
        if alvo.read_bytes() != (repo / fonte).read_bytes():
            raise SystemExit("Cópia divergente: " + destino)
        instalados.append({"fonte": fonte, "destino": destino, "sha256": hashlib.sha256(alvo.read_bytes()).hexdigest()})
    (backup / "instalacao.json").write_text(json.dumps(instalados, indent=2) + "\n")
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", "prumo-contexto.timer"], check=True)
    subprocess.run(["systemctl", "--user", "start", "prumo-contexto.service"], check=True)
    print(json.dumps({"aplicar": True, "backup": str(backup), "arquivos_conferidos": len(instalados)}))


if __name__ == "__main__":
    main()
