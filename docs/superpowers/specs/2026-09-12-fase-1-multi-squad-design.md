# SquadOne — Fase 1: contrato do evento no Calendar + roster v3 multi-squad

**Data:** 2026-09-12
**Status:** design aprovado para implementação
**Depende de:** Fase 0 (já em `main`: marca `squadone_tipo`, deadline `transparent`, toggle `modo` auto|foco|prazo em `/api/orquestrar` e `executarTurno`, sugestões com `id` gerado no servidor)
**Plano:** `docs/superpowers/plans/2026-09-12-fase-1-multi-squad.md`

---

## 1. Objetivo

Acrescentar um nível acima do domínio: a **squad** (Pessoal, Pay4Fun, Freela...). Cada squad é um contexto com escritório 3x3 próprio e seus domínios dentro. A árvore passa a ser:

```
roster (data/squad.json, version 3)
 └── squad                  ← contexto; um escritório 3x3
       └── domínio          ← um tema; uma sala
             ├── po
             └── integrantes
```

Junto, fechar o **contrato do evento** no Google Calendar (quais marcas todo evento criado pelo app carrega) e as **regras de id** que valem daqui para frente — antes de a Fase 2 multiplicar contratações e a Fase 4 multiplicar marcadores.

Entregas concretas:

1. `data/squad.json` no formato v3, com migração automática v1→v2→v3 e backup.
2. Todo evento novo carrega `squadone_squad`, `squadone_dominio`, `squadone_membro`, `squadone_tipo`.
3. Seletor de squad no header; gesto "Nova squad"; Mapa e Mochila mostram só a squad ativa.
4. `/api/orquestrar`, `/api/mochila` e `/api/squad/hire` operam dentro de uma squad; o prompt recebe só a squad ativa.
5. Capacidade `sugerir_troca_squad`: o modelo propõe trocar de squad, nunca troca.
6. `proximoSlot`/`unlockedSlots` derivados dos slots ocupados, não de `dominios.length`.

## 2. Não-objetivos

- Calendário secundário por squad, escopo OAuth novo, conta Google por squad. (`calendarId` e `conta` só ficam reservados no formato.)
- Arquivar/reativar domínio ou pessoa, demitir, editar pessoa, renomear/apagar squad. (`arquivado` e `idsAposentados` só ficam reservados; Fase 2.)
- Contratação rica com Gemini redigindo papel/escopo; escopo de ~1500 chars. (Fase 2. Na Fase 1 os limites atuais valem: escopo 200.)
- Checagem de conflito de horário (Fase 3, global).
- Backfill de `squadone_squad` em eventos já existentes no Google.
- Mochila unificada de todas as squads.
- Editar nome/escopo da squad `pessoal` criada pela migração.

## 3. Schema v3

### 3.1 Tipos (servidor, `server/squad.ts`)

```ts
export interface Pessoa {
  id: string;            // único GLOBALMENTE (todas as squads + aposentados)
  nome: string;
  papel: string;
  escopo: string;
  sprite: string;
  hue?: number;
  horario?: { inicio: string; fim: string };
  hiredAt: string;
  /** Reservado (Fase 2). Fase 1 nunca grava nem lê. */
  arquivado?: boolean;
}

export interface Dominio {
  id: string;            // valor de `squadone_dominio`; único GLOBALMENTE
  nome: string;
  escopo: string;
  slot: [number, number];
  room: string;
  criadoEm: string;
  po: Pessoa;
  integrantes: Pessoa[];
  /** Reservado (Fase 2). Fase 1 nunca grava nem lê. */
  arquivado?: boolean;
}

export interface Squad {
  id: string;            // slug, ≤40 chars, único entre squads; valor de `squadone_squad`
  nome: string;          // ≤40
  escopo: string;        // ≤200; vai para o prompt
  /** Onde os eventos desta squad são gravados. Fase 1: sempre "primary". */
  calendarId: string;
  /** Reservado: conta Google dona do calendário. Ausente = a conta conectada. */
  conta?: string;
  unlockOrder: [number, number][];
  dominios: Dominio[];   // ≥1; dominios[0].po é o PO raiz do escritório
}

export interface Roster {
  version: 3;
  squads: Squad[];       // ≥1; squads[0] é a squad padrão
  /**
   * Ids que já existiram e não podem ser reusados. GLOBAL, não por squad:
   * a unicidade de pessoa e de domínio é global, então a lista que a protege
   * também é. Dois namespaces separados porque pessoa e domínio podem ter o
   * MESMO id legado (o data/squad.json de produção tem domínio "po" e pessoa "po").
   * Fase 1: só lido na checagem de unicidade; ninguém escreve aqui ainda.
   */
  idsAposentados: { pessoas: string[]; dominios: string[] };
}
```

