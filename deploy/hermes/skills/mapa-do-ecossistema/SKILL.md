---
name: mapa-do-ecossistema
description: Onde cada coisa do Rômulo roda (PC e celular, nuvem, Dell, externos) e os sete caminhos que atravessam tudo, com onde olhar quando um deles falha. Use para responder "onde roda X?", "por que Y não chegou?", para ligar um aviso ao caminho certo e antes de montar o pedido para o Claude ou o Codex.
---

# Mapa do ecossistema

Vem do design "Estrutura do SquadOne" (24/09/2026), conferido no Dell em
25/09/2026 e atualizado em 28/09/2026 com a perda do PC. O mapa diz **onde
procurar**; a verdade é a fonte viva (`systemctl --user`, n8n, `status.json`,
`cron/jobs.json`). Mapa e fonte
divergindo é notícia: diga qual divergência viu e deixe o Claude ou o Codex
atualizarem o mapa (fonte versionada: `SquadOne/deploy/hermes/`).

## Quem faz o quê

| Quem | Papel |
|---|---|
| Claude e Codex | controlam e corrigem; sem PC, rodam no próprio Dell |
| Hermes (você) | informa pelo WhatsApp |
| n8n do Dell | gerencia os fluxos; todo fluxo termina respondendo a alguém |
| SquadOne | gerencia as agendas |
| Docker do Dell | serve os projetos |
| GitHub | integra os agentes: a `main` é onde eles se encontram |

## Os quatro lugares

### PC e celular (o Rômulo)

- **Não há PC desde 25/09/2026.** O PC Windows 11 queimou (NVMe) e não volta;
  o Rômulo soube em 28/09. O que não tinha sincronizado com o Dell nem ido ao
  GitHub foi perdido e não se recupera: não trate como pendência nem sugira
  recuperar. Um PC novo está a caminho e vai receber a organização do
  SquadOne; até lá **o Dell é a máquina de controle**: Claude Code e Codex
  rodam nele, sem túnel. Estado e checklist: `SquadOne/deploy/pc/README.md`.
- **Syncthing** não tem mais com quem sincronizar: `~/Pessoal-dev`,
  `~/Corporativo-dev` e o grafo que você gera ficam no Dell. O aparelho
  `Rômulo` ainda aparece desconectado na configuração até o PC novo chegar;
  isso não é falha nova.
- **Celular:** ntfy recebe os lembretes do SquadOne; o Telegram manda
  demandas ao SquadOne (texto ou áudio); o WhatsApp recebe você.
- **`EsteiraLeads08h` foi desativada em 23/09/2026** e se perdeu com o PC. A
  fila é do `gerador-de-sites` do Dell. Documento ou resposta dizendo que o PC
  gera ou controla algo está desatualizado.

### Nuvem: GitHub e Easypanel (projeto `aladdin`)

- **GitHub** `romulosutil/SquadOne`: todo push em `main` dispara o build no
  Easypanel (implantação automática desde 24/09/2026). O seu job "Graphify —
  projetos" também rodava a cada push, chamado pelo pre-push do PC; sem PC,
  roda só às 03:00.
- **`squadone-app`**: `https://aladdin-squadone-app.jicnzg.easypanel.host`,
  perfil `SQUADONE_MODE=app`, atrás do Traefik e do porteiro de IP. O volume
  `/app/data` guarda só `squad.json` (os agentes e o treino deles) e
  `google-auth.json` (refresh cifrado). Sem banco.
- **ntfy próprio** (serviço `ntfy` no `aladdin`): push dos lembretes.
- **O n8n do Easypanel (Silmer, Food Helper) não é do Dell.** O monitor não o
  confere e nada dele chega a você. Não diga que está saudável nem que
  quebrou: diga que não é coberto. Do Easypanel, o monitor só olha o
  `squadone-app` (verificação `squadone-app` do `status.json`).

### Dell (`dell-worker`, Ubuntu, Tailscale)

Tudo escuta só em `127.0.0.1`. Linger ligado; tampa fechada não suspende.

| Porta | Serviço |
|---|---|
| 9120 | Central do SquadOne (`squadone-operations.service`, perfil operations: Central em `/`, app em `/squadone`, credencial do Google própria, separada da produção) |
| 9119 | Hermes (painel e bridge do WhatsApp) |
| 5679 | n8n (Docker, `~/licitacoes-automation`) |
| 8080 | code-server |

