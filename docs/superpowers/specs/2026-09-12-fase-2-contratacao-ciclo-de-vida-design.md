# SquadOne — Fase 2: contratação explícita e ciclo de vida dos agentes

**Data:** 2026-09-12
**Status:** design aprovado para implementação
**Depende de:** Fase 1 (`docs/superpowers/specs/2026-09-12-fase-1-multi-squad-design.md`): roster v3, `atualizarRoster`, `resolverSquad`, `paraVista`, `idsAposentados`, erros `PedidoInvalido`/`ConflitoDeRoster`/`SquadInexistente`/`RosterIlegivel`, `POST /api/squad/nova`, `sugerir_troca_squad`, `squad_id` nas propostas, seletor de squad.
**Ordem:** a Fase 3 (`docs/superpowers/specs/2026-09-12-fase-3-alocador-de-agenda-design.md`) é implementada **antes** desta. Ela reescreve `agendar_evento`, o turno e partes do prompt (`orchestrator.ts`, `capabilities.ts`) e mexe em `server.ts`, `App.vue`, `types.ts` e `QuestBackpack.vue`. Esta spec só depende deles em pontos localizados (bloco de crescimento do prompt, `sugerir_troca_squad`, rotas novas, badge do membro), descritos pela intenção.
**Plano:** `docs/superpowers/plans/2026-09-12-fase-2-contratacao-ciclo-de-vida.md`
**Referências `arquivo:linha`:** código anterior à Fase 1 (commit `594023c`), salvo indicação. A Fase 1 (`2ff5e1a..1b122e0`) reescreveu `squad.ts`, `hire.ts` e `server.ts`, e a Fase 3 muda o turno. O plano manda reler antes de cada task.

---

## 1. Objetivo

Hoje só o modelo inicia crescimento (cards de `criar_po_dominio`/`contratar_integrante`), e nada que entrou no roster sai ou muda: não há editar, demitir nem fechar sala (`server.ts:110` é a única escrita). O escopo de uma pessoa é truncado em 200 caracteres (`hire.ts:128,164`), curto demais para ser o "treino" do agente.

A Fase 2 entrega:

1. **Contratação pela UI.** Botão **+ Contratar** em cada sala e **+ Abrir sala** no próximo slot livre. Os cards do modelo continuam existindo.
2. **Treino redigido.** O usuário escreve uma frase. Uma chamada curta ao Gemini redige `papel` + `escopo`, com escopo de até 1500 caracteres num formato fixo de cinco linhas. O usuário edita e aprova. Se o Gemini falhar, ainda dá para contratar escrevendo tudo à mão.
3. **Editar.** O usuário pode mudar papel/escopo de pessoa, nome/escopo de domínio e nome/escopo de squad, inclusive o escopo da squad `pessoal`. Ids nunca mudam.
4. **Arquivar e reativar.** Vale para integrante, domínio e squad. O PO não é arquivado: é substituído.
5. **Prompt sem viés contra pedido explícito.** Pedido explícito de contratação sempre chama uma capacidade de crescimento.
6. **Mapa correto no ciclo de vida.** Sala arquivada fecha com animação. Slot reaberto anima a obra de novo, e nada fica preso em `knownRooms` (`useOffice.ts:422`).

## 2. Não-objetivos

- Alocação de horário, janela de agenda, `horario` por pessoa (Fase 3). O formulário **não** pede `horario`; o campo segue dado morto.
- Agentes opinando/contribuindo em quests (Fase 4). O **formato** do escopo já é pensado para ela (§5.3), mas nenhum agente lê escopo fora do prompt do orquestrador nesta fase.
- PO propondo contratação dentro do turno (A3, depois da Fase 4).
- Apagar de verdade qualquer coisa do roster. Mover pessoa entre domínios ou domínio entre squads.
- Renomear pessoa. Trocar sprite/hue pela UI.
- Tocar eventos no Google Calendar. Arquivar, reativar, editar ou substituir **não** faz nenhuma chamada ao Google.
- Roteamento de contratação por regex no servidor.
- Escopo novo do OAuth, banco, versão nova do arquivo (`version` continua 3).

## 3. Fluxos de UI

### 3.1 Onde ficam os gestos

`GameMap` segue com `pointer-events: none` e sem eventos. Os gestos ficam **fora do canvas**, num painel novo `SalasPainel.vue`, entre os cards de sugestão e o mapa. É mais simples que overlay isométrico, porque não precisa acompanhar câmera, escala nem projeção.

`SalasPainel` recebe a `SquadView` ativa e mostra:

- uma linha por **domínio ativo**, com o nome da sala, as pessoas (PO primeiro) e as ações:
  - **+ Contratar** (integrante);
  - **✎** no domínio;
  - **🗄** no domínio, desabilitado com `title` explicativo quando é `dominios[0]`;
  - por pessoa: **✎**, mais **🗄** se integrante ou **⇄ Substituir** se PO;
- **+ Abrir sala (x,y)** usando `proximoSlot` da vista. Sem slot: botão desabilitado "Escritório cheio";
- **Arquivo (n)**, com `n` = domínios arquivados + integrantes arquivados da squad + squads arquivadas.

`SquadSelector` (Fase 1) ganha **✎** (editar squad ativa) e **🗄** (arquivar squad ativa). O 🗄 fica desabilitado quando só há uma squad ativa.

Durante um turno (`isLoading`) ou uma operação de roster em curso, todos os botões ficam desabilitados.

### 3.2 Contratar (integrante, domínio, PO substituto)

Um só modal, `ContratarModal.vue`, com três alvos:

| Alvo | Aberto por | Campos |
|---|---|---|
| `integrante` | + Contratar da sala | Frase · Nome (opcional, ≤40) · Papel (≤60) · Escopo (≤1500) |
| `dominio` | + Abrir sala | Frase · Nome do domínio (≤60) · Escopo do domínio (≤200, uma linha) · Papel do PO (≤60) · Nome do PO (opcional) · Escopo do PO (≤1500) |
| `po` | ⇄ Substituir | Escolha: **Promover integrante** (select com os integrantes ativos) **ou** **Pessoa nova** (Frase · Nome · Papel · Escopo) |

Passos:

1. O usuário digita a frase (≤300), por exemplo "alguém para cuidar do meu imposto de renda e das notas da PJ".
2. **Redigir com Gemini** chama `POST /api/squad/redigir` (§4.2). Enquanto roda, o botão mostra "Redigindo..." e os campos seguem editáveis.
   - Sucesso: preenche os campos. Se algum campo já tinha texto, pede `confirm("Substituir o texto atual pelo redigido?")` antes. `truncado: true` mostra a nota "o texto veio maior que o limite e foi cortado".
   - Falha (qualquer status): mensagem inline acima dos campos. O texto depende da classificação: `modeloOcupado` → "Gemini ocupado, tente de novo ou escreva à mão"; `redacaoFalhou` → a mensagem do servidor + "escreva à mão". **Nada é bloqueado.**
3. O usuário edita. Um contador `n/1500` fica sob o escopo. `maxlength` nos campos iguala os limites do servidor.
4. **Contratar** só habilita com os obrigatórios preenchidos. Chama:
   - `integrante`/`dominio` → `POST /api/squad/hire` com proposta montada pela UI (§4.3);
   - `po` → `POST /api/squad/dominios/:dominioId/po` (§4.8).
5. Sucesso: `roster = resposta.roster`, fecha o modal, toast ("Ana entrou em Financeiro", "Carla abriu o domínio Saúde", "Bruno é o novo PO de Casa"), e o mapa anima (sala nova ou entrada pela porta). Erro: mensagem no modal e o modal fica aberto.

A frase **não** é salva. O que fica no roster é o papel e o escopo aprovados.

**Card do modelo.** `GrowthCard` mantém **Aprovar** (direto, como hoje) e ganha **Ajustar**. Ajustar abre `ContratarModal` pré-preenchido: `integrante` recebe `papel`/`escopo` da proposta; `dominio` recebe `dominio`/`escopo`/`papel_po`, e o escopo do PO começa igual ao escopo da proposta. A frase vem vazia. Contratar pelo modal remove o card.

### 3.3 Editar

`EditarModal.vue`, três alvos:

| Alvo | Campos | Extra |
|---|---|---|
| `pessoa` | Papel (≤60), Escopo (≤1500) | Frase + **Reescrever com Gemini** (`alvo: "pessoa"`), com a mesma regra de confirmação e falha de §3.2 |
| `dominio` | Nome (≤60), Escopo (≤200, uma linha) | — |
| `squad` | Nome (≤40), Escopo (≤200, uma linha) | — |

Salvar manda `PATCH` só com os campos que mudaram. Se nada mudou, o botão fica desabilitado. Sucesso: `roster = resposta.roster`, fecha, toast "Salvo". Não há confirmação: editar é reversível editando de novo.

O modal mostra a nota: *"Mudar o escopo muda para quem as próximas demandas vão. Eventos já criados não mudam."*

### 3.4 Arquivar

Todo arquivamento pede `window.confirm` com o efeito explícito:

- integrante: *"Arquivar {nome}? Sai do escritório e do prompt. Os eventos dele continuam no Google e na Mochila do domínio. Dá para reativar no Arquivo."*
- domínio: *"Arquivar a sala {nome} com {n} pessoa(s)? A sala fecha e libera o slot. Os eventos continuam no Google, mas saem da Mochila até você reativar."*
- squad: *"Arquivar a squad {nome}? Ela some do seletor e do prompt. Os eventos continuam no Google."*

Depois de confirmar, `POST .../arquivar`, e `roster = resposta.roster`. Em seguida:

- domínio → a Mochila recarrega;
- squad ativa → `trocarSquad(roster.squads[0].id)`;
- integrante → nada além do mapa.

Erro 409 vira toast com a mensagem do servidor.

### 3.5 Reativar

`ArquivoModal.vue` mostra três listas, cada item com **Reativar**:

1. **Domínios arquivados** da squad ativa: nome, nº de pessoas, data de arquivamento;
2. **Integrantes arquivados** da squad ativa cujo domínio está ativo: nome · papel · sala. Inclui o PO antigo de uma substituição;
3. **Squads arquivadas**: nome, escopo.

Cabeçalho: *"Arquivar não apaga nada. Os eventos continuam no Google; ao reativar, os de um domínio voltam para a Mochila."*

Reativar chama `POST .../reativar`. Sucesso: `roster = resposta.roster`, toast, e a Mochila recarrega se foi domínio. Squad reativada **não** troca a squad ativa. Erro (409 "sem sala livre" e afins): mensagem inline na linha, com o modal aberto.

## 4. API

Toda escrita passa por `atualizarRoster`. Todas as rotas deste capítulo passam antes pelo porteiro de IP e **não** chamam o Google. A única que chama o Gemini é `/redigir`, e ela não escreve no roster.

### 4.1 Erros

Reusa as classes da Fase 1 e acrescenta:

| Classe | Status | Corpo | Quando |
|---|---|---|---|
| `PedidoInvalido` | 400 | `{ error }` | corpo que não é objeto, campo não editável (inclusive `id`), campo não-string, obrigatório vazio, acima do limite (PATCH), `alvo` desconhecido, `integranteId` e pessoa nova juntos |
| `ConflitoDeRoster` | 409 | `{ error }` | id inexistente, arquivar PO, arquivar domínio raiz, arquivar última squad ativa, reativar sem sala livre, reativar dentro de pai arquivado, nome duplicado, domínio/pessoa não ativos onde se exige ativo |
| `SquadInexistente` | 409 | `{ error, squadInexistente: true }` | como na Fase 1 |
| **`SquadArquivada extends SquadInexistente`** (novo, `squad.ts`) | 409 | `{ error, squadInexistente: true }` | `squadId` de squad arquivada em `/api/orquestrar`, `/api/mochila`, `/api/squad/hire`, `/api/squad/redigir`. Mesma flag: o gesto da UI é o mesmo (recarregar roster e cair na primeira ativa). |
| **`RedacaoInvalida`** (novo, `redacao.ts`) | 502 | `{ error, redacaoFalhou: true }` | o Gemini respondeu sem a chamada esperada, com campo vazio, ou falhou por motivo não transitório |
| `ModeloOcupado` | 503 | `{ error, modeloOcupado: true }` | como no turno |

**Por que id inexistente é 409, não 404.** A convenção do projeto é "o pedido está bem formado e o estado do roster não o comporta". É a mesma leitura de `dominio_id` inexistente no hire (`hire.ts:152-157`) e de `SquadInexistente`. A causa típica é uma aba com roster velho, e o gesto certo é recarregar.