### 3.2 Vista enviada ao frontend

```ts
export type SquadView = Squad & { unlockedSlots: [number, number][] };
export type RosterView = Omit<Roster, "squads"> & { squads: SquadView[] };
```

`src/types.ts` espelha `Pessoa`, `Dominio`, `SquadView` e `RosterView` (substitui `SquadResponse`).

### 3.3 Slots

- `unlockedSlots(squad) = squad.dominios.map(d => d.slot)` — slots ocupados.
- `proximoSlot(squad)` = primeiro item de `squad.unlockOrder` cujo `"x,y"` não está entre os ocupados; `null` se nenhum.
- "Escritório cheio" = `proximoSlot(squad) === null`. `MAX_DOMINIOS = 9` continua exportado e só é usado em mensagens.
- Fase 1 conta domínios com `arquivado` como ocupados (não há arquivamento ainda). Fase 2 decide excluí-los.

### 3.4 Seed

`seed/squad.seed.json` passa a ser v3: o conteúdo atual vira `squads[0]` com `id: "pessoal"`, `nome: "Pessoal"`, `escopo` padrão (§4.3), `calendarId: "primary"`, e `idsAposentados` vazios. `SEED_PATHS` continua tentando `data/squad.seed.json`; se esse arquivo antigo for v2, a migração da leitura seguinte o converte.

## 4. Migração

### 4.1 Detecção (por forma, nunca por `version`)

| Forma do JSON | Versão detectada |
|---|---|
| `Array.isArray(bruto.squads)` | 3 |
| `Array.isArray(bruto.dominios)` | 2 |
| `Array.isArray(bruto.members)` | 1 |
| qualquer outra | `RosterIlegivel` (nada é gravado) |

A ordem da tabela é a ordem de teste.

### 4.2 Passo a passo (em `readRoster()`)

1. `ensureRoster()`: se `data/squad.json` não existe, grava o texto da seed (já v3) atomicamente. Uma seed antiga v2 em `data/squad.seed.json` é gravada como está e migrada nos passos seguintes.
2. Lê o texto cru de `data/squad.json` e faz `JSON.parse`. JSON inválido → `RosterIlegivel`.
3. Detecta a versão (§4.1). Se 3: valida a forma mínima (§4.5) e devolve. Fim.
4. Se 1 ou 2: **backup** — se `data/squad.v<N>.bak.json` não existe, grava o **texto cru** lido no passo 2 (bytes idênticos) via `.tmp` + rename. Se já existe, não sobrescreve.
5. Converte em memória: v1 → `migrarV1` (existente, inalterada) → v2 → `migrarV2` → v3.
6. Valida a forma mínima do resultado (§4.5).
7. `writeRoster(v3)` (atômico: `.tmp` + rename).
8. Devolve o v3.

`migrarV2` é pura e determinística (não lê relógio, não gera id aleatório):

```ts
{
  version: 3,
  idsAposentados: { pessoas: [], dominios: [] },
  squads: [{
    id: "pessoal",
    nome: "Pessoal",
    escopo: ESCOPO_PESSOAL_PADRAO,
    calendarId: "primary",
    unlockOrder: v2.unlockOrder,
    dominios: v2.dominios,      // mesma referência: ids, slots, pessoas INTACTOS
  }],
}
```

