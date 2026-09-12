# Fase 3 — Alocador de agenda (o servidor escolhe o horário) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar do modelo a escolha do horário: `agendar_evento` passa a receber intenção (tipo, duração/esforço, prazo, hora só se o usuário fixou) e o servidor lê a agenda uma vez por turno e aloca em série — Focar Agora no próximo slot livre, Prazo Final como marco transparente + blocos antes.

**Architecture:** `server/alocador.ts` é puro (ocupação + janela + pedido + agora → slots). `server/agenda.ts` guarda a ocupação do turno (1 leitura do `primary` + reservas). `server/agendamento.ts` transforma um compromisso em POSTs (foco, ou marco + blocos com `squadone_prazo_ref`). `capabilities.ts` fica fino; `orchestrator.ts` roda os `agendar_evento` em série por prioridade; `server.ts` lê a janela das env vars antes do token/Gemini. A Mochila deriva "Bloco i/N" da lista lida.

**Tech Stack:** Node + Express + tsx, Vue 3.5 (`<script setup>`), Vite 6, TypeScript via `vue-tsc`, `Intl.DateTimeFormat` para fuso. Sem suíte de testes: scripts tsx descartáveis.

**Spec:** `docs/superpowers/specs/2026-09-12-fase-3-alocador-de-agenda-design.md` — leia inteira antes da Task 1. Seções citadas como §N.

## Global Constraints

- **A Fase 1 precisa estar em `main` antes da Task 2.** Pré-voo abaixo. A Task 1 (alocador puro) não depende dela.
- **Releia cada arquivo antes de editar e releia o código pós-Fase 1/2 antes de CADA task.** A Fase 2 também altera `server/orchestrator.ts` e `server/capabilities.ts` (contratação, arquivamento, propostas). Trechos deste plano mostram a forma esperada, não o texto exato; onde o arquivo divergir, preserve o que as Fases 1/2 fizeram e aplique só a mudança descrita.
- **Não tocar** `server/auth-store.ts` (sessão paralela). Importar `PrecisaConectar`/`ErroDeConfig` dele é permitido; editar, não.
- **Nunca** Google Calendar nem Gemini reais. `fetch` mockado (`mockarGoogle` do harness recusa qualquer URL fora de `googleapis.com/calendar/v3` e nunca vai à rede); cliente do Gemini falso; servidor de teste com `GEMINI_API_KEY=fake`.
- **Nunca** ler/gravar `data/` do repo. Scripts fazem `chdir` para diretório temporário fora do repo.
- **Não commitar** `graphify-out/`, `docs/daily-summary/`, nem specs/planos de outras fases. Sempre `git add` com caminhos explícitos.
- Comentários e identificadores em português; comentário explica *por quê*.
- Constantes exatas (§4.2): `FUSO = "America/Sao_Paulo"`, `GRADE_MIN = 15`, `BLOCO_MIN = 30`, `BLOCO_MAX = 120`, `PAUSA_MIN = 15`, `BLOCOS_MAX = 20`, `HORIZONTE_FOCO_DIAS = 14`, `HORIZONTE_DIAS = 60`, `ESFORCO_MAX_MIN = 2400`, `DURACAO_MAX_MIN = 720`.
- Env vars (§8): `JANELA_TRABALHO` padrão `09:00-19:00`; `DIAS_TRABALHO` padrão `1,2,3,4,5` (ISO, 1 = segunda).
- Marca nova: `squadone_prazo_ref` = eventId do marco, só em blocos.
- Motivos de erro: `"precisaConectar" | "configuracao" | "semHorarioLivre" | "agendaIndisponivel"`.
- Commits em português, `tipo(escopo): descrição`, corpo com o porquê, terminando com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Verificação por task: `npx vue-tsc --noEmit` e `npm run build` passam, mais o script da task.

## Pré-voo (antes da Task 2)

```bash
cd "$REPO" && git pull --rebase && grep -n "export function marcasDoEvento\|export function urlDeEventos" server/calendar.ts && grep -n "export interface PedidoDeTurno\|export interface ContextoDoPrompt" server/orchestrator.ts && grep -n "roster: Roster" server/capabilities.ts
```

Esperado: as quatro definições aparecem. Se faltar alguma, a Fase 1 não aterrissou: **pare** e avise; não reimplemente a Fase 1 aqui.

## Ambiente dos scripts de verificação

Rode em Git Bash. Uma vez por sessão:

```bash
export REPO="C:/Users/sutil/Documents/dev/PESSOAL/apps/SquadOne"
export SCRATCH="<diretório de rascunho da sua sessão, FORA do repo>"
export TSX="$REPO/node_modules/.bin/tsx"
mkdir -p "$SCRATCH/fase3"
```

Scripts em `$SCRATCH/fase3/`, **nunca** commitados. Rode sempre com `cd "$SCRATCH/fase3" && "$TSX" <script>.ts`.

`$SCRATCH/fase3/harness.ts` (crie na Task 1; as outras tasks usam):

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.REPO) throw new Error("Defina REPO antes de rodar.");
export const REPO = path.resolve(process.env.REPO);
const BASE = process.env.SCRATCH ?? os.tmpdir();

/** Importa um módulo do repo pelo caminho absoluto (os scripts moram fora dele). */
export function importar<T = any>(rel: string): Promise<T> {
  return import(pathToFileURL(path.join(REPO, rel)).href);
}

/**
 * Diretório descartável com seed/ copiada, e chdir para ele: server/squad.ts e
 * server/auth-store.ts resolvem data/ pelo cwd. Nenhum script roda no repo.
 */
export async function prepararDiretorio(): Promise<string> {
  await fs.mkdir(BASE, { recursive: true });
  const dir = await fs.mkdtemp(path.join(BASE, "fase3-"));
  if (path.resolve(dir).startsWith(REPO)) throw new Error("Diretório temporário dentro do repo: abortado.");
  await fs.cp(path.join(REPO, "seed"), path.join(dir, "seed"), { recursive: true }).catch(() => {});
  process.chdir(dir);
  return dir;
}

export type Chamada = { url: string; metodo: string; corpo: any };

/**
 * Google Calendar falso. GET = events.list (lista ou páginas); POST = insert,
 * devolve ev1, ev2... na ordem. NUNCA deixa passar para a rede.
 */
export function mockarGoogle(
  opcoes: { itens?: any[]; paginas?: any[][]; statusLista?: number; falharPostN?: number } = {},
): Chamada[] {
  const chamadas: Chamada[] = [];
  let posts = 0;
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith("https://www.googleapis.com/calendar/v3/")) {
      throw new Error(`fetch inesperado para ${u}`);
    }
    const metodo = init?.method ?? "GET";
    chamadas.push({ url: u, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    if (metodo === "GET") {
      if (opcoes.statusLista) {
        return new Response(
          JSON.stringify({ error: { message: "recusado", errors: [{ reason: "authError" }] } }),
          { status: opcoes.statusLista },
        );
      }
      if (opcoes.paginas) {
        const n = Number(new URL(u).searchParams.get("pageToken") ?? "0");
        const corpo: any = { items: opcoes.paginas[n] };
        if (n + 1 < opcoes.paginas.length) corpo.nextPageToken = String(n + 1);
        return Response.json(corpo);
      }
      return Response.json({ items: opcoes.itens ?? [] });
    }
    posts++;
    if (opcoes.falharPostN === posts) return new Response("quota", { status: 429 });
    return Response.json({ id: `ev${posts}`, htmlLink: `https://calendar.google.com/ev${posts}` });
  }) as typeof fetch;
  return chamadas;
}

export const dt = (s: string) => ({ dateTime: s });
export const iso = (s: string) => new Date(s).toISOString();

/** Roda cenários nomeados; argv filtra. Sai com 1 se algum falhar. */
export async function rodarCenarios(nomeDoScript: string, cenarios: Record<string, () => Promise<void>>) {
  const pedidos = process.argv.slice(2);
  let falhas = 0;
  for (const [nome, fn] of Object.entries(cenarios)) {
    if (pedidos.length && !pedidos.includes(nome)) continue;
    try {
      await fn();
      console.log(`OK   ${nome}`);
    } catch (e: any) {
      falhas++;
      console.log(`FALHOU ${nome}: ${e?.stack ?? e}`);
    }
  }
  if (falhas) {
    console.error(`${nomeDoScript}: ${falhas} cenário(s) falharam`);
    process.exit(1);
  }
  console.log(`OK ${nomeDoScript}`);
}
```

## Mapa de arquivos

| Arquivo | Responsabilidade | Tasks |
|---|---|---|
| `server/alocador.ts` (novo) | PURO: tempo local/DST, janela, intervalos, `alocar`, `conflitos`, `lerInstante` | 1 |
| `server/calendar.ts` | `PROP_PRAZO_REF`, `marcasDoEvento({..., prazoRef?})`, `QuestCalendario.prazoRef`, `eventoOcupa`, `lerOcupacao` | 2 |
| `server/agenda.ts` (novo) | `AgendaDoTurno` (1 leitura + reservas), `AgendaIndisponivel` | 2 |
| `server/agendamento.ts` (novo) | compromisso → POSTs; `EventoCriado`, `CompromissoAgendado`, `prioridadeDeAgendamento` | 3 |
| `server/capabilities.ts` | declaração nova de `agendar_evento`, handler fino, `tipoForcado`, `ctx.agenda` | 4 |
| `server/orchestrator.ts` | série por prioridade, `avisos`, `motivo`, prompt com janela, `PedidoDeTurno` | 4 |
| `server.ts` | janela antes do token/Gemini, `falhaDoToken`, log de boot | 4 |
| `.env.example` | `JANELA_TRABALHO`, `DIAS_TRABALHO` | 4 |
| `src/types.ts` | espelhos | 5 |
| `src/mochila.ts` (novo) | `diasDoEventoDiaInteiro`, `infoDePrazo` (sem Vue) | 5 |
| `src/components/QuestBackpack.vue` | "Bloco i/N", prazo do bloco, intervalo de dia inteiro | 5 |
| `src/App.vue` | avisos no alert, `precisaConectar` derruba `conectado` | 5 |
| `src/components/CommandBar.vue` | dicas do toggle | 5 |
| `CLAUDE.md` | arquitetura, seção Agendamento, env vars | 6 |

---

### Task 1: Alocador puro `server/alocador.ts`

Não depende da Fase 1.

**Files:**
- Create: `server/alocador.ts`
- Test (fora do repo): `$SCRATCH/fase3/harness.ts`, `$SCRATCH/fase3/alocador.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usado pelas Tasks 2–4):
  - constantes `FUSO`, `GRADE_MIN`, `BLOCO_MIN`, `BLOCO_MAX`, `BLOCOS_MAX`, `PAUSA_MIN`, `HORIZONTE_FOCO_DIAS`, `HORIZONTE_DIAS`, `ESFORCO_MAX_MIN`, `DURACAO_MAX_MIN`;
  - `interface Intervalo { inicio: number; fim: number }`, `interface Janela { inicioMin: number; fimMin: number; dias: number[]; fuso: string }`, `interface DataLocal { ano: number; mes: number; dia: number }`, `type PedidoDeSlot`, `interface Alocacao { slots: Intervalo[]; faltouMin: number }`;
  - `class SemHorarioLivre extends Error` (`name = "SemHorarioLivre"`), `class JanelaMalConfigurada extends Error` (`name = "JanelaMalConfigurada"`);
  - `offsetMin(instante: number, fuso: string): number`, `dataLocal(instante, fuso): DataLocal & { diaSemana: number }`, `proximoDia(d: DataLocal): DataLocal`, `instanteLocal(data: DataLocal, minutos: number, fuso: string): number`, `lerInstante(valor: unknown, fuso: string): { instante: number; data: DataLocal | null } | null`;
  - `lerJanela(env: Record<string, string | undefined>): Janela`, `descreverJanela(j: Janela): string`;
  - `mesclar(intervalos: Intervalo[]): Intervalo[]`, `conflitos(ocupacao: Intervalo[], slot: Intervalo): Intervalo[]`, `dentroDaJanela(slot: Intervalo, j: Janela): boolean`;
  - `alocar(ocupacao: Intervalo[], janela: Janela, pedido: PedidoDeSlot, agora: number): Alocacao`.

- [ ] **Step 1: Criar o harness**

Crie `$SCRATCH/fase3/harness.ts` com o conteúdo da seção "Ambiente dos scripts de verificação".

- [ ] **Step 2: Escrever a tabela de casos**

`$SCRATCH/fase3/alocador.ts`:

```ts
import assert from "node:assert/strict";
import { importar } from "./harness.ts";

type Intervalo = { inicio: number; fim: number };
type Janela = { inicioMin: number; fimMin: number; dias: number[]; fuso: string };
type Pedido =
  | { tipo: "foco"; duracaoMin: number; aPartirDe?: number; limite?: number }
  | { tipo: "blocos"; esforcoMin: number; aPartirDe?: number; limite: number };

const SP = "America/Sao_Paulo";
const NY = "America/New_York";
const J: Janela = { inicioMin: 540, fimMin: 1140, dias: [1, 2, 3, 4, 5], fuso: SP };
const T = (s: string) => new Date(s).getTime();
const I = (a: string, b: string): Intervalo => ({ inicio: T(a), fim: T(b) });
const fmt = (r: { slots: Intervalo[]; faltouMin: number }) => ({
  slots: r.slots.map((s) => [new Date(s.inicio).toISOString(), new Date(s.fim).toISOString()]),
  faltouMin: r.faltouMin,
});
const Z = (a: string, b: string) => [new Date(a).toISOString(), new Date(b).toISOString()];

type Caso = {
  nome: string;
  ocupacao?: Intervalo[];
  janela?: Janela;
  pedido: Pedido;
  agora: string;
  espera: { slots: string[][]; faltouMin: number } | "SemHorarioLivre";
};

const casos: Caso[] = [
  { nome: "A1 foco arredonda agora para 15min", agora: "2026-09-14T10:07:00-03:00",
    pedido: { tipo: "foco", duracaoMin: 60 },
    espera: { slots: [Z("2026-09-14T10:15:00-03:00", "2026-09-14T11:15:00-03:00")], faltouMin: 0 } },
  { nome: "A2 agora antes da janela", agora: "2026-09-14T08:00:00-03:00",
    pedido: { tipo: "foco", duracaoMin: 60 },
    espera: { slots: [Z("2026-09-14T09:00:00-03:00", "2026-09-14T10:00:00-03:00")], faltouMin: 0 } },
  { nome: "A3 agora depois da janela", agora: "2026-09-14T19:30:00-03:00",
    pedido: { tipo: "foco", duracaoMin: 60 },
    espera: { slots: [Z("2026-09-15T09:00:00-03:00", "2026-09-15T10:00:00-03:00")], faltouMin: 0 } },
  { nome: "A4 fim de semana pula para segunda", agora: "2026-09-12T10:00:00-03:00",
    pedido: { tipo: "foco", duracaoMin: 60 },
    espera: { slots: [Z("2026-09-14T09:00:00-03:00", "2026-09-14T10:00:00-03:00")], faltouMin: 0 } },
  { nome: "A5 bloco que atravessaria o fim da janela vai para o dia seguinte", agora: "2026-09-14T18:30:00-03:00",
    pedido: { tipo: "foco", duracaoMin: 60 },
    espera: { slots: [Z("2026-09-15T09:00:00-03:00", "2026-09-15T10:00:00-03:00")], faltouMin: 0 } },
  { nome: "A6 buraco curto é pulado", agora: "2026-09-14T10:00:00-03:00",
    ocupacao: [I("2026-09-14T10:00:00-03:00", "2026-09-14T11:00:00-03:00"), I("2026-09-14T11:30:00-03:00", "2026-09-14T12:00:00-03:00")],
    pedido: { tipo: "foco", duracaoMin: 60 },
    espera: { slots: [Z("2026-09-14T12:00:00-03:00", "2026-09-14T13:00:00-03:00")], faltouMin: 0 } },
  { nome: "A7 fim desalinhado sobe para a grade", agora: "2026-09-14T10:00:00-03:00",
    ocupacao: [I("2026-09-14T10:00:00-03:00", "2026-09-14T10:50:00-03:00")],
    pedido: { tipo: "foco", duracaoMin: 30 },
    espera: { slots: [Z("2026-09-14T11:00:00-03:00", "2026-09-14T11:30:00-03:00")], faltouMin: 0 } },
  { nome: "A8 agenda cheia no horizonte", agora: "2026-09-14T10:00:00-03:00",
    ocupacao: [I("2026-09-14T00:00:00-03:00", "2026-10-01T00:00:00-03:00")],
    pedido: { tipo: "foco", duracaoMin: 60 }, espera: "SemHorarioLivre" },
  { nome: "A9 a_partir_de (dia) empurra a busca", agora: "2026-09-14T10:00:00-03:00",
    pedido: { tipo: "foco", duracaoMin: 60, aPartirDe: T("2026-09-15T00:00:00-03:00") },
    espera: { slots: [Z("2026-09-15T09:00:00-03:00", "2026-09-15T10:00:00-03:00")], faltouMin: 0 } },
  { nome: "A10 foco com limite que não cabe", agora: "2026-09-14T10:00:00-03:00",
    ocupacao: [I("2026-09-14T10:00:00-03:00", "2026-09-14T12:00:00-03:00")],
    pedido: { tipo: "foco", duracaoMin: 60, limite: T("2026-09-14T12:00:00-03:00") }, espera: "SemHorarioLivre" },
  { nome: "A11 evento de vários dias ocupa até o fim", agora: "2026-09-14T08:00:00-03:00",
    ocupacao: [I("2026-09-13T22:00:00-03:00", "2026-09-14T12:00:00-03:00")],
    pedido: { tipo: "foco", duracaoMin: 60 },
    espera: { slots: [Z("2026-09-14T12:00:00-03:00", "2026-09-14T13:00:00-03:00")], faltouMin: 0 } },
  { nome: "B1 esforço espalhado um bloco por dia", agora: "2026-09-14T09:00:00-03:00",
    pedido: { tipo: "blocos", esforcoMin: 240, limite: T("2026-09-16T19:00:00-03:00") },
    espera: { slots: [Z("2026-09-14T09:00:00-03:00", "2026-09-14T11:00:00-03:00"), Z("2026-09-15T09:00:00-03:00", "2026-09-15T11:00:00-03:00")], faltouMin: 0 } },
  { nome: "B2 resto menor que o mínimo é absorvido", agora: "2026-09-14T09:00:00-03:00",
    pedido: { tipo: "blocos", esforcoMin: 135, limite: T("2026-09-16T19:00:00-03:00") },
    espera: { slots: [Z("2026-09-14T09:00:00-03:00", "2026-09-14T10:45:00-03:00"), Z("2026-09-15T09:00:00-03:00", "2026-09-15T09:30:00-03:00")], faltouMin: 0 } },
  { nome: "B3 passada 2 com pausa entre blocos do mesmo prazo", agora: "2026-09-14T09:00:00-03:00",
    pedido: { tipo: "blocos", esforcoMin: 360, limite: T("2026-09-15T12:00:00-03:00") },
    espera: { slots: [Z("2026-09-14T09:00:00-03:00", "2026-09-14T11:00:00-03:00"), Z("2026-09-14T11:15:00-03:00", "2026-09-14T13:15:00-03:00"), Z("2026-09-15T09:00:00-03:00", "2026-09-15T11:00:00-03:00")], faltouMin: 0 } },
  { nome: "B4 não cabe antes do prazo: parcial", agora: "2026-09-14T09:00:00-03:00",
    pedido: { tipo: "blocos", esforcoMin: 600, limite: T("2026-09-14T12:00:00-03:00") },
    espera: { slots: [Z("2026-09-14T09:00:00-03:00", "2026-09-14T11:00:00-03:00"), Z("2026-09-14T11:15:00-03:00", "2026-09-14T12:00:00-03:00")], faltouMin: 435 } },
  { nome: "B5 prazo já passou: nada", agora: "2026-09-14T09:00:00-03:00",
    pedido: { tipo: "blocos", esforcoMin: 120, limite: T("2026-09-14T08:00:00-03:00") },
    espera: { slots: [], faltouMin: 120 } },
  { nome: "B6 só buracos de 30min: não sobra resto inútil", agora: "2026-09-14T09:00:00-03:00",
    ocupacao: [I("2026-09-14T09:30:00-03:00", "2026-09-14T10:00:00-03:00"), I("2026-09-14T10:30:00-03:00", "2026-09-14T19:00:00-03:00")],
    pedido: { tipo: "blocos", esforcoMin: 45, limite: T("2026-09-14T19:00:00-03:00") },
    espera: { slots: [Z("2026-09-14T09:00:00-03:00", "2026-09-14T09:30:00-03:00")], faltouMin: 15 } },
  { nome: "B7 teto de 20 blocos por prazo", agora: "2026-09-14T08:00:00-03:00",
    janela: { inicioMin: 540, fimMin: 570, dias: [1, 2, 3, 4, 5, 6, 7], fuso: SP },
    pedido: { tipo: "blocos", esforcoMin: 900, limite: T("2026-10-24T00:00:00-03:00") },
    espera: {
      // 20 dias corridos a partir de 14/09, 09:00–09:30 (-03:00 = 12:00Z).
      slots: Array.from({ length: 20 }, (_, i) => {
        const dia = new Date(Date.UTC(2026, 8, 14 + i, 12, 0));
        return [dia.toISOString(), new Date(dia.getTime() + 30 * 60_000).toISOString()];
      }),
      faltouMin: 300 } },
  { nome: "D1 NY dia de 23h: janela 01-04 tem 120min reais", agora: "2026-03-08T00:30:00-05:00",
    janela: { inicioMin: 60, fimMin: 240, dias: [1, 2, 3, 4, 5, 6, 7], fuso: NY },
    pedido: { tipo: "foco", duracaoMin: 120 },
    espera: { slots: [Z("2026-03-08T06:00:00Z", "2026-03-08T08:00:00Z")], faltouMin: 0 } },
  { nome: "D2 NY 180min não cabe no dia do salto", agora: "2026-03-08T00:30:00-05:00",
    janela: { inicioMin: 60, fimMin: 240, dias: [1, 2, 3, 4, 5, 6, 7], fuso: NY },
    pedido: { tipo: "foco", duracaoMin: 180 },
    espera: { slots: [Z("2026-03-09T05:00:00Z", "2026-03-09T08:00:00Z")], faltouMin: 0 } },
  { nome: "D3 NY dia de 25h: janela 00-03 tem 240min reais", agora: "2026-10-31T23:00:00-04:00",
    janela: { inicioMin: 0, fimMin: 180, dias: [1, 2, 3, 4, 5, 6, 7], fuso: NY },
    pedido: { tipo: "foco", duracaoMin: 240 },
    espera: { slots: [Z("2026-11-01T04:00:00Z", "2026-11-01T08:00:00Z")], faltouMin: 0 } },
  { nome: "D4 NY início da janela na lacuna vai para depois do salto", agora: "2026-03-08T00:00:00-05:00",
    janela: { inicioMin: 150, fimMin: 300, dias: [1, 2, 3, 4, 5, 6, 7], fuso: NY },
    pedido: { tipo: "foco", duracaoMin: 60 },
    espera: { slots: [Z("2026-03-08T07:30:00Z", "2026-03-08T08:30:00Z")], faltouMin: 0 } },
  { nome: "D5 São Paulo 2018 (horário de verão à meia-noite)", agora: "2018-11-03T23:00:00-03:00",
    janela: { inicioMin: 0, fimMin: 120, dias: [1, 2, 3, 4, 5, 6, 7], fuso: SP },
    pedido: { tipo: "foco", duracaoMin: 60 },
    espera: { slots: [Z("2018-11-04T03:00:00Z", "2018-11-04T04:00:00Z")], faltouMin: 0 } },
];

async function main() {
  const A = await importar("server/alocador.ts");
  let falhas = 0;
  for (const c of casos) {
    const ocup = c.ocupacao ?? [];
    const copia = structuredClone(ocup);
    try {
      let obtido: unknown;
      try {
        obtido = fmt(A.alocar(ocup, c.janela ?? J, c.pedido, T(c.agora)));
      } catch (e: any) {
        obtido = e?.name === "SemHorarioLivre" ? "SemHorarioLivre" : `ERRO ${e?.message}`;
      }
      assert.deepEqual(obtido, c.espera);
      assert.deepEqual(ocup, copia, "alocar mutou a ocupação");
      console.log(`OK   ${c.nome}`);
    } catch (e: any) {
      falhas++;
      console.log(`FALHOU ${c.nome}\n${e.message}`);
    }
  }

  // Utilitários
  assert.deepEqual(A.lerJanela({}), { inicioMin: 540, fimMin: 1140, dias: [1, 2, 3, 4, 5], fuso: SP });
  assert.deepEqual(A.lerJanela({ JANELA_TRABALHO: "08:30-18:00", DIAS_TRABALHO: "6,1" }).dias, [1, 6]);
  for (const env of [{ JANELA_TRABALHO: "19:00-09:00" }, { JANELA_TRABALHO: "9-19" }, { DIAS_TRABALHO: "0,1" }, { DIAS_TRABALHO: "1,1" }, { JANELA_TRABALHO: "09:00-09:15" }]) {
    assert.throws(() => A.lerJanela(env), (e: any) => e.name === "JanelaMalConfigurada", JSON.stringify(env));
  }
  assert.equal(A.descreverJanela(J), "09:00–19:00 (seg, ter, qua, qui, sex)");
  assert.deepEqual(A.lerInstante("2026-09-16", SP), { instante: T("2026-09-16T00:00:00-03:00"), data: { ano: 2026, mes: 9, dia: 16 } });
  assert.deepEqual(A.lerInstante("2026-09-16T18:00:00", SP), { instante: T("2026-09-16T18:00:00-03:00"), data: null });
  assert.deepEqual(A.lerInstante("2026-09-16T18:00:00Z", SP), { instante: T("2026-09-16T18:00:00Z"), data: null });
  assert.equal(A.lerInstante("amanhã", SP), null);
  assert.equal(A.lerInstante("2026-02-30", SP), null);
  assert.equal(A.conflitos([I("2026-09-14T10:00:00-03:00", "2026-09-14T11:00:00-03:00")], I("2026-09-14T11:00:00-03:00", "2026-09-14T12:00:00-03:00")).length, 0);
  assert.equal(A.conflitos([I("2026-09-14T10:00:00-03:00", "2026-09-14T11:00:00-03:00")], I("2026-09-14T10:59:00-03:00", "2026-09-14T12:00:00-03:00")).length, 1);
  assert.equal(A.dentroDaJanela(I("2026-09-14T18:00:00-03:00", "2026-09-14T19:00:00-03:00"), J), true);
  assert.equal(A.dentroDaJanela(I("2026-09-14T18:30:00-03:00", "2026-09-14T19:30:00-03:00"), J), false);
  assert.equal(A.dentroDaJanela(I("2026-09-12T10:00:00-03:00", "2026-09-12T11:00:00-03:00"), J), false);
  console.log("OK   utilitários");

  if (falhas) { console.error(`${falhas} caso(s) falharam`); process.exit(1); }
  console.log(`OK alocador: ${casos.length} casos`);
}

main().catch((e) => { console.error("FALHOU alocador:", e); process.exit(1); });
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase3" && "$TSX" alocador.ts
```

Esperado: `FALHOU alocador:` com erro de módulo não encontrado (`server/alocador.ts` ainda não existe).

- [ ] **Step 4: Implementar `server/alocador.ts`**

```ts
/**
 * Alocador de horário: dado o que já ocupa a agenda, a janela de trabalho, um
 * pedido e o instante atual, devolve os slots. PURO de propósito — sem fetch,
 * sem relógio, sem env: a Fase 4 reusa para propor ajustes de duração, e só
 * uma função pura dá para verificar com tabela de casos.
 *
 * Instantes são epoch ms (number). Intervalos são semiabertos [inicio, fim).
 */

export const FUSO = "America/Sao_Paulo";

/** Grade de 15 min: todo slot começa e termina nela. */
export const GRADE_MIN = 15;
/** Menor bloco de trabalho que vale a pena: abaixo disso é troca de contexto. */
export const BLOCO_MIN = 30;
/** Maior bloco de trabalho contínuo antes de exigir outro bloco. */
export const BLOCO_MAX = 120;
/** Teto de blocos por prazo: cada bloco é um POST ao Google, em série, com o usuário esperando. */
export const BLOCOS_MAX = 20;
/** Folga entre dois blocos do MESMO prazo no mesmo dia. */
export const PAUSA_MIN = 15;
/** Focar Agora procura até 14 dias corridos a partir do início da busca. */
export const HORIZONTE_FOCO_DIAS = 14;
/** Nada é alocado além de 60 dias de agora: é o quanto de agenda o turno lê. */
export const HORIZONTE_DIAS = 60;
/** Esforço de um prazo acima de 40h é sinal de compromisso que devia ser quebrado. */
export const ESFORCO_MAX_MIN = 2400;
/** Bloco de foco maior que 12h não é bloco. */
export const DURACAO_MAX_MIN = 720;

const MIN_MS = 60_000;
const DIA_MS = 24 * 60 * MIN_MS;
const GRADE_MS = GRADE_MIN * MIN_MS;

export interface Intervalo {
  inicio: number;
  fim: number;
}

export interface Janela {
  /** Minutos desde 00:00 local. */
  inicioMin: number;
  /** Minutos desde 00:00 local; 1440 = meia-noite do dia seguinte. */
  fimMin: number;
  /** Dias ISO: 1 = segunda ... 7 = domingo. */
  dias: number[];
  fuso: string;
}

export interface DataLocal {
  ano: number;
  mes: number;
  dia: number;
}

export type PedidoDeSlot =
  | { tipo: "foco"; duracaoMin: number; aPartirDe?: number; limite?: number }
  | { tipo: "blocos"; esforcoMin: number; aPartirDe?: number; limite: number };

export interface Alocacao {
  slots: Intervalo[];
  /** Minutos do esforço que não couberam. Sempre 0 para foco. */
  faltouMin: number;
}

/** Não há slot livre para um foco dentro do horizonte. Vira erro da tarefa, não do turno. */
export class SemHorarioLivre extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SemHorarioLivre";
  }
}

/** JANELA_TRABALHO/DIAS_TRABALHO ilegíveis. Ambiente: nenhum clique conserta. */
export class JanelaMalConfigurada extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "JanelaMalConfigurada";
  }
}

// --- Tempo local -------------------------------------------------------

const formatadores = new Map<string, Intl.DateTimeFormat>();
function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

function partes(instante: number, fuso: string): Record<string, string> {
  return Object.fromEntries(formatador(fuso).formatToParts(instante).map((p) => [p.type, p.value]));
}

/** Offset local − UTC, em minutos, naquele instante. */
export function offsetMin(instante: number, fuso: string): number {
  const nome = partes(instante, fuso).timeZoneName ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nome);
  if (!m) return 0; // "GMT" puro = +00:00
  const valor = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -valor : valor;
}

export function dataLocal(instante: number, fuso: string): DataLocal & { diaSemana: number } {
  const p = partes(instante, fuso);
  const ano = Number(p.year), mes = Number(p.month), dia = Number(p.day);
  const js = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  return { ano, mes, dia, diaSemana: js === 0 ? 7 : js };
}

export function proximoDia(d: DataLocal): DataLocal {
  const t = new Date(Date.UTC(d.ano, d.mes - 1, d.dia + 1));
  return { ano: t.getUTCFullYear(), mes: t.getUTCMonth() + 1, dia: t.getUTCDate() };
}

function diaSemanaDe(d: DataLocal): number {
  const js = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
  return js === 0 ? 7 : js;
}

/**
 * Instante da hora de parede `minutos` do dia `data` no fuso. Nunca soma 24h:
 * dia com mudança de horário tem 23h ou 25h.
 * - Hora que não existe (adiantou o relógio): empurra para frente pelo tamanho
 *   do salto (02:30 num salto 02→03 vira 03:30).
 * - Hora que existe duas vezes (atrasou): a primeira.
 */
export function instanteLocal(data: DataLocal, minutos: number, fuso: string): number {
  const parede = Date.UTC(data.ano, data.mes - 1, data.dia, 0, minutos);
  const offAntes = offsetMin(parede - 12 * 3600_000, fuso);
  const offDepois = offsetMin(parede + 12 * 3600_000, fuso);
  const tAntes = parede - offAntes * MIN_MS;
  if (offAntes === offDepois) return tAntes;
  const tDepois = parede - offDepois * MIN_MS;
  const antesValido = offsetMin(tAntes, fuso) === offAntes;
  const depoisValido = offsetMin(tDepois, fuso) === offDepois;
  if (antesValido && depoisValido) return Math.min(tAntes, tDepois);
  if (antesValido) return tAntes;
  if (depoisValido) return tDepois;
  return tAntes; // lacuna: offset de antes cai depois do salto
}

const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const SEM_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Lê uma data do modelo. `AAAA-MM-DD` → meia-noite local com `data` preenchida
 * (quem chama decide o que "dia sem hora" significa). ISO com offset/Z → o
 * instante. ISO SEM offset → hora de parede no fuso, não no fuso do container
 * (que em produção é UTC). Qualquer outra coisa → null.
 */
export function lerInstante(
  valor: unknown,
  fuso: string,
): { instante: number; data: DataLocal | null } | null {
  const texto = String(valor ?? "").trim();
  let m = SO_DATA.exec(texto);
  if (m) {
    const data = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
    const volta = new Date(Date.UTC(data.ano, data.mes - 1, data.dia));
    if (volta.getUTCMonth() + 1 !== data.mes || volta.getUTCDate() !== data.dia) return null;
    return { instante: instanteLocal(data, 0, fuso), data };
  }
  m = SEM_OFFSET.exec(texto);
  if (m) {
    const data = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
    const minutos = Number(m[4]) * 60 + Number(m[5]);
    return { instante: instanteLocal(data, minutos, fuso) + Number(m[6] ?? 0) * 1000, data: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(texto)) return null;
  const t = new Date(texto).getTime();
  return Number.isNaN(t) ? null : { instante: t, data: null };
}

// --- Janela -------------------------------------------------------------

const NOMES_DIA = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function lerHora(texto: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(texto);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/**
 * Janela global de trabalho, do ambiente. Ausente = 09:00-19:00, seg a sex.
 * Presente e ilegível = erro, nunca o padrão calado: agendar fora da janela
 * que o usuário configurou é pior que não agendar.
 */
export function lerJanela(env: Record<string, string | undefined>): Janela {
  const bruto = (env.JANELA_TRABALHO ?? "").trim() || "09:00-19:00";
  const [a, b, ...resto] = bruto.split("-");
  const inicioMin = lerHora(a ?? ""), fimMin = lerHora(b ?? "");
  if (resto.length || inicioMin === null || fimMin === null) {
    throw new JanelaMalConfigurada(`JANELA_TRABALHO='${bruto}' não é HH:MM-HH:MM.`);
  }
  if (fimMin - inicioMin < BLOCO_MIN) {
    throw new JanelaMalConfigurada(
      `JANELA_TRABALHO='${bruto}' precisa terminar pelo menos ${BLOCO_MIN} min depois de começar.`,
    );
  }
  const diasBruto = (env.DIAS_TRABALHO ?? "").trim() || "1,2,3,4,5";
  const dias = diasBruto.split(",").map((s) => s.trim());
  if (!dias.every((d) => /^[1-7]$/.test(d)) || new Set(dias).size !== dias.length) {
    throw new JanelaMalConfigurada(
      `DIAS_TRABALHO='${diasBruto}' deve listar dias ISO 1-7 sem repetir (1 = segunda).`,
    );
  }
  return { inicioMin, fimMin, dias: dias.map(Number).sort((x, y) => x - y), fuso: FUSO };
}

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** "09:00–19:00 (seg, ter, qua, qui, sex)" — para o prompt e para mensagens. */
export function descreverJanela(j: Janela): string {
  return `${hhmm(j.inicioMin)}–${hhmm(j.fimMin)} (${j.dias.map((d) => NOMES_DIA[d]).join(", ")})`;
}

// --- Intervalos ---------------------------------------------------------

const teto = (t: number) => Math.ceil(t / GRADE_MS) * GRADE_MS;
const piso = (t: number) => Math.floor(t / GRADE_MS) * GRADE_MS;

/** Ordena e funde sobrepostos/encostados. Não muta a entrada. */
export function mesclar(intervalos: Intervalo[]): Intervalo[] {
  const ord = intervalos
    .filter((i) => i.fim > i.inicio)
    .map((i) => ({ ...i }))
    .sort((a, b) => a.inicio - b.inicio);
  const saida: Intervalo[] = [];
  for (const i of ord) {
    const ultimo = saida[saida.length - 1];
    if (ultimo && i.inicio <= ultimo.fim) ultimo.fim = Math.max(ultimo.fim, i.fim);
    else saida.push(i);
  }
  return saida;
}

/** Trechos de `[de, ate)` fora de `ocupado` (já mesclado), recortados para a grade. */
function livres(de: number, ate: number, ocupado: Intervalo[]): Intervalo[] {
  const saida: Intervalo[] = [];
  let cursor = de;
  for (const o of ocupado) {
    if (o.fim <= cursor) continue;
    if (o.inicio >= ate) break;
    if (o.inicio > cursor) saida.push({ inicio: cursor, fim: o.inicio });
    cursor = Math.max(cursor, o.fim);
    if (cursor >= ate) break;
  }
  if (cursor < ate) saida.push({ inicio: cursor, fim: ate });
  return saida
    .map((i) => ({ inicio: teto(i.inicio), fim: piso(i.fim) }))
    .filter((i) => i.fim > i.inicio);
}

/** A janela de cada dia de trabalho entre `de` e `ate`, recortada a esse intervalo. */
function janelasDosDias(de: number, ate: number, j: Janela): Intervalo[] {
  const saida: Intervalo[] = [];
  let d: DataLocal = dataLocal(de, j.fuso);
  while (instanteLocal(d, 0, j.fuso) < ate) {
    if (j.dias.includes(diaSemanaDe(d))) {
      const inicio = Math.max(instanteLocal(d, j.inicioMin, j.fuso), de);
      const fim = Math.min(instanteLocal(d, j.fimMin, j.fuso), ate);
      if (fim > inicio) saida.push({ inicio, fim });
    }
    d = proximoDia(d);
  }
  return saida;
}

/** Eventos que colidem com `slot`. Para horário fixo: conflito vira aviso. */
export function conflitos(ocupacao: Intervalo[], slot: Intervalo): Intervalo[] {
  return ocupacao.filter((o) => o.inicio < slot.fim && o.fim > slot.inicio);
}

/** O slot inteiro cabe na janela de um único dia de trabalho? */
export function dentroDaJanela(slot: Intervalo, j: Janela): boolean {
  const d = dataLocal(slot.inicio, j.fuso);
  if (!j.dias.includes(d.diaSemana)) return false;
  return slot.inicio >= instanteLocal(d, j.inicioMin, j.fuso) && slot.fim <= instanteLocal(d, j.fimMin, j.fuso);
}

/**
 * Tamanho do próximo bloco num trecho livre de `livreMin`, faltando `restanteMin`.
 * Nunca deixa um resto menor que BLOCO_MIN quando dá para evitar: 135 min viram
 * 105 + 30, não 120 + 15.
 */
function tamanhoDoBloco(livreMin: number, restanteMin: number): number {
  if (livreMin < BLOCO_MIN || restanteMin < BLOCO_MIN) return 0;
  let t = Math.min(BLOCO_MAX, livreMin, restanteMin);
  const sobra = restanteMin - t;
  if (sobra > 0 && sobra < BLOCO_MIN && restanteMin - BLOCO_MIN >= BLOCO_MIN) {
    t = restanteMin - BLOCO_MIN;
  }
  return t;
}

// --- Alocação -----------------------------------------------------------

export function alocar(
  ocupacao: Intervalo[],
  janela: Janela,
  pedido: PedidoDeSlot,
  agora: number,
): Alocacao {
  const base = teto(Math.max(agora, pedido.aPartirDe ?? agora));
  const tetoAbsoluto = agora + HORIZONTE_DIAS * DIA_MS;
  const ocupado = mesclar(ocupacao);

  if (pedido.tipo === "foco") {
    const fimBusca = Math.min(
      base + HORIZONTE_FOCO_DIAS * DIA_MS,
      pedido.limite ?? Infinity,
      tetoAbsoluto,
    );
    const duracaoMs = pedido.duracaoMin * MIN_MS;
    for (const dia of janelasDosDias(base, fimBusca, janela)) {
      for (const l of livres(dia.inicio, dia.fim, ocupado)) {
        if (l.fim - l.inicio >= duracaoMs) {
          return { slots: [{ inicio: l.inicio, fim: l.inicio + duracaoMs }], faltouMin: 0 };
        }
      }
    }
    throw new SemHorarioLivre(
      `Nenhum horário livre de ${pedido.duracaoMin} min na janela ` +
        `${descreverJanela(janela)} entre ${new Date(base).toISOString()} e ` +
        `${new Date(Math.max(base, fimBusca)).toISOString()}.`,
    );
  }

  const fimBusca = Math.min(pedido.limite, tetoAbsoluto);
  const dias = janelasDosDias(base, fimBusca, janela);
  const slots: Intervalo[] = [];
  let restante = pedido.esforcoMin;

  // Passada 1: no máximo um bloco por dia, do mais cedo para o mais tarde.
  // Prazo distante não deve comer o dia de hoje inteiro.
  for (const dia of dias) {
    if (restante < BLOCO_MIN || slots.length >= BLOCOS_MAX) break;
    for (const l of livres(dia.inicio, dia.fim, ocupado)) {
      const t = tamanhoDoBloco((l.fim - l.inicio) / MIN_MS, restante);
      if (t > 0) {
        slots.push({ inicio: l.inicio, fim: l.inicio + t * MIN_MS });
        restante -= t;
        break;
      }
    }
  }

  // Passada 2: o que sobrou vai onde couber, com pausa em volta dos blocos
  // deste mesmo prazo (senão dois blocos encostados seriam um bloco gigante).
  for (const dia of dias) {
    while (restante >= BLOCO_MIN && slots.length < BLOCOS_MAX) {
      const comPausa = slots.map((s) => ({
        inicio: s.inicio - PAUSA_MIN * MIN_MS,
        fim: s.fim + PAUSA_MIN * MIN_MS,
      }));
      const ocupadoAgora = mesclar([...ocupado, ...comPausa]);
      let achou = false;
      for (const l of livres(dia.inicio, dia.fim, ocupadoAgora)) {
        const t = tamanhoDoBloco((l.fim - l.inicio) / MIN_MS, restante);
        if (t > 0) {
          slots.push({ inicio: l.inicio, fim: l.inicio + t * MIN_MS });
          restante -= t;
          achou = true;
          break;
        }
      }
      if (!achou) break;
    }
  }

  slots.sort((a, b) => a.inicio - b.inicio);
  return { slots, faltouMin: restante };
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd "$SCRATCH/fase3" && "$TSX" alocador.ts
```