**Idempotência.** Arquivar algo já arquivado e reativar algo já ativo respondem 200 com o roster, sem mudança. Duplo clique não vira erro.

### 4.2 `POST /api/squad/redigir`

Corpo (união por `alvo`):

```ts
{ alvo: "integrante"; squadId?: string; dominioId: string; frase: string }
{ alvo: "po";         squadId?: string; dominioId: string; frase: string }
{ alvo: "pessoa";     pessoaId: string; frase: string }          // reescrever treino existente
{ alvo: "dominio";    squadId?: string; frase: string }
```

Validação, nesta ordem, **antes** de chamar o Gemini:

1. corpo objeto;
2. `frase` string com 1 a 300 caracteres depois de `textoDeUmaLinha` (400);
3. `alvo` válido (400);
4. `readRoster`;
5. resolução:
   - `integrante`/`po`: `resolverSquad(squadId)` (409 inexistente/arquivada) + `dominioId` string (400) + domínio **ativo** daquela squad (409);
   - `pessoa`: `pessoaId` string (400) + pessoa, domínio e squad **ativos** (409);
   - `dominio`: `resolverSquad(squadId)`.

Sucesso 200:

```ts
// alvo integrante | po | pessoa
{ alvo, papel: string /* ≤60 */, escopo: string /* ≤1500 */, truncado: boolean }
// alvo dominio
{ alvo: "dominio", nome: string /* ≤60 */, escopo_dominio: string /* ≤200 */,
  papel_po: string /* ≤60 */, escopo_po: string /* ≤1500 */, truncado: boolean }
```

`truncado` é `true` se qualquer campo passou do limite e foi cortado (§5.4). Erros: 400, 409, 502 `redacaoFalhou`, 503 `modeloOcupado`, 500. A rota **não escreve** no roster.

### 4.3 `POST /api/squad/hire` (estendida)

Mesmo contrato da Fase 1: `{ sugestao, nome? }`, e a squad vem de `sugestao.squad_id`. A UI monta a `sugestao` com a mesma forma das propostas do modelo. Mudanças:

| `kind` | Campo | Antes | Fase 2 |
|---|---|---|---|
| `integrante` | `escopo` | truncado em 200 | normalizado (§5.4) e truncado em **1500** |
| `integrante` | `justificativa` | não lido | continua não lido; opcional |
| `dominio` | `escopo` | domínio **e** PO, 200 | só **domínio**: `textoDeUmaLinha`, 200 |
| `dominio` | `escopo_po` | — | **novo, opcional**. Escopo do PO, normalizado, 1500. Ausente = igual a `escopo` (cards do modelo continuam funcionando) |

Regras novas:

- `dominio_id` precisa ser domínio **ativo**. Arquivado → 409 *"está arquivado; reative-o no Arquivo"*.
- Squad arquivada → `SquadArquivada`.
- A sala promove (`salaPara`) contando só integrantes **ativos**.
- Nome de domínio igual (por `slug`) ao de um domínio **arquivado** da mesma squad → 409: *"O domínio 'X' existe arquivado nesta squad: reative-o no Arquivo."*

Continua truncando em vez de 400: o texto dos cards vem do modelo e pode exceder. A UI respeita os limites antes de enviar.

### 4.4 `PATCH /api/squad/pessoas/:pessoaId`

Corpo: `{ papel?: string; escopo?: string }`, com pelo menos um. Qualquer outra chave → 400 (`id` → *"Ids nunca mudam"*). `papel`: `textoDeUmaLinha`, 1..60. `escopo`: `normalizarEscopo`, 1..1500. **Acima do limite → 400**, sem truncar: é texto que o usuário acabou de revisar. Vale para PO e integrante, ativo ou arquivado. Pessoa inexistente → 409. Resposta 200 `{ roster: RosterView }`.

### 4.5 `PATCH /api/squad/dominios/:dominioId`

Corpo: `{ nome?: string; escopo?: string }`. `nome` 1..60, uma linha. Se outro domínio da mesma squad (ativo ou arquivado) tem o mesmo `slug(nome)` → 409. `escopo` 1..200, uma linha. Domínio ativo ou arquivado. Resposta `{ roster }`.

### 4.6 `PATCH /api/squad/squads/:squadId`

Corpo: `{ nome?: string; escopo?: string }`. `nome` 1..40, uma linha. Se outra squad (ativa ou arquivada) tem `id === slug(nome)` ou `slug(nome_dela) === slug(nome)` → 409. `escopo` 1..200, uma linha. Vale para a `pessoal`. Resposta `{ roster }`.

### 4.7 Arquivar e reativar

| Rota | Regra (409 salvo indicação) | Efeito |
|---|---|---|
| `POST /api/squad/pessoas/:id/arquivar` | inexistente; **é PO** (*"PO não se arquiva: substitua-o"*) | `arquivado = true`, `arquivadoEm`; id em `idsAposentados.pessoas` |
| `POST /api/squad/pessoas/:id/reativar` | inexistente; é PO; **domínio ou squad arquivados** (*"reative o domínio/squad antes"*) | remove `arquivado`/`arquivadoEm`; sala promove por ativos |
| `POST /api/squad/dominios/:id/arquivar` | inexistente; **é `squad.dominios[0]`** | marca; `dominios` recebe o id do domínio, `pessoas` recebe os ids de PO + integrantes |
| `POST /api/squad/dominios/:id/reativar` | inexistente; **squad arquivada**; **sem sala livre** | slot = o antigo, se nenhum domínio ativo o ocupa; senão `proximoSlot`; `null` → 409 |
| `POST /api/squad/squads/:id/arquivar` | inexistente; **é a última squad ativa** | marca |
| `POST /api/squad/squads/:id/reativar` | inexistente | desmarca |

Todas respondem 200 `{ roster: RosterView }`.

### 4.8 `POST /api/squad/dominios/:dominioId/po` (substituir PO)

Corpo, exatamente uma forma:

```ts
{ integranteId: string }                              // promover integrante ativo do domínio
{ nome?: string; papel: string; escopo: string }      // pessoa nova
```

Chaves das duas formas juntas → 400. Pessoa nova: `papel` 1..60 e `escopo` 1..1500, com 400 acima do limite. `nome` ≤40; vazio = `nomeEscolhido`. Domínio inexistente, arquivado ou em squad arquivada → 409. `integranteId` que não é integrante **ativo** deste domínio → 409.

