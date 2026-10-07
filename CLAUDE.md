# SquadOne

Escritório isométrico onde squads de agentes de IA (Pessoal, Pay4Fun...) recebem demandas em linguagem natural e as transforma em eventos no Google Calendar. Uso pessoal, um usuário só.

## Comandos

```bash
npm run dev      # tsx server.ts — Express + Vite em middleware mode, porta 3000
npm run build    # vite build + esbuild do server para dist/server.cjs
npm start        # node dist/server.cjs — o que roda em produção
npx vue-tsc --noEmit   # typecheck (o script `lint` chama isto)
npm test         # tsx --test server/*.test.ts server/financas/*.test.ts src/*.test.ts src/office/*.test.ts (node:test, sem framework extra)
```

Os testes são pontuais — só as regras puras que dá para fixar em tabela de casos
(hoje `server/baixa-prioridade.test.ts`,
`server/lembretes.test.ts`, `server/vigia.test.ts`, `server/auth-store.test.ts`,
`server/passos.test.ts`, `server/tasks.test.ts`, `server/passos-no-google.test.ts`,
`server/auth-escopos.test.ts`, `server/squad.test.ts`, `server/calendar.test.ts`,
`server/prompt-passos.test.ts`, `server/telegram.test.ts`,
`server/telegram-entrada.test.ts`, `server/telegram-resposta.test.ts`,
`server/telegram-bot.test.ts`, `server/avaliacoes-turno.test.ts`,
`server/operations.test.ts`, `server/auto-production.test.ts`,
`server/dell-status.test.ts`, `server/prumo-workflows.test.ts`,
`server/tarefa-avulsa.test.ts`, `server/horizonte.test.ts`,
`server/crm.test.ts`, `server/acesso.test.ts`,
`server/avisos.test.ts`, `server/telegram-polling.test.ts`,
`server/sinal-de-vida.test.ts`, `server/agenda-no-dell.test.ts`,
os de finanças em `server/financas/` (`natureza`, `transferencias`, `dedupe`,
`parcelas`, `visoes` — com o obrigatório "o mesmo gasto nunca conta duas
vezes" —, `resumo`, `pluggy-mapa`, `fatura-santander`, `rotas` (as travas de acesso) e `sync`, este com um
SQLite num diretório temporário),
`src/ajuste-do-usuario.test.ts`,
`src/operations-agenda-window.test.ts`, `src/operations-alertas.test.ts`,
`src/office/postos.test.ts`, `src/office/trabalhadores.test.ts`,
`src/office/vista.test.ts` (Lista|Mapa e escala inteira) e
`src/casca/casca.test.ts` (rotas por perfil, Ctrl+K, a ordem da Hoje, estado do
time só com fonte, linha do funil)). O monitor do Dell tem os seus em Python:
`python3 deploy/dell/dell-status.test.py`. Os de
`src/` cobrem módulos sem Vue, não componentes: nada monta o Vue nem toca o
Google, e o texto depende de locale/fuso passados por parâmetro para não variar
com a máquina. `auth-escopos`, `squad` e `agenda-no-dell` gravam num diretório
temporário (chdir/env antes do import) e nunca em `data/`; `avisos` e
`telegram-polling` gravam a fila e o offset em temporário; `fetch` é dublê em todos. A verificação
continua sendo typecheck + build + exercitar a rota.

### Architectural Context (Graphify)
- READ ONLY: Always inspect and read existing graphs, AST maps, and architecture diagrams directly from:
  `dev/graphify-out/` (or relative path to graphify-out/)
- NEVER run graphify build, parse, or indexing commands locally on the Windows host.
- Graph updates run on the Dell: the Hermes job "Graphify — projetos" refreshes every project nightly at 03:00 (the live clones in place, and each other GitHub repo as a shallow mirror in `~/Mel/Repos/<name>`). The PC reads those graphs by pulling them over SSH (`scp -r mel:Mel/Grafos/ .`: one `<project>/graphify-out/` folder per project, plus `global-graph.json`); it never rebuilds them. In a session running on the Dell (local or an SSH session from the PC), `graphify update .` after a code change is fine (AST only, no API cost).

## Arquitetura

Um processo Express serve a API e a SPA Vue. Sem banco.

```
server.ts                 Express: monta o webhook do Telegram antes do porteiro, o porteiro, as rotas e o Vite/estáticos
  server/acesso.ts        porteiro de IP (403 antes de qualquer rota); no Dell, identidade do Serve e escrita da mesma origem
  server/dados.ts         SQUADONE_DATA_DIR e a trava que só liga a agenda no Dell com ele fora do clone
  server/auth-store.ts    credencial do Google: code flow, refresh, cifra em disco
  server/squad.ts         roster v3 em árvore, migração, regras de id; única fonte de verdade das squads
  server/hire.ts          contratação (card ou UI), nova squad, substituição de PO
  server/ciclo-de-vida.ts editar, arquivar e reativar pessoa/domínio/squad
  server/redacao.ts       Gemini redige papel + escopo (não grava)
  server/orchestrator.ts  um turno: demanda -> 1 chamada ao Gemini -> capacidades
  server/turno.ts         demanda já validada -> um turno; ponto único usado por /api/orquestrar e pelo bot do Telegram
  server/capabilities.ts  as capacidades que o modelo pode invocar (agendar_evento, criar_tarefa, crescimento, troca de squad)
  server/alocador.ts      PURO: ocupação + janela + pedido + agora -> slots
  server/agenda.ts        ocupação do turno: 1 leitura do primary + reservas
  server/agendamento.ts   compromisso -> eventos (foco, ou marco + blocos)
  server/quest.ts         recusa classificada e validação comum das rotas de quest
  server/plano-de-ajuste.ts  PURO: duração/esforço aprovados sobre o alocador
  server/ajuste.ts        aplica o ajuste aprovado no Google
  server/calendar.ts      leitura/escrita no Google Calendar (listar, GET/PATCH/POST de um evento)
  server/avisos.ts        Aviso no schema da fila de avisos do Dell, gravação atômica, P0 também no Telegram, cartões, sem R$
  server/lembretes.ts     PURO: quais eventos avisar, quando e com que texto (um Aviso)
  server/vigia.ts         laço de 60 s: relê a agenda e publica os lembretes devidos
  server/sinal-de-vida.ts ping ao healthchecks.io (DEADMAN_URL); /fail com o WhatsApp fora há > 15 min
  server/passos.ts        PURO: normaliza os passos, título da lista, notas e due da tarefa-mãe, escopo concedido
  server/tasks.ts         transporte do Google Tasks: lista, tarefa, ErroTasks classificado, timeout 10 s
  server/passos-no-google.ts  lista por squad (single-flight) + tarefa-mãe + subtarefas + vínculo no evento
  server/telegram.ts      transporte da Bot API: lê a config do ambiente, segredo do webhook em tempo constante, sendMessage/sendChatAction/setWebhook
  server/telegram-entrada.ts  PURO: update do Telegram -> comando/demanda/ignorar, dedupe de update_id em memória
  server/telegram-resposta.ts PURO: TurnoResult -> texto do chat (sem parse_mode), reusa linhasDosEventosCriados
  server/telegram-bot.ts  cola: portão (segredo) + receber/processar (allowlist via telegram-entrada, 200 imediato, fila serial, áudio, botões de contratação)
  server/telegram-polling.ts  entrada por getUpdates (Dell): offset persistido ao enfileirar, nunca setWebhook
  server/transcricao.ts   áudio do Telegram -> texto da demanda (uma chamada ao Gemini)
  server/avaliacoes-turno.ts  nota do usuário sobre um turno recém-entregue (desligada por padrão)
  server/operations.ts    perfil `operations` (só Dell): SQUADONE_MODE, bind loopback, rotas /api/operations/*
  server/auto-production.ts   Central: leitura das pastas de ~/auto-site para o CRM (somente leitura)
  server/crm.ts           Central: CRM (/crm) a partir do retrato das planilhas que o n8n grava; registro pelo webhook do n8n
  server/dell-status.ts   Central: lê o status.json gravado pelo monitor deploy/dell/dell-status.py (o_que_fazer, acao, sozinho)
  server/financas/        Central: finanças (Meu Pluggy + fatura em PDF do Santander), banco financas.db; ver ARCHITECTURE "Finanças"
    tipos, comum, natureza, categoria, transferencias, dedupe, parcelas, visoes, processar, resumo, pluggy-mapa, fatura-santander: PUROS
    pluggy.ts (transporte), banco.ts (better-sqlite3, 600, migrações), sync.ts (polling), pdf-texto.ts (pdfjs), rotas.ts (/api/financas)
src/main.ts -> src/RootApp.vue  pergunta /api/runtime (perfil e `agenda`) e monta a casca com { perfil, agentes }
src/App.vue               a casca (07/10/2026): rota atual, barra inferior/lateral, Ctrl+K, folhas do roster, aviso
  src/casca/              destinos.ts (PURO: rota por perfil, barra, Ctrl+K), hoje.ts (PURO: ordem da Hoje,
                          estado do time só com fonte, linha do funil), rota.ts (pushState sem roteador),
                          overview.ts (retrato do Dell), ditado.ts (microfone do Pedir), pilhaDeFolhas.ts;
                          BarraInferior, BarraLateral, CascaTopo, PedirFolha, Paleta, DellAlerta
  src/rotas/              HojeRota (/), AgendaRota (/agenda), EscritorioRota (/squadone), MaisRota (/mais)
  src/agentes/estado.ts   estado e ações dos agentes (era o <script> do App.vue): roster, squad ativa, Mochila,
                          turno, cartões, folhas; um por aba (`useAgentes`), com as guardas de isLoading e abertura
  src/agentes/ListaDeQuests.vue  compromissos da Mochila: "próximos 3" na Hoje e a Agenda por dia
  src/operations/         Central de Operações (só perfil operations), montada como rotas da casca
    ComoFuncionaPanel.vue os fluxos da operação, um por vez, e "Um dia"; conteúdo em fluxos.ts (estático, versionado)
    alertas.ts            PURO: separa falha / fila / vale olhar / resolve sozinho; links só do Dell; contagem das filas
    AccessPanel.vue, DellConferePanel.vue (tudo que o Dell confere, fechado): em Mais; agenda-window.ts: a agenda do dia na Hoje sem os agentes
    Crm*.vue, crm-formato.ts  CRM: Hoje, Funil (no celular: Site/Organizar, abas de etapa, lista) e Ficha (folha cheia)
    financas/             Finanças: Visão (tenho, devo, gastei, todo mês) e Lançamentos; saúde e "dados até" em toda tela
  src/estilos/            tokens.css (paleta + modo escuro), casca.css (layout), agentes.css (cartões, botões, campos), design.md
  src/auth/google.ts      invólucro fino sobre /api/auth/*
  src/squadAtiva.ts       squad ativa da aba (localStorage)
  src/mochila.ts          sem Vue: "Bloco i/N" e intervalo de dia inteiro, derivados da lista
  src/rosterApi.ts        escritas do roster com erro classificado
  src/contribuicao.ts     sem Vue: formata minutos, resume o turno e o ajuste, monta o ajuste do usuário
  src/components/         Sheet (folha acessível), GameMap (import dinâmico), GrowthCard, AjusteCard,
                          TrocaSquadCard, SquadSelector, SalasPainel, SalaCartao,
                          ContratarFolha, EditarFolha, NovaSquadFolha, ArquivoFolha
  src/office/             geometria isométrica, salas, sprites
  src/office/vista.ts     PURO: Lista|Mapa (localStorage com try/catch) e a escala inteira do mapa
  src/office/salas.ts     diferença de salas (abrir/fechar/trocar dono), pura
  src/office/postos.ts    PURO: posto de cada pessoa na sala (cadeiras, depois espalhado); tiles livres
  src/office/trabalhadores.ts  catálogo versionado: trabalhador automático (n8n, timer) → sala; FORA do prompt (RULES 26)
  src/office/pixelProps.ts  SVG pixel art dos móveis (mesa, cadeira, planta, estante...)
  src/office/useOffice.ts loop rAF, câmera, atores; passeio ambiente vs. movimento por comando
seed/squad.seed.json      roster inicial — FORA de data/, ver "Volume" abaixo
data/                     volume em produção; nada aqui é versionado
```

