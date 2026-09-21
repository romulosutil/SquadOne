#!/usr/bin/env bash
set -u

failures=0
warnings=0

ok() { printf 'OK   %s\n' "$1"; }
warn() { printf 'WARN %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

check_user_service() {
  local unit=$1
  if systemctl --user is-active --quiet "$unit"; then
    ok "systemd $unit ativo"
  else
    fail "systemd $unit inativo"
  fi
}

check_http() {
  local label=$1
  local url=$2
  if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null; then
    ok "$label responde em $url"
  else
    fail "$label não responde em $url"
  fi
}

check_container() {
  local container=$1
  local state
  state=$(docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || true)
  if [[ "$state" == running ]]; then
    ok "container $container em execução"
  else
    fail "container $container ausente ou em estado ${state:-desconhecido}"
  fi
}

check_user_service hermes-gateway.service
check_user_service hermes-dashboard.service
check_user_service hermes-google-browser.service
check_user_service squadone-operations.service
check_user_service code-server.service

check_http 'Hermes' 'http://127.0.0.1:9119/api/status'
check_http 'n8n' 'http://127.0.0.1:5679/healthz'
check_http 'SquadOne' 'http://127.0.0.1:9120/api/runtime'
check_http 'Chromium CDP' 'http://127.0.0.1:9222/json/version'

check_container licitacoes-automation-n8n-1
check_container licitacoes-automation-collector-1
check_container licitacoes-automation-db-1

if docker inspect licitacoes-automation-db-1 >/dev/null 2>&1; then
  credential_count=$(docker exec licitacoes-automation-db-1 \
    psql -U n8n -d n8n -Atc 'select count(*) from credentials_entity;' 2>/dev/null || true)
  workflow_counts=$(docker exec licitacoes-automation-db-1 \
    psql -U n8n -d n8n -Atc 'select count(*), count(*) filter (where active) from workflow_entity;' 2>/dev/null || true)
  execution_count=$(docker exec licitacoes-automation-db-1 \
    psql -U n8n -d n8n -Atc 'select count(*) from execution_entity;' 2>/dev/null || true)

  if [[ "$credential_count" =~ ^[0-9]+$ ]] && (( credential_count > 0 )); then
    ok "n8n possui $credential_count credencial(is) armazenada(s)"
  else
    warn 'n8n não possui credenciais; OAuth ainda não foi concluído'
  fi

  if [[ "$workflow_counts" =~ ^([0-9]+)\|([0-9]+)$ ]]; then
    total=${BASH_REMATCH[1]}
    active=${BASH_REMATCH[2]}
    if (( active > 0 )); then
      ok "n8n possui $active de $total workflow(s) ativo(s)"
    else
      warn "n8n possui $total workflow(s), todos inativos"
    fi
  else
    warn 'não foi possível contar workflows do n8n'
  fi

  if [[ "$execution_count" =~ ^[0-9]+$ ]]; then
    if (( execution_count > 0 )); then
      ok "n8n registra $execution_count execução(ões)"
    else
      warn 'n8n ainda não registra execuções'
    fi
  else
    warn 'não foi possível contar execuções do n8n'
  fi
fi

if gh auth status >/dev/null 2>&1; then
  ok 'GitHub CLI autenticado'
else
  warn 'GitHub CLI sem autenticação válida'
fi

if syncthing cli config dump-json 2>/dev/null | jq -e '.folders | length > 0' >/dev/null; then
  ok 'Syncthing possui pastas configuradas'
else
  warn 'Syncthing sem pastas configuradas ou CLI indisponível'
fi

printf '\nResumo: %d falha(s), %d aviso(s).\n' "$failures" "$warnings"
(( failures == 0 ))
