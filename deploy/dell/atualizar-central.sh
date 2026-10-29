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
# O que vale como "atualizado" é o sha CONSTRUÍDO (~/.local/state/atualizar-central/construido),
# gravado só depois do build, do reinício e de /api/runtime responder. Comparar com o HEAD
# do clone não serve: o merge vem antes do npm install/testes/build, então uma falha ali
# deixava HEAD == origin/main e o ciclo seguinte saía calado, com a Central presa na versão
# velha (HC-1, auditoria de 19/10/2026). Assim o timer retenta a cada 10 min até construir.
#
# Com --se-mudou (o timer atualizar-central.timer, a cada 10 min) sai calado
# quando o construído já é a main, e uma falha vira aviso na fila do dell-status,
# que chega pelo Telegram (desde 16/10/2026, OT-14; o WhatsApp é só a reserva).
# A chave do aviso é o sha da main: a fila descarta a repetida por 24 h, então
# uma main que não constrói avisa uma vez, não a cada tentativa.
#
# Só roda install/testes/build e reinicia o serviço se algo que entra no build mudou
# entre o construído e a main: tudo, menos docs/, ops/, prototypes/, *.md e deploy/
# (exceto os dois arquivos de deploy/dell que o servidor lê). Mudança só de
# documentação não derruba um turno do Assistente nem o bot. src/ conta porque o
# dist/ é gerado dele.
set -euo pipefail

CLONE="$HOME/SquadOne"
URL="http://127.0.0.1:9120/api/runtime"
FILA="$HOME/.local/share/avisos/fila"
ESTADO="$HOME/.local/state/atualizar-central"
CONSTRUIDO="$ESTADO/construido"
SE_MUDOU=0
[ "${1:-}" = "--se-mudou" ] && SE_MUDOU=1
DETALHE=""

# Para o texto do JSON: uma linha, sem barra invertida nem aspas soltas.
em_uma_linha() { printf '%s' "$1" | tr '\n\t' '  ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

avisar_falha() {
  [ "$SE_MUDOU" = 1 ] || return 0
  mkdir -p "$FILA"
  local extra=""
  [ -n "$DETALHE" ] && extra=" $(em_uma_linha "$DETALHE")."
  printf '{"titulo": "Central não atualizou", "texto": "O atualizar-central falhou depois de um push na main.%s Veja: journalctl --user -u atualizar-central -n 50", "origem": "atualizar-central", "chave": "atualizar-central:%s"}\n' \
    "$extra" \
    "$(git -C "$CLONE" rev-parse --short origin/main 2>/dev/null || echo sem-commit)" \
    > "$FILA/atualizar-central-$(date +%Y%m%d%H%M%S).json"
}
trap avisar_falha ERR

cd "$CLONE"
[ -f .env ] || { echo "Falta $CLONE/.env: o build precisa do VITE_GOOGLE_CLIENT_ID." >&2; false; }

git fetch -q origin
alvo=$(git rev-parse origin/main)
construido=$(cat "$CONSTRUIDO" 2>/dev/null || true)
if [ "$SE_MUDOU" = 1 ] && [ "$construido" = "$alvo" ]; then
  exit 0
fi

# Em variável, para o aviso dizer QUAIS arquivos não rastreados travaram o merge.
if ! saida_do_merge=$(git merge -q --ff-only origin/main 2>&1); then
  echo "$saida_do_merge" >&2
  # "error: The following untracked working tree files would be overwritten by merge:" e um nome por linha, com tab.
  lista=$(printf '%s\n' "$saida_do_merge" | sed -n 's/^[[:space:]]\+\([^[:space:]].*\)$/\1/p' || true)
  # Só os 10 primeiros: a fila recusa texto acima de 4000 caracteres, e em 28/10/2026 uma
  # colisão de ~200 arquivos virou 43 avisos recusados que nunca chegaram (dell-status, fila-avisos).
  total=$(printf '%s' "$lista" | grep -c . || true)
  nomes=$(printf '%s\n' "$lista" | head -n 10 | paste -sd, - || true)
  [ "${total:-0}" -gt 10 ] && nomes="$nomes e mais $((total - 10))"
  if [ -n "$nomes" ]; then
    DETALHE="O merge parou por arquivos não rastreados que colidem: $nomes"
  else
    DETALHE="O merge não avançou: $(printf '%s' "$saida_do_merge" | tail -n 1)"
  fi
  false
fi
echo "Código em $(git log -1 --format='%h %s')"

# Algo que entra no build mudou desde o último construído? Sem construído conhecido (primeira vez,
# arquivo apagado, sha que o clone não tem) ou numa rodada manual sem mudança: constrói tudo.
muda_o_build=1
if [ -n "$construido" ] && [ "$construido" != "$alvo" ] && git cat-file -e "${construido}^{commit}" 2>/dev/null; then
  mudados=$(git diff --name-only "$construido" HEAD)
  relevantes=$(printf '%s\n' "$mudados" | grep -Ev '^(docs|ops|prototypes)/|\.md$|^deploy/' || true)
  lidos_pelo_servidor=$(printf '%s\n' "$mudados" | grep -E '^deploy/dell/(claude-ops/prumo-ofertas\.json|entrada/pagina\.html)$' || true)
  [ -n "$relevantes$lidos_pelo_servidor" ] || muda_o_build=0
fi

gravar_construido() {
  mkdir -p "$ESTADO"
  git rev-parse HEAD > "$ESTADO/construido.tmp"
  mv "$ESTADO/construido.tmp" "$CONSTRUIDO"
}

if [ "$muda_o_build" = 0 ] && curl -sf -m 5 "$URL" >/dev/null; then
  echo "Só documentação/deploy mudou desde o construído; sem build nem reinício."
  gravar_construido
  exit 0
fi

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
    gravar_construido
    echo "Central no ar: $(curl -s "$URL")"
    exit 0
  fi
  sleep 1
done
echo "A Central não respondeu em 30 s." >&2
journalctl --user -u squadone-operations.service -n 30 --no-pager >&2
false
