# SquadOne

Escritório isométrico onde squads de agentes de IA (Pessoal, Pay4Fun...) recebem demandas em linguagem natural e as transforma em eventos no Google Calendar. Uso pessoal, um usuário só.

## Comandos

```bash
npm run dev      # tsx server.ts — Express + Vite em middleware mode, porta 3000
npm run build    # vite build + esbuild do server para dist/server.cjs
npm start        # node dist/server.cjs — o que roda em produção
npx vue-tsc --noEmit   # typecheck (o script `lint` chama isto)
```

Não existe suíte de testes. Verificação é typecheck + build + exercitar a rota.

## Protocolo de contexto

Antes de vasculhar código, use o grafo em `graphify-out/`:

```bash
graphify query "<pergunta>"        # subgrafo escopado, bem menor que grep
graphify path "<A>" "<B>"          # relação entre dois símbolos
graphify explain "<conceito>"
```

`graphify-out/GRAPH_REPORT.md` só para revisão ampla de arquitetura. Depois de mexer no código, `graphify update .`.

## Arquitetura

Um processo Express serve a API e a SPA Vue. Sem banco.

```
server.ts                 Express: monta o porteiro, as rotas e o Vite/estáticos
  server/acesso.ts        porteiro de IP (403 antes de qualquer rota)
  server/auth-store.ts    credencial do Google: code flow, refresh, cifra em disco
  server/squad.ts         roster v3 em árvore, migração, regras de id; única fonte de verdade das squads
  server/hire.ts          contratação (card ou UI), nova squad, substituição de PO
  server/ciclo-de-vida.ts editar, arquivar e reativar pessoa/domínio/squad
  server/redacao.ts       Gemini redige papel + escopo (não grava)
  server/orchestrator.ts  um turno: demanda -> 1 chamada ao Gemini -> capacidades
  server/capabilities.ts  as capacidades que o modelo pode invocar
  server/alocador.ts      PURO: ocupação + janela + pedido + agora -> slots
  server/agenda.ts        ocupação do turno: 1 leitura do primary + reservas
  server/agendamento.ts   compromisso -> eventos (foco, ou marco + blocos)
  server/descricao.ts     PURO: blocos dos agentes na descrição (mescla, hash)
  server/contribuicao.ts  agentes escrevem numa quest: Gemini por agente + 1 PATCH
  server/quest.ts         recusa classificada e validação comum das rotas de quest
  server/plano-de-ajuste.ts  PURO: duração/esforço aprovados sobre o alocador
  server/ajuste.ts        aplica o ajuste aprovado no Google
  server/calendar.ts      leitura/escrita no Google Calendar (listar, GET/PATCH/POST de um evento)
src/App.vue               orquestra a tela; dono do estado de roster, squad ativa e quests
  src/auth/google.ts      invólucro fino sobre /api/auth/*
  src/squadAtiva.ts       squad ativa da aba (localStorage)
  src/mochila.ts          sem Vue: "Bloco i/N" e intervalo de dia inteiro, derivados da lista
  src/rosterApi.ts        escritas do roster com erro classificado
  src/contribuicao.ts     sem Vue: fila em série das contribuições da aba, status, resumo do ajuste
  src/components/         GameMap, CommandBar, QuestBackpack, GrowthCard,
                          SquadSelector, NovaSquadModal, TrocaSquadCard,
                          SalasPainel, ContratarModal, EditarModal, ArquivoModal,
                          ContribuirModal, AjusteCard
  src/office/             geometria isométrica, salas, sprites
  src/office/salas.ts     diferença de salas (abrir/fechar/trocar dono), pura
seed/squad.seed.json      roster inicial — FORA de data/, ver "Volume" abaixo
data/                     volume em produção; nada aqui é versionado
```

### Quatro invariantes que o código assume