### Quatro invariantes que o código assume

**1. O roster é uma árvore de três níveis.** `roster → squad → domínio → { po, integrantes }`. Uma squad = um escritório 3x3; uma sala = um domínio. Contratar um integrante entra na sala existente; criar um domínio ocupa o primeiro slot livre de `unlockOrder` (derivado dos slots ocupados, não de `dominios.length`). Máximo 9 domínios por squad. Squad nasce com 1 domínio + PO (o `GameMap` precisa de `dominios[0].po`). Ids de domínio e de pessoa são únicos entre **todas** as squads e `idsAposentados`; domínio novo é `<squad>--<slug>`, os legados (`po`, `geral`) ficam como estão.

**2. O roster é o prompt.** A árvore **da squad ativa** vai literal para o `systemInstruction` em `orchestrator.ts`; as outras squads entram só por id, nome e escopo, para o modelo poder chamar `sugerir_troca_squad` sem conseguir agendar nelas (o servidor então troca e reprocessa sozinho — ver "Redirecionamento automático de squad"). A squad ativa é escolha da aba (`localStorage`), mandada como `squadId` em `/api/orquestrar` e `/api/mochila`; a rota resolve a squad antes de pedir token e antes do Gemini. Não existe "treinamento do agente" guardado em outro lugar: `papel` + `escopo` de cada `Pessoa` *são* o treino. Persistir o roster já persiste os agentes. O escopo de pessoa (até 1500 caracteres, cinco linhas: Missão, Cuida de, Não cuida de, Ao opinar sobre um compromisso, Sinais de alerta) é o treino; entra em bloco recuado na árvore.

**3. As quests vivem no Google Calendar, não aqui.** `GET /api/mochila` lê do Google a cada chamada. Editar ou apagar no Google reflete na próxima leitura. `quests` no frontend é cache da última resposta, nunca fonte de verdade. A leitura vai 7 dias para trás, mas o card some quando a quest **termina** (`questTerminou` em `src/mochila.ts`, relógio de 30 s): filtro só da vista, a lista cheia segue alimentando "Bloco i/N".

**4. Arquivar não apaga.** Pessoa, domínio e squad arquivados ficam na árvore com `arquivado: true` e somem do prompt, do mapa e da vista (`paraVista` só põe ativos em `dominios`/`squads`; o resto vai em `arquivo`/`squadsArquivadas`). Arquivar grava o id em `idsAposentados` (só acréscimo, e reativar não tira). O PO não se arquiva: substitui-se, e o anterior vira integrante arquivado. `dominios[0]` e a última squad ativa nunca se arquivam. Helpers de turno, Mochila, prompt e slots veem só ativos; os de unicidade de id veem tudo. `agendar_evento` tira a cor do índice no array **cru**, para a cor de um domínio não mudar quando outro é arquivado. Nada no ciclo de vida chama o Google (a rota de renomear squad chama o Tasks depois, fora dele — ver "Passos no Google Tasks").

### Marcas no Calendar

Todo evento criado carrega quatro chaves em `extendedProperties.private`, montadas por `marcasDoEvento()` em `server/calendar.ts`; blocos de prazo levam uma quinta, e o evento principal com passos leva mais duas:

| Chave | Eixo | Uso |
|---|---|---|
| `squadone_squad` | informativa | de qual squad veio; **não filtra** — eventos anteriores à Fase 1 não a têm e seguem aparecendo |
| `squadone_dominio` | filtro | `events.list` com `privateExtendedProperty`, uma chamada por domínio da squad ativa |
| `squadone_membro` | atribuição | quem executa |
| `squadone_tipo` | semântica | `time_blocking` ou `deadline` (blocos de prazo são `time_blocking`) |
| `squadone_prazo_ref` | ligação | só em blocos: eventId do marco. A Mochila deriva "Bloco i/N" da lista lida; posição não é gravada |
| `squadone_tasks_lista` | vínculo | só no evento principal (foco ou marco) com passos: id da lista da squad no Google Tasks. Entra por PATCH depois das tarefas, não em `marcasDoEvento` |
| `squadone_tasks_pai` | vínculo | idem: id da tarefa-mãe. Autoritativo; as notas da mãe (`squadone_evento=<eventId>`) são só informativas |

`paraQuest` lê o tipo da marca e só cai no prefixo `⏰ DEADLINE:` do título quando ela não existe (eventos anteriores a 12/09/2026, sem migração). O prefixo segue no título como rótulo. Deadline grava `transparency: "transparent"`: é marco, não ocupa agenda.

### Toggle Auto / Foco / Baixa Prioridade

A folha Pedir (era a CommandBar) manda `modo` em `/api/orquestrar` (ausente = `auto`, inválido = 400) e volta para Auto depois de cada envio. `auto` deixa o modelo escolher o tipo. `foco`/`baixa_prioridade` acrescentam a regra ao prompt **e** `agendarCompromisso` impõe `time_blocking` mesmo se o modelo divergir; se o campo esperado faltar, usa o do outro tipo (`esforco_min` no lugar de `duracao_min`; regra em `server/agendamento.ts`).

Os dois modos forçados gravam o mesmo tipo. O que muda é **até onde se procura horário**:

| Modo | Tipo imposto | Busca | Vez na série |
|---|---|---|---|
| `auto` | nenhum (o modelo escolhe) | conforme o tipo | por tipo |
| `foco` | `time_blocking` | primeiro slot livre a partir de agora, até 14 dias corridos | depois do horário fixo |
| `baixa_prioridade` | `time_blocking` | primeiro slot livre até o fim do **7º dia útil** (`DIAS_UTEIS_BAIXA_PRIORIDADE`) | **por último** |

- **7 dias úteis, não corridos:** `limiteDeDiasUteis` em `server/alocador.ts` conta pelos mesmos dias que o alocador varre — `DIAS_TRABALHO` — e reusa `janelasDosDias`, então dia sem janela não conta e o resto de HOJE já é o primeiro. É só um `limite` passado ao pedido de foco; o algoritmo é o mesmo.
- **Por último na série:** `prioridadeDeAgendamento` dá 3 ao bloco de baixa prioridade (fixo 0, foco 1, prazo 2) — ele pega o que os outros compromissos do turno deixaram. `inicio_fixo` com hora continua vencendo: hora dita pelo usuário não é "quando sobrar".
- **Prazo do modelo continua valendo como teto:** com `prazo_final` mais curto que os 7 dias úteis, vale o mais apertado dos dois.
- **`deadline` (marco transparente + blocos, `squadone_prazo_ref`, "Bloco i/N", alvo `esforco` do Ajuste) não foi removido.** Só o botão que FORÇAVA esse tipo saiu da UI: em `auto` o modelo continua escolhendo `deadline` quando a frase descreve um prazo real ("entrega até sexta").

