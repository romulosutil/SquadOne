#!/usr/bin/env bash
# Bootstrap estável; a implementação versionada acompanha o checkout.
set -euo pipefail
programa="$HOME/SquadOne/deploy/dell/atualizar_central.py"
if [ ! -f "$programa" ]; then
  echo 'Atualizador versionado ausente; revisão manual necessária.' >&2
  exit 1
fi
exec python3 "$programa" "$@"
