# Agenda e turno: marcas, modos, agendamento, Tasks e ajuste

> Movido do `CLAUDE.md` em 11/10/2026 para a sessão não carregar isto toda vez.
> O texto é o original, sem alteração; o `CLAUDE.md` guarda só o resumo das regras.

## Marcas no Calendar

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

## Toggle Auto / Foco / Baixa Prioridade

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

## Agendamento: o horário é do servidor

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

## Redirecionamento automático de squad

`sugerir_troca_squad` não espera clique. `executarTurno` roda o turno, vê a proposta, troca para a squad de destino e reprocessa a **mesma** demanda lá — uma 2ª chamada ao Gemini, só nesse caso — e devolve o resultado do 2º turno como se fosse o original, com `redirecionado: { de_id, de_nome, para_id, para_nome, justificativa }`. A aba adota `para_id` (localStorage) antes de reler a Mochila e só mostra um toast.

- **Um salto por turno.** Se a squad de destino também sugerir troca, o servidor para e devolve o resultado dela, proposta inclusa: o `TrocaSquadCard` (Trocar / Trocar e reenviar / Descartar) sobra só para esse empate. Sem o teto, duas squads apontando uma para a outra rodariam o Gemini até o timeout do proxy, e cada salto é pago.
- **O turno de origem não deixa rastro** porque não deixa efeito: `descartarPorTroca` já descarta todas as outras chamadas antes de executar, então nada nasceu no Google e a agenda nem foi lida. Os erros dele também não voltam.
- Invariante de custo mantida: no 2º prompt a squad ativa é a **destino**, inteira; a origem vira "outra squad" (id, nome, escopo). Mesmo `agora` e mesmo `modo` nos dois turnos — o toggle é sobre o tipo do compromisso, não sobre a squad.
- Destino inválido ou arquivado entre a proposta e o salto: sem 2º turno, o resultado da origem volta como antes.

## Dica de execução na criação

`agendar_evento` tem um campo `nota_de_execucao`: o modelo escreve a dica no **mesmo** turno em que decide data e duração, do ponto de vista do responsável e do treino dele ("Ao opinar sobre um compromisso" do escopo é a rubrica). Ela vira a descrição do evento no POST, **antes** da assinatura do SquadOne.

- **Texto puro.** Sem marcador de bloco e sem hash: é escrita única, na criação, e nada volta a reescrevê-la. O protocolo de proteção de edição manual que existia na Contribuição (removida em 13/09/2026) não se aplica aqui — editar a descrição no Google é seguro.
- **Teto `MAX_NOTA_DE_EXECUCAO` (600) em `server/agendamento.ts`**, com reticências: a dica é para ser lida de relance no card do Google, e o teto é o que impede uma resposta fora do esperado de virar um muro de texto na agenda.
- Só no evento principal. Os blocos de um prazo levam a assinatura sozinha: a dica é do compromisso, e repeti-la em cada bloco seria ruído.
- Campo omitido ou vazio = descrição só com a assinatura, como antes.

## Passos no Google Tasks

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

## Tarefa avulsa (`criar_tarefa`)

O que precisa ser feito mas não pede horário ("comprar leite", "pagar o boleto dia 30") vira item no Google Tasks, sem evento. Antes o único caminho para o Tasks era `passos` em `agendar_evento`, e todo lembrete virava um bloco de 60 min na agenda.

- **Regra no prompt:** `agendar_evento` só quando a demanda precisa de TEMPO reservado; lembrete, compra, pagamento, recado, "anotar" é `criar_tarefa`. Desempate: parar o que está fazendo por mais de 15 min = agenda. Checklist sem compromisso = `criar_tarefa` com `passos`.
- **Campos:** `titulo` e `responsavel_id` obrigatórios (pessoa validada antes de qualquer chamada, como no agendamento); `data` (`AAAA-MM-DD`) vira o `due` pela parte de data escrita — nunca convertida para UTC, mesmo motivo do `dueDaTarefa`; ilegível = tarefa sem data + aviso; `notas` com a assinatura `SquadOne · <pessoa> (<domínio>)` no fim; `passos` viram subtarefas (mesma normalização e teto). Tetos `MAX_TITULO_TAREFA` 300 e `MAX_NOTAS_TAREFA` 2000 em `server/passos.ts`.
- **Mesma lista da squad** dos passos (`garantirListaDaSquad`, single-flight). Nenhum PATCH em evento: não há evento.
- **Foco e Baixa Prioridade viram bloco.** Os dois modos são o usuário pedindo horário: o prompt proíbe `criar_tarefa` e, se o modelo chamar mesmo assim, o handler converte em `agendar_evento` `time_blocking` (duração padrão, `data` → `a_partir_de`, `notas` → `nota_de_execucao`). Por isso `criar_tarefa` entra na **série** de agendamento só nesses modos; em `auto` roda em paralelo.
- **Aqui a falha é erro, não aviso:** a tarefa é o resultado inteiro. Sem o escopo → `TasksNaoAutorizado`, erro com `motivo: ampliarAcesso` (`MotivoDeErro` ganhou o valor); a UI e o bot tratam igual ao aviso dos passos (toast/linha "Autorizar Google Tasks", nunca alert nem logout). 403 de escopo e 401 seguem `motivoDoErroTasks`. Subtarefa que falha depois da tarefa = aviso.
- **Resultado:** `TurnoResult.tarefas_criadas: TarefaCriada[]`; o toast (`resumoDosEventosCriados(eventos, fmt, tarefas)`) e o bot (linha `📋`) mostram título, dia e passos. É o único lugar do app que conta que a tarefa nasceu: a Mochila não lê o Tasks (invariante 3), a vigia não avisa, o alocador não a toca.