### Agendamento: o horário é do servidor

O modelo decide a intenção (`tipo`, `duracao_min` ou `esforco_min`, `prazo_final`, `a_partir_de`); o servidor escolhe o horário. `inicio_fixo` só existe quando o usuário disse a hora — é gravado mesmo com conflito, que vira aviso.

- **Ocupação é global:** `events.list` do `primary` inteiro, uma vez por turno (preguiçosa: turno sem agendamento não lê), 60 dias à frente, sem filtro de marca, até 10 páginas.
- **O horizonte conta do início da busca, não de agora:** `horizonteDaBusca` (`server/alocador.ts`) dá o trecho que `alocar` varre — de `a_partir_de` (ou agora) até o teto do pedido, no máximo 60 dias depois do início. Pedido que cabe nos 60 dias de agora usa a leitura padrão; "depois de 15/01/2027" pedido em setembro lê só o próprio trecho (`AgendaDoTurno.ocupacao(trecho)`, uma leitura por trecho no turno). Antes o teto era `agora + 60 dias` e pedido distante virava "Nenhum horário livre … entre 2027-01-16 e 2027-01-16". Horário fixo distante também tem o conflito verificado agora (lê o trecho do slot). Não ocupa: transparente, dia inteiro, cancelado, `workingLocation`/`birthday`, recusado pelo próprio usuário. Outros calendários não contam.
- **Dias da semana no prompt:** `calendarioDaSemana` (`server/orchestrator.ts`) põe hoje e os 7 dias seguintes com o nome ("hoje, quarta 2026-09-23; quinta 2026-09-24; ..."). Sem ele o modelo fazia a conta sozinho e errava — medido em 23/09/2026, "na sexta" virou um sábado. Vale para `a_partir_de`, `prazo_final` e a `data` da tarefa.
- **Janela:** `JANELA_TRABALHO` (padrão `09:00-19:00`; minutos em :00, :15, :30 ou :45, porque todo slot cai na grade de 15 min; pelo menos 30 min) e `DIAS_TRABALHO` (padrão `1,2,3,4,5`), fuso `America/Sao_Paulo`. Env e não `squad.json`: é do usuário, não da squad. Ausente ou vazia = padrão; presente e ilegível = 500 `configuracao: true` antes do token e do Gemini, nunca o padrão calado. O boot loga a janela lida. Trocar exige **Implantar**.
- **Focar Agora:** primeiro slot livre a partir de agora (grade de 15 min), até 14 dias. Não achou = erro `motivo: semHorarioLivre` só naquele compromisso. **Baixa Prioridade** é o mesmo, com o teto no 7º dia útil (ver o toggle acima).
- **Prazo Final:** marco transparente no prazo (sem hora = dia inteiro) + blocos de 30–120 min antes dele, um por dia antes de empilhar, pausa de 15 min, até 20. Não coube = cria o que coube e avisa quanto faltou (`faltou_min`). Bloco que falha para a série sem apagar nada.
- **Série:** os `agendar_evento` de um turno rodam um por vez (fixo, foco, prazo mais próximo, baixa prioridade) e cada reserva desconta da ocupação. O resto das capacidades segue em paralelo. Resultados voltam na ordem das chamadas. Turno com `sugerir_troca_squad` descarta os agendamentos antes de ler a agenda.
- **Sem credencial:** o turno roda; cada `agendar_evento` vira erro com `motivo: precisaConectar` sem chamar o Google, e a UI volta a oferecer "Conectar".
- **O toast diz o que foi marcado:** quem escolhe horário e duração é o servidor, então `resumoDosEventosCriados` (`src/contribuicao.ts`) monta título + duração + dia/hora por evento criado e `handleDelegation` mostra no toast — antes só erro e aviso chegavam à tela. Os blocos de um prazo entram dobrados no marco ("3 bloco(s), 3h"): um prazo rende até 20 e listá-los estouraria o toast. Com redirecionamento automático, a squad de destino entra neste mesmo toast, que substitui o do salto.
- `server/alocador.ts` é puro (sem `fetch`, relógio, env ou import) e é o que o Ajuste reusa. Mantenha assim.

### Redirecionamento automático de squad

`sugerir_troca_squad` não espera clique. `executarTurno` roda o turno, vê a proposta, troca para a squad de destino e reprocessa a **mesma** demanda lá — uma 2ª chamada ao Gemini, só nesse caso — e devolve o resultado do 2º turno como se fosse o original, com `redirecionado: { de_id, de_nome, para_id, para_nome, justificativa }`. A aba adota `para_id` (localStorage) antes de reler a Mochila e só mostra um toast.

- **Um salto por turno.** Se a squad de destino também sugerir troca, o servidor para e devolve o resultado dela, proposta inclusa: o `TrocaSquadCard` (Trocar / Trocar e reenviar / Descartar) sobra só para esse empate. Sem o teto, duas squads apontando uma para a outra rodariam o Gemini até o timeout do proxy, e cada salto é pago.
- **O turno de origem não deixa rastro** porque não deixa efeito: `descartarPorTroca` já descarta todas as outras chamadas antes de executar, então nada nasceu no Google e a agenda nem foi lida. Os erros dele também não voltam.
- Invariante de custo mantida: no 2º prompt a squad ativa é a **destino**, inteira; a origem vira "outra squad" (id, nome, escopo). Mesmo `agora` e mesmo `modo` nos dois turnos — o toggle é sobre o tipo do compromisso, não sobre a squad.
- Destino inválido ou arquivado entre a proposta e o salto: sem 2º turno, o resultado da origem volta como antes.

### Dica de execução na criação

`agendar_evento` tem um campo `nota_de_execucao`: o modelo escreve a dica no **mesmo** turno em que decide data e duração, do ponto de vista do responsável e do treino dele ("Ao opinar sobre um compromisso" do escopo é a rubrica). Ela vira a descrição do evento no POST, **antes** da assinatura do SquadOne.

- **Texto puro.** Sem marcador de bloco e sem hash: é escrita única, na criação, e nada volta a reescrevê-la. O protocolo de proteção de edição manual que existia na Contribuição (removida em 13/09/2026) não se aplica aqui — editar a descrição no Google é seguro.
- **Teto `MAX_NOTA_DE_EXECUCAO` (600) em `server/agendamento.ts`**, com reticências: a dica é para ser lida de relance no card do Google, e o teto é o que impede uma resposta fora do esperado de virar um muro de texto na agenda.
- Só no evento principal. Os blocos de um prazo levam a assinatura sozinha: a dica é do compromisso, e repeti-la em cada bloco seria ruído.
- Campo omitido ou vazio = descrição só com a assinatura, como antes.

### Passos no Google Tasks

Segundo canal para os micro-passos de um compromisso: uma tarefa-mãe com subtarefas no Google Tasks, visível no Gmail, no Calendar e no app Tasks do Android sem abrir o SquadOne.

- **Campo, não capacidade.** `agendar_evento` tem `passos: string[]` opcional. O turno é one-shot e o modelo não recebe eventId de volta: uma capacidade separada não teria como apontar para o evento. É o mesmo padrão da `nota_de_execucao`. O prompt manda passos só com pedido explícito de checklist/etapas ou num prazo com etapas que a demanda sugere (2–8 itens); pedido de checklist sem compromisso vira `criar_tarefa` com passos (ver "Tarefa avulsa"). Vale igual nos três modos.
- **Normalização no servidor** (`normalizarPassos`, `server/passos.ts`): só strings, espaços colapsados, vazios fora, dedupe sem diferenciar maiúsculas, `MAX_TITULO_PASSO` 200 com reticências, `MAX_PASSOS` 10 (o excedente vira aviso). Um item cria.
- **Uma lista por squad**, `SquadOne · <nome>`, criada no primeiro compromisso com passos. O id fica em `Squad.tasksListaId` (roster, fora do prompt e da vista) e nunca é procurado por título — o usuário renomeia no celular. Criação single-flight (`Map` em memória, processo único); a chamada ao Google fica fora da fila do `atualizarRoster`, só a gravação do id entra nela. Lista gravada que responde 404/410 é recriada e o id sobrescrito, uma vez por chamada.
- **Fluxo** (depois de `agendarCompromisso`, só com passos): sem escopo → aviso `ampliarAcesso` e nenhuma chamada; lista; tarefa-mãe (título do compromisso, notas = `htmlLink` + `squadone_evento=<eventId>`, `due` = data LOCAL de São Paulo do evento principal como `AAAA-MM-DDT00:00:00.000Z` — o Tasks descarta a hora, e converter para UTC trocaria o dia depois das 21h; marco usa o dia do prazo); subtarefas em ordem com `parent` e `previous` (sem `previous` o Google põe cada uma no topo), sem `due` (com data cada uma viraria um chip no Calendar); PATCH do evento principal com `squadone_tasks_lista`/`_pai` via `lerEvento` + `atualizarPreservandoMarcas`.
- **Falha não se propaga.** Nada do Tasks desfaz ou falha o compromisso. Falha antes da mãe: aviso (escopo → `ampliarAcesso`; API desligada → sem motivo, a mensagem do Google diz o que fazer). Subtarefa que falha para a série sem apagar e avisa quantas faltaram. PATCH que falha: aviso, tarefas ficam com o vínculo só nas notas. 401 repete uma vez com token novo (`comTokenTasks`); persistiu → `precisaConectar`. Timeout de 10 s por chamada: roda dentro da série de `agendar_evento`.
- **Toast:** `EventoCriado.passos` (subtarefas criadas, só no evento principal) vira "· N passo(s) no Google Tasks".
- **Selo "passos 2/5" na Mochila, só leitura e à prova de falha.** `paraQuest` expõe `tasksLista`/`tasksPai` das marcas; depois do `listarQuests`, `anexarProgressoDosPassos` (`server/passos-no-google.ts`) faz UMA `tasks.list` por lista distinta (`showCompleted` + `showHidden`: concluída e "limpa" no celular vira hidden e ainda conta; `MAX_PAGINAS_TAREFAS` 5 × 100) e conta as filhas de cada mãe (`progressoDosPassos`, puro: apagada não conta, mãe sem filha viva não ganha selo). Sem escopo não chama; lista sumida, 401/403, timeout ou qualquer erro = só `console.warn` e as quests voltam sem selo — a Mochila nunca falha por causa do Tasks, e o Calendar continua a fonte de verdade (invariante 3). Tarefa não tem horário: não passa pelo alocador nem gera lembrete.
- **Escrita única, de propósito:** nada reescreve as tarefas depois. O Ajuste não atualiza o `due`; apagar o evento deixa as tarefas órfãs; a vigia não sabe do Tasks; o redirecionamento de squad usa a lista da squad de destino sozinho.
- **Renomear a squad renomeia a lista**, só se o título no Google ainda for o gerado (`SquadOne · <nome antigo>`): lista renomeada no celular fica como o usuário deixou. É a rota `PATCH /api/squad/squads/:id` que chama `renomearListaDaSquad`, **depois** de gravar e sem segurar a resposta — `ciclo-de-vida.ts` continua sem tocar o Google (invariante 4). Sem escopo, sem lista ou lista apagada: nada acontece (log). Falha não desfaz o nome novo.

