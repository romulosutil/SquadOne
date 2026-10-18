# Persistência, autenticação, porteiro e variáveis de ambiente

> Movido do `CLAUDE.md` em 11/10/2026 para a sessão não carregar isto toda vez.
> O texto é o original, sem alteração; o `CLAUDE.md` guarda só o resumo das regras.

## Persistência

Volume Docker do Easypanel montado em `/app/data`; no Dell, `~/.local/share/squadone` (`SQUADONE_DATA_DIR`, fora do clone, mais o `telegram-offset.json` do polling). Onde a tabela diz `data/`, leia "o diretório de dados". Poucos KB:

| Arquivo | Conteúdo |
|---|---|
| `data/squad.json` | roster v3 `{ version: 3, squads, idsAposentados }` = os agentes com seu treino; inclui arquivados (`arquivado`, `arquivadoEm`); `tasksListaId` opcional por squad (lista do Google Tasks, lazy) |
| `data/google-auth.json` | `refresh_token` cifrado em AES-256-GCM e o `scope` concedido (Calendar, e Tasks quando autorizado) |
| `data/squad.v2.bak.json` | texto cru do roster v2, gravado uma vez pela migração; nunca sobrescrito |
| `data/historico/squad.<AAAA-MM-DDTHHMMSSZ>.json` | derivado, modo 600: o `squad.json` ANTERIOR a cada gravação do roster (`server/roster-historico.ts`), para voltar atrás de uma edição ou arquivamento. Poda: ficam as 30 mais recentes ou as dos últimos 90 dias, o que guardar mais. Só com `SQUADONE_DATA_DIR` definida e o roster não congelado: sem a env (dev, Easypanel) ou com `SQUADONE_ROSTER_CONGELADO=true` nenhuma pasta é criada. Falha ao copiar ou podar vai ao log (uma vez por tipo) e não impede a gravação. Restaurar: `deploy/dell/backup/RESTAURAR.md`, seção "Roster"; listar e comparar: `npx tsx scripts/conferir-roster.ts --historico <dados> [--diff <a> <b>]` |

Medições em sombra, só no Dell e só ligadas: `luna-sombra/<AAAA-MM>.jsonl` e `jev-sombra/<AAAA-MM>.jsonl` (600, pastas 700, dentro do `SQUADONE_DATA_DIR`; sem a demanda em claro por padrão; o do Jev também é a fonte do teto de gasto, somado no boot — apagar a pasta zera esse contador). Ver `perfis-e-experimentos.md`.

No Dell (perfil `operations`) há também `SQUADONE_OPERATIONS_DATA_DIR/financas.db` (SQLite só das finanças, 600, migrações numeradas) e a `financas.copia.db` que cada sincronização grava com `VACUUM INTO` para o cofre restic. Nada disso existe no Easypanel.

**Migração.** `readRoster()` detecta a versão pela **forma** (`squads` → v3, `dominios` → v2, `members` → v1), grava o backup do texto cru, converte (v2 inteiro vira a squad `pessoal`, ids intactos) e escreve v3. Forma desconhecida ou conversão que não passa na validação lança `RosterIlegivel` (500) e **não grava** `squad.json`. Migração e semeadura rodam sob promessa única: no boot `/api/squad` e `/api/mochila` chegam juntos.

**Rollback da Fase 1.** O código anterior não lê v3 (todo `/api/squad` vira 500). Para reverter, **nesta ordem**:

1. No Easypanel, implantar o commit anterior à Fase 1. Entre este passo e o próximo o roster responde 500.
2. No console do container: `cp /app/data/squad.v2.bak.json /app/data/squad.json`.

A ordem importa: restaurar o backup com o código da Fase 1 ainda no ar só dispara a migração de novo na leitura seguinte. Restaurar **perde** squads, domínios e contratações criados depois da migração. Eventos criados nesse meio continuam no Google; os de squads novas ficam órfãos (domínio `<squad>--...` que o roster v2 não conhece).

**Rollback da Fase 2.** Sem migração nem versão nova: basta implantar o commit anterior. Código anterior à Fase 2 ignora `arquivado` e mostraria arquivados como ativos (no mapa, no prompt e na Mochila); a leitura não quebra.

**Rollback dos passos no Tasks.** Sem migração: implantar o commit anterior. As chaves `squadone_tasks_*` nos eventos são ignoradas pelo código antigo, `tasksListaId` é tolerado por `validarV3`, as tarefas já criadas continuam no Google e o refresh_token com dois escopos continua servindo ao Calendar.