## Ajuste de tempo

O único fluxo que edita uma quest depois de criada. `POST /api/quests/:eventId/ajustar {alvo, proposto_min, permitirMover?}` só roda com aprovação (`AjusteCard`) e relê tudo do Google.

- **Duas origens, um contrato.** A proposta pode vir de um agente ou do botão "Ajustar" da agenda (`ListaDeQuests` → `propostaDoUsuario` em `src/contribuicao.ts` → o mesmo `AjusteCard`). `PropostaDeAjuste.origem` distingue: em `usuario` o card nasce com um campo de minutos e o `proposto_min` emitido é o do card, não o da proposta. O botão só aparece onde o servidor aceitaria (`alvoDeAjuste`: bloco com horário → `duracao`, marco → `esforco`; foco de dia inteiro não tem alvo), e `normalizarPropostoMin` põe o valor na grade de 15 e nos limites de `interpretarPedidoDeAjuste` (`LIMITES_DE_AJUSTE` em `src/types.ts` é o espelho) — a rota não mudou.
- **Alvos:** duração (foco/bloco) ou esforço total (marco, medido pelos blocos com `squadone_prazo_ref`). Duração muda só o fim; se não cabe, 409 `naoCabe` e mover é um segundo clique (`permitirMover`). Esforço cria blocos extras antes do prazo (com as 5 marcas) ou encurta blocos futuros até 30 min; bloco que mudou desde a listagem é pulado e vira `sobra_min`. Nada é apagado. 412 no ajuste não retenta.
- **PATCH:** todo PATCH de evento passa por `atualizarPreservandoMarcas`: `If-Match` com o etag lido, `sendUpdates=none`, `extendedProperties.private` **completo** (lido + o que muda). A resposta é conferida: marca `squadone_*` sumida → restaura uma vez → `marcasPerdidas` (500).
- **Token por chamada:** a rota checa `tokenValido()` antes e passa `obterToken`; cada leitura/PATCH/POST no Google pede o token de novo logo antes (`comToken`, o cache do auth-store absorve o custo). Um ajuste de esforço faz dezenas de escritas em série e um token lido só no começo venceria no meio. Google recusou a credencial: pede de novo e, vindo token diferente, repete uma vez; só com o mesmo token o 401 vira `precisaConectar`.
- **Teto de tempo do Gemini (turno e redação):** `gerarComRetry` dá 45 s (`TIMEOUT_GEMINI_MS`) a cada tentativa, por `abortSignal` + corrida contra um relógio. Timeout conta como transitório: retenta e cai no modelo reserva; esgotou, `ModeloOcupado`. Pior caso de uma geração: 2 modelos × 2 tentativas × 45 s + backoff ≈ **3 min**. Proxy com timeout menor que isso corta a resposta (a UI mostra erro de rede; nada fica gravado pela metade).
- **As chamadas ao Google Tasks também rodam em série**, dentro de `agendar_evento`, cada uma com `TIMEOUT_TASKS_MS` (10 s) — ver "Passos no Google Tasks". Um compromisso com passos soma cerca de `N + 4` chamadas ao Google (lista — 1: `lerLista` com id já gravado, ou `inserirLista` na primeira vez —, tarefa-mãe, N subtarefas, leitura + PATCH do vínculo), mais uma (`N + 5`) se a lista salva sumiu no Google, antes do próximo compromisso da série e da resposta HTTP: outro motivo para o proxy ter folga além do teto do Gemini acima.
- Erros de quest: 404 `questSumiu`, 409 com a flag (`eventoSemMarca`, `eventoDeOutraSquad`, `dominioInativo`, `conflitoDeEdicao`, `alvoIncompativel`, `naoCabe`, `semHorarioLivre`), 401 `precisaConectar`, 500 `configuracao`/`marcasPerdidas`, 502 o resto do Google.
- Nada disto grava fora do Google: a persistência continua só `squad.json` e `google-auth.json`.