### Tarefa avulsa (`criar_tarefa`)

O que precisa ser feito mas não pede horário ("comprar leite", "pagar o boleto dia 30") vira item no Google Tasks, sem evento. Antes o único caminho para o Tasks era `passos` em `agendar_evento`, e todo lembrete virava um bloco de 60 min na agenda.

- **Regra no prompt:** `agendar_evento` só quando a demanda precisa de TEMPO reservado; lembrete, compra, pagamento, recado, "anotar" é `criar_tarefa`. Desempate: parar o que está fazendo por mais de 15 min = agenda. Checklist sem compromisso = `criar_tarefa` com `passos`.
- **Campos:** `titulo` e `responsavel_id` obrigatórios (pessoa validada antes de qualquer chamada, como no agendamento); `data` (`AAAA-MM-DD`) vira o `due` pela parte de data escrita — nunca convertida para UTC, mesmo motivo do `dueDaTarefa`; ilegível = tarefa sem data + aviso; `notas` com a assinatura `SquadOne · <pessoa> (<domínio>)` no fim; `passos` viram subtarefas (mesma normalização e teto). Tetos `MAX_TITULO_TAREFA` 300 e `MAX_NOTAS_TAREFA` 2000 em `server/passos.ts`.
- **Mesma lista da squad** dos passos (`garantirListaDaSquad`, single-flight). Nenhum PATCH em evento: não há evento.
- **Foco e Baixa Prioridade viram bloco.** Os dois modos são o usuário pedindo horário: o prompt proíbe `criar_tarefa` e, se o modelo chamar mesmo assim, o handler converte em `agendar_evento` `time_blocking` (duração padrão, `data` → `a_partir_de`, `notas` → `nota_de_execucao`). Por isso `criar_tarefa` entra na **série** de agendamento só nesses modos; em `auto` roda em paralelo.
- **Aqui a falha é erro, não aviso:** a tarefa é o resultado inteiro. Sem o escopo → `TasksNaoAutorizado`, erro com `motivo: ampliarAcesso` (`MotivoDeErro` ganhou o valor); a UI e o bot tratam igual ao aviso dos passos (toast/linha "Autorizar Google Tasks", nunca alert nem logout). 403 de escopo e 401 seguem `motivoDoErroTasks`. Subtarefa que falha depois da tarefa = aviso.
- **Resultado:** `TurnoResult.tarefas_criadas: TarefaCriada[]`; o toast (`resumoDosEventosCriados(eventos, fmt, tarefas)`) e o bot (linha `📋`) mostram título, dia e passos. É o único lugar do app que conta que a tarefa nasceu: a Mochila não lê o Tasks (invariante 3), a vigia não avisa, o alocador não a toca.

### Ajuste de tempo

O único fluxo que edita uma quest depois de criada. `POST /api/quests/:eventId/ajustar {alvo, proposto_min, permitirMover?}` só roda com aprovação (`AjusteCard`) e relê tudo do Google.

- **Duas origens, um contrato.** A proposta pode vir de um agente ou do botão "Ajustar" da agenda (`ListaDeQuests` → `propostaDoUsuario` em `src/contribuicao.ts` → o mesmo `AjusteCard`). `PropostaDeAjuste.origem` distingue: em `usuario` o card nasce com um campo de minutos e o `proposto_min` emitido é o do card, não o da proposta. O botão só aparece onde o servidor aceitaria (`alvoDeAjuste`: bloco com horário → `duracao`, marco → `esforco`; foco de dia inteiro não tem alvo), e `normalizarPropostoMin` põe o valor na grade de 15 e nos limites de `interpretarPedidoDeAjuste` (`LIMITES_DE_AJUSTE` em `src/types.ts` é o espelho) — a rota não mudou.
- **Alvos:** duração (foco/bloco) ou esforço total (marco, medido pelos blocos com `squadone_prazo_ref`). Duração muda só o fim; se não cabe, 409 `naoCabe` e mover é um segundo clique (`permitirMover`). Esforço cria blocos extras antes do prazo (com as 5 marcas) ou encurta blocos futuros até 30 min; bloco que mudou desde a listagem é pulado e vira `sobra_min`. Nada é apagado. 412 no ajuste não retenta.
- **PATCH:** todo PATCH de evento passa por `atualizarPreservandoMarcas`: `If-Match` com o etag lido, `sendUpdates=none`, `extendedProperties.private` **completo** (lido + o que muda). A resposta é conferida: marca `squadone_*` sumida → restaura uma vez → `marcasPerdidas` (500).
- **Token por chamada:** a rota checa `tokenValido()` antes e passa `obterToken`; cada leitura/PATCH/POST no Google pede o token de novo logo antes (`comToken`, o cache do auth-store absorve o custo). Um ajuste de esforço faz dezenas de escritas em série e um token lido só no começo venceria no meio. Google recusou a credencial: pede de novo e, vindo token diferente, repete uma vez; só com o mesmo token o 401 vira `precisaConectar`.
- **Teto de tempo do Gemini (turno e redação):** `gerarComRetry` dá 45 s (`TIMEOUT_GEMINI_MS`) a cada tentativa, por `abortSignal` + corrida contra um relógio. Timeout conta como transitório: retenta e cai no modelo reserva; esgotou, `ModeloOcupado`. Pior caso de uma geração: 2 modelos × 2 tentativas × 45 s + backoff ≈ **3 min**. Proxy com timeout menor que isso corta a resposta (a UI mostra erro de rede; nada fica gravado pela metade).
- **As chamadas ao Google Tasks também rodam em série**, dentro de `agendar_evento`, cada uma com `TIMEOUT_TASKS_MS` (10 s) — ver "Passos no Google Tasks". Um compromisso com passos soma cerca de `N + 4` chamadas ao Google (lista — 1: `lerLista` com id já gravado, ou `inserirLista` na primeira vez —, tarefa-mãe, N subtarefas, leitura + PATCH do vínculo), mais uma (`N + 5`) se a lista salva sumiu no Google, antes do próximo compromisso da série e da resposta HTTP: outro motivo para o proxy ter folga além do teto do Gemini acima.
- Erros de quest: 404 `questSumiu`, 409 com a flag (`eventoSemMarca`, `eventoDeOutraSquad`, `dominioInativo`, `conflitoDeEdicao`, `alvoIncompativel`, `naoCabe`, `semHorarioLivre`), 401 `precisaConectar`, 500 `configuracao`/`marcasPerdidas`, 502 o resto do Google.
- Nada disto grava fora do Google: a persistência continua só `squad.json` e `google-auth.json`.

### Agenda no Dell (perfil operations)

A agenda (roster, turno, Mochila, ajuste, vigia, bot) muda do Easypanel para o processo `operations` do Dell (`127.0.0.1:9120`), regras 7, 20 e 25. O código chega desligado; quem liga é o runbook manual `deploy/dell/CUTOVER-AGENDA.md`, passo a passo, com volta em cada um.