Unidades `systemctl --user`:

| Unidade | Quando | O que faz |
|---|---|---|
| `dell-status.timer` | 1 min | grava o `status.json` da Central; avisa por você quando algo quebra, a cada 12 h enquanto continuar quebrado e quando volta; esvazia a fila de avisos |
| `gerador-de-sites.timer` | 08h, persistente | até 4 leads por dia, 45 min cada, Claude Code + Vercel. Dell desligado às 08h: roda quando voltar |
| `auto-entrada.path` | ao chegar pacote | o n8n não cria pastas: materializa em `~/auto-site` os pacotes que o Caçador deixa |
| `site-antes-venda-watcher.service` | contínuo | avisa pelo WhatsApp quando um lead é publicado |
| `whatsapp-observador.service` | contínuo | lê o `bridge.log` da sua bridge (sem o conteúdo das mensagens); resposta de lead das planilhas avisa o n8n. Só vê **respostas** de leads, nunca o envio do Rômulo |
| `pncp-catchup.timer` | 08h, persistente | refaz a coleta do PNCP se o n8n perdeu a das 07:30 |
| `dell-worker-healthwatch.service` | contínuo | confere por HTTP os serviços do usuário |
| `hermes-gateway`, `hermes-dashboard`, `hermes-google-browser` | contínuo | você |

Docker Compose em `~/licitacoes-automation`: `n8n` (credenciais OAuth
cifradas no próprio n8n), `db` (Postgres 17, banco do n8n) e `collector` do
radar PNCP (grava o que coleta em `data/`, ao lado).

Fluxos do n8n (cada um é a verificação `fluxo:<id>` do `status.json`):

| Fluxo | Gatilho | Papel |
|---|---|---|
| 00 · Avisar falha pelo Hermes | erro de qualquer fluxo | o Error Workflow único: falha vira aviso na fila |
| PRUMO — Lead Scout (review-first) | 09h | rodízio segmento × cidade no Places, até 60 resultados por execução |
| PRUMO — Clique em Enviar convite | webhook `convite` | marca a Etapa e abre o WhatsApp |
| PRUMO — Diagnóstico do dono | a cada 1 h | fecha o Índice PRUMO e avisa por você |
| 01 · Caçador | 06h | grava leads e pacotes para o gerador |
| 03 · Balcão (Site antes da venda) | a cada 1 h, :10 | lê os `publicado.json` e monta a mensagem com o link |
| 04 · Clique no wa_link | webhook `enviar` | marca o lead como enviado |
| WhatsApp — números dos leads | webhook | entrega ao observador os telefones a vigiar |
| WhatsApp — conversa com lead | webhook | o observador chama quando um lead responde; marca sozinho |
| Radar PNCP — coleta diária | 07:30 | só dispara a coleta; não espera o PNCP |

`PRUMO — Preparar planilha` fica desligado de propósito (manual).

Syncthing no Dell (sem o PC, nenhuma pasta tem com quem sincronizar):

- `~/Pessoal-dev`: réplica de `dev/PESSOAL`, congelada em 25/09/2026.
  Contexto para você; não é fronteira Git.
- `~/Corporativo-dev`: somente leitura, último retrato de 25/09/2026.
- `~/auto-site`: os sites do Site antes da venda. É a pasta de verdade e a
  única cópia completa; o espelho em `G:\Meu Drive\auto` parou em 25/09/2026
  com o PC. A esteira não depende do Drive e segue rodando.

### Externos

- **Google Calendar e Tasks:** o Calendar é a fonte de verdade das quests do
  SquadOne; o Tasks guarda passos e tarefas avulsas, uma lista por squad.
- **Gemini:** uma chamada por turno do SquadOne; mais uma se ele trocar de
  squad ou se a demanda vier em áudio.
- **Telegram Bot API:** webhook com segredo no header e allowlist de chat.
- **Places, Sheets e Drive:** leads e planilha do PRUMO; pasta `auto` (parada
  em 25/09/2026, sem PC para espelhar).
- **PNCP:** portal de licitações que o radar consulta.
- **Vercel:** publica os sites do gerador.

## O SquadOne por dentro

Para responder sobre agenda sem abrir código:

- **Turno:** entrada (CommandBar ou Telegram) → porteiro de IP → `turno.ts`
  (resolve squad e janela antes de gastar token e Gemini) → orquestrador (o
  roster da squad ativa é o prompt; se o modelo apontar outra squad, o
  servidor troca e reprocessa **uma** vez) → capacidades (`agendar_evento`,
  `criar_tarefa`, contratar, `sugerir_troca_squad`) → Google.
- **O modelo decide a intenção; o servidor escolhe o horário**, na grade de
  15 min, dentro da janela de trabalho. Modos: Auto (o modelo escolhe entre
  foco e prazo), Foco (primeiro horário livre em até 14 dias corridos), Baixa
  prioridade (até o fim do 7º dia útil, por último na série).
- **Tarefa sem horário** ("comprar leite") vira item no Google Tasks, sem
  evento: não aparece na Mochila nem gera lembrete.
- **Lembretes:** a vigia roda a cada 60 s, olha os próximos 12 min e publica
  no ntfy 10 min antes de cada bloco e de cada prazo. A deduplicação vive só
  em memória: redeploy nesses 10 min pode repetir um aviso; app fora do ar
  durante a janela inteira perde o aviso.
- **Ajuste de tempo** é o único fluxo que edita uma quest já criada, e só
  com aprovação na tela.
- Você pode ler a agenda; quem marca é o SquadOne.

## Os sete caminhos, e onde olhar quando um falha

1. **Demanda:** CommandBar ou Telegram → `squadone-app` → Gemini decide a
   intenção → servidor escolhe o horário → Calendar e Tasks.
   Falhou: verificação `squadone-app` do `status.json`. Log do Easypanel você
   não lê: diga o sintoma e peça ao Claude conferir o app no Easypanel.
2. **Lembrete:** vigia a cada 60 s → próximos 12 min → ntfy → celular 10 min
   antes. Não chegou: o `squadone-app` estava no ar na janela? O evento foi
   criado pelo SquadOne (os de fora não avisam)? Bloco de dia inteiro não
   avisa.
3. **Código:** push em `main` → GitHub → Easypanel implanta; ao mesmo tempo
   você refaz o grafo (fica no Dell; sem PC não volta para lugar nenhum).
   Sem o pre-push do PC, só o horário das 03:00 dispara. Falhou: seu job
   "Graphify — projetos" em `cron/jobs.json`. Dois merges seguidos podem
   cancelar o primeiro build: se o app não mudou, peça ao Claude conferir as
   Implantações no Easypanel.
4. **Saúde do Dell:** `dell-status` a cada minuto → `status.json` → Central
   `:9120`; se quebrou ou voltou → `hermes send` → WhatsApp. `status.json`
   com mais de 5 min: o próprio monitor parou.
5. **PRUMO:** Lead Scout 09h → Places e planilha → clique em Enviar convite →
   convite no WhatsApp → observador lê a resposta → Etapa avança na planilha.
   Pendências em `pend:prumo-*` do `status.json`.
6. **Site antes da venda:** Caçador 06h → `auto-entrada` → `gerador-de-sites`
   08h → Vercel publica (`publicado.json`) → Balcão monta o link → clique no
   wa_link marca enviado. O wa_link é `127.0.0.1:5679`: sem PC, só abre no
   navegador do próprio Dell. O espelho no Drive parou em 25/09/2026. Status: skill
   `site-antes-da-venda`. Falhou: `journalctl --user -u gerador-de-sites -n 50`
   e o `falha.log` na pasta do lead (2 falhas tiram o lead da fila). Sem
   `~/.config/claude-ops/gerador.env` o runner avisa e não toca na fila.
   Pendências em `pend:sites-fila`, `pend:site-*`.
7. **Licitações:** n8n às 07:30 → `POST /collect` responde 202 com um
   `collection_id` → collector busca o PNCP em segundo plano → estado em
   `GET /collections/:id` e resultado em
   `~/licitacoes-automation/data/latest-run.json`. `pncp-catchup` às 08h cobre
   a coleta perdida. `status: source_unavailable` é o PNCP fora do ar, não
   defeito nosso. Verificação `pncp` do `status.json`.

Em todos: você lê, diagnostica e entrega o pedido pronto (ver SOUL). Não
reinicia, não roda fluxo, não mexe em fila nem em planilha.