**1. O roster é uma árvore de três níveis.** `roster → squad → domínio → { po, integrantes }`. Uma squad = um escritório 3x3; uma sala = um domínio. Contratar um integrante entra na sala existente; criar um domínio ocupa o primeiro slot livre de `unlockOrder` (derivado dos slots ocupados, não de `dominios.length`). Máximo 9 domínios por squad. Squad nasce com 1 domínio + PO (o `GameMap` precisa de `dominios[0].po`). Ids de domínio e de pessoa são únicos entre **todas** as squads e `idsAposentados`; domínio novo é `<squad>--<slug>`, os legados (`po`, `geral`) ficam como estão.

**2. O roster é o prompt.** A árvore **da squad ativa** vai literal para o `systemInstruction` em `orchestrator.ts`; as outras squads entram só por id, nome e escopo, para o modelo poder chamar `sugerir_troca_squad` sem conseguir agendar nelas. A squad ativa é escolha da aba (`localStorage`), mandada como `squadId` em `/api/orquestrar` e `/api/mochila`; a rota resolve a squad antes de pedir token e antes do Gemini. Não existe "treinamento do agente" guardado em outro lugar: `papel` + `escopo` de cada `Pessoa` *são* o treino. Persistir o roster já persiste os agentes. O escopo de pessoa (até 1500 caracteres, cinco linhas: Missão, Cuida de, Não cuida de, Ao opinar sobre um compromisso, Sinais de alerta) é o treino; entra em bloco recuado na árvore.

**3. As quests vivem no Google Calendar, não aqui.** `GET /api/mochila` lê do Google a cada chamada. Editar ou apagar no Google reflete na próxima leitura. `quests` no frontend é cache da última resposta, nunca fonte de verdade. A leitura vai 7 dias para trás, mas o card some quando a quest **termina** (`questTerminou` em `src/mochila.ts`, relógio de 30 s): filtro só da vista, a lista cheia segue alimentando "Bloco i/N".

**4. Arquivar não apaga.** Pessoa, domínio e squad arquivados ficam na árvore com `arquivado: true` e somem do prompt, do mapa e da vista (`paraVista` só põe ativos em `dominios`/`squads`; o resto vai em `arquivo`/`squadsArquivadas`). Arquivar grava o id em `idsAposentados` (só acréscimo, e reativar não tira). O PO não se arquiva: substitui-se, e o anterior vira integrante arquivado. `dominios[0]` e a última squad ativa nunca se arquivam. Helpers de turno, Mochila, prompt e slots veem só ativos; os de unicidade de id veem tudo. `agendar_evento` tira a cor do índice no array **cru**, para a cor de um domínio não mudar quando outro é arquivado. Nada no ciclo de vida chama o Google.

### Marcas no Calendar

Todo evento criado carrega quatro chaves em `extendedProperties.private`, montadas por `marcasDoEvento()` em `server/calendar.ts`, e blocos de prazo uma quinta:

| Chave | Eixo | Uso |
|---|---|---|
| `squadone_squad` | informativa | de qual squad veio; **não filtra** — eventos anteriores à Fase 1 não a têm e seguem aparecendo |
| `squadone_dominio` | filtro | `events.list` com `privateExtendedProperty`, uma chamada por domínio da squad ativa |
| `squadone_membro` | atribuição | quem executa |
| `squadone_tipo` | semântica | `time_blocking` ou `deadline` (blocos de prazo são `time_blocking`) |
| `squadone_prazo_ref` | ligação | só em blocos: eventId do marco. A Mochila deriva "Bloco i/N" da lista lida; posição não é gravada |
| `squadone_h_<8 hex>` | edição manual | um por agente que escreveu na descrição: `<pessoa_id>:<16 hex>` do texto normalizado do bloco. Ausente ou diferente = bloco editado à mão |

`paraQuest` lê o tipo da marca e só cai no prefixo `⏰ DEADLINE:` do título quando ela não existe (eventos anteriores a 12/09/2026, sem migração). O prefixo segue no título como rótulo. Deadline grava `transparency: "transparent"`: é marco, não ocupa agenda.

### Toggle Auto / Foco / Prazo