- **Só liga com o diretório de dados próprio.** `SQUADONE_DATA_DIR` (padrão `./data`, `server/dados.ts`) guarda `squad.json`, `google-auth.json` e o offset do Telegram. No `operations`, `motivoParaAgendaDesligada` deixa a agenda desligada (rotas do app em 404, sem vigia, sem bot) enquanto a env falta ou aponta para dentro do checkout: o `~/SquadOne/data` do Dell é o retrato de 14/09/2026, e o primeiro `atualizar-central` depois do merge montaria tudo sobre ele. No Dell o diretório é `~/.local/share/squadone`, fora do clone, no cofre (`fontes.toml`).
- **Nunca semeia no Dell.** Sem `squad.json`, `readRoster` lança `RosterAusente` (503 + `rosterAusente`) em vez de copiar a seed: uma agenda nova e vazia seria usada pelo bot e pela vigia como a de verdade. O roster de **produção** é a verdade; o do Dell é arquivado, nunca mesclado (`scripts/conferir-roster.ts` só compara).
- **Congelamento.** `SQUADONE_ROSTER_CONGELADO=true` faz `atualizarRoster` lançar `RosterCongelado` (409 + `rosterCongelado`, filha de `ConflitoDeRoster`) dentro da fila: contratar, editar, arquivar e gravar o id da lista do Tasks param durante a cópia, a comparação e a troca. A leitura continua. Fica `true` no Easypanel depois do cutover (reserva fria).
- **Acesso (regra 7).** No `operations`, `guardaDeIdentidade` confere o `Tailscale-User-Login` que o Serve põe em cada pedido contra `SQUADONE_LOGINS_TAILSCALE` (leitura também; Funnel nunca); pedido local direto (sem `X-Forwarded-For` nem header do Serve) passa. Ligada sempre que a agenda está no processo — aí lista vazia **fecha** a tailnet — ou que a lista existe; sem os dois a Central segue como antes, para o merge não derrubar o celular. `guardaDeOrigem` em `/api`: POST/PUT/PATCH/DELETE só com `Origin` de host e porta iguais ao `Host` e `Sec-Fetch-Site` (quando vem) `same-origin`; GET passa (GET nunca escreve). curl local de escrita precisa de `-H 'Origin: http://127.0.0.1:9120'`.
- **OAuth pelo loopback.** No `operations`, `redirectUri` exige `APP_URL` em `http://127.0.0.1`/`localhost` (`ErroDeConfig` se não) e `/api/auth/google` e `/callback` respondem 409 a pedido vindo pelo Serve: conectar (e autorizar o Tasks) é pelo PC, com o túnel `Mel-Tuneis`, em `http://127.0.0.1:9120/api/auth/google`. Nada de redirect em `ts.net`.
- **`/squadone`** é o endereço dos agentes na Central inteira: com `agenda: true` no `/api/runtime` o `RootApp` abre o app ali; sem, redireciona ao Easypanel (como antes do cutover).
- **Avisos** (`server/avisos.ts`). `Aviso {titulo, texto, origem, chave, prioridade, expiraEm, link?}` validado no schema da fila da fase 1 (`deploy/dell/README.md`, "Fila de avisos") e gravado atomicamente (`.tmp` oculto + rename) em `~/.local/share/avisos/fila` (`SQUADONE_AVISOS_FILA`), que o dell-status drena para o WhatsApp com teto, silêncio e chave de 24 h. Não cria a pasta (é `2770` com o grupo do n8n). P0 também vai ao Telegram (`sendMessage` a cada chat de `TELEGRAM_CHAT_IDS`), mesmo com a fila quebrada; falha do Telegram não falha o aviso. **Nenhum "R$"** passa em título, texto ou link (`AvisoInvalido`); `semValores` troca o valor de texto do usuário por "[valor]". Cartão que pede decisão (`avisoDeCartao`): link só da origem da tailnet (https, `.ts.net`) + caminho sem query nem fragmento, e texto sem URL — abrir não confirma.
- **Sinal de vida** (`server/sinal-de-vida.ts`): com `DEADMAN_URL`, GET a cada minuto no healthchecks.io; `/fail` quando a sessão do WhatsApp (`whatsapp-sessao` no `status.json` do dell-status; retrato velho conta como fora) está fora há mais de 15 min. Só no `operations`. Falha do ping é só log.
- **Simular a vigia do Dell:** `POST /api/avisos/varrer {"agora":"…"}` faz uma varredura real com relógio simulado e devolve os avisos que sairiam, sem gravar na fila nem na deduplicação. Não há envio de teste: o único caminho para a fila é a vigia.

### Lembretes

Aviso no WhatsApp `ANTECEDENCIA_LEMBRETE_MIN` (10) minutos antes de cada bloco e de cada marco, pela fila de avisos do Dell (ver "Agenda no Dell"): a vigia grava, o dell-status drena e o Hermes entrega. Só no perfil `operations` com a agenda; o Easypanel (reserva fria) não roda vigia, porque dois processos varrendo a mesma agenda mandariam cada lembrete duas vezes (regra 25). O ntfy saiu depois de 3 dias úteis de sombra.

- **Nada é agendado para o futuro.** `server/vigia.ts` roda a cada 60 s: lê o roster, pede o token, faz **um** `events.list` por calendário distinto das squads ativas na janela `agora → agora + 12 min` (`listarQuestsDaJanela`, sem filtro de marca) e publica o `Aviso` que `mensagemDoDisparo` monta para cada item de `disparosDevidos` (`server/lembretes.ts`, puro). Editar, apagar ou ajustar no Google reflete na varredura seguinte; redeploy não deixa timer órfão.
- **Quem avisa:** só evento com `squadone_dominio` de domínio ativo. Bloco com horário (foco ou bloco de prazo) conta do **início**; marco com horário conta do **fim** (o prazo real — o marco vai de prazo − 15 min até o prazo); marco de dia inteiro conta do início da `JANELA_TRABALHO` do dia; bloco de dia inteiro não avisa. Evento que o SquadOne não criou não avisa.
- **Janela do disparo:** `[referência − 10 min, referência)`. Aviso atrasado ainda sai; depois do horário, não (e o `expiraEm` do aviso é o próprio horário, então a fila também o descarta se ficar preso no teto ou com o Hermes fora).
- **Duas deduplicações.** Em memória na vigia (`eventId@referência`, sem arquivo) e a `chave` `lembrete:<eventId>@<referência>` na fila, que o dell-status descarta se repetida em 24 h: redeploy dentro dos 10 min não reenvia. Evento movido ganha chave nova e é avisado de novo. Servidor fora do ar durante a janela inteira perde o aviso.
- **Prioridade:** marco P1, bloco P2; nenhum lembrete é P0 (P0 fura o silêncio das 22h às 7h e vai também ao Telegram). Título do compromisso sem quebra de linha, cortado em 120 e sem valor em R$.
- **Falha não se propaga:** `agendamento.ts` e `ajuste.ts` não sabem que o aviso existe. Aviso que não grava fica fora da deduplicação e é tentado na varredura seguinte. Um calendário que falha não cala os outros. As varreduras do laço (`iniciar()`) não se sobrepõem (`emAndamento`).
- **Sem credencial do Google:** um aviso "SquadOne sem acesso ao Google" (P1) por perda (não por minuto); volta a avisar normalmente quando reconecta.
- **Testar sem esperar o horário:** `POST /api/avisos/varrer {"agora":"2026-09-15T13:50:00-03:00"}` (com `Origin` da mesma origem) roda uma varredura real contra o Google com relógio simulado e devolve os avisos que sairiam, sem gravar na fila nem na deduplicação. Não há envio de teste: o único caminho para a fila é a vigia.

### Bot do Telegram

Segundo canal de entrada, além do Pedir: mandar uma demanda pelo Telegram roda o mesmo turno e cria os mesmos eventos. `server/turno.ts` (`rodarDemanda`) é o ponto único que as duas portas de entrada chamam, para as duas terem a mesma ordem (squad e janela antes do token e do Gemini).

- **Dois transportes** (`TELEGRAM_TRANSPORTE`): `webhook` (padrão, Easypanel; tudo abaixo sobre rota, segredo e `setWebhook`) e `polling` (Dell, obrigatório no `operations`). No polling (`server/telegram-polling.ts`) o processo busca com `getUpdates` (`timeout` 50, `allowed_updates` mensagens + botões), sem rota e sem `TELEGRAM_WEBHOOK_SECRET` (a trava vira o token, que só existe no Dell). Cada update vai a `bot.receber` (o mesmo de `processar`, sem Express: deduplica e enfileira) e **só então** o offset (`update_id + 1`) é gravado em `SQUADONE_DATA_DIR/telegram-offset.json`; o `getUpdates` seguinte o confirma. Nunca chama `setWebhook`: 409 (webhook ainda registrado ou outro processo buscando) vira log uma vez e espera de 30 s. A guarda de demanda atrasada é a mesma: o backlog que o `deleteWebhook` **sem** drop deixa vira "⌛".

