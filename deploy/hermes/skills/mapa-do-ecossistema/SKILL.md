---
name: mapa-do-ecossistema
description: Onde cada coisa do Rômulo roda (PC e celular, nuvem, Dell, externos) e os sete caminhos que atravessam tudo, com onde olhar quando um deles falha. Use para responder "onde roda X?", "por que Y não chegou?", para ligar um aviso ao caminho certo e antes de montar o pedido para o Claude ou o Codex.
---

# Mapa do ecossistema

Vem do design "Estrutura do SquadOne" (24/09/2026), conferido no Dell em
25/09/2026, atualizado em 28/09/2026 com a perda do PC, em 29/09/2026 com o
que entrou no Dell nesse dia, em 05/10/2026 com o PC novo e em 11/10/2026 com a
auditoria da Mel (pausas, n8n geral, units versionadas). O mapa diz
**onde procurar**; a verdade é a
fonte viva (`systemctl --user`, n8n, `status.json`, `cron/jobs.json`). Mapa e
fonte divergindo é notícia: diga qual divergência viu e deixe o Claude ou o Codex
atualizarem o mapa (fonte versionada: `SquadOne/deploy/hermes/`).

## Quem faz o quê

| Quem | Papel |
|---|---|
| Claude e Codex | controlam e corrigem a partir do PC novo; o que instala e mexe no Dell roda numa sessão no Dell |
| Hermes (você) | informa pelo WhatsApp |
| n8n do Dell | gerencia os fluxos do PRUMO, do Site antes da venda, do CRM e do Radar PNCP; todo fluxo termina respondendo a alguém. Silmer e Food Helper **não** estão nele (ficam no n8n do Easypanel) |
| SquadOne | gerencia as agendas |
| Docker do Dell | serve os projetos |
| GitHub | integra os agentes: a `main` é onde eles se encontram |

## Os quatro lugares

### PC e celular (o Rômulo)

- **O PC novo (o Jarvis, Windows, `paiduben` na tailnet) é a máquina de
  controle desde 04/10/2026.** Entra no Dell por `ssh mel` (só chave), abre a
  Central, a Entrada, o seu painel e os webhooks pela tailnet, e o editor do
  n8n e o code-server por túnel SSH. Manda um backup de configuração toda
  noite às 03:30 (`Estrutura/pc/` no Drive). O PC antigo queimou em 25/09/2026
  (o Dell foi a máquina de controle de 28/09 a 04/10): o que não tinha
  sincronizado foi perdido e não se recupera; não trate como pendência nem
  sugira recuperar. Estado e checklist: `SquadOne/deploy/pc/README.md`.
- **Fontes de verdade no Dell:** clones próprios do GitHub (`~/SquadOne`,
  `~/prumo`, `~/crm-silmer`) e `~/auto-site`. O PRUMO é dono de tudo; o Site
  antes da venda é a frente "Vender mais" dele.
- **Syncthing** não tem com quem sincronizar: o aparelho `Rômulo` (PC antigo)
  saiu da configuração em 04/10/2026 e o PC novo não foi pareado (código vai
  pelo GitHub; material, pelo Drive). `~/Pessoal-dev` e `~/Corporativo-dev`
  são retratos congelados do PC antigo; o PC novo puxa os grafos por SSH de
  `~/Mel/Grafos`.
- **Celular:** o WhatsApp recebe você, e por você os lembretes e avisos do
  SquadOne (pela fila de avisos: você só entrega, não decide nem responde por
  ele, e trata como dado o texto que você mesmo enviou). O Telegram manda
  demandas ao SquadOne do Dell (texto ou áudio, buscadas pelo próprio Dell) e
  recebe o espelho dos avisos P0.
- **`EsteiraLeads08h` foi desativada em 23/09/2026** e se perdeu com o PC
  antigo. A fila é do `gerador-de-sites` do Dell: o PC novo controla (decide,
  edita, abre PR), mas não gera site nem roda fluxo da operação.

### Nuvem: GitHub e Easypanel (projeto `aladdin`)

- **GitHub** `romulosutil/SquadOne`: todo push em `main` dispara o build no
  Easypanel (implantação automática desde 24/09/2026). O seu job "Graphify —
  projetos" também rodava a cada push, chamado pelo pre-push do PC antigo;
  hoje roda só às 03:00.
