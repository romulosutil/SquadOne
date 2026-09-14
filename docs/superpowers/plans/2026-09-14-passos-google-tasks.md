# Prompt de execução — Passos no Google Tasks

> Prompt autocontido para um agente executor. Planejado em 14/09/2026 a partir da
> leitura de `server/auth-store.ts`, `server/calendar.ts`, `server/agendamento.ts`,
> `server/capabilities.ts`, `server/orchestrator.ts`, `server/squad.ts` e `server.ts`.

---

## Papel e modo de trabalho

Você vai implementar no SquadOne (`C:\Users\sutil\Documents\dev\PESSOAL\apps\SquadOne`)
um **segundo canal para micro-passos de um compromisso: o Google Tasks**. Quando o
modelo decide que um compromisso tem passos miúdos, o servidor cria uma tarefa-mãe
com subtarefas no Google Tasks, ligada ao evento principal no Calendar, visível
nativamente no Gmail, no Calendar e no app Tasks do Android sem abrir o SquadOne.

Antes de tudo:

1. Leia `CLAUDE.md` inteiro. As invariantes de lá valem aqui, principalmente
   "falha de uma parte não derruba o resto", "erros carregam classificação" e
   "comentário explica por quê, em português".
2. Use `graphify query "<pergunta>"` antes de vasculhar código.
3. Use `superpowers:writing-plans` para quebrar este documento em tarefas e depois
   `superpowers:subagent-driven-development` (ou `executing-plans`). Os módulos
   puros (`server/passos.ts` e a classificação de erro de `server/tasks.ts`) saem com
   `superpowers:test-driven-development`, com tabela de casos em `node:test`, como
   `server/lembretes.test.ts`.
4. Grave um checkpoint em `docs/superpowers/plans/2026-09-14-passos-google-tasks.checkpoint.md`
   a cada fase terminada: o que foi feito, o que falta, as decisões e o próximo passo.
5. Não mude as decisões abaixo sem perguntar. Se a documentação da API contradisser
   algum detalhe (formato do erro, ordem de inserção, `due`), siga a documentação,
   anote o que mudou no checkpoint e avise no fim.

---

## Decisões tomadas (não rediscutir)

### D1. Escopo OAuth: autorização incremental, sem logout

- O escopo novo é `https://www.googleapis.com/auth/tasks` (leitura e escrita).
  `tasks.readonly` não serve.
- **Nunca** oriente o usuário a usar `/api/auth/logout`: ele **revoga** o
  refresh_token no Google e derruba o Calendar junto. A migração é o mesmo
  `/api/auth/google`, agora pedindo os dois escopos. `include_granted_scopes=true`
  e `prompt=consent` já estão lá, então o callback recebe um refresh_token novo
  com os dois escopos e `gravar()` substitui o antigo.
- **Quem tem só o escopo do Calendar continua funcionando igual.** O acesso ao
  Tasks é um estado **degradado**, não um erro de conexão:
  - `auth-store.ts` passa a expor o que foi concedido, lido do `scope` gravado na
    credencial (string separada por espaço, como o Google devolve).
  - `GET /api/auth/status` responde `{ conectado, tasks: boolean }`.
  - Sem o escopo, `agendar_evento` cria os eventos normalmente e **não chama o
    Tasks**. O compromisso volta com um aviso `motivo: "ampliarAcesso"`.
- **O `precisaConectar` continua reservado ao Calendar.** Hoje
  `ErroCalendario.ehCredencial` trata 403 `insufficientPermissions` como
  credencial. No Tasks, 403 por escopo insuficiente **não pode** virar
  `precisaConectar`: a UI mostraria "Conectar" com o Calendar funcionando.
- **Cuidado com o fallback legado:** hoje `trocarCodigo` grava
  `scope: dados.scope ?? SCOPE`. Com `SCOPE` virando dois escopos, esse fallback
  declararia um Tasks que ninguém concedeu. Quando `dados.scope` faltar, o fallback
  passa a ser **só o escopo do Calendar**.
- **Consentimento granular:** com dois escopos o Google mostra caixas de seleção.
  - Tasks desmarcado: grava normalmente e o status volta `tasks: false`.
  - Calendar desmarcado: o callback **recusa sem gravar** (a credencial anterior,
    se houver, fica intacta) e redireciona para `/?auth=escopo_calendar_negado`.