- **Validação do webhook** (`server/telegram.ts`): o Telegram manda `TELEGRAM_WEBHOOK_SECRET` no header `X-Telegram-Bot-Api-Secret-Token` em todo POST — não segredo no path, que vazaria em log de acesso do Traefik e em qualquer `console.warn(req.path)`. Comparação em **tempo constante** (SHA-256 dos dois lados + `timingSafeEqual`: o hash iguala o tamanho, e um `if` de tamanho antes vazaria o tamanho do segredo). Ordem na rota: **segredo antes do parse do corpo** (`portao` → `express.json` → `processar`) — sem o segredo, 401 sem corpo e sem o JSON ser lido.
- **Única rota fora do porteiro de IP.** O Telegram não tem IP fixo garantido (publica faixas, que podem mudar). `server.ts` monta `POST /api/telegram/webhook` **antes** de `app.use(porteiroDeIp())`, e só ela — qualquer outro método ou caminho continua atrás do porteiro. Com o bot desligado a rota nem é montada e o caminho cai no porteiro (403) como hoje. A trava própria da rota é o segredo (acima) + a allowlist de chat (abaixo).
- **Allowlist de `chat_id` fecha quando vazia** — ao contrário de `IPS_PERMITIDOS`, que vazia desliga o porteiro. O username do bot é público e buscável; um bot aberto deixaria qualquer pessoa criar eventos no Google Calendar do usuário e gastar Gemini. `TELEGRAM_CHAT_IDS` vazia com token presente é `TelegramMalConfigurado`. Só `chat.type === "private"` conta; grupo é ignorado mesmo que o id esteja na lista. Chat fora da lista: **200 sem resposta nenhuma** (quem não passa não precisa saber que o bot está vivo) e `console.warn("[telegram] chat <id> não autorizado (TELEGRAM_CHAT_IDS)")` — é assim que o dono descobre o próprio `chat_id`: manda `/start`, lê o log do Easypanel. 200 e não 403 porque status ≠ 2xx faz o Telegram reentregar o mesmo update com backoff e segurar os seguintes.
- **Squad ativa sem aba: primeira squad ativa, sem estado novo.** `rodarDemanda` recebe `squadId` ausente e `resolverSquad` devolve `squadsAtivas(roster)[0]` (hoje `pessoal`). A exceção é o prefixo `/p` (`PREFIXOS_DE_SQUAD` em `server/telegram-entrada.ts`): fixa `squadId: "prumo"` pelo id, sem estado e sem chamada a mais ao modelo, e o redirecionamento continua valendo depois dele; squad sumida ou arquivada = `SquadInexistente` antes do Gemini, e `textoDaFalha` diz que nada foi criado e para mandar sem o prefixo. O redirecionamento automático (`sugerir_troca_squad` → `executarTurno` troca e reprocessa) resolve demanda de outra squad — o usuário começa a mensagem dizendo do que se trata. Custo aceito: demanda de squad que não é a primeira custa **2 chamadas ao Gemini**. Alternativas descartadas: arquivo com a squad ativa (quebra o escopo de persistência V1 por algo que o redirecionamento já resolve); "última squad usada" em memória (estado escondido, some no redeploy); env `TELEGRAM_SQUAD_PADRAO` (duplica verdade do roster, squad arquivada/renomeada deixaria a env apontando pro nada).
- **Webhook responde 200 imediatamente; turno roda numa fila serial.** Um turno pode levar até ~6 min no pior caso — com redirecionamento automático de squad, até 2 gerações do Gemini (teto de ~3 min cada, ver "Ajuste de tempo") mais as chamadas ao Google; se o webhook segurasse a resposta, o Telegram desistiria e reentregaria o update — o mesmo compromisso nasceria duas vezes. Então: valida → `res.sendStatus(200)` → processa depois. **Dedupe de `update_id`** em memória (últimos 500): reentrega por ACK perdido não roda o turno de novo (redeploy zera, custo aceito, mesmo raciocínio da vigia). **Fila serial** (cadeia de promessas): dois turnos em paralelo leriam a agenda antes de o outro reservar e pegariam o mesmo horário — a CommandBar evita isso com `isLoading`, o bot precisa da fila. Turno da UI e do bot ao mesmo tempo continua possível (custo aceito). Enquanto roda: `sendChatAction typing` a cada 4 s; mensagem que chega com a fila ocupada recebe "⏳ Na fila (N antes desta)." Crash do processo depois do 200 e antes da resposta perde a resposta (custo aceito).
- **Resposta em texto puro, sem componente Vue.** `server/telegram-resposta.ts` (PURO) espelha o que `handleDelegation` (`src/agentes/estado.ts`) faz com o `TurnoResult`, mas em texto (sem `parse_mode`: título de evento com `_`/`*` quebraria o Markdown do Telegram). Reusa `linhasDosEventosCriados` (`src/contribuicao.ts`, `{ locale: "pt-BR", timeZone: FUSO }` — o container roda em UTC, o fuso é obrigatório). Texto cortado em 4096 caracteres (limite do `sendMessage`). Tarefas avulsas entram com `📋`.
- **Contratação se aprova por botão.** O resumo do turno só conta "💡 N proposta(s) de contratação abaixo"; cada proposta de domínio/integrante vai numa mensagem própria (`textoDaProposta`) com **✅ Aprovar** / **🗑️ Descartar** (`inline_keyboard`, `callback_data` = `h:<id da sugestão>:a|d`, ≤ 64 bytes). O toque chega como `callback_query`: mesma allowlist (chat privado da lista; fora dela, silêncio), `answerCallbackQuery` para tirar o "carregando", e a mensagem é editada com o resultado — sem `reply_markup`, então os botões somem. Aprovar chama o MESMO `aplicarContratacao` da rota `/api/squad/hire` (revalida tudo contra o roster atual, aplica na squad da proposta, nome escolhido pelo servidor). As propostas vivem **só em memória** do processo (`VALIDADE_PROPOSTA_MS` 24h, `MAX_PROPOSTAS_PENDENTES` 50): redeploy ou vencimento = "⌛ Proposta expirada". **Uso único:** a proposta sai da memória ANTES de aplicar, então dois toques rápidos não contratam duas pessoas, e uma contratação que falha não deixa botão para repetir (pede de novo). Toque fora da fila de turnos: contratar não lê a agenda, e `atualizarRoster` já serializa a gravação. A troca de squad (o empate de dois saltos) continua só texto.
- **Áudio vira demanda.** Voz (`message.voice`) ou arquivo `audio/*` (`message.audio`); legenda `/foco`/`/baixa` força o modo. Teto `MAX_DURACAO_AUDIO_S` 120 e `MAX_BYTES_AUDIO` 5 MB, conferido pelo update ANTES de baixar ("🎙️ Áudio longo demais"). Na fila serial, como o texto: `getFile` + download (`baixarArquivo`, a URL de arquivo também leva o token e nunca aparece em erro), transcrição por uma chamada separada ao Gemini (`server/transcricao.ts`, arquivo inline, `gerarComRetry`, `SEM_FALA` → `AudioSemFala` → "Não entendi o áudio"), e a transcrição roda como demanda — a resposta começa ecoando `🎙️ “<o que entendeu>”` para o usuário conferir. Custo: **uma geração a mais por áudio**, e o áudio passa pelo Google além do Telegram. Guarda de demanda atrasada vale igual.
- **Comandos** (`server/telegram-entrada.ts`, PURO, depois da checagem de chat): texto sem `/` é demanda em `modo: auto`; `/foco <texto>` e `/baixa <texto>` forçam o modo (mesmo mecanismo do toggle da CommandBar); `/p <texto>` fixa a squad PRUMO, combinável com um modo em qualquer ordem (`/p /foco x`) e na legenda do áudio — um comando de modo e um de squad no máximo, repetido ou desconhecido vira ajuda; `/start`, `/ajuda`, `/help`, `/foco`/`/baixa` sem texto ou comando desconhecido devolvem texto de ajuda sem chamar o Gemini; mensagem sem `text` nem áudio (foto, figurinha, documento) devolve "Só texto ou áudio por enquanto."; `edited_message`, `channel_post` e updates sem `message`/`callback_query` são ignorados. Sufixo `@NomeDoBot` do comando é descartado.
- **Registro do webhook no boot, só em produção.** Com o bot ligado, `NODE_ENV === "production"` e `APP_URL` presente, o boot chama `setWebhook` (idempotente) com `secret_token` e `allowed_updates: ["message", "callback_query"]` (o segundo são os botões; o **Implantar** que traz esta versão já o registra); falha vira `console.error` sem derrubar nada — inclusive `APP_URL` sem esquema (`new URL` lançaria dentro do callback de `listen`, fora de qualquer promise, o que derrubaria o processo sem o try/catch). Assim trocar `TELEGRAM_WEBHOOK_SECRET` e clicar **Implantar** já reconfigura o Telegram — sem isso um passo manual esquecido deixaria o bot recebendo 401 calado. Em dev nunca registra: `APP_URL` de dev é `http://localhost` (o Telegram exige HTTPS) e registrar com o token de produção roubaria o webhook do servidor real; teste local é com `curl` simulando o update.
- **Privacidade:** chat de bot do Telegram **não é E2E** — demanda e resposta (títulos, horários) passam pelos servidores do Telegram (os lembretes, pelo Hermes e pelo WhatsApp). Decisão do usuário, custo conhecido.
- **`chat_id` não é segredo** (é visível para quem conversa com o bot ou lê um encaminhamento); o segredo do webhook é a trava de verdade — quem tem `TELEGRAM_WEBHOOK_SECRET` forja um update com o `chat_id` do dono e passa pela allowlist como se fosse o Telegram. A allowlist só filtra tráfego genuíno do Telegram vindo de estranhos, não substitui o segredo. Segredo vazou: rotacione (troca a env + **Implantar**, o boot registra o webhook de novo com o valor novo).
- **Demanda atrasada não roda.** Enquanto a rota não existe (rollback, config inválida, servidor fora) o Telegram guarda os updates por até ~24h e reentrega tudo quando ela volta, com a memória de `update_id` vazia: um `/foco` das 9h viraria compromisso "a partir de agora" às 15h, ou duplicado se o usuário já reenviou pelo app. `interpretarUpdate` recebe `agora` (continua PURO; o bot injeta o relógio em `DepsDoBot.agora`) e devolve `atrasada` quando `agora − message.date` passa de `IDADE_MAXIMA_DEMANDA_MIN` (10 min): sem turno, resposta "⌛ Não processei: … N min de atraso … Reenvie se ainda valer." e `console.warn`. 10 min cobre a reentrega de um redeploy normal. Só a **demanda** envelhece — ajuda e "só texto" antigos respondem normalmente (não criam compromisso). `date` ausente ou no futuro não bloqueia: na dúvida, roda. O `drop_pending_updates` do rollback continua valendo, para não receber uma enxurrada de "⌛".

