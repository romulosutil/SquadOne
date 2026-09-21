#!/bin/sh
set -u

check_user_service() {
  name="$1"
  url="$2"
  service="$3"

  if curl -fsS --max-time 8 "$url" >/dev/null; then
    return 0
  fi

  sleep 3
  if curl -fsS --max-time 8 "$url" >/dev/null; then
    return 0
  fi

  printf '%s\n' "healthwatch: restarting $name"
  systemctl --user restart "$service"
}

check_n8n() {
  if curl -fsS --max-time 8 http://127.0.0.1:5679/healthz >/dev/null; then
    return 0
  fi

  sleep 3
  if curl -fsS --max-time 8 http://127.0.0.1:5679/healthz >/dev/null; then
    return 0
  fi

  running="$(docker inspect -f '{{.State.Running}}' licitacoes-automation-n8n-1 2>/dev/null || true)"
  if [ "$running" = 'true' ]; then
    printf '%s\n' 'healthwatch: restarting licitacoes n8n'
    docker restart licitacoes-automation-n8n-1 >/dev/null
    return
  fi

  printf '%s\n' 'healthwatch: starting licitacoes n8n compose service'
  docker compose -f "$HOME/licitacoes-automation/docker-compose.yml" up -d n8n >/dev/null
}

check_gateway() {
  if systemctl --user is-active --quiet hermes-gateway.service; then
    return 0
  fi

  printf '%s\n' 'healthwatch: restarting Hermes gateway'
  systemctl --user restart hermes-gateway.service
}

while :; do
  check_gateway || true
  check_user_service Hermes http://127.0.0.1:9119/api/status hermes-dashboard.service || true
  check_user_service Operations http://127.0.0.1:9120/api/runtime squadone-operations.service || true
  check_user_service code-server http://127.0.0.1:8080/healthz code-server.service || true
  check_n8n || true
  sleep 30
done