Efeito, dentro de `atualizarRoster`:

1. `anterior = dominio.po`;
2. o novo PO é o integrante removido de `integrantes` **ou** uma pessoa nova (`novoIdDePessoa` global, `sprite: ""`, `hiredAt` agora);
3. `anterior.arquivado = true`, `arquivadoEm`, e `anterior` entra no **fim** de `integrantes`. Continua na árvore: id reservado, reativável como integrante;
4. `dominio.po = novo`; `anterior.id` vai para `idsAposentados.pessoas`;
5. `dominio.room = salaPara(1 + integrantesAtivos.length, dominio.room)`.

Resposta 200 `{ roster: RosterView, po: Pessoa, anterior: Pessoa }`. Os eventos atribuídos ao PO antigo **continuam com o id dele** (`squadone_membro`). Nada é reatribuído no Google.

### 4.9 Rotas da Fase 1 afetadas

- `GET /api/squad`: devolve a `RosterView` nova (§6.3).
- `GET /api/mochila`, `POST /api/orquestrar`: `squadId` de squad arquivada → 409 `squadInexistente`; ausente → primeira squad **ativa**.
- `POST /api/squad/nova`: nome colidindo com squad arquivada → 409 *"A squad 'X' existe arquivada: reative-a."*

## 5. Prompts

### 5.1 Viés do orquestrador

A regra de crescimento de `buildSystemInstruction` (`orchestrator.ts:89-93` antes da Fase 1; depois das Fases 1 e 3, localizar pelo texto; a Fase 3 declara que não mexe neste bloco; reescrita na Fase 1 como "Se a squad atual dá conta, não chame nenhuma das duas") passa a ser:

```
- Crescimento tem dois níveis, e escolher o errado é erro:
  - criar_po_dominio quando o TEMA não pertence a nenhum domínio existente.
  - contratar_integrante quando o tema já tem domínio mas falta um PAPEL dentro
    dele; passe o dominio_id exato.
- Se o usuário PEDE EXPLICITAMENTE para contratar, trazer alguém, abrir um
  domínio ou uma sala (ex.: "contrate um designer", "preciso de alguém para
  finanças", "abra um domínio de Saúde"), SEMPRE chame criar_po_dominio ou
  contratar_integrante, mesmo que a squad atual pareça dar conta. Quem decide
  é o usuário, no card. Se a mesma demanda também pede compromissos, agende-os
  normalmente.
- Sem pedido explícito, só proponha crescimento quando nenhum domínio ou papel
  da squad atual cobre a demanda. Se a squad atual dá conta, não chame nenhuma
  das duas.
```

As `description` de `criar_po_dominio` e `contratar_integrante` ganham a frase *"Use também sempre que o usuário pedir explicitamente para contratar ou abrir domínio."*

Nenhum roteamento por regex no servidor. A garantia é o prompt, verificado por teste de texto.

### 5.2 Árvore com escopo longo

`rosterTree` passa a listar só o que é **ativo** e põe o escopo da pessoa como **bloco recuado** abaixo da linha dela. Com 1500 caracteres e várias linhas, o formato antigo `(papel: escopo)` quebraria a leitura da árvore.

```
- domínio 'pessoal--financeiro' — Financeiro (escopo: contas, impostos e investimentos)
    PO: 'fin' Fin (PO Financeiro)
      Missão: ...
      Cuida de: ...
    integrante: 'ana' Ana (Contadora PJ)
      Missão: ...
```

O escopo do domínio continua inline: é uma linha de até 200 caracteres.

### 5.3 Formato do escopo (pensado para a Fase 4)

Texto puro, cinco linhas rotuladas, nesta ordem:

```
Missão: <uma ou duas frases: para que este agente existe>
Cuida de: <itens concretos separados por "; ">
Não cuida de: <itens separados por "; " — principalmente o que é de outros papéis>
Ao opinar sobre um compromisso: <o que verifica num evento: prazo realista, preparação, dependências, riscos>
Sinais de alerta: <situações em que deve avisar o usuário>
```

Por quê:

- "Missão", "Cuida de" e "Não cuida de" servem ao orquestrador **agora**, para escolher `responsavel_id`. "Não cuida de" desempata papéis vizinhos no mesmo domínio.
- "Ao opinar sobre um compromisso" e "Sinais de alerta" são a rubrica que o agente da Fase 4 usa para contribuir numa quest. Sem isso, cada agente opinaria com o mesmo critério genérico.
- Texto puro, não JSON: vai literal para o prompt, o usuário edita num textarea e a Fase 4 lê do mesmo lugar.

O servidor **não** valida os rótulos. O formato é pedido ao Gemini e mostrado como placeholder no textarea, e o usuário pode escrever como quiser. Validar forçaria o usuário a um molde num texto que é dele.

### 5.4 Normalização e limites

- `textoDeUmaLinha(v) = v.replace(/\s+/g, " ").trim()`: nomes, papéis, escopos de domínio e squad, frase.
- `normalizarEscopo(v)`: CRLF → LF; remove caracteres de controle exceto `\n`; em cada linha colapsa espaços/tabs e faz `trim`; 3+ quebras viram 2; `trim` final. Serve para o escopo de pessoa.
- `limitar(texto, max)` (só na redação e no hire): se passa do máximo, corta na última `\n` antes de `max`, se ela estiver além de 60% de `max`; senão corta em `max`. Depois `trimEnd` e `truncado = true`.

| Campo | Limite |
|---|---|
| `Squad.nome` | 40 |
| `Squad.escopo` | 200 |
| `Dominio.nome` | 60 |
| `Dominio.escopo` | 200 |
| `Pessoa.nome` | 40 |
| `Pessoa.papel` | 60 |
| `Pessoa.escopo` | **1500** |
| frase de redação | 300 |

Exportados como `LIMITES` de `server/squad.ts` e espelhados em `src/types.ts`.

### 5.5 Prompt de redação

Arquivo novo `server/redacao.ts`. Uma chamada, `gerarComRetry` (exportado de `orchestrator.ts`, sem mudar comportamento), `model: MODEL`, `contents: frase`.

**Modo: function calling restrito** — `toolConfig.functionCallingConfig = { mode: ANY, allowedFunctionNames: [<uma declaração>] }`. Duas declarações:

- `redigir_pessoa { papel, escopo }` (alvos `integrante`, `po`, `pessoa`);
- `redigir_dominio { nome, escopo_dominio, papel_po, escopo_po }`.

**Por que não resposta estruturada (`responseMimeType` + `responseSchema`):**

1. `gerarComRetry` troca de `gemini-3.7-flash` para `gemini-3.5-flash` no meio da tentativa. Function calling é o mecanismo que os dois já servem em todo turno. `responseMimeType` foi medido como "campo minado na troca de modelo" (`orchestrator.ts:170-173`: no 3.5 as chamadas voltaram como texto).
2. A objeção do turno a `ANY` ("forçaria proposta espúria", `orchestrator.ts:166-167`) não vale aqui: a chamada **é** a resposta.
3. `allowedFunctionNames` com um único nome garante a forma sem parsear texto.

System instruction (montado por `promptDeRedacao`):

```
Você redige o TREINO de um agente do SquadOne. O treino é papel + escopo: vai
literal para o prompt do orquestrador, que escolhe quem recebe cada compromisso,
e numa fase seguinte para o próprio agente opinar sobre compromissos do
calendário. Escreva em português, concreto ao tema, sem inventar ferramentas,
pessoas ou fatos que o pedido não sugere.

Squad: '<squad.nome>' (escopo: <squad.escopo>)
```

Para `integrante` | `po` | `pessoa`, acrescenta:

```
Domínio: '<dominio.nome>' (escopo: <dominio.escopo>)
Pessoas ativas neste domínio:
- <papel> (<nome>)           ← uma linha por pessoa ativa, PO primeiro

Tarefa: a partir do pedido do usuário, redija <ALVO>. Chame redigir_pessoa uma
vez; não responda em texto.
- papel: 1 a 4 palavras, sem nome próprio, até 60 caracteres.
- escopo: até 1400 caracteres.
<FORMATO>
```

`<ALVO>`:

- integrante: "um INTEGRANTE novo deste domínio";
- po: "o NOVO PO deste domínio, que substitui o atual";
- pessoa: "o treino REESCRITO de <nome>, que hoje é:\n<papel>\n<escopo>".

Para `dominio`:

```
Domínios ativos desta squad (o novo não pode repetir o tema deles):
- <nome>: <escopo>

Tarefa: a partir do pedido do usuário, proponha um DOMÍNIO novo e o PO dono
dele. Chame redigir_dominio uma vez; não responda em texto.
- nome: 1 a 3 palavras, até 60 caracteres (ex.: "Financeiro").
- escopo_dominio: UMA frase de até 200 caracteres dizendo que demandas pertencem
  a este domínio.
- papel_po: até 60 caracteres (ex.: "PO Financeiro").
- escopo_po: até 1400 caracteres.
<FORMATO>
```

`<FORMATO>`:

```
O escopo tem EXATAMENTE cinco linhas, nesta ordem, cada uma começando pelo rótulo:
Missão: uma ou duas frases sobre para que este agente existe.
Cuida de: itens concretos separados por "; ".
Não cuida de: itens separados por "; " — principalmente o que é de outros papéis listados.
Ao opinar sobre um compromisso: o que este agente verifica num evento do calendário (prazo realista, preparação, dependências, riscos).
Sinais de alerta: situações em que deve avisar o usuário.
```

Pede-se 1400 para sobrar folga até o limite de 1500.

Pós-processamento:

- a `functionCall` com o nome esperado ausente → `RedacaoInvalida`;
- cada campo passa por `textoDeUmaLinha` ou `normalizarEscopo`, depois `limitar`;
- campo vazio → `RedacaoInvalida`;
- `ModeloOcupado` sobe como está;
- qualquer outro erro do SDK → `RedacaoInvalida` com os 300 primeiros caracteres da mensagem.

## 6. Schema (sobre o v3)

Sem `version` nova, sem migração: só campos opcionais.

### 6.1 Tipos (`server/squad.ts`)

```ts
interface Pessoa  { /* v3 */ arquivado?: boolean; arquivadoEm?: string }   // reservados na Fase 1, agora usados
interface Dominio { /* v3 */ arquivado?: boolean; arquivadoEm?: string }
interface Squad   { /* v3 */ arquivado?: boolean; arquivadoEm?: string }   // NOVO na Squad
```

- Ativo é `arquivado !== true`. Reativar **apaga** as duas chaves (JSON limpo).
- **Pessoa ativa** exige pessoa, domínio e squad ativos. **Domínio ativo** exige domínio e squad ativos.
- Nada é removido dos arrays. Um integrante arquivado continua em `integrantes`, e um domínio arquivado continua em `dominios` com o `slot` antigo gravado, que pode estar ocupado por outro.
- `Pessoa.escopo` aceita até 1500 em escritas novas. Registros antigos (≤200) seguem válidos.

### 6.2 `idsAposentados`

Passa a ser **escrito**, em modo só-acréscimo e sem duplicata, por arquivar pessoa, arquivar domínio e substituir PO (§4.7, §4.8). Reativar **não** remove: o id volta a ser usado pelo próprio dono e continua proibido para ids **novos**. Hoje isso já é garantido porque o arquivado nunca sai da árvore (`idsEmUso` percorre tudo). A lista mantém a garantia se um dia uma poda remover subárvores arquivadas. Squads não entram: `idsAposentados` não tem namespace de squad, e squads arquivadas continuam em `roster.squads`, onde `novoIdDeSquad` já as vê.

### 6.3 Vista (`paraVista`)

```ts
export interface IntegranteArquivadoView { pessoa: Pessoa; dominioId: string; dominioNome: string }

export type SquadView = Omit<Squad, "dominios"> & {
  dominios: Dominio[];                       // SÓ ativos, cada um com integrantes SÓ ativos
  unlockedSlots: [number, number][];         // slots dos domínios ativos
  proximoSlot: [number, number] | null;
  arquivo: {
    dominios: Dominio[];                     // arquivados, com todas as pessoas
    integrantes: IntegranteArquivadoView[];  // arquivados de domínios ATIVOS
  };
};

export type RosterView = Omit<Roster, "squads"> & {
  squads: SquadView[];            // SÓ ativas, na ordem do arquivo
  squadsArquivadas: SquadView[];
};
```