### D2. Onde nasce a tarefa: um campo em `agendar_evento`, sem capacidade nova

- Novo campo opcional `passos: string[]` em `agendar_evento`. Não existe
  `criar_tarefa`.
- O motivo é estrutural, não de gosto: o turno é **one-shot**, e o modelo não
  recebe o eventId de volta. Uma capacidade separada não teria como apontar para o
  evento, a não ser por título ou índice, o que é frágil. No mesmo `agendar_evento`
  o servidor já tem o evento criado quando cria as tarefas. É o mesmo padrão da
  `nota_de_execucao`: o modelo escreve no mesmo turno em que decide o compromisso.
- **Pedido de checklist sem compromisso** ("lista: comprar X, Y") fica **fora da
  V1**. O prompt manda transformar em `agendar_evento` com `passos`. Tarefa avulsa
  vai para a lista de adiados.

### D3. Uma lista por squad, criada sob demanda

- Título da lista: `SquadOne · <nome da squad>`. A squad é a fronteira de contexto
  do app (Pessoal ≠ Pay4Fun), e no celular isso vira listas separadas.
- O id da lista fica no roster, num campo novo e opcional
  `Squad.tasksListaId?: string`. Sem versão nova de roster: `validarV3` já tolera
  campos extras. Confira que `editarSquad`, `arquivarSquad`, `reativarSquad`,
  `paraVista` e a migração **não descartam** campos desconhecidos ao reescrever uma
  squad.
- **Não procure a lista pelo título:** o usuário renomeia no Google, e uma busca
  por título criaria duplicatas.
- **Criação lazy e single-flight:** um `Map<squadId, Promise<string>>` em memória
  (processo único). Cria no Google **fora** da fila do `atualizarRoster`, porque
  segurar a fila durante uma chamada de rede trava todas as escritas do roster. Só
  grava o id dentro da fila.
- **Id gravado que devolve 404/410** (lista apagada no Google): cria uma lista nova
  e sobrescreve o id no roster, uma vez só por chamada.
- Squad renomeada não renomeia a lista na V1. Anote no CLAUDE.md.
- `tasksListaId` **não entra** no prompt (`rosterTree`) nem na vista do frontend.

### D4. A Mochila não lê o Tasks na V1

- É um canal separado. A Mochila continua lendo **só** o Calendar (invariante 3).
  Tarefa não tem horário: não passa pelo alocador, não gera lembrete e não entra na
  Mochila como quest.
- A Mochila não ganha chamada nova nem modo de falha novo.
- **Adiado para a Fase 2 (não implementar agora):** um selo "passos 2/5" no card da
  quest, com um `tasks.list` por lista de squad (`showCompleted=true`,
  `showHidden=true`, porque tarefa concluída no celular vira hidden), casado pela
  marca do evento. Falha do selo não pode afetar a Mochila.

### D5. Formato do vínculo

O Tasks **não tem `extendedProperties`**. O campo `links` é somente leitura e não
dá para gravá-lo. Por isso o vínculo tem duas pontas, cada uma no lugar que aceita
metadado:

| Onde | Chave / formato | Autoridade |
|---|---|---|
| Evento principal (`extendedProperties.private`) | `squadone_tasks_lista` = id da lista | **autoritativa** |
| Evento principal | `squadone_tasks_pai` = id da tarefa-mãe | **autoritativa** |
| Tarefa-mãe (`notes`) | última linha: `squadone_evento=<eventId>` | informativa (o usuário edita) |

- O **evento principal** é o evento de foco, ou o **marco** quando o compromisso é
  um prazo. Os blocos não recebem as chaves nem tarefas, pelo mesmo motivo da
  `nota_de_execucao`.
- As duas chaves começam com `squadone_`, então `marcasPreservadas` e
  `atualizarPreservandoMarcas` já as protegem nos PATCHes do Ajuste sem mudança
  nenhuma. Confirme com um teste.
- `marcasDoEvento()` **não** muda: essas chaves só existem depois das tarefas, e
  entram por PATCH (ver a ordem em D6).
- A tabela "Marcas no Calendar" do CLAUDE.md ganha as duas linhas.

### D6. Fluxo de criação (ordem e falha)

Depois de `agendarCompromisso` devolver o compromisso com o evento principal
criado, e só se `passos` normalizado não estiver vazio:

1. **Sem escopo** (`ctx.tasks.liberado === false`): aviso
   `"Passos não criados: falta autorizar o Google Tasks."` com
   `motivo: "ampliarAcesso"`. Fim, sem nenhuma chamada.
2. `garantirListaDaSquad(squad)`, conforme D3.
3. Cria a **tarefa-mãe**:
   - `title` = título do compromisso;
   - `notes` = `htmlLink` do evento + `\n` + `squadone_evento=<eventId>`;
   - `due` = data **local de São Paulo** do evento principal (o início do foco, ou
     o dia do prazo). Formato `AAAA-MM-DDT00:00:00.000Z`: o Tasks descarta a hora e
     usa a parte de data. Converter o instante para UTC trocaria o dia em eventos
     depois das 21h.
4. Cria as **subtarefas** com `parent=<id da mãe>`, **na ordem**. Pela doc, o
   `tasks.insert` sem `previous` põe a tarefa **no topo** entre as irmãs, o que
   inverteria a lista. Passe `previous=<id da subtarefa anterior>` ou insira em
   ordem reversa, e confira na API real. Subtarefas **sem `due`**: com data cada uma
   viraria um chip no Google Calendar.
5. PATCH do evento principal com as duas chaves de D5, via
   `atualizarPreservandoMarcas` (depois de um `lerEvento`, ou montando o `EventoLido`
   a partir da resposta do POST, se `gravar` passar a devolver `etag`; escolha o que
   mexer menos em `agendamento.ts`).

Falhas. **Nenhuma falha do Tasks desfaz ou falha o compromisso:** os eventos já
estão certos no Google.

- Falha antes de criar a mãe: aviso com a mensagem e, se couber, o motivo (escopo →
  `ampliarAcesso`; API desligada → sem motivo, a mensagem do Google diz o que
  fazer).
- Uma subtarefa falha: para a série (como os blocos de prazo), sem apagar nada, e
  avisa quantas faltaram.
- O PATCH do evento falha: aviso "passos criados mas o vínculo no evento não foi
  gravado". As tarefas ficam, com o vínculo só nas `notes`.
- 401 do Tasks: um retry com token novo, no mesmo padrão do `comToken`. Persistiu:
  aviso com `motivo: "precisaConectar"` (aqui é mesmo a credencial).
- Timeout de **10 s por chamada** ao Tasks (`AbortSignal.timeout`). Isto roda dentro
  da série de `agendar_evento`, e um Tasks travado não pode segurar os compromissos
  seguintes.

O resultado aparece no toast: o `EventoCriado` do evento principal ganha
`passos?: number` (quantos foram criados) e `resumoDosEventosCriados`
(`src/contribuicao.ts`) acrescenta "· N passo(s) no Google Tasks".

**Fora do escopo, de propósito (anote no CLAUDE.md):** nada reescreve as tarefas
depois da criação. É escrita única, como a `nota_de_execucao`.

- O Ajuste muda horário ou esforço e não atualiza o `due`.
- Apagar o evento no Google deixa as tarefas órfãs.
- A vigia e os lembretes não sabem que o Tasks existe.
- O redirecionamento de squad funciona sozinho: o 2º turno roda na squad de
  destino e usa a lista dela.

---

## Onde a decisão "isso vira passos" entra no prompt

### Na declaração (`server/capabilities.ts`, `agendar_evento.parameters.properties`)

```ts
passos: {
  type: Type.ARRAY,
  items: { type: Type.STRING },
  description:
    "Opcional. Micro-passos concretos do compromisso, em ordem, que viram uma " +
    "checklist no Google Tasks do usuário. Cada item: verbo no infinitivo, curto " +
    "(até ~80 caracteres), sem repetir o título. Omita quando o compromisso é um " +
    "bloco simples sem etapas distintas.",
},
```

Não entra em `required`.

### Nas regras (`server/orchestrator.ts`, `buildSystemInstruction`, logo depois do item `nota_de_execucao`)