### 4.3 Constantes

- `ESCOPO_PESSOAL_PADRAO = "vida pessoal e tudo que não pertence a outra squad"`.
- `UNLOCK_ORDER_PADRAO = [[0,0],[1,0],[0,1],[1,1],[2,0],[2,1],[0,2],[1,2],[2,2]]` (igual à seed; usado por squads novas).

### 4.4 Idempotência, concorrência e falha no meio

- **Idempotência:** depois do passo 7 o arquivo tem `squads`; toda leitura seguinte cai no passo 3 e não grava nada. O backup nunca é sobrescrito.
- **Concorrência:** no boot, `/api/squad` e `/api/mochila` podem chegar juntos. Com o `.tmp` nomeado só por `pid`, duas escritas concorrentes no mesmo destino disputavam o mesmo `.tmp` e um `rename` falhava com ENOENT — isso vale também para `ensureRoster` num volume vazio, que a promessa de migração não cobre. Por isso o `.tmp` leva `pid` **e** um contador do processo (`squad.json.<pid>.<n>.tmp`): cada escrita tem o seu, e a última a renomear vence com conteúdo completo. *(Correção feita na implementação: o texto original atribuía o problema só à migração.)* A migração roda sob uma promessa de módulo (`migracao: Promise<Roster> | null`): a primeira leitura que detecta v1/v2 cria a promessa, as concorrentes aguardam a mesma, e ela é zerada ao terminar (sucesso ou erro) para que um erro não fique grudado. Dentro da promessa o arquivo é **relido** antes de migrar: uma leitura que viu v2 logo antes de outra migração terminar encontra v3 e só devolve. Cada chamador recebe um `structuredClone` do resultado, para que um mutador de `atualizarRoster` não altere o objeto de outro chamador.
- **Crash entre 4 e 7:** `squad.json` continua v1/v2, backup existe → a próxima leitura refaz 5–7 e pula o backup. Resultado idêntico.
- **Crash durante 7:** o `.tmp` fica pela metade, `squad.json` segue intacto (garantia atual do `writeRoster`).
- **Falha de validação (§4.5) ou forma desconhecida:** lança `RosterIlegivel` com a mensagem do problema, **não grava** `squad.json`. O backup do passo 4 pode existir; é cópia fiel, inofensiva.
- **A migração não chama o Google.** `server/squad.ts` não importa `calendar.ts` nem usa `fetch`.

### 4.5 Validação de forma mínima (v3)

`RosterIlegivel` se qualquer um falhar:

- `squads` é array com ≥1 item;
- cada squad tem `id` string não vazia, `dominios` array com ≥1 item, `unlockOrder` array;
- cada domínio tem `id` string, `slot` array de 2 números, `po` objeto com `id` string e `integrantes` array;
- `idsAposentados` ausente é tolerado na leitura e normalizado para `{ pessoas: [], dominios: [] }` em memória (não força escrita).

Não valida unicidade global na leitura: ela é garantida na escrita (§6).

### 4.6 Rollback

O código anterior à Fase 1 não lê v3 (trataria `squads` como v2 sem `dominios` e quebraria em 500). Reverter o deploy exige, no volume, copiar `data/squad.v2.bak.json` por cima de `data/squad.json` — o que perde squads e contratações feitas depois da migração. Registrado em Riscos (§10).

**A ordem importa.** Restaurar o backup com o código da Fase 1 ainda no ar não adianta: a leitura seguinte vê v2 e migra de novo (o backup antigo é mantido). Primeiro implantar o commit anterior à Fase 1, depois copiar o backup por cima no volume. Entre os dois passos o app responde 500 no roster.

## 5. Contrato do evento no Google Calendar

Todo evento criado por `agendar_evento` a partir da Fase 1 grava, em `extendedProperties.private`:

| Chave | Valor | Papel | Quem lê |
|---|---|---|---|
| `squadone_squad` | `Squad.id` (ex.: `pessoal`, `pay4fun`) | **informativa**; não filtra | `paraQuest` → `QuestCalendario.squad` (`""` quando ausente) |
| `squadone_dominio` | `Dominio.id` (ex.: `po`, `pay4fun--geral`) | **filtro** do `events.list` (`privateExtendedProperty`, match exato) | Mochila |
| `squadone_membro` | `Pessoa.id` | **atribuição** | Mochila |
| `squadone_tipo` | `time_blocking` \| `deadline` | **semântica** (Fase 0); fallback pelo prefixo do summary | Mochila |

Limites do Google: chave ≤44 caracteres, valor ≤1024, total de propriedades ≤32 kB por evento. Maior chave: `squadone_dominio` (16). Maior valor possível: id de domínio = 40 (squad) + 2 (`--`) + 60 (slug do nome) = 102. Todos bem dentro.

Regras:

- O filtro da Mochila **continua** por `squadone_dominio`, uma chamada por domínio da squad ativa. Por isso não há backfill: eventos antigos da squad `pessoal` já têm o `squadone_dominio` certo.
- O evento é gravado em `calendars/{encodeURIComponent(squad.calendarId)}/events` (hoje sempre `primary`). A Mochila lê do mesmo `calendarId`.
- Sem escopo OAuth novo: `calendar.events` já cobre o calendário principal.
- Uma constante por chave em `server/calendar.ts` (`PROP_SQUAD` novo, ao lado de `PROP_DOMINIO`, `PROP_MEMBRO`, `PROP_TIPO`), e uma função única, `marcasDoEvento({ squadId, dominioId, pessoaId, tipo })`, monta as quatro marcas (substitui `marcasDoMembro`). `urlDeEventos(calendarId)` monta a URL de escrita e de leitura.

## 6. Regras de id

| Id | Formato | Unicidade | Colisão |
|---|---|---|---|
| Squad | `slug(nome).slice(0, 40)` sem `-` nas pontas | entre squads | `ConflitoDeRoster` (409). Dois nomes que viram o mesmo slug são quase certamente engano. |
| Domínio **criado a partir da Fase 1** (em qualquer squad, inclusive `pessoal`) | `` `${squad.id}--${slug(nome).slice(0, 60)}` `` | global: todos os domínios de todas as squads + `idsAposentados.dominios` | `ConflitoDeRoster` (409), como hoje |
| Domínio legado (migrado) | inalterado (`po`, `geral`, ...) | — | — |
| Pessoa | `slug(nome)`, sufixo `-2`, `-3`... | global: todas as pessoas de todas as squads + `idsAposentados.pessoas` | sufixo numérico, como hoje |

Justificativas:

- **`--` como separador é à prova de colisão com legado:** `slug()` colapsa qualquer sequência de não-alfanuméricos num único `-`, então nenhum id legado nem nenhum slug de squad contém `--`.
- **Prefixo também nas novas da `pessoal`:** uma regra só, sem ramo "squad migrada vs nova"; não afeta eventos existentes porque só vale para domínios que ainda não existem.
- **Duplicata de domínio por nome dentro da squad:** além do id, `criar_po_dominio` e a contratação recusam um nome cujo `slug` já é o `slug(nome)` de um domínio da mesma squad (sem isso, `Financeiro` legado `financeiro` e `pessoal--financeiro` coexistiriam).
- **Nome automático** (`nomeEscolhido`) evita nomes já usados em **qualquer** squad.

Helpers em `squad.ts`: `idsEmUso(roster)` devolve `{ pessoas: Set<string>; dominios: Set<string>; squads: Set<string> }` já incluindo os aposentados; `novoIdDePessoa(roster, nome)`, `novoIdDeDominio(roster, squad, nome)`, `novoIdDeSquad(roster, nome)`.

## 7. API

### 7.1 Erros classificados (em `server/squad.ts`)