A CommandBar manda `modo` em `/api/orquestrar` (ausente = `auto`, inválido = 400) e volta para Auto depois de cada envio. `auto` deixa o modelo escolher o tipo. `foco`/`prazo` acrescentam a regra ao prompt **e** `agendarCompromisso` impõe `time_blocking`/`deadline` mesmo se o modelo divergir; se o campo esperado faltar, usa o do outro tipo (`esforco_min` ↔ `duracao_min`, `inicio_fixo` como prazo; regra em `server/agendamento.ts`).

### Agendamento: o horário é do servidor

O modelo decide a intenção (`tipo`, `duracao_min` ou `esforco_min`, `prazo_final`, `a_partir_de`); o servidor escolhe o horário. `inicio_fixo` só existe quando o usuário disse a hora — é gravado mesmo com conflito, que vira aviso.

- **Ocupação é global:** `events.list` do `primary` inteiro, uma vez por turno (preguiçosa: turno sem agendamento não lê), 60 dias à frente, sem filtro de marca, até 10 páginas. Não ocupa: transparente, dia inteiro, cancelado, `workingLocation`/`birthday`, recusado pelo próprio usuário. Outros calendários não contam.
- **Janela:** `JANELA_TRABALHO` (padrão `09:00-19:00`; minutos em :00, :15, :30 ou :45, porque todo slot cai na grade de 15 min; pelo menos 30 min) e `DIAS_TRABALHO` (padrão `1,2,3,4,5`), fuso `America/Sao_Paulo`. Env e não `squad.json`: é do usuário, não da squad. Ausente ou vazia = padrão; presente e ilegível = 500 `configuracao: true` antes do token e do Gemini, nunca o padrão calado. O boot loga a janela lida. Trocar exige **Implantar**.
- **Focar Agora:** primeiro slot livre a partir de agora (grade de 15 min), até 14 dias. Não achou = erro `motivo: semHorarioLivre` só naquele compromisso.
- **Prazo Final:** marco transparente no prazo (sem hora = dia inteiro) + blocos de 30–120 min antes dele, um por dia antes de empilhar, pausa de 15 min, até 20. Não coube = cria o que coube e avisa quanto faltou (`faltou_min`). Bloco que falha para a série sem apagar nada.
- **Série:** os `agendar_evento` de um turno rodam um por vez (fixo, foco, prazo mais próximo) e cada reserva desconta da ocupação. O resto das capacidades segue em paralelo. Resultados voltam na ordem das chamadas. Turno com `sugerir_troca_squad` descarta os agendamentos antes de ler a agenda.
- **Sem credencial:** o turno roda; cada `agendar_evento` vira erro com `motivo: precisaConectar` sem chamar o Google, e a UI volta a oferecer "Conectar".
- `server/alocador.ts` é puro (sem `fetch`, relógio, env ou import) e é o que a Fase 4 reusa. Mantenha assim.

### Contribuição dos agentes (Fase 4)

Agentes escrevem notas na descrição do evento no Google. Gatilho: o PO marca `colaboradores_ids` em `agendar_evento` (até 3, só no foco ou marco; inválido vira aviso) e o frontend pede depois do turno, ou o botão **Pedir contribuição** do card da Mochila (até 6). Rota: `POST /api/quests/:eventId/contribuir {squadId, pessoaIds}` → 200 com resultado por agente, mesmo com todos em erro.

