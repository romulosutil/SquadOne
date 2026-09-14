# Passos no Google Tasks — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o modelo manda `passos` num `agendar_evento`, o servidor cria uma tarefa-mãe com subtarefas no Google Tasks (uma lista por squad), ligada ao evento principal no Calendar, sem que falha do Tasks afete o compromisso.

**Architecture:** Módulo puro `server/passos.ts` (normalização, `due`, títulos, escopo), transporte `server/tasks.ts` (espelho de `calendar.ts`), fluxo com I/O `server/passos-no-google.ts` (lista single-flight + tarefas + PATCH do vínculo) chamado só pelo handler de `agendar_evento` em `server/capabilities.ts`, depois de `agendarCompromisso`. OAuth incremental: `auth-store.ts` pede dois escopos e expõe o que foi concedido; sem o escopo do Tasks o fluxo nem chama o Google e devolve aviso `motivo: "ampliarAcesso"`.

**Tech Stack:** TypeScript (tsx, `allowImportingTsExtensions`: imports com `.ts`), Express 4, Vue 3, `node:test` + `node:assert/strict` (`npm test`), `npx vue-tsc --noEmit`, `fetch` nativo do Node 22, Google Tasks REST v1.

**Spec:** `docs/superpowers/plans/2026-09-14-passos-google-tasks.md` (leia junto; este plano argumenta a partir dele) e `CLAUDE.md`.

## Global Constraints

Valem para TODAS as tarefas.

**D1 — OAuth incremental, sem logout**
- Escopos: `ESCOPO_CALENDAR = "https://www.googleapis.com/auth/calendar.events"`, `ESCOPO_TASKS = "https://www.googleapis.com/auth/tasks"` (nunca `tasks.readonly`). `ESCOPOS = [ESCOPO_CALENDAR, ESCOPO_TASKS]`, juntos por espaço na URL de consentimento. `include_granted_scopes=true`, `prompt=consent`, `access_type=offline` continuam.
- Nunca orientar `/api/auth/logout` para ampliar acesso (revoga o refresh_token e derruba o Calendar). Ampliar = o mesmo redirect `/api/auth/google`.
- Credencial só com Calendar continua funcionando igual. Tasks ausente é estado degradado, não erro de conexão.
- `GET /api/auth/status` → `{ conectado: boolean, tasks: boolean }`.
- Fallback quando o Google não devolve `scope` no code exchange: **só** `ESCOPO_CALENDAR`.
- `scope` devolvido sem `ESCOPO_CALENDAR` → classe `EscopoNegado`, **nada gravado** (credencial anterior intacta, cache em memória intacto) → redirect `/?auth=escopo_calendar_negado`.
- `precisaConectar` é reservado à credencial (401). 403 de escopo insuficiente do Tasks **nunca** vira `precisaConectar`: vira `motivo: "ampliarAcesso"`.

**D2 — campo, não capacidade**
- Campo opcional `passos: string[]` em `agendar_evento` (fora de `required`). Não existe `criar_tarefa`. Checklist sem compromisso vira `agendar_evento` com `passos` (regra de prompt). Tarefa avulsa: adiada.

**D3 — uma lista por squad**
- Título: `` `SquadOne · ${squad.nome}` `` (ponto médio U+00B7 com um espaço de cada lado).
- Id em `Squad.tasksListaId?: string` no roster, sem versão nova. Nunca procurar lista por título.
- Criação lazy e single-flight: `Map<squadId, Promise<string>>` em memória. Chamada ao Google FORA de `atualizarRoster`; só a gravação do id dentro da fila.
- Lista gravada que responde 404/410 → cria lista nova e sobrescreve o id, uma vez só por chamada.
- `tasksListaId` não entra em `rosterTree` (prompt) nem em `paraVista` (frontend). Squad renomeada não renomeia a lista (V1).

**D4** — A Mochila não lê o Tasks. Nenhuma chamada nova nem modo de falha novo em `/api/mochila`. Selo "passos 2/5": adiado.

**D5 — vínculo**
- Evento principal (`eventos[0]`: o foco, ou o marco do prazo) ganha em `extendedProperties.private`: `squadone_tasks_lista` = id da lista, `squadone_tasks_pai` = id da tarefa-mãe (autoritativas). Constantes `PROP_TASKS_LISTA`, `PROP_TASKS_PAI` em `server/calendar.ts`.
- Tarefa-mãe `notes` = `htmlLink` + `\n` + `squadone_evento=<eventId>` (sem htmlLink: só a linha `squadone_evento=<eventId>`). Informativa.
- Blocos de prazo não recebem chaves nem tarefas. `marcasDoEvento()` NÃO muda: as chaves entram por PATCH depois das tarefas.

**D6 — fluxo e falhas**
- Ordem: (1) sem escopo → aviso `"Passos não criados: falta autorizar o Google Tasks."` com `motivo: "ampliarAcesso"`, zero chamadas; (2) `garantirListaDaSquad`; (3) tarefa-mãe (`title` = título do compromisso, `notes` conforme D5, `due` = data local de São Paulo do evento principal no formato `AAAA-MM-DDT00:00:00.000Z`); (4) subtarefas na ordem, com `parent`, **sem `due`**; (5) PATCH do evento principal com as duas chaves via `atualizarPreservandoMarcas`.
- `due`: foco → dia local do `inicio`; marco com hora → dia local do `fim` (o prazo); dia inteiro → a própria data de `inicio`.
- Nenhuma falha do Tasks desfaz ou falha o compromisso. Falha antes da mãe: aviso com a mensagem (+ `ampliarAcesso` se escopo; sem motivo se API desligada). Subtarefa falha: para a série, não apaga nada, avisa quantas faltaram. PATCH falha: aviso "passos criados mas o vínculo no evento não foi gravado". 401 do Tasks: um retry com token novo (`comToken`); persistiu → `motivo: "precisaConectar"`.
- Timeout `TIMEOUT_TASKS_MS = 10_000` por chamada ao Tasks (`AbortSignal.timeout`).
- `EventoCriado.passos?: number` (subtarefas criadas, só quando > 0) no evento principal; toast acrescenta `` ` · ${n} passo(s) no Google Tasks` ``.
- Fora do escopo: nada reescreve as tarefas depois (Ajuste não atualiza `due`; apagar evento deixa tarefas órfãs; vigia/lembretes não sabem do Tasks; redirecionamento de squad usa a lista da squad de destino sozinho).

**Normalização (`server/passos.ts`)**: `MAX_PASSOS = 10`, `MAX_TITULO_PASSO = 200`; só array; só itens `string`; espaços colapsados + `trim`; vazios descartados; dedupe sem diferenciar maiúsculas preservando a ordem; corte com `…` (199 caracteres + `…`); devolve `{ passos, cortados }`. 0 itens = não cria nada; 1 item cria.

**Decisões deste plano (onde o spec deixava escolha)**
- **Ordem das subtarefas:** `previous=<id da subtarefa anterior>` (a primeira sem `previous`). A doc de `tasks.insert` diz: "If the task is created at the first position among its siblings, this parameter is omitted" — sem `previous` a tarefa vai para o topo. Ordem reversa foi descartada: com falha no meio ela deixaria criada a CAUDA da lista e perderia o começo; com `previous` a série parada deixa os primeiros passos certos.
- **PATCH do vínculo:** `lerEvento` + `atualizarPreservandoMarcas` (uma leitura a mais). `agendamento.ts` não muda o `gravar`.
- **Token do Tasks:** `CapabilityContext.tasks.obterToken` = `tokenValido` passado pela rota (mesmo caminho de `/api/quests/:eventId/ajustar`), porque o retry de 401 precisa pedir token de novo; `AgendaDoTurno` só carrega um token estático.
- **`comToken` generalizado** em `calendar.ts` com um 3º parâmetro opcional (predicado de credencial); `tasks.ts` exporta `comTokenTasks` sobre ele.
- **Existência da lista:** `lerLista` antes de usar o id gravado (uma GET por compromisso com passos, que são raros): é o que detecta a lista apagada no Google sem depender do erro de `tasks.insert`.
- **`MotivoDeAviso`** novo em `orchestrator.ts` (`MotivoDeErro | "ampliarAcesso"`): `ErroTarefa` continua sem `ampliarAcesso`.
- **Toast com ação:** `avisar(texto, acao?)` no `App.vue` ganha um botão opcional; avisos `ampliarAcesso` saem do `alert()` e viram esse toast.

**Convenções**
- Comentários e identificadores em português; comentário explica o **porquê**.
- Erros classificados (`ErroTasks` com getters, `ListaSumiu`, `TasksSemResposta`, `EscopoNegado`), nunca só mensagem.
- Falha de uma parte não derruba o resto.
- `server/agendamento.ts` não importa nada de Tasks (só ganha tipos). `server/alocador.ts` continua puro e sem imports. `server/passos.ts` só pode importar de `alocador.ts`.
- Testes: `node:test` + `node:assert/strict`, arquivos `server/*.test.ts` / `src/*.test.ts` (o glob do `npm test` já os pega). Fuso e instantes com offset explícito (`-03:00`), como `server/lembretes.test.ts`. I/O com dublês (injeção de dependência, como `server/vigia.test.ts`) ou `mock.method(globalThis, "fetch", ...)`; nada toca o Google.
- Verificação ao fim de cada tarefa: `npx vue-tsc --noEmit` e `npm test` verdes.
- Commits em português, estilo `feat(tasks): ...`, terminando com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Não fazer push nem `graphify update` nas tarefas (o controlador faz).
- Sem variável de ambiente nova.

## Mapa de arquivos

| Arquivo | Tarefa | Responsabilidade |
|---|---|---|
| `server/passos.ts` + `.test.ts` | 1 | puro: normalização, títulos, notas, `due`, escopo |
| `server/tasks.ts` + `.test.ts`, `server/calendar.ts` (comToken) | 2 | transporte Tasks, `ErroTasks`, timeout, `comTokenTasks` |
| `server/auth-store.ts` + `.test.ts` | 3 | escopos, fallback, `EscopoNegado`, `escoposConcedidos` |
| `server.ts` (auth) | 4 | status `{conectado,tasks}`, callback |
| `src/auth/google.ts`, `src/App.vue` | 5 | `tasksLiberado`, `ampliarAcesso`, chip, retorno negado, toast com ação |
| `server/squad.ts`, `server/squad.test.ts` | 6 | `tasksListaId`, `gravarTasksListaId`, vista sem o campo |
| `server/calendar.ts`, `server/calendar.test.ts` | 7 | `PROP_TASKS_*`, preservação no PATCH |
| `server/passos-no-google.ts` + `.test.ts`, `server/agendamento.ts` (tipos) | 8 | lista single-flight + tarefas + vínculo |
| `server/capabilities.ts`, `server/orchestrator.ts`, `server.ts` (orquestrar), `server/prompt-passos.test.ts` | 9 | campo, contexto, handler, prompt, rota |
| `src/types.ts`, `src/contribuicao.ts`, `src/ajuste-do-usuario.test.ts`, `src/App.vue` | 10 | espelho de tipos, toast de passos e de `ampliarAcesso` |
| `CLAUDE.md` | 11 | documentação |

---

### Task 1: Regras puras dos passos (`server/passos.ts`)

**Files:**
- Create: `server/passos.ts`
- Test: `server/passos.test.ts`

**Interfaces:**
- Consumes: `dataLocal(instante: number, fuso: string): { ano: number; mes: number; dia: number; diaSemana: number }` de `server/alocador.ts` (já existe).
- Produces (usado pelas Tasks 3, 8, 9):
  - `export const MAX_PASSOS = 10`
  - `export const MAX_TITULO_PASSO = 200`
  - `export const PREFIXO_VINCULO = "squadone_evento="`
  - `export function normalizarPassos(valor: unknown): { passos: string[]; cortados: number }`
  - `export function tituloDaLista(squadNome: string): string`
  - `export function notasDaTarefaMae(htmlLink: string | undefined, eventId: string): string`
  - `export interface EventoPrincipal { inicio: string; fim: string; dia_inteiro: boolean; papel: "foco" | "marco" | "bloco" }`
  - `export function dueDaTarefa(evento: EventoPrincipal, fuso: string): string`
  - `export function escopoConcedido(scope: string | null | undefined, escopo: string): boolean`

- [ ] **Step 1: Escrever os testes (falham: o módulo não existe)**

`server/passos.test.ts`:

```ts
/**
 * Regras puras dos passos no Google Tasks: o que vira subtarefa, com que
 * título, e em que DIA a tarefa-mãe cai. Fuso passado por parâmetro e
 * instantes com offset explícito, para o teste não depender da máquina.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dueDaTarefa,
  escopoConcedido,
  MAX_PASSOS,
  MAX_TITULO_PASSO,
  normalizarPassos,
  notasDaTarefaMae,
  tituloDaLista,
} from "./passos.ts";

const FUSO = "America/Sao_Paulo";

describe("normalizarPassos", () => {
  const casos: Array<[string, unknown, string[], number]> = [
    ["não-array (undefined)", undefined, [], 0],
    ["não-array (string)", "slides, dados", [], 0],
    ["não-array (objeto)", { 0: "a" }, [], 0],
    ["array vazio", [], [], 0],
    ["descarta vazios e só-espaço", ["", "   ", "Montar slides"], ["Montar slides"], 0],
    ["descarta não-string", [null, 3, { a: 1 }, "Revisar dados"], ["Revisar dados"], 0],
    ["trim e espaços colapsados", ["  Montar \n  slides  "], ["Montar slides"], 0],
    ["dedupe sem diferenciar maiúsculas, mantém o primeiro", ["Ensaiar", "ensaiar", "ENSAIAR ", "Revisar"], ["Ensaiar", "Revisar"], 0],
    ["um item só cria", ["Comprar pão"], ["Comprar pão"], 0],
  ];
  for (const [nome, entrada, passos, cortados] of casos) {
    it(nome, () => {
      assert.deepEqual(normalizarPassos(entrada), { passos, cortados });
    });
  }

  it("corta item longo em MAX_TITULO_PASSO com reticências", () => {
    const longo = "a".repeat(MAX_TITULO_PASSO + 50);
    const { passos } = normalizarPassos([longo]);
    assert.equal(passos[0].length, MAX_TITULO_PASSO);
    assert.equal(passos[0].endsWith("…"), true);
  });

  it("item com exatamente MAX_TITULO_PASSO não é cortado", () => {
    const exato = "b".repeat(MAX_TITULO_PASSO);
    assert.deepEqual(normalizarPassos([exato]).passos, [exato]);
  });

  it("limita a MAX_PASSOS e conta os cortados (duplicados não contam)", () => {
    const itens = Array.from({ length: 13 }, (_, i) => `Passo ${i + 1}`);
    const r = normalizarPassos([...itens, "passo 1"]);
    assert.equal(r.passos.length, MAX_PASSOS);
    assert.equal(r.passos[0], "Passo 1");
    assert.equal(r.passos[MAX_PASSOS - 1], "Passo 10");
    assert.equal(r.cortados, 3);
  });
});

describe("tituloDaLista e notasDaTarefaMae", () => {
  it("título da lista leva o nome da squad", () => {
    assert.equal(tituloDaLista("Pay4Fun"), "SquadOne · Pay4Fun");
  });

  it("notas: link do evento e, na última linha, o vínculo", () => {
    assert.equal(
      notasDaTarefaMae("https://www.google.com/calendar/event?eid=abc", "ev123"),
      "https://www.google.com/calendar/event?eid=abc\nsquadone_evento=ev123",
    );
  });

  it("notas sem htmlLink: só o vínculo", () => {
    assert.equal(notasDaTarefaMae(undefined, "ev123"), "squadone_evento=ev123");
  });
});

describe("dueDaTarefa", () => {
  const casos: Array<[string, Parameters<typeof dueDaTarefa>[0], string]> = [
    [
      "foco de manhã: dia local do início",
      { papel: "foco", dia_inteiro: false, inicio: "2026-09-14T09:00:00.000Z", fim: "2026-09-14T10:00:00.000Z" },
      "2026-09-14T00:00:00.000Z",
    ],
    [
      "foco às 22:30 em SP (01:30 UTC do dia seguinte) continua no mesmo dia local",
      { papel: "foco", dia_inteiro: false, inicio: "2026-09-14T22:30:00-03:00", fim: "2026-09-14T23:30:00-03:00" },
      "2026-09-14T00:00:00.000Z",
    ],
    [
      "marco com hora: dia do PRAZO (fim), não do início (prazo − 15 min)",
      { papel: "marco", dia_inteiro: false, inicio: "2026-09-17T23:50:00-03:00", fim: "2026-09-18T00:05:00-03:00" },
      "2026-09-18T00:00:00.000Z",
    ],
    [
      "marco de dia inteiro: a própria data (fim exclusivo ignorado)",
      { papel: "marco", dia_inteiro: true, inicio: "2026-09-18", fim: "2026-09-19" },
      "2026-09-18T00:00:00.000Z",
    ],
  ];
  for (const [nome, evento, esperado] of casos) {
    it(nome, () => {
      assert.equal(dueDaTarefa(evento, FUSO), esperado);
    });
  }
});

describe("escopoConcedido", () => {
  const DOIS =
    "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks";
  const casos: Array<[string, string | null | undefined, string, boolean]> = [
    ["string com os dois: tasks", DOIS, "https://www.googleapis.com/auth/tasks", true],
    ["string com os dois: calendar", DOIS, "https://www.googleapis.com/auth/calendar.events", true],
    ["só calendar: tasks não", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/tasks", false],
    ["tasks.readonly não conta como tasks", "https://www.googleapis.com/auth/tasks.readonly", "https://www.googleapis.com/auth/tasks", false],
    ["espaços extras", `  ${DOIS}  `, "https://www.googleapis.com/auth/tasks", true],
    ["vazio", "", "https://www.googleapis.com/auth/tasks", false],
    ["undefined", undefined, "https://www.googleapis.com/auth/tasks", false],
    ["null", null, "https://www.googleapis.com/auth/tasks", false],
  ];
  for (const [nome, scope, escopo, esperado] of casos) {
    it(nome, () => {
      assert.equal(escopoConcedido(scope, escopo), esperado);
    });
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test server/passos.test.ts`
Expected: FAIL — `Cannot find module './passos.ts'`.