Esperado: 23 linhas `OK   ...`, `OK   utilitários` e `OK alocador: 23 casos`.

- [ ] **Step 6: Pureza, typecheck e build**

```bash
cd "$REPO" && node -e "const s=require('fs').readFileSync('server/alocador.ts','utf8');for(const p of [/fetch\(/,/process\.env/,/Date\.now\(/,/^import /m]){if(p.test(s)){console.error('impuro:',p);process.exit(1)}}console.log('puro')" && npx vue-tsc --noEmit && npm run build
```

Esperado: `puro`; typecheck e build sem erros.

- [ ] **Step 7: Commit**

```bash
cd "$REPO" && git add server/alocador.ts && git commit -m "$(cat <<'EOF'
feat(agenda): alocador puro de horario livre

Dado o que ocupa a agenda, a janela de trabalho, o pedido e o instante atual,
devolve os slots. Foco = primeiro slot livre em ate 14 dias; blocos de prazo =
30 a 120 min, um por dia antes de empilhar, pausa de 15 min entre blocos do
mesmo prazo, teto de 20. Nao coube antes do prazo: devolve o parcial e quanto
faltou.

Puro de proposito (sem fetch, relogio ou env): a Fase 4 reusa para propor
ajuste de duracao. Dias andam pelo calendario, nunca +24h, e hora de parede
vira instante pelo offset do fuso, testado com dias de 23h e 25h.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Ocupação da agenda e marca `squadone_prazo_ref`

Rode o **pré-voo** antes.

**Files:**
- Modify: `server/calendar.ts`
- Create: `server/agenda.ts`
- Test: `$SCRATCH/fase3/ocupacao.ts`

**Interfaces:**
- Consumes: Task 1 (`Intervalo`, `Janela`, `HORIZONTE_DIAS`); Fase 1 (`marcasDoEvento`, `urlDeEventos`, `ErroCalendario`, `paraQuest`, `QuestCalendario`); `auth-store.ts` (`PrecisaConectar`, `ErroDeConfig`).
- Produces:
  - `calendar.ts`: `PROP_PRAZO_REF = "squadone_prazo_ref"`; `marcasDoEvento(m: { squadId: string; dominioId: string; pessoaId: string; tipo: "time_blocking" | "deadline"; prazoRef?: string }): Record<string, string>`; `QuestCalendario.prazoRef: string`; `CALENDARIO_DE_OCUPACAO = "primary"`; `interface EventoDeOcupacao`; `eventoOcupa(ev: EventoDeOcupacao): Intervalo | null`; `lerOcupacao(token: string, de: Date, ate: Date): Promise<Intervalo[]>`.
  - `agenda.ts`: `class AgendaIndisponivel extends Error { readonly credencial: boolean }`; `class AgendaDoTurno { constructor(p: { token: string | null; falhaDoToken?: unknown; janela: Janela; agora: Date }); readonly token: string | null; readonly janela: Janela; readonly agora: Date; ocupacao(): Promise<Intervalo[]>; reservar(intervalo: Intervalo): void }`.

- [ ] **Step 1: Escrever o script**

`$SCRATCH/fase3/ocupacao.ts`:

```ts
import assert from "node:assert/strict";
import { dt, importar, mockarGoogle, prepararDiretorio, rodarCenarios } from "./harness.ts";

async function main() {
  await prepararDiretorio();
  const cal = await importar("server/calendar.ts");
  const { AgendaDoTurno } = await importar("server/agenda.ts");
  const { lerJanela } = await importar("server/alocador.ts");
  const AGORA = new Date("2026-09-14T08:00:00-03:00"); // segunda
  const janela = lerJanela({});
  const hora = (a: string, b: string, extra: Record<string, unknown> = {}) => ({ start: dt(a), end: dt(b), ...extra });

  await rodarCenarios("ocupacao", {
    async "ocupa-filtro"() {
      const base = hora("2026-09-14T09:00:00-03:00", "2026-09-14T10:00:00-03:00");
      assert.deepEqual(cal.eventoOcupa(base), { inicio: Date.parse(base.start.dateTime), fim: Date.parse(base.end.dateTime) });
      assert.equal(cal.eventoOcupa({ ...base, transparency: "transparent" }), null);
      assert.equal(cal.eventoOcupa({ start: { date: "2026-09-14" }, end: { date: "2026-09-15" } }), null);
      assert.equal(cal.eventoOcupa({ ...base, status: "cancelled" }), null);
      assert.equal(cal.eventoOcupa({ ...base, eventType: "workingLocation" }), null);
      assert.equal(cal.eventoOcupa({ ...base, attendees: [{ self: true, responseStatus: "declined" }] }), null);
      assert.ok(cal.eventoOcupa({ ...base, attendees: [{ self: true, responseStatus: "tentative" }] }), "tentativo ocupa");
      assert.ok(cal.eventoOcupa({ ...base, attendees: [{ self: false, responseStatus: "declined" }] }), "recusa de outro não libera");
      assert.ok(cal.eventoOcupa({ ...base, eventType: "outOfOffice" }), "ausência ocupa");
    },
    async "leitura-unica-paginada"() {
      const chamadas = mockarGoogle({
        paginas: [
          [hora("2026-09-14T09:00:00-03:00", "2026-09-14T10:00:00-03:00")],
          [hora("2026-09-14T10:00:00-03:00", "2026-09-14T11:00:00-03:00"), hora("2026-09-14T12:00:00-03:00", "2026-09-14T13:00:00-03:00", { transparency: "transparent" })],
        ],
      });
      const agenda = new AgendaDoTurno({ token: "tok", janela, agora: AGORA });
      assert.equal((await agenda.ocupacao()).length, 2);
      agenda.reservar({ inicio: Date.parse("2026-09-14T15:00:00-03:00"), fim: Date.parse("2026-09-14T16:00:00-03:00") });
      assert.equal((await agenda.ocupacao()).length, 3, "reserva do turno entra na ocupação");
      assert.equal(chamadas.length, 2, "duas páginas, uma leitura só");
      const u = new URL(chamadas[0].url);
      assert.ok(u.pathname.endsWith("/calendars/primary/events"), u.pathname);
      assert.equal(u.searchParams.get("singleEvents"), "true");
      assert.equal(u.searchParams.get("timeMin"), AGORA.toISOString());
      assert.equal(u.searchParams.get("timeMax"), new Date(AGORA.getTime() + 60 * 86400_000).toISOString());
      assert.equal(u.searchParams.get("maxAttendees"), "1");
      assert.equal(u.searchParams.get("maxResults"), "2500");
      assert.equal(chamadas[0].url.includes("privateExtendedProperty"), false, "ocupação é GLOBAL");
      assert.equal(new URL(chamadas[1].url).searchParams.get("pageToken"), "1");
    },
    async "agenda-sem-token"() {
      const chamadas = mockarGoogle();
      const { PrecisaConectar, ErroDeConfig } = await importar("server/auth-store.ts");
      const nome = (e: any) => e?.constructor?.name;
      await assert.rejects(new AgendaDoTurno({ token: null, janela, agora: AGORA }).ocupacao(), (e: any) => nome(e) === "PrecisaConectar");
      await assert.rejects(new AgendaDoTurno({ token: null, falhaDoToken: new PrecisaConectar("x"), janela, agora: AGORA }).ocupacao(), (e: any) => nome(e) === "PrecisaConectar");
      await assert.rejects(new AgendaDoTurno({ token: null, falhaDoToken: new ErroDeConfig("x"), janela, agora: AGORA }).ocupacao(), (e: any) => nome(e) === "ErroDeConfig");
      await assert.rejects(new AgendaDoTurno({ token: null, falhaDoToken: new Error("rede"), janela, agora: AGORA }).ocupacao(), (e: any) => e.name === "AgendaIndisponivel" && e.credencial === false);
      assert.equal(chamadas.length, 0, "sem token não chama o Google");
    },
    async "leitura-401-uma-vez"() {
      const chamadas = mockarGoogle({ statusLista: 401 });
      const agenda = new AgendaDoTurno({ token: "tok", janela, agora: AGORA });
      for (let i = 0; i < 2; i++) {
        await assert.rejects(agenda.ocupacao(), (e: any) => e.name === "AgendaIndisponivel" && e.credencial === true);
      }
      assert.equal(chamadas.length, 1, "leitura falhada não é repetida no mesmo turno");
    },
    async "marcas-prazo-ref"() {
      assert.equal(cal.PROP_PRAZO_REF, "squadone_prazo_ref");
      assert.ok(cal.PROP_PRAZO_REF.length <= 44);
      const semRef = cal.marcasDoEvento({ squadId: "pessoal", dominioId: "casa", pessoaId: "romulo", tipo: "deadline" });
      assert.deepEqual(Object.keys(semRef).sort(), ["squadone_dominio", "squadone_membro", "squadone_squad", "squadone_tipo"]);
      const comRef = cal.marcasDoEvento({ squadId: "pessoal", dominioId: "casa", pessoaId: "romulo", tipo: "time_blocking", prazoRef: "ev1" });
      assert.equal(comRef.squadone_prazo_ref, "ev1");
      const q = cal.paraQuest({ id: "b", summary: "B", start: dt("2026-09-14T10:00:00-03:00"), end: dt("2026-09-14T11:00:00-03:00"), extendedProperties: { private: comRef } });
      assert.equal(q.prazoRef, "ev1");
      const q2 = cal.paraQuest({ id: "c", summary: "C", start: dt("2026-09-14T10:00:00-03:00"), end: dt("2026-09-14T11:00:00-03:00") });
      assert.equal(q2.prazoRef, "");
    },
  });
}

main().catch((e) => { console.error("FALHOU ocupacao:", e); process.exit(1); });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase3" && "$TSX" ocupacao.ts
```

Esperado: `FALHOU ocupacao:` (módulo `server/agenda.ts` não existe).

- [ ] **Step 3: `server/calendar.ts`**

Releia o arquivo (forma da Fase 1). Mudanças:

1. No topo: `import type { Intervalo } from "./alocador.ts";`

2. No comentário das marcas, acrescente um item, e ao lado das outras constantes `PROP_*`:

```ts
/**
 * - `squadone_prazo_ref` LIGA um bloco de trabalho ao marco do prazo: valor é o
 *   eventId do marco (gravado antes dos blocos, então o id já existe). Só em
 *   blocos. Posição "2/3" não é gravada — a Mochila deriva da lista lida, e um
 *   bloco apagado no Google sai da contagem sozinho.
 */