| Classe | Status | Corpo | Quando |
|---|---|---|---|
| `PedidoInvalido extends Error` | 400 | `{ error }` | forma do pedido: campo obrigatório vazio, `squadId` não-string |
| `ConflitoDeRoster extends Error` | 409 | `{ error }` | estado do roster não comporta: domínio/squad duplicado, escritório cheio (movida de `hire.ts`, que a reexporta) |
| `SquadInexistente extends ConflitoDeRoster` | 409 | `{ error, squadInexistente: true }` | `squadId` string que não existe |
| `RosterIlegivel extends Error` | 500 | `{ error }` | `squad.json` com forma desconhecida/corrompida |

**Por que `squadId` inexistente é 409 e não 400:** o pedido está bem formado; o que mudou foi o estado (a squad guardada no `localStorage` não existe neste volume). É a mesma leitura do `ConflitoDeRoster` atual ("a proposta não cabe mais no roster"). A flag `squadInexistente` diz ao frontend o gesto certo: recarregar o roster e cair na primeira squad.

Resolução de squad (`resolverSquad(roster, squadId: unknown): Squad`):

- `undefined`, `null` ou `""` → `roster.squads[0]`;
- string existente → aquela squad;
- string inexistente → `SquadInexistente`;
- qualquer outro tipo (número, array de query repetida...) → `PedidoInvalido`.

### 7.2 Rotas

| Rota | Entrada | Sucesso | Erros |
|---|---|---|---|
| `GET /api/squad` | — | 200 `RosterView` (todas as squads) | 500 |
| `POST /api/squad/nova` | `{ nome, escopo, papel_po, nome_po? }` | 201 `{ roster: RosterView, squad: SquadView }` | 400, 409, 500 |
| `POST /api/squad/hire` | `{ sugestao, nome? }` — squad = `sugestao.squad_id` (ausente = primeira) | 200 `{ kind, squadId, roster: RosterView, dominio, pessoa }` | 400, 409, 500 |
| `GET /api/mochila?squadId=` | query opcional | 200 `{ quests, erros }` da squad ativa | 400, 409 (antes de tocar o Google), 401, 502 |
| `POST /api/orquestrar` | `{ demanda, modo?, squadId? }` | 200 `TurnoResult` | 400, 409 (antes de chamar o Gemini), 503 `modeloOcupado`, 500 |

**`GET /api/squad` devolve todas as squads**, não só a ativa: o seletor precisa da lista inteira de qualquer jeito, o roster inteiro tem poucos KB, e a rota continua stateless (a squad ativa é conveniência da aba, não do servidor). Trocar de squad no seletor não custa request.

Ordem de validação em `/api/mochila` e `/api/orquestrar`: forma do body/query (400) → `readRoster` + `resolverSquad` (409/500) → só então token/Gemini. Assim um `squadId` velho se corrige sem gastar chamada externa.

`POST /api/squad/nova` (em `hire.ts`, função `criarSquad`), dentro de `atualizarRoster`:

- `nome` obrigatório, ≤40; `escopo` obrigatório, ≤200; `papel_po` obrigatório, ≤60; `nome_po` opcional, ≤40 (vazio = `nomeEscolhido` global).
- Cria a squad com `calendarId: "primary"`, `unlockOrder: UNLOCK_ORDER_PADRAO` e **um** domínio: `id` = `novoIdDeDominio(roster, squad, "Geral")` (= `<squad>--geral`), `nome: "Geral"`, `escopo` = escopo da squad, `slot: [0,0]`, `room: "ROOM_SOLO"`, `po` = pessoa nova (`papel` = `papel_po`, `escopo` = escopo da squad, `sprite: ""`).
- Anexa ao fim de `roster.squads`.

`POST /api/squad/hire` (`aplicarContratacao`): mesmas regras de hoje, mas dentro da squad resolvida por `sugestao.squad_id`, com id de domínio pela regra §6 e id de pessoa global. Aceita só `kind` `dominio` | `integrante` (qualquer outro, inclusive `troca_squad`, é 400).

### 7.3 Capacidades

`CapabilityContext` passa a ter `roster: Roster` e `squad: Squad` (a ativa), além de `token`, `agora`, `modo` e `demanda: string`.