```
- passos: mande SÓ quando (a) o usuário pediu explicitamente checklist, passos,
  etapas ou lista para o compromisso, ou (b) o compromisso é um prazo
  (tipo='deadline') cujo entregável tem etapas concretas e distintas que a própria
  demanda sugere. Entre 2 e 8 itens, em ordem de execução, verbo no infinitivo.
  Não invente etapas que a demanda não sugere e não use passos para repetir a
  nota_de_execucao. Bloco simples de foco: omita. Pedido de checklist sem
  compromisso: chame agendar_evento com os passos (time_blocking, duração
  estimada).
```

A regra vale igual nos três modos (`auto`, `foco`, `baixa_prioridade`). O toggle é
sobre o tipo do compromisso, não sobre ter passos.

### No servidor (a regra valendo de fato, não só como pedido ao modelo)

Em `server/passos.ts` (PURO), `normalizarPassos(valor)`:

- aceita só array; todo o resto vira `[]`;
- `String` + `trim` em cada item, descarta vazios;
- deduplica sem diferenciar maiúsculas, preservando a ordem;
- corta cada item em `MAX_TITULO_PASSO = 200` com reticências;
- limita a `MAX_PASSOS = 10` e devolve `{ passos, cortados }`, para o handler
  avisar quando cortou.

Menos de 1 item válido = não cria nada. Um item só **cria**: se o usuário pediu, a
checklist de um item é dele.

---

## Arquivos afetados

### Novos

| Arquivo | Conteúdo |
|---|---|
| `server/tasks.ts` | **Transporte** do Google Tasks, espelhando o estilo de `calendar.ts`, só com o que a V1 usa: `urlDeListas()`, `urlDeTarefas(listaId)`, `inserirLista(token, titulo)`, `lerLista(token, listaId)` (confere se existe; 404/410 → `ListaSumiu`), `inserirTarefa(token, listaId, corpo, { parent?, previous? })`. `ErroTasks(status, corpo)` com `motivo` (reason do corpo) e getters `ehCredencial` (401), `escopoInsuficiente` (403 `insufficientPermissions` ou detalhe `ACCESS_TOKEN_SCOPE_INSUFFICIENT`) e `apiDesligada` (403 `accessNotConfigured`/`SERVICE_DISABLED`). `comTokenTasks` (ou generalize o `comToken` de `calendar.ts` para receber o predicado de credencial; prefira generalizar se ficar pequeno). Timeout de 10 s. Nenhuma regra de negócio. |
| `server/tasks.test.ts` | Tabela de classificação do `ErroTasks` com corpos reais de erro do Google (401, 403 de escopo, 403 de API desligada, 403 genérico, corpo não-JSON). |
| `server/passos.ts` | **PURO:** `MAX_PASSOS`, `MAX_TITULO_PASSO`, `normalizarPassos`, `tituloDaLista(squadNome)`, `notasDaTarefaMae(htmlLink, eventId)`, `dueDaTarefa(eventoPrincipal, fuso)` (data local → `AAAA-MM-DDT00:00:00.000Z`; dia inteiro usa a própria data), `escopoConcedido(scopeString, escopo)`. Sem `fetch`, relógio, env ou import de I/O. |
| `server/passos.test.ts` | Tabelas de casos: normalização (não-array, vazios, duplicados, corte, limite), `due` perto da meia-noite (evento às 22:30 em SP continua no mesmo dia), dia inteiro, `escopoConcedido` com string de vários escopos. |
| `server/passos-no-google.ts` | **Fluxo com I/O:** `garantirListaDaSquad` (single-flight + persistência via `atualizarRoster`) e `criarPassosDoCompromisso({ compromisso, squad, passos, obterToken, liberado, fuso })`, que devolve `{ criados, avisos, listaId?, tarefaMaeId? }`. Implementa D6. Ninguém importa isto além de `capabilities.ts`. |

### Alterados