export const PROP_PRAZO_REF = "squadone_prazo_ref";
```

3. `marcasDoEvento` ganha o campo opcional e continua sendo o único lugar que monta marcas:

```ts
export function marcasDoEvento(m: {
  squadId: string;
  dominioId: string;
  pessoaId: string;
  tipo: "time_blocking" | "deadline";
  /** eventId do marco; só em blocos de trabalho de um prazo. */
  prazoRef?: string;
}): Record<string, string> {
  return {
    [PROP_SQUAD]: m.squadId,
    [PROP_DOMINIO]: m.dominioId,
    [PROP_MEMBRO]: m.pessoaId,
    [PROP_TIPO]: m.tipo,
    ...(m.prazoRef ? { [PROP_PRAZO_REF]: m.prazoRef } : {}),
  };
}
```

4. `QuestCalendario` ganha, depois de `squad`:

```ts
  /** `squadone_prazo_ref`: eventId do marco quando a quest é bloco de um prazo; "" senão. */
  prazoRef: string;
```

   e `paraQuest` preenche `prazoRef: priv[PROP_PRAZO_REF] ?? "",`.

5. No fim do arquivo, o bloco de ocupação:

```ts
/**
 * Ocupação da agenda para o alocador (Fase 3). GLOBAL: sempre o calendário
 * principal inteiro, qualquer que seja o calendarId da squad, sem filtro de
 * marca — conflito é com tudo que o usuário tem, inclusive o que o app não criou.
 */
export const CALENDARIO_DE_OCUPACAO = "primary";
const CAMPOS_OCUPACAO =
  "nextPageToken,items(status,transparency,eventType,start,end,attendees(self,responseStatus))";
const PAGINAS_MAX = 10;