`executarTurno(ai, pedido: PedidoDeTurno)` com `interface PedidoDeTurno { demanda: string; token: string | null; modo: Modo; roster: Roster; squad: Squad }`: a rota resolve roster e squad **antes** de pedir token e de chamar o Gemini, e o turno recebe tudo pronto (sem reler o arquivo).

- `agendar_evento`: `responsavel_id` precisa estar **na squad ativa** (erro lista os ids dela). Grava no `calendarId` da squad, com as quatro marcas (§5). Cor = índice do domínio **dentro da squad**.
- `criar_po_dominio`: checa duplicata por id prefixado (global) e por nome (squad); escritório cheio = `proximoSlot(ctx.squad) === null`. Proposta ganha `squad_id`.
- `contratar_integrante`: `dominio_id` precisa estar na squad ativa. Proposta ganha `squad_id`.
- **`sugerir_troca_squad`** (nova): args `{ squad_id: string, justificativa: string }`. Handler: `squad_id` precisa existir e ser diferente da ativa, senão `Error` (vira item de `erros` do turno). Devolve:

```ts
interface PropostaTrocaSquad {
  kind: "troca_squad";
  squad_id: string;        // squad em que o turno rodou (origem), como nas outras propostas
  destino_id: string;
  destino_nome: string;
  justificativa: string;
  demanda: string;         // texto original, para "Trocar e reenviar"
}
```

`Sugestao = PropostaDominio | PropostaIntegrante | PropostaTrocaSquad`; o `id` de card continua sendo acrescentado em `executarTurno` (Fase 0).

## 8. UI

### 8.1 Estado (`src/App.vue`)

- `roster: RosterView | null` substitui `squad`.
- `squadAtivaId: string | null`; `squadAtiva` = computed `roster.squads.find(id) ?? roster.squads[0]`.
- `localStorage` chave `squadone:squadAtiva`, lida e gravada com `try/catch` (módulo `src/squadAtiva.ts`). Ao carregar o roster, se o id guardado não existe, usa a primeira squad e sobrescreve o guardado.
- `trocarSquad(id)`: grava, zera `quests`, `currentAgent = 'Idle'`, recarrega a Mochila.
- A Mochila guarda o `squadId` do pedido e **descarta** a resposta se a squad ativa mudou no meio.
- Qualquer 409 com `squadInexistente: true` (Mochila, turno) → recarrega `/api/squad`, cai na primeira squad, avisa no toast.
- As sugestões **não** são limpas ao trocar de squad: cada uma carrega `squad_id` e é aprovada na squad de origem. O card mostra o nome da squad quando ela difere da ativa.

### 8.2 Header

- `SquadSelector.vue`: `<select>` com `nome` de cada squad (valor = `id`), emite `trocar(id)`; botão **+ Nova squad** emite `nova`.
- `NovaSquadModal.vue`: campos Nome (obrigatório), Escopo (textarea, obrigatório), Papel do PO (obrigatório, placeholder `PO Pay4Fun`), Nome do PO (opcional). Emite `criar(payload)` e `fechar`; recebe `enviando` e `erro`. App faz `POST /api/squad/nova`; sucesso → `roster = dados.roster`, `trocarSquad(dados.squad.id)`, fecha, toast; erro → mensagem no modal.

### 8.3 Mapa e Mochila

- `<GameMap :key="squadAtiva?.id" :squad="squadAtiva" ...>`: trocar de squad desmonta e recria o componente, então `useOffice` nasce com `knownRooms` vazio e `primeiraCarga = true` — as salas da outra squad não viram "crescimento".
- `GameMap` troca o tipo da prop de `SquadResponse` para `SquadView`; nada mais muda (o PO raiz segue `dominios[0].po`).
- `QuestBackpack` recebe `nomesDeDominio: Record<string, string>` (da squad ativa) e mostra o nome em vez do id quando existir.

### 8.4 Cards

