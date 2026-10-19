#!/bin/sh
# Religa o que o Dell precisa de pé: painel do Hermes, Central, code-server e n8n (a cada 30 s).
#
# Teto (auditoria de 19/10/2026, HC-4/DELL-8): antes reiniciava sem limite e sem espera, a cada
# 30 s, mesmo o que o Rômulo parou de propósito. Agora, por serviço:
#  - no máximo MAX_REINICIOS em JANELA_S (3 em 10 min); passou disso só registra uma vez no journal
#    e deixa a verificação do dell-status acusar a falha (o socorro e o Rômulo decidem o resto);
#  - carência de CARENCIA_S (90 s) depois de cada reinício: o serviço precisa de tempo para subir, e
#    sem ela o laço de 30 s reiniciava um serviço que ainda estava subindo;
#  - ~/.local/state/dell-status/pausa-<serviço> (squadone-operations, hermes-dashboard, code-server,
#    n8n) pausa o religamento daquele serviço de propósito, como a pausa dos timers.
# O gateway do Hermes saiu daqui: o hermes-gateway.service tem Restart=always, então o systemd já o
# sobe quando cai, e o healthwatch só conseguia desfazer uma parada de propósito (exit 78 =
# RestartPreventExitStatus, ou o `stop` para trocar o chip) a cada 30 s. O socorro tem o remédio dele.
#
# As linhas "healthwatch: restarting|starting X" são lidas pelo dell-status (RELIGOU): não mude o formato.
set -u

ESTADO="$HOME/.local/state/healthwatch"
PAUSAS="$HOME/.local/state/dell-status"
MAX_REINICIOS=3
JANELA_S=600
CARENCIA_S=90

mkdir -p "$ESTADO" 2>/dev/null || { ESTADO="${XDG_RUNTIME_DIR:-/tmp}/healthwatch"; mkdir -p "$ESTADO"; }

# 0 se o serviço está pausado de propósito.
pausado() {
  [ -e "$PAUSAS/pausa-$1" ]
}

# Instantes (epoch) dos reinícios deste serviço dentro da janela, um por linha.
reinicios_recentes() {
  [ -f "$ESTADO/$1.reinicios" ] || return 0
  awk -v limite="$(( $(date +%s) - JANELA_S ))" '$1 >= limite' "$ESTADO/$1.reinicios"
}

# 0 se o último reinício foi há menos de CARENCIA_S.
em_carencia() {
  ultimo="$(reinicios_recentes "$1" | tail -n 1)"
  [ -n "$ultimo" ] && [ $(( $(date +%s) - ultimo )) -lt "$CARENCIA_S" ]
}

# 0 se já atingiu o teto da janela. Registra a recusa uma vez (a marca .teto sai quando o serviço responde).
no_teto() {
  n="$(reinicios_recentes "$1" | wc -l)"
  [ "$n" -ge "$MAX_REINICIOS" ] || return 1
  if [ ! -e "$ESTADO/$1.teto" ]; then
    : > "$ESTADO/$1.teto"
    printf '%s\n' "healthwatch: not restarting $1 ($n religamentos em $((JANELA_S / 60)) min; deixo para o dell-status e o socorro)"
  fi
  return 0
}

registrar_reinicio() {
  { reinicios_recentes "$1"; date +%s; } > "$ESTADO/$1.reinicios.tmp" && mv "$ESTADO/$1.reinicios.tmp" "$ESTADO/$1.reinicios"
}

# $1 nome na mensagem, $2 url de saúde, $3 unit do systemd
check_user_service() {
  name="$1"
  url="$2"
  service="$3"
  chave="${service%.service}"

  pausado "$chave" && return 0
  em_carencia "$chave" && return 0

  if curl -fsS --max-time 8 "$url" >/dev/null; then
    rm -f "$ESTADO/$chave.teto"
    return 0
  fi

  sleep 3
  if curl -fsS --max-time 8 "$url" >/dev/null; then
    rm -f "$ESTADO/$chave.teto"
    return 0
  fi

  no_teto "$chave" && return 0

  printf '%s\n' "healthwatch: restarting $name"
  registrar_reinicio "$chave"
  systemctl --user restart "$service"
}

check_n8n() {
  pausado n8n && return 0
  em_carencia n8n && return 0

  if curl -fsS --max-time 8 http://127.0.0.1:5679/healthz >/dev/null; then
    rm -f "$ESTADO/n8n.teto"
    return 0
  fi

  sleep 3
  if curl -fsS --max-time 8 http://127.0.0.1:5679/healthz >/dev/null; then
    rm -f "$ESTADO/n8n.teto"
    return 0
  fi

  no_teto n8n && return 0

  running="$(docker inspect -f '{{.State.Running}}' licitacoes-automation-n8n-1 2>/dev/null || true)"
  if [ "$running" = 'true' ]; then
    printf '%s\n' 'healthwatch: restarting licitacoes n8n'
    registrar_reinicio n8n
    docker restart licitacoes-automation-n8n-1 >/dev/null
    return
  fi

  # --no-deps: sem ele o compose sobe também o que o n8n declara em depends_on (o collector do Radar
  # PNCP, pausado de propósito desde 11/10/2026) e o religamento do n8n revivia o que estava pausado.
  printf '%s\n' 'healthwatch: starting licitacoes n8n compose service'
  registrar_reinicio n8n
  docker compose -f "$HOME/licitacoes-automation/docker-compose.yml" up -d --no-deps n8n >/dev/null
}

while :; do
  check_user_service Hermes http://127.0.0.1:9119/api/status hermes-dashboard.service || true
  check_user_service Operations http://127.0.0.1:9120/api/runtime squadone-operations.service || true
  check_user_service code-server http://127.0.0.1:8080/healthz code-server.service || true
  check_n8n || true
  sleep 30
done
