#!/usr/bin/env bash
set -Eeuo pipefail
export HOME=/home/romulo-sutil-corr-a
export RCLONE_CONFIG="$HOME/.config/rclone/rclone.conf"
ROOT="$HOME/Silmer"
STATE_DIR="$HOME/.local/state/silmer-drive-sync"
MARKER="$STATE_DIR/resync-required"
mkdir -p "$STATE_DIR" "$HOME/.local/share/silmer-sync-deleted/local"
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
if /usr/bin/rclone bisync "$ROOT" gdrive-silmer: "${args[@]}"; then
  : > "$MARKER"
else
  printf '%s\n' 'The last bisync run failed; the next run will rebuild its baseline.' > "$MARKER"
  exit 1
fi