- [ ] **Step 3: Implementar**

`server/passos.ts`:

```ts
import { dataLocal } from "./alocador.ts";

/**
 * Regras PURAS dos passos de um compromisso no Google Tasks. Sem fetch,
 * relógio, env ou import de I/O — só `alocador.ts`, que também é puro. É o que
 * dá para fixar em tabela de casos; o fluxo com rede mora em
 * `passos-no-google.ts`.
 */

/**
 * Teto de subtarefas por compromisso. O prompt pede 2–8; o servidor garante
 * 10 porque prompt é pedido, não garantia, e uma resposta fora do esperado não
 * pode virar uma checklist de 40 itens no celular do usuário.
 */
export const MAX_PASSOS = 10;

/** Um passo é lido de relance na lista do Tasks; o limite da API (1024) é bem maior. */
export const MAX_TITULO_PASSO = 200;

/** Última linha das notas da tarefa-mãe. Informativa: o usuário edita as notas à vontade. */
export const PREFIXO_VINCULO = "squadone_evento=";

/**
 * O que o modelo mandou em `passos`, do jeito que pode ir para o Google.
 * Deduplica sem diferenciar maiúsculas porque "Ensaiar" e "ensaiar" na mesma
 * checklist são o mesmo passo repetido, não dois. `cortados` volta para o
 * handler avisar: cortar calado faria o usuário procurar um passo que não existe.
 * Um item só CRIA: se o usuário pediu, a checklist de um item é dele.
 */
export function normalizarPassos(valor: unknown): { passos: string[]; cortados: number } {
  if (!Array.isArray(valor)) return { passos: [], cortados: 0 };
  const vistos = new Set<string>();
  const unicos: string[] = [];
  for (const item of valor) {
    // A declaração é ARRAY de STRING: número ou objeto aqui é resposta torta, e
    // String({}) viraria "[object Object]" na lista do usuário.
    if (typeof item !== "string") continue;
    const texto = item.replace(/\s+/g, " ").trim();
    if (!texto) continue;
    const chave = texto.toLocaleLowerCase("pt-BR");
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unicos.push(texto.length <= MAX_TITULO_PASSO ? texto : texto.slice(0, MAX_TITULO_PASSO - 1) + "…");
  }
  return { passos: unicos.slice(0, MAX_PASSOS), cortados: Math.max(0, unicos.length - MAX_PASSOS) };
}

/** A squad é a fronteira de contexto do app: no celular vira uma lista por squad. */
export function tituloDaLista(squadNome: string): string {
  return `SquadOne · ${squadNome}`;
}

/**
 * O Tasks não tem extendedProperties e `links` é somente leitura: o único lugar
 * da tarefa que aceita o vínculo é o texto das notas. O link vem primeiro
 * porque é o que o usuário toca no celular.
 */
export function notasDaTarefaMae(htmlLink: string | undefined, eventId: string): string {
  const vinculo = `${PREFIXO_VINCULO}${eventId}`;
  return htmlLink ? `${htmlLink}\n${vinculo}` : vinculo;
}

/** O que `dueDaTarefa` precisa do `EventoCriado` principal. */
export interface EventoPrincipal {
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  papel: "foco" | "marco" | "bloco";
}

const dois = (n: number) => String(n).padStart(2, "0");

/**
 * `due` da tarefa-mãe: a DATA LOCAL do evento principal, meia-noite em UTC. O
 * Tasks descarta a hora e guarda só a parte de data do timestamp — então a
 * data tem que ser a de São Paulo escrita à mão. Converter o instante para UTC
 * trocaria o dia de todo evento depois das 21h.
 * - foco: o dia em que o bloco começa;
 * - marco com hora: o dia do PRAZO, que é o `fim` (o marco vai de prazo − 15 min
 *   até o prazo, e um prazo às 00:05 começaria no dia anterior);
 * - dia inteiro: a própria data de `inicio` (o `fim` do Google é exclusivo).
 */
export function dueDaTarefa(evento: EventoPrincipal, fuso: string): string {
  if (evento.dia_inteiro) return `${evento.inicio.slice(0, 10)}T00:00:00.000Z`;
  const referencia = Date.parse(evento.papel === "marco" ? evento.fim : evento.inicio);
  const d = dataLocal(referencia, fuso);
  return `${d.ano}-${dois(d.mes)}-${dois(d.dia)}T00:00:00.000Z`;
}

/**
 * O `scope` que o Google devolve é uma string separada por espaço. Comparação
 * por item inteiro: `tasks.readonly` contém "tasks" como substring e não serve
 * para escrever.
 */
export function escopoConcedido(scope: string | null | undefined, escopo: string): boolean {
  return (scope ?? "").split(/\s+/).filter(Boolean).includes(escopo);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test server/passos.test.ts`
Expected: PASS, todos os casos.

- [ ] **Step 5: Verificação completa**

Run: `npx vue-tsc --noEmit` e `npm test`
Expected: sem erros; todos os testes verdes.

- [ ] **Step 6: Commit**

```bash
git add server/passos.ts server/passos.test.ts
git commit -m "feat(tasks): regras puras dos passos (normalização, due, escopo)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: Transporte do Google Tasks (`server/tasks.ts`) e `comToken` generalizado

**Files:**
- Create: `server/tasks.ts`
- Modify: `server/calendar.ts` (função `comToken`, hoje por volta da linha 414)
- Test: `server/tasks.test.ts`

**Interfaces:**
- Consumes: `ObterToken` (`type ObterToken = () => Promise<string>`) e `comToken` de `server/calendar.ts`.
- Produces (usado pelas Tasks 8 e 9):
  - `server/calendar.ts`: `export async function comToken<T>(obter: ObterToken, fn: (token: string) => Promise<T>, ehCredencial?: (err: unknown) => boolean): Promise<T>` — padrão do 3º parâmetro = `err instanceof ErroCalendario && err.ehCredencial` (chamadores atuais não mudam).
  - `server/tasks.ts`:
    - `export const TIMEOUT_TASKS_MS = 10_000`
    - `export function urlDeListas(): string` → `https://tasks.googleapis.com/tasks/v1/users/@me/lists`
    - `export function urlDaLista(listaId: string): string`
    - `export function urlDeTarefas(listaId: string): string` → `https://tasks.googleapis.com/tasks/v1/lists/{listaId}/tasks`
    - `export class ErroTasks extends Error { readonly status: number; readonly motivo: string; readonly detalhes: string[]; get ehCredencial(): boolean; get escopoInsuficiente(): boolean; get apiDesligada(): boolean }` — construtor `(status: number, corpo: string)`
    - `export class ListaSumiu extends Error { readonly listaId: string }`
    - `export class TasksSemResposta extends Error {}`
    - `export interface CorpoDeTarefa { title: string; notes?: string; due?: string }`
    - `export async function inserirLista(token: string, titulo: string): Promise<{ id: string; title?: string }>`
    - `export async function lerLista(token: string, listaId: string): Promise<{ id: string; title?: string }>` (404/410 → `ListaSumiu`)
    - `export async function inserirTarefa(token: string, listaId: string, corpo: CorpoDeTarefa, posicao?: { parent?: string; previous?: string }): Promise<{ id: string }>`
    - `export function comTokenTasks<T>(obter: ObterToken, fn: (token: string) => Promise<T>): Promise<T>`

- [ ] **Step 1: Escrever os testes (falham: módulo inexistente)**

`server/tasks.test.ts`:

```ts
/**
 * Transporte do Google Tasks: classificação dos erros com corpos reais do
 * Google, URLs/parâmetros, timeout e o retry de credencial. `fetch` é dublê:
 * nada toca a rede.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  comTokenTasks,
  ErroTasks,
  inserirTarefa,
  lerLista,
  ListaSumiu,
  TasksSemResposta,
} from "./tasks.ts";

const CORPO_401 = JSON.stringify({
  error: {
    code: 401,
    message: "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.",
    errors: [{ message: "Invalid Credentials", domain: "global", reason: "authError", location: "Authorization", locationType: "header" }],
    status: "UNAUTHENTICATED",
  },
});
const CORPO_403_ESCOPO = JSON.stringify({
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    errors: [{ message: "Insufficient Permission", domain: "global", reason: "insufficientPermissions" }],
    status: "PERMISSION_DENIED",
    details: [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      domain: "googleapis.com",
      metadata: { service: "tasks.googleapis.com", method: "google.apps.tasks.v1.TasksService.InsertTask" },
    }],
  },
});
const CORPO_403_ESCOPO_SO_DETALHE = JSON.stringify({
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    status: "PERMISSION_DENIED",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
  },
});
const CORPO_403_API_DESLIGADA = JSON.stringify({
  error: {
    code: 403,
    message: "Google Tasks API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/tasks.googleapis.com/overview?project=123 then retry.",
    errors: [{ message: "Google Tasks API has not been used...", domain: "usageLimits", reason: "accessNotConfigured", extendedHelp: "https://console.developers.google.com" }],
    status: "PERMISSION_DENIED",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com", metadata: { service: "tasks.googleapis.com" } }],
  },
});
const CORPO_403_GENERICO = JSON.stringify({
  error: { code: 403, message: "Forbidden", errors: [{ reason: "forbidden" }], status: "PERMISSION_DENIED" },
});

describe("ErroTasks: classificação", () => {
  const casos: Array<[string, number, string, { credencial: boolean; escopo: boolean; desligada: boolean; motivo: string }]> = [
    ["401 authError: credencial", 401, CORPO_401, { credencial: true, escopo: false, desligada: false, motivo: "authError" }],
    ["403 insufficientPermissions: escopo, NÃO credencial", 403, CORPO_403_ESCOPO, { credencial: false, escopo: true, desligada: false, motivo: "insufficientPermissions" }],
    ["403 só com detalhe ACCESS_TOKEN_SCOPE_INSUFFICIENT: escopo", 403, CORPO_403_ESCOPO_SO_DETALHE, { credencial: false, escopo: true, desligada: false, motivo: "" }],
    ["403 accessNotConfigured/SERVICE_DISABLED: API desligada", 403, CORPO_403_API_DESLIGADA, { credencial: false, escopo: false, desligada: true, motivo: "accessNotConfigured" }],
    ["403 genérico: nada", 403, CORPO_403_GENERICO, { credencial: false, escopo: false, desligada: false, motivo: "forbidden" }],
    ["corpo não-JSON: nada, mensagem com o recorte", 502, "<html>Bad Gateway</html>", { credencial: false, escopo: false, desligada: false, motivo: "" }],
  ];
  for (const [nome, status, corpo, esperado] of casos) {
    it(nome, () => {
      const err = new ErroTasks(status, corpo);
      assert.equal(err.status, status);
      assert.equal(err.motivo, esperado.motivo);
      assert.equal(err.ehCredencial, esperado.credencial);
      assert.equal(err.escopoInsuficiente, esperado.escopo);
      assert.equal(err.apiDesligada, esperado.desligada);
      assert.match(err.message, new RegExp(`^Google Tasks respondeu ${status}: `));
    });
  }

  it("mensagem usa error.message do Google quando há JSON", () => {
    assert.match(new ErroTasks(403, CORPO_403_API_DESLIGADA).message, /has not been used in project 123/);
  });
});

describe("transporte", () => {
  afterEach(() => mock.restoreAll());

  it("inserirTarefa: POST na lista, parent e previous na query, corpo JSON, Bearer", async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      chamadas.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "t2" }), { status: 200 });
    });
    const r = await inserirTarefa("tk", "lista/1", { title: "Montar slides" }, { parent: "mae", previous: "t1" });
    assert.deepEqual(r, { id: "t2" });
    const u = new URL(chamadas[0].url);
    assert.equal(u.origin + u.pathname, "https://tasks.googleapis.com/tasks/v1/lists/lista%2F1/tasks");
    assert.equal(u.searchParams.get("parent"), "mae");
    assert.equal(u.searchParams.get("previous"), "t1");
    assert.equal(chamadas[0].init.method, "POST");
    assert.equal((chamadas[0].init.headers as Record<string, string>).Authorization, "Bearer tk");
    assert.deepEqual(JSON.parse(String(chamadas[0].init.body)), { title: "Montar slides" });
    assert.ok(chamadas[0].init.signal, "toda chamada leva o sinal de timeout");
  });

  it("inserirTarefa sem posição: nenhuma query", async () => {
    let url = "";
    mock.method(globalThis, "fetch", async (u: string) => {
      url = String(u);
      return new Response(JSON.stringify({ id: "t1" }), { status: 200 });
    });
    await inserirTarefa("tk", "L", { title: "x" });
    assert.equal(new URL(url).search, "");
  });

  it("lerLista 404 → ListaSumiu", async () => {
    mock.method(globalThis, "fetch", async () => new Response("{}", { status: 404 }));
    await assert.rejects(lerLista("tk", "L"), (err: unknown) => err instanceof ListaSumiu && err.listaId === "L");
  });

  it("lerLista 410 → ListaSumiu", async () => {
    mock.method(globalThis, "fetch", async () => new Response("{}", { status: 410 }));
    await assert.rejects(lerLista("tk", "L"), ListaSumiu);
  });

  it("erro HTTP → ErroTasks com status", async () => {
    mock.method(globalThis, "fetch", async () => new Response(CORPO_403_ESCOPO, { status: 403 }));
    await assert.rejects(inserirTarefa("tk", "L", { title: "x" }), (err: unknown) => err instanceof ErroTasks && err.escopoInsuficiente);
  });

  it("timeout do fetch → TasksSemResposta", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await assert.rejects(inserirTarefa("tk", "L", { title: "x" }), TasksSemResposta);
  });
});

describe("comTokenTasks", () => {
  it("401 com token novo: repete uma vez e dá certo", async () => {
    const tokens = ["velho", "novo"];
    const usados: string[] = [];
    const r = await comTokenTasks(async () => tokens.shift()!, async (t) => {
      usados.push(t);
      if (t === "velho") throw new ErroTasks(401, CORPO_401);
      return "ok";
    });
    assert.equal(r, "ok");
    assert.deepEqual(usados, ["velho", "novo"]);
  });

  it("401 com o MESMO token: não repete, sobe o erro", async () => {
    let chamadas = 0;
    await assert.rejects(
      comTokenTasks(async () => "igual", async () => {
        chamadas++;
        throw new ErroTasks(401, CORPO_401);
      }),
      ErroTasks,
    );
    assert.equal(chamadas, 1);
  });

  it("403 de escopo: não é credencial, não repete", async () => {
    let chamadas = 0;
    await assert.rejects(
      comTokenTasks(async () => `t${chamadas}`, async () => {
        chamadas++;
        throw new ErroTasks(403, CORPO_403_ESCOPO);
      }),
      (err: unknown) => err instanceof ErroTasks && err.escopoInsuficiente,
    );
    assert.equal(chamadas, 1);
  });
});
```