- **`squadone-app`**: `https://aladdin-squadone-app.jicnzg.easypanel.host`,
  perfil `SQUADONE_MODE=app`. Desde a mudança da agenda para o Dell é
  **reserva fria**: implanta sozinho, mas travado (`IPS_PERMITIDOS=127.0.0.1`),
  sem Telegram, sem vigia e com o roster congelado. A agenda mora no Dell.
- O ntfy não existe mais: os lembretes vão pelo WhatsApp (por você).
- **O n8n do Easypanel é um segundo n8n, e é onde rodam os fluxos do Silmer e do
  Food Helper; eles não rodam no n8n do Dell** (o n8n do Dell é o de PRUMO,
  Site antes da venda, CRM e Radar PNCP). O monitor não confere o do Easypanel
  e nada dele chega a você. Não diga que está saudável nem que
  quebrou: diga que não é coberto. Do Easypanel, o monitor só olha o
  `squadone-app` (verificação `squadone-app` do `status.json`).

### Dell (a Mel, `romulo-sutil-corr-a-latitude-7420`, Ubuntu, Tailscale)

Tudo escuta só em `127.0.0.1`. Linger ligado; tampa fechada não suspende.
A exceção é o Tailscale Serve, só para aparelhos da tailnet:
`https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net` publica o seu
painel (`/`, porta 9119) e os webhooks do n8n (`/webhook`). Fora da tailnet
não abre; no celular, só com o Tailscale ligado.

| Porta | Serviço |
|---|---|
| 9120 | Central do SquadOne (`squadone-operations.service`, perfil operations: Central em `/`, app em `/squadone`, credencial do Google própria, separada da produção) |
| 9119 | Hermes (painel e bridge do WhatsApp) |
| 5679 | n8n geral da Mel (Docker, `~/licitacoes-automation`: PRUMO, Site antes da venda, CRM e Radar PNCP; não é o do Silmer nem o do Food Helper) |
| 8080 | code-server |

Unidades `systemctl --user`:

| Unidade | Quando | O que faz |
|---|---|---|
| `dell-status.timer` | 1 min | grava o `status.json` da Central; avisa por você quando algo quebra, a cada 12 h enquanto continuar quebrado e quando volta; esvazia a fila de avisos. Suas rotinas: verificação `crons` (falha) e, desde 29/09/2026, uma `cron:<id>` por rotina, que acusa atraso de mais de 30 min |
| `gerador-de-sites.timer` | 08h, persistente (pausado em 10/10/2026 por causa do limite do Claude; **religado em 11/10/2026**, próxima rodada 08:00) | até 4 leads por dia, 45 min cada, Claude Code + Vercel; de 24 a 28/09/2026 terminou entre 09:17 e 10:17. Dell desligado às 08h: roda quando voltar. Resumo em `~/auto-site/.logs/status.json`; desde 29/09/2026 a falha vira aviso por você pela verificação `gerador` do `dell-status`, e lead que o Claude descarta no meio não derruba mais a rodada |
| `auto-entrada.path` | ao chegar pacote | o n8n não cria pastas: materializa em `~/auto-site` os pacotes que o Caçador deixa |
| `site-antes-venda-watcher.service` | contínuo | avisa pelo WhatsApp quando um lead é publicado |
| `whatsapp-observador.service` | contínuo | lê o `bridge.log` da sua bridge (sem o conteúdo das mensagens); resposta de lead das planilhas avisa o n8n. Só vê **respostas** de leads, nunca o envio do Rômulo |
| `pncp-catchup.timer` | 08h, persistente (**desligado em 11/10/2026**, `disabled`) | refaz a coleta do PNCP se o n8n perdeu a das 07:30; `systemctl --user enable --now pncp-catchup.timer` volta |
| `dell-worker-healthwatch.service` | contínuo | confere por HTTP os serviços do usuário |
| `atualizar-central.timer` | 10 min | quando a `main` do SquadOne anda, avança o clone `~/SquadOne` (só fast-forward) e refaz a Central, que roda dele; falha vira aviso por você |
| `backup-dell-espelho.timer` | a cada hora, :05 | espelho só de leitura no Drive: `PRUMO/Sites antes da venda` (de `~/auto-site`), `PRUMO/Consultoria` (de `~/prumo`, 1x ao dia) e `PRUMO/Entregas` (de `~/prumo-entregas`, os rascunhos do Mapa, 1x ao dia) |
| `backup-dell-cofre.timer` | 03:30, persistente | cofre restic cifrado em `Backups/dell-worker` (home, n8n e chave, Hermes); manutenção semanal e ensaio de restauração mensal, que avisa por você |