- `GrowthCard` (dominio/integrante) inalterado, exceto o badge da squad quando `squad_id !== squadAtiva.id`.
- `TrocaSquadCard.vue` para `kind === 'troca_squad'`: título "Levar para a squad {destino_nome}?", justificativa, botões **Trocar**, **Trocar e reenviar**, ✕. Nenhum deles é automático: o modelo só propôs.
  - Trocar → `trocarSquad(destino_id)` e remove o card.
  - Trocar e reenviar → `trocarSquad(destino_id)`, remove o card e chama o mesmo fluxo da Command Bar com `{ demanda, modo: 'auto' }` na nova squad.

## 9. Prompt

`buildSystemInstruction` troca o primeiro parâmetro `arvore: string` por:

```ts
export interface ContextoDoPrompt {
  squadNome: string;
  squadEscopo: string;
  arvore: string;        // rosterTree(squadAtiva)
  outrasSquads: string;  // outrasSquads(roster, squadAtiva.id)
}
```

Os demais parâmetros (`agoraISO`, `modo`) ficam como a Fase 0 deixou.

Mudanças no texto:

- Abertura: `Você é o PO raiz da squad '${squadNome}' (escopo: ${squadEscopo}).` substitui o literal "de um squad pessoal".
- `Squad atual:` + árvore **só da squad ativa**.
- Seção nova, depois da árvore:

```
Outras squads do usuário (você NÃO vê os domínios nem as pessoas delas e NÃO agenda nelas):
${outrasSquads}
```

  `outrasSquads` = uma linha por squad, `- squad '<id>' — <nome> (escopo: <escopo>)`, ou `(nenhuma)`.
- Regra nova: `Se a demanda pertence claramente ao escopo de uma das OUTRAS squads listadas, chame APENAS sugerir_troca_squad com o squad_id dela e não agende nada nesta squad. Na dúvida, trate a demanda na squad atual. Se não há outras squads, nunca chame sugerir_troca_squad.`

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Migração corrompe o roster de produção | backup cru antes de gravar; escrita atômica; forma desconhecida não grava; roteiro de verificação com cópia do arquivo real (nunca o original) |
| Rollback do deploy quebra (código velho não lê v3) | documentado em §4.6 e no CLAUDE.md; restaurar `squad.v2.bak.json` perde o que foi criado depois |
| Duas leituras concorrentes no boot migram juntas | promessa única de migração (§4.4) |
| `squadId` guardado no browser não existe no volume | 409 `squadInexistente` + fallback para a primeira squad |
| Resposta atrasada da Mochila de outra squad sobrescreve a lista | descarte por `squadId` do pedido (§8.1) |
| Aprovar card de outra squad aplica na squad errada | proposta carrega `squad_id`; hire resolve por ele |
| Modelo agenda na squad ativa algo de outra squad | regra no prompt + `sugerir_troca_squad`; `responsavel_id` de outra squad é recusado |
| Dados de trabalho (Pay4Fun) no calendário pessoal e no Gemini | decisão do usuário; `conta` reservado para separar depois |
| `squadone_squad` ausente em eventos antigos | é informativa; filtro segue por domínio; `QuestCalendario.squad = ""` |
| Ids de domínio longos aparecem crus na Mochila | `nomesDeDominio` (§8.3) |

## 11. Critérios de aceite

Todos verificáveis sem Google e sem Gemini reais, em diretório temporário com cópia de `squad.json` (nunca `data/` do repo).