- **Formato:** texto do usuário intocado + `[[squadone]]` (cabeçalho) + um bloco por agente entre `[[squadone:<pessoa_id>]]` e `[[/squadone:<pessoa_id>]]`. Bloco novo entra no fim; bloco existente muda só entre os marcadores. Teto 8000 caracteres, 1200 por bloco; descrição HTML (a UI web do Google grava assim) recebe `<br>`. Texto do modelo é escapado: nunca forma marcador nem tag.
- **Edição manual:** hash de cada bloco em `squadone_h_*`. Hash que não bate = você editou o bloco; o agente **não** sobrescreve, avisa, e nem chega a chamar o Gemini. Para destravar, apague o bloco (ou só os marcadores) no Google. O hash é sobre o texto normalizado: a reescrita em HTML do Google não conta como edição.
- **PATCH:** todo PATCH de evento passa por `atualizarPreservandoMarcas`: `If-Match` com o etag lido, `sendUpdates=none`, `extendedProperties.private` **completo** (lido + o que muda). A resposta é conferida: marca `squadone_*` sumida → restaura uma vez → `marcasPerdidas` (500). Contribuição em 412 relê, mescla de novo e tenta mais uma vez; dois 412 = 409 `conflitoDeEdicao`.
- **Token por chamada:** as rotas de quest checam `tokenValido()` antes do Gemini (401 sem gastar modelo) e passam `obterToken`; cada leitura/PATCH/POST no Google pede o token de novo logo antes (`comToken`, o cache do auth-store absorve o custo). Google recusou a credencial: pede de novo e, vindo token diferente, repete uma vez; só com o mesmo token o 401 vira `precisaConectar`.
- **Gemini:** uma chamada por agente (`registrar_contribuicao`, function calling `ANY`), no máximo 3 em paralelo, via `gerarComRetry`. A descrição vai no prompt delimitada como DADO. `ModeloOcupado` de um agente é erro só dele.
- **Teto de tempo do Gemini (turno, redação e contribuição):** `gerarComRetry` dá 45 s (`TIMEOUT_GEMINI_MS`) a cada tentativa, por `abortSignal` + corrida contra um relógio. Timeout conta como transitório: retenta e cai no modelo reserva; esgotou, `ModeloOcupado`. Pior caso de uma geração: 2 modelos × 2 tentativas × 45 s + backoff ≈ **3 min** (turno e redação). Contribuição com 6 agentes: 2 rodadas de 3 ≈ **6 min** antes do PATCH, e a fila da aba espera. Proxy com timeout menor que isso corta a resposta (a UI mostra erro de rede; nada fica gravado pela metade).
- **Fila em série no frontend:** cada pedido chama `tokenValido()`, e o auth-store não tem lock de refresh. A fila só anda sem leitura da Mochila em curso e começa depois da Mochila do turno. Não persiste: recarregar perde o que não rodou (nada fica gravado pela metade).
- **Ajuste:** o agente pode propor duração (foco/bloco) ou esforço total (marco, medido pelos blocos com `squadone_prazo_ref`). Vira `AjusteCard`; `POST /api/quests/:eventId/ajustar {alvo, proposto_min, permitirMover?}` só roda com aprovação e relê tudo. Duração muda só o fim; se não cabe, 409 `naoCabe` e mover é um segundo clique (`permitirMover`). Esforço cria blocos extras antes do prazo (com as 5 marcas) ou encurta blocos futuros até 30 min; bloco que mudou desde a listagem é pulado e vira `sobra_min`. Nada é apagado. 412 no ajuste não retenta.
- Erros de quest: 404 `questSumiu`, 409 com a flag (`pessoaForaDaSquad`, `eventoSemMarca`, `eventoDeOutraSquad`, `dominioInativo`, `descricaoCheia`, `conflitoDeEdicao`, `alvoIncompativel`, `naoCabe`, `semHorarioLivre`), 401 `precisaConectar`, 500 `configuracao`/`marcasPerdidas`, 502 o resto do Google.
- Nada disto grava fora do Google: a persistência continua só `squad.json` e `google-auth.json`. Rollback: implantar o commit anterior; blocos e hashes ficam no Google como texto e marcas inertes.

### Escrita no roster

Toda mutação passa por `atualizarRoster()`, que serializa read-modify-write numa fila. Um arquivo para todas as squads, então uma fila só: duas aprovações quase simultâneas, mesmo em squads diferentes, leriam o mesmo `squad.json` e a segunda apagaria a primeira. `writeRoster` grava num `.tmp` e renomeia por cima — crash no meio deixa o `.tmp` pela metade, nunca o `squad.json`. Contratação aplica na squad da proposta (`sugestao.squad_id`), não na que a tela mostra.

### Contratação e ciclo de vida