| `silmer-drive-sync.timer` | a cada 5 min | `rclone bisync` de `~/Silmer` com o Drive (`gdrive-silmer:`); adia se algum arquivo mudou nos últimos 2 min. É só a pasta do Silmer: os fluxos dele não estão no n8n do Dell |
| `hermes-gateway`, `hermes-dashboard`, `hermes-google-browser` | contínuo | você (gateway do WhatsApp, painel em `127.0.0.1:9119` e o Chromium headless do acesso ao Google, porta de depuração 9222) |
| `code-server.service` | contínuo | o IDE em `127.0.0.1:8080` (`~/workspace`) |

O backup roda desde 29/09/2026 (primeiro espelho e primeiro cofre feitos à mão
nesse dia, depois os timers). O kit de recuperação do cofre fica com o Rômulo.
As units desta tabela estão versionadas em `deploy/dell/` (e as do Hermes em
`deploy/hermes/units/`) e entram no `instalados.json`.

Suas rotinas que tocam o ecossistema (todas em `~/.hermes/cron/jobs.json`):

- **Sites e pendências**, 10:30, sem modelo (`sites_e_pendencias.py`): o
  resultado do gerador do dia e o que espera o Rômulo (pendências do n8n e do
  `dell-status`), com os links que vêm nos dados. Troca o briefing das 08h,
  que saía antes do gerador.
- **Graphify — projetos**, 03:00, sem modelo: `~/SquadOne`, `~/prumo`,
  `~/auto-site` e `~/crm-silmer`; só falha vira mensagem.
- **Pausadas desde 11/10/2026** (`paused` em `hermes cron list`; não retome por
  conta própria, `hermes cron resume <id>` volta): **ASMR FULLBRINGER**
  (briefing diário `d12b6431a2e6`; a revisão de 24/48h e a coleta também
  estão pausadas) e **Radar diário de licitações** (`f6e7da0f8558`). Pausa não
  é falha: não avise que sumiram.

Docker Compose em `~/licitacoes-automation`: `n8n` (credenciais OAuth
cifradas no próprio n8n), `db` (Postgres 17, banco do n8n) e `collector` do
radar PNCP (grava o que coleta em `data/`, ao lado). O `n8n` é o **geral da
Mel** (PRUMO, Site antes da venda, CRM e Radar PNCP), por isso nunca se para
por causa do radar. A pasta não é um checkout git: compose, scripts e o fluxo
estão em `SquadOne/deploy/dell/licitacoes-automation/` e o `.env` fica só no Dell.

Outros containers no `docker ps` da Mel em 11/10/2026 (Postgres/MySQL/Redis/MinIO
de `p4f`, `iris`, `espectro`, `aladdin`, `crm-silmer`, mais `moneyprinterturbo`):
uma parada dos ociosos está **em andamento em 11/10/2026**; o estado final
não está confirmado neste mapa, confira com `docker ps`. Parar ou apagar é
decisão do Rômulo, não sua.

Fluxos do n8n (cada um é a verificação `fluxo:<id>` do `status.json`):

| Fluxo | Gatilho | Papel |
|---|---|---|
| 00 · Avisar falha pelo Hermes | erro de qualquer fluxo | o Error Workflow único: falha vira aviso na fila |
| PRUMO — Clique em Enviar convite | webhook `convite` | marca a Etapa e abre o WhatsApp |
| PRUMO — Diagnóstico do dono | a cada 1 h | fecha o Índice PRUMO e avisa por você |
| 01 · Caçador | 06h | grava leads e pacotes para o gerador |
| 03 · Balcão (Site antes da venda) | a cada 1 h, :10 | lê os `publicado.json` e monta a mensagem com o link |
| 04 · Clique no wa_link | webhook `enviar` | marca o lead como enviado |
| WhatsApp — números dos leads | webhook | entrega ao observador os telefones a vigiar |
| WhatsApp — conversa com lead | webhook | o observador chama quando um lead responde; marca sozinho |
| Radar PNCP — coleta diária | 07:30 | só dispara a coleta; não espera o PNCP (pausa em 11/10/2026: ver Licitações abaixo) |