1. **v2 com ids de produção** (domínio `po`, pessoa `po`) → após `readRoster()`: `version === 3`, `squads.length === 1`, `squads[0].id === "pessoal"`, `calendarId === "primary"`, `squads[0].dominios` deep-equal ao `dominios` original, `unlockOrder` idem; `data/squad.v2.bak.json` com bytes idênticos ao arquivo original.
2. **v2 da seed antiga** (domínio `geral`) → idem, ids `geral` preservados.
3. **v1** (`members`) → v3 numa leitura; `data/squad.v1.bak.json` com bytes do original; cada membro vira domínio como hoje.
4. **Idempotência:** segunda `readRoster()` não altera o `mtime` de `squad.json` nem do backup.
5. **Forma desconhecida** (`{"foo":1}`) → `RosterIlegivel`; bytes de `squad.json` inalterados.
6. **Crash simulado:** backup já existe + `squad.json` ainda v2 → `readRoster()` migra e o backup permanece com os bytes originais.
7. **Concorrência:** 5 `readRoster()` simultâneos sobre v2 → todos resolvem iguais; o arquivo final é v3 válido; nenhum `.tmp` sobra.
8. **Volume vazio:** sem `data/` → `squad.json` v3 criado da seed. 5 leituras simultâneas no volume vazio → todas resolvem, nenhum `.tmp` sobra.
8a. **v3 já no disco** → devolvido sem gravar: bytes e `mtime` de `squad.json` inalterados, nenhum backup criado.
8b. **Falha no meio, depois do backup:** v2 cuja conversão não passa na validação (§4.5, ex. `dominios: []`) → `RosterIlegivel`; `squad.json` com bytes originais; backup existe com os mesmos bytes.
8c. **`.tmp` órfão** de um crash anterior ao lado de um v2 → a migração ignora o órfão e grava v3.
9. **Slots:** squad com domínios em `[0,0]` e `[0,1]` → `proximoSlot` = `[1,0]`; `unlockedSlots` = `[[0,0],[0,1]]`.
10. **Nova squad:** `criarSquad({nome:"Pay4Fun", escopo:"trabalho na Pay4Fun", papel_po:"PO Pay4Fun"})` → squad `pay4fun`, 1 domínio `pay4fun--geral` em `[0,0]`, PO com `papel` `PO Pay4Fun`; repetir → `ConflitoDeRoster`; `nome` vazio → `PedidoInvalido`.
11. **Id de pessoa global:** com pessoa `po` na `pessoal`, `criarSquad({..., nome_po:"PO"})` gera pessoa `po-2`; com `idsAposentados.pessoas = ["ana"]` e nenhuma "Ana" ativa, contratação sem nome gera `ana-2`.
12. **Hire por squad:** proposta `dominio` "Financeiro" com `squad_id:"pay4fun"` → domínio `pay4fun--financeiro` na squad `pay4fun`, slot `[1,0]`; na `pessoal` → `pessoal--financeiro`; `squad_id:"nao-existe"` → `SquadInexistente`.
13. **Evento:** `agendar_evento` com `fetch` mockado, squad `pay4fun` → URL termina em `/calendars/primary/events`; `extendedProperties.private` tem exatamente `squadone_squad=pay4fun`, `squadone_dominio=pay4fun--geral`, `squadone_membro=<id do PO>`, `squadone_tipo`; `responsavel_id` de pessoa da `pessoal` → erro.
14. **Troca:** `sugerir_troca_squad` com destino existente e diferente → `PropostaTrocaSquad`; destino = ativa ou inexistente → erro.
15. **Prompt:** fixture com `pessoal` (domínio `casa`, pessoa `romulo`) e `pay4fun` ativa → texto contém `Pay4Fun`, o escopo dela, `'pay4fun--geral'`, a linha `- squad 'pessoal'`; **não** contém `'casa'`, `'romulo'` nem o literal `squad pessoal`.
16. **HTTP** (build rodando de diretório temporário, sem `.env`): `GET /api/squad` → `version: 3` e `squads[*].unlockedSlots`; `GET /api/mochila?squadId=nao-existe` → 409 `squadInexistente`; `POST /api/orquestrar {demanda:"x", squadId:"nao-existe"}` → 409; `squadId: 7` → 400; `POST /api/squad/nova` válido → 201, repetido → 409, sem `nome` → 400; `POST /api/squad/hire` com `kind:"troca_squad"` → 400.
17. **UI:** seletor lista as squads; trocar muda o mapa e persiste após reload; "Nova squad" cria e troca para ela; id inexistente no `localStorage` cai na primeira squad sem erro.
18. `npx vue-tsc --noEmit` e `npm run build` passam; `server/squad.ts` não contém `fetch(` nem import de `calendar.ts`.