### Escrita no roster

Toda mutação passa por `atualizarRoster()`, que serializa read-modify-write numa fila. Um arquivo para todas as squads, então uma fila só: duas aprovações quase simultâneas, mesmo em squads diferentes, leriam o mesmo `squad.json` e a segunda apagaria a primeira. `writeRoster` grava num `.tmp` e renomeia por cima — crash no meio deixa o `.tmp` pela metade, nunca o `squad.json`. Contratação aplica na squad da proposta (`sugestao.squad_id`), não na que a tela mostra.

### Contratação e ciclo de vida

Contratar: botão por sala e **+ Abrir sala** (na Lista do Escritório, `SalasPainel`, ou na folha que abre ao tocar num personagem do Mapa), ou card do modelo (Aprovar/Ajustar). O prompt manda o modelo sempre chamar a capacidade de crescimento quando o pedido é explícito. Redigir (`POST /api/squad/redigir`) é uma chamada de function calling restrita (`ANY` + um nome), via `gerarComRetry`, e não grava nada: `responseMimeType` é instável na troca de modelo do retry. Falha dela nunca impede contratar à mão.

| Rota | Efeito |
|---|---|
| `PATCH /api/squad/{pessoas,dominios,squads}/:id` | edita texto (400 acima do limite, sem cortar); ids nunca mudam |
| `POST /api/squad/{pessoas,dominios,squads}/:id/arquivar` | arquiva (idempotente) |
| `POST /api/squad/{pessoas,dominios,squads}/:id/reativar` | reativa; domínio volta ao slot antigo se livre, senão ao primeiro livre, senão 409 |
| `POST /api/squad/dominios/:id/po` | substitui o PO (`integranteId` ou pessoa nova) |
| `POST /api/squad/hire` | card do modelo corta texto (escopo 1500); `escopo_po` separa o treino do PO do escopo do domínio |

Ids de pessoa e domínio são globais, então as rotas não levam `squadId`. Id inexistente é 409, não 404: é aba com roster velho. Mochila: domínio arquivado some (um `events.list` só por domínio ativo); quest de integrante arquivado continua, com "(arquivado)". Squad arquivada em `/api/orquestrar`, `/api/mochila`, hire ou redigir é `SquadArquivada`, mesmo 409 + `squadInexistente` de squad sumida.

### Escritório: gente demais e gente andando

Só frontend; nada disto grava.

- **Legível sem clicar é a SALA, não a pessoa.** Placa "NOME · N". O rótulo "nome · papel" do ator fica oculto e só aparece em hover, com `.actor--focus` (andando por comando, câmera junto) ou `[data-ativo]` (responsável da demanda). No `.actor` nada de `:class`: `useOffice` escreve `actor--walk`/`actor--focus` por `classList` e o patch de classe do Vue apagaria.
- **Postos (`postos.ts`):** cadeiras do template primeiro, excedente espalhado maximizando distância de tela, nunca em porta nem no tile logo dentro dela. O posto depende só da sala e do índice: contratar não reassenta quem já estava. O teste fixa ≥ 40 px até 8 pessoas em todo template — encher um template de móveis quebra o teste de propósito.
- **Passeio vs. comando:** ator parado passeia (6–16 s, 80% na própria sala, 20% na vizinha pela porta, no máximo 1/3 fora ao mesmo tempo). `moveTo`/entrada de contratado cancelam o passeio; visita do PO raiz segura o ator lá até o próximo comando. A câmera só segue quem anda por comando. `prefers-reduced-motion` desliga o passeio, os ciclos idle em CSS e a suavização da câmera (o ator comandado ainda anda: é ele que diz quem atende).
- **Lista | Mapa (07/10/2026):** o Escritório (`/squadone`) abre em Lista no celular e em Mapa a partir de 1024 px; a escolha fica no `localStorage` (`squadone:escritorio:vista`, try/catch em `office/vista.ts`). A Lista (`SalasPainel` → `SalaCartao`) é texto e tem todos os gestos; o Mapa só carrega quando aberto (`defineAsyncComponent`, pedaço próprio do bundle). Um andar (squad) por vez, `:key` pela squad.
- **Escala inteira, sem Tab:** o GameMap escolhe a maior escala inteira em que o andar cabe (`escalaInteira`, até 3×) e oferece Afastar/Aproximar/Encaixar. A tecla Tab, que alternava 1×/2× e prendia quem navega por teclado, não faz mais nada no mapa.
- **Toque:** cada personagem tem um `<button>` de 44×44 px de TELA (`calc(44px / var(--escala))`) com o estado no nome acessível; tocar abre a sala numa folha, com os gestos da Lista.
- **Estado com texto e só com fonte** (`estadoDaPessoa`, `estadoDaSquad` em `casca/hoje.ts`): bloco em curso ou próximo compromisso (da agenda lida desta squad), responsável pelo último pedido desta aba, ou `Sem sinal` por extenso. Nada de "ocioso"/"trabalhando" inventado.
- **rAF pausado** com a aba em segundo plano (`visibilitychange`) ou o mapa fora da tela (`IntersectionObserver`): nem loop, nem passeio, nem ciclo idle (`animation-play-state`); ao voltar, a câmera encaixa.
- **Automáticos da sala:** sob cada sala da Lista (slot `rodape` do `SalaCartao`), em texto, os trabalhadores automáticos dela pelo catálogo (`src/office/trabalhadores.ts`), sem estado — rodou/falhou é da Central.

### Dois perfis: app (Easypanel) e operations (Dell)

O mesmo código roda em dois lugares, escolhido por `SQUADONE_MODE` no servidor. Detalhes e regras da Central estão em `ARCHITECTURE.md` e `RULES.md` — leia-os antes de mexer em `server/operations.ts`, `server/auto-production.ts`, `server/dell-status.ts`, `src/operations/` ou `deploy/`.

- **`app` (padrão, Easypanel):** o SquadOne de sempre, bind `0.0.0.0`. `/api/operations/*` responde 404 JSON (sem isto o fallback da SPA devolveria HTML 200). Ausente = `app`; valor desconhecido derruba o boot — perfil errado não pode abrir a Central calado.
- **`operations` (só no Dell, `deploy/dell/squadone-operations.service`):** a Central em `/` (`/squadone` abre os agentes aqui com a agenda ligada; sem ela, redireciona ao app do Easypanel, como desde 30/09/2026), rotas `/api/operations/*`, bind **só em `127.0.0.1`** (acesso por túnel/Tailscale). Exige `SQUADONE_OPERATIONS_CONFIG`; a credencial do Google é outra, local ao Dell, independente da de produção. As rotas do app (`rotasDoApp` em `server.ts`: roster, Mochila, turno, ajuste, avisos, avaliação) só são montadas com a agenda ligada (ver "Agenda no Dell"); sem ela o resto de `/api` é 404 JSON, e do Google ficam só `/api/auth/google` e `/callback` (a agenda da Central). `/api/push/*` não existe mais (o ntfy saiu). O `~/SquadOne/data/squad.json` do Dell é um retrato de 14/09/2026 e nunca vira a agenda.
- **`GET /api/runtime`** devolve `{ mode, avaliacoes, ocupado, agenda }` (`agenda`: o app mora neste processo). `ocupado` = turno em andamento (`haTurnoEmAndamento`, contado em `rodarDemanda`) ou mensagem na fila do bot (`bot.ocupado()`); o `deploy/dell/atualizar-central.sh` espera `false` (até 10 min) antes de reiniciar.
- **`src/RootApp.vue`** pergunta `/api/runtime` e monta a MESMA casca (`App.vue`) com `{ perfil, agentes }`: no `operations`, Hoje com o estado do Dell, Funil, Finanças, Entrada e, com `agenda: true`, os agentes (Pedir, Agenda, Escritório); no `app`, só os agentes. Falha na pergunta = perfil `app`, nunca a Central. `/squadone` sem a agenda continua redirecionando ao Easypanel.
- **Casca mobile (07/10/2026):** barra inferior abaixo de 1024 px (Hoje · Funil · ＋Pedir · Finanças · Mais no Dell; Hoje · Agenda · ＋Pedir · Escritório · Mais no Easypanel), barra lateral e Ctrl+K/⌘K a partir dela. Links de rota da casca navegam com `pushState` (`casca/rota.ts`), sem recarregar: recarregar no meio de um turno perderia a resposta. A Hoje segue a RULES 13 (no máximo 3 cartões, depois "ver todas"). O CRM tem CSS próprio só com tokens (`src/operations/crm.css`, modo escuro incluso); só os painéis de Mais (como funciona, acessos, o que o Dell confere) seguem em `operations.css`, claros, com fundo próprio.
- **Pedir é uma folha** (`casca/PedirFolha.vue`, era a CommandBar): chip da squad, Auto/Foco/Baixa de 44 px, ditado pelo navegador (Web Speech API, pt-BR, desabilitado com o motivo onde não existe) e o MESMO corpo `{ demanda, modo, squadId }` em `/api/orquestrar`. Erros e avisos do turno ficam por extenso na folha até o próximo pedido (eram `alert()`); com a folha fechada, o aviso traz "Ver detalhes".
- **`Sheet`** (`components/Sheet.vue`) é a folha de tudo: Pedir, contratar, editar, nova squad, arquivo, sala do mapa, ficha do CRM, Ctrl+K. `role="dialog"` + `aria-modal`, Esc, alça (arrastar para baixo), botão Fechar, foco preso (Tab gira e o `#app` fica `inert`) e devolvido a quem abriu; `bloqueada` durante um envio (nada fecha). Abaixo de 48 rem sobe de baixo; acima, diálogo no meio.
- **A Central é somente leitura** para serviços (RULES 8, 10, 16): mostra estado e links, nunca para, reinicia ou reconfigura. O estado do Dell vem só do `status.json` do monitor.

