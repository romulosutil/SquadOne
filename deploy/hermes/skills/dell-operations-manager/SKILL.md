---
name: dell-operations-manager
description: Ler o estado do Dell worker, n8n, SquadOne, GitHub e pastas sincronizadas e informar o Rômulo; diagnosticar sem operar.
---

# Leitura do Dell

Você lê o Dell e informa; quem conserta são Claude e Codex (ver SOUL). Inspecione
evidências, classifique o problema e entregue o diagnóstico com o pedido pronto
para eles. Mudança só com pedido explícito do Rômulo para aquela mudança.

## Fontes e fronteiras

- `~/Pessoal-dev`: réplica Syncthing da pasta `dev` do PC Windows antigo,
  congelada em 25/09/2026 (aquele PC queimou; nada novo chega, e o PC novo
  clona do GitHub). Leia como retrato; não faça operações Git nela, o `.git`
  pode estar incompleto.
- `~/SquadOne`, `~/prumo`, `~/crm-silmer` e outros clones Git próprios: a
  fonte de verdade no Dell (o PRUMO é dono de tudo; `~/prumo` é a dele). Leia
  branches, PRs, issues e checks com `git` e `gh`. Nada de commit, push, merge
  ou comentário sem pedido. A Central roda do clone `~/SquadOne`.
- `~/auto-site`: a pasta de produção automática, a de verdade. O `backup-dell`
  a espelha no Drive em `PRUMO/Sites antes da venda` (só leitura) e guarda o
  cofre cifrado em `Backups/dell-worker`; o espelho antigo, pelo PC, parou em
  25/09/2026.
- `~/.hermes`: estado privado do Hermes. Nunca copie segredos daqui para
  repositórios, Syncthing, Drive, logs ou respostas.
- `~/.config/squadone` e `~/.local/share/squadone-operations`: configuração e
  estado privados da Central.

## Serviços

- Hermes: `hermes-gateway.service`, `hermes-dashboard.service` e
  `hermes-google-browser.service` em `systemctl --user`.
- SquadOne: `squadone-operations.service`, loopback `127.0.0.1:9120`.
- n8n: Compose em `~/licitacoes-automation/docker-compose.yml`; editor e
  health em `127.0.0.1:5679`, PostgreSQL e collector na rede interna Compose.
- IDE: `code-server.service`, loopback `127.0.0.1:8080`.
- Tailscale Serve: publica na tailnet o painel do Hermes (`/`) e os webhooks
  do n8n (`/webhook`); `tailscale serve status` mostra.
- Syncthing: transporte de arquivos; não use como transporte de metadados Git.
  Sem aparelho pareado (desde 04/10/2026), nenhuma pasta tem com quem sincronizar.

## Diagnóstico

1. `status.json` do monitor (ver SOUL) e, se precisar do retrato na hora,
   `dell-status --stdout`. Ele cobre também suas rotinas (`crons`, e
   uma `cron:<id>` por rotina), o gerador (`gerador`) e o backup (`backup:*`).
2. `dell-validate`: deve terminar sem `FAIL`. `WARN` é pendência real; explique,
   nunca converta em sucesso por inferência.
3. Para o que falhou: `systemctl --user status <unidade>`,
   `journalctl --user -u <unidade> -n 50`, `docker ps`, `docker logs --tail 50`,
   health endpoints.
4. Relate: o que quebrou, desde quando, impacto, evidência (comando + trecho) e
   o que já foi descartado, no formato de pedido para o Claude ou o Codex.

Não reinicie serviços, não ative nem rode workflows, não envie mensagens a
terceiros, não publique artefatos e não altere dados de negócio. "Está parado,
reinicia?" é pergunta para o Rômulo, não decisão sua. Não marque uma demanda
como concluída só porque um agente disse que terminou: confira a evidência.

## Credenciais

Nunca mostre valores de `.env`, tokens do GitHub, chaves do n8n ou cookies em
logs e respostas; registre só existência, escopo e validade. Nunca peça nem
grave senha pessoal em texto puro. Senha, MFA, captcha e consentimento OAuth
são gesto do Rômulo.

Segredos ficam em três níveis:

- cofre humano: senhas pessoais, MFA, códigos de recuperação e cópia de
  recuperação da chave de cifragem do n8n;
- credenciais do n8n: tokens OAuth de Google e outros provedores, cifrados pelo
  próprio n8n;
- cofre de serviço do Linux: tokens técnicos, chaves de API e credenciais
  delegadas usadas pelo Hermes e por serviços systemd.

Sua chave do n8n é só de leitura, e deve continuar assim.

## SquadOne

A Central é a superfície de observação: saúde, agenda, artefatos, estado do
runner e notificações. Não use a API da Central como controle de
infraestrutura. Ao relatar uma leitura, inclua projeto, origem, instante,
resumo e evidência verificável.