export interface EventoDeOcupacao {
  status?: string;
  transparency?: string;
  eventType?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/**
 * Um evento ocupa a agenda? Não ocupa: cancelado; transparente (o Google diz
 * que não bloqueia — inclui os marcos do app); dia inteiro (feriado,
 * aniversário, lembrete); workingLocation/birthday; recusado pelo próprio
 * usuário. Todo o resto ocupa, inclusive tentativo e sem resposta: na dúvida,
 * não marcar por cima.
 */
export function eventoOcupa(ev: EventoDeOcupacao): Intervalo | null {
  if (ev.status === "cancelled") return null;
  if (ev.transparency === "transparent") return null;
  if (ev.eventType === "workingLocation" || ev.eventType === "birthday") return null;
  if (!ev.start?.dateTime || !ev.end?.dateTime) return null;
  if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const inicio = Date.parse(ev.start.dateTime);
  const fim = Date.parse(ev.end.dateTime);
  if (!(fim > inicio)) return null;
  return { inicio, fim };
}

/**
 * Lê a ocupação entre `de` e `ate`. `singleEvents` expande recorrentes;
 * `maxAttendees=1` faz o Google devolver só o próprio usuário em eventos com
 * muitos convidados (é dele que sai o "recusado"); `fields` corta o payload.
 * Mais de 10 páginas é erro, não leitura parcial: alocar sobre ocupação
 * incompleta marcaria por cima de compromissos.
 */
export async function lerOcupacao(token: string, de: Date, ate: Date): Promise<Intervalo[]> {
  const ocupado: Intervalo[] = [];
  let pageToken: string | undefined;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const params = new URLSearchParams({
      timeMin: de.toISOString(),
      timeMax: ate.toISOString(),
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "2500",
      maxAttendees: "1",
      fields: CAMPOS_OCUPACAO,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const resp = await fetch(`${urlDeEventos(CALENDARIO_DE_OCUPACAO)}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      throw new ErroCalendario(resp.status, await resp.text().catch(() => ""));
    }
    const json = (await resp.json()) as { items?: EventoDeOcupacao[]; nextPageToken?: string };
    for (const ev of json.items ?? []) {
      const intervalo = eventoOcupa(ev);
      if (intervalo) ocupado.push(intervalo);
    }
    if (!json.nextPageToken) return ocupado;
    pageToken = json.nextPageToken;
  }
  throw new Error(
    `A agenda tem mais de ${PAGINAS_MAX} páginas de eventos nos próximos dias: ` +
      "a ocupação ficaria incompleta, então nada foi alocado.",
  );
}
```

   Acima de `eventoOcupa`, este comentário:

```ts
/**
 * Um evento ocupa a agenda? Não ocupa: cancelado; transparente (o Google diz
 * que não bloqueia — inclui os marcos do app); dia inteiro (feriado,
 * aniversário, lembrete); workingLocation/birthday; recusado pelo próprio
 * usuário. Todo o resto ocupa, inclusive tentativo e sem resposta: na dúvida,
 * não marcar por cima.
 */
```

   e acima de `lerOcupacao`:

```ts
/**
 * Lê a ocupação entre `de` e `ate`. `singleEvents` expande recorrentes;
 * `maxAttendees=1` faz o Google devolver só o próprio usuário em eventos com
 * muitos convidados (é dele que sai o "recusado"); `fields` corta o payload.
 * Mais de 10 páginas é erro, não leitura parcial: alocar sobre ocupação
 * incompleta marcaria por cima de compromissos.
 */
```

- [ ] **Step 4: `server/agenda.ts`**

```ts
import { ErroDeConfig, PrecisaConectar } from "./auth-store.ts";
import { ErroCalendario, lerOcupacao } from "./calendar.ts";
import { HORIZONTE_DIAS, type Intervalo, type Janela } from "./alocador.ts";

/**
 * A agenda não pôde ser lida. `credencial` diz se reconectar resolve — mesma
 * distinção do `ErroDeDominio` da Mochila.
 */
export class AgendaIndisponivel extends Error {
  readonly credencial: boolean;
  constructor(mensagem: string, credencial: boolean) {
    super(mensagem);
    this.name = "AgendaIndisponivel";
    this.credencial = credencial;
  }
}

/**
 * A ocupação da agenda durante UM turno. Lê o calendário principal uma vez
 * (na primeira pergunta, não no construtor: turno sem agendar_evento não gasta
 * chamada ao Google) e acumula as reservas do próprio turno, para que dois
 * compromissos da mesma demanda não caiam no mesmo horário.
 */
export class AgendaDoTurno {
  readonly token: string | null;
  readonly janela: Janela;
  readonly agora: Date;
  private readonly falhaDoToken: unknown;
  private leitura: Promise<Intervalo[]> | null = null;
  private readonly reservas: Intervalo[] = [];

  constructor(p: { token: string | null; falhaDoToken?: unknown; janela: Janela; agora: Date }) {
    this.token = p.token;
    this.falhaDoToken = p.falhaDoToken ?? null;
    this.janela = p.janela;
    this.agora = p.agora;
  }

  /**
   * Eventos que ocupam + reservas do turno. Lança o erro CLASSIFICADO de por
   * que não há agenda: `PrecisaConectar`, `ErroDeConfig` ou `AgendaIndisponivel`.
   * Uma leitura que falhou continua falhada no resto do turno: reler a cada
   * compromisso multiplicaria chamadas contra um Google que acabou de recusar.
   */
  async ocupacao(): Promise<Intervalo[]> {
    if (!this.token) {
      const falha = this.falhaDoToken;
      if (falha instanceof PrecisaConectar || falha instanceof ErroDeConfig) throw falha;
      if (falha) {
        throw new AgendaIndisponivel(
          `Não deu para obter a credencial do Google: ${(falha as Error)?.message ?? String(falha)}`,
          false,
        );
      }
      throw new PrecisaConectar(
        "Conecte o Google Calendar para agendar: sem ler a agenda não há horário livre para escolher.",
      );
    }
    this.leitura ??= lerOcupacao(
      this.token,
      this.agora,
      new Date(this.agora.getTime() + HORIZONTE_DIAS * 24 * 3600_000),
    ).catch((err: any) => {
      throw new AgendaIndisponivel(
        `Não deu para ler a agenda: ${err?.message ?? String(err)}`,
        err instanceof ErroCalendario && err.ehCredencial,
      );
    });
    const lidos = await this.leitura;
    return [...lidos, ...this.reservas.map((r) => ({ ...r }))];
  }

  /** Desconta um horário recém-gravado para os próximos compromissos do turno. */
  reservar(intervalo: Intervalo): void {
    this.reservas.push({ ...intervalo });
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd "$SCRATCH/fase3" && "$TSX" ocupacao.ts
```

Esperado: 5 linhas `OK   ...` e `OK ocupacao`.

- [ ] **Step 6: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros. Se o typecheck acusar `QuestCalendario` sem `prazoRef` em algum literal do servidor, preencha `prazoRef: ""` ali. O espelho do frontend é a Task 5.

- [ ] **Step 7: Commit**

```bash
cd "$REPO" && git add server/calendar.ts server/agenda.ts && git commit -m "$(cat <<'EOF'
feat(agenda): ler ocupacao global uma vez por turno

events.list no primary inteiro, sem filtro de marca: conflito e com tudo que
o usuario tem. Ignora transparente, dia inteiro, cancelado, workingLocation e
recusado pelo proprio usuario. Pagina ate 10 paginas; alem disso falha em vez
de alocar sobre ocupacao incompleta.

AgendaDoTurno le na primeira pergunta, guarda as reservas do turno e devolve o
erro ja classificado quando nao ha token. Marca squadone_prazo_ref liga bloco
ao marco pelo eventId.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Compromisso vira eventos — `server/agendamento.ts`

**Files:**
- Create: `server/agendamento.ts`
- Test: `$SCRATCH/fase3/agendamento.ts`

**Interfaces:**
- Consumes: Task 1 (`alocar`, `conflitos`, `dentroDaJanela`, `descreverJanela`, `instanteLocal`, `lerInstante`, `proximoDia`, constantes); Task 2 (`AgendaDoTurno`, `marcasDoEvento` com `prazoRef`); Fase 1 (`urlDeEventos`, `ErroCalendario`, `PREFIXO_DEADLINE`).
- Produces:
  - `type TipoEvento = "time_blocking" | "deadline"`;
  - `interface EventoCriado` e `interface CompromissoAgendado` (spec §3.3);
  - `interface PedidoDeCompromisso { args; tipoForcado: TipoEvento | null; squadId; calendarId; dominio: { id; nome }; pessoa: { id; nome; papel }; colorId; agenda: AgendaDoTurno }`;
  - `agendarCompromisso(p: PedidoDeCompromisso): Promise<CompromissoAgendado>`;
  - `prioridadeDeAgendamento(args: Record<string, any>, tipoForcado: TipoEvento | null, fuso: string): [number, number]`;
  - `formatarMinutos(min: number): string`.

Esta task não liga nada ao turno: `capabilities.ts` continua como está até a Task 4.

- [ ] **Step 1: Escrever o script**

`$SCRATCH/fase3/agendamento.ts`:

```ts
import assert from "node:assert/strict";
import { dt, importar, iso, mockarGoogle, prepararDiretorio, rodarCenarios, type Chamada } from "./harness.ts";

async function main() {
  await prepararDiretorio();
  const { AgendaDoTurno } = await importar("server/agenda.ts");
  const { agendarCompromisso, prioridadeDeAgendamento, formatarMinutos } = await importar("server/agendamento.ts");
  const { lerJanela } = await importar("server/alocador.ts");

  const janela = lerJanela({});
  const AGORA = new Date("2026-09-14T08:00:00-03:00"); // segunda
  const novaAgenda = (token: string | null = "tok") => new AgendaDoTurno({ token, janela, agora: AGORA });
  const pedido = (args: Record<string, any>, agenda: any, tipoForcado: string | null = null) => ({
    args, tipoForcado, squadId: "pessoal", calendarId: "primary",
    dominio: { id: "casa", nome: "Casa" }, pessoa: { id: "romulo", nome: "Rômulo", papel: "PO" },
    colorId: "9", agenda,
  });
  const posts = (c: Chamada[]) => c.filter((x) => x.metodo === "POST").map((x) => x.corpo);
  const hora = (a: string, b: string) => ({ start: dt(a), end: dt(b) });

  await rodarCenarios("agendamento", {
    async "foco-proximo-livre-e-serie"() {
      const chamadas = mockarGoogle({ itens: [hora("2026-09-14T09:00:00-03:00", "2026-09-14T10:00:00-03:00")] });
      const agenda = novaAgenda();
      const r = await agendarCompromisso(pedido({ titulo: "Estudar", tipo: "time_blocking", duracao_min: 50 }, agenda));
      assert.equal(r.kind, "compromisso");
      assert.equal(r.eventos.length, 1);
      assert.equal(r.eventos[0].papel, "foco");
      assert.equal(r.eventos[0].inicio, iso("2026-09-14T10:00:00-03:00"));
      assert.equal(r.eventos[0].fim, iso("2026-09-14T11:00:00-03:00"), "50 min sobe para 60 (grade de 15)");
      const [corpo] = posts(chamadas);
      assert.equal(corpo.transparency, undefined, "foco ocupa a agenda");
      assert.equal(corpo.summary, "[PO] Estudar");
      assert.deepEqual(corpo.extendedProperties.private, {
        squadone_squad: "pessoal", squadone_dominio: "casa", squadone_membro: "romulo", squadone_tipo: "time_blocking",
      });
      const r2 = await agendarCompromisso(pedido({ titulo: "Ler", tipo: "time_blocking", duracao_min: 30 }, agenda));
      assert.equal(r2.eventos[0].inicio, iso("2026-09-14T11:00:00-03:00"), "segundo foco do turno desvia do primeiro");
      assert.equal(chamadas.filter((c) => c.metodo === "GET").length, 1, "uma leitura por turno");
    },
    async "foco-a-partir-de"() {
      mockarGoogle();
      const r = await agendarCompromisso(pedido({ titulo: "x", tipo: "time_blocking", a_partir_de: "2026-09-15" }, novaAgenda()));
      assert.equal(r.eventos[0].inicio, iso("2026-09-15T09:00:00-03:00"));
    },
    async "foco-fixo-respeitado-com-aviso"() {
      mockarGoogle({ itens: [hora("2026-09-14T14:00:00-03:00", "2026-09-14T15:00:00-03:00")] });
      const r = await agendarCompromisso(pedido({ titulo: "Dentista", tipo: "time_blocking", inicio_fixo: "2026-09-14T14:30:00-03:00", duracao_min: 60 }, novaAgenda()));
      assert.equal(r.eventos[0].inicio, iso("2026-09-14T14:30:00-03:00"));
      assert.equal(r.avisos.length, 1);
      assert.match(r.avisos[0], /conflita com 1/);
      const r2 = await agendarCompromisso(pedido({ titulo: "Jogo", tipo: "time_blocking", inicio_fixo: "2026-09-14T20:00:00", duracao_min: 60 }, novaAgenda()));
      assert.equal(r2.eventos[0].inicio, iso("2026-09-14T20:00:00-03:00"), "sem offset = hora de São Paulo");
      assert.ok(r2.avisos.some((a: string) => /fora da janela/.test(a)));
    },
    async "foco-sem-horario"() {
      const chamadas = mockarGoogle({ itens: [hora("2026-09-01T00:00:00-03:00", "2026-12-01T00:00:00-03:00")] });
      await assert.rejects(agendarCompromisso(pedido({ titulo: "x", tipo: "time_blocking" }, novaAgenda())), (e: any) => e.name === "SemHorarioLivre");
      assert.equal(posts(chamadas).length, 0);
    },
    async "foco-maior-que-a-janela"() {
      mockarGoogle();
      await assert.rejects(agendarCompromisso(pedido({ titulo: "x", tipo: "time_blocking", duracao_min: 660 }, novaAgenda())), /não cabe na janela/);
    },
    async "prazo-dia-inteiro-com-blocos"() {
      const chamadas = mockarGoogle();
      const r = await agendarCompromisso(pedido({ titulo: "Relatório", tipo: "deadline", prazo_final: "2026-09-16", esforco_min: 240 }, novaAgenda()));
      assert.deepEqual(r.eventos.map((e: any) => e.papel), ["marco", "bloco", "bloco"]);
      const [marco, b1, b2] = posts(chamadas);
      assert.deepEqual(marco.start, { date: "2026-09-16" });
      assert.deepEqual(marco.end, { date: "2026-09-17" });
      assert.equal(marco.transparency, "transparent");
      assert.equal(marco.summary, "⏰ DEADLINE: [PO] Relatório");
      assert.equal(marco.extendedProperties.private.squadone_tipo, "deadline");
      assert.equal(marco.extendedProperties.private.squadone_prazo_ref, undefined);
      assert.equal(b1.start.dateTime, iso("2026-09-14T09:00:00-03:00"));
      assert.equal(b2.start.dateTime, iso("2026-09-15T09:00:00-03:00"));
      assert.equal(b1.extendedProperties.private.squadone_prazo_ref, "ev1");
      assert.equal(b1.extendedProperties.private.squadone_tipo, "time_blocking");
      assert.equal(b1.transparency, undefined);
      assert.equal(b2.summary, "[PO] Relatório (bloco 2/2)");
      assert.equal(r.eventos[1].prazo_ref, "ev1");
      assert.equal(r.faltou_min, 0);
      assert.deepEqual(r.avisos, []);
    },
    async "prazo-com-hora-parcial"() {
      const chamadas = mockarGoogle({ itens: [hora("2026-09-14T11:00:00-03:00", "2026-09-14T19:00:00-03:00")] });
      const r = await agendarCompromisso(pedido({ titulo: "Proposta", tipo: "deadline", prazo_final: "2026-09-14T18:00:00-03:00", esforco_min: 300 }, novaAgenda()));
      const [marco] = posts(chamadas);
      assert.equal(marco.start.dateTime, iso("2026-09-14T17:45:00-03:00"));
      assert.equal(marco.end.dateTime, iso("2026-09-14T18:00:00-03:00"));
      assert.equal(marco.transparency, "transparent");
      assert.equal(r.eventos.length, 2);
      assert.equal(r.eventos[1].inicio, iso("2026-09-14T09:00:00-03:00"));
      assert.equal(r.eventos[1].fim, iso("2026-09-14T11:00:00-03:00"));
      assert.equal(r.faltou_min, 180);
      assert.match(r.avisos[0], /^Faltaram 3h de trabalho antes do prazo/);
    },
    async "prazo-sem-esforco"() {
      const chamadas = mockarGoogle();
      const r = await agendarCompromisso(pedido({ titulo: "x", tipo: "deadline", prazo_final: "2026-09-20" }, novaAgenda()));
      assert.equal(posts(chamadas).length, 1, "só o marco");
      assert.match(r.avisos[0], /Sem esforco_min/);
    },
    async "prazo-passado-ou-ausente"() {
      const chamadas = mockarGoogle();
      await assert.rejects(agendarCompromisso(pedido({ titulo: "x", tipo: "deadline", prazo_final: "2026-09-13", esforco_min: 60 }, novaAgenda())), /já passou/);
      await assert.rejects(agendarCompromisso(pedido({ titulo: "x", tipo: "deadline", esforco_min: 60 }, novaAgenda())), /prazo_final' é obrigatório/);
      assert.equal(posts(chamadas).length, 0);
    },
    async "prazo-bloco-falha-para-a-serie"() {
      const chamadas = mockarGoogle({ falharPostN: 3 });
      const r = await agendarCompromisso(pedido({ titulo: "x", tipo: "deadline", prazo_final: "2026-09-18", esforco_min: 360 }, novaAgenda()));
      assert.equal(posts(chamadas).length, 3, "marco, bloco 1, bloco 2 (falha) e para");
      assert.deepEqual(r.eventos.map((e: any) => e.papel), ["marco", "bloco"]);
      assert.equal(r.faltou_min, 240);
      assert.match(r.avisos[0], /O bloco 2\/3 não foi criado/);
    },
    async "marco-falha-nada-criado"() {
      mockarGoogle({ falharPostN: 1 });
      await assert.rejects(
        agendarCompromisso(pedido({ titulo: "x", tipo: "deadline", prazo_final: "2026-09-18", esforco_min: 120 }, novaAgenda())),
        /Google Calendar respondeu 429/,
      );
    },
    async "forcado-prazo-com-inicio-fixo"() {
      const chamadas = mockarGoogle();
      const r = await agendarCompromisso(pedido({ titulo: "x", tipo: "time_blocking", inicio_fixo: "2026-09-15T14:00:00-03:00", duracao_min: 120 }, novaAgenda(), "deadline"));
      assert.equal(r.tipo, "deadline");
      assert.equal(posts(chamadas)[0].end.dateTime, iso("2026-09-15T16:00:00-03:00"), "limite = fim do bloco descrito");
      assert.equal(r.eventos.length, 2, "duracao_min vira esforço: marco + 1 bloco de 120");
    },
    async "forcado-foco-respeita-prazo-como-limite"() {
      mockarGoogle({ itens: [hora("2026-09-14T09:00:00-03:00", "2026-09-14T12:00:00-03:00")] });
      await assert.rejects(
        agendarCompromisso(pedido({ titulo: "x", tipo: "deadline", prazo_final: "2026-09-14T12:00:00-03:00", esforco_min: 60 }, novaAgenda(), "time_blocking")),
        (e: any) => e.name === "SemHorarioLivre",
      );
    },
    async "sem-token-nao-chama-google"() {
      const chamadas = mockarGoogle();
      await assert.rejects(
        agendarCompromisso(pedido({ titulo: "x", tipo: "time_blocking" }, novaAgenda(null))),
        (e: any) => e?.constructor?.name === "PrecisaConectar",
      );
      assert.equal(chamadas.length, 0);
    },
    async "prioridade-e-formato"() {
      const f = "America/Sao_Paulo";
      assert.deepEqual(prioridadeDeAgendamento({ tipo: "time_blocking", inicio_fixo: "2026-09-14T10:00:00-03:00" }, null, f), [0, 0]);
      assert.deepEqual(prioridadeDeAgendamento({ tipo: "time_blocking", inicio_fixo: "2026-09-14" }, null, f), [1, 0]);
      assert.deepEqual(prioridadeDeAgendamento({ tipo: "time_blocking" }, null, f), [1, 0]);
      assert.deepEqual(prioridadeDeAgendamento({ tipo: "deadline", prazo_final: "2026-09-16" }, null, f), [2, Date.parse("2026-09-16T00:00:00-03:00")]);
      assert.deepEqual(prioridadeDeAgendamento({ tipo: "time_blocking" }, "deadline", f), [2, Number.MAX_SAFE_INTEGER]);
      assert.equal(formatarMinutos(45), "45 min");
      assert.equal(formatarMinutos(180), "3h");
      assert.equal(formatarMinutos(435), "7h15");
    },
  });
}

main().catch((e) => { console.error("FALHOU agendamento:", e); process.exit(1); });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase3" && "$TSX" agendamento.ts
```

Esperado: `FALHOU agendamento:` (módulo não existe).

- [ ] **Step 3: Implementar `server/agendamento.ts`**

```ts
import {
  alocar,
  BLOCO_MIN,
  BLOCOS_MAX,
  conflitos,
  dentroDaJanela,
  descreverJanela,
  DURACAO_MAX_MIN,
  ESFORCO_MAX_MIN,
  GRADE_MIN,
  HORIZONTE_DIAS,
  instanteLocal,
  lerInstante,
  proximoDia,
  type DataLocal,
  type Intervalo,
} from "./alocador.ts";
import { ErroCalendario, marcasDoEvento, PREFIXO_DEADLINE, urlDeEventos } from "./calendar.ts";
import type { AgendaDoTurno } from "./agenda.ts";

export type TipoEvento = "time_blocking" | "deadline";

export interface EventoCriado {
  kind: "evento";
  titulo: string;
  responsavel_id: string;
  tipo: TipoEvento;
  dominio: string;
  /** ISO do instante; `AAAA-MM-DD` quando `dia_inteiro`. */
  inicio: string;
  /** ISO do instante; `AAAA-MM-DD` EXCLUSIVO quando `dia_inteiro` (como o Google). */
  fim: string;
  dia_inteiro: boolean;
  /** foco = bloco avulso; marco = o prazo; bloco = trabalho antes de um marco. */
  papel: "foco" | "marco" | "bloco";
  /** eventId do marco, só em `papel: "bloco"`. */
  prazo_ref?: string;
  eventId: string;
  htmlLink?: string;
}

/** Resultado de UMA chamada de agendar_evento: um compromisso, 1..N eventos. */
export interface CompromissoAgendado {
  kind: "compromisso";
  titulo: string;
  responsavel_id: string;
  tipo: TipoEvento;
  dominio: string;
  /** Na ordem de criação: foco = [bloco]; prazo = [marco, ...blocos]. */
  eventos: EventoCriado[];
  /** O que foi feito mas não saiu como pedido (conflito, esforço parcial...). */
  avisos: string[];
  /** Minutos do esforço sem bloco reservado. 0 para foco. */
  faltou_min: number;
}

export interface PedidoDeCompromisso {
  args: Record<string, any>;
  /** Tipo imposto pelo toggle; null = o modelo escolheu. */
  tipoForcado: TipoEvento | null;
  squadId: string;
  calendarId: string;
  dominio: { id: string; nome: string };
  pessoa: { id: string; nome: string; papel: string };
  colorId: string;
  agenda: AgendaDoTurno;
}

const MIN_MS = 60_000;

const preenchido = (v: unknown) => v != null && String(v).trim() !== "";

function positivo(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const arredondar15 = (min: number) => Math.ceil(min / GRADE_MIN) * GRADE_MIN;

const dataTexto = (d: DataLocal) =>
  `${d.ano}-${String(d.mes).padStart(2, "0")}-${String(d.dia).padStart(2, "0")}`;

export function formatarMinutos(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function exigirInstante(valor: unknown, campo: string, fuso: string) {
  const lido = lerInstante(valor, fuso);
  if (!lido) {
    throw new Error(
      `Campo '${campo}' não é data (AAAA-MM-DD) nem data/hora ISO válida: ${String(valor)}`,
    );
  }
  return lido;
}

/**
 * Ordem em que os agendar_evento de um turno são alocados. Horário fixo
 * primeiro (o usuário já decidiu; os outros desviam dele), depois foco (o
 * "agora" é o que mais perde com a espera), depois prazos do mais próximo ao
 * mais distante. Empate: a ordem em que o modelo chamou.
 */
export function prioridadeDeAgendamento(
  args: Record<string, any>,
  tipoForcado: TipoEvento | null,
  fuso: string,
): [number, number] {
  const tipo = tipoForcado ?? (args.tipo === "deadline" ? "deadline" : "time_blocking");
  if (tipo === "time_blocking") {
    const fixo = preenchido(args.inicio_fixo) ? lerInstante(args.inicio_fixo, fuso) : null;
    return [fixo && fixo.data === null ? 0 : 1, 0];
  }
  const prazo = lerInstante(args.prazo_final, fuso);
  return [2, prazo ? prazo.instante : Number.MAX_SAFE_INTEGER];
}

async function gravar(
  p: PedidoDeCompromisso,
  corpo: Record<string, unknown>,
): Promise<{ id: string; htmlLink?: string }> {
  const resp = await fetch(urlDeEventos(p.calendarId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.agenda.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) throw new ErroCalendario(resp.status, await resp.text().catch(() => ""));
  return (await resp.json()) as { id: string; htmlLink?: string };
}

/**
 * Um compromisso do modelo vira eventos no Google, com o horário escolhido
 * AQUI. O modelo só disse a intenção (tipo, duração/esforço, até quando).
 */
export async function agendarCompromisso(p: PedidoDeCompromisso): Promise<CompromissoAgendado> {
  // Antes de tudo: sem agenda não há o que alocar, e o erro já vem classificado.
  const ocupacao = await p.agenda.ocupacao();
  const { janela } = p.agenda;
  const fuso = janela.fuso;
  const agora = p.agenda.agora.getTime();
  const { args, pessoa, dominio } = p;

  const titulo = String(args.titulo ?? "").trim();
  if (!titulo) throw new Error("Campo 'titulo' vazio.");
  const tipo: TipoEvento =
    p.tipoForcado ?? (args.tipo === "deadline" ? "deadline" : "time_blocking");
  const avisos: string[] = [];
  const base = {
    titulo,
    responsavel_id: pessoa.id,
    tipo,
    dominio: dominio.id,
  };
  const descricao =
    `Criado pelo SquadOne. Domínio: ${dominio.nome}. ` +
    `Responsável: ${pessoa.nome} (${pessoa.papel}).`;

  const aPartirDe = preenchido(args.a_partir_de)
    ? exigirInstante(args.a_partir_de, "a_partir_de", fuso).instante
    : undefined;

  if (tipo === "time_blocking") {
    // Com o toggle forçando foco, o modelo pode ter pensado em prazo e mandado
    // só esforco_min: é a melhor pista de quanto tempo reservar.
    let duracao = arredondar15(
      positivo(args.duracao_min) ?? (p.tipoForcado ? positivo(args.esforco_min) : null) ?? 60,
    );
    if (duracao > DURACAO_MAX_MIN) {
      avisos.push(`Duração de ${formatarMinutos(duracao)} reduzida para ${formatarMinutos(DURACAO_MAX_MIN)}.`);
      duracao = DURACAO_MAX_MIN;
    }

    let slot: Intervalo;
    const fixo = preenchido(args.inicio_fixo)
      ? exigirInstante(args.inicio_fixo, "inicio_fixo", fuso)
      : null;
    if (fixo && fixo.data === null) {
      // O usuário disse a hora: respeita. Conflito é informação, não veto.
      slot = { inicio: fixo.instante, fim: fixo.instante + duracao * MIN_MS };
      if (slot.inicio < agora) avisos.push("O horário fixo pedido já passou.");
      if (slot.fim > agora + HORIZONTE_DIAS * 24 * 3600_000) {
        avisos.push(`Conflito não verificado: o horário fica além dos ${HORIZONTE_DIAS} dias lidos da agenda.`);
      } else {
        const colisoes = conflitos(ocupacao, slot);
        if (colisoes.length) {
          avisos.push(`O horário fixo conflita com ${colisoes.length} compromisso(s) já na agenda.`);
        }
      }
      if (!dentroDaJanela(slot, janela)) {
        avisos.push(`O horário fixo fica fora da janela de trabalho ${descreverJanela(janela)}.`);
      }
    } else {
      if (duracao > janela.fimMin - janela.inicioMin) {
        throw new Error(
          `duracao_min ${duracao} não cabe na janela de trabalho ${descreverJanela(janela)}.`,
        );
      }
      // `inicio_fixo` só com data (sem hora) não fixou horário: vale como a_partir_de.
      const limite =
        p.tipoForcado && preenchido(args.prazo_final)
          ? limiteDoTrabalho(exigirInstante(args.prazo_final, "prazo_final", fuso), janela.fimMin, fuso)
          : undefined;
      const { slots } = alocar(
        ocupacao,
        janela,
        { tipo: "foco", duracaoMin: duracao, aPartirDe: fixo?.instante ?? aPartirDe, limite },
        agora,
      );
      slot = slots[0];
    }

    const criado = await gravar(p, {
      summary: `[${pessoa.papel}] ${titulo}`,
      description: descricao,
      colorId: p.colorId,
      start: { dateTime: new Date(slot.inicio).toISOString() },
      end: { dateTime: new Date(slot.fim).toISOString() },
      extendedProperties: {
        private: marcasDoEvento({ squadId: p.squadId, dominioId: dominio.id, pessoaId: pessoa.id, tipo }),
      },
    });
    p.agenda.reservar(slot);
    return {
      kind: "compromisso",
      ...base,
      eventos: [{
        kind: "evento", ...base, papel: "foco", dia_inteiro: false,
        inicio: new Date(slot.inicio).toISOString(), fim: new Date(slot.fim).toISOString(),
        eventId: criado.id, htmlLink: criado.htmlLink,
      }],
      avisos,
      faltou_min: 0,
    };
  }

  // --- deadline: marco no prazo + blocos antes ---------------------------
  let prazo: { instante: number; data: DataLocal | null };
  if (preenchido(args.prazo_final)) {
    prazo = exigirInstante(args.prazo_final, "prazo_final", fuso);
  } else if (p.tipoForcado && preenchido(args.inicio_fixo)) {
    // Toggle forçou prazo e o modelo descreveu um bloco: o limite é o FIM
    // do bloco descrito (regra da Fase 0).
    const fixo = exigirInstante(args.inicio_fixo, "inicio_fixo", fuso);
    prazo = fixo.data
      ? fixo
      : { instante: fixo.instante + (positivo(args.duracao_min) ?? 0) * MIN_MS, data: null };
  } else {
    throw new Error("Campo 'prazo_final' é obrigatório quando tipo='deadline'.");
  }

  const fimDoMarco = prazo.data
    ? instanteLocal(proximoDia(prazo.data), 0, fuso)
    : prazo.instante;
  if (fimDoMarco <= agora) throw new Error(`prazo_final ${String(args.prazo_final ?? args.inicio_fixo)} já passou.`);

  const esforcoBruto =
    positivo(args.esforco_min) ?? (p.tipoForcado ? positivo(args.duracao_min) : null);
  let slots: Intervalo[] = [];
  let faltou = 0;
  if (esforcoBruto === null) {
    avisos.push("Sem esforco_min estimado: só o marco do prazo foi criado, nenhum bloco de trabalho.");
  } else {
    let esforco = Math.max(BLOCO_MIN, arredondar15(esforcoBruto));
    if (esforco > ESFORCO_MAX_MIN) {
      avisos.push(`Esforço de ${formatarMinutos(esforco)} reduzido para ${formatarMinutos(ESFORCO_MAX_MIN)}.`);
      esforco = ESFORCO_MAX_MIN;
    }
    const alocacao = alocar(
      ocupacao,
      janela,
      { tipo: "blocos", esforcoMin: esforco, aPartirDe, limite: limiteDoTrabalho(prazo, janela.fimMin, fuso) },
      agora,
    );
    slots = alocacao.slots;
    faltou = alocacao.faltouMin;
    if (faltou > 0) {
      avisos.push(
        `Faltaram ${formatarMinutos(faltou)} de trabalho antes do prazo: não coube em horário ` +
          `livre da janela ${descreverJanela(janela)} (até ${BLOCOS_MAX} blocos por prazo).`,
      );
    }
  }

  // Marco primeiro: os blocos apontam para o eventId dele. Se o marco falha,
  // nada foi criado e o compromisso inteiro vira erro.
  const marcoCorpo = {
    summary: `${PREFIXO_DEADLINE} [${pessoa.papel}] ${titulo}`,
    description: `${descricao} Prazo final.`,
    colorId: p.colorId,
    // Marco não é trabalho: não ocupa a agenda.
    transparency: "transparent",
    ...(prazo.data
      ? { start: { date: dataTexto(prazo.data) }, end: { date: dataTexto(proximoDia(prazo.data)) } }
      : {
          start: { dateTime: new Date(prazo.instante - 15 * MIN_MS).toISOString() },
          end: { dateTime: new Date(prazo.instante).toISOString() },
        }),
    extendedProperties: {
      private: marcasDoEvento({ squadId: p.squadId, dominioId: dominio.id, pessoaId: pessoa.id, tipo: "deadline" }),
    },
  };
  const marco = await gravar(p, marcoCorpo);
  const eventos: EventoCriado[] = [{
    kind: "evento", ...base, tipo: "deadline", papel: "marco",
    dia_inteiro: prazo.data !== null,
    inicio: prazo.data ? dataTexto(prazo.data) : new Date(prazo.instante - 15 * MIN_MS).toISOString(),
    fim: prazo.data ? dataTexto(proximoDia(prazo.data)) : new Date(prazo.instante).toISOString(),
    eventId: marco.id, htmlLink: marco.htmlLink,
  }];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const rotulo = `bloco ${i + 1}/${slots.length}`;
    try {
      const bloco = await gravar(p, {
        summary: `[${pessoa.papel}] ${titulo} (${rotulo})`,
        description: `${descricao} Trabalho para o prazo "${titulo}" (${rotulo}).`,
        colorId: p.colorId,
        start: { dateTime: new Date(slot.inicio).toISOString() },
        end: { dateTime: new Date(slot.fim).toISOString() },
        extendedProperties: {
          private: marcasDoEvento({
            squadId: p.squadId, dominioId: dominio.id, pessoaId: pessoa.id,
            tipo: "time_blocking", prazoRef: marco.id,
          }),
        },
      });
      p.agenda.reservar(slot);
      eventos.push({
        kind: "evento", ...base, tipo: "time_blocking", papel: "bloco", dia_inteiro: false,
        inicio: new Date(slot.inicio).toISOString(), fim: new Date(slot.fim).toISOString(),
        prazo_ref: marco.id, eventId: bloco.id, htmlLink: bloco.htmlLink,
      });
    } catch (err: any) {
      // Não desfaz o que já foi gravado: o marco e os blocos anteriores
      // continuam certos. Para aqui para não abrir buracos no meio da série.
      const semReserva = slots.slice(i).reduce((s, x) => s + (x.fim - x.inicio) / MIN_MS, 0);
      faltou += semReserva;
      avisos.push(
        `O ${rotulo} não foi criado (${err?.message ?? String(err)}); ` +
          `${formatarMinutos(semReserva)} ficaram sem reserva.`,
      );
      break;
    }
  }

  return { kind: "compromisso", ...base, eventos, avisos, faltou_min: faltou };
}

/**
 * Até quando pode haver trabalho para um prazo. Com hora: o próprio prazo.
 * Só com data: o fim da janela daquele dia — "até sexta" inclui a sexta.
 */
function limiteDoTrabalho(
  prazo: { instante: number; data: DataLocal | null },
  fimJanelaMin: number,
  fuso: string,
): number {
  return prazo.data ? instanteLocal(prazo.data, fimJanelaMin, fuso) : prazo.instante;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd "$SCRATCH/fase3" && "$TSX" agendamento.ts && "$TSX" ocupacao.ts && "$TSX" alocador.ts | tail -1
```

Esperado: 15 `OK   ...` + `OK agendamento`, depois `OK ocupacao`, depois `OK alocador: 23 casos`.

- [ ] **Step 5: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
cd "$REPO" && git add server/agendamento.ts && git commit -m "$(cat <<'EOF'
feat(agenda): transformar compromisso em foco ou marco + blocos

Foco reserva um bloco no proximo horario livre; horario fixo do usuario e
respeitado e conflito vira aviso. Prazo grava o marco transparente primeiro
(dia inteiro sem hora, 15 min terminando no prazo com hora) e depois os blocos,
um POST por vez, cada um com squadone_prazo_ref do marco.

Nao coube antes do prazo: cria o que coube e avisa quanto faltou, porque o
marco e o trabalho parcial valem mais que nada. Bloco que falha para a serie
sem apagar o que ja foi gravado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Ligar ao turno — capacidade, série, prompt e rota

**Releia `server/capabilities.ts`, `server/orchestrator.ts` e `server.ts` inteiros antes de começar**: a Fase 2 pode ter mudado propostas, `CapabilityResult`, o prompt e rotas. Preserve tudo que não é `agendar_evento`, a regra de tipo do prompt, a execução das calls e `/api/orquestrar`.

**Files:**
- Modify: `server/capabilities.ts`
- Modify: `server/orchestrator.ts`
- Modify: `server.ts`
- Modify: `.env.example`
- Test: `$SCRATCH/fase3/turno.ts`, `$SCRATCH/fase3/prompt.ts`, `$SCRATCH/fase3/http.ts`

**Interfaces:**
- Consumes: Tasks 1–3; Fase 1 (`CapabilityContext`, `PedidoDeTurno`, `ContextoDoPrompt`, `resolverSquad`, `responderErroDeRoster`).
- Produces:
  - `capabilities.ts`: `tipoForcado(modo: Modo): TipoEvento | null`; `CapabilityContext.agenda: AgendaDoTurno`; re-export `type { CompromissoAgendado, EventoCriado }`; `CapabilityResult` com `CompromissoAgendado` no lugar de `EventoCriado`.
  - `orchestrator.ts`: `type MotivoDeErro`; `ErroTarefa.motivo?: MotivoDeErro`; `interface AvisoTarefa { capacidade: string; titulo: string; aviso: string }`; `TurnoResult.avisos: AvisoTarefa[]`; `motivoDoErro(err: unknown): MotivoDeErro | undefined`; `ContextoDoPrompt.janela: string`; `PedidoDeTurno` com `falhaDoToken: unknown`, `janela: Janela`, `agora?: Date`.
  - HTTP: `/api/orquestrar` → 500 `{ error, configuracao: true }` para janela ilegível, antes do token e do Gemini; 200 `TurnoResult` com `avisos`.

- [ ] **Step 1: Escrever os scripts**

`$SCRATCH/fase3/turno.ts`:

```ts
import assert from "node:assert/strict";
import { dt, importar, iso, mockarGoogle, prepararDiretorio, rodarCenarios, type Chamada } from "./harness.ts";

const pessoa = (id: string, nome: string, papel = "PO") => ({
  id, nome, papel, escopo: "tudo", sprite: "wraith_01", hiredAt: "2026-09-11T09:00:00-03:00",
});

/** Roster v3 mínimo: uma squad, um domínio, um PO, slot [1,0] livre para proposta. */
const ROSTER = {
  version: 3,
  idsAposentados: { pessoas: [], dominios: [] },
  squads: [{
    id: "pessoal", nome: "Pessoal", escopo: "vida pessoal", calendarId: "primary",
    unlockOrder: [[0, 0], [1, 0], [0, 1]],
    dominios: [{
      id: "casa", nome: "Casa", escopo: "casa", slot: [0, 0], room: "ROOM_SOLO",
      criadoEm: "2026-09-11T09:00:00-03:00", po: pessoa("romulo", "Rômulo"), integrantes: [],
    }],
  }],
};

/** Duas squads: a troca precisa de um destino que exista. */
const ROSTER_DUAS = {
  ...ROSTER,
  squads: [
    ...ROSTER.squads,
    {
      id: "outra", nome: "Outra", escopo: "trabalho", calendarId: "primary",
      unlockOrder: [[0, 0], [1, 0], [0, 1]],
      dominios: [{
        id: "outra--geral", nome: "Geral", escopo: "trabalho", slot: [0, 0], room: "ROOM_SOLO",
        criadoEm: "2026-09-12T09:00:00-03:00", po: pessoa("bia", "Bia"), integrantes: [],
      }],
    },
  ],
};

/** Gemini falso: devolve as chamadas dadas, sem rede. */
function iaFalsa(functionCalls: { name: string; args: Record<string, any> }[]) {
  return { models: { generateContent: async () => ({ functionCalls }) } } as any;
}

const PROPOSTA = { name: "criar_po_dominio", args: { dominio: "Financeiro", papel_po: "PO Financeiro", justificativa: "j", escopo: "contas" } };
const AGORA = new Date("2026-09-14T08:00:00-03:00"); // segunda

async function main() {
  await prepararDiretorio();
  const { executarTurno } = await importar("server/orchestrator.ts");
  const { lerJanela } = await importar("server/alocador.ts");
  const janela = lerJanela({});

  const turno = (calls: any[], extra: Record<string, unknown> = {}) => {
    const roster = structuredClone(ROSTER);
    return executarTurno(iaFalsa(calls), {
      demanda: "demanda de teste", token: "tok", falhaDoToken: null, modo: "auto",
      roster, squad: roster.squads[0], janela, agora: AGORA, ...extra,
    });
  };
  const opacos = (c: Chamada[]) =>
    c.filter((x) => x.metodo === "POST" && x.corpo.transparency !== "transparent" && x.corpo.start.dateTime)
      .map((x) => ({ inicio: Date.parse(x.corpo.start.dateTime), fim: Date.parse(x.corpo.end.dateTime) }));

  await rodarCenarios("turno", {
    async "serie-sem-sobreposicao"() {
      const chamadas = mockarGoogle({
        itens: [
          { start: dt("2026-09-14T09:00:00-03:00"), end: dt("2026-09-14T10:00:00-03:00") },
          { transparency: "transparent", start: dt("2026-09-14T10:00:00-03:00"), end: dt("2026-09-14T11:00:00-03:00") },
          { attendees: [{ self: true, responseStatus: "declined" }], start: dt("2026-09-14T11:00:00-03:00"), end: dt("2026-09-14T12:00:00-03:00") },
          { start: { date: "2026-09-14" }, end: { date: "2026-09-15" } },
        ],
      });
      const r = await turno([
        { name: "agendar_evento", args: { titulo: "Relatório", responsavel_id: "romulo", tipo: "deadline", prazo_final: "2026-09-16", esforco_min: 120 } },
        { name: "agendar_evento", args: { titulo: "Estudar", responsavel_id: "romulo", tipo: "time_blocking", duracao_min: 60 } },
        PROPOSTA,
        { name: "agendar_evento", args: { titulo: "Reunião", responsavel_id: "romulo", tipo: "time_blocking", inicio_fixo: "2026-09-14T10:00:00-03:00", duracao_min: 60 } },
      ]);
      assert.deepEqual(r.erros, []);
      assert.deepEqual(r.avisos, []);
      assert.equal(r.sugestoes.length, 1);
      assert.equal(chamadas.filter((c) => c.metodo === "GET").length, 1, "uma leitura de agenda por turno");
      assert.deepEqual(
        chamadas.filter((c) => c.metodo === "POST").map((c) => c.corpo.summary),
        ["[PO] Reunião", "[PO] Estudar", "⏰ DEADLINE: [PO] Relatório", "[PO] Relatório (bloco 1/1)"],
        "fixo, depois foco, depois prazo",
      );
      assert.deepEqual(
        r.eventos_criados.map((e: any) => [e.titulo, e.papel, e.inicio]),
        [
          ["Relatório", "marco", "2026-09-16"],
          ["Relatório", "bloco", iso("2026-09-14T12:00:00-03:00")],
          ["Estudar", "foco", iso("2026-09-14T11:00:00-03:00")],
          ["Reunião", "foco", iso("2026-09-14T10:00:00-03:00")],
        ],
        "resultados na ordem das chamadas do modelo",
      );
      const slots = opacos(chamadas);
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          assert.ok(slots[i].fim <= slots[j].inicio || slots[j].fim <= slots[i].inicio, `sobreposição entre POST ${i} e ${j}`);
        }
      }
    },
    async "sem-credencial"() {
      const chamadas = mockarGoogle();
      const r = await turno(
        [
          { name: "agendar_evento", args: { titulo: "a", responsavel_id: "romulo", tipo: "time_blocking" } },
          PROPOSTA,
          { name: "agendar_evento", args: { titulo: "b", responsavel_id: "romulo", tipo: "deadline", prazo_final: "2026-09-16", esforco_min: 60 } },
        ],
        { token: null, falhaDoToken: null },
      );
      assert.equal(r.erros.length, 2);
      assert.ok(r.erros.every((e: any) => e.motivo === "precisaConectar"), JSON.stringify(r.erros));
      assert.equal(r.sugestoes.length, 1, "proposta não depende do Google");
      assert.equal(chamadas.length, 0);
    },
    async "leitura-recusada"() {
      const chamadas = mockarGoogle({ statusLista: 401 });
      const r = await turno([
        { name: "agendar_evento", args: { titulo: "a", responsavel_id: "romulo", tipo: "time_blocking" } },
        { name: "agendar_evento", args: { titulo: "b", responsavel_id: "romulo", tipo: "time_blocking" } },
      ]);
      assert.deepEqual(r.erros.map((e: any) => e.motivo), ["precisaConectar", "precisaConectar"]);
      assert.equal(chamadas.length, 1);
    },
    async "sem-horario-classificado"() {
      mockarGoogle({ itens: [{ start: dt("2026-09-01T00:00:00-03:00"), end: dt("2026-12-01T00:00:00-03:00") }] });
      const r = await turno([{ name: "agendar_evento", args: { titulo: "a", responsavel_id: "romulo", tipo: "time_blocking" } }]);
      assert.equal(r.erros[0].motivo, "semHorarioLivre");
    },
    async "avisos-sobem-para-o-turno"() {
      mockarGoogle({ itens: [{ start: dt("2026-09-14T11:00:00-03:00"), end: dt("2026-09-14T19:00:00-03:00") }] });
      const r = await turno([{ name: "agendar_evento", args: { titulo: "Proposta", responsavel_id: "romulo", tipo: "deadline", prazo_final: "2026-09-14T18:00:00-03:00", esforco_min: 300 } }]);
      assert.equal(r.avisos.length, 1);
      assert.equal(r.avisos[0].capacidade, "agendar_evento");
      assert.equal(r.avisos[0].titulo, "Proposta");
      assert.match(r.avisos[0].aviso, /^Faltaram 3h/);
    },
    async "responsavel-invalido-nao-le-agenda"() {
      const chamadas = mockarGoogle();
      const r = await turno([{ name: "agendar_evento", args: { titulo: "a", responsavel_id: "ninguem", tipo: "time_blocking" } }]);
      assert.equal(r.erros.length, 1);
      assert.equal(r.erros[0].motivo, undefined);
      assert.equal(chamadas.length, 0);
    },
    async "modo-forcado-chega-no-handler"() {
      const chamadas = mockarGoogle();
      const r = await turno(
        [{ name: "agendar_evento", args: { titulo: "a", responsavel_id: "romulo", tipo: "time_blocking", prazo_final: "2026-09-18", esforco_min: 120 } }],
        { modo: "prazo" },
      );
      assert.deepEqual(r.eventos_criados.map((e: any) => e.papel), ["marco", "bloco"]);
      assert.equal(chamadas.filter((c) => c.metodo === "POST")[0].corpo.transparency, "transparent");
    },
    async "troca-descarta-agendamentos"() {
      // Regra da Fase 1 com a série: descartadas nem leem a agenda.
      const chamadas = mockarGoogle();
      const r = await turno([
        { name: "agendar_evento", args: { titulo: "a", responsavel_id: "romulo", tipo: "time_blocking" } },
        { name: "sugerir_troca_squad", args: { squad_id: "outra", justificativa: "j" } },
        { name: "agendar_evento", args: { titulo: "b", responsavel_id: "romulo", tipo: "deadline", prazo_final: "2026-09-16", esforco_min: 60 } },
      ], { roster: ROSTER_DUAS, squad: ROSTER_DUAS.squads[0] });
      assert.equal(chamadas.length, 0, "agendamento descartado chegou ao Google");
      assert.deepEqual(r.eventos_criados, []);
      assert.equal(r.sugestoes.length, 1);
      assert.equal(r.sugestoes[0].kind, "troca_squad");
      assert.equal(r.erros.length, 2);
      assert.ok(r.erros.every((e: any) => e.descartado === true && e.capacidade === "agendar_evento"));
    },
    async "falha-isolada"() {
      const chamadas = mockarGoogle();
      const r = await turno([
        { name: "agendar_evento", args: { titulo: "a", responsavel_id: "romulo", tipo: "time_blocking", duracao_min: 60 } },
        { name: "agendar_evento", args: { titulo: "ruim", responsavel_id: "romulo", tipo: "deadline", prazo_final: "sexta que vem", esforco_min: 60 } },
        { name: "agendar_evento", args: { titulo: "c", responsavel_id: "romulo", tipo: "time_blocking", duracao_min: 30 } },
      ]);
      assert.equal(r.erros.length, 1);
      assert.equal(r.erros[0].args.titulo, "ruim");
      assert.equal(r.erros[0].motivo, undefined);
      assert.deepEqual(r.eventos_criados.map((e: any) => [e.titulo, e.inicio]), [
        ["a", iso("2026-09-14T09:00:00-03:00")],
        ["c", iso("2026-09-14T10:00:00-03:00")],
      ]);
      assert.equal(chamadas.filter((c) => c.metodo === "POST").length, 2);
    },
  });
}

main().catch((e) => { console.error("FALHOU turno:", e); process.exit(1); });
```

(Se a Fase 2 mudou a forma dos argumentos de `criar_po_dominio`, ajuste só a constante `PROPOSTA` para uma chamada válida de qualquer capacidade que devolve proposta sem tocar o Google.)

`$SCRATCH/fase3/prompt.ts`:

```ts
import assert from "node:assert/strict";
import { importar, prepararDiretorio } from "./harness.ts";

async function main() {
  await prepararDiretorio();
  const { buildSystemInstruction } = await importar("server/orchestrator.ts");
  const { CAPABILITIES } = await importar("server/capabilities.ts");
  const { descreverJanela, lerJanela } = await importar("server/alocador.ts");

  const contexto = {
    squadNome: "Pessoal", squadEscopo: "vida pessoal", arvore: "- domínio 'casa'",
    outrasSquads: "(nenhuma)", janela: descreverJanela(lerJanela({})),
  };
  const auto = buildSystemInstruction(contexto, "2026-09-14T09:00:00-03:00", "auto");
  for (const trecho of ["09:00–19:00 (seg, ter, qua, qui, sex)", "Você NÃO escolhe horário", "a_partir_de", "inicio_fixo", "esforco_min"]) {
    assert.ok(auto.includes(trecho), `prompt sem '${trecho}'`);
  }
  assert.ok(!auto.includes("com inicio e duracao_min"), "regra antiga de horário exato");
  assert.ok(!auto.includes("O usuário forçou"), "auto não força tipo");
  assert.ok(buildSystemInstruction(contexto, "x", "prazo").includes("com prazo_final e esforco_min"));
  assert.ok(buildSystemInstruction(contexto, "x", "foco").includes("tipo='time_blocking' para TODOS"));

  const props = Object.keys(CAPABILITIES.agendar_evento.declaration.parameters.properties).sort();
  assert.deepEqual(props, ["a_partir_de", "duracao_min", "esforco_min", "inicio_fixo", "prazo_final", "responsavel_id", "tipo", "titulo"]);
  assert.deepEqual(CAPABILITIES.agendar_evento.declaration.parameters.required, ["titulo", "responsavel_id", "tipo"]);
  console.log("OK prompt");
}

main().catch((e) => { console.error("FALHOU prompt:", e); process.exit(1); });
```

`$SCRATCH/fase3/http.ts`:

```ts
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:3918";

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/squad`)).status) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Servidor não subiu em 30s.");
}

async function main() {
  await esperarServidor();
  // O servidor sobe com JANELA_TRABALHO=19:00-09:00 e GEMINI_API_KEY=fake: a
  // janela tem que ser recusada ANTES do token e do Gemini. Se o Gemini fosse
  // chamado, a resposta seria outro erro, sem `configuracao`.
  const r = await fetch(`${BASE}/api/orquestrar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demanda: "estudar 1h" }),
  });
  assert.equal(r.status, 500);
  const corpo = await r.json();
  assert.equal(corpo.configuracao, true, JSON.stringify(corpo));
  assert.match(corpo.error, /JANELA_TRABALHO/);
  console.log("OK http");
}

main().catch((e) => { console.error("FALHOU http:", e); process.exit(1); });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase3" && "$TSX" turno.ts; "$TSX" prompt.ts
```

Esperado: `FALHOU` nos dois (sem `avisos` no turno; declaração ainda tem `inicio`).

- [ ] **Step 3: `server/capabilities.ts`**

1. Imports: acrescente

```ts
import type { AgendaDoTurno } from "./agenda.ts";
import { agendarCompromisso, type CompromissoAgendado, type TipoEvento } from "./agendamento.ts";
```

   e **remova** do import de `./calendar.ts` o que só `agendar_evento` usava (`marcasDoEvento`, `PREFIXO_DEADLINE`, `urlDeEventos`); remova `exigirData` se ficar sem uso.

2. Logo abaixo dos imports:

```ts
export type { CompromissoAgendado, EventoCriado } from "./agendamento.ts";
```

   e **apague** a `interface EventoCriado` local (ela mora em `agendamento.ts` agora).

3. `TIPO_FORCADO` passa a `Record<Modo, TipoEvento | null>` e ganha o acessor:

```ts
/** Tipo que o toggle impõe ao turno; null em `auto`. O orchestrator ordena por ele. */
export function tipoForcado(modo: Modo): TipoEvento | null {
  return TIPO_FORCADO[modo];
}
```

4. `CapabilityContext` ganha, preservando os campos da Fase 1/2:

```ts
  /**
   * Ocupação da agenda neste turno: lida uma vez, descontada a cada reserva.
   * É por ela que dois compromissos da mesma demanda não caem no mesmo horário.
   */
  agenda: AgendaDoTurno;
```

5. `CapabilityResult`: troque o membro `EventoCriado` por `CompromissoAgendado`; mantenha os demais.

6. Substitua a `declaration` inteira de `agendarEvento` pela da spec §3.1 (copie literalmente, com todas as `description`) e o `handler` por:

```ts
  async handler(args, ctx): Promise<CompromissoAgendado> {
    // Pessoa antes da agenda: id inventado pelo modelo não custa leitura do Google.
    const { pessoa, dominio } = exigirPessoa(ctx.squad, args.responsavel_id);
    const indice = ctx.squad.dominios.indexOf(dominio);
    // O horário sai do servidor (server/agendamento.ts): o modelo só disse a
    // intenção. Aqui fica o que é da squad — marcas, calendário, cor.
    return agendarCompromisso({
      args,
      tipoForcado: tipoForcado(ctx.modo),
      squadId: ctx.squad.id,
      calendarId: ctx.squad.calendarId,
      dominio,
      pessoa,
      colorId: CORES_POR_DOMINIO[indice % CORES_POR_DOMINIO.length],
      agenda: ctx.agenda,
    });
  },
```

   O comentário longo da Fase 0 sobre fallback de horário em modo forçado sai daqui: a regra agora mora em `agendarCompromisso` (§3.2).

- [ ] **Step 4: `server/orchestrator.ts`**

1. Imports: acrescente

```ts
import { ErroDeConfig, PrecisaConectar } from "./auth-store.ts";
import { AgendaDoTurno, AgendaIndisponivel } from "./agenda.ts";
import { descreverJanela, FUSO, SemHorarioLivre, type Janela } from "./alocador.ts";
import { prioridadeDeAgendamento } from "./agendamento.ts";
```

   e `tipoForcado` no import de `./capabilities.ts`. Troque `const TIMEZONE = "America/Sao_Paulo";` por `const TIMEZONE = FUSO;` (uma fonte só do fuso).

2. Tipos do turno. **Acrescente** campos; não substitua as interfaces (a Fase 1 pôs `descartado?: true` em `ErroTarefa`, e ele fica):
   - em `ErroTarefa`, depois de `descartado`:

```ts
  /** Por que falhou, quando a UI tem um gesto certo para isso. Ausente = sem gesto específico. */
  motivo?: MotivoDeErro;
```

   - em `TurnoResult`, entre `sugestoes` e `erros`: `avisos: AvisoTarefa[];`
   - logo abaixo de `ErroTarefa`:

```ts
/** Por que uma tarefa falhou, quando a UI tem um gesto certo para isso. */
export type MotivoDeErro = "precisaConectar" | "configuracao" | "semHorarioLivre" | "agendaIndisponivel";

/** Algo que foi feito, mas não exatamente como pedido. Não é falha. */
export interface AvisoTarefa {
  capacidade: string;
  titulo: string;
  aviso: string;
}

/**
 * Classificação para a UI decidir o gesto. `AgendaIndisponivel` de credencial
 * é o mesmo gesto que `PrecisaConectar`: reconectar.
 */
export function motivoDoErro(err: unknown): MotivoDeErro | undefined {
  if (err instanceof PrecisaConectar) return "precisaConectar";
  if (err instanceof ErroDeConfig) return "configuracao";
  if (err instanceof SemHorarioLivre) return "semHorarioLivre";
  if (err instanceof AgendaIndisponivel) return err.credencial ? "precisaConectar" : "agendaIndisponivel";
  return undefined;
}
```

3. `ContextoDoPrompt` ganha:

```ts
  /** Janela de trabalho legível (`descreverJanela`): o modelo precisa saber que o horário não é dele. */
  janela: string;
```

4. Em `buildSystemInstruction`:
   - `regraModo`:

```ts
  const regraModo =
    modo === "foco"
      ? `\n- O usuário forçou tipo='time_blocking' para TODOS os compromissos desta
  demanda: use-o em toda chamada de agendar_evento, com duracao_min.`
      : modo === "prazo"
        ? `\n- O usuário forçou tipo='deadline' para TODOS os compromissos desta
  demanda: use-o em toda chamada de agendar_evento, com prazo_final e esforco_min.`
        : "";
```

   - o parágrafo `Agora são ... no mesmo formato.` vira:

```
Agora são ${agoraISO} (fuso ${TIMEZONE}). Datas que você produzir: AAAA-MM-DD
quando o usuário não disse hora; com hora, ISO 8601 com offset no mesmo formato.

Você NÃO escolhe horário. O servidor lê a agenda do usuário e reserva o próximo
horário livre dentro da janela de trabalho ${contexto.janela}, sem colidir com o
que já está lá. Você diz a intenção: o quê, quem, quanto tempo e até quando.
```

   - a regra que começa com `- Use tipo='time_blocking' (com inicio e duracao_min)` (termina em `${regraModo}`) vira:

```
- tipo='time_blocking' quando o usuário precisa de um bloco para executar: mande
  duracao_min. Se ele disse QUANDO sem hora ("amanhã", "segunda"), mande
  a_partir_de com a data. Só se ele disse a HORA ("amanhã às 14h"), mande
  inicio_fixo com data/hora.
- tipo='deadline' quando há uma data limite de entrega: mande prazo_final e
  esforco_min, sua estimativa realista do trabalho TOTAL até lá, em minutos. O
  servidor cria o marco no prazo e divide o esforço em blocos antes dele. Não
  chame agendar_evento de novo para os blocos.${regraModo}
```

   Nada mais no prompt muda.

5. `PedidoDeTurno` ganha:

```ts
  /** Por que não há token (a exceção de `tokenValido()`); ausente/null quando há. */
  falhaDoToken?: unknown;
  /**
   * Janela de trabalho já validada pela rota. Ausente = padrão (09:00–19:00,
   * seg–sex): chamadores anteriores à Fase 3 (scripts da Fase 1) continuam válidos.
   */
  janela?: Janela;
  /** Relógio do turno. A rota não passa; scripts de verificação fixam. */
  agora?: Date;
```

6. `executarTurno`:
   - desestruture `falhaDoToken`; `const janela = pedido.janela ?? lerJanela({});` (importe `lerJanela`); troque `const agora = new Date();` por `const agora = pedido.agora ?? new Date();`;
   - no `buildSystemInstruction`, acrescente `janela: descreverJanela(janela)` ao contexto;
   - troque a montagem do `ctx` e o bloco `Promise.all(calls.map(...))` + montagem do `turno` por:

```ts
  const calls: FunctionCall[] = response.functionCalls ?? [];
  const agenda = new AgendaDoTurno({ token, falhaDoToken, janela, agora });
  const ctx: CapabilityContext = { token, roster, squad, agora, modo, demanda, agenda };

  // Decidido ANTES de executar qualquer chamada (regra da Fase 1): com troca de
  // squad no turno, as outras chamadas são descartadas, inclusive agendamentos.
  const temTroca = calls.some((c) => c.name === TROCA_DE_SQUAD);

  // One-shot: executa as calls e acaba. Sem realimentar o modelo.
  // Um try POR TAREFA: uma tarefa quebrada não pode matar o lote.
  const executar = async (call: FunctionCall): Promise<CapabilityResult | ErroTarefa> => {
    const nome = call.name ?? "";
    const args = (call.args ?? {}) as Record<string, any>;
    if (temTroca && nome !== TROCA_DE_SQUAD) return descartarPorTroca(nome, args);
    const capacidade = CAPABILITIES[nome];
    if (!capacidade) {
      return { capacidade: nome, args, erro: `Capacidade desconhecida: '${nome}'` };
    }
    try {
      return await capacidade.handler(args, ctx);
    } catch (err: any) {
      const motivo = motivoDoErro(err);
      return { capacidade: nome, args, erro: err?.message ?? String(err), ...(motivo ? { motivo } : {}) };
    }
  };

  // agendar_evento em SÉRIE, por prioridade: cada reserva precisa estar na
  // ocupação antes do próximo compromisso escolher horário. Em paralelo, dois
  // compromissos da mesma demanda liam a mesma agenda e caíam no mesmo slot.
  // O resto (propostas) não disputa agenda e segue em paralelo.
  const resultados: (CapabilityResult | ErroTarefa)[] = new Array(calls.length);
  const forcado = tipoForcado(modo);
  const deAgenda = calls
    .map((call, indice) => ({ call, indice }))
    .filter((x) => x.call.name === "agendar_evento")
    .map((x) => ({
      ...x,
      prioridade: prioridadeDeAgendamento((x.call.args ?? {}) as Record<string, any>, forcado, janela.fuso),
    }))
    .sort((a, b) => a.prioridade[0] - b.prioridade[0] || a.prioridade[1] - b.prioridade[1] || a.indice - b.indice);
  const emParalelo = Promise.all(
    calls.map(async (call, indice) => {
      if (call.name !== "agendar_evento") resultados[indice] = await executar(call);
    }),
  );
  for (const { call, indice } of deAgenda) resultados[indice] = await executar(call);
  await emParalelo;

  // Resultados na ordem em que o modelo chamou, não na ordem de alocação.
  const turno: TurnoResult = { eventos_criados: [], sugestoes: [], avisos: [], erros: [] };
  for (const r of resultados) {
    if ("erro" in r) turno.erros.push(r);
    else if (r.kind === "compromisso") {
      turno.eventos_criados.push(...r.eventos);
      for (const aviso of r.avisos) {
        turno.avisos.push({ capacidade: "agendar_evento", titulo: r.titulo, aviso });
      }
    } else turno.sugestoes.push({ ...r, id: randomUUID() });
  }
```

   Mantenha `TROCA_DE_SQUAD`, `descartarPorTroca`, o bloco `if (calls.length === 0)` e o `return turno`. Se a Fase 2 acrescentou outro `kind` que não é sugestão, ou outra regra de descarte dentro do `map`, preserve dentro de `executar`/do laço de montagem.

- [ ] **Step 5: `server.ts`**

1. Import: `import { descreverJanela, JanelaMalConfigurada, lerJanela } from "./server/alocador.ts";`

2. Em `POST /api/orquestrar`, logo depois de `const squad = resolverSquad(roster, squadId);`, troque o bloco que começa no comentário `// Sem credencial o turno ainda roda` e termina na linha `const turno = await executarTurno(ai, { demanda: demanda.trim(), token, modo, roster, squad });` por:

```ts
      // Janela antes do token e do Gemini: configuração quebrada não pode
      // custar uma chamada ao modelo para depois falhar no primeiro agendamento.
      const janela = lerJanela(process.env);

      // Sem credencial o turno ainda roda (propostas não tocam o Google), mas
      // o MOTIVO vai junto: agendar_evento devolve o erro classificado certo
      // em vez de um genérico "sem token".
      let token: string | null = null;
      let falhaDoToken: unknown = null;
      try {
        token = await tokenValido();
      } catch (err) {
        falhaDoToken = err;
      }
      const turno = await executarTurno(ai, {
        demanda: demanda.trim(), token, falhaDoToken, modo, roster, squad, janela,
      });
```

3. No `catch` de `/api/orquestrar` (não das outras rotas), depois de `if (responderErroDeRoster(res, error)) return;` e antes do teste de `ModeloOcupado`:

```ts
      if (error instanceof JanelaMalConfigurada) {
        return res.status(500).json({ error: error.message, configuracao: true });
      }
```

4. Em `startServer`, antes do `app.listen`:

```ts
  // A janela é lida a cada turno; logar no boot mostra no painel do Easypanel
  // o que vale agora, ou o erro, sem esperar alguém delegar uma quest.
  try {
    console.log(`Janela de trabalho: ${descreverJanela(lerJanela(process.env))}`);
  } catch (error: any) {
    console.error(`Janela de trabalho inválida: ${error.message}`);
  }
```

- [ ] **Step 6: `.env.example`**

Acrescente ao fim:

```
# JANELA_TRABALHO: horario em que o servidor pode alocar blocos, HH:MM-HH:MM,
# fuso America/Sao_Paulo. Vazio = 09:00-19:00. Valor ilegivel faz o turno
# responder 500 (configuracao), nunca cai calado no padrao.
JANELA_TRABALHO="09:00-19:00"

# DIAS_TRABALHO: dias ISO separados por virgula, 1 = segunda ... 7 = domingo.
# Vazio = 1,2,3,4,5. Trocar qualquer um dos dois exige Implantar (restart).
DIAS_TRABALHO="1,2,3,4,5"
```

- [ ] **Step 7: Rodar turno e prompt**

```bash
cd "$SCRATCH/fase3" && "$TSX" turno.ts && "$TSX" prompt.ts && "$TSX" agendamento.ts | tail -1
```

Esperado: 9 `OK   ...` + `OK turno`, `OK prompt`, `OK agendamento`.

- [ ] **Step 8: Typecheck, build e caça ao contrato antigo**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build && ! grep -n "exigirData(args.inicio\|com inicio e duracao_min" server/*.ts
```

Esperado: sem erros; grep sem saída. (Se `vue-tsc` acusar `src/` por `TurnoResponse`/`EventoCriado`, é a Task 5 — mas nenhum arquivo de `src/` importa tipos do servidor, então não deve acusar.)

- [ ] **Step 9: HTTP com janela inválida**

```bash
TMPD=$(mktemp -d "$SCRATCH/fase3-http-XXXX")
cp -r "$REPO/seed" "$TMPD/seed"
cd "$TMPD" && PORT=3918 NODE_ENV=production GEMINI_API_KEY=fake IPS_PERMITIDOS= JANELA_TRABALHO="19:00-09:00" node "$REPO/dist/server.cjs" > "$TMPD/server.log" 2>&1 &
echo $! > "$TMPD/pid"
cd "$SCRATCH/fase3" && "$TSX" http.ts; STATUS=$?
kill "$(cat "$TMPD/pid")"
grep -n "JANELA_TRABALHO" "$TMPD/server.log"
ls "$TMPD/data"
exit $STATUS
```

Esperado: `OK http`; o log tem `Janela de trabalho inválida: JANELA_TRABALHO='19:00-09:00' ...`; `data/` tem `squad.json` e **não** tem `google-auth.json`. Se falhar, leia `$TMPD/server.log`.

- [ ] **Step 10: Commit**

```bash
cd "$REPO" && git add server/capabilities.ts server/orchestrator.ts server.ts .env.example && git commit -m "$(cat <<'EOF'
feat(orquestrador): servidor escolhe o horario de cada compromisso

agendar_evento deixa de receber inicio: o modelo manda tipo, duracao ou
esforco, prazo e, so quando o usuario disse a hora, inicio_fixo. O turno roda
os agendamentos em serie (fixo, foco, prazo mais proximo) sobre uma unica
leitura da agenda, e cada reserva desconta da ocupacao: eventos da mesma
demanda param de cair no mesmo horario.

Erros ganham motivo (precisaConectar, configuracao, semHorarioLivre,
agendaIndisponivel) e o turno ganha avisos. Janela de trabalho vem de
JANELA_TRABALHO/DIAS_TRABALHO, validada antes do token e do Gemini.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend — Mochila com blocos, avisos e dicas

**Releia `src/App.vue`, `src/types.ts`, `src/components/QuestBackpack.vue` e `src/components/CommandBar.vue`**: a Fase 1 mudou estado de squad, Mochila e turno; a Fase 2 pode ter mudado cards.

**Files:**
- Modify: `src/types.ts`
- Create: `src/mochila.ts`
- Modify: `src/components/QuestBackpack.vue`
- Modify: `src/App.vue`
- Modify: `src/components/CommandBar.vue`
- Test: `$SCRATCH/fase3/mochila.ts`

**Interfaces:**
- Consumes: Task 4 (forma HTTP de `TurnoResult`), Task 2 (`QuestCalendario.prazoRef`).
- Produces: `src/mochila.ts`: `diasDoEventoDiaInteiro(inicio: string, fim: string): { primeiro: Date; ultimo: Date }`; `type InfoDePrazo`; `infoDePrazo(quest: QuestCalendario, quests: QuestCalendario[]): InfoDePrazo`.

- [ ] **Step 1: Escrever o script**

`$SCRATCH/fase3/mochila.ts`:

```ts
import assert from "node:assert/strict";
import { importar } from "./harness.ts";

async function main() {
  const { diasDoEventoDiaInteiro, infoDePrazo } = await importar("src/mochila.ts");

  const q = (eventId: string, inicio: string, extra: Record<string, unknown> = {}) => ({
    eventId, titulo: eventId, inicio, fim: inicio, diaInteiro: false, tipo: "time_blocking",
    dominio: "casa", membro: "romulo", squad: "pessoal", prazoRef: "", ...extra,
  });

  const um = diasDoEventoDiaInteiro("2026-09-16", "2026-09-17");
  assert.deepEqual([um.primeiro.getFullYear(), um.primeiro.getMonth(), um.primeiro.getDate()], [2026, 8, 16]);
  assert.equal(um.ultimo.getTime(), um.primeiro.getTime(), "um dia só: último = primeiro");
  const varios = diasDoEventoDiaInteiro("2026-09-30", "2026-10-03");
  assert.deepEqual([varios.ultimo.getMonth(), varios.ultimo.getDate()], [9, 2], "fim exclusivo: 03/10 vira 02/10");

  const marco = q("m1", "2026-09-16", { tipo: "deadline", diaInteiro: true, fim: "2026-09-17" });
  const b2 = q("b2", "2026-09-15T12:00:00.000Z", { prazoRef: "m1" });
  const b1 = q("b1", "2026-09-14T12:00:00.000Z", { prazoRef: "m1" });
  const solto = q("s", "2026-09-14T15:00:00.000Z");
  const lista = [marco, b2, b1, solto];
  assert.deepEqual(infoDePrazo(b1, lista), { papel: "bloco", posicao: 1, total: 2, marco });
  assert.deepEqual(infoDePrazo(b2, lista), { papel: "bloco", posicao: 2, total: 2, marco });
  assert.deepEqual(infoDePrazo(marco, lista), { papel: "marco", blocos: 2 });
  assert.deepEqual(infoDePrazo(solto, lista), { papel: "nenhum" });
  assert.deepEqual(infoDePrazo(b1, [b1]), { papel: "bloco", posicao: 1, total: 1, marco: null }, "marco fora da lista");
  console.log("OK mochila");
}

main().catch((e) => { console.error("FALHOU mochila:", e); process.exit(1); });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase3" && "$TSX" mochila.ts
```

Esperado: `FALHOU mochila:` (módulo não existe).

- [ ] **Step 3: `src/types.ts`**

1. `EventoCriado` passa a espelhar o servidor:

```ts
export interface EventoCriado {
  kind: "evento";
  titulo: string;
  /** id da pessoa (PO ou integrante). O domínio é derivado dela. */
  responsavel_id: string;
  tipo: "time_blocking" | "deadline";
  dominio: string;
  /** ISO; "AAAA-MM-DD" quando `dia_inteiro`. */
  inicio: string;
  /** ISO; "AAAA-MM-DD" exclusivo quando `dia_inteiro`. */
  fim: string;
  dia_inteiro: boolean;
  papel: "foco" | "marco" | "bloco";
  prazo_ref?: string;
  eventId: string;
  htmlLink?: string;
}
```

2. `ErroTarefa` ganha `motivo?: "precisaConectar" | "configuracao" | "semHorarioLivre" | "agendaIndisponivel";` e, ao lado:

```ts
/** Feito, mas não como pedido (conflito, esforço parcial...). Não é erro. */
export interface AvisoTarefa {
  capacidade: string;
  titulo: string;
  aviso: string;
}
```

3. `TurnoResponse` ganha `avisos: AvisoTarefa[];`.

4. `QuestCalendario` ganha, depois de `membro` (ou de `squad`, se a Fase 1 o pôs):

```ts
  /** `squadone_prazo_ref`: eventId do marco quando a quest é bloco de um prazo; "" senão. */
  prazoRef: string;
```

- [ ] **Step 4: `src/mochila.ts`**

```ts
import type { QuestCalendario } from './types'

/**
 * Primeiro e último dia de um evento de dia inteiro, como datas LOCAIS.
 * `fim` do Google é exclusivo (evento só de 16/09 termina em 17/09), e
 * "AAAA-MM-DD" puro o `new Date` leria como meia-noite UTC — dia anterior
 * em -03:00. Por isso monta pelas partes.
 */
export function diasDoEventoDiaInteiro(inicio: string, fim: string): { primeiro: Date; ultimo: Date } {
  const [a, m, d] = inicio.split('-').map(Number)
  const [a2, m2, d2] = fim.split('-').map(Number)
  const primeiro = new Date(a, m - 1, d)
  const ultimo = new Date(a2, m2 - 1, d2 - 1)
  return { primeiro, ultimo: ultimo > primeiro ? ultimo : primeiro }
}

export type InfoDePrazo =
  | { papel: 'bloco'; posicao: number; total: number; marco: QuestCalendario | null }
  | { papel: 'marco'; blocos: number }
  // String e não null: sem strictNullChecks (tsconfig do projeto) `null` não
  // discrimina a união e o template não conseguiria ler `posicao`.
  | { papel: 'nenhum' }

/**
 * Como uma quest se liga a um prazo, derivado da LISTA atual e não de um
 * contador gravado: bloco apagado no Google some da contagem na próxima leitura.
 * A contagem só enxerga o que a Mochila leu (7 dias para trás, 90 para frente).
 */
export function infoDePrazo(quest: QuestCalendario, quests: QuestCalendario[]): InfoDePrazo {
  if (quest.prazoRef) {
    const irmaos = quests
      .filter((q) => q.prazoRef === quest.prazoRef)
      .sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio))
    return {
      papel: 'bloco',
      posicao: irmaos.findIndex((q) => q.eventId === quest.eventId) + 1,
      total: irmaos.length,
      marco: quests.find((q) => q.eventId === quest.prazoRef) ?? null,
    }
  }
  const blocos = quests.filter((q) => q.prazoRef === quest.eventId).length
  return blocos > 0 ? { papel: 'marco', blocos } : { papel: 'nenhum' }
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd "$SCRATCH/fase3" && "$TSX" mochila.ts
```

Esperado: `OK mochila`.

- [ ] **Step 6: `src/components/QuestBackpack.vue`**

1. Script: `defineProps({` vira `const props = defineProps({` (as funções abaixo precisam da lista). Acrescente o import `import { diasDoEventoDiaInteiro, infoDePrazo } from '../mochila'`.

2. Substitua a função `quando` inteira por:

```ts
const quando = (quest: QuestCalendario) => {
  if (quest.diaInteiro) {
    // `fim` do Google é exclusivo e "AAAA-MM-DD" puro viraria UTC: o helper
    // devolve datas locais. Vários dias mostram o intervalo, não só o início.
    const { primeiro, ultimo } = diasDoEventoDiaInteiro(quest.inicio, quest.fim)
    return ultimo.getTime() === primeiro.getTime()
      ? primeiro.toLocaleDateString()
      : `${primeiro.toLocaleDateString()} – ${ultimo.toLocaleDateString()}`
  }
  return new Date(quest.tipo === 'deadline' ? quest.fim : quest.inicio).toLocaleString()
}
```

3. Depois de `duracao`, acrescente:

```ts
// Bloco e marco se reconhecem pela lista lida, não por contador gravado:
// apagar um bloco no Google corrige o "2/3" na próxima leitura.
const rotuloDoTipo = (quest: QuestCalendario) => {
  const info = infoDePrazo(quest, props.quests)
  if (info.papel === 'bloco') return `Bloco ${info.posicao}/${info.total}: ${duracao(quest)}m`
  if (quest.tipo === 'deadline') {
    return info.papel === 'marco' ? `Deadline · ${info.blocos} bloco(s) de trabalho` : 'Deadline'
  }
  return quest.diaInteiro ? 'Foco: dia inteiro' : `Foco: ${duracao(quest)}m`
}

const prazoDoBloco = (quest: QuestCalendario) => {
  const info = infoDePrazo(quest, props.quests)
  if (info.papel !== 'bloco') return ''
  return info.marco ? `Para o prazo de ${quando(info.marco)}` : 'Para um prazo fora da Mochila'
}
```

4. Template: a linha

```html
⏰ {{ quest.tipo === 'deadline' ? 'Deadline' : quest.diaInteiro ? 'Foco: dia inteiro' : 'Foco: ' + duracao(quest) + 'm' }}
```

   vira `⏰ {{ rotuloDoTipo(quest) }}` (apague o comentário do `1440m` junto; a regra continua dentro de `rotuloDoTipo`), e logo depois da `<div>` de `📅 {{ quando(quest) }}` acrescente:

```html
          <div v-if="prazoDoBloco(quest)" class="text-gray-800 text-xs truncate">🎯 {{ prazoDoBloco(quest) }}</div>
```

- [ ] **Step 7: `src/App.vue`**

No handler do turno (`handleDelegation` ou o nome que a Fase 1 deixou), substitua o bloco `if (turno.erros?.length) { ... alert(...) }` por:

```js
    const erros = turno.erros ?? []
    const avisos = turno.avisos ?? []
    // Agendar sem credencial falha por compromisso, não o turno inteiro: o
    // motivo classificado é o que diz para a Mochila voltar a oferecer o
    // botão de conectar.
    if (erros.some(e => e.motivo === 'precisaConectar')) conectado.value = false
    if (erros.length || avisos.length) {
      // try por tarefa: o lote sobrevive, os erros vem nomeados. Avisos sao
      // coisas feitas de um jeito diferente do pedido (conflito, esforco que
      // nao coube antes do prazo) e o usuario precisa saber delas agora.
      console.warn('Tarefas com erro:', erros, 'Avisos:', avisos)
      alert([
        ...erros.map(e => `${e.capacidade}: ${e.erro}`),
        ...avisos.map(a => `Aviso — ${a.titulo}: ${a.aviso}`)
      ].join('\n'))
    }
```

- [ ] **Step 8: `src/components/CommandBar.vue`**

Troque as três `dica` de `MODOS`:

```ts
const MODOS: { valor: Modo; rotulo: string; dica: string }[] = [
  { valor: 'auto', rotulo: 'Auto', dica: 'O squad decide entre foco e prazo; o servidor escolhe o horário' },
  { valor: 'foco', rotulo: 'Focar Agora', dica: 'Próximo horário livre na janela de trabalho' },
  { valor: 'prazo', rotulo: 'Prazo Final', dica: 'Marco no prazo + blocos de trabalho antes dele' }
]
```

- [ ] **Step 9: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros.

- [ ] **Step 10: Conferência visual sem Google**

```bash
cd "$REPO" && grep -n "rotuloDoTipo\|prazoDoBloco\|diasDoEventoDiaInteiro" src/components/QuestBackpack.vue && grep -n "motivo === 'precisaConectar'\|Aviso —" src/App.vue
```

Esperado: as três funções usadas no componente e as duas linhas no App. (Renderização real com blocos exige eventos no Google: fica para o uso em produção, fora desta verificação.)

- [ ] **Step 11: Commit**

```bash
cd "$REPO" && git add src/types.ts src/mochila.ts src/components/QuestBackpack.vue src/App.vue src/components/CommandBar.vue && git commit -m "$(cat <<'EOF'
feat(mochila): mostrar blocos ligados ao prazo e avisos do turno

Bloco de trabalho aparece como "Bloco 2/3" com a data do prazo; o marco diz
quantos blocos tem. Posicao e total saem da lista lida, entao apagar um bloco
no Google corrige a contagem sozinho. Evento de dia inteiro com varios dias
mostra o intervalo.

O alert do turno lista avisos junto dos erros, e erro precisaConectar derruba
o estado conectado para a Mochila oferecer o botao de novo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Documentação, integração e grafo

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Reler `CLAUDE.md` inteiro**

As Fases 1/2 já mexeram nele (árvore de squads, marcas, rollback). Preserve tudo; só acrescente.

- [ ] **Step 2: Arquitetura**

No bloco de árvore de arquivos, abaixo de `server/capabilities.ts`:

```
  server/alocador.ts      PURO: ocupação + janela + pedido + agora -> slots
  server/agenda.ts        ocupação do turno: 1 leitura do primary + reservas
  server/agendamento.ts   compromisso -> eventos (foco, ou marco + blocos)
```

- [ ] **Step 3: Seção nova, depois de "Escrita no roster"**

```markdown
### Agendamento: o horário é do servidor

O modelo decide a intenção (`tipo`, `duracao_min` ou `esforco_min`, `prazo_final`, `a_partir_de`); o servidor escolhe o horário. `inicio_fixo` só existe quando o usuário disse a hora — é gravado mesmo com conflito, que vira aviso.

- **Ocupação é global:** `events.list` do `primary` inteiro, uma vez por turno, 60 dias à frente, sem filtro de marca. Não ocupa: transparente, dia inteiro, cancelado, `workingLocation`/`birthday`, recusado pelo próprio usuário. Outros calendários não contam.
- **Janela:** `JANELA_TRABALHO` (padrão `09:00-19:00`) e `DIAS_TRABALHO` (padrão `1,2,3,4,5`), fuso `America/Sao_Paulo`. Env e não `squad.json`: é do usuário, não da squad. Trocar exige **Implantar**. Valor ilegível = 500 `configuracao`, nunca o padrão calado.
- **Focar Agora:** primeiro slot livre a partir de agora (grade de 15 min), até 14 dias. Não achou = erro `semHorarioLivre` só naquele compromisso.
- **Prazo Final:** marco transparente no prazo (sem hora = dia inteiro) + blocos de 30–120 min antes dele, um por dia antes de empilhar, até 20. Não coube = cria o que coube e avisa quanto faltou. Blocos levam `squadone_prazo_ref` = eventId do marco.
- **Série:** os `agendar_evento` de um turno rodam um por vez (fixo, foco, prazo mais próximo) e cada reserva desconta da ocupação. O resto das capacidades segue em paralelo.
- **Sem credencial:** o turno roda; cada `agendar_evento` vira erro com `motivo: precisaConectar` sem chamar o Google.
- `server/alocador.ts` é puro e é o que a Fase 4 reusa. Não importe nada nele.
```

- [ ] **Step 4: Marcas e variáveis**

- Na tabela/lista de marcas do Calendar (onde a Fase 1 documentou `squadone_squad`), acrescente: `squadone_prazo_ref` — eventId do marco, só em blocos de trabalho; a Mochila deriva "Bloco i/N" da lista.
- Na tabela "Variáveis de ambiente":

```markdown
| `JANELA_TRABALHO` | servidor | janela de alocação `HH:MM-HH:MM`; vazia = 09:00-19:00 |
| `DIAS_TRABALHO` | servidor | dias ISO da janela, `1`=segunda; vazio = 1,2,3,4,5 |
```

- [ ] **Step 5: Verificação final completa**

```bash
cd "$SCRATCH/fase3" && for s in alocador ocupacao agendamento turno prompt mochila; do "$TSX" $s.ts | tail -1 || exit 1; done
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: `OK alocador: 23 casos`, `OK ocupacao`, `OK agendamento`, `OK turno`, `OK prompt`, `OK mochila`; typecheck e build sem erros.

- [ ] **Step 6: Commit da documentação**

```bash
cd "$REPO" && git add CLAUDE.md && git commit -m "$(cat <<'EOF'
docs: registrar o alocador de agenda da Fase 3

Arquitetura ganha alocador, agenda do turno e agendamento. Documenta que o
horario e do servidor, ocupacao global no primary, janela por env var (e por
que nao no squad.json), semantica de Focar Agora e Prazo Final, a marca
squadone_prazo_ref e o comportamento sem credencial.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Integrar, publicar e atualizar o grafo**

```bash
cd "$REPO" && git status --short
```

Esperado: nenhum arquivo desta fase pendente. `graphify-out/`, `docs/daily-summary/` e specs/planos de outras fases podem aparecer como não rastreados — **não** os adicione.

```bash
cd "$REPO" && git pull --rebase && npx vue-tsc --noEmit && npm run build && git push && graphify update .
```

Esperado: rebase limpo (se houver conflito com commits das Fases 1/2 em `orchestrator.ts`/`capabilities.ts`, resolva preservando as duas mudanças, rode de novo `turno.ts`, `prompt.ts`, typecheck e build antes do push); push aceito; `graphify update .` termina sem erro. Não commite o `graphify-out/` gerado.

Lembrete para quem implanta (não é passo desta task): push em `main` não implanta sozinho; no Easypanel, opcionalmente definir `JANELA_TRABALHO`/`DIAS_TRABALHO` e clicar **Implantar**.
