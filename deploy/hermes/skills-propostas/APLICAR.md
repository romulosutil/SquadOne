# Curadoria das skills do Hermes (proposta de 09/10/2026)

Nada aqui foi aplicado no Dell. Backup já feito: `~/skills-backup-20261009.tar.gz`.

## Passo 1 — fundir as três skills de integração
Do PC (OpenSSH do Windows):

    scp deploy/hermes/skills-propostas/personal-workspace-integration/SKILL.md mel:/tmp/pwi.SKILL.md
    ssh mel 'cd ~/.hermes/skills/productivity && mkdir -p personal-workspace-integration/references ~/.hermes/skills-quarentena-20261009 && cp -n personal-workspace-integrations/references/* oauth-first-integrations/references/* personal-workspace-integration/references/ && cp /tmp/pwi.SKILL.md personal-workspace-integration/SKILL.md && mv personal-workspace-integrations oauth-first-integrations ~/.hermes/skills-quarentena-20261009/'

## Passos seguintes (ainda não preparados)
2. `agent-quality-improvement` (nunca vista): mover para a quarentena.
3. `creator-content-intelligence` → fundir em `youtube-channel-analysis`.
4. Enxugar `n8n-workflow-deployment` (17 patches) e `youtube-channel-analysis` (11).
5. Guardas: confirmação no `sudo tailscale serve` de `private-worker-access`; "teste nunca toca dado real" em `file-pipeline-monitoring` e `site-antes-da-venda`; `repository-stewardship` fora de `~/SquadOne`.

Rotina "SquadOne — aprender e evoluir": manter desligada (ver relatório da sessão).