| Arquivo | Mudança |
|---|---|
| `server/auth-store.ts` | `SCOPE` vira `ESCOPO_CALENDAR` + `ESCOPO_TASKS` + `ESCOPOS` (juntos por espaço em `urlDeConsentimento`). Fallback de `trocarCodigo` = só Calendar (D1). O callback recusa sem gravar se o Calendar não veio no `scope` concedido (lança uma classe nova, p.ex. `EscopoNegado`). Nova `escoposConcedidos(): Promise<{ calendar: boolean; tasks: boolean }>`, lida da credencial em disco; sem credencial = os dois `false`. Comentário do porquê: incremental, sem logout, porque logout revoga. |
| `server/auth-store.test.ts` | Casos do fallback de escopo e da recusa sem Calendar (sem rede: isole o que for puro). |
| `server.ts` | `/api/auth/status` → `{ conectado, tasks }`. O callback trata `EscopoNegado` → `/?auth=escopo_calendar_negado`. `/api/orquestrar` resolve `tasksLiberado` **uma vez** antes do turno (sem ler disco por chamada) e passa no `PedidoDeTurno`. |
| `server/orchestrator.ts` | `PedidoDeTurno.tasksLiberado?: boolean` (ausente = `false`). Repassa ao `CapabilityContext`. A regra de `passos` entra no prompt (seção acima). O tipo do `motivo` dos avisos aceita `"ampliarAcesso"`. |
| `server/capabilities.ts` | Campo `passos` na declaração. `CapabilityContext.tasks: { liberado: boolean }` e acesso a um `obterToken` (o `tokenValido` do auth-store; confira como a `AgendaDoTurno` já carrega o token e siga o mesmo caminho). No handler de `agendar_evento`: depois de `agendarCompromisso`, `normalizarPassos(args.passos)` e, se houver, `criarPassosDoCompromisso`; junta os avisos e grava `passos` no `EventoCriado` principal. |
| `server/agendamento.ts` | Só tipos: `AvisoDoCompromisso.motivo` ganha `"ampliarAcesso"`; `EventoCriado.passos?: number`. Se precisar do `etag` para o PATCH, `gravar` passa a devolvê-lo. **Não importar** nada do Tasks aqui: `agendamento.ts` não sabe que o Tasks existe, assim como não sabe do push. |
| `server/calendar.ts` | Constantes `PROP_TASKS_LISTA = "squadone_tasks_lista"` e `PROP_TASKS_PAI = "squadone_tasks_pai"`, com comentário no bloco das marcas. `QuestCalendario`/`EventoLido` **não** precisam ler as duas na V1 (a Mochila não usa); não acrescente campos sem uso. |
| `server/squad.ts` | `Squad.tasksListaId?: string`, com comentário: lazy, fora do prompt, sobrescrito se a lista sumir. Helper `gravarTasksListaId(squadId, listaId)` via `atualizarRoster`. Confira que `rosterTree` e `paraVista` não o expõem. |
| `src/types.ts` | Espelho: `motivo` com `"ampliarAcesso"`; `EventoCriado.passos?: number`. |
| `src/auth/google.ts` | `tasksLiberado` ref, preenchido pelo status. `ampliarAcesso()` = o mesmo redirect de conectar. **Não chama logout.** |
| `src/App.vue` | Aviso com `motivo === "ampliarAcesso"` → toast com ação "Autorizar Google Tasks" (o mesmo redirect). Com `conectado && !tasksLiberado`, um chip discreto perto do "Conectar" existente. Trate `?auth=escopo_calendar_negado` com uma mensagem clara. Siga o padrão com que `precisaConectar` já é tratado. |
| `src/contribuicao.ts` | `resumoDosEventosCriados` acrescenta "· N passo(s) no Google Tasks" quando `passos > 0`. |
| `CLAUDE.md` | (1) Na árvore de arquitetura: `server/tasks.ts`, `server/passos.ts`, `server/passos-no-google.ts`. (2) Tabela de marcas: as 2 chaves novas. (3) Seção nova **"Passos no Google Tasks"** com D2–D6 resumidos, o que está fora do escopo e o adiado (selo na Mochila, tarefa avulsa, renomear lista). (4) Autenticação: os dois escopos, incremental, "nunca logout para ampliar", consentimento granular. (5) Persistência: `tasksListaId` em `squad.json`. (6) Lista de testes em "Comandos". (7) Convenções: `ErroTasks` e o `motivo: ampliarAcesso`. |

**Sem variável de ambiente nova.**

---

## Passos manuais no Google Cloud (fazer ANTES de o usuário autorizar; o deploy pode vir antes)

Projeto `gen-lang-client-0086006291`. **Escreva estes passos no resumo final para o
usuário executar; você não tem acesso ao console.**