**Rollback do bot do Telegram.** Sem migração: implantar o commit anterior. O webhook continua registrado no Telegram apontando para uma rota que passa a dar 403 (código antigo não a monta, e ela cai no porteiro de IP). **Não basta ignorar:** o Telegram retém updates não entregues por até ~24h e os reentrega quando a rota voltar a responder, com a memória de dedupe vazia (zerou no redeploy). A guarda de demanda atrasada (ver "Bot do Telegram") impede que virem compromisso marcado tarde ou duplicado, mas cada um vira uma resposta "⌛" no chat — e um rollback para um commit anterior à guarda não a tem. Por isso, ao reverter (ou depois de qualquer período em que a rota ficou fora do ar), chame `deleteWebhook` com `drop_pending_updates=true` — `https://api.telegram.org/bot<TOKEN>/deleteWebhook?drop_pending_updates=true` no navegador, nunca colando o token em outro lugar. O mesmo vale se o boot ficou com `TelegramMalConfigurado` (config inválida, rota não montada) por um tempo: corrija a variável e, se mensagens chegaram nesse meio, descarte os updates pendentes do mesmo jeito antes de religar.

**A seed não pode morar em `data/`.** Um volume novo sobe vazio e sombreia o que a imagem tinha naquele caminho. Por isso `seed/squad.seed.json` fica fora do mount; `SEED_PATHS` em `squad.ts` ainda tenta o caminho antigo para não quebrar checkout velho.

Sem banco de propósito: dois blobs de poucos KB não justificam Postgres, e o escopo da V1 é explicitamente só estes dois.

## Autenticação

**O browser não vê token do Google.** O servidor conduz o authorization code flow:

```
/api/auth/google    -> redireciona para o consentimento (access_type=offline, prompt=consent)
/api/auth/callback  -> troca o code, grava o refresh cifrado, volta para /?auth=ok
/api/auth/status    -> { conectado: bool, tasks: bool }
/api/auth/logout    -> apaga o arquivo e revoga no Google
```

`tokenValido()` devolve um access_token, renovando pelo refresh quando preciso. Lança `PrecisaConectar` (vira 401 + `precisaConectar: true`) quando não há credencial ou o Google recusou — o único caso em que a UI deve pedir gesto do usuário. `ErroDeConfig` vira 500 + `configuracao: true`: é ambiente, nenhum clique conserta. Só `invalid_grant` (refresh revogado ou expirado) apaga a credencial: rede fora do ar, 5xx do Google ou `invalid_client`/`unauthorized_client` (client OAuth mal configurado) viram `GoogleIndisponivel` sem tocar no arquivo, porque a vigia dos lembretes (`server/vigia.ts`) pede o token a cada varredura (60 s) e o cache do access_token faz isso virar um refresh de verdade ao Google ~1x/h, 24/7 — e uma oscilação transitória não pode forçar reconectar.

`prompt=consent` é obrigatório. Sem ele o Google omite o `refresh_token` quando já houve consentimento antes, e a credencial nasce sem como se renovar.

**Dois escopos, autorização incremental.** O consentimento pede `calendar.events` e `tasks` juntos (`include_granted_scopes=true`). Ampliar o acesso de uma credencial antiga é refazer `/api/auth/google` ("Autorizar Google Tasks" na UI) — **nunca** logout, que revoga o refresh_token no Google e derruba o Calendar junto. Em produção vale o mesmo gesto: depois do deploy desta função, quem já estava conectado amplia clicando em **Autorizar Google Tasks**, nunca deslogando. `GET /api/auth/status` responde `{ conectado, tasks }`: sem o escopo do Tasks o app funciona igual e só os passos ficam de fora (aviso `ampliarAcesso`). O `scope` concedido é gravado na credencial; resposta sem `scope` vale só o Calendar.

**Consentimento granular:** Tasks desmarcado grava normalmente (`tasks: false`). Calendar desmarcado recusa sem gravar (`EscopoNegado`), a credencial anterior fica intacta e o callback volta para `/?auth=escopo_calendar_negado`. 403 de escopo do Tasks nunca vira `precisaConectar`: a UI mostraria "Conectar" com o Calendar funcionando.

**No console do Google Cloud, "Acesso a dados" não declara nenhum escopo** (nem `calendar.events`, nem `tasks`) — de propósito: o app não verificado pede os escopos em runtime (na tela de consentimento), e declarar escopo sensível ali dispara o pedido de verificação do Google, que exigiria os links da Branding apontando para páginas reais (o porteiro de IP bloqueia o rastreador — ver "Não subir logotipo" abaixo). A API do Google Tasks foi habilitada no projeto em 14/09/2026.

## O prazo de 7 dias (resolvido em 12/09/2026)

Em **Externo + Testando** o Google expirava o refresh_token em **7 dias**. Política do Google, não bug. O app foi **publicado (Em produção)** em 12/09/2026 e o prazo caiu. O código não muda em nenhum dos dois casos.

