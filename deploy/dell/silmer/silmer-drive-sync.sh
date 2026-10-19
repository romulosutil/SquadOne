#!/usr/bin/env bash
# Sincroniza ~/Silmer com o Drive (rclone bisync). Roda pelo silmer-drive-sync.timer, a cada 15 min.
#
# Auditoria de 19/10/2026 (DELL-9): depois de QUALQUER falha o ciclo seguinte rodava
# `--resync --resync-mode newer`, que reconstrói a base e anula o `--max-delete`. Se o que falhou foi
# justamente a trava de apagamento (rclone: "Safety abort: too many deletes"), o ciclo seguinte aplicava
# as exclusões que a trava segurou. Agora a falha por max-delete PARA o sync (marca parado-max-delete) e
# avisa; só volta depois que o Rômulo confere o que ia ser apagado e remove a marca. As outras falhas
# seguem com o resync automático de antes.
#
# Atenção: no bisync `--max-delete` é PERCENTUAL (10 = 10% dos arquivos), não contagem.
set -Eeuo pipefail
export RCLONE_CONFIG="${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"
ROOT="$HOME/Silmer"
STATE_DIR="$HOME/.local/state/silmer-drive-sync"
MARKER="$STATE_DIR/resync-required"
PARADO="$STATE_DIR/parado-max-delete"
SAIDA="$STATE_DIR/ultima-saida.log"
LIB_DE_AVISO="$HOME/.local/lib/mel/aviso.py"
mkdir -p "$STATE_DIR" "$HOME/.local/share/silmer-sync-deleted/local"

# Fila de avisos pela lib única (deploy/dell/lib/aviso.py, instalada em ~/.local/lib/mel/). Nunca derruba o script.
avisar() {
  [ -f "$LIB_DE_AVISO" ] || { echo "(sem a lib de aviso em $LIB_DE_AVISO; aviso não enviado)" >&2; return 0; }
  python3 - "$LIB_DE_AVISO" "$1" "$2" "$3" <<'PY' || true
import importlib.util, sys
spec = importlib.util.spec_from_file_location("mel_aviso", sys.argv[1])
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)
lib.avisar(sys.argv[2], sys.argv[3], "silmer-drive-sync", chave=sys.argv[4], prioridade=1)
PY
}

AVISO_PARADO="O sync da pasta Silmer com o Drive parou: o rclone recusou apagar muitos arquivos de uma vez (--max-delete). Nada foi apagado. Confira o que sumiu em ~/Silmer ou no Drive (cópias em ~/.local/share/silmer-sync-deleted e gdrive-silmer:.sync-deleted) e, se estiver certo, apague $PARADO: o próximo ciclo refaz a base (resync) e volta ao normal. Peça ao Claude se tiver dúvida."

if [[ -e "$PARADO" ]]; then
  echo "Silmer sync parado desde $(cat "$PARADO"): falta conferir os apagamentos e remover $PARADO." >&2
  avisar "Silmer sync parado" "$AVISO_PARADO" "silmer-drive-sync:max-delete"  # a chave limita a 1 por dia
  exit 0
fi

if /usr/bin/find "$ROOT" \( -type d \( -name .git -o -name .agents -o -name .codex \) -prune \) -o \( -type f -mmin -2 -print -quit \) | /usr/bin/grep -q .; then
  echo "Silmer sync deferred: a synced local file changed within the last two minutes."
  exit 0
fi
args=(
  --workdir "$HOME/.cache/rclone/bisync-silmer"
  --create-empty-src-dirs
  --max-delete 10
  --resilient
  --recover
  --conflict-loser num
  --backup-dir1 "$HOME/.local/share/silmer-sync-deleted/local"
  --backup-dir2 "gdrive-silmer:.sync-deleted/drive"
  --exclude '/.git/**'
  --exclude '/.agents/**'
  --exclude '/.codex/**'
  --exclude '**/.git/**'
  --exclude '**/.agents/**'
  --exclude '**/.codex/**'
  --exclude '/.sync-deleted/**'
  --exclude '**/.sync-deleted/**'
  --log-level INFO
  --stats 1m
  --stats-one-line
)
if [[ ! -e "$MARKER" || -s "$MARKER" ]]; then
  args+=(--resync --resync-mode newer)
fi

# A saída vai ao journal e a um arquivo (para saber POR QUE falhou); PIPESTATUS guarda o código do rclone.
set +e
/usr/bin/rclone bisync "$ROOT" gdrive-silmer: "${args[@]}" 2>&1 | tee "$SAIDA"
rc=${PIPESTATUS[0]}
set -e

if [[ "$rc" -eq 0 ]]; then
  : > "$MARKER"
  exit 0
fi

if /usr/bin/grep -qiE 'too many deletes|safety abort' "$SAIDA"; then
  date '+%Y-%m-%d %H:%M' > "$PARADO"
  printf '%s\n' 'Parado pela trava de apagamentos; sem resync automatico.' > "$MARKER"
  avisar "Silmer sync parado" "$AVISO_PARADO" "silmer-drive-sync:max-delete"
else
  printf '%s\n' 'The last bisync run failed; the next run will rebuild its baseline.' > "$MARKER"
fi
exit 1