Nota: se `mock.method(globalThis, "fetch", ...)` não passar no `vue-tsc`, troque pelo padrão de `server/push.test.ts` (guardar `globalThis.fetch` original, atribuir `(async (url: string, init: any) => ...) as unknown as typeof fetch` e restaurar no `afterEach`). O comportamento testado não muda.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test server/tasks.test.ts`
Expected: FAIL — `Cannot find module './tasks.ts'`.

- [ ] **Step 3: Generalizar `comToken` em `server/calendar.ts`**

Substituir a função atual (mantendo o comentário existente e acrescentando o parágrafo do porquê) por:

```ts
/**
 * Pede o token IMEDIATAMENTE antes da chamada. Se o Google recusar a
 * credencial, pede de novo e, vindo um token diferente, repete uma vez: 401
 * só vira `precisaConectar` se persistir com o token recém-obtido. Repetir é
 * seguro: 401 é recusa antes de aplicar, nada foi gravado.
 *
 * `ehCredencial` existe para o Google Tasks (server/tasks.ts) reusar o mesmo
 * retry: lá só 401 é credencial — 403 de escopo insuficiente é "ampliar
 * acesso", e repetir com token novo não o conserta.
 */
export async function comToken<T>(
  obter: ObterToken,
  fn: (token: string) => Promise<T>,
  ehCredencial: (err: unknown) => boolean = (err) => err instanceof ErroCalendario && err.ehCredencial,
): Promise<T> {
  const token = await obter();
  try {
    return await fn(token);
  } catch (err) {
    if (!ehCredencial(err)) throw err;
    const novo = await obter();
    if (novo === token) throw err;
    return fn(novo);
  }
}
```

- [ ] **Step 4: Implementar `server/tasks.ts`**

```ts
import { comToken, type ObterToken } from "./calendar.ts";

/**
 * Transporte do Google Tasks, no estilo de calendar.ts e só com o que a V1 usa:
 * criar e conferir uma lista, criar tarefa. Nenhuma regra de negócio — ordem,
 * vínculo e avisos moram em passos-no-google.ts.
 */

const BASE = "https://tasks.googleapis.com/tasks/v1";

/**
 * Teto de UMA chamada ao Tasks. Os passos rodam dentro da série de
 * agendar_evento do turno: um Tasks travado seguraria os compromissos
 * seguintes e o spinner do usuário.
 */
export const TIMEOUT_TASKS_MS = 10_000;

export function urlDeListas(): string {
  return `${BASE}/users/@me/lists`;
}

export function urlDaLista(listaId: string): string {
  return `${urlDeListas()}/${encodeURIComponent(listaId)}`;
}

export function urlDeTarefas(listaId: string): string {
  return `${BASE}/lists/${encodeURIComponent(listaId)}/tasks`;
}

/**
 * Erro do Google Tasks com o que separa os gestos. Três 403 diferentes pedem
 * três coisas: escopo insuficiente pede AMPLIAR o acesso (o Calendar segue
 * funcionando, então não é "Conectar"); API desligada no projeto não melhora
 * com clique nenhum do usuário; o resto é só mensagem.
 */
export class ErroTasks extends Error {
  readonly status: number;
  /** `reason` do primeiro item de `error.errors`; "" quando não vem. */
  readonly motivo: string;
  /** `reason` de cada item de `error.details` (formato google.rpc.ErrorInfo). */
  readonly detalhes: string[];

  constructor(status: number, corpo: string) {
    let motivo = "";
    let detalhes: string[] = [];
    let texto = corpo.slice(0, 300);
    try {
      const json = JSON.parse(corpo) as {
        error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
      };
      motivo = json.error?.errors?.[0]?.reason ?? "";
      detalhes = (json.error?.details ?? []).map((d) => d.reason ?? "").filter(Boolean);
      texto = json.error?.message ?? texto;
    } catch {
      // Corpo não-JSON (HTML de proxy, vazio): fica o recorte cru.
    }
    super(`Google Tasks respondeu ${status}: ${texto}`);
    this.name = "ErroTasks";
    this.status = status;
    this.motivo = motivo;
    this.detalhes = detalhes;
  }

  /**
   * Só 401. Diferente de `ErroCalendario.ehCredencial`, 403 de permissão NÃO
   * entra: com o Calendar funcionando, mandar reconectar seria mentira.
   */
  get ehCredencial(): boolean {
    return this.status === 401;
  }

  /** O token não carrega o escopo do Tasks: o gesto é "Autorizar Google Tasks". */
  get escopoInsuficiente(): boolean {
    return (
      this.status === 403 &&
      (this.motivo === "insufficientPermissions" || this.detalhes.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
    );
  }

  /** API do Tasks desligada no projeto Google: ambiente, a mensagem do Google diz o que fazer. */
  get apiDesligada(): boolean {
    return (
      this.status === 403 &&
      (this.motivo === "accessNotConfigured" || this.detalhes.includes("SERVICE_DISABLED"))
    );
  }
}

/** A lista gravada no roster foi apagada no Google (404/410). Quem chama cria outra. */
export class ListaSumiu extends Error {
  readonly listaId: string;
  constructor(listaId: string) {
    super(`A lista '${listaId}' não existe mais no Google Tasks.`);
    this.name = "ListaSumiu";
    this.listaId = listaId;
  }
}

/** O Tasks não respondeu dentro de TIMEOUT_TASKS_MS. */
export class TasksSemResposta extends Error {
  constructor() {
    super(`O Google Tasks não respondeu em ${TIMEOUT_TASKS_MS / 1000} s.`);
    this.name = "TasksSemResposta";
  }
}

export interface CorpoDeTarefa {
  title: string;
  notes?: string;
  /** RFC 3339; o Tasks guarda só a data. Ver `dueDaTarefa` em passos.ts. */
  due?: string;
}

async function chamar<T>(
  token: string,
  url: string,
  opcoes: { method?: string; corpo?: unknown } = {},
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: opcoes.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opcoes.corpo !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_TASKS_MS),
    });
  } catch (err: any) {
    // Classificado: o aviso ao usuário diz "não respondeu", não "operation aborted".
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new TasksSemResposta();
    throw err;
  }
  if (!resp.ok) throw new ErroTasks(resp.status, await resp.text().catch(() => ""));
  return (await resp.json()) as T;
}

export async function inserirLista(token: string, titulo: string): Promise<{ id: string; title?: string }> {
  return chamar(token, urlDeListas(), { method: "POST", corpo: { title: titulo } });
}

/**
 * Confere se a lista gravada ainda existe. Existe porque o usuário apaga listas
 * no celular, e procurar por título para "achar de novo" criaria duplicatas
 * quando ele renomeia.
 */
export async function lerLista(token: string, listaId: string): Promise<{ id: string; title?: string }> {
  try {
    return await chamar(token, urlDaLista(listaId));
  } catch (err) {
    if (err instanceof ErroTasks && (err.status === 404 || err.status === 410)) throw new ListaSumiu(listaId);
    throw err;
  }
}

/**
 * `previous` ausente põe a tarefa no TOPO das irmãs (doc do tasks.insert):
 * quem cria uma série em ordem passa o id da anterior.
 */
export async function inserirTarefa(
  token: string,
  listaId: string,
  corpo: CorpoDeTarefa,
  posicao: { parent?: string; previous?: string } = {},
): Promise<{ id: string }> {
  const busca = new URLSearchParams();
  if (posicao.parent) busca.set("parent", posicao.parent);
  if (posicao.previous) busca.set("previous", posicao.previous);
  const query = busca.toString();
  return chamar(token, `${urlDeTarefas(listaId)}${query ? `?${query}` : ""}`, { method: "POST", corpo });
}

