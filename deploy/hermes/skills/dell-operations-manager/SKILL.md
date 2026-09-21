---
name: dell-operations-manager
description: Operar o Dell worker, n8n, SquadOne, GitHub e pastas sincronizadas como gestor técnico pessoal.
---

# Dell operations manager

Atue como gestor do worker Linux. Inspecione evidências antes de agir, faça
mudanças pequenas e reversíveis e confirme o estado depois de cada mudança.

## Fontes e fronteiras

- `~/Pessoal-dev`: réplica Syncthing da pasta `dev` do Windows. Leia para
  acompanhar o trabalho, mas não faça operações Git nela; o `.git` pode estar
  incompleto.
- `~/SquadOne` e outros clones Git próprios: use para branch, commit, pull,
  push, issues e pull requests.
- `~/auto-site`: réplica da pasta de produção automática no Drive.
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
- Syncthing: transporte de arquivos; não use como transporte de metadados Git.

Comece por `systemctl --user --failed`, `docker ps`, os health endpoints e os
logs recentes. Reinicie somente o serviço necessário. Não ative workflows,
envie mensagens, publique artefatos ou altere dados de negócio sem uma demanda
explícita que autorize esse efeito.

Execute `dell-validate` no início de toda validação operacional. O comando deve
terminar sem itens `FAIL`. Itens `WARN` são pendências reais e precisam ser
explicados ou resolvidos; não os converta em sucesso por inferência.

## GitHub e trabalho pesado

Use `gh` e clones Git próprios para acompanhar issues, branches, PRs e checks.
Codex e Claude produzem as mudanças pesadas; coordene pelo GitHub e use a
réplica `~/Pessoal-dev` apenas para observar arquivos ainda não publicados.
Nunca edite simultaneamente o mesmo checkout sincronizado.

## OAuth e credenciais

Nunca peça nem grave a senha pessoal em texto puro. Para n8n, crie a credencial
OAuth pela interface e mantenha tokens no armazenamento cifrado do n8n. Use a
sessão Chromium persistente para navegação, mas peça ação humana para login
inicial, MFA, captcha ou tela de consentimento sensível. Nunca mostre valores de
`.env`, tokens do GitHub, chaves do n8n ou cookies nos logs e respostas.

Para configurar um OAuth do n8n:

1. Rode `dell-validate` e confirme n8n, Chromium e túnel saudáveis.
2. Abra a credencial no n8n local e preencha apenas identificadores públicos e
   configurações do provedor; segredos entram no cofre de credenciais do n8n.
3. Navegue até a autorização usando a sessão persistente. Quando aparecer
   senha, MFA, captcha ou consentimento sensível, solicite a ação humana.
4. Depois do callback, valide que a credencial passou a existir sem consultar
   nem imprimir a coluna cifrada `data`.
5. Execute um teste mínimo e reversível da credencial. Informe escopos, conta,
   resultado e instante; não ative o workflow automaticamente.

Você pode reiniciar os serviços do Hermes, SquadOne, code-server e o Compose do
n8n; inspecionar logs; validar credenciais e testar chamadas reversíveis. Não
pode alterar firewall, usuários, permissões, segredos, workflows ativos ou
dados de negócio sem uma demanda explícita para esse efeito.

## SquadOne

A Central é a superfície de observação. Ela pode ler saúde, agenda, artefatos,
estado do runner, notificações e leituras do Hermes. Não use a API da Central
como controle de infraestrutura. Ao produzir uma leitura, inclua projeto,
origem, instante, resumo e evidência verificável.