A filtragem mora no servidor por um motivo: `GameMap`, `SquadSelector`, `nomesDeDominio` e o `:key` da Fase 1 continuam lendo `squad.dominios` e `roster.squads` sem saber que arquivamento existe. Filtrar no frontend exigiria lembrar do filtro em cada consumidor. Como `dominios[0]` nunca é arquivado (§7), `vista.dominios[0]` é sempre o PO raiz.

### 6.4 Helpers de `server/squad.ts`

| Helper | Considera | Uso |
|---|---|---|
| `ativo(x)`, `squadsAtivas(r)`, `dominiosAtivos(s)`, `integrantesAtivos(d)`, `pessoasAtivas(s)` | só ativos | novos |
| `acharDominio(s, id)`, `acharPessoa(s, id)`, `idsDePessoas(s)`, `dominiosDoSquad(s)`, `rosterTree(s)`, `unlockedSlots(s)`, `proximoSlot(s)`, `outrasSquads(r, id)` | **passam a** considerar só ativos | turno, hire, Mochila, prompt |
| `resolverSquad(r, id)` | ausente → primeira **ativa**; arquivada → `SquadArquivada` | rotas |
| `pessoas(s)`, `todasAsPessoas(r)`, `idsEmUso(r)`, `novoIdDePessoa`, `novoIdDeDominio`, `novoIdDeSquad` | **tudo**, arquivado incluso | unicidade de id e nome |
| `localizarSquad(r, id)`, `localizarDominio(r, id)`, `localizarPessoa(r, id)` | tudo; devolvem squad/domínio/pessoa e `posicao: "po" \| "integrante"` | ciclo de vida |
| `aposentarIds(r, { pessoas?, dominios? })` | — | só-acréscimo |
| `LIMITES`, `textoDeUmaLinha`, `normalizarEscopo`, `limitar` | — | validação |

`agendar_evento` continua usando `ctx.squad.dominios.indexOf(dominio)` sobre o array **cru** para a cor. Assim a cor de um domínio não muda quando outro é arquivado.

`sugerir_troca_squad` só aceita destino **ativo**.

## 7. Regras de arquivamento

1. **Quem pode ser arquivado:** integrante, domínio, squad. **PO nunca**: é substituído (§4.8), e o anterior vira integrante arquivado.
2. **Domínio raiz:** `squad.dominios[0]` (posição no array cru) **nunca** é arquivado. Consequências: toda squad tem ≥1 domínio ativo; `vista.dominios[0]` é sempre o domínio raiz; `GameMap.vue:115,137` não muda. Para trocar quem circula pelo escritório, substitua o PO do domínio raiz.
3. **Última squad:** não se arquiva uma squad se ela é a única ativa. Squad arquivada nunca é resolvida por rota de turno, Mochila, hire ou redação.
4. **Pai arquivado:** reativar pessoa exige domínio e squad ativos. Reativar domínio exige squad ativa. Arquivar squad **não** marca domínios nem pessoas: ao reativar a squad, tudo volta como estava.
5. **Slot:** domínio arquivado libera o slot na hora (`proximoSlot` só vê ativos). Reativar tenta o slot antigo e, se estiver ocupado, usa `proximoSlot`. Sem slot, 409 *"A squad 'X' não tem sala livre: arquive outro domínio antes de reativar 'Y'."*
6. **Sala (template):** arquivar integrante **não** rebaixa a sala (`salaPara` só promove). Contratar e reativar promovem contando só ativos.
7. **Ids:** nunca mudam nem são reusados (§6.2).
8. **Prompt:** arquivado (em qualquer nível) não aparece em `rosterTree` nem em `outrasSquads`, e `responsavel_id`/`dominio_id`/`squad_id` arquivados são recusados pelos handlers como inexistentes.
9. **Propostas pendentes** (cards) que citam domínio agora arquivado → hire 409, mensagem no card.
10. **Google Calendar:** nada é alterado. Eventos ficam onde estão, com as marcas originais.
11. **Mochila — decisão:**
    - **Domínio arquivado some da Mochila.** A Mochila faz um `events.list` por domínio **ativo** (`dominiosDoSquad`). Ela é a vista do escritório ativo; mostrar quests de uma sala que não existe no mapa confunde; não gasta chamada ao Google por sala fechada; e reativar traz tudo de volta, porque os eventos nunca saíram do Google.
    - **Integrante arquivado não some.** As quests dele pertencem a um domínio ativo (o filtro é por domínio) e o trabalho continua lá. Escondê-las exigiria filtro por membro e esconderia compromisso real. O badge mostra "Nome (arquivado)".

## 8. Mapa (`useOffice` / `GameMap`)

Problemas atuais:

- `knownRooms` é um `Set` que nunca esquece (`useOffice.ts:179,422`). Uma sala que sai e volta no mesmo slot nasce sem obra.
- Não existe animação de saída.
- Um ator parado num slot que deixou de existir não acha rota: `bfsSlots` exige origem desbloqueada (`path.ts`).

Mudanças:

1. `RoomPhase = 'pending' | 'building' | 'closing' | null`.
2. `knownRooms: Map<slotKey, OfficeDominio>` guarda a última forma de cada sala, com o dono (`id`). Um slot que troca de dono conta como entrada nova. `fechando: shallowRef<OfficeDominio[]>` são as salas saindo.
3. A decisão sai de uma função pura, `planejarSalas(conhecidas, atuais) → { fechar, trocadas, abrir }`, em `src/office/salas.ts` e testável com tsx. `useOffice` só aplica fases, timers e câmera.
4. `geracao: Map<slotKey, number>`: todo timer de obra ou fechamento guarda a geração do slot e não faz nada se ela mudou. Assim, arquivar durante a obra ou reabrir durante o fechamento não deixa fase presa.
5. `registrarSalas`:
   - **Fechar** (depois da primeira carga): apaga de `knownRooms`/`roomPhase`, incrementa a geração, `lookPoint = null`, empurra a sala para `fechando` e agenda a remoção em `ROOM_BUILD_MS`.
   - **Trocadas** (mesmo slot, dono novo): apaga de `knownRooms`/`roomPhase`, sem fechamento; a entrada anima a nova.
   - **Abrir**: como hoje, mais: remove de `fechando` qualquer sala do mesmo slot (duas salas com o mesmo `key` colidiriam no `v-for`), incrementa a geração e protege os dois timers com ela.
   - Salas que ficaram atualizam a forma guardada (nome e template).