Para publicar, o Google exigia os três links da página Branding preenchidos — sem eles o botão **Publicar app** fica desabilitado com *"you must complete your configuration on the Branding page"*. Os três apontam para a raiz do app (`https://aladdin-squadone-app.jicnzg.easypanel.host/`), o que basta porque o app segue **não verificado**:

- consentimento mostra a tela "o Google não verificou este app" — clicar em *Avançado* passa;
- teto vitalício de 100 usuários concedendo permissão. Um usuário, irrelevante.

**Não subir logotipo.** Logo, mais de 10 domínios autorizados, ou escopo restrito forçam enviar o app para verificação — aí os links precisariam ser páginas reais e acessíveis, e o porteiro de IP bloqueia o rastreador do Google.

Status em console.cloud.google.com/auth/audience (projeto `gen-lang-client-0086006291`); o botão de lá agora é **Voltar para o teste**, que reverte.

## Porteiro de IP

Substitui login. `IPS_PERMITIDOS` (lista por vírgula) é checada antes de qualquer rota, inclusive estáticos, exceto `POST /api/telegram/webhook`, montada antes, com trava própria (ver "Bot do Telegram"). Vazia **desliga** o porteiro — default em dev. Em produção o IP real vem do primeiro item de `X-Forwarded-For`, porque o Traefik é o único caminho até o container.

Perdeu o acesso porque o IP residencial mudou: esvaziar `IPS_PERMITIDOS` no Easypanel e implantar.

## Variáveis de ambiente