`PRUMO — Preparar planilha` fica desligado de propósito (manual). `PRUMO — Lead
Scout (review-first)` também, desde 08/10/2026: o convite frio a distribuidoras
deu 57 convites, 21 respostas de robô e nenhum dono interessado. A empresa com
equipe chega pela CDL ou pede o Mapa (grátis) depois do Raio-X; a Fonte só vem
depois do Mapa. O fluxo continua no n8n, inativo; os scripts
`claude-ops/prumo-*.py` não o religam (`n8n.DESLIGADOS`). Não sugira religar.

Links rastreados (`wa_link` do Site antes da venda, "Enviar convite" do
PRUMO) passam pelo webhook do n8n: o clique marca o envio e abre o WhatsApp.
Desde 29/09/2026 usam o endereço da tailnet (`https://...ts.net/webhook/...`),
que abre no celular com o Tailscale ligado; antes era `http://127.0.0.1:5679`,
que só abria no Dell. Link com `127.0.0.1` que ainda aparecer é da leva antiga. Nunca monte um link:
use o que está na planilha ou nos dados.

Follow-up e vencimento dos leads (desde 29/09/2026): o fluxo "05 · Acompanhamento"
(09h) manda aviso com o texto de follow-up no 3º dia sem resposta e marca
`expirado` no 10º; vale para leads enviados a partir de 29/09. A resposta do
lead preenche `respondeu_em` (mensagem 5 min ou mais depois do envio; antes
disso é saudação automática do WhatsApp Business) e a pasta vai para
`_em-conversa`. Toda segunda às 08h, "06 · Funil" manda o funil por nicho e
pausa sozinho na aba Buscas (`ativa` FALSE, com `pausada_em` e `pausa_motivo`):
a busca (segmento × cidade) e o nicho inteiro com 20+ enviados sem sinal de
compra (interesse, pedido de preço, proposta ou ganho; negativa e robô não
contam), e a busca com 5+ enviados sem resposta humana. Envio só conta depois
de 3 dias. O aviso diz quais nichos pararam e por quê; o gerador pula os leads
novos do que pausou. Religar é o Rômulo pôr TRUE em `ativa`.

Syncthing no Dell (sem aparelho pareado desde 04/10/2026, nenhuma pasta tem com quem sincronizar):

- `~/Pessoal-dev`: réplica de `dev/PESSOAL`, congelada em 25/09/2026.
  Contexto para você; não é fronteira Git. Desde 30/09/2026 sem as cópias de
  SquadOne e prumo (o que era só delas está em `~/Arquivo/2026-09-30/pc-2509`).
- `~/PRUMO` (desde 30/09/2026): índice com atalhos para as pastas de verdade,
  com os nomes do Drive, e um `LEIA-ME.md` com o mapa. Para dizer ao Rômulo
  onde algo está, use os nomes de lá.
- `~/Corporativo-dev`: somente leitura, último retrato de 25/09/2026.
- `~/auto-site`: os sites do Site antes da venda, a pasta de verdade. Não depende
  mais do Syncthing: o `backup-dell` a espelha no Drive (`PRUMO/Sites antes da
  venda`). A antiga `auto` do Drive virou `auto (até 25-09)`.

Backup no Drive (desde 28/09/2026, `SquadOne/deploy/dell/backup/`): o PRUMO é
dono de tudo, então o negócio fica em `PRUMO/` (espelhos só de leitura: editar
no Drive é desfeito) e o cofre cifrado do Dell em `Backups/dell-worker`. O
estado está em `~/.local/state/backup-dell/status.json` e nas verificações
`backup:*` do `status.json`. `backup-dell status` resume. Falhou: diga qual
fonte e o detalhe, e peça ao Claude. Nunca rode backup, restauração ou ensaio
por conta própria.

### Externos

- **Google Calendar e Tasks:** o Calendar é a fonte de verdade das quests do
  SquadOne; o Tasks guarda passos e tarefas avulsas, uma lista por squad.
- **Gemini:** uma chamada por turno do SquadOne; mais uma se ele trocar de
  squad ou se a demanda vier em áudio.
- **Telegram Bot API:** webhook com segredo no header e allowlist de chat.
- **Places, Sheets e Drive:** leads e planilha do PRUMO; no Drive, `PRUMO/`
  (espelhos do Dell) e `Backups/dell-worker` (cofre).
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
- **Lembretes:** a vigia do SquadOne no Dell roda a cada 60 s, olha os
  próximos 12 min e grava um aviso na fila (`~/.local/share/avisos/fila`) 10
  min antes de cada bloco e de cada prazo; o dell-status o entrega por você. A
  fila descarta a mesma chave em 24 h (redeploy não repete) e o aviso vencido
  (o horário passou) não sai. App fora do ar durante a janela inteira perde o
  aviso.