1. Ativar a **Google Tasks API**: APIs & Services → Library → "Tasks API" → Enable.
2. Consentimento → **Data Access** → adicionar o escopo `.../auth/tasks`.
3. Atenção: **não** clicar em "Submit for verification", **não** subir logotipo e
   **não** acrescentar domínios (ver "O prazo de 7 dias" no CLAUDE.md). O app segue
   publicado e não verificado. O escopo do Tasks é *sensível*, como o
   `calendar.events` que já está lá; a tela "o Google não verificou este app"
   continua e *Avançado* passa.
4. Confirmar que o status em `console.cloud.google.com/auth/audience` continua
   **Em produção**.

Ordem segura de rollout: **deploy do código** → passos 1–4 no console → clicar em
"Autorizar Google Tasks" no app. Deploy sem a API ligada não quebra nada: sem o
escopo, o Tasks nem é chamado.

**Rollback:** implantar o commit anterior. As chaves `squadone_tasks_*` nos eventos
são ignoradas pelo código antigo, e `tasksListaId` no roster é tolerado por
`validarV3`. As tarefas já criadas continuam no Google. O refresh_token com dois
escopos continua servindo ao código antigo.

---

## Fases e verificação

Uma fase = um ou mais commits atômicos. Ao fim de cada fase: `npx vue-tsc --noEmit`
+ `npm test` verdes e checkpoint gravado.

1. **Fase A — puros e transporte:** `server/passos.ts` + testes (TDD) e
   `server/tasks.ts` + classificação de erro com testes. Nada ligado ainda.
2. **Fase B — escopo OAuth:** `auth-store.ts`, `server.ts` (status + callback),
   `src/auth/google.ts`, chip e toast no `App.vue`. Verificar em dev: credencial
   atual (só Calendar) → `/api/auth/status` com `tasks: false`, e Mochila e
   agendamento funcionando igual.
3. **Fase C — lista e fluxo:** `squad.ts` (`tasksListaId`), `passos-no-google.ts`,
   ligação em `capabilities.ts` e `orchestrator.ts` (prompt), tipos, toast.
4. **Fase D — docs:** CLAUDE.md completo.

Verificação em dev contra a conta real (`npm run dev`). Exercite a rota com dados
reais, sem mock. Registre no checkpoint o que saiu de cada cenário:

| # | Cenário | Esperado |
|---|---|---|
| 1 | Credencial só com Calendar; demanda "prepara a apresentação de sexta, checklist: slides, dados, ensaio" | Eventos criados; aviso `ampliarAcesso`; **zero** requisições a `tasks.googleapis.com` (confira no log) |
| 2 | Clicar em "Autorizar Google Tasks", consentir os dois | `/api/auth/status` com `tasks: true`; nenhum logout; Mochila intacta |
| 3 | Repetir o cenário 1 | Lista `SquadOne · <squad>` criada; `tasksListaId` gravado em `data/squad.json`; mãe com `due` certo + 3 subtarefas **na ordem**; marco com `squadone_tasks_lista`/`_pai`; toast com "3 passos" |
| 4 | "foca 1h em revisar o contrato" | Sem `passos`, sem chamada ao Tasks |
| 5 | Dois turnos com passos em paralelo numa squad sem lista | Uma lista só (single-flight) |
| 6 | Apagar a lista no Google e rodar outro turno com passos | Lista nova, id sobrescrito no roster |
| 7 | Ajustar a duração de uma quest que tem passos (`POST /api/quests/:id/ajustar`) | 200; as chaves `squadone_tasks_*` continuam no evento |
| 8 | Consentimento com o Calendar desmarcado | Redirect `?auth=escopo_calendar_negado`; credencial anterior intacta |
| 9 | Evento às 22:30 (SP) com passos | `due` da mãe no mesmo dia local |

Depois, `npm run build` verde.

## Finalização

1. `superpowers:verification-before-completion`: rode typecheck, testes e build e
   cole a saída.
2. `superpowers:requesting-code-review` sobre o diff inteiro.
3. `git commit` (mensagens em português, estilo `feat(tasks): ...`, com a linha
   `Co-Authored-By` que o harness pedir) + `git push` em `main` + `graphify update .`.
4. Não clique em **Implantar** no Easypanel. O resumo final ao usuário deve dizer:
   - que o deploy é manual;
   - os passos 1–4 do Google Cloud;
   - o gesto "Autorizar Google Tasks" no app, **sem** logout;
   - os adiados: selo na Mochila, tarefa avulsa e renomear a lista.