| Var | Onde | Para quê |
|---|---|---|
| `GEMINI_API_KEY` | servidor | chamadas ao Gemini |
| `VITE_GOOGLE_CLIENT_ID` | **build + servidor** | OAuth client; o servidor lê a mesma var |
| `GOOGLE_CLIENT_SECRET` | servidor | code flow. **Nunca prefixar com `VITE_`** |
| `TOKEN_ENC_KEY` | servidor | 32 bytes base64; cifra o refresh_token |
| `IPS_PERMITIDOS` | servidor | allowlist; vazia desliga |
| `APP_URL` | servidor | monta o `redirect_uri` |
| `NODE_ENV` | servidor | `production` serve `dist/` em vez do Vite |
| `JANELA_TRABALHO` | servidor | janela de alocação `HH:MM-HH:MM` (São Paulo), minutos múltiplos de 15 (`09:10` é recusado); ausente/vazia = `09:00-19:00`; ilegível = 500 |
| `DIAS_TRABALHO` | servidor | dias ISO da janela, `1`=segunda … `7`=domingo; ausente/vazia = `1,2,3,4,5`; ilegível = 500 |
| `TELEGRAM_BOT_TOKEN` | servidor | token do @BotFather; ausente/vazia = bot desligado (as duas abaixo são ignoradas); formato inválido = `TelegramMalConfigurado` |
| `TELEGRAM_WEBHOOK_SECRET` | servidor | 32–256 chars `[A-Za-z0-9_-]`; obrigatória com o token presente; vai no `secret_token` do `setWebhook` e é conferida no header de cada POST |
| `TELEGRAM_CHAT_IDS` | servidor | `chat_id` autorizados, por vírgula; obrigatória com o token presente; **vazia NÃO abre o bot** (ao contrário de `IPS_PERMITIDOS`) |
| `SQUADONE_MODE` | servidor | `app` (padrão, Easypanel) ou `operations` (Dell); outro valor derruba o boot. Ver "Dois perfis" |
| `SQUADONE_OPERATIONS_CONFIG` / `_DATA_DIR` | servidor | só em `operations`: config privada da Central e diretório de dados; nunca no Easypanel |
| `SQUADONE_AVALIACOES` | servidor | `true` liga a avaliação de turno; qualquer outro valor = desligada |
| `SQUADONE_DATA_DIR` | servidor | `squad.json`, `google-auth.json`, offset do Telegram; ausente = `./data`. No `operations` a agenda só liga com ela presente e fora do checkout (Dell: `~/.local/share/squadone`, caminho absoluto) |
| `SQUADONE_ROSTER_CONGELADO` | servidor | `true` recusa toda escrita no roster (409 `rosterCongelado`): cutover e reserva fria |
| `TELEGRAM_TRANSPORTE` | servidor | `webhook` (padrão) ou `polling`; no `operations` só `polling`; outro valor = `TelegramMalConfigurado` |
| `SQUADONE_LOGINS_TAILSCALE` | servidor | só `operations`: logins aceitos no `Tailscale-User-Login`, por vírgula; com a agenda ligada, vazia fecha a tailnet; vazia fecha `/api/financas/*` pela tailnet sempre |
| `SQUADONE_AVISOS_FILA` | servidor | só `operations`: pasta da fila de avisos; ausente = `~/.local/share/avisos/fila` |
| `SQUADONE_LEMBRETES_PELO_TELEGRAM` | servidor | só `operations` (16/10/2026, OT-14): lembrete da agenda e alerta de finanças pelo bot do Telegram, fila do WhatsApp só de reserva; o `dell-status` lê a mesma variável (e o token e os chats) deste arquivo para mandar as falhas do Dell e o socorro pelo bot; `false` volta tudo à fila; qualquer outro valor ou ausente = Telegram |
| `DEADMAN_URL` | servidor | só `operations`: ping do healthchecks.io (https, sem query); ausente = sem sinal; ilegível = log e desligado |
| `SQUADONE_FINANCAS_IA` | servidor | só `operations`: `true` liga o "Explicar este mês" das finanças (prévia literal, envio com o hash dela); qualquer outro valor = rotas em 404 e sem botão. Ligar só com a chave do Gemini em projeto com faturamento — confirmado pelo usuário em 07/10/2026; nunca no Easypanel |
| `PLUGGY_CLIENT_ID` / `_SECRET` / `PLUGGY_ITEM_IDS` | servidor | só em `operations`, no EnvironmentFile `~/.config/squadone/financas.env` (600); ausentes = finanças sem leitura; um presente sem os outros = log de erro e Pluggy desligada. Nunca impressos |
| `SQUADONE_LUNA_SOMBRA` | servidor | só `operations` com a agenda; **nunca no Easypanel**. `true` liga a Luna em modo sombra (ver "Luna em modo sombra"); qualquer outro valor = desligada (padrão) |
| `SQUADONE_LUNA_TETO_DIA` | servidor | só `operations`: turnos observados pela sombra por dia (São Paulo); ausente = 10; ilegível ou ≤ 0 = log e sombra desligada |
| `SQUADONE_LUNA_GUARDAR_DEMANDA` | servidor | só `operations`: `true` grava a demanda em claro no JSONL da sombra; padrão só o sha256 e o tamanho |
| `SQUADONE_CODEX_BIN` | servidor | só `operations`: binário do `codex` para a sombra; ausente = `codex` no PATH; não encontrado = log uma vez e sombra desligada |
| `OPENROUTER_API_KEY` | servidor | só `operations`, no EnvironmentFile `~/.config/squadone/jev.env` (600); **nunca no Easypanel, nunca impressa** (nenhum log, erro ou JSONL a repete). Só é lida com `SQUADONE_JEV_SOMBRA=true`; ausente ou fora do formato = `JevMalConfigurado`, log de erro e Jev desligado |
| `SQUADONE_JEV_SOMBRA` | servidor | só `operations` com a agenda; **nunca no Easypanel**. `true` liga o Jev em sombra (ver `perfis-e-experimentos.md`); qualquer outro valor = desligado (padrão) |
| `SQUADONE_JEV_MODELO` | servidor | só `operations`: id do modelo na OpenRouter; ausente = `typesafe/jev-1.13`; fora de `<provedor>/<modelo>` = log e desligado |
| `SQUADONE_JEV_TETO_DIA` | servidor | só `operations`: chamadas ao Jev por dia (São Paulo); ausente = 50; ilegível ou ≤ 0 = log e desligado |
| `SQUADONE_JEV_TETO_USD` | servidor | só `operations`: teto TOTAL de gasto em US$ (soma de `usage.cost` de todos os JSONL do Jev, contada no boot); ausente = 1; ilegível, ≤ 0 ou > 100 = log e desligado |
| `SQUADONE_JEV_TIMEOUT_MS` | servidor | só `operations`: timeout de uma chamada (500–60000); ausente = 5000 |
| `SQUADONE_JEV_GUARDAR_DEMANDA` | servidor | só `operations`: `true` grava a demanda (já mascarada) no JSONL do Jev; padrão só o sha256 e o tamanho (na Mel está `true` desde 15/10/2026) |
| `SQUADONE_SINAIS_DO_SITE` | servidor | só `operations`: `false` desliga a leitura sob demanda dos sinais do site (POST /api/operations/crm/sinais); ligada por padrão, no máximo 3 requisições por lead, cache de 7 dias |
| `SQUADONE_JEV_ZDR` | servidor | só `operations`: `false` deixa de exigir retenção zero (só para teste); ausente = ZDR exigido em toda chamada; outro valor = log e desligado |

`VITE_*` é embutida no bundle no `vite build`, **não lida em runtime**. Mudar o client ID exige rebuild. Uma string qualquer passa por `if (!CLIENT_ID)` e o Google recusa sem erro legível — por isso há validação de formato.
