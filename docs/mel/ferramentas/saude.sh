#!/bin/bash
# Checagem de saúde da Mel (somente leitura). Sai com 1 se algo falhar.
# Uso: saude.sh [rotulo]
ROT="${1:-}"; FAIL=0
TS=ts.net
HOST=romulo-sutil-corr-a-latitude-7420.tail20cfb0.$TS
ok()  { printf '  %-34s ok   %s\n' "$1" "$2"; }
bad() { printf '  %-34s FALHA %s\n' "$1" "$2"; FAIL=1; }
code() { curl -sk -o /dev/null -m 8 -w '%{http_code}' "$1" 2>/dev/null; }

echo "== saude ${ROT} $(date +%H:%M:%S)"
# Central
c=$(code http://127.0.0.1:9120/);              [ "$c" = 200 ] && ok "Central 127.0.0.1:9120" "$c" || bad "Central 127.0.0.1:9120" "$c"
c=$(code http://127.0.0.1:9120/crm);           [ "$c" = 200 ] && ok "Central /crm" "$c" || bad "Central /crm" "$c"
c=$(code https://$HOST:8443/);                 [ "$c" = 200 ] && ok "Central pela tailnet :8443" "$c" || bad "Central pela tailnet :8443" "$c"
# n8n
c=$(code http://127.0.0.1:5679/healthz);       [ "$c" = 200 ] && ok "n8n /healthz" "$c" || bad "n8n /healthz" "$c"
c=$(code https://$HOST/webhook/saude-teste);   case "$c" in 200|404|405) ok "n8n /webhook pela tailnet" "$c";; *) bad "n8n /webhook pela tailnet" "$c";; esac
st=$(docker inspect -f '{{.State.Status}}' licitacoes-automation-n8n-1 2>/dev/null); [ "$st" = running ] && ok "container n8n" "$st" || bad "container n8n" "$st"
# Hermes
c=$(code http://127.0.0.1:9119/);              [ "$c" = 200 ] && ok "Hermes 9119" "$c" || bad "Hermes 9119" "$c"
# Containers
n=$(docker ps -q | wc -l); h=$(docker ps --format '{{.Status}}' | grep -c healthy)
[ "$n" = 12 ] && [ "$h" = 7 ] && ok "containers" "$n Up, $h healthy" || bad "containers" "$n Up, $h healthy (esperado 12/7)"
# systemd
fu=$(systemctl --user --failed --no-pager --no-legend | wc -l); fs=$(systemctl --failed --no-pager --no-legend | wc -l)
[ "$fu" = 0 ] && [ "$fs" = 0 ] && ok "unidades falhas (user/sistema)" "$fu/$fs" || bad "unidades falhas (user/sistema)" "$fu/$fs"
hw=$(systemctl --user is-active dell-worker-healthwatch); [ "$hw" = active ] && ok "healthwatch" "$hw" || bad "healthwatch" "$hw"
# Drive (só leitura de estado; nada de rclone)
bs=$(backup-dell status 2>&1)
echo "$bs" | grep -Eq '^(cofre|consultoria|ensaio|entregas|sites)[[:space:]]+ok' && ! echo "$bs" | grep -Eiq 'falha|atrasad|aten' \
  && ok "backup-dell status" "$(echo "$bs" | grep -cE '^[a-z]+ +ok') blocos ok" || bad "backup-dell status" "$(echo "$bs" | grep -Ei 'falha|atrasad|aten' | head -1)"
r=$(systemctl --user show silmer-drive-sync.service -p Result --value); t=$(systemctl --user is-active silmer-drive-sync.timer)
[ "$r" = success ] && [ "$t" = active ] && ok "silmer-drive-sync" "result=$r timer=$t" || bad "silmer-drive-sync" "result=$r timer=$t"
for u in backup-dell-espelho backup-dell-cofre; do
  tt=$(systemctl --user is-active $u.timer); rr=$(systemctl --user show $u.service -p Result --value)
  [ "$tt" = active ] && [ "$rr" = success ] && ok "$u" "timer=$tt result=$rr" || bad "$u" "timer=$tt result=$rr"
done
# Tailscale serve (3 linhas) e SSH
s=$(tailscale serve status | grep -c proxy); [ "$s" = 3 ] && ok "tailscale serve" "$s linhas" || bad "tailscale serve" "$s linhas"
# SquadOne de produção intocado
b=$(git -C ~/SquadOne rev-parse --abbrev-ref HEAD); d=$(git -C ~/SquadOne status --porcelain | wc -l)
[ "$b" = main ] && [ "$d" = 7 ] && ok "~/SquadOne (branch/sujos)" "$b / $d" || bad "~/SquadOne (branch/sujos)" "$b / $d (esperado main / 7)"
[ -f ~/auto-site/CLAUDE.md ] && ok "auto-site/CLAUDE.md" "" || bad "auto-site/CLAUDE.md" "ausente"

[ $FAIL = 0 ] && echo "== RESULTADO: TUDO OK" || echo "== RESULTADO: HÁ FALHAS"
exit $FAIL
