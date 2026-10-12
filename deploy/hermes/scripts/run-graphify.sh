#!/usr/bin/env bash
# O graphify roda o graphify_projetos.py sobre os projetos do registro
# deploy/hermes/projetos.toml e os espelhos de todos os repositórios do GitHub.
# Este caminho pede uma rodada agora, em vez de rodar o graphify por fora:
# - com o graphify-projetos.timer ligado (desde a troca do aviso único,
#   11/10/2026), inicia o graphify-projetos.service, e a falha vai para a fila
#   de avisos;
# - com ele desligado (antes da troca, ou depois de reverter), pede ao Hermes
#   que rode o job "Graphify — projetos" no próximo tick, como antes.
# Quem o chamava por SSH era o pre-push do PC (dev/tools/trigger-graphify.ps1),
# perdido em 25/09/2026; fica para o PC novo e para disparo manual. Instalado
# em ~/workspace/scripts/run-graphify.sh.
set -eu
# SSH do pre-push é sessão não interativa: sem ~/.local/bin no PATH, o plugin
# rtk-rewrite do Hermes não acha o rtk e avisa a cada chamada.
export PATH="$HOME/.local/bin:$PATH"
if systemctl --user is-enabled --quiet graphify-projetos.timer 2>/dev/null; then
  # --no-block: a rodada leva até 1 h; quem chamou (SSH) não espera por ela.
  exec systemctl --user start --no-block graphify-projetos.service
fi
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