/** O retry de credencial do Calendar, com o critério do Tasks (só 401). */
export function comTokenTasks<T>(obter: ObterToken, fn: (token: string) => Promise<T>): Promise<T> {
  return comToken(obter, fn, (err) => err instanceof ErroTasks && err.ehCredencial);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx tsx --test server/tasks.test.ts`
Expected: PASS.

- [ ] **Step 6: Verificação completa**

Run: `npx vue-tsc --noEmit` e `npm test`
Expected: sem erros; testes existentes (inclusive os que usam `comToken` indiretamente via ajuste) verdes.

- [ ] **Step 7: Commit**

```bash
git add server/tasks.ts server/tasks.test.ts server/calendar.ts
git commit -m "feat(tasks): transporte do Google Tasks com erro classificado e timeout

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: Escopos no `auth-store.ts` (dois escopos, fallback, recusa sem Calendar, concessões)

**Files:**
- Modify: `server/auth-store.ts`
- Test: `server/auth-store.test.ts` (acrescentar casos puros), Create: `server/auth-escopos.test.ts` (fluxo do callback em diretório temporário)

**Interfaces:**
- Consumes: `escopoConcedido(scope: string | null | undefined, escopo: string): boolean` de `server/passos.ts` (Task 1).
- Produces (usado pelas Tasks 4 e 9):
  - `export const ESCOPO_CALENDAR = "https://www.googleapis.com/auth/calendar.events"`
  - `export const ESCOPO_TASKS = "https://www.googleapis.com/auth/tasks"`
  - `export const ESCOPOS: readonly string[]` = `[ESCOPO_CALENDAR, ESCOPO_TASKS]`
  - `export class EscopoNegado extends Error {}`
  - `export function escopoDaCredencial(scopeDoGoogle: unknown): string`
  - `export function concessoesDoScope(scope: string | null | undefined): { calendar: boolean; tasks: boolean }`
  - `export async function escoposConcedidos(): Promise<{ calendar: boolean; tasks: boolean }>`
  - `trocarCodigo(code, state)` passa a lançar `EscopoNegado` sem gravar quando o `scope` devolvido não tem o Calendar.
  - `SCOPE` deixa de existir (só era usado dentro do arquivo; confirme com `grep -rn "SCOPE" server server.ts src`).

- [ ] **Step 1: Acrescentar os casos puros em `server/auth-store.test.ts`**

Trocar o import para `import { concessoesDoScope, ESCOPO_CALENDAR, ESCOPO_TASKS, escopoDaCredencial, refreshRecusado } from "./auth-store.ts";` e acrescentar ao fim:

```ts
/**
 * Escopos (autorização incremental do Google Tasks). O fallback de uma resposta
 * sem `scope` é SÓ o Calendar: com dois escopos no pedido, cair em "o que
 * pedimos" declararia um Tasks que ninguém concedeu.
 */
describe("escopoDaCredencial", () => {
  const DOIS = `${ESCOPO_CALENDAR} ${ESCOPO_TASKS}`;
  const casos: Array<[string, unknown, string]> = [
    ["scope devolvido é gravado como veio", DOIS, DOIS],
    ["espaços nas pontas saem", `  ${DOIS} `, DOIS],
    ["ausente: só Calendar", undefined, ESCOPO_CALENDAR],
    ["vazio: só Calendar", "", ESCOPO_CALENDAR],
    ["não-string: só Calendar", 42, ESCOPO_CALENDAR],
  ];
  for (const [nome, entrada, esperado] of casos) {
    it(nome, () => {
      assert.equal(escopoDaCredencial(entrada), esperado);
    });
  }
});

describe("concessoesDoScope", () => {
  const casos: Array<[string, string | null | undefined, { calendar: boolean; tasks: boolean }]> = [
    ["os dois", `${ESCOPO_CALENDAR} ${ESCOPO_TASKS}`, { calendar: true, tasks: true }],
    ["credencial antiga, só Calendar", ESCOPO_CALENDAR, { calendar: true, tasks: false }],
    ["Calendar desmarcado no consentimento granular", ESCOPO_TASKS, { calendar: false, tasks: true }],
    ["com escopos extras (include_granted_scopes)", `openid ${ESCOPO_TASKS} ${ESCOPO_CALENDAR}`, { calendar: true, tasks: true }],
    ["sem scope", undefined, { calendar: false, tasks: false }],
  ];
  for (const [nome, scope, esperado] of casos) {
    it(nome, () => {
      assert.deepEqual(concessoesDoScope(scope), esperado);
    });
  }
});
```

- [ ] **Step 2: Criar `server/auth-escopos.test.ts` (fluxo com disco, sem rede)**

```ts
/**
 * Callback do OAuth com dois escopos: grava, recusa sem Calendar sem tocar a
 * credencial anterior, e `escoposConcedidos` lê o que ficou em disco. Roda num
 * diretório temporário: `auth-store.ts` fixa o caminho do arquivo a partir do
 * cwd NO IMPORT, por isso o chdir vem antes do import dinâmico (cada arquivo de
 * teste roda no seu próprio processo). `fetch` é dublê: nada toca o Google.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-auth-"));
process.chdir(tmp);
process.env.VITE_GOOGLE_CLIENT_ID = "123-abc.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "segredo";
process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");

const auth = await import("./auth-store.ts");
const ARQUIVO = path.join(tmp, "data", "google-auth.json");
const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Um consentimento de verdade: o state só vale se saiu de urlDeConsentimento. */
function novoState(): string {
  return new URL(auth.urlDeConsentimento()).searchParams.get("state")!;
}

function googleDevolve(corpo: Record<string, unknown>): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: "at", expires_in: 3600, refresh_token: "rt", ...corpo }), {
      status: 200,
    })) as unknown as typeof fetch;
}

describe("urlDeConsentimento", () => {
  it("pede os dois escopos, incremental e com consent", () => {
    const u = new URL(auth.urlDeConsentimento());
    assert.equal(u.searchParams.get("scope"), `${auth.ESCOPO_CALENDAR} ${auth.ESCOPO_TASKS}`);
    assert.equal(u.searchParams.get("include_granted_scopes"), "true");
    assert.equal(u.searchParams.get("prompt"), "consent");
    assert.equal(u.searchParams.get("access_type"), "offline");
  });
});

describe("trocarCodigo + escoposConcedidos", () => {
  it("sem credencial: os dois false", async () => {
    await fs.rm(ARQUIVO, { force: true });
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: false, tasks: false });
  });

  it("scope ausente na resposta: grava só Calendar (tasks false)", async () => {
    googleDevolve({ scope: undefined });
    await auth.trocarCodigo("code", novoState());
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: true, tasks: false });
  });

  it("os dois concedidos: grava e tasks true", async () => {
    googleDevolve({ scope: `${auth.ESCOPO_CALENDAR} ${auth.ESCOPO_TASKS}` });
    await auth.trocarCodigo("code", novoState());
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: true, tasks: true });
  });

  it("Tasks desmarcado: grava normalmente, tasks false", async () => {
    googleDevolve({ scope: auth.ESCOPO_CALENDAR });
    await auth.trocarCodigo("code", novoState());
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: true, tasks: false });
  });

  it("Calendar desmarcado: EscopoNegado e a credencial anterior fica byte a byte", async () => {
    googleDevolve({ scope: `${auth.ESCOPO_CALENDAR} ${auth.ESCOPO_TASKS}` });
    await auth.trocarCodigo("code", novoState());
    const antes = await fs.readFile(ARQUIVO, "utf8");

    googleDevolve({ scope: auth.ESCOPO_TASKS, refresh_token: "rt-novo" });
    await assert.rejects(auth.trocarCodigo("code", novoState()), auth.EscopoNegado);

    assert.equal(await fs.readFile(ARQUIVO, "utf8"), antes);
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: true, tasks: true });
  });

  it("Calendar desmarcado sem credencial anterior: nada é criado", async () => {
    await fs.rm(ARQUIVO, { force: true });
    googleDevolve({ scope: auth.ESCOPO_TASKS });
    await assert.rejects(auth.trocarCodigo("code", novoState()), auth.EscopoNegado);
    await assert.rejects(fs.access(ARQUIVO));
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx tsx --test server/auth-store.test.ts server/auth-escopos.test.ts`
Expected: FAIL — exports `ESCOPO_CALENDAR`, `escopoDaCredencial`, `concessoesDoScope`, `EscopoNegado`, `escoposConcedidos` não existem.

- [ ] **Step 4: Implementar em `server/auth-store.ts`**

4a. Import no topo (puro, sem ciclo: `passos.ts` só importa `alocador.ts`):

```ts
import { escopoConcedido } from "./passos.ts";
```

4b. Trocar `export const SCOPE = ...` por:

```ts
/**
 * Dois escopos, pedidos juntos no MESMO consentimento (autorização
 * incremental). Ampliar o acesso para o Google Tasks é refazer
 * /api/auth/google — nunca logout: `desconectar` REVOGA o refresh_token no
 * Google e derrubaria o Calendar junto. Com `include_granted_scopes` e
 * `prompt=consent` o callback recebe um refresh_token novo que cobre os dois,
 * e `gravar` substitui o antigo.
 */
export const ESCOPO_CALENDAR = "https://www.googleapis.com/auth/calendar.events";
/** Leitura e escrita: `tasks.readonly` não cria a checklist. */
export const ESCOPO_TASKS = "https://www.googleapis.com/auth/tasks";
export const ESCOPOS: readonly string[] = [ESCOPO_CALENDAR, ESCOPO_TASKS];
```

4c. Nova classe, junto das outras:

```ts
/**
 * O usuário desmarcou o Google Calendar na tela de consentimento granular.
 * Nada é gravado: sem o Calendar o app não agenda nada, e sobrescrever uma
 * credencial que funcionava por uma que não serve seria perder a conexão por
 * um clique de teste.
 */
export class EscopoNegado extends Error {}
```

4d. Em `urlDeConsentimento`, `scope: SCOPE` vira `scope: ESCOPOS.join(" ")`.

4e. Funções puras, logo antes de `trocarCodigo`:

```ts
/**
 * O `scope` que vai para o disco. Resposta sem `scope` (legado) vale só o
 * Calendar: com dois escopos pedidos, cair em "o que pedimos" declararia um
 * Tasks que ninguém concedeu e o fluxo dos passos bateria num 403.
 */
export function escopoDaCredencial(scopeDoGoogle: unknown): string {
  const texto = typeof scopeDoGoogle === "string" ? scopeDoGoogle.trim() : "";
  return texto || ESCOPO_CALENDAR;
}

/** O que um `scope` gravado concede, por escopo. Pura, para testar sem disco. */
export function concessoesDoScope(scope: string | null | undefined): { calendar: boolean; tasks: boolean } {
  return { calendar: escopoConcedido(scope, ESCOPO_CALENDAR), tasks: escopoConcedido(scope, ESCOPO_TASKS) };
}
```

4f. Em `trocarCodigo`, logo depois de `const dados = await pedirAoGoogle(...)` e ANTES do teste de `refresh_token`:

```ts
  const scope = escopoDaCredencial(dados.scope);
  // Consentimento granular: Calendar desmarcado recusa ANTES de gravar e antes
  // de mexer no cache — a credencial anterior, se houver, continua valendo.
  if (!concessoesDoScope(scope).calendar) {
    throw new EscopoNegado("O acesso ao Google Calendar foi desmarcado no consentimento: nada foi gravado.");
  }
```

e no `gravar({...})` trocar `scope: dados.scope ?? SCOPE` por `scope`.

4g. Depois de `estaConectado`:

```ts
/**
 * O que a credencial em disco concede. Sem credencial (ou ilegível): os dois
 * false. A rota lê UMA vez por turno — o scope só muda num callback, e o turno
 * não precisa reler o disco a cada compromisso.
 */
export async function escoposConcedidos(): Promise<{ calendar: boolean; tasks: boolean }> {
  const cred = await ler();
  return cred ? concessoesDoScope(cred.scope) : { calendar: false, tasks: false };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx tsx --test server/auth-store.test.ts server/auth-escopos.test.ts`
Expected: PASS.

- [ ] **Step 6: Verificação completa**

Run: `npx vue-tsc --noEmit` e `npm test`
Expected: sem erros (nenhum outro arquivo usava `SCOPE`).

- [ ] **Step 7: Commit**

```bash
git add server/auth-store.ts server/auth-store.test.ts server/auth-escopos.test.ts
git commit -m "feat(tasks): escopo do Google Tasks por autorização incremental

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: Rotas de autenticação em `server.ts` (status com `tasks`, callback com recusa)

**Files:**
- Modify: `server.ts` (import de `./server/auth-store.ts`; rotas `GET /api/auth/status` e `GET /api/auth/callback`)

**Interfaces:**
- Consumes (Task 3): `escoposConcedidos(): Promise<{ calendar: boolean; tasks: boolean }>`, `class EscopoNegado`.
- Produces (usado pela Task 5): `GET /api/auth/status` → `200 { conectado: boolean, tasks: boolean }`; callback com Calendar negado → `302 /?auth=escopo_calendar_negado`.

- [ ] **Step 1: Import**

No bloco `import { desconectar, ErroDeConfig, estaConectado, ... } from "./server/auth-store.ts";` acrescentar `EscopoNegado` e `escoposConcedidos` (ordem alfabética do bloco).

- [ ] **Step 2: Status**

Substituir o corpo do `try` de `/api/auth/status` por:

```ts
    try {
      const conectado = await estaConectado();
      // `tasks` é estado DEGRADADO, não conexão: credencial só com o Calendar
      // segue conectada e agendando; a UI só oferece "Autorizar Google Tasks".
      const { tasks } = conectado ? await escoposConcedidos() : { tasks: false };
      res.json({ conectado, tasks });
    } catch (error) {
```

- [ ] **Step 3: Callback**

No `catch` de `/api/auth/callback`, antes do `console.error`:

```ts
      // Calendar desmarcado no consentimento granular: nada foi gravado e a
      // credencial anterior continua. Código fixo para a UI dizer isso com
      // clareza, em vez de repetir a mensagem crua na URL.
      if (error instanceof EscopoNegado) return res.redirect("/?auth=escopo_calendar_negado");
```

- [ ] **Step 4: Verificação**

Run: `npx vue-tsc --noEmit` e `npm test`
Expected: sem erros.

Opcional, se o `.env` de dev estiver completo: `npm run dev` em background e `curl -s http://localhost:3000/api/auth/status`
Expected: `{"conectado":true,"tasks":false}` com a credencial atual (só Calendar), ou `{"conectado":false,"tasks":false}` sem credencial. Pare o servidor depois.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(tasks): status diz se o Tasks foi autorizado e callback recusa sem Calendar

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: Frontend da autorização (`src/auth/google.ts`, chip e retorno no `App.vue`, toast com ação)

**Files:**
- Modify: `src/auth/google.ts`
- Modify: `src/App.vue` (imports ~linha 32; `onMounted` ~linhas 84–93; `avisar` ~linha 312; header ~linhas 767–783; toast ~linhas 907–915)

**Interfaces:**
- Consumes (Task 4): `GET /api/auth/status` → `{ conectado, tasks }`; retorno `?auth=escopo_calendar_negado`.
- Produces (usado pela Task 10):
  - `src/auth/google.ts`: `export const tasksLiberado: Ref<boolean>`; `export function ampliarAcesso(): void`.
  - `src/App.vue`: `avisar(texto: string, acao?: AcaoDoToast)` com `interface AcaoDoToast { rotulo: string; fazer: () => void }` declarada no `<script setup>`.

- [ ] **Step 1: `src/auth/google.ts`**

Depois de `export const conectando = ref(false);`:

```ts
/**
 * A credencial tem o escopo do Google Tasks? Estado degradado, não conexão:
 * sem ele o Calendar funciona igual e só os passos não viram checklist.
 */
export const tasksLiberado = ref(false);
```

Em `sincronizarStatus`, depois de `conectado.value = Boolean(dados.conectado);` acrescentar `tasksLiberado.value = Boolean(dados.tasks);` e, no `catch`, `tasksLiberado.value = false;`. Em `desconectar`, depois de `conectado.value = false;`, `tasksLiberado.value = false;`.

Depois de `irParaConsentimento`:

```ts
/**
 * Pede o escopo do Google Tasks: é o MESMO consentimento, agora com os dois
 * escopos. Nunca logout antes — logout revoga o refresh_token no Google e
 * derrubaria o Calendar junto.
 */
export function ampliarAcesso(): void {
  irParaConsentimento();
}
```

- [ ] **Step 2: Imports do `App.vue`**

Na linha que importa de `./auth/google`, acrescentar `ampliarAcesso` e `tasksLiberado`.

- [ ] **Step 3: Toast com ação**

Substituir `const avisar = (texto) => { ... }` por:

```ts
/** Gesto opcional no toast: hoje, "Autorizar Google Tasks". */
interface AcaoDoToast {
  rotulo: string
  fazer: () => void
}
const acaoDoToast = ref<AcaoDoToast | null>(null)

const avisar = (texto: string, acao?: AcaoDoToast) => {
  toast.value = texto
  acaoDoToast.value = acao ?? null
  clearTimeout(toastTimer)
  // Com botão, mais tempo: 4 s mal dão para ler, que dirá decidir clicar.
  toastTimer = window.setTimeout(() => {
    toast.value = ''
    acaoDoToast.value = null
  }, acao ? 10000 : 4000)
}
```

(Se o `vue-tsc` acusar alguma chamada existente de `avisar` com argumento não-string, deixe o parâmetro `texto` sem anotação, como estava.)

No template, trocar o `<div v-if="toast" ...>✨ {{ toast }}</div>` por (mesmas classes, mais `flex flex-col gap-2`):

```html
    <div
      v-if="toast"
      class="fixed bottom-24 right-6 z-50 max-w-sm border-4 border-black bg-[#ffdb58] px-4 py-3 font-black text-sm shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2"
    >
      <span>✨ {{ toast }}</span>
      <button
        v-if="acaoDoToast"
        @click="acaoDoToast.fazer()"
        class="self-start border-2 border-black bg-white px-2 py-1 text-xs uppercase hover:bg-black hover:text-white transition-colors"
      >
        {{ acaoDoToast.rotulo }}
      </button>
    </div>
```

- [ ] **Step 4: Retorno do consentimento**

No `onMounted`, substituir as duas linhas `if (retorno && retorno !== 'ok') ...` / `else if (retorno === 'ok') ...` por:

```ts
  if (retorno === 'escopo_calendar_negado') {
    // O servidor recusou sem gravar: dizer que NADA mudou é o que evita o
    // usuário achar que perdeu a conexão do Calendar.
    avisar(
      'Google: o Calendar foi desmarcado na autorização, então nada mudou e a conexão anterior continua valendo. Para autorizar o Google Tasks, repita marcando as duas caixas.',
      { rotulo: 'Tentar de novo', fazer: ampliarAcesso }
    )
  } else if (retorno && retorno !== 'ok') avisar(`Google: ${retorno}`)
  else if (retorno === 'ok') avisar('Calendário conectado')
```

- [ ] **Step 5: Chip no header**

Logo DEPOIS do `<button v-else @click="desconectarGoogle" ...>📅 Calendário conectado</button>` (fora da cadeia `v-if`/`v-else`, para não quebrá-la):

```html
        <!-- Degradado, não desconectado: o Calendar segue; só os passos não
             viram checklist. Mesmo consentimento, sem logout. -->
        <button
          v-if="conectado && !tasksLiberado"
          @click="ampliarAcesso"
          :disabled="conectando"
          title="Os passos dos compromissos viram checklist no Google Tasks. Não desconecta o Calendar."
          class="border-2 border-black bg-white px-2 py-1 font-black text-[10px] uppercase hover:bg-black hover:text-white transition-colors disabled:opacity-50"
        >
          ✅ Autorizar Google Tasks
        </button>
```

- [ ] **Step 6: Verificação**

Run: `npx vue-tsc --noEmit` e `npm test`
Expected: sem erros.

Run: `npm run build`
Expected: build do Vite e do server sem erro.

- [ ] **Step 7: Commit**

```bash
git add src/auth/google.ts src/App.vue
git commit -m "feat(tasks): chip Autorizar Google Tasks e retorno de Calendar negado

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 6: `tasksListaId` no roster (`server/squad.ts`)

**Files:**
- Modify: `server/squad.ts` (interface `Squad` ~linha 62; `SquadView` ~linha 587; `vistaDaSquad` ~linha 599; nova função perto de `localizarSquad` ~linha 845)
- Test: Create `server/squad.test.ts`

**Interfaces:**
- Consumes: `atualizarRoster`, `localizarSquad`, `readRoster`, `paraVista`, `rosterTree` (já existem); `editarSquad`, `arquivarSquad`, `reativarSquad`, `editarDominio` de `server/ciclo-de-vida.ts` (já existem, só para o teste).
- Produces (usado pela Task 8):
  - `Squad.tasksListaId?: string`
  - `export async function gravarTasksListaId(squadId: string, listaId: string): Promise<boolean>` — `true` gravou; `false` squad não existe (nada muda além de reescrever o arquivo igual).
  - `SquadView` = `Omit<Squad, "dominios" | "tasksListaId"> & {...}` (o campo nunca sai pela API).

Conferência feita ao escrever este plano (o teste abaixo trava): `editarSquad`, `arquivarSquad`, `reativarSquad` e o resto de `ciclo-de-vida.ts`/`hire.ts` MUTAM o objeto lido (`squad.nome = ...`, `marcarArquivado(squad)`, `roster.squads.push`), e `validarV3` devolve o próprio objeto parseado — campos desconhecidos sobrevivem. A migração só converte v1/v2, que nunca tiveram o campo. O único vazamento real é `vistaDaSquad`, que faz `...squad`: por isso ele passa a omitir o campo.

- [ ] **Step 1: Escrever o teste (falha: `gravarTasksListaId` não existe e a vista vaza o campo)**

`server/squad.test.ts`:

```ts
/**
 * `tasksListaId` no roster: gravado pela fila, preservado por toda escrita do
 * ciclo de vida, e fora do prompt e da vista. Roda num diretório temporário:
 * squad.ts fixa o caminho de data/squad.json a partir do cwd NO IMPORT, por
 * isso o chdir vem antes do import dinâmico (cada arquivo de teste roda no seu
 * próprio processo).
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-squad-"));
process.chdir(tmp);
const squad = await import("./squad.ts");
const ciclo = await import("./ciclo-de-vida.ts");

const pessoa = (id: string) => ({ id, nome: id, papel: "PO", escopo: "treino", sprite: "x", hiredAt: "2026-09-01" });
const dominio = (id: string, slot: [number, number]) => ({
  id, nome: id, escopo: "tema", slot, room: "ROOM_SOLO", criadoEm: "2026-09-01", po: pessoa(`po-${id}`), integrantes: [],
});

async function semear(): Promise<void> {
  await fs.mkdir(path.join(tmp, "data"), { recursive: true });
  const roster = {
    version: 3,
    idsAposentados: { pessoas: [], dominios: [] },
    squads: [
      {
        id: "pessoal", nome: "Pessoal", escopo: "vida", calendarId: "primary", unlockOrder: [[0, 0], [1, 0]],
        dominios: [dominio("geral", [0, 0]), dominio("pessoal--saude", [1, 0])],
        tasksListaId: "LISTA-PESSOAL",
      },
      {
        id: "p4f", nome: "Pay4Fun", escopo: "trabalho", calendarId: "primary", unlockOrder: [[0, 0]],
        dominios: [dominio("p4f--dev", [0, 0])],
      },
    ],
  };
  await fs.writeFile(path.join(tmp, "data", "squad.json"), JSON.stringify(roster, null, 2));
}

const listaDe = async (id: string) => squad.localizarSquad(await squad.readRoster(), id)?.tasksListaId;

describe("tasksListaId", () => {
  beforeEach(semear);

  it("gravarTasksListaId grava e a leitura seguinte vê", async () => {
    assert.equal(await squad.gravarTasksListaId("p4f", "LISTA-P4F"), true);
    assert.equal(await listaDe("p4f"), "LISTA-P4F");
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
  });

  it("gravarTasksListaId sobrescreve (lista apagada no Google e recriada)", async () => {
    await squad.gravarTasksListaId("pessoal", "LISTA-NOVA");
    assert.equal(await listaDe("pessoal"), "LISTA-NOVA");
  });

  it("gravarTasksListaId em squad inexistente: false, nada muda", async () => {
    assert.equal(await squad.gravarTasksListaId("nao-existe", "X"), false);
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
  });

  it("editarSquad, editarDominio, arquivarSquad e reativarSquad preservam o campo", async () => {
    await ciclo.editarSquad("pessoal", { nome: "Pessoal Renomeada", escopo: "outra coisa" });
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
    await ciclo.editarDominio("pessoal--saude", { escopo: "saúde e treino" });
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
    await ciclo.arquivarSquad("pessoal");
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
    await ciclo.reativarSquad("pessoal");
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
  });

  it("paraVista não expõe o campo, nem nas ativas nem nas arquivadas", async () => {
    const r1 = await ciclo.arquivarSquad("pessoal");
    assert.equal(JSON.stringify(r1).includes("tasksListaId"), false);
    const r2 = await ciclo.reativarSquad("pessoal");
    assert.equal(JSON.stringify(r2).includes("tasksListaId"), false);
    assert.equal(JSON.stringify(squad.paraVista(await squad.readRoster())).includes("LISTA-PESSOAL"), false);
  });

  it("rosterTree (prompt) não leva o id da lista", async () => {
    const pessoal = squad.localizarSquad(await squad.readRoster(), "pessoal")!;
    assert.equal(squad.rosterTree(pessoal).includes("LISTA-PESSOAL"), false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test server/squad.test.ts`
Expected: FAIL — `squad.gravarTasksListaId is not a function` e o teste da vista acha `tasksListaId`.

- [ ] **Step 3: Implementar**

3a. Na interface `Squad`, depois de `conta?: string;`:

```ts
  /**
   * Id da lista "SquadOne · <nome>" no Google Tasks. Lazy: nasce no primeiro
   * compromisso com passos (passos-no-google.ts) e é sobrescrito quando a lista
   * some no Google. Guardado por id, nunca procurado por título: o usuário
   * renomeia no celular e a busca criaria duplicatas. Fora do prompt e da
   * vista — é detalhe de transporte. Renomear a squad NÃO renomeia a lista (V1).
   */
  tasksListaId?: string;
```

3b. `SquadView`:

```ts
export type SquadView = Omit<Squad, "dominios" | "tasksListaId"> & {
```

3c. `vistaDaSquad`:

```ts
function vistaDaSquad(squad: Squad): SquadView {
  const ativos = dominiosAtivos(squad);
  // Sem o id da lista do Tasks: a vista vai para o browser e ninguém lá usa.
  const { tasksListaId: _lista, ...semLista } = squad;
  return {
    ...semLista,
```

(o resto da função igual).

3d. Depois de `localizarSquad`:

```ts
/**
 * Grava o id da lista do Google Tasks da squad pela fila do roster. Só a
 * GRAVAÇÃO passa pela fila: criar a lista no Google acontece antes, fora dela,
 * porque segurar a fila durante uma chamada de rede travaria todas as escritas
 * do roster. `false` = a squad não existe mais neste volume.
 */
export async function gravarTasksListaId(squadId: string, listaId: string): Promise<boolean> {
  return atualizarRoster((roster) => {
    const alvo = localizarSquad(roster, squadId);
    if (!alvo) return false;
    alvo.tasksListaId = listaId;
    return true;
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test server/squad.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificação completa**

Run: `npx vue-tsc --noEmit` e `npm test`
Expected: sem erros. (Se o `vue-tsc` reclamar de `_lista` não usado, não há `noUnusedLocals` no tsconfig; não deve.)

- [ ] **Step 6: Commit**

```bash
git add server/squad.ts server/squad.test.ts
git commit -m "feat(tasks): id da lista do Google Tasks por squad no roster

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: Chaves do vínculo no Calendar e prova de que o PATCH as preserva

**Files:**
- Modify: `server/calendar.ts` (bloco de constantes das marcas, depois de `PROP_PRAZO_REF` ~linha 33)
- Test: Create `server/calendar.test.ts`

**Interfaces:**
- Consumes: `marcasPreservadas(lido, resposta): boolean`, `atualizarPreservandoMarcas(token: string | ObterToken, calendarId: string, lido: EventoLido, corpo): Promise<EventoLido>`, `EventoLido` (já existem, sem mudança).
- Produces (usado pela Task 8): `export const PROP_TASKS_LISTA = "squadone_tasks_lista"`, `export const PROP_TASKS_PAI = "squadone_tasks_pai"`.

- [ ] **Step 1: Escrever o teste (falha: constantes não existem)**

`server/calendar.test.ts`:

```ts
/**
 * As chaves do vínculo com o Google Tasks começam com `squadone_`, então o
 * PATCH do Ajuste já as protege sem mudança nenhuma. Este teste é a prova:
 * se alguém estreitar o filtro de marcasPreservadas, a checklist perde o
 * vínculo em silêncio. `fetch` é dublê.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  atualizarPreservandoMarcas,
  marcasPreservadas,
  PROP_TASKS_LISTA,
  PROP_TASKS_PAI,
  type EventoLido,
} from "./calendar.ts";

const MARCAS = {
  squadone_squad: "pessoal",
  squadone_dominio: "geral",
  squadone_membro: "po",
  squadone_tipo: "time_blocking",
};
const VINCULO = { [PROP_TASKS_LISTA]: "L1", [PROP_TASKS_PAI]: "T1" };

function lido(privado: Record<string, string>): EventoLido {
  return {
    id: "ev1", etag: '"e1"', summary: "[PO] Revisar", start: { dateTime: "2026-09-15T14:00:00-03:00" },
    end: { dateTime: "2026-09-15T15:00:00-03:00" }, description: "", privado, tipo: "time_blocking",
    dominio: "geral", membro: "po", squad: "pessoal", prazoRef: "", diaInteiro: false,
  };
}

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Cada PATCH responde com o `private` da vez; guarda os corpos enviados. */
function googleResponde(...privados: Record<string, string>[]) {
  const corpos: any[] = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    corpos.push(JSON.parse(init.body));
    const privado = privados[corpos.length - 1];
    return new Response(
      JSON.stringify({ id: "ev1", etag: `"e${corpos.length + 1}"`, summary: "[PO] Revisar", start: {}, end: {}, extendedProperties: { private: privado } }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return corpos;
}

describe("constantes do vínculo", () => {
  it("nomes exatos e prefixo squadone_", () => {
    assert.equal(PROP_TASKS_LISTA, "squadone_tasks_lista");
    assert.equal(PROP_TASKS_PAI, "squadone_tasks_pai");
  });
});

describe("marcasPreservadas com o vínculo", () => {
  it("resposta sem squadone_tasks_pai: não preservou", () => {
    assert.equal(marcasPreservadas({ ...MARCAS, ...VINCULO }, { ...MARCAS, [PROP_TASKS_LISTA]: "L1" }), false);
  });
  it("resposta com tudo: preservou", () => {
    assert.equal(marcasPreservadas({ ...MARCAS, ...VINCULO }, { ...MARCAS, ...VINCULO }), true);
  });
});

describe("atualizarPreservandoMarcas com o vínculo", () => {
  it("gravar o vínculo: o corpo leva as 4 marcas lidas + as 2 chaves novas", async () => {
    const corpos = googleResponde({ ...MARCAS, ...VINCULO });
    const r = await atualizarPreservandoMarcas("tk", "primary", lido(MARCAS), { extendedProperties: { private: VINCULO } });
    assert.deepEqual(corpos[0].extendedProperties.private, { ...MARCAS, ...VINCULO });
    assert.equal(r.privado[PROP_TASKS_PAI], "T1");
    assert.equal(corpos.length, 1);
  });

  it("ajuste de duração: o corpo reenvia o vínculo lido", async () => {
    const corpos = googleResponde({ ...MARCAS, ...VINCULO });
    await atualizarPreservandoMarcas("tk", "primary", lido({ ...MARCAS, ...VINCULO }), {
      end: { dateTime: "2026-09-15T15:30:00-03:00" },
    });
    assert.deepEqual(corpos[0].extendedProperties.private, { ...MARCAS, ...VINCULO });
  });

  it("Google devolve sem o vínculo: restaura uma vez com o private completo", async () => {
    const corpos = googleResponde({ ...MARCAS }, { ...MARCAS, ...VINCULO });
    const r = await atualizarPreservandoMarcas("tk", "primary", lido({ ...MARCAS, ...VINCULO }), {
      end: { dateTime: "2026-09-15T15:30:00-03:00" },
    });
    assert.equal(corpos.length, 2);
    assert.deepEqual(corpos[1], { extendedProperties: { private: { ...MARCAS, ...VINCULO } } });
    assert.equal(r.privado[PROP_TASKS_LISTA], "L1");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test server/calendar.test.ts`
Expected: FAIL — `PROP_TASKS_LISTA` não exportado.

- [ ] **Step 3: Implementar em `server/calendar.ts`**

Depois de `export const PROP_PRAZO_REF = "squadone_prazo_ref";`:

```ts
/**
 * Vínculo com o Google Tasks (passos de um compromisso), só no evento
 * PRINCIPAL — o foco, ou o marco de um prazo; blocos não levam. O Tasks não
 * tem extendedProperties e `links` lá é somente leitura, então a ponta
 * AUTORITATIVA do vínculo mora aqui:
 * - `squadone_tasks_lista`: id da lista da squad no Tasks;
 * - `squadone_tasks_pai`: id da tarefa-mãe.
 * Não entram em `marcasDoEvento`: só existem depois de as tarefas nascerem, e
 * chegam por PATCH (atualizarPreservandoMarcas). O prefixo `squadone_` é o que
 * faz o PATCH do Ajuste preservá-las sem mudança (calendar.test.ts trava).
 * `QuestCalendario`/`EventoLido` não as leem na V1: a Mochila não usa.
 */
export const PROP_TASKS_LISTA = "squadone_tasks_lista";
export const PROP_TASKS_PAI = "squadone_tasks_pai";
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test server/calendar.test.ts`
Expected: PASS (as funções de PATCH não mudaram: o teste prova o comportamento existente).

- [ ] **Step 5: Verificação completa**

Run: `npx vue-tsc --noEmit` e `npm test`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add server/calendar.ts server/calendar.test.ts
git commit -m "feat(tasks): chaves do vínculo com o Tasks no evento principal

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 8: Fluxo dos passos no Google (`server/passos-no-google.ts`) e tipos de aviso

**Files:**
- Create: `server/passos-no-google.ts`
- Modify: `server/agendamento.ts` (só tipos: `EventoCriado` ~linha 26, `AvisoDoCompromisso` ~linha 50)
- Modify: `server/orchestrator.ts` (só tipos: `AvisoTarefa` ~linha 31, novo `MotivoDeAviso` junto de `MotivoDeErro` ~linha 28)
- Test: Create `server/passos-no-google.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `dueDaTarefa(evento, fuso): string`, `notasDaTarefaMae(htmlLink, eventId): string`, `tituloDaLista(nome): string`.
  - Task 2: `comTokenTasks`, `ErroTasks` (getters `ehCredencial`, `escopoInsuficiente`, `apiDesligada`), `ListaSumiu`, `inserirLista`, `lerLista`, `inserirTarefa`, `CorpoDeTarefa`; `comToken`, `ObterToken` de `calendar.ts`.
  - Task 3: `PrecisaConectar` (já existia em `auth-store.ts`).
  - Task 6: `gravarTasksListaId(squadId, listaId): Promise<boolean>`, `Squad.tasksListaId`.
  - Task 7: `PROP_TASKS_LISTA`, `PROP_TASKS_PAI`.
  - Existentes: `lerEvento(token, calendarId, eventId): Promise<EventoLido>`, `atualizarPreservandoMarcas(token | ObterToken, calendarId, lido, corpo): Promise<EventoLido>`, `ErroCalendario`, `readRoster`, `localizarSquad`, `CompromissoAgendado`, `EventoCriado`.
- Produces (usado pela Task 9):
  - `server/agendamento.ts`: `AvisoDoCompromisso.motivo?: "precisaConectar" | "ampliarAcesso"`; `EventoCriado.passos?: number`.
  - `server/orchestrator.ts`: `export type MotivoDeAviso = MotivoDeErro | "ampliarAcesso"`; `AvisoTarefa.motivo?: MotivoDeAviso`.
  - `server/passos-no-google.ts`:
    - `export interface DependenciasDosPassos { lerRoster; gravarListaId; inserirLista; lerLista; inserirTarefa; lerEvento; atualizarPreservandoMarcas }` (assinaturas no código abaixo)
    - `export interface PedidoDePassos { compromisso: CompromissoAgendado; squad: Squad; passos: string[]; obterToken: ObterToken; liberado: boolean; fuso: string }`
    - `export interface ResultadoDosPassos { criados: number; avisos: AvisoDoCompromisso[]; listaId?: string; tarefaMaeId?: string }`
    - `export const AVISO_SEM_ESCOPO = "Passos não criados: falta autorizar o Google Tasks."`
    - `export function motivoDoErroTasks(err: unknown): AvisoDoCompromisso["motivo"]`
    - `export function criarPassosNoGoogle(dep: DependenciasDosPassos): { garantirListaDaSquad(squad: Squad, obterToken: ObterToken): Promise<string>; criarPassosDoCompromisso(p: PedidoDePassos): Promise<ResultadoDosPassos> }`
    - `export const passosNoGoogle` = instância com as dependências reais. **Nunca lança** em `criarPassosDoCompromisso`: toda falha vira aviso.

- [ ] **Step 1: Tipos em `server/agendamento.ts`**

Em `EventoCriado`, depois de `htmlLink?: string;`:

```ts
  /**
   * Subtarefas criadas no Google Tasks, só no evento PRINCIPAL e só quando > 0.
   * Quem preenche é o handler de agendar_evento (capabilities.ts): este módulo
   * não sabe que o Tasks existe, assim como não sabe do push.
   */
  passos?: number;
```

Em `AvisoDoCompromisso`, trocar `motivo?: "precisaConectar";` por:

```ts
  /** `ampliarAcesso`: passos não criados por falta do escopo do Google Tasks — o Calendar segue ok. */
  motivo?: "precisaConectar" | "ampliarAcesso";
```

- [ ] **Step 2: Tipos em `server/orchestrator.ts`**

Depois de `export type MotivoDeErro = ...;`:

```ts
/**
 * Gesto de um AVISO. `ampliarAcesso` só existe aqui, não em `MotivoDeErro`:
 * falta do escopo do Tasks nunca falha um compromisso, só deixa os passos de fora.
 */
export type MotivoDeAviso = MotivoDeErro | "ampliarAcesso";
```

e em `AvisoTarefa` trocar `motivo?: MotivoDeErro;` por `motivo?: MotivoDeAviso;`.

- [ ] **Step 3: Escrever os testes (falham: módulo inexistente)**

`server/passos-no-google.test.ts`:

```ts
/**
 * Fluxo dos passos (D6 do spec): ordem das chamadas, single-flight da lista,
 * lista apagada, e cada falha virando aviso sem derrubar o compromisso.
 * Dependências são dublês — nada toca o Google nem o disco.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrecisaConectar } from "./auth-store.ts";
import type { CompromissoAgendado, EventoCriado } from "./agendamento.ts";
import { ErroCalendario, PROP_TASKS_LISTA, PROP_TASKS_PAI, type EventoLido } from "./calendar.ts";
import {
  AVISO_SEM_ESCOPO,
  criarPassosNoGoogle,
  type DependenciasDosPassos,
  type PedidoDePassos,
} from "./passos-no-google.ts";
import type { Roster, Squad } from "./squad.ts";
import { ErroTasks, ListaSumiu, type CorpoDeTarefa } from "./tasks.ts";

const FUSO = "America/Sao_Paulo";
const ESCOPO_403 = JSON.stringify({ error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } });
const DESLIGADA_403 = JSON.stringify({ error: { code: 403, message: "Google Tasks API has not been used in project 123 before or it is disabled.", errors: [{ reason: "accessNotConfigured" }] } });
const INVALIDA_401 = JSON.stringify({ error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } });

const pessoa = { id: "po", nome: "Ana", papel: "PO", escopo: "", sprite: "x", hiredAt: "2026-09-01" };
function squadCom(tasksListaId?: string): Squad {
  return {
    id: "pessoal", nome: "Pessoal", escopo: "", calendarId: "primary", unlockOrder: [[0, 0]],
    dominios: [{ id: "geral", nome: "Geral", escopo: "", slot: [0, 0], room: "r", criadoEm: "2026-09-01", po: pessoa, integrantes: [] }],
    ...(tasksListaId ? { tasksListaId } : {}),
  };
}
const rosterCom = (tasksListaId?: string): Roster => ({
  version: 3, idsAposentados: { pessoas: [], dominios: [] }, squads: [squadCom(tasksListaId)],
});

function compromisso(evento: Partial<EventoCriado> = {}): CompromissoAgendado {
  const principal: EventoCriado = {
    kind: "evento", titulo: "Preparar apresentação", responsavel_id: "po", tipo: "time_blocking", dominio: "geral",
    inicio: "2026-09-18T22:30:00-03:00", fim: "2026-09-18T23:30:00-03:00", dia_inteiro: false, papel: "foco",
    eventId: "ev1", htmlLink: "https://www.google.com/calendar/event?eid=ev1", ...evento,
  };
  return { kind: "compromisso", titulo: principal.titulo, responsavel_id: "po", tipo: principal.tipo, dominio: "geral", eventos: [principal], avisos: [], faltou_min: 0 };
}

function eventoLido(id: string): EventoLido {
  return {
    id, etag: '"e1"', summary: "x", start: {}, end: {}, description: "", privado: { squadone_dominio: "geral" },
    tipo: "time_blocking", dominio: "geral", membro: "po", squad: "pessoal", prazoRef: "", diaInteiro: false,
  };
}

function montar(sobre: Partial<DependenciasDosPassos> = {}, listaInicial?: string) {
  const log: string[] = [];
  const tarefas: { listaId: string; corpo: CorpoDeTarefa; posicao?: { parent?: string; previous?: string } }[] = [];
  const patches: { eventId: string; corpo: any }[] = [];
  let roster = rosterCom(listaInicial);
  let seqLista = 0;
  const dep: DependenciasDosPassos = {
    lerRoster: async () => roster,
    gravarListaId: async (squadId, listaId) => {
      log.push(`gravar:${squadId}:${listaId}`);
      roster = rosterCom(listaId);
      return true;
    },
    inserirLista: async (_t, titulo) => {
      log.push(`inserirLista:${titulo}`);
      return { id: `L${++seqLista}` };
    },
    lerLista: async (_t, id) => {
      log.push(`lerLista:${id}`);
      return { id };
    },
    inserirTarefa: async (_t, listaId, corpo, posicao) => {
      tarefas.push({ listaId, corpo, posicao });
      return { id: `T${tarefas.length}` };
    },
    lerEvento: async (_t, _cal, eventId) => eventoLido(eventId),
    atualizarPreservandoMarcas: async (_o, _cal, lido, corpo) => {
      patches.push({ eventId: lido.id, corpo });
      return lido;
    },
    ...sobre,
  };
  return { fluxo: criarPassosNoGoogle(dep), log, tarefas, patches };
}

const pedido = (p: Partial<PedidoDePassos> = {}): PedidoDePassos => ({
  compromisso: compromisso(), squad: squadCom(), passos: ["Montar slides", "Revisar dados", "Ensaiar"],
  obterToken: async () => "tk", liberado: true, fuso: FUSO, ...p,
});

describe("criarPassosDoCompromisso", () => {
  it("sem passos: nada acontece", async () => {
    const { fluxo, log, tarefas } = montar();
    assert.deepEqual(await fluxo.criarPassosDoCompromisso(pedido({ passos: [] })), { criados: 0, avisos: [] });
    assert.deepEqual([log, tarefas], [[], []]);
  });

  it("sem escopo: aviso ampliarAcesso e ZERO chamadas (nem token)", async () => {
    let pediuToken = false;
    const { fluxo, log, tarefas } = montar();
    const r = await fluxo.criarPassosDoCompromisso(pedido({ liberado: false, obterToken: async () => { pediuToken = true; return "tk"; } }));
    assert.deepEqual(r, { criados: 0, avisos: [{ aviso: AVISO_SEM_ESCOPO, motivo: "ampliarAcesso" }] });
    assert.deepEqual([log, tarefas, pediuToken], [[], [], false]);
  });

  it("squad sem lista: cria lista, grava id, mãe com due local, subtarefas em ordem com previous, PATCH do vínculo", async () => {
    const { fluxo, log, tarefas, patches } = montar();
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.deepEqual(log, ["inserirLista:SquadOne · Pessoal", "gravar:pessoal:L1"]);
    assert.deepEqual(tarefas[0], {
      listaId: "L1",
      corpo: {
        title: "Preparar apresentação",
        notes: "https://www.google.com/calendar/event?eid=ev1\nsquadone_evento=ev1",
        // 22:30 em SP é 01:30 UTC do dia 19: o due tem que ficar no dia 18.
        due: "2026-09-18T00:00:00.000Z",
      },
      posicao: undefined,
    });
    assert.deepEqual(tarefas.slice(1).map((t) => [t.corpo, t.posicao]), [
      [{ title: "Montar slides" }, { parent: "T1", previous: undefined }],
      [{ title: "Revisar dados" }, { parent: "T1", previous: "T2" }],
      [{ title: "Ensaiar" }, { parent: "T1", previous: "T3" }],
    ]);
    assert.deepEqual(patches, [{ eventId: "ev1", corpo: { extendedProperties: { private: { [PROP_TASKS_LISTA]: "L1", [PROP_TASKS_PAI]: "T1" } } } }]);
    assert.deepEqual(r, { criados: 3, avisos: [], listaId: "L1", tarefaMaeId: "T1" });
  });

  it("marco com hora: due é o dia do prazo (fim)", async () => {
    const { fluxo, tarefas } = montar();
    await fluxo.criarPassosDoCompromisso(pedido({
      compromisso: compromisso({ papel: "marco", tipo: "deadline", inicio: "2026-09-17T23:50:00-03:00", fim: "2026-09-18T00:05:00-03:00" }),
    }));
    assert.equal(tarefas[0].corpo.due, "2026-09-18T00:00:00.000Z");
  });

  it("lista gravada que existe: confere e usa, sem criar nem gravar", async () => {
    const { fluxo, log, tarefas } = montar({}, "L-EXISTE");
    await fluxo.criarPassosDoCompromisso(pedido({ squad: squadCom("L-EXISTE") }));
    assert.deepEqual(log, ["lerLista:L-EXISTE"]);
    assert.equal(tarefas[0].listaId, "L-EXISTE");
  });

  it("lista gravada apagada no Google: cria outra e sobrescreve o id", async () => {
    const { fluxo, log, tarefas } = montar({
      lerLista: async (_t, id) => {
        throw new ListaSumiu(id);
      },
    }, "L-VELHA");
    const r = await fluxo.criarPassosDoCompromisso(pedido({ squad: squadCom("L-VELHA") }));
    assert.deepEqual(log, ["inserirLista:SquadOne · Pessoal", "gravar:pessoal:L1"]);
    assert.equal(tarefas[0].listaId, "L1");
    assert.equal(r.criados, 3);
  });

  it("single-flight: dois compromissos em paralelo numa squad sem lista criam UMA lista", async () => {
    let soltar!: () => void;
    const segura = new Promise<void>((r) => (soltar = r));
    let criadas = 0;
    const { fluxo, tarefas } = montar({
      inserirLista: async () => {
        criadas++;
        await segura;
        return { id: "L-UNICA" };
      },
    });
    const a = fluxo.criarPassosDoCompromisso(pedido());
    const b = fluxo.criarPassosDoCompromisso(pedido({ compromisso: compromisso({ eventId: "ev2" }) }));
    await new Promise((r) => setImmediate(r));
    soltar();
    await Promise.all([a, b]);
    assert.equal(criadas, 1);
    assert.equal(new Set(tarefas.map((t) => t.listaId)).size, 1);
  });

  it("403 de escopo antes da mãe: aviso ampliarAcesso, nenhuma tarefa nem PATCH", async () => {
    const { fluxo, tarefas, patches } = montar({
      inserirLista: async () => {
        throw new ErroTasks(403, ESCOPO_403);
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.criados, 0);
    assert.equal(r.avisos.length, 1);
    assert.equal(r.avisos[0].motivo, "ampliarAcesso");
    assert.deepEqual([tarefas, patches], [[], []]);
  });

  it("API desligada: aviso SEM motivo, com a mensagem do Google", async () => {
    const { fluxo } = montar({
      inserirLista: async () => {
        throw new ErroTasks(403, DESLIGADA_403);
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.avisos[0].motivo, undefined);
    assert.match(r.avisos[0].aviso, /has not been used in project 123/);
  });

  it("401 persistente (mesmo token): aviso precisaConectar", async () => {
    const { fluxo } = montar({
      inserirLista: async () => {
        throw new ErroTasks(401, INVALIDA_401);
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.avisos[0].motivo, "precisaConectar");
  });

  it("sem credencial ao pedir o token: aviso precisaConectar", async () => {
    const { fluxo } = montar();
    const r = await fluxo.criarPassosDoCompromisso(pedido({
      obterToken: async () => {
        throw new PrecisaConectar("Nenhuma credencial do Google guardada.");
      },
    }));
    assert.equal(r.criados, 0);
    assert.equal(r.avisos[0].motivo, "precisaConectar");
  });

  it("2ª subtarefa falha: para a série, não apaga nada, avisa quantas faltaram e ainda grava o vínculo", async () => {
    let n = 0;
    const { fluxo, patches } = montar({
      inserirTarefa: async (_t, _l, corpo) => {
        n++;
        if (corpo.title === "Revisar dados") throw new Error("rede caiu");
        return { id: `T${n}` };
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(n, 3, "mãe + 1ª + 2ª (que falhou); a 3ª não é tentada");
    assert.equal(r.criados, 1);
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0].aviso, /^2 de 3 passo\(s\) não criado\(s\) no Google Tasks/);
    assert.equal(patches.length, 1);
  });

  it("PATCH do vínculo falha: passos ficam, aviso do vínculo", async () => {
    const { fluxo } = montar({
      atualizarPreservandoMarcas: async () => {
        throw new ErroCalendario(500, "{}");
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.criados, 3);
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0].aviso, /^Passos criados no Google Tasks, mas o vínculo no evento não foi gravado/);
  });

  it("gravar o id da lista falha: segue com a lista criada (só loga)", async () => {
    const { fluxo, tarefas } = montar({
      gravarListaId: async () => {
        throw new Error("disco cheio");
      },
    });
    const r = await fluxo.criarPassosDoCompromisso(pedido());
    assert.equal(r.criados, 3);
    assert.equal(tarefas[0].listaId, "L1");
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx tsx --test server/passos-no-google.test.ts`
Expected: FAIL — `Cannot find module './passos-no-google.ts'`.

- [ ] **Step 5: Implementar `server/passos-no-google.ts`**

```ts
import { PrecisaConectar } from "./auth-store.ts";
import type { AvisoDoCompromisso, CompromissoAgendado } from "./agendamento.ts";
import {
  atualizarPreservandoMarcas,
  comToken,
  ErroCalendario,
  lerEvento,
  PROP_TASKS_LISTA,
  PROP_TASKS_PAI,
  type EventoLido,
  type ObterToken,
} from "./calendar.ts";
import { dueDaTarefa, notasDaTarefaMae, tituloDaLista } from "./passos.ts";
import { gravarTasksListaId, localizarSquad, readRoster, type Roster, type Squad } from "./squad.ts";
import {
  comTokenTasks,
  ErroTasks,
  inserirLista,
  inserirTarefa,
  lerLista,
  ListaSumiu,
  type CorpoDeTarefa,
} from "./tasks.ts";

/**
 * Passos de um compromisso viram tarefa-mãe + subtarefas no Google Tasks,
 * ligadas ao evento principal. Roda DEPOIS de os eventos existirem, e nada
 * aqui desfaz ou falha o compromisso: os eventos já estão certos no Google, e
 * a checklist é acessório. Toda falha volta como aviso classificado.
 *
 * Só capabilities.ts importa isto. agendamento.ts não sabe que o Tasks existe.
 * Escrita única: nada reescreve as tarefas depois (o Ajuste não mexe no `due`,
 * apagar o evento deixa as tarefas órfãs, a vigia não sabe do Tasks).
 */

export interface DependenciasDosPassos {
  lerRoster: () => Promise<Roster>;
  gravarListaId: (squadId: string, listaId: string) => Promise<boolean>;
  inserirLista: (token: string, titulo: string) => Promise<{ id: string }>;
  lerLista: (token: string, listaId: string) => Promise<{ id: string }>;
  inserirTarefa: (
    token: string,
    listaId: string,
    corpo: CorpoDeTarefa,
    posicao?: { parent?: string; previous?: string },
  ) => Promise<{ id: string }>;
  lerEvento: (token: string, calendarId: string, eventId: string) => Promise<EventoLido>;
  atualizarPreservandoMarcas: (
    obter: ObterToken,
    calendarId: string,
    lido: EventoLido,
    corpo: { extendedProperties: { private: Record<string, string> } },
  ) => Promise<EventoLido>;
}

export interface PedidoDePassos {
  compromisso: CompromissoAgendado;
  /** A squad ATIVA do turno: a lista é dela (no redirecionamento, a de destino). */
  squad: Squad;
  /** Já normalizados (`normalizarPassos`). */
  passos: string[];
  obterToken: ObterToken;
  /** A credencial tem o escopo do Tasks? Lido uma vez pela rota. */
  liberado: boolean;
  fuso: string;
}

export interface ResultadoDosPassos {
  /** Subtarefas criadas (a mãe não conta). */
  criados: number;
  avisos: AvisoDoCompromisso[];
  listaId?: string;
  tarefaMaeId?: string;
}

export const AVISO_SEM_ESCOPO = "Passos não criados: falta autorizar o Google Tasks.";

/**
 * Gesto de uma falha do Tasks. Escopo insuficiente é AMPLIAR, não reconectar:
 * o Calendar acabou de funcionar neste mesmo compromisso. Só 401 que persistiu
 * com token novo (ou credencial ausente) é `precisaConectar`. API desligada no
 * projeto não tem gesto: a mensagem do Google diz o que fazer.
 */
export function motivoDoErroTasks(err: unknown): AvisoDoCompromisso["motivo"] {
  if (err instanceof ErroTasks && err.escopoInsuficiente) return "ampliarAcesso";
  if ((err instanceof ErroTasks && err.ehCredencial) || err instanceof PrecisaConectar) return "precisaConectar";
  return undefined;
}

const mensagem = (err: unknown) => (err as Error)?.message ?? String(err);

function aviso(texto: string, motivo: AvisoDoCompromisso["motivo"]): AvisoDoCompromisso {
  return motivo ? { aviso: texto, motivo } : { aviso: texto };
}

export function criarPassosNoGoogle(dep: DependenciasDosPassos) {
  /**
   * Single-flight por squad. Processo único, então memória basta: dois turnos
   * com passos na mesma squad sem lista criariam duas listas iguais no celular.
   */
  const emCriacao = new Map<string, Promise<string>>();

  /**
   * Id da lista da squad, criando se preciso. A chamada ao Google fica FORA da
   * fila do roster (segurar a fila durante rede travaria todas as escritas);
   * só a gravação do id entra nela. Id gravado que sumiu no Google (404/410):
   * cria outra e sobrescreve, uma vez só por chamada.
   */
  function garantirListaDaSquad(squad: Squad, obterToken: ObterToken): Promise<string> {
    const emCurso = emCriacao.get(squad.id);
    if (emCurso) return emCurso;
    const promessa = (async () => {
      // Relê: o `squad` do turno foi lido no começo, e outro turno pode ter
      // gravado a lista depois.
      const atual = localizarSquad(await dep.lerRoster(), squad.id) ?? squad;
      const gravada = atual.tasksListaId;
      if (gravada) {
        try {
          await comTokenTasks(obterToken, (t) => dep.lerLista(t, gravada));
          return gravada;
        } catch (err) {
          if (!(err instanceof ListaSumiu)) throw err;
        }
      }
      const lista = await comTokenTasks(obterToken, (t) => dep.inserirLista(t, tituloDaLista(atual.nome)));
      try {
        await dep.gravarListaId(squad.id, lista.id);
      } catch (err) {
        // A lista existe e serve para ESTE compromisso. Sem o id gravado o
        // próximo turno cria outra — custo aceito contra perder os passos agora.
        console.error(`[tasks] lista '${lista.id}' criada, mas o id não foi gravado no roster:`, err);
      }
      return lista.id;
    })().finally(() => emCriacao.delete(squad.id));
    emCriacao.set(squad.id, promessa);
    return promessa;
  }

  async function criarPassosDoCompromisso(p: PedidoDePassos): Promise<ResultadoDosPassos> {
    const principal = p.compromisso.eventos[0];
    if (p.passos.length === 0 || !principal) return { criados: 0, avisos: [] };
    // Sem o escopo nem tenta: o 403 seria certo, e cada chamada inútil custa
    // tempo dentro da série de agendamentos do turno.
    if (!p.liberado) return { criados: 0, avisos: [aviso(AVISO_SEM_ESCOPO, "ampliarAcesso")] };

    let listaId: string;
    let maeId: string;
    try {
      listaId = await garantirListaDaSquad(p.squad, p.obterToken);
      const mae = await comTokenTasks(p.obterToken, (t) =>
        dep.inserirTarefa(t, listaId, {
          title: p.compromisso.titulo,
          notes: notasDaTarefaMae(principal.htmlLink, principal.eventId),
          due: dueDaTarefa(principal, p.fuso),
        }),
      );
      maeId = mae.id;
    } catch (err) {
      return {
        criados: 0,
        avisos: [aviso(`Passos não criados no Google Tasks: ${mensagem(err)}`, motivoDoErroTasks(err))],
      };
    }

    const avisos: AvisoDoCompromisso[] = [];
    let criados = 0;
    let anterior: string | undefined;
    for (let i = 0; i < p.passos.length; i++) {
      try {
        // Sem `due`: com data, cada subtarefa viraria um chip no Google Calendar.
        // `previous` mantém a ordem da demanda (sem ele, cada uma iria ao topo).
        const sub = await comTokenTasks(p.obterToken, (t) =>
          dep.inserirTarefa(t, listaId, { title: p.passos[i] }, { parent: maeId, previous: anterior }),
        );
        anterior = sub.id;
        criados++;
      } catch (err) {
        // Para a série como os blocos de prazo: não apaga nada, não abre buraco
        // no meio da checklist.
        const faltaram = p.passos.length - i;
        avisos.push(
          aviso(
            `${faltaram} de ${p.passos.length} passo(s) não criado(s) no Google Tasks: ${mensagem(err)}`,
            motivoDoErroTasks(err),
          ),
        );
        break;
      }
    }

    try {
      const lido = await comToken(p.obterToken, (t) => dep.lerEvento(t, p.squad.calendarId, principal.eventId));
      await dep.atualizarPreservandoMarcas(p.obterToken, p.squad.calendarId, lido, {
        extendedProperties: { private: { [PROP_TASKS_LISTA]: listaId, [PROP_TASKS_PAI]: maeId } },
      });
    } catch (err) {
      // As tarefas ficam, com o vínculo só nas notas da mãe.
      avisos.push(
        aviso(
          `Passos criados no Google Tasks, mas o vínculo no evento não foi gravado: ${mensagem(err)}`,
          err instanceof ErroCalendario && err.ehCredencial ? "precisaConectar" : undefined,
        ),
      );
    }

    return { criados, avisos, listaId, tarefaMaeId: maeId };
  }

  return { garantirListaDaSquad, criarPassosDoCompromisso };
}

/** A instância do servidor: um Map de single-flight para o processo inteiro. */
export const passosNoGoogle = criarPassosNoGoogle({
  lerRoster: readRoster,
  gravarListaId: gravarTasksListaId,
  inserirLista,
  lerLista,
  inserirTarefa,
  lerEvento,
  atualizarPreservandoMarcas,
});
```

Notas para o implementador:
- `comTokenTasks` já faz o retry de 401; o dublê de `obterToken` do teste devolve sempre `"tk"`, então 401 persiste e vira `precisaConectar` (caso de teste).
- No caso "gravar o id da lista falha" o `console.error` aparece na saída do teste; é esperado.
- Se o `vue-tsc` recusar `atualizarPreservandoMarcas` (real) como `DependenciasDosPassos["atualizarPreservandoMarcas"]`, envolva: `atualizarPreservandoMarcas: (obter, cal, lido, corpo) => atualizarPreservandoMarcas(obter, cal, lido, corpo)`.

- [ ] **Step 6: Rodar e ver passar**

Run: `npx tsx --test server/passos-no-google.test.ts`
Expected: PASS.

- [ ] **Step 7: Verificação completa**

Run: `npx vue-tsc --noEmit` e `npm test`
Expected: sem erros. Confirme que `server/agendamento.ts` continua sem nenhum import de `tasks.ts`, `passos.ts` ou `passos-no-google.ts`: `grep -n "tasks\|passos" server/agendamento.ts` só pode achar o comentário/campo `passos?: number` e o motivo `ampliarAcesso`.

- [ ] **Step 8: Commit**

```bash
git add server/passos-no-google.ts server/passos-no-google.test.ts server/agendamento.ts server/orchestrator.ts
git commit -m "feat(tasks): lista por squad e checklist do compromisso no Google Tasks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 9: Ligar os passos ao turno (`capabilities.ts`, `orchestrator.ts`, rota `/api/orquestrar`)

**Files:**
- Modify: `server/capabilities.ts` (imports; `CapabilityContext` ~linha 58; declaração de `agendar_evento` ~linha 206; handler ~linha 219)
- Modify: `server/orchestrator.ts` (imports; `buildSystemInstruction` ~linha 204; `PedidoDeTurno` ~linha 316; `rodarTurno` ~linha 378)
- Modify: `server.ts` (rota `POST /api/orquestrar` ~linha 357)
- Test: Create `server/prompt-passos.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `normalizarPassos(valor: unknown): { passos: string[]; cortados: number }`, `MAX_PASSOS`.
  - Task 3: `escoposConcedidos(): Promise<{ calendar: boolean; tasks: boolean }>`, `tokenValido` (existente), `PrecisaConectar` (existente).
  - Task 8: `passosNoGoogle.criarPassosDoCompromisso(p: PedidoDePassos): Promise<ResultadoDosPassos>` (nunca lança; o `try` do handler é só defesa), `EventoCriado.passos?: number`.
  - `ObterToken` de `server/calendar.ts`; `ctx.agenda.janela.fuso` (existente em `Janela`).
- Produces:
  - `CapabilityContext.tasks: { liberado: boolean; obterToken: ObterToken }`
  - `PedidoDeTurno.tasksLiberado?: boolean` (ausente = `false`), `PedidoDeTurno.obterToken?: ObterToken` (ausente = devolve o `token` do turno ou lança `PrecisaConectar`)
  - `agendar_evento.parameters.properties.passos` (ARRAY de STRING, fora de `required`)

- [ ] **Step 1: Escrever o teste do prompt e da declaração (falha)**

`server/prompt-passos.test.ts`:

```ts
/**
 * A regra dos passos entra no prompt nos três modos (o toggle é sobre o tipo
 * do compromisso, não sobre ter passos), logo depois da nota_de_execucao, e o
 * campo existe na declaração sem ser obrigatório.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Type } from "@google/genai";
import { CAPABILITIES } from "./capabilities.ts";
import { buildSystemInstruction } from "./orchestrator.ts";

const CONTEXTO = {
  squadNome: "Pessoal",
  squadEscopo: "vida pessoal",
  arvore: "- domínio 'geral' — Geral (escopo: tudo)",
  outrasSquads: "(nenhuma)",
  janela: "09:00–19:00, seg–sex",
};

describe("regra de passos no prompt", () => {
  for (const modo of ["auto", "foco", "baixa_prioridade"] as const) {
    it(`modo ${modo}: presente, depois da nota_de_execucao e antes do crescimento`, () => {
      const p = buildSystemInstruction(CONTEXTO, "2026-09-14T12:00:00-03:00", modo);
      const passos = p.indexOf("- passos: mande SÓ quando");
      assert.ok(passos > p.indexOf("- nota_de_execucao:"), "depois da nota");
      assert.ok(passos < p.indexOf("- Crescimento tem dois níveis"), "antes do crescimento");
      assert.match(p, /Pedido de checklist sem\s+compromisso: chame agendar_evento com os passos/);
      assert.match(p, /Entre 2 e 8 itens/);
    });
  }
});

describe("declaração de agendar_evento", () => {
  it("passos é ARRAY de STRING e opcional", () => {
    const params = CAPABILITIES.agendar_evento.declaration.parameters!;
    const passos = params.properties!.passos!;
    assert.equal(passos.type, Type.ARRAY);
    assert.equal(passos.items!.type, Type.STRING);
    assert.equal(params.required!.includes("passos"), false);
  });
});
```

Run: `npx tsx --test server/prompt-passos.test.ts`
Expected: FAIL — índice de "- passos:" é -1 e `properties.passos` é `undefined`.

- [ ] **Step 2: `server/capabilities.ts` — imports e contexto**

Imports novos:

```ts
import type { ObterToken } from "./calendar.ts";
import { MAX_PASSOS, normalizarPassos } from "./passos.ts";
import { passosNoGoogle } from "./passos-no-google.ts";
```

Em `CapabilityContext`, depois de `agenda: AgendaDoTurno;`:

```ts
  /**
   * Google Tasks neste turno. `liberado` = a credencial tem o escopo, lido UMA
   * vez pela rota (sem escopo, os passos nem chamam o Google). `obterToken` pede
   * o token de novo antes de cada chamada, como no Ajuste: o retry de 401
   * precisa de um token novo, e o `token` do contexto é fixo do começo do turno.
   */
  tasks: { liberado: boolean; obterToken: ObterToken };
```

- [ ] **Step 3: Declaração**

Em `agendar_evento.parameters.properties`, depois de `nota_de_execucao`:

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

`required` continua `["titulo", "responsavel_id", "tipo"]`.

- [ ] **Step 4: Handler**

Substituir o final do handler (`const compromisso = await agendarCompromisso({...}); return compromisso;`) mantendo a chamada igual e acrescentando, entre ela e o `return`:

```ts
    // Passos DEPOIS dos eventos: a tarefa-mãe aponta para o evento principal, e
    // o modelo não recebe eventId de volta (turno one-shot) — por isso é campo
    // daqui e não capacidade separada. Normalizado no servidor: o prompt pede
    // 2–8 itens, mas prompt é pedido, não garantia.
    const { passos, cortados } = normalizarPassos(args.passos);
    if (passos.length === 0) return compromisso;
    try {
      const r = await passosNoGoogle.criarPassosDoCompromisso({
        compromisso,
        squad: ctx.squad,
        passos,
        obterToken: ctx.tasks.obterToken,
        liberado: ctx.tasks.liberado,
        fuso: ctx.agenda.janela.fuso,
      });
      if (r.criados > 0) compromisso.eventos[0].passos = r.criados;
      compromisso.avisos.push(...r.avisos);
      if (cortados > 0 && r.tarefaMaeId) {
        compromisso.avisos.push({
          aviso: `${cortados} passo(s) além do limite de ${MAX_PASSOS} ficaram de fora do Google Tasks.`,
        });
      }
    } catch (err: any) {
      // criarPassosDoCompromisso não lança; se lançar, é bug nosso — e ainda
      // assim não pode apagar um compromisso que já está certo no Google.
      compromisso.avisos.push({ aviso: `Passos não criados no Google Tasks: ${err?.message ?? String(err)}` });
    }
    return compromisso;
```

- [ ] **Step 5: `server/orchestrator.ts` — prompt**

Em `buildSystemInstruction`, logo depois do item `- nota_de_execucao: ... Sem nada útil a dizer, omita.` e antes de `- Crescimento tem dois níveis, ...`, inserir (dentro do template literal, mesmo recuo das outras regras):

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

A regra é fixa (não depende de `modo`).

- [ ] **Step 6: `server/orchestrator.ts` — pedido e contexto**

Imports: acrescentar `type ObterToken` de `./calendar.ts` (novo import) — `PrecisaConectar` já é importado de `./auth-store.ts`.

Em `PedidoDeTurno`, depois de `agora?: Date;`:

```ts
  /**
   * A credencial tem o escopo do Google Tasks? Resolvido UMA vez pela rota.
   * Ausente = false: chamadores antigos e scripts não criam passos por engano.
   */
  tasksLiberado?: boolean;
  /**
   * Token pedido de novo antes de cada chamada ao Tasks (a rota passa
   * `tokenValido`). Ausente = o `token` do turno, ou `PrecisaConectar` sem ele.
   */
  obterToken?: ObterToken;
```

Em `rodarTurno`, substituir a linha `const ctx: CapabilityContext = { token, roster, squad, agora, modo, demanda, agenda };` por:

```ts
  const obterToken: ObterToken =
    pedido.obterToken ??
    (async () => {
      if (token) return token;
      throw new PrecisaConectar("Nenhuma credencial do Google guardada.");
    });
  const ctx: CapabilityContext = {
    token, roster, squad, agora, modo, demanda, agenda,
    tasks: { liberado: pedido.tasksLiberado === true, obterToken },
  };
```

(No redirecionamento o 2º `rodarTurno` recebe o mesmo `pedido`, com a squad de destino: a lista usada é a do destino, sem código extra.)

- [ ] **Step 7: `server.ts` — rota `/api/orquestrar`**

Depois do bloco `try { token = await tokenValido(); } catch (err) { falhaDoToken = err; }` e antes de `executarTurno`:

```ts
      // O scope gravado é lido UMA vez por turno, antes do Gemini: cada
      // compromisso com passos consulta este booleano, não o disco.
      const { tasks: tasksLiberado } = await escoposConcedidos();
```

e a chamada vira:

```ts
      const turno = await executarTurno(ai, {
        demanda: demanda.trim(), token, falhaDoToken, modo, roster, squad, janela,
        tasksLiberado, obterToken: tokenValido,
      });
```

(`escoposConcedidos` já foi importado na Task 4; se não estiver, acrescente ao import de `./server/auth-store.ts`.)

- [ ] **Step 8: Rodar e ver passar**

Run: `npx tsx --test server/prompt-passos.test.ts`
Expected: PASS.

- [ ] **Step 9: Verificação completa**

Run: `npx vue-tsc --noEmit`, `npm test` e `npm run build`
Expected: sem erros; build ok.

- [ ] **Step 10: Commit**

```bash
git add server/capabilities.ts server/orchestrator.ts server.ts server/prompt-passos.test.ts
git commit -m "feat(tasks): agendar_evento cria os passos no Google Tasks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 10: Frontend dos passos (tipos, toast do turno, aviso `ampliarAcesso`)

**Files:**
- Modify: `src/types.ts` (`EventoCriado` ~linha 78; `AvisoTarefa` ~linha 154)
- Modify: `src/contribuicao.ts` (`resumoDosEventosCriados` ~linha 87)
- Modify: `src/App.vue` (`handleDelegation` ~linhas 682–727)
- Test: `src/ajuste-do-usuario.test.ts` (acrescentar casos no `describe("A) toast do turno: o que foi marcado")`)

**Interfaces:**
- Consumes: resposta de `/api/orquestrar` com `eventos_criados[i].passos?: number` e `avisos[i].motivo === "ampliarAcesso"` (Task 9); `avisar(texto, acao?)`, `tasksLiberado`, `ampliarAcesso` (Task 5).
- Produces: `EventoCriado.passos?: number` e `AvisoTarefa.motivo` com `"ampliarAcesso"` no espelho; `resumoDosEventosCriados` com o sufixo `` ` · ${n} passo(s) no Google Tasks` ``.

- [ ] **Step 1: Escrever os testes (falham: sem sufixo)**

Em `src/ajuste-do-usuario.test.ts`, dentro do `describe("A) toast do turno: o que foi marcado", ...)`, antes do último `it`:

```ts
  it("evento principal com passos ganha o sufixo do Google Tasks", () => {
    const texto = resumoDosEventosCriados([evento({ titulo: "Apresentação", passos: 3 })], FMT);
    assert.match(texto, /^Apresentação: 45 min, /);
    assert.match(texto, /14:00–14:45 · 3 passo\(s\) no Google Tasks$/);
  });

  it("prazo com blocos e passos: o sufixo vem depois dos blocos dobrados", () => {
    const marco = evento({ titulo: "Entrega", papel: "marco", tipo: "deadline", eventId: "marco1", fim: "2026-09-18T18:00:00-03:00", passos: 2 });
    const bloco = evento({ titulo: "Entrega (bloco)", papel: "bloco", prazo_ref: "marco1", eventId: "b1", inicio: "2026-09-16T09:00:00-03:00", fim: "2026-09-16T10:00:00-03:00" });
    const texto = resumoDosEventosCriados([marco, bloco], FMT);
    assert.match(texto, /\(1 bloco\(s\), 1h\) · 2 passo\(s\) no Google Tasks$/);
  });

  it("sem passos (ausente ou 0): sem sufixo", () => {
    assert.equal(resumoDosEventosCriados([evento({ passos: 0 })], FMT).includes("Google Tasks"), false);
    assert.equal(resumoDosEventosCriados([evento({})], FMT).includes("Google Tasks"), false);
  });
```

Run: `npx tsx --test src/ajuste-do-usuario.test.ts`
Expected: FAIL — `passos` não existe em `EventoCriado` (tsx não checa tipo; a falha é a do `assert.match` sem sufixo).

- [ ] **Step 2: `src/types.ts`**

Em `EventoCriado`, depois de `htmlLink?: string;`:

```ts
  /** Subtarefas criadas no Google Tasks; só no evento principal e só quando > 0. */
  passos?: number;
```

Em `AvisoTarefa`, trocar a união do `motivo` por:

```ts
  /**
   * `precisaConectar`: bloco de prazo recusado por credencial. `ampliarAcesso`:
   * passos não criados por falta do escopo do Google Tasks (o Calendar segue ok).
   */
  motivo?: "precisaConectar" | "configuracao" | "semHorarioLivre" | "agendaIndisponivel" | "ampliarAcesso";
```

(`ErroTarefa.motivo` não muda.)

- [ ] **Step 3: `src/contribuicao.ts`**

Substituir o `.map` de `resumoDosEventosCriados` por:

```ts
    .map((e) => {
      const blocos = e.papel === 'marco' ? eventos.filter((b) => b.prazo_ref === e.eventId) : []
      const total = blocos.reduce((t, b) => t + duracaoMin(b), 0)
      const base = blocos.length
        ? `${resumoDoEvento(e, fmt)} (${blocos.length} bloco(s), ${formatarMinutos(total)})`
        : resumoDoEvento(e, fmt)
      // A checklist mora fora do app (Google Tasks): o toast é o único lugar
      // em que o usuário fica sabendo que ela nasceu.
      return e.passos ? `${base} · ${e.passos} passo(s) no Google Tasks` : base
    })
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test src/ajuste-do-usuario.test.ts`
Expected: PASS (inclusive os casos antigos).

- [ ] **Step 5: `src/App.vue` — `handleDelegation`**

5a. Mover `const erros = turno.erros ?? []` e `const avisos = turno.avisos ?? []` para logo depois de `if (turno.redirecionado) await adotarSquadDoTurno(turno.redirecionado)` e, em seguida, acrescentar:

```ts
    // Passos sem o escopo do Tasks: o compromisso saiu inteiro, então não é
    // alert — é o toast do turno com o gesto certo. Nunca logout: ampliar é o
    // mesmo consentimento.
    const ampliar = (x: { motivo?: string }) => x.motivo === 'ampliarAcesso'
    const pedeTasks = avisos.some(ampliar)
    if (pedeTasks) tasksLiberado.value = false
    const acaoTasks = pedeTasks ? { rotulo: 'Autorizar Google Tasks', fazer: ampliarAcesso } : undefined
```

5b. No bloco `if (turno.eventos_criados?.length) { ... }`, trocar a linha do `avisar(...)` por:

```ts
      const texto = turno.redirecionado ? `Squad ${turno.redirecionado.para_nome} — ${resumo}` : resumo
      avisar(pedeTasks ? `${texto} · Passos não criados: falta autorizar o Google Tasks.` : texto, acaoTasks)
    } else if (pedeTasks) {
      avisar('Passos não criados: falta autorizar o Google Tasks.', acaoTasks)
```

(o `}` que fechava o `if` passa a fechar o `else if`).

5c. No trecho do `alert`, usar os avisos sem `ampliarAcesso` (o `precisaConectar` continua olhando `avisos` inteiro):

```ts
    const precisaConectar = (x: { motivo?: string }) => x.motivo === 'precisaConectar'
    if (erros.some(precisaConectar) || avisos.some(precisaConectar)) conectado.value = false
    const avisosNoAlerta = avisos.filter((a) => !ampliar(a))
    if (erros.length || avisosNoAlerta.length) {
      console.warn('Tarefas com erro:', erros, 'Avisos:', avisos)
      alert([
        ...erros.map(e => `${e.capacidade}: ${e.erro}`),
        ...avisosNoAlerta.map(a => `Aviso — ${a.titulo}: ${a.aviso}`)
      ].join('\n'))
    }
```

(mantenha os comentários existentes do bloco).

- [ ] **Step 6: Verificação completa**

Run: `npx vue-tsc --noEmit`, `npm test` e `npm run build`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/contribuicao.ts src/ajuste-do-usuario.test.ts src/App.vue
git commit -m "feat(tasks): toast conta os passos e oferece autorizar o Google Tasks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 11: Documentar no `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (projeto, `C:\Users\sutil\Documents\dev\PESSOAL\apps\SquadOne\CLAUDE.md`)

**Interfaces:**
- Consumes: nomes finais das Tasks 1–10 (confira no código antes de escrever: `grep -n "export" server/passos.ts server/tasks.ts server/passos-no-google.ts`).
- Produces: documentação; nenhum código.

Estilo do arquivo: português, frases que explicam o porquê, tabelas onde já há tabelas. Não reescreva seções que não são citadas abaixo.

- [ ] **Step 1: (1) Árvore de arquitetura**

No bloco de código de "## Arquitetura", depois de `server/vigia.ts ...`:

```
  server/passos.ts        PURO: normaliza os passos, título da lista, notas e due da tarefa-mãe, escopo concedido
  server/tasks.ts         transporte do Google Tasks: lista, tarefa, ErroTasks classificado, timeout 10 s
  server/passos-no-google.ts  lista por squad (single-flight) + tarefa-mãe + subtarefas + vínculo no evento
```

- [ ] **Step 2: (2) Tabela "Marcas no Calendar"**

Trocar a frase de abertura para dizer que blocos de prazo levam uma quinta chave e o evento principal com passos leva mais duas, e acrescentar as linhas:

```
| `squadone_tasks_lista` | vínculo | só no evento principal (foco ou marco) com passos: id da lista da squad no Google Tasks. Entra por PATCH depois das tarefas, não em `marcasDoEvento` |
| `squadone_tasks_pai` | vínculo | idem: id da tarefa-mãe. Autoritativo; as notas da mãe (`squadone_evento=<eventId>`) são só informativas |
```

- [ ] **Step 3: (3) Seção nova "### Passos no Google Tasks"**

Inserir depois de "### Dica de execução na criação":

```markdown
### Passos no Google Tasks

Segundo canal para os micro-passos de um compromisso: uma tarefa-mãe com subtarefas no Google Tasks, visível no Gmail, no Calendar e no app Tasks do Android sem abrir o SquadOne.

- **Campo, não capacidade.** `agendar_evento` tem `passos: string[]` opcional. O turno é one-shot e o modelo não recebe eventId de volta: uma capacidade separada não teria como apontar para o evento. É o mesmo padrão da `nota_de_execucao`. O prompt manda passos só com pedido explícito de checklist/etapas ou num prazo com etapas que a demanda sugere (2–8 itens); pedido de checklist sem compromisso vira `agendar_evento` com passos. Vale igual nos três modos.
- **Normalização no servidor** (`normalizarPassos`, `server/passos.ts`): só strings, espaços colapsados, vazios fora, dedupe sem diferenciar maiúsculas, `MAX_TITULO_PASSO` 200 com reticências, `MAX_PASSOS` 10 (o excedente vira aviso). Um item cria.
- **Uma lista por squad**, `SquadOne · <nome>`, criada no primeiro compromisso com passos. O id fica em `Squad.tasksListaId` (roster, fora do prompt e da vista) e nunca é procurado por título — o usuário renomeia no celular. Criação single-flight (`Map` em memória, processo único); a chamada ao Google fica fora da fila do `atualizarRoster`, só a gravação do id entra nela. Lista gravada que responde 404/410 é recriada e o id sobrescrito, uma vez por chamada.
- **Fluxo** (depois de `agendarCompromisso`, só com passos): sem escopo → aviso `ampliarAcesso` e nenhuma chamada; lista; tarefa-mãe (título do compromisso, notas = `htmlLink` + `squadone_evento=<eventId>`, `due` = data LOCAL de São Paulo do evento principal como `AAAA-MM-DDT00:00:00.000Z` — o Tasks descarta a hora, e converter para UTC trocaria o dia depois das 21h; marco usa o dia do prazo); subtarefas em ordem com `parent` e `previous` (sem `previous` o Google põe cada uma no topo), sem `due` (com data cada uma viraria um chip no Calendar); PATCH do evento principal com `squadone_tasks_lista`/`_pai` via `lerEvento` + `atualizarPreservandoMarcas`.
- **Falha não se propaga.** Nada do Tasks desfaz ou falha o compromisso. Falha antes da mãe: aviso (escopo → `ampliarAcesso`; API desligada → sem motivo, a mensagem do Google diz o que fazer). Subtarefa que falha para a série sem apagar e avisa quantas faltaram. PATCH que falha: aviso, tarefas ficam com o vínculo só nas notas. 401 repete uma vez com token novo (`comTokenTasks`); persistiu → `precisaConectar`. Timeout de 10 s por chamada: roda dentro da série de `agendar_evento`.
- **Toast:** `EventoCriado.passos` (subtarefas criadas, só no evento principal) vira "· N passo(s) no Google Tasks".
- **A Mochila não lê o Tasks** (invariante 3): nenhuma chamada nova, nenhum modo de falha novo. Tarefa não tem horário: não passa pelo alocador nem gera lembrete.
- **Escrita única, de propósito:** nada reescreve as tarefas depois. O Ajuste não atualiza o `due`; apagar o evento deixa as tarefas órfãs; a vigia não sabe do Tasks; o redirecionamento de squad usa a lista da squad de destino sozinho.
- **Adiado:** selo "passos 2/5" no card da Mochila (um `tasks.list` por lista com `showCompleted`/`showHidden`, casado pela marca, sem afetar a Mochila se falhar); tarefa avulsa sem compromisso; renomear a lista quando a squad é renomeada.
```

- [ ] **Step 4: (4) Autenticação**

Na seção "## Autenticação", depois do parágrafo de `prompt=consent`:

```markdown
**Dois escopos, autorização incremental.** O consentimento pede `calendar.events` e `tasks` juntos (`include_granted_scopes=true`). Ampliar o acesso de uma credencial antiga é refazer `/api/auth/google` ("Autorizar Google Tasks" na UI) — **nunca** logout, que revoga o refresh_token no Google e derruba o Calendar junto. `GET /api/auth/status` responde `{ conectado, tasks }`: sem o escopo do Tasks o app funciona igual e só os passos ficam de fora (aviso `ampliarAcesso`). O `scope` concedido é gravado na credencial; resposta sem `scope` vale só o Calendar.

**Consentimento granular:** Tasks desmarcado grava normalmente (`tasks: false`). Calendar desmarcado recusa sem gravar (`EscopoNegado`), a credencial anterior fica intacta e o callback volta para `/?auth=escopo_calendar_negado`. 403 de escopo do Tasks nunca vira `precisaConectar`: a UI mostraria "Conectar" com o Calendar funcionando.
```

Na tabela de rotas de auth (bloco de código), trocar a linha do status por `/api/auth/status    -> { conectado: bool, tasks: bool }`.

- [ ] **Step 5: (5) Persistência**

Na tabela de "## Persistência": linha de `data/squad.json` acrescenta "; `tasksListaId` opcional por squad (lista do Google Tasks, lazy)"; linha de `data/google-auth.json` acrescenta "e o `scope` concedido (Calendar, e Tasks quando autorizado)".

Depois do parágrafo "Rollback da Fase 2", acrescentar:

```markdown
**Rollback dos passos no Tasks.** Sem migração: implantar o commit anterior. As chaves `squadone_tasks_*` nos eventos são ignoradas pelo código antigo, `tasksListaId` é tolerado por `validarV3`, as tarefas já criadas continuam no Google e o refresh_token com dois escopos continua servindo ao Calendar.
```

- [ ] **Step 6: (6) Lista de testes em "## Comandos"**

Na frase dos testes pontuais, acrescentar `server/passos.test.ts`, `server/tasks.test.ts`, `server/passos-no-google.test.ts`, `server/auth-escopos.test.ts`, `server/squad.test.ts`, `server/calendar.test.ts` e `server/prompt-passos.test.ts`, e uma frase: "`auth-escopos` e `squad` gravam num diretório temporário (chdir antes do import) e nunca em `data/`; `fetch` é dublê em todos."

- [ ] **Step 7: (7) Convenções**

Na lista de erros classificados de "## Convenções", acrescentar: "`ErroTasks` (`ehCredencial` só 401, `escopoInsuficiente`, `apiDesligada`), `ListaSumiu`, `TasksSemResposta`, `EscopoNegado` (callback → `?auth=escopo_calendar_negado`), `AvisoTarefa.motivo: ampliarAcesso` (passos sem o escopo do Tasks: toast com \"Autorizar Google Tasks\", nunca logout)". Na frase "Falha de uma parte não derruba o resto", acrescentar: "a checklist do Tasks que falha não desfaz o compromisso".

- [ ] **Step 8: Verificação**

Run: `grep -n "squadone_tasks_lista\|ampliarAcesso\|Passos no Google Tasks\|passos-no-google\|escopo_calendar_negado\|tasksListaId" CLAUDE.md`
Expected: ocorrências nas seções de arquitetura, marcas, passos, autenticação, persistência e convenções.

Run: `npx vue-tsc --noEmit` e `npm test`
Expected: verdes (nada de código mudou).

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(tasks): passos no Google Tasks, escopos e vínculo no CLAUDE.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verificação manual (fora das tarefas)

Referência para o controlador; nenhuma tarefa acima depende disto.

- **C1 (console Google)**, **C2 (consentimento)**, **C3 (conferência visual)** e **C4 (limpeza)** seguem o spec, com Claude in Chrome e os pontos de confirmação dele.
- Cenários 1–9 da tabela do spec contra a conta real em `npm run dev`. Pontos que este plano deixou para a API real confirmar:
  - `tasks.insert` com `previous` mantém a ordem (cenário 3).
  - `tasklists.get` de lista apagada responde 404/410 (cenário 6). Se responder outro status (ex.: 400), `lerLista` não lançará `ListaSumiu`: registrar no checkpoint e ajustar o mapeamento em `server/tasks.ts`.
  - `due` da mãe no mesmo dia local para evento às 22:30 (cenário 9; o teste puro já trava).
  - Ajuste preserva `squadone_tasks_*` (cenário 7; `server/calendar.test.ts` já trava o comportamento do PATCH).
- Depois: `npm run build`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, push em `main`, `graphify update .`. Deploy é manual (Easypanel); "Autorizar Google Tasks" em produção é gesto do usuário, sem logout.