6. `rooms` e `mapTiles` consideram `dominios` + `fechando`. A sala fechando recebe `phase: 'closing'`, e as portas continuam derivadas só das salas ativas.
7. `syncActors`:
   - ator cujo `slot` não está mais desbloqueado → volta direto para a cadeira no domínio atual (`route = []`, `walking = false`);
   - ator parado e visível na própria sala → **reassenta** na cadeira do índice atual. Substituição de PO e promoção de template mudam a ordem das cadeiras;
   - ator de pessoa que saiu (integrante arquivado, domínio arquivado, PO substituído) → removido como hoje, sem animação própria. A sala fechando cobre o caso do domínio.
8. `GameMap.faseClasse` ganha `'room--closing'`. `index.css` ganha `.floor.room--closing, .base.room--closing { animation: room-build 450ms steps(6, end) reverse both; }` e `.room-objects.room--closing { animation: room-build-objects 450ms steps(6, end) reverse both; }`.
9. Trocar de squad continua recriando o componente (`:key` da Fase 1). Nada aqui roda entre squads.

**Ilhas.** Arquivar o domínio do meio pode deixar uma sala sem vizinho desbloqueado. `moveTo` do PO raiz para ela devolve `false` e ele fica onde está, sem erro. Quem entra numa ilha entra pela porta sul (fallback existente de `rotaDeEntrada`). O próximo domínio criado ou reativado ocupa o primeiro buraco de `unlockOrder` e costuma religar a ilha. Aceito (§9).

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Fase 1 diverge do que esta spec assume | plano manda reler o código antes de cada task e começa com checagem de pré-requisito que para se a Fase 1 não aterrissou |
| Prompt do turno cresce: escopo de 1500 × pessoas ativas | só ativos entram; 9 salas × ~3 pessoas ≈ 40 kB no pior caso, dentro do contexto do flash; aceito para a V1 e registrado para a Fase 4 |
| Gemini redige coisa inventada | usuário revisa sempre, nada é salvo sem clique; prompt proíbe inventar fatos |
| Gemini fora do ar impede contratar | redação é opcional; campos sempre editáveis; hire não chama o Gemini |
| Resposta estruturada inconsistente entre modelos | function calling restrito (§5.5), o mesmo mecanismo do turno |
| Rollback para a Fase 1 mostra arquivados como ativos (código antigo ignora `arquivado`) | registrado no CLAUDE.md; o formato não muda de versão, então o rollback não quebra a leitura, só "desarquiva" visualmente |
| Usuário acha que eventos de domínio arquivado foram apagados | textos de confirmação e do Arquivo dizem que continuam no Google e voltam ao reativar |
| Nome novo colide com arquivado e o 409 parece bug | mensagem manda reativar |
| Ilha no mapa depois de arquivar | §8 "Ilhas"; sem exceção, PO só não caminha até lá |
| Timers de animação atropelam sala nova no mesmo slot | `geracao` por slot (§8.4) |
| Duas abas: uma arquiva, outra aprova card daquele domínio | hire revalida contra o roster atual → 409 no card |
| Operações concorrentes perdem escrita | todas dentro de `atualizarRoster` (fila única) |
| Fase 3 (implementada antes) muda `orchestrator.ts`, `capabilities.ts`, `server.ts`, `App.vue`, `types.ts` | a Fase 2 só exporta `gerarComRetry`, troca o bloco de crescimento, filtra `sugerir_troca_squad`, acrescenta rotas e um badge; o plano descreve esses pontos pela intenção e manda reler o código pós-Fase 3 antes de cada task |
| PATCH de escopo muda roteamento de demandas futuras de forma inesperada | nota no modal de edição (§3.3) |

## 10. Critérios de aceite

Todos verificáveis sem Google e sem Gemini reais, em diretório temporário com cópia do `squad.json` (nunca o `data/` do repo). "Fixture F2" = v3 com squads `pessoal` e `pay4fun` (ver plano, `harness.ts`).

1. **Helpers ativos:** com `ana` (integrante) e o domínio `pessoal--financeiro` arquivados, na squad `pessoal`:
   - `idsDePessoas` não contém `ana` nem `fin`;
   - `acharDominio(s, "pessoal--financeiro")` é `null`;
   - `dominiosDoSquad` não contém o domínio;
   - `proximoSlot` devolve o slot que era dele;
   - `rosterTree` não contém `'ana'` nem `'pessoal--financeiro'`;
   - `idsEmUso.pessoas` contém `ana` e `fin`.
2. **Vista:** a `paraVista` dessa fixture tem:
   - `squads[0].dominios` sem o domínio arquivado e sem `ana`;
   - `squads[0].arquivo.dominios[0].id === "pessoal--financeiro"`;
   - `squads[0].arquivo.integrantes[0].pessoa.id === "ana"`;
   - com `pay4fun` arquivada: `squads.length === 1` e `squadsArquivadas[0].id === "pay4fun"`.
3. **Resolver:** `pay4fun` arquivada → `resolverSquad(r, "pay4fun")` lança `SquadArquivada` (que é `instanceof SquadInexistente`); `resolverSquad(r, undefined)` com `pessoal` arquivada devolve `pay4fun`.
4. **Árvore:** pessoa com escopo de 3 linhas → cada linha aparece na árvore prefixada por 6 espaços; a linha da pessoa é `    integrante: '<id>' <nome> (<papel>)`.
5. **Editar:**
   - `PATCH pessoa {papel, escopo de 1500}` grava os dois; escopo de 1501 → `PedidoInvalido`; `{id:"x"}` → `PedidoInvalido`; `{}` → `PedidoInvalido`;
   - `PATCH dominio {nome:"Casa"}` num outro domínio da mesma squad → `ConflitoDeRoster`;
   - `PATCH squad pessoal {escopo}` grava;
   - `PATCH squad pay4fun {nome:"Pessoal"}` → `ConflitoDeRoster`;
   - nenhum `id` muda (deep-compare dos ids antes e depois).
6. **Arquivar integrante:** `ana` fica com `arquivado: true` e `arquivadoEm` ISO; `idsAposentados.pessoas` contém `ana` uma vez só, mesmo depois de arquivar duas vezes (a segunda devolve sem erro); arquivar o PO `romulo` → `ConflitoDeRoster`.
7. **Arquivar domínio:**
   - `pessoal--financeiro` → `idsAposentados.dominios` contém o id e `pessoas` contém o PO dele;
   - `casa` (`dominios[0]`) → `ConflitoDeRoster`;
   - reativar `ana` com `casa` ativo → ok;
   - reativar integrante de domínio arquivado → `ConflitoDeRoster`.