### Avaliação de turno (desligada)

`POST /api/turnos/:turnoId/avaliacao {nota 1–5, motivos[≤3], comentario?}` guarda a opinião do usuário sobre um turno que **este processo** acabou de devolver: com `SQUADONE_AVALIACOES=true`, `/api/orquestrar` devolve `turno_id` e guarda um resumo sem dados pessoais num cache em memória (30 min, 100 turnos). Grava em `data/avaliacoes-turno.json`, fora do roster e do prompt: a nota não treina nada sozinha. Nenhum componente da UI chama a rota ainda. Desligada é o padrão, e é o que mantém a persistência de produção só em `squad.json` + `google-auth.json`.

## Persistência

Volume Docker do Easypanel montado em `/app/data`; no Dell, `~/.local/share/squadone` (`SQUADONE_DATA_DIR`, fora do clone, mais o `telegram-offset.json` do polling). Onde a tabela diz `data/`, leia "o diretório de dados". Poucos KB:

| Arquivo | Conteúdo |
|---|---|
| `data/squad.json` | roster v3 `{ version: 3, squads, idsAposentados }` = os agentes com seu treino; inclui arquivados (`arquivado`, `arquivadoEm`); `tasksListaId` opcional por squad (lista do Google Tasks, lazy) |
| `data/google-auth.json` | `refresh_token` cifrado em AES-256-GCM e o `scope` concedido (Calendar, e Tasks quando autorizado) |
| `data/squad.v2.bak.json` | texto cru do roster v2, gravado uma vez pela migração; nunca sobrescrito |

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

### O prazo de 7 dias (resolvido em 12/09/2026)

Em **Externo + Testando** o Google expirava o refresh_token em **7 dias**. Política do Google, não bug. O app foi **publicado (Em produção)** em 12/09/2026 e o prazo caiu. O código não muda em nenhum dos dois casos.

Para publicar, o Google exigia os três links da página Branding preenchidos — sem eles o botão **Publicar app** fica desabilitado com *"you must complete your configuration on the Branding page"*. Os três apontam para a raiz do app (`https://aladdin-squadone-app.jicnzg.easypanel.host/`), o que basta porque o app segue **não verificado**:

- consentimento mostra a tela "o Google não verificou este app" — clicar em *Avançado* passa;
- teto vitalício de 100 usuários concedendo permissão. Um usuário, irrelevante.

**Não subir logotipo.** Logo, mais de 10 domínios autorizados, ou escopo restrito forçam enviar o app para verificação — aí os links precisariam ser páginas reais e acessíveis, e o porteiro de IP bloqueia o rastreador do Google.

Status em console.cloud.google.com/auth/audience (projeto `gen-lang-client-0086006291`); o botão de lá agora é **Voltar para o teste**, que reverte.

### Porteiro de IP

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
| `DEADMAN_URL` | servidor | só `operations`: ping do healthchecks.io (https, sem query); ausente = sem sinal; ilegível = log e desligado |
| `PLUGGY_CLIENT_ID` / `_SECRET` / `PLUGGY_ITEM_IDS` | servidor | só em `operations`, no EnvironmentFile `~/.config/squadone/financas.env` (600); ausentes = finanças sem leitura; um presente sem os outros = log de erro e Pluggy desligada. Nunca impressos |

`VITE_*` é embutida no bundle no `vite build`, **não lida em runtime**. Mudar o client ID exige rebuild. Uma string qualquer passa por `if (!CLIENT_ID)` e o Google recusa sem erro legível — por isso há validação de formato.

## Deploy

Easypanel, projeto `aladdin`, app `squadone-app`, em `https://aladdin-squadone-app.jicnzg.easypanel.host`. Nixpacks a partir do GitHub (`romulosutil/SquadOne`, branch `main`). **Implantação automática ligada** (24/09/2026): todo push/merge em `main` dispara o build no Easypanel — não existe mais "clicar Implantar" como passo. Dois merges seguidos disparam dois builds e o segundo pode cancelar o primeiro ("context canceled" no log): confira em Implantações se o último ficou verde, e se não ficou clique **Implantar** uma vez. Onde este arquivo ainda diz "clicar **Implantar**", leia "fazer push em `main`". **Apagar** uma variável do Ambiente só vale depois de um build novo: **Implantar** sem commit novo só reinicia a imagem, e o `.env` que o build gravou nela traz a variável de volta pelo `dotenv` (visto em 07/10/2026; ver `deploy/dell/CUTOVER-AGENDA.md`, passo 1).

## Convenções

- Comentários e identificadores em **português**. Comentário explica *por quê*, não *o quê* — a maioria dos blocos aqui documenta a decisão e o que aconteceria sem ela.
- Erros carregam classificação, não só mensagem: `ErroDeDominio.credencial`, `PedidoInvalido` (400) vs `ConflitoDeRoster` (409), `SquadInexistente` (409 + `squadInexistente: true`: a UI recarrega e cai na primeira squad), `SquadArquivada` (filha dela, mesmo 409 + flag), `RedacaoInvalida` (502 + `redacaoFalhou`), `ModeloOcupado` (503 + `modeloOcupado`), `RosterIlegivel` (500), `PrecisaConectar` vs `ErroDeConfig`, `JanelaMalConfigurada` (500 + `configuracao`), `ErroTarefa.motivo` (`precisaConectar`, `configuracao`, `semHorarioLivre`, `agendaIndisponivel`), `ErroTasks` (`ehCredencial` só 401, `escopoInsuficiente`, `apiDesligada`), `ListaSumiu`, `TasksSemResposta`, `EscopoNegado` (callback → `?auth=escopo_calendar_negado`), `AvisoTarefa.motivo: "ampliarAcesso"` (`server/orchestrator.ts`; carregado internamente em `AvisoDoCompromisso`, passos sem o escopo do Tasks: toast com "Autorizar Google Tasks", nunca logout), `TelegramMalConfigurado` (env do bot presente e ilegível: log de erro no boot, bot desligado, resto do app igual), `ErroDeTelegram` (`status` da Bot API, `null` quando nem houve resposta; só `console.error`, nunca derruba o turno nem a rota), `RosterAusente` (503 + `rosterAusente`: Dell sem o roster de produção), `RosterCongelado` (409 + `rosterCongelado`), `AvisoInvalido` (fora do schema da fila ou com R$: o aviso não é gravado), `SinalMalConfigurado` (`DEADMAN_URL` ilegível: log, sem sinal). A UI decide o que fazer pelo tipo.
- Falha de uma parte não derruba o resto: um domínio com erro no Calendar não zera a Mochila inteira; um turno sem credencial ainda roda as capacidades que não tocam o Google; um compromisso que falha não impede os seguintes da série; a checklist do Tasks que falha não desfaz o compromisso.
- Ao terminar tarefa: `git commit` + `git push`. O grafo é do Hermes no Dell (job "Graphify — projetos", às 03:00, sobre os clones vivos e os espelhos de todos os repositórios do GitHub; o PC puxa por SSH de `~/Mel/Grafos`); no Dell, `graphify update .` depois de mudar código; nunca no Windows. Depois do push, a Central do Dell se atualiza sozinha em até 10 min (`atualizar-central.timer`).

### Remote Infrastructure Directives
- **O PC novo (Jarvis, Windows, `paiduben` na tailnet) é a máquina de controle desde 04/10/2026**; o Dell é a Mel (`romulo-sutil-corr-a-latitude-7420`, sempre ligado). De 28/09 a 04/10 o próprio Dell controlou, porque o PC antigo queimou (NVMe): o que não tinha sincronizado foi perdido, não procure nem reconstrua. Estado, túneis e checklist: `deploy/pc/README.md`.
- **No PC:** o apelido SSH é `mel` (`ssh mel`, só chave); o antigo `dell-worker` não existe no PC novo. Editor do n8n e code-server só pelo túnel (`deploy/pc/instalar-tuneis.ps1`). Git em clones do GitHub em `C:\Users\sutil\dev`, fora de pasta sincronizada.
- **Numa sessão que roda no Dell** (local ou sessão SSH do app Claude do PC): `docker` direto; `~/SquadOne` é o checkout de produção da Central (não edite nem troque de branch: worktree em `~/.cache/mel-work/` e PR); nunca Git na réplica congelada `~/Pessoal-dev`. Instalar, systemd, Docker, n8n e rclone só numa sessão no Dell.
- Local Windows Docker service is disabled by design. All containers run exclusively on the Dell.
- Never search Windows paths for container binaries or Nginx executables.
- From the PC, run container commands via `ssh mel "docker ..."` or `DOCKER_HOST="ssh://mel"`.
- Container mounts map to `~/workspace/` on the Dell. Nothing is mirrored from the PC anymore (Syncthing has no paired device since 04/10/2026): code reaches the Dell through GitHub.