- **Ajuste de tempo** é o único fluxo que edita uma quest já criada, e só
  com aprovação na tela.
- Você pode ler a agenda; quem marca é o SquadOne.

## Os sete caminhos, e onde olhar quando um falha

1. **Demanda:** o SquadOne (tailnet, `/squadone`) ou o Telegram → SquadOne
   no Dell (`squadone-operations`, 127.0.0.1:9120) → Gemini decide a intenção
   → servidor escolhe o horário → Calendar e Tasks. Falhou: diga o sintoma e
   peça ao Claude conferir o `squadone-operations` no Dell. Você não roda
   turno nem escolhe squad.
2. **Lembrete:** vigia a cada 60 s → próximos 12 min → fila de avisos →
   dell-status → você → WhatsApp 10 min antes. Não chegou: "Fila de avisos" e
   "Sessão do WhatsApp" no `status.json`; o evento foi criado pelo SquadOne
   (os de fora não avisam)? Bloco de dia inteiro não avisa. O Dell inteiro
   sumiu: quem avisa é o healthchecks.io, não você.
3. **Código:** push em `main` → GitHub → Easypanel implanta; o
   `atualizar-central` puxa a `main` para o clone `~/SquadOne` e seu job
   refaz o grafo dos clones às 03:00 (sem o pre-push do PC antigo, é o único
   disparo). Falhou: seu job
   "Graphify — projetos" em `cron/jobs.json`. Dois merges seguidos podem
   cancelar o primeiro build: se o app não mudou, peça ao Claude conferir as
   Implantações no Easypanel.
4. **Saúde do Dell:** `dell-status` a cada minuto → `status.json` → Central
   `:9120`; se quebrou ou voltou → `hermes send` → WhatsApp. `status.json`
   com mais de 5 min: o próprio monitor parou.
5. **PRUMO:** prospect da CDL na planilha (o Lead Scout está desligado) → clique em Enviar convite →
   convite no WhatsApp → observador lê a resposta → Etapa avança na planilha.
   Pendências em `pend:prumo-*` do `status.json`.
6. **Site antes da venda:** Caçador 06h → `auto-entrada` → `gerador-de-sites`
   08h → Vercel publica (`publicado.json`) → Balcão monta o link → 10:30 você
   manda "Sites e pendências" → clique no wa_link marca enviado. O wa_link
   abre no celular só quando é o da tailnet (ver "Links rastreados"). O site
   aparece em até 1 h em `PRUMO/Sites antes da venda` no Drive (espelho do
   backup). Status: skill `site-antes-da-venda`. Falhou: verificação
   `gerador` do `status.json`, `~/auto-site/.logs/status.json`,
   `journalctl --user -u gerador-de-sites -n 50` e o `falha.log` na pasta do
   lead (2 falhas tiram o lead da fila). Sem login do Claude o runner avisa e
   não toca na fila. Pendências em `pend:sites-fila`, `pend:site-*`.
7. **Licitações (pausado em 11/10/2026, ver "Pausado em 11/10/2026" em
   `deploy/dell/README.md`):** a rotina do Hermes e o `pncp-catchup.timer` já
   estão pausados; o fluxo `Radar PNCP — coleta diária` e o container
   `licitacoes-automation-collector-1` seguem de pé até o n8n poder ser
   reiniciado com folga. Não religue nem pare nada disso por conta própria, e
   nunca pare o `licitacoes-automation-n8n-1`/`db` (são o n8n geral). Reverter:
   `hermes cron resume f6e7da0f8558`, `systemctl --user enable --now
   pncp-catchup.timer`; com o collector parado,
   `docker update --restart=unless-stopped licitacoes-automation-collector-1 &&
   docker start licitacoes-automation-collector-1`. Fluxo de antes da pausa:
   n8n às 07:30 → `POST /collect` responde 202 com um
   `collection_id` → collector busca o PNCP em segundo plano → estado em
   `GET /collections/:id` e resultado em
   `~/licitacoes-automation/data/latest-run.json`. `pncp-catchup` às 08h cobre
   a coleta perdida. `status: source_unavailable` é o PNCP fora do ar, não
   defeito nosso. Verificação `pncp` do `status.json`.

Em todos: você lê, diagnostica e entrega o pedido pronto (ver SOUL). Não
reinicia, não roda fluxo, não mexe em fila nem em planilha.