8. **Reativar domínio:**
   - arquivado em `[1,0]` → contratar domínio novo (ocupa `[1,0]`) → reativar → slot `[0,1]`;
   - com a squad cheia → `ConflitoDeRoster`;
   - sem ninguém no slot antigo → volta para o slot antigo;
   - squad arquivada → `ConflitoDeRoster`.
9. **Squad:** arquivar `pay4fun` ok; arquivar `pessoal` em seguida → `ConflitoDeRoster` (última ativa); reativar `pay4fun` ok.
10. **Substituir PO:**
    - pessoa nova em `casa` → `po.id` novo, `anterior.id === "romulo"`, `romulo` no fim de `integrantes` com `arquivado`, `idsAposentados.pessoas` contém `romulo`;
    - promover `ana` → `ana` é PO, sai de `integrantes`, `romulo` arquivado;
    - `integranteId` de pessoa de outro domínio → `ConflitoDeRoster`;
    - corpo com `integranteId` + `papel` → `PedidoInvalido`.
11. **Hire estendido:**
    - `integrante` com escopo de 2000 → gravado com 1500;
    - `dominio` com `escopo` de 3 linhas e `escopo_po` longo → escopo do domínio em uma linha ≤200, escopo do PO ≤1500;
    - `dominio` sem `escopo_po` → PO com o escopo do domínio;
    - `dominio_id` arquivado → `ConflitoDeRoster`;
    - nome igual a domínio arquivado → `ConflitoDeRoster` com "reative";
    - `squad_id` arquivada → `SquadArquivada`.
12. **Concorrência:** `Promise.all` de arquivar `ana` + editar papel do `romulo` + editar escopo da `pessoal` → as três mudanças estão no arquivo final.
13. **Redação (Gemini mockado):**
    - `generateContent` recebe `toolConfig.functionCallingConfig.mode === "ANY"` e `allowedFunctionNames` igual a `["redigir_pessoa"]` (ou `["redigir_dominio"]`);
    - `contents` igual à frase;
    - `systemInstruction` contém o nome da squad, do domínio, as cinco etiquetas do formato e o papel das pessoas ativas;
    - não contém pessoa arquivada;
    - retorno com escopo de 1700 → `escopo.length <= 1500` e `truncado: true`;
    - sem `functionCalls` → `RedacaoInvalida`;
    - erro `503 UNAVAILABLE` sempre → `ModeloOcupado`;
    - erro `400 INVALID_ARGUMENT` → `RedacaoInvalida`.
14. **Pedido de redação:**
    - sem frase → `PedidoInvalido`;
    - frase de 301 → `PedidoInvalido`;
    - `alvo:"x"` → `PedidoInvalido`;
    - `dominioId` arquivado → `ConflitoDeRoster`;
    - `squadId` arquivada → `SquadArquivada`;
    - `pessoaId` arquivada → `ConflitoDeRoster`.
15. **Prompt do turno:** o texto contém "PEDE EXPLICITAMENTE" e "SEMPRE chame criar_po_dominio ou contratar_integrante"; não contém ids de pessoa/domínio arquivados; `sugerir_troca_squad` com destino arquivado → erro.
16. **HTTP** (build rodando de diretório temporário, `GEMINI_API_KEY=fake`, sem `.env`):
    - `GET /api/squad` → `squadsArquivadas` presente e `squads[*].proximoSlot` presente;
    - `PATCH /api/squad/pessoas/romulo {papel:"PO Geral"}` → 200; `{id:"x"}` → 400; `PATCH /api/squad/pessoas/nao-existe` → 409;
    - `POST /api/squad/pessoas/romulo/arquivar` → 409;
    - `POST /api/squad/pessoas/ana/arquivar` → 200, duas vezes;
    - `POST /api/squad/dominios/casa/arquivar` → 409;
    - `POST /api/squad/dominios/pessoal--financeiro/arquivar` → 200 e `GET /api/squad` não o lista em `dominios`;
    - `POST /api/squad/squads/pay4fun/arquivar` → 200; `GET /api/mochila?squadId=pay4fun` → 409 `squadInexistente`; `POST /api/orquestrar {demanda:"x", squadId:"pay4fun"}` → 409;
    - `POST /api/squad/redigir {alvo:"integrante", dominioId:"casa"}` (sem frase) → 400; `{alvo:"dominio", squadId:"pay4fun", frase:"x"}` → 409;
    - `POST /api/squad/dominios/casa/po {nome:"Bruno", papel:"PO", escopo:"Missão: x"}` → 200 com `anterior.id === "romulo"`;
    - nenhuma rota de redação com pedido válido é chamada;
    - `data/` do temporário não ganha `google-auth.json`.
17. **Mapa:**
    - `planejarSalas` (tsx): arquivar → `fechar`; slot reaberto → `abrir`; mesmo slot com dono novo → `trocadas` + `abrir`; mesmo roster com objetos novos → nada;
    - no navegador, com servidor temporário: arquivar domínio pelo 🗄 → `.room--closing` aparece e some em ≤1 s, e não sobra `.room--pending`/`.room--new`;
    - reabrir o slot → `.room--new` aparece;
    - console sem erro;
    - substituir PO do domínio raiz → o novo PO aparece e nenhum ator fica com `visibility:hidden` depois de 2 s.
18. **UI (navegador, sem Gemini real: `fetch` de `/api/squad/redigir` interceptado na página):**
    - + Contratar abre o modal; Contratar com papel/escopo escritos à mão cria o integrante e ele entra no mapa;
    - Redigir com resposta interceptada 503 `modeloOcupado` mostra erro inline e os campos seguem editáveis; resposta interceptada 200 preenche os campos e avisa `truncado`;
    - ✎ em pessoa salva o escopo;
    - 🗄 em integrante pede confirmação e remove do mapa;
    - Arquivo lista o integrante e Reativar o traz de volta;
    - 🗄 do domínio raiz está desabilitado;
    - 🗄 da squad está desabilitado com uma squad só.
19. `npx vue-tsc --noEmit` e `npm run build` passam; `server/ciclo-de-vida.ts` e `server/redacao.ts` não contêm `fetch(` nem import de `calendar.ts`; `git diff` da fase não toca `server/auth-store.ts`.
