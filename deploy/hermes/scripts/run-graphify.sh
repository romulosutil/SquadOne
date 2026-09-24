#!/usr/bin/env bash
# O graphify é do Hermes (job "Graphify — projetos", script
# ~/.hermes/scripts/graphify_projetos.py). Este caminho continua existindo só
# porque o pre-push do Windows (dev/tools/trigger-graphify.ps1) o chama por SSH:
# ele pede ao Hermes para rodar o job no próximo tick, em vez de rodar o
# graphify por fora. Instalado em ~/workspace/scripts/run-graphify.sh.
set -eu
# SSH do pre-push é sessão não interativa: sem ~/.local/bin no PATH, o plugin
# rtk-rewrite do Hermes não acha o rtk e avisa a cada chamada.
export PATH="$HOME/.local/bin:$PATH"
id=$(python3 - <<'EOF'
import json, pathlib
jobs = json.loads((pathlib.Path.home() / ".hermes/cron/jobs.json").read_text())["jobs"]
print(next((j["id"] for j in jobs if j["name"] == "Graphify — projetos"), ""))
EOF
)
if [ -z "$id" ]; then
  echo "[$(date '+%F %T')] job 'Graphify — projetos' não existe no Hermes" >&2
  exit 1
fi
exec "$HOME/.local/bin/hermes" cron run "$id"
