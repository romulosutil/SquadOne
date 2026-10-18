#!/usr/bin/env bash
# Atualiza a Central do SquadOne no Dell a partir da main do GitHub.
#
# A Central roda do clone ~/SquadOne desde 28/09/2026. Antes rodava da réplica
# Syncthing ~/Pessoal-dev/SquadOne, que congelou quando o PC queimou. O .env
# (VITE_GOOGLE_CLIENT_ID entra no build; TOKEN_ENC_KEY abre o data/google-auth.json)
# e o data/ ficam fora do Git, no próprio clone.
#
# Só avança em fast-forward: commit local não enviado faz o script parar em vez
# de mesclar sozinho.
#
# Com --se-mudou (o timer atualizar-central.timer, a cada 10 min) sai calado
# quando a main não andou, e uma falha vira aviso na fila do dell-status, que
# chega pelo WhatsApp do Hermes.
set -euo pipefail

CLONE="$HOME/SquadOne"
URL="http://127.0.0.1:9120/api/runtime"
FILA="$HOME/.local/share/avisos/fila"
SE_MUDOU=0
[ "${1:-}" = "--se-mudou" ] && SE_MUDOU=1

avisar_falha() {
  [ "$SE_MUDOU" = 1 ] || return 0
  mkdir -p "$FILA"
  printf '{"titulo": "Central não atualizou", "texto": "O atualizar-central falhou depois de um push na main. Veja: journalctl --user -u atualizar-central -n 50", "origem": "atualizar-central", "chave": "atualizar-central:%s"}\n' \
    "$(git -C "$CLONE" rev-parse --short origin/main 2>/dev/null || echo sem-commit)" \
    > "$FILA/atualizar-central-$(date +%Y%m%d%H%M%S).json"
}
trap avisar_falha ERR

cd "$CLONE"
[ -f .env ] || { echo "Falta $CLONE/.env: o build precisa do VITE_GOOGLE_CLIENT_ID." >&2; false; }

git fetch -q origin
if [ "$SE_MUDOU" = 1 ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
  exit 0
fi
git merge -q --ff-only origin/main
echo "Código em $(git log -1 --format='%h %s')"

# Sem package-lock: o projeto versiona bun.lock, e o Dell não tem bun.
npm install --no-package-lock --no-audit --no-fund
# Permissões POSIX não são verificáveis no Windows. Na Dell estes testes são
# obrigatórios antes de substituir o build ou reiniciar a Central.
./node_modules/.bin/tsx --test server/lead-quente-sombra.test.ts server/roster-historico.test.ts
npm run build

# Não reinicia no meio de um turno (ou com a fila do bot andando): o turno pode
# já ter criado eventos no Google, e a resposta perdida leva a reenviar e
# duplicar. Espera `ocupado: false` em /api/runtime por até 10 min; depois
# disso reinicia assim mesmo (um turno não passa de ~6 min, então é travamento).
# Central fora do ar, ou versão sem o campo, conta como ociosa.
ESPERA_OCIOSA_S=600
for i in $(seq 0 10 "$ESPERA_OCIOSA_S"); do
  # Em variável, não `curl | grep -q`: com pipefail, o grep saindo cedo faria o
  # curl falhar (SIGPIPE) e o pipeline leria "ociosa" com a Central ocupada.
  runtime=$(curl -sf -m 5 "$URL" || true)
  case "$runtime" in *'"ocupado":true'*) ;; *) break ;; esac
  if [ "$i" -ge "$ESPERA_OCIOSA_S" ]; then
    echo "A Central seguiu ocupada por $((ESPERA_OCIOSA_S / 60)) min; reiniciando assim mesmo." >&2
    break
  fi
  [ "$i" = 0 ] && echo "Central ocupada (turno ou fila do bot); esperando ficar ociosa..."
  sleep 10
done
systemctl --user restart squadone-operations.service

for _ in $(seq 1 30); do
  if curl -sf "$URL" >/dev/null; then
    echo "Central no ar: $(curl -s "$URL")"
    exit 0
  fi
  sleep 1
done
echo "A Central não respondeu em 30 s." >&2
journalctl --user -u squadone-operations.service -n 30 --no-pager >&2
false