Contratar: botão por sala e **+ Abrir sala** (painel `SalasPainel` fora do canvas; o `GameMap` segue sem eventos), ou card do modelo (Aprovar/Ajustar). O prompt manda o modelo sempre chamar a capacidade de crescimento quando o pedido é explícito. Redigir (`POST /api/squad/redigir`) é uma chamada de function calling restrita (`ANY` + um nome), via `gerarComRetry`, e não grava nada: `responseMimeType` é instável na troca de modelo do retry. Falha dela nunca impede contratar à mão.

| Rota | Efeito |
|---|---|
| `PATCH /api/squad/{pessoas,dominios,squads}/:id` | edita texto (400 acima do limite, sem cortar); ids nunca mudam |
| `POST /api/squad/{pessoas,dominios,squads}/:id/arquivar` | arquiva (idempotente) |
| `POST /api/squad/{pessoas,dominios,squads}/:id/reativar` | reativa; domínio volta ao slot antigo se livre, senão ao primeiro livre, senão 409 |
| `POST /api/squad/dominios/:id/po` | substitui o PO (`integranteId` ou pessoa nova) |
| `POST /api/squad/hire` | card do modelo corta texto (escopo 1500); `escopo_po` separa o treino do PO do escopo do domínio |

Ids de pessoa e domínio são globais, então as rotas não levam `squadId`. Id inexistente é 409, não 404: é aba com roster velho. Mochila: domínio arquivado some (um `events.list` só por domínio ativo); quest de integrante arquivado continua, com "(arquivado)". Squad arquivada em `/api/orquestrar`, `/api/mochila`, hire ou redigir é `SquadArquivada`, mesmo 409 + `squadInexistente` de squad sumida.

## Persistência

Volume Docker do Easypanel montado em `/app/data`. Poucos KB:

| Arquivo | Conteúdo |
|---|---|
| `data/squad.json` | roster v3 `{ version: 3, squads, idsAposentados }` = os agentes com seu treino; inclui arquivados (`arquivado`, `arquivadoEm`) |
| `data/google-auth.json` | `refresh_token` cifrado em AES-256-GCM |
| `data/squad.v2.bak.json` | texto cru do roster v2, gravado uma vez pela migração; nunca sobrescrito |

**Migração.** `readRoster()` detecta a versão pela **forma** (`squads` → v3, `dominios` → v2, `members` → v1), grava o backup do texto cru, converte (v2 inteiro vira a squad `pessoal`, ids intactos) e escreve v3. Forma desconhecida ou conversão que não passa na validação lança `RosterIlegivel` (500) e **não grava** `squad.json`. Migração e semeadura rodam sob promessa única: no boot `/api/squad` e `/api/mochila` chegam juntos.

**Rollback da Fase 1.** O código anterior não lê v3 (todo `/api/squad` vira 500). Para reverter, **nesta ordem**:

1. No Easypanel, implantar o commit anterior à Fase 1. Entre este passo e o próximo o roster responde 500.
2. No console do container: `cp /app/data/squad.v2.bak.json /app/data/squad.json`.

A ordem importa: restaurar o backup com o código da Fase 1 ainda no ar só dispara a migração de novo na leitura seguinte. Restaurar **perde** squads, domínios e contratações criados depois da migração. Eventos criados nesse meio continuam no Google; os de squads novas ficam órfãos (domínio `<squad>--...` que o roster v2 não conhece).

**Rollback da Fase 2.** Sem migração nem versão nova: basta implantar o commit anterior. Código anterior à Fase 2 ignora `arquivado` e mostraria arquivados como ativos (no mapa, no prompt e na Mochila); a leitura não quebra.

**A seed não pode morar em `data/`.** Um volume novo sobe vazio e sombreia o que a imagem tinha naquele caminho. Por isso `seed/squad.seed.json` fica fora do mount; `SEED_PATHS` em `squad.ts` ainda tenta o caminho antigo para não quebrar checkout velho.

Sem banco de propósito: dois blobs de poucos KB não justificam Postgres, e o escopo da V1 é explicitamente só estes dois.

## Autenticação

**O browser não vê token do Google.** O servidor conduz o authorization code flow:

```
/api/auth/google    -> redireciona para o consentimento (access_type=offline, prompt=consent)
/api/auth/callback  -> troca o code, grava o refresh cifrado, volta para /?auth=ok
/api/auth/status    -> { conectado: bool }
/api/auth/logout    -> apaga o arquivo e revoga no Google
```

`tokenValido()` devolve um access_token, renovando pelo refresh quando preciso. Lança `PrecisaConectar` (vira 401 + `precisaConectar: true`) quando não há credencial ou o Google recusou — o único caso em que a UI deve pedir gesto do usuário. `ErroDeConfig` vira 500 + `configuracao: true`: é ambiente, nenhum clique conserta.

`prompt=consent` é obrigatório. Sem ele o Google omite o `refresh_token` quando já houve consentimento antes, e a credencial nasce sem como se renovar.

### O prazo de 7 dias (resolvido em 12/09/2026)

Em **Externo + Testando** o Google expirava o refresh_token em **7 dias**. Política do Google, não bug. O app foi **publicado (Em produção)** em 12/09/2026 e o prazo caiu. O código não muda em nenhum dos dois casos.

Para publicar, o Google exigia os três links da página Branding preenchidos — sem eles o botão **Publicar app** fica desabilitado com *"you must complete your configuration on the Branding page"*. Os três apontam para a raiz do app (`https://aladdin-squadone-app.jicnzg.easypanel.host/`), o que basta porque o app segue **não verificado**:

- consentimento mostra a tela "o Google não verificou este app" — clicar em *Avançado* passa;
- teto vitalício de 100 usuários concedendo permissão. Um usuário, irrelevante.

**Não subir logotipo.** Logo, mais de 10 domínios autorizados, ou escopo restrito forçam enviar o app para verificação — aí os links precisariam ser páginas reais e acessíveis, e o porteiro de IP bloqueia o rastreador do Google.

Status em console.cloud.google.com/auth/audience (projeto `gen-lang-client-0086006291`); o botão de lá agora é **Voltar para o teste**, que reverte.

### Porteiro de IP

Substitui login. `IPS_PERMITIDOS` (lista por vírgula) é checada antes de qualquer rota, inclusive estáticos. Vazia **desliga** o porteiro — default em dev. Em produção o IP real vem do primeiro item de `X-Forwarded-For`, porque o Traefik é o único caminho até o container.

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

`VITE_*` é embutida no bundle no `vite build`, **não lida em runtime**. Mudar o client ID exige rebuild. Uma string qualquer passa por `if (!CLIENT_ID)` e o Google recusa sem erro legível — por isso há validação de formato.

## Deploy

Easypanel, projeto `aladdin`, app `squadone-app`, em `https://aladdin-squadone-app.jicnzg.easypanel.host`. Nixpacks a partir do GitHub (`romulosutil/SquadOne`, branch `main`). Push em `main` não implanta sozinho: é preciso clicar **Implantar** no painel.

## Convenções

- Comentários e identificadores em **português**. Comentário explica *por quê*, não *o quê* — a maioria dos blocos aqui documenta a decisão e o que aconteceria sem ela.
- Erros carregam classificação, não só mensagem: `ErroDeDominio.credencial`, `PedidoInvalido` (400) vs `ConflitoDeRoster` (409), `SquadInexistente` (409 + `squadInexistente: true`: a UI recarrega e cai na primeira squad), `SquadArquivada` (filha dela, mesmo 409 + flag), `RedacaoInvalida` (502 + `redacaoFalhou`), `ModeloOcupado` (503 + `modeloOcupado`), `RosterIlegivel` (500), `PrecisaConectar` vs `ErroDeConfig`, `JanelaMalConfigurada` (500 + `configuracao`), `ErroTarefa.motivo` (`precisaConectar`, `configuracao`, `semHorarioLivre`, `agendaIndisponivel`). A UI decide o que fazer pelo tipo.
- Falha de uma parte não derruba o resto: um domínio com erro no Calendar não zera a Mochila inteira; um turno sem credencial ainda roda as capacidades que não tocam o Google; um compromisso que falha não impede os seguintes da série.
- Ao terminar tarefa: `git commit` + `git push` + `graphify update .`.
