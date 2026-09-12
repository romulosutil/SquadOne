# Fase 1 — Roster v3 multi-squad + contrato do evento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acrescentar a squad como nível acima do domínio (roster v3 com migração segura), gravar as quatro marcas em todo evento novo e dar à UI um seletor de squad e o gesto "Nova squad".

**Architecture:** `server/squad.ts` vira dono do formato v3, da migração v1→v2→v3 (com backup e promessa única), das regras de id globais e da resolução de `squadId`. `hire.ts` aplica contratações e cria squads dentro de `atualizarRoster`. Capacidades e prompt recebem só a squad ativa; a rota resolve a squad antes de tocar Google/Gemini. O frontend guarda a squad ativa em `localStorage` e recria o `GameMap` por `:key`.

**Tech Stack:** Node + Express + tsx, Vue 3.5 (`<script setup>`), Vite 6, TypeScript via `vue-tsc`. Sem suíte de testes.

**Spec:** `docs/superpowers/specs/2026-09-12-fase-1-multi-squad-design.md` — leia inteira antes da Task 1. Seções citadas como §N.

## Global Constraints

- **Releia cada arquivo antes de editar.** A Fase 0 já aterrissou em `main` (`squadone_tipo`, `transparency`, `modo`, `id` de sugestão) e trechos deste plano mostram a forma esperada, não o texto exato. Onde o arquivo divergir, preserve o comportamento da Fase 0 e aplique a mudança descrita.
- **Nunca** ler/gravar/rodar contra o `data/` do repo, exceto *copiar* `data/squad.json` para um diretório temporário (cenário `copia-real`). Nenhum script roda com cwd no repo quando importa `server/squad.ts` para gravar.
- **Nunca** chamar Google Calendar nem Gemini reais. `fetch` mockado nos scripts; servidor de teste roda sem `.env` e com `GEMINI_API_KEY=fake`; só rotas que falham antes de chamar serviços externos são exercitadas.
- **Não tocar** `server/auth-store.ts` (outra sessão).
- **Não commitar** `graphify-out/` nem `docs/daily-summary/`. Sempre `git add` com caminhos explícitos.
- Comentários e identificadores em português; comentário explica *por quê*.
- Erros classificados: `PedidoInvalido` → 400, `ConflitoDeRoster` → 409, `SquadInexistente` → 409 + `squadInexistente: true`, `RosterIlegivel` → 500.
- Limites: squad `nome` ≤40, `escopo` ≤200, `papel_po` ≤60, `nome_po` ≤40; id de squad ≤40; slug de domínio ≤60.
- Constantes exatas: `ESCOPO_PESSOAL_PADRAO = "vida pessoal e tudo que não pertence a outra squad"`; `UNLOCK_ORDER_PADRAO = [[0,0],[1,0],[0,1],[1,1],[2,0],[2,1],[0,2],[1,2],[2,2]]`; chave de `localStorage` `squadone:squadAtiva`; separador de id de domínio `--`.
- Commits em português, estilo `tipo(escopo): descrição`, corpo com o porquê, terminando com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Verificação por task: `npx vue-tsc --noEmit` e `npm run build` passam, mais o script da task.

## Ambiente dos scripts de verificação

Rode em Git Bash. Defina uma vez por sessão:

```bash
export REPO="C:/Users/sutil/Documents/dev/PESSOAL/apps/SquadOne"
export SCRATCH="<diretório de rascunho da sua sessão, FORA do repo>"
mkdir -p "$SCRATCH/fase1"
```

Os scripts ficam em `$SCRATCH/fase1/` e **não** são commitados. `server/squad.ts` calcula `data/` a partir de `process.cwd()` no import, por isso cada cenário roda num processo próprio que faz `chdir` para um diretório temporário antes de importar.

**Correção (implementação):** onde este plano diz `npx tsx`, use `"$REPO/node_modules/.bin/tsx"`. Rodado de `$SCRATCH`, fora do projeto, o `npx` não acha o `tsx` local e tenta baixar do registry. O cenário `copia-real` lê uma cópia feita antes com `cp "$REPO/data/squad.json" "$SCRATCH/fase1/squad.real.json"`; nenhum script abre `$REPO/data`.

## Mapa de arquivos

| Arquivo | Responsabilidade | Tasks |
|---|---|---|
| `server/squad.ts` | tipos v3, erros classificados, migração, fila de escrita, slots, regras de id, resolução de squad, árvore do prompt | 1, 4 |
| `seed/squad.seed.json` | seed v3 | 1 |
| `server/hire.ts` | contratação dentro de uma squad; `criarSquad` | 2 |
| `server/calendar.ts` | `PROP_SQUAD`, `marcasDoEvento`, `urlDeEventos`, leitura por `calendarId` | 3 |
| `server/capabilities.ts` | contexto com roster+squad, `squad_id` nas propostas, `sugerir_troca_squad` | 3 |
| `server/orchestrator.ts` | `PedidoDeTurno`, prompt com squad ativa + outras squads | 3, 4 |
| `server.ts` | rotas por squad, `POST /api/squad/nova`, mapeamento de erros | 3, 4 |
| `src/types.ts` | espelho v3 | 5 |
| `src/squadAtiva.ts` (novo) | leitura/gravação da squad ativa no `localStorage` | 5 |
| `src/App.vue` | estado `roster`/`squadAtiva`, Mochila e turno por squad, cards | 5, 6 |
| `src/components/GameMap.vue` | prop `SquadView` | 5 |
| `src/components/QuestBackpack.vue` | nome do domínio no badge | 5 |
| `src/components/SquadSelector.vue` (novo) | seletor + botão Nova squad | 6 |
| `src/components/NovaSquadModal.vue` (novo) | formulário de squad | 6 |
| `src/components/TrocaSquadCard.vue` (novo) | card de `troca_squad` | 6 |
| `src/components/GrowthCard.vue` | badge da squad de origem | 6 |
| `CLAUDE.md` | árvore, invariantes, persistência, rollback | 7 |

---

### Task 1: Roster v3 em `server/squad.ts` (tipos, migração, slots, ids) + seed v3

**Files:**
- Modify: `server/squad.ts` (arquivo inteiro)
- Modify: `seed/squad.seed.json`
- Test (fora do repo): `$SCRATCH/fase1/harness.ts`, `$SCRATCH/fase1/roster.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usado pelas Tasks 2–5):
  - tipos `Pessoa`, `Dominio`, `Squad`, `Roster`, `SquadView`, `RosterView`
  - classes `PedidoInvalido`, `ConflitoDeRoster`, `SquadInexistente extends ConflitoDeRoster` (campo `squadId`), `RosterIlegivel`
  - `readRoster(): Promise<Roster>`, `writeRoster(r: Roster): Promise<void>`, `atualizarRoster<T>(m: (r: Roster) => T): Promise<T>`
  - `detectarVersao(bruto: unknown): 1 | 2 | 3`, `migrarV2(v2: RosterV2): Roster`
  - `unlockedSlots(s: Squad)`, `proximoSlot(s: Squad): [number, number] | null`, `paraVista(r: Roster): RosterView`
  - `resolverSquad(r: Roster, squadId: unknown): Squad`
  - `idsEmUso(r: Roster): { pessoas: Set<string>; dominios: Set<string>; squads: Set<string> }`
  - `todasAsPessoas(r: Roster): Pessoa[]`
  - `novoIdDePessoa(r: Roster, nome: string): string`, `novoIdDeDominio(r: Roster, s: Squad, nome: string): string`, `novoIdDeSquad(r: Roster, nome: string): string`
  - `outrasSquads(r: Roster, ativaId: string): string`
  - inalterados, por squad: `salaPara`, `slug`, `pessoas`, `acharDominio`, `acharPessoa`, `idsDePessoas`, `dominiosDoSquad`, `rosterTree`
  - constantes `MAX_DOMINIOS`, `UNLOCK_ORDER_PADRAO`, `ESCOPO_PESSOAL_PADRAO`
  - **pontes temporárias** (removidas na Task 4): `readSquad(): Promise<Squad>` e `atualizarSquad<T>(m: (s: Squad) => T): Promise<T>`, ambas sobre `squads[0]`, para `hire.ts`, `capabilities.ts`, `orchestrator.ts` e `server.ts` continuarem compilando.

- [ ] **Step 1: Criar o harness de verificação**

`$SCRATCH/fase1/harness.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REPO = path.resolve(process.env.REPO ?? "");
if (!process.env.REPO) throw new Error("Defina REPO antes de rodar.");
const BASE = process.env.SCRATCH ?? os.tmpdir();

export const UO: [number, number][] = [[0,0],[1,0],[0,1],[1,1],[2,0],[2,1],[0,2],[1,2],[2,2]];

const pessoa = (id: string, nome: string, papel = "PO") => ({
  id, nome, papel, escopo: "tudo", sprite: "wraith_01", hiredAt: "2026-09-11T09:00:00-03:00",
});

/** Forma do data/squad.json de produção: domínio "po" E pessoa "po". */
export const V2_PRODUCAO = {
  version: 2,
  unlockOrder: UO,
  dominios: [{
    id: "po", nome: "PO", escopo: "tudo", slot: [0, 0], room: "ROOM_SOLO",
    criadoEm: "2026-09-11T09:00:00-03:00", po: pessoa("po", "Rômulo"), integrantes: [],
  }],
};

/** Forma da seed v2 antiga: domínio "geral". */
export const V2_SEED = {
  version: 2,
  unlockOrder: UO,
  dominios: [{
    id: "geral", nome: "Geral", escopo: "tudo", slot: [0, 0], room: "ROOM_SOLO",
    criadoEm: "2026-09-11T09:00:00-03:00", po: pessoa("po", "Rômulo"), integrantes: [],
  }],
};

export const V1 = {
  version: 1,
  unlockOrder: UO,
  members: [{
    id: "po", nome: "Rômulo", papel: "PO", escopo: "tudo", dominio: "Geral",
    sprite: "wraith_01", slot: [0, 0], room: "ROOM_SOLO", hiredAt: "2026-09-11T09:00:00-03:00",
  }],
};

/** v3 com duas squads: pessoal (casa/romulo) e pay4fun (pay4fun--geral/bia). */
export const V3_DUAS = {
  version: 3,
  idsAposentados: { pessoas: [], dominios: [] },
  squads: [
    {
      id: "pessoal", nome: "Pessoal", escopo: "vida pessoal", calendarId: "primary", unlockOrder: UO,
      dominios: [{ id: "casa", nome: "Casa", escopo: "casa", slot: [0, 0], room: "ROOM_SOLO",
        criadoEm: "2026-09-11T09:00:00-03:00", po: pessoa("romulo", "Rômulo"), integrantes: [] }],
    },
    {
      id: "pay4fun", nome: "Pay4Fun", escopo: "trabalho na Pay4Fun", calendarId: "primary", unlockOrder: UO,
      dominios: [{ id: "pay4fun--geral", nome: "Geral", escopo: "trabalho", slot: [0, 0], room: "ROOM_SOLO",
        criadoEm: "2026-09-12T09:00:00-03:00", po: pessoa("bia", "Bia", "PO Pay4Fun"), integrantes: [] }],
    },
  ],
};

export const txt = (o: unknown) => JSON.stringify(o, null, 2) + "\n";

/**
 * Diretório descartável com seed/ copiada e, opcionalmente, data/squad.json.
 * Faz chdir para ele: server/squad.ts resolve data/ pelo cwd no import.
 */
export async function prepararDiretorio(squadJson?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(BASE, "fase1-"));
  if (path.resolve(dir).startsWith(REPO)) throw new Error("Diretório temporário dentro do repo: abortado.");
  await fs.cp(path.join(REPO, "seed"), path.join(dir, "seed"), { recursive: true });
  if (squadJson !== undefined) {
    await fs.mkdir(path.join(dir, "data"));
    await fs.writeFile(path.join(dir, "data", "squad.json"), squadJson, "utf8");
  }
  process.chdir(dir);
  return dir;
}

export function importar<T = any>(rel: string): Promise<T> {
  return import(pathToFileURL(path.join(REPO, rel)).href);
}

/** Compara pelo `name` da classe: robusto a identidade de módulo no import dinâmico. */
export async function rejeitaCom(p: Promise<unknown>, nome: string): Promise<void> {
  try {
    await p;
  } catch (err: any) {
    if (err?.name !== nome) throw new Error(`Esperava ${nome}, veio ${err?.name}: ${err?.message}`);
    return;
  }
  throw new Error(`Esperava ${nome}, mas resolveu.`);
}
```

- [ ] **Step 2: Escrever o script de cenários do roster**

`$SCRATCH/fase1/roster.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { importar, prepararDiretorio, rejeitaCom, REPO, txt, UO, V1, V2_PRODUCAO, V2_SEED, V3_DUAS } from "./harness.ts";

const cenario = process.argv[2];
const ler = (dir: string, f: string) => fs.readFile(path.join(dir, "data", f), "utf8");
const mtime = async (dir: string, f: string) => (await fs.stat(path.join(dir, "data", f))).mtimeMs;

async function main() {
  switch (cenario) {
    case "v2-producao":
    case "v2-seed": {
      const fonte = cenario === "v2-producao" ? V2_PRODUCAO : V2_SEED;
      const original = txt(fonte);
      const dir = await prepararDiretorio(original);
      const sq = await importar("server/squad.ts");
      const r = await sq.readRoster();
      assert.equal(r.version, 3);
      assert.equal(r.squads.length, 1);
      assert.equal(r.squads[0].id, "pessoal");
      assert.equal(r.squads[0].nome, "Pessoal");
      assert.equal(r.squads[0].escopo, sq.ESCOPO_PESSOAL_PADRAO);
      assert.equal(r.squads[0].calendarId, "primary");
      assert.deepEqual(r.squads[0].dominios, fonte.dominios);
      assert.deepEqual(r.squads[0].unlockOrder, fonte.unlockOrder);
      assert.deepEqual(r.idsAposentados, { pessoas: [], dominios: [] });
      assert.equal(await ler(dir, "squad.v2.bak.json"), original);
      assert.deepEqual(JSON.parse(await ler(dir, "squad.json")), r);
      break;
    }
    case "v1": {
      const original = txt(V1);
      const dir = await prepararDiretorio(original);
      const sq = await importar("server/squad.ts");
      const r = await sq.readRoster();
      assert.equal(r.version, 3);
      assert.equal(r.squads[0].dominios[0].id, "geral");
      assert.equal(r.squads[0].dominios[0].po.id, "po");
      assert.equal(await ler(dir, "squad.v1.bak.json"), original);
      break;
    }
    case "idempotente": {
      const dir = await prepararDiretorio(txt(V2_PRODUCAO));
      const sq = await importar("server/squad.ts");
      await sq.readRoster();
      const antes = [await mtime(dir, "squad.json"), await mtime(dir, "squad.v2.bak.json")];
      await new Promise((r) => setTimeout(r, 50));
      await sq.readRoster();
      const depois = [await mtime(dir, "squad.json"), await mtime(dir, "squad.v2.bak.json")];
      assert.deepEqual(depois, antes);
      break;
    }
    case "ilegivel": {
      const dir = await prepararDiretorio('{"foo":1}\n');
      const sq = await importar("server/squad.ts");
      await rejeitaCom(sq.readRoster(), "RosterIlegivel");
      assert.equal(await ler(dir, "squad.json"), '{"foo":1}\n');
      assert.deepEqual(await fs.readdir(path.join(dir, "data")), ["squad.json"]);
      break;
    }
    case "json-quebrado": {
      const dir = await prepararDiretorio("{nao e json");
      const sq = await importar("server/squad.ts");
      await rejeitaCom(sq.readRoster(), "RosterIlegivel");
      assert.equal(await ler(dir, "squad.json"), "{nao e json");
      break;
    }
    case "crash": {
      const dir = await prepararDiretorio(txt(V2_PRODUCAO));
      await fs.writeFile(path.join(dir, "data", "squad.v2.bak.json"), "ANTIGO\n", "utf8");
      const sq = await importar("server/squad.ts");
      const r = await sq.readRoster();
      assert.equal(r.version, 3);
      assert.equal(await ler(dir, "squad.v2.bak.json"), "ANTIGO\n");
      break;
    }
    case "concorrencia": {
      const dir = await prepararDiretorio(txt(V2_PRODUCAO));
      const sq = await importar("server/squad.ts");
      const todos = await Promise.all(Array.from({ length: 5 }, () => sq.readRoster()));
      for (const r of todos) assert.deepEqual(r, todos[0]);
      assert.notEqual(todos[0], todos[1]); // clones, não o mesmo objeto
      assert.equal(JSON.parse(await ler(dir, "squad.json")).version, 3);
      const sobras = (await fs.readdir(path.join(dir, "data"))).filter((f) => f.endsWith(".tmp"));
      assert.deepEqual(sobras, []);
      break;
    }
    case "vazio": {
      const dir = await prepararDiretorio();
      const sq = await importar("server/squad.ts");
      const r = await sq.readRoster();
      assert.equal(r.version, 3);
      assert.equal(r.squads[0].id, "pessoal");
      assert.equal(r.squads[0].dominios[0].id, "geral");
      assert.deepEqual((await fs.readdir(path.join(dir, "data"))).sort(), ["squad.json"]);
      break;
    }
    case "v3-no-disco": {
      const original = txt(V3_DUAS);
      const dir = await prepararDiretorio(original);
      const sq = await importar("server/squad.ts");
      const antes = await mtime(dir, "squad.json");
      await new Promise((r) => setTimeout(r, 50));
      const r = await sq.readRoster();
      assert.equal(r.squads.length, 2);
      assert.equal(await ler(dir, "squad.json"), original);
      assert.equal(await mtime(dir, "squad.json"), antes);
      assert.deepEqual(await fs.readdir(path.join(dir, "data")), ["squad.json"]);
      break;
    }
    case "falha-no-meio": {
      // Passa na detecção (tem 'dominios'), grava o backup e só então falha na
      // validação do v3 convertido: squad.json não pode ser tocado.
      const original = txt({ version: 2, unlockOrder: UO, dominios: [] });
      const dir = await prepararDiretorio(original);
      const sq = await importar("server/squad.ts");
      await rejeitaCom(sq.readRoster(), "RosterIlegivel");
      assert.equal(await ler(dir, "squad.json"), original);
      assert.equal(await ler(dir, "squad.v2.bak.json"), original);
      break;
    }
    case "tmp-orfao": {
      const dir = await prepararDiretorio(txt(V2_PRODUCAO));
      await fs.writeFile(path.join(dir, "data", "squad.json.999.1.tmp"), '{"version":3,"squ', "utf8");
      const sq = await importar("server/squad.ts");
      const r = await sq.readRoster();
      assert.equal(r.version, 3);
      assert.equal(JSON.parse(await ler(dir, "squad.json")).version, 3);
      break;
    }
    case "vazio-concorrente": {
      const dir = await prepararDiretorio();
      const sq = await importar("server/squad.ts");
      const todos = await Promise.all(Array.from({ length: 5 }, () => sq.readRoster()));
      for (const r of todos) assert.equal(r.squads[0].id, "pessoal");
      assert.deepEqual(await fs.readdir(path.join(dir, "data")), ["squad.json"]);
      break;
    }
    case "copia-real": {
      const real = path.join(process.env.SCRATCH ?? "", "fase1", "squad.real.json");
      let texto: string;
      try { texto = await fs.readFile(real, "utf8"); } catch { console.log("SKIP copia-real (sem cópia em $SCRATCH/fase1/squad.real.json)"); return; }
      const fonte = JSON.parse(texto);
      await prepararDiretorio(texto);
      const sq = await importar("server/squad.ts");
      const r = await sq.readRoster();
      assert.equal(r.version, 3);
      if (Array.isArray(fonte.dominios)) assert.deepEqual(r.squads[0].dominios, fonte.dominios);
      break;
    }
    case "slots": {
      await prepararDiretorio();
      const sq = await importar("server/squad.ts");
      const s = { unlockOrder: UO, dominios: [{ slot: [0, 0] }, { slot: [0, 1] }] } as any;
      assert.deepEqual(sq.proximoSlot(s), [1, 0]);
      assert.deepEqual(sq.unlockedSlots(s), [[0, 0], [0, 1]]);
      const cheio = { unlockOrder: UO, dominios: UO.map((slot) => ({ slot })) } as any;
      assert.equal(sq.proximoSlot(cheio), null);
      break;
    }
    case "resolver-e-ids": {
      await prepararDiretorio();
      const sq = await importar("server/squad.ts");
      const r = structuredClone(V3_DUAS) as any;
      assert.equal(sq.resolverSquad(r, undefined).id, "pessoal");
      assert.equal(sq.resolverSquad(r, "").id, "pessoal");
      assert.equal(sq.resolverSquad(r, "pay4fun").id, "pay4fun");
      assert.throws(() => sq.resolverSquad(r, "nao-existe"), (e: any) => e.name === "SquadInexistente" && e.squadId === "nao-existe");
      assert.throws(() => sq.resolverSquad(r, 7), (e: any) => e.name === "PedidoInvalido");
      assert.throws(() => sq.resolverSquad(r, ["a"]), (e: any) => e.name === "PedidoInvalido");
      assert.equal(sq.novoIdDePessoa(r, "Bia"), "bia-2");
      r.idsAposentados.pessoas.push("ana");
      assert.equal(sq.novoIdDePessoa(r, "Ana"), "ana-2");
      assert.equal(sq.novoIdDeDominio(r, r.squads[1], "Financeiro"), "pay4fun--financeiro");
      assert.throws(() => sq.novoIdDeDominio(r, r.squads[1], "Geral"), (e: any) => e.name === "ConflitoDeRoster");
      r.idsAposentados.dominios.push("pessoal--saude");
      assert.throws(() => sq.novoIdDeDominio(r, r.squads[0], "Saúde"), (e: any) => e.name === "ConflitoDeRoster");
      assert.equal(sq.novoIdDeSquad(r, "Freela"), "freela");
      assert.equal(sq.novoIdDeSquad(r, "Pay 4 Fun!"), "pay-4-fun"); // slug diferente de "pay4fun": não colide
      assert.throws(() => sq.novoIdDeSquad(r, "PAY4FUN"), (e: any) => e.name === "ConflitoDeRoster");
      assert.equal(sq.outrasSquads(r, "pay4fun"), "- squad 'pessoal' — Pessoal (escopo: vida pessoal)");
      assert.equal(sq.outrasSquads({ ...r, squads: [r.squads[0]] }, "pessoal"), "(nenhuma)");
      const vista = sq.paraVista(r);
      assert.deepEqual(vista.squads[1].unlockedSlots, [[0, 0]]);
      break;
    }
    default:
      throw new Error(`Cenário desconhecido: ${cenario}`);
  }
  console.log(`OK ${cenario}`);
}

main().catch((e) => { console.error(`FALHOU ${cenario}:`, e); process.exit(1); });
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase1" && for c in v2-producao v2-seed v1 idempotente v3-no-disco ilegivel json-quebrado falha-no-meio crash tmp-orfao concorrencia vazio vazio-concorrente copia-real slots resolver-e-ids; do npx tsx roster.ts $c || break; done
```

Esperado: `FALHOU v2-producao` (`sq.readRoster is not a function`).

- [ ] **Step 4: Reescrever `server/squad.ts`**

Releia o arquivo. Mantenha **sem mudança de comportamento**: `salaPara`, `slug`, `pessoas`, `acharDominio`, `acharPessoa`, `idsDePessoas`, `dominiosDoSquad`, `rosterTree`, `interface MembroV1`, `migrarV1` (só tipar o retorno como `RosterV2`), `SEED_PATHS` e seus comentários. Substitua o resto pelo abaixo (ordem sugerida no arquivo: comentário de topo, tipos, erros, caminhos/constantes, escrita, fila, `salaPara`, seed, v1, v2, validação, leitura, slots, `slug`, helpers por squad, helpers de roster, pontes).

Comentário de topo:

```ts
/**
 * Roster em ÁRVORE de três níveis (spec Fase 1 §1).
 *
 *   roster (data/squad.json, version 3)
 *     └── squad              ← contexto (Pessoal, Pay4Fun...); um escritório 3x3
 *           └── domínio      ← dono de um tema; ocupa UMA sala
 *                 ├── po
 *                 └── integrantes
 *
 * Uma sala = um domínio inteiro. Ids de domínio e de pessoa são únicos entre
 * TODAS as squads: vão para o Google Calendar no mesmo calendário principal, e
 * um id repetido em duas squads misturaria os eventos das duas.
 */
```

Tipos e erros:

```ts
export interface Pessoa {
  id: string;
  nome: string;
  papel: string;
  escopo: string;
  /** chave no craftpix.manifest.json */
  sprite: string;
  /** graus de hue-rotate, para diferenciar papéis que reusam o mesmo sprite */
  hue?: number;
  horario?: { inicio: string; fim: string };
  hiredAt: string;
  /** Reservado para a Fase 2 (arquivar). Nada lê nem grava ainda. */
  arquivado?: boolean;
}

export interface Dominio {
  /** Único entre todas as squads: é o valor de `squadone_dominio` no Calendar. */
  id: string;
  nome: string;
  escopo: string;
  slot: [number, number];
  room: string;
  criadoEm: string;
  po: Pessoa;
  integrantes: Pessoa[];
  /** Reservado para a Fase 2 (arquivar). Nada lê nem grava ainda. */
  arquivado?: boolean;
}

export interface Squad {
  /** slug ≤40, único entre squads; valor de `squadone_squad` no Calendar. */
  id: string;
  nome: string;
  /** Vai literal para o prompt: é o que faz o modelo sugerir troca de squad. */
  escopo: string;
  /**
   * Onde os eventos desta squad moram. Hoje sempre "primary"; guardado por
   * squad para um calendário secundário não exigir migração de formato.
   */
  calendarId: string;
  /** Reservado: conta Google dona do calendário. Ausente = a conta conectada. */
  conta?: string;
  unlockOrder: [number, number][];
  /** ≥1. `dominios[0].po` é o PO raiz que circula pelo escritório. */
  dominios: Dominio[];
}

export interface Roster {
  version: 3;
  /** ≥1. `squads[0]` é a padrão quando o pedido não diz qual. */
  squads: Squad[];
  /**
   * Ids que já existiram e não voltam. GLOBAL porque a unicidade que protege é
   * global; dois namespaces porque pessoa e domínio podem ter o mesmo id legado
   * (produção tem domínio "po" e pessoa "po"). Fase 1 só lê.
   */
  idsAposentados: { pessoas: string[]; dominios: string[] };
}

export type SquadView = Squad & { unlockedSlots: [number, number][] };
export type RosterView = Omit<Roster, "squads"> & { squads: SquadView[] };

/** Forma do pedido errada: nenhum estado do roster tornaria o pedido válido (400). */
export class PedidoInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PedidoInvalido";
  }
}

/** Pedido bem formado que não cabe no roster ATUAL (409, não 400). */
export class ConflitoDeRoster extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConflitoDeRoster";
  }
}

/**
 * `squadId` que não existe neste volume. É conflito, não pedido malformado: o
 * caso típico é a squad guardada no localStorage de outra instalação. A
 * classificação diz à UI o gesto certo — recarregar o roster e cair na primeira.
 */
export class SquadInexistente extends ConflitoDeRoster {
  readonly squadId: string;
  constructor(squadId: string, existentes: string[]) {
    super(`A squad '${squadId}' não existe. Squads: ${existentes.join(", ")}.`);
    this.name = "SquadInexistente";
    this.squadId = squadId;
  }
}

/** squad.json com forma desconhecida ou quebrada. Nunca é sobrescrito. */
export class RosterIlegivel extends Error {
  constructor(mensagem: string) {
    super(`squad.json ilegível: ${mensagem}`);
    this.name = "RosterIlegivel";
  }
}
```

Caminhos, constantes, escrita atômica, fila:

```ts
const DATA_DIR = path.join(process.cwd(), "data");
const SQUAD_PATH = path.join(DATA_DIR, "squad.json");
// SEED_PATHS: manter o bloco atual, com o comentário.

export const MAX_DOMINIOS = 9;

/** Ordem de desbloqueio de salas de uma squad nova — a mesma da seed. */
export const UNLOCK_ORDER_PADRAO: [number, number][] = [
  [0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1], [0, 2], [1, 2], [2, 2],
];

export const ESCOPO_PESSOAL_PADRAO = "vida pessoal e tudo que não pertence a outra squad";

/**
 * Grava num `.tmp` no mesmo diretório e renomeia por cima. Um crash no meio
 * deixa o `.tmp` pela metade, nunca o destino. O contador entra no nome porque
 * duas escritas concorrentes no mesmo destino (dois requests semeando um volume
 * vazio) dividiriam um `.tmp` só por pid, e o segundo rename falharia.
 */
let seqTmp = 0;
async function gravarAtomico(destino: string, conteudo: string): Promise<void> {
  await fs.mkdir(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.${process.pid}.${++seqTmp}.tmp`;
  await fs.writeFile(tmp, conteudo, "utf8");
  try {
    await fs.rename(tmp, destino);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export async function writeRoster(roster: Roster): Promise<void> {
  await gravarAtomico(SQUAD_PATH, JSON.stringify(roster, null, 2) + "\n");
}

/**
 * Fila de escrita: toda mutação do roster passa por aqui. Um arquivo só para
 * todas as squads, então uma fila só — duas aprovações quase simultâneas, mesmo
 * em squads diferentes, leriam o mesmo squad.json e a segunda apagaria a primeira.
 */
let fila: Promise<unknown> = Promise.resolve();

export function atualizarRoster<T>(mutador: (roster: Roster) => T): Promise<T> {
  const proximo = fila.then(async () => {
    const roster = await readRoster();
    // Se o mutador lançar, nada é gravado: o roster em disco fica intacto.
    const saida = mutador(roster);
    await writeRoster(roster);
    return saida;
  });
  // A fila não pode morrer num erro: o próximo escritor ainda precisa rodar.
  fila = proximo.catch(() => undefined);
  return proximo;
}
```

Seed, detecção, migração, validação, leitura:

```ts
/** Texto cru da seed do primeiro caminho que existir. */
async function lerSeed(): Promise<string> {
  for (const caminho of SEED_PATHS) {
    try {
      return await fs.readFile(caminho, "utf8");
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
  }
  throw new Error(
    `Seed do roster nao encontrada. Procurei em: ${SEED_PATHS.join(", ")}.`,
  );
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await fs.access(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copia a seed se `data/squad.json` ainda não existir. Grava o texto como veio:
 * uma seed antiga v2 (caminho legado) é migrada pela leitura seguinte, com backup.
 */
async function ensureRoster(): Promise<void> {
  if (await existe(SQUAD_PATH)) return;
  await gravarAtomico(SQUAD_PATH, await lerSeed());
}

/** Roster v2: um squad implícito, domínios na raiz. */
interface RosterV2 {
  version: number;
  unlockOrder: [number, number][];
  dominios: Dominio[];
}

// interface MembroV1 e migrarV1: manter como estão, trocando o tipo de retorno para RosterV2.

/**
 * Versão pela FORMA, nunca pelo campo `version`: arquivos antigos foram
 * escritos à mão e o campo não é confiável. A ordem dos testes importa.
 */
export function detectarVersao(bruto: unknown): 1 | 2 | 3 {
  const b = bruto as any;
  if (Array.isArray(b?.squads)) return 3;
  if (Array.isArray(b?.dominios)) return 2;
  if (Array.isArray(b?.members)) return 1;
  throw new RosterIlegivel("forma desconhecida (sem 'squads', 'dominios' nem 'members').");
}

/**
 * v2 → v3. O roster inteiro vira a squad "pessoal" e os domínios passam
 * INTACTOS: `squadone_dominio` dos eventos já gravados no Google continua
 * batendo com os ids, sem backfill. Pura e determinística — nada de relógio
 * ou id aleatório — para que refazer a migração dê o mesmo arquivo.
 */
export function migrarV2(v2: RosterV2): Roster {
  return {
    version: 3,
    squads: [
      {
        id: "pessoal",
        nome: "Pessoal",
        escopo: ESCOPO_PESSOAL_PADRAO,
        calendarId: "primary",
        unlockOrder: v2.unlockOrder,
        dominios: v2.dominios,
      },
    ],
    idsAposentados: { pessoas: [], dominios: [] },
  };
}

/** Forma mínima que o resto do código assume. Não checa unicidade: isso é da escrita. */
function validarV3(bruto: any): Roster {
  const falha = (mensagem: string): never => {
    throw new RosterIlegivel(mensagem);
  };
  if (!Array.isArray(bruto?.squads) || bruto.squads.length === 0) falha("'squads' vazio.");
  for (const s of bruto.squads) {
    if (typeof s?.id !== "string" || !s.id) falha("squad sem 'id'.");
    if (!Array.isArray(s.unlockOrder)) falha(`squad '${s.id}' sem 'unlockOrder'.`);
    if (!Array.isArray(s.dominios) || s.dominios.length === 0) falha(`squad '${s.id}' sem domínios.`);
    for (const d of s.dominios) {
      if (typeof d?.id !== "string") falha(`domínio sem 'id' na squad '${s.id}'.`);
      const slotOk = Array.isArray(d.slot) && d.slot.length === 2 && d.slot.every((n: unknown) => typeof n === "number");
      if (!slotOk) falha(`domínio '${d.id}' com 'slot' inválido.`);
      if (typeof d.po?.id !== "string") falha(`domínio '${d.id}' sem PO.`);
      if (!Array.isArray(d.integrantes)) falha(`domínio '${d.id}' sem 'integrantes'.`);
    }
  }
  const ap = bruto.idsAposentados;
  bruto.idsAposentados = {
    pessoas: Array.isArray(ap?.pessoas) ? ap.pessoas : [],
    dominios: Array.isArray(ap?.dominios) ? ap.dominios : [],
  };
  bruto.version = 3;
  return bruto as Roster;
}

function interpretar(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch (err: any) {
    throw new RosterIlegivel(`JSON inválido (${err?.message ?? err}).`);
  }
}

/**
 * Uma migração por processo por vez. No boot, /api/squad e /api/mochila chegam
 * juntos; sem isto cada um faria backup, conversão e escrita por conta própria,
 * e os chamadores receberiam objetos de migrações diferentes.
 */
let migracao: Promise<Roster> | null = null;

async function migrarNoDisco(): Promise<Roster> {
  // Relê aqui dentro: quem disparou pode ter lido v2 logo antes de outra
  // migração terminar. Nesse caso o arquivo já é v3 e não há o que fazer.
  const texto = await fs.readFile(SQUAD_PATH, "utf8");
  const bruto = interpretar(texto);
  const versao = detectarVersao(bruto);
  if (versao === 3) return validarV3(bruto);

  // Backup do texto CRU antes de qualquer escrita, e nunca por cima de um
  // backup existente: o primeiro é o único que garantidamente é o original.
  const backup = path.join(DATA_DIR, `squad.v${versao}.bak.json`);
  if (!(await existe(backup))) await gravarAtomico(backup, texto);

  const v2 = versao === 1 ? migrarV1(bruto as any) : (bruto as RosterV2);
  const v3 = validarV3(migrarV2(v2));
  await writeRoster(v3);
  return v3;
}

export async function readRoster(): Promise<Roster> {
  await ensureRoster();
  const bruto = interpretar(await fs.readFile(SQUAD_PATH, "utf8"));
  if (detectarVersao(bruto) === 3) return validarV3(bruto);

  if (!migracao) {
    migracao = migrarNoDisco().finally(() => {
      migracao = null;
    });
  }
  // Clone por chamador: um mutador de atualizarRoster não pode alterar o objeto
  // que outra leitura concorrente recebeu.
  return structuredClone(await migracao);
}
```

Slots e vista:

```ts
/**
 * Slots OCUPADOS. Derivar de `dominios.length` quebrava quando um domínio sai
 * do meio da ordem: o próximo slot já estaria em uso. Guardar "salas
 * desbloqueadas" à parte seria estado duplicado.
 */
export function unlockedSlots(squad: Squad): [number, number][] {
  return squad.dominios.map((d) => d.slot);
}

/** Primeiro slot da ordem de desbloqueio que ninguém ocupa; null com as 9 cheias. */
export function proximoSlot(squad: Squad): [number, number] | null {
  const ocupados = new Set(squad.dominios.map((d) => d.slot.join(",")));
  return squad.unlockOrder.find((s) => !ocupados.has(s.join(","))) ?? null;
}

/** O que sai pela API: cada squad com os slots já calculados. */
export function paraVista(roster: Roster): RosterView {
  return {
    ...roster,
    squads: roster.squads.map((s) => ({ ...s, unlockedSlots: unlockedSlots(s) })),
  };
}
```

Helpers de roster (depois dos helpers por squad):

```ts
/**
 * Squad do pedido. Ausente = a primeira: cliente antigo e chamada sem seletor
 * continuam funcionando.
 */
export function resolverSquad(roster: Roster, squadId: unknown): Squad {
  if (squadId === undefined || squadId === null || squadId === "") return roster.squads[0];
  if (typeof squadId !== "string") throw new PedidoInvalido("Campo 'squadId' deve ser texto.");
  const achada = roster.squads.find((s) => s.id === squadId);
  if (!achada) throw new SquadInexistente(squadId, roster.squads.map((s) => s.id));
  return achada;
}

export function todasAsPessoas(roster: Roster): Pessoa[] {
  return roster.squads.flatMap((s) => pessoas(s).map((p) => p.pessoa));
}

/** Tudo que não pode ser reusado: ids vivos de todas as squads + aposentados. */
export function idsEmUso(roster: Roster): {
  pessoas: Set<string>;
  dominios: Set<string>;
  squads: Set<string>;
} {
  const idsPessoas = new Set(roster.idsAposentados.pessoas);
  const idsDominios = new Set(roster.idsAposentados.dominios);
  for (const s of roster.squads) {
    for (const d of s.dominios) idsDominios.add(d.id);
  }
  for (const p of todasAsPessoas(roster)) idsPessoas.add(p.id);
  return { pessoas: idsPessoas, dominios: idsDominios, squads: new Set(roster.squads.map((s) => s.id)) };
}

function slugCurto(texto: string, max: number): string {
  return slug(texto).slice(0, max).replace(/-+$/g, "") || "geral";
}

/**
 * id de pessoa: é o `responsavel_id` do modelo e o `squadone_membro` do
 * Calendar. Único entre TODAS as squads e aposentados; colisão ganha sufixo.
 */
export function novoIdDePessoa(roster: Roster, nome: string): string {
  const usados = idsEmUso(roster).pessoas;
  const base = slug(nome);
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) {
    const tentativa = `${base}-${i}`;
    if (!usados.has(tentativa)) return tentativa;
  }
}

/**
 * id de domínio criado a partir da Fase 1: `<squad>--<slug>`. `slug()` colapsa
 * separadores num único `-`, então nenhum id legado contém `--` e o prefixo não
 * colide com eles. Duplicata é conflito, não sufixo: dois domínios com o mesmo
 * nome na mesma squad são engano, não dois temas.
 */
export function novoIdDeDominio(roster: Roster, squad: Squad, nome: string): string {
  const id = `${squad.id}--${slugCurto(nome, 60)}`;
  const mesmoNome = squad.dominios.find((d) => slug(d.nome) === slug(nome));
  if (mesmoNome) {
    throw new ConflitoDeRoster(
      `O domínio '${mesmoNome.nome}' (id '${mesmoNome.id}') já existe na squad '${squad.nome}'.`,
    );
  }
  if (idsEmUso(roster).dominios.has(id)) {
    throw new ConflitoDeRoster(`O id de domínio '${id}' já existe ou já existiu.`);
  }
  return id;
}

export function novoIdDeSquad(roster: Roster, nome: string): string {
  const id = slugCurto(nome, 40);
  const existente = roster.squads.find((s) => s.id === id);
  if (existente) {
    throw new ConflitoDeRoster(`A squad '${existente.nome}' (id '${id}') já existe.`);
  }
  return id;
}

/**
 * As OUTRAS squads para o prompt: só id, nome e escopo. O modelo precisa saber
 * que existem para sugerir troca, e não pode ver domínios nem pessoas delas
 * para não agendar fora da squad ativa.
 */
export function outrasSquads(roster: Roster, ativaId: string): string {
  const linhas = roster.squads
    .filter((s) => s.id !== ativaId)
    .map((s) => `- squad '${s.id}' — ${s.nome} (escopo: ${s.escopo})`);
  return linhas.length ? linhas.join("\n") : "(nenhuma)";
}
```

Pontes temporárias (fim do arquivo):

```ts
/**
 * PONTE da Fase 1 — removida na Task 4. Deixa hire/capabilities/orchestrator/
 * server compilando sobre a primeira squad enquanto migram para o roster.
 */
export async function readSquad(): Promise<Squad> {
  return (await readRoster()).squads[0];
}

/** PONTE da Fase 1 — removida na Task 4. */
export function atualizarSquad<T>(mutador: (squad: Squad) => T): Promise<T> {
  return atualizarRoster((roster) => mutador(roster.squads[0]));
}
```

Remova `writeSquad`, `ensureSquad` e a antiga `readSquad` (substituídas acima). Remova o comentário antigo de `unlockedSlots` que dizia "Fonte de verdade: `dominios.length`".

- [ ] **Step 5: Converter a seed para v3**

Releia `seed/squad.seed.json`. Substitua pelo mesmo conteúdo embrulhado:

```json
{
  "version": 3,
  "squads": [
    {
      "id": "pessoal",
      "nome": "Pessoal",
      "escopo": "vida pessoal e tudo que não pertence a outra squad",
      "calendarId": "primary",
      "unlockOrder": [[0,0],[1,0],[0,1],[1,1],[2,0],[2,1],[0,2],[1,2],[2,2]],
      "dominios": [ /* o array "dominios" atual da seed, sem nenhuma mudança */ ]
    }
  ],
  "idsAposentados": { "pessoas": [], "dominios": [] }
}
```

(O comentário acima é só indicação para este plano; JSON não aceita comentário — cole o array real.)

- [ ] **Step 6: Rodar os cenários e ver passar**

```bash
cd "$SCRATCH/fase1" && for c in v2-producao v2-seed v1 idempotente v3-no-disco ilegivel json-quebrado falha-no-meio crash tmp-orfao concorrencia vazio vazio-concorrente copia-real slots resolver-e-ids; do npx tsx roster.ts $c || break; done
```

Esperado: 16 linhas `OK <cenário>` (ou `SKIP copia-real`).

- [ ] **Step 7: Typecheck, build e garantia de que a migração não fala com o Google**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build && ! grep -n "fetch(\|calendar.ts" server/squad.ts
```

Esperado: typecheck sem erros, build ok, grep sem saída.

- [ ] **Step 8: Commit**

```bash
cd "$REPO" && git add server/squad.ts seed/squad.seed.json && git commit -m "$(cat <<'EOF'
feat(roster): formato v3 com squads e migracao v1/v2 com backup

O roster ganha um nivel acima do dominio. data/squad.json v2 vira a squad
"pessoal" com ids de dominio e pessoa intactos, entao squadone_dominio dos
eventos ja gravados continua batendo sem backfill. A migracao detecta pela
forma, grava backup do texto cru antes de escrever, roda sob promessa unica
(boot concorrente disputaria o mesmo .tmp) e nao sobrescreve arquivo ilegivel.

proximoSlot passa a olhar slots ocupados em vez de dominios.length. Regras de
id globais e idsAposentados entram agora, antes de a Fase 2 contratar mais.
Pontes readSquad/atualizarSquad mantem os chamadores compilando ate a Task 4.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Contratação por squad e `criarSquad` em `server/hire.ts`

**Files:**
- Modify: `server/hire.ts` (arquivo inteiro)
- Test: `$SCRATCH/fase1/hire.ts`

**Interfaces:**
- Consumes (Task 1): `atualizarRoster`, `resolverSquad`, `proximoSlot`, `paraVista`, `novoIdDePessoa`, `novoIdDeDominio`, `novoIdDeSquad`, `todasAsPessoas`, `acharDominio`, `salaPara`, `UNLOCK_ORDER_PADRAO`, `MAX_DOMINIOS`, `PedidoInvalido`, `ConflitoDeRoster`, tipos.
- Produces (Task 4, 5):
  - `export { ConflitoDeRoster } from "./squad.ts"` (reexport de compatibilidade)
  - `interface HireResult { kind: "dominio" | "integrante"; squadId: string; roster: RosterView; dominio: Dominio; pessoa: Pessoa }`
  - `aplicarContratacao(sugestao: any, nome?: unknown): Promise<HireResult>` — squad = `sugestao.squad_id`
  - `interface NovaSquadResult { roster: RosterView; squad: SquadView }`
  - `criarSquad(dados: any): Promise<NovaSquadResult>` — `dados = { nome, escopo, papel_po, nome_po? }`

- [ ] **Step 1: Escrever o script**

`$SCRATCH/fase1/hire.ts`:

```ts
import assert from "node:assert/strict";
import { importar, prepararDiretorio, rejeitaCom, txt, V2_PRODUCAO, UO } from "./harness.ts";

const cenario = process.argv[2];
const PAY4FUN = { nome: "Pay4Fun", escopo: "trabalho na Pay4Fun", papel_po: "PO Pay4Fun" };

async function main() {
  switch (cenario) {
    case "nova-squad": {
      await prepararDiretorio(txt(V2_PRODUCAO));
      const hire = await importar("server/hire.ts");
      const sq = await importar("server/squad.ts");
      const { roster, squad } = await hire.criarSquad(PAY4FUN);
      assert.equal(squad.id, "pay4fun");
      assert.equal(squad.calendarId, "primary");
      assert.equal(squad.dominios.length, 1);
      assert.equal(squad.dominios[0].id, "pay4fun--geral");
      assert.deepEqual(squad.dominios[0].slot, [0, 0]);
      assert.equal(squad.dominios[0].po.papel, "PO Pay4Fun");
      assert.deepEqual(squad.unlockedSlots, [[0, 0]]);
      assert.deepEqual(squad.unlockOrder, UO);
      assert.equal(roster.squads.length, 2);
      assert.equal((await sq.readRoster()).squads.length, 2);
      await rejeitaCom(hire.criarSquad(PAY4FUN), "ConflitoDeRoster");
      await rejeitaCom(hire.criarSquad({ ...PAY4FUN, nome: "" }), "PedidoInvalido");
      await rejeitaCom(hire.criarSquad({ ...PAY4FUN, nome: "Outra", papel_po: " " }), "PedidoInvalido");
      break;
    }
    case "pessoa-global": {
      await prepararDiretorio(txt(V2_PRODUCAO));
      const hire = await importar("server/hire.ts");
      const { squad } = await hire.criarSquad({ ...PAY4FUN, nome_po: "PO" });
      assert.equal(squad.dominios[0].po.id, "po-2");
      assert.equal(squad.dominios[0].po.nome, "PO");
      break;
    }
    case "aposentado": {
      const v3 = {
        version: 3,
        idsAposentados: { pessoas: ["ana"], dominios: [] },
        squads: [{ id: "pessoal", nome: "Pessoal", escopo: "x", calendarId: "primary", unlockOrder: UO, dominios: V2_PRODUCAO.dominios }],
      };
      await prepararDiretorio(txt(v3));
      const hire = await importar("server/hire.ts");
      const r = await hire.aplicarContratacao({
        kind: "integrante", squad_id: "pessoal", dominio_id: "po", papel: "QA", justificativa: "j", escopo: "testes",
      });
      assert.equal(r.pessoa.nome, "Ana");
      assert.equal(r.pessoa.id, "ana-2");
      assert.equal(r.squadId, "pessoal");
      break;
    }
    case "hire-por-squad": {
      await prepararDiretorio(txt(V2_PRODUCAO));
      const hire = await importar("server/hire.ts");
      await hire.criarSquad(PAY4FUN);
      const fin = { kind: "dominio", dominio: "Financeiro", papel_po: "PO Fin", justificativa: "j", escopo: "contas" };
      const a = await hire.aplicarContratacao({ ...fin, squad_id: "pay4fun" });
      assert.equal(a.squadId, "pay4fun");
      assert.equal(a.dominio.id, "pay4fun--financeiro");
      assert.deepEqual(a.dominio.slot, [1, 0]);
      assert.equal(a.roster.squads.find((s: any) => s.id === "pay4fun").dominios.length, 2);
      const b = await hire.aplicarContratacao({ ...fin, squad_id: "pessoal" });
      assert.equal(b.dominio.id, "pessoal--financeiro");
      await rejeitaCom(hire.aplicarContratacao({ ...fin, squad_id: "pessoal" }), "ConflitoDeRoster");
      await rejeitaCom(hire.aplicarContratacao({ ...fin, squad_id: "nao-existe" }), "SquadInexistente");
      await rejeitaCom(hire.aplicarContratacao({ kind: "troca_squad", squad_id: "pessoal" }), "PedidoInvalido");
      const c = await hire.aplicarContratacao({ kind: "integrante", dominio_id: "po", papel: "Designer", justificativa: "j", escopo: "telas" });
      assert.equal(c.squadId, "pessoal");
      await rejeitaCom(
        hire.aplicarContratacao({ kind: "integrante", squad_id: "pay4fun", dominio_id: "po", papel: "QA", justificativa: "j", escopo: "t" }),
        "ConflitoDeRoster",
      );
      break;
    }
    case "nome-duplicado-legado": {
      const v2 = structuredClone(V2_PRODUCAO) as any;
      v2.dominios.push({ ...structuredClone(v2.dominios[0]), id: "financeiro", nome: "Financeiro", slot: [1, 0],
        po: { ...v2.dominios[0].po, id: "fin", nome: "Fin" } });
      await prepararDiretorio(txt(v2));
      const hire = await importar("server/hire.ts");
      await rejeitaCom(
        hire.aplicarContratacao({ kind: "dominio", squad_id: "pessoal", dominio: "Financeiro", papel_po: "PO", justificativa: "j", escopo: "e" }),
        "ConflitoDeRoster",
      );
      break;
    }
    default:
      throw new Error(`Cenário desconhecido: ${cenario}`);
  }
  console.log(`OK ${cenario}`);
}

main().catch((e) => { console.error(`FALHOU ${cenario}:`, e); process.exit(1); });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase1" && for c in nova-squad pessoa-global aposentado hire-por-squad nome-duplicado-legado; do npx tsx hire.ts $c || break; done
```

Esperado: `FALHOU nova-squad` (`hire.criarSquad is not a function`).

- [ ] **Step 3: Reescrever `server/hire.ts`**

Releia o arquivo. Mantenha o comentário de topo (acrescentando "dentro da squad da proposta") e a lista `NOMES`. Conteúdo:

```ts
import {
  acharDominio,
  atualizarRoster,
  ConflitoDeRoster,
  MAX_DOMINIOS,
  novoIdDeDominio,
  novoIdDePessoa,
  novoIdDeSquad,
  paraVista,
  PedidoInvalido,
  proximoSlot,
  resolverSquad,
  salaPara,
  todasAsPessoas,
  UNLOCK_ORDER_PADRAO,
  type Dominio,
  type Pessoa,
  type Roster,
  type RosterView,
  type Squad,
  type SquadView,
} from "./squad.ts";

/** Mora em squad.ts agora; reexportado para quem ainda importa daqui. */
export { ConflitoDeRoster } from "./squad.ts";

export interface HireResult {
  kind: "dominio" | "integrante";
  /** Squad onde a contratação entrou — pode não ser a que a tela mostra agora. */
  squadId: string;
  roster: RosterView;
  dominio: Dominio;
  pessoa: Pessoa;
}

export interface NovaSquadResult {
  roster: RosterView;
  squad: SquadView;
}

// const NOMES = [...]  (manter)

/** Nome livre olhando TODAS as squads: duas "Ana" viram ids ana e ana-2, e confundem. */
function nomeEscolhido(roster: Roster, nome: unknown): string {
  const pedido = String(nome ?? "").trim();
  if (pedido) return pedido.slice(0, 40);
  const usados = new Set(todasAsPessoas(roster).map((p) => p.nome));
  return NOMES.find((n) => !usados.has(n)) ?? `Pessoa ${todasAsPessoas(roster).length + 1}`;
}

function novaPessoa(
  roster: Roster,
  dados: { nome: string; papel: string; escopo: string },
  agora: string,
): Pessoa {
  return {
    id: novoIdDePessoa(roster, dados.nome),
    nome: dados.nome,
    papel: dados.papel,
    escopo: dados.escopo,
    // Vazio de propósito: quem distribui sprite e hue entre os papéis é o
    // GameMap (§5.3), com um pool só. Fixar aqui duplicaria esse pool.
    sprite: "",
    hiredAt: agora,
  };
}

function texto(valor: unknown, campo: string, max = 120): string {
  const v = String(valor ?? "").trim();
  if (!v) throw new PedidoInvalido(`Campo '${campo}' é obrigatório.`);
  return v.slice(0, max);
}

/**
 * Executa a proposta aprovada, NA SQUAD DA PROPOSTA (`sugestao.squad_id`), não
 * na que a tela mostra: o usuário pode ter trocado de squad entre o turno e o
 * clique. `sugestao` volta pelo body e é entrada não confiável — tudo é
 * revalidado contra o roster atual.
 */
export async function aplicarContratacao(
  sugestao: any,
  nome?: unknown,
): Promise<HireResult> {
  const kind = sugestao?.kind;
  if (kind !== "dominio" && kind !== "integrante") {
    throw new PedidoInvalido("Campo 'sugestao.kind' deve ser 'dominio' ou 'integrante'.");
  }

  return atualizarRoster((roster) => {
    const squad = resolverSquad(roster, sugestao.squad_id);
    const agora = new Date().toISOString();

    if (kind === "dominio") {
      const nomeDominio = texto(sugestao.dominio, "sugestao.dominio", 60);
      const escopo = texto(sugestao.escopo, "sugestao.escopo", 200);
      const papelPo = texto(sugestao.papel_po, "sugestao.papel_po", 60);
      // O slot sai do roster AGORA, não do que a proposta carregava: outro
      // domínio pode ter ocupado aquele slot depois do turno.
      const slot = proximoSlot(squad);
      if (!slot) {
        throw new ConflitoDeRoster(
          `A squad '${squad.nome}' já tem ${MAX_DOMINIOS} domínios — não há sala livre.`,
        );
      }
      const dominio: Dominio = {
        id: novoIdDeDominio(roster, squad, nomeDominio),
        nome: nomeDominio,
        escopo,
        slot,
        room: salaPara(1),
        criadoEm: agora,
        po: novaPessoa(roster, { nome: nomeEscolhido(roster, nome), papel: papelPo, escopo }, agora),
        integrantes: [],
      };
      squad.dominios.push(dominio);
      return { kind, squadId: squad.id, roster: paraVista(roster), dominio, pessoa: dominio.po } satisfies HireResult;
    }

    const papel = texto(sugestao.papel, "sugestao.papel", 60);
    const escopo = texto(sugestao.escopo, "sugestao.escopo", 200);
    const dominio = acharDominio(squad, sugestao.dominio_id);
    if (!dominio) {
      const ids = squad.dominios.map((d) => d.id).join(", ");
      throw new ConflitoDeRoster(
        `dominio_id '${String(sugestao.dominio_id)}' não existe na squad '${squad.nome}'. Domínios: ${ids}.`,
      );
    }
    const pessoa = novaPessoa(roster, { nome: nomeEscolhido(roster, nome), papel, escopo }, agora);
    dominio.integrantes.push(pessoa);
    // Sala com duas pessoas precisa de duas cadeiras, senão o segundo ator cai
    // num posto improvisado do miolo (EXTRA_STATIONS).
    dominio.room = salaPara(1 + dominio.integrantes.length, dominio.room);
    return { kind, squadId: squad.id, roster: paraVista(roster), dominio, pessoa } satisfies HireResult;
  });
}

/**
 * Gesto "Nova squad". A squad nasce com UM domínio e o PO dele: o escritório
 * não tem como desenhar uma squad vazia (o PO raiz é `dominios[0].po`).
 */
export async function criarSquad(dados: any): Promise<NovaSquadResult> {
  const nome = texto(dados?.nome, "nome", 40);
  const escopo = texto(dados?.escopo, "escopo", 200);
  const papelPo = texto(dados?.papel_po, "papel_po", 60);

  return atualizarRoster((roster) => {
    const agora = new Date().toISOString();
    const squad: Squad = {
      id: novoIdDeSquad(roster, nome),
      nome,
      escopo,
      calendarId: "primary",
      unlockOrder: UNLOCK_ORDER_PADRAO.map(([x, y]) => [x, y] as [number, number]),
      dominios: [],
    };
    const dominio: Dominio = {
      id: novoIdDeDominio(roster, squad, "Geral"),
      nome: "Geral",
      escopo,
      slot: squad.unlockOrder[0],
      room: salaPara(1),
      criadoEm: agora,
      po: novaPessoa(roster, { nome: nomeEscolhido(roster, dados?.nome_po), papel: papelPo, escopo }, agora),
      integrantes: [],
    };
    squad.dominios.push(dominio);
    roster.squads.push(squad);
    const vista = paraVista(roster);
    return { roster: vista, squad: vista.squads[vista.squads.length - 1] };
  });
}
```

- [ ] **Step 4: Ajustar `server.ts` ao novo `HireResult`**

A resposta de `/api/squad/hire` agora traz `roster`, não `squad`. Nesta task só a rota muda de status: releia `server.ts` e troque o `catch` de `/api/squad/hire` por:

```ts
    } catch (error: any) {
      // Conflito = a proposta não cabe mais no roster atual (domínio duplicado,
      // escritório cheio, squad inexistente): é estado que mudou, não pedido
      // malformado. Erro sem classificação é nosso (disco, roster ilegível): 500.
      const status =
        error instanceof ConflitoDeRoster ? 409 : error instanceof PedidoInvalido ? 400 : 500;
      console.error("Erro ao contratar:", error);
      res.status(status).json({ error: error.message });
    }
```

e acrescente `PedidoInvalido` ao import de `./server/squad.ts`. O frontend (`App.vue` faz `squad.value = dados.squad`) fica quebrado para contratação até a Task 5; não há deploy entre tasks.

- [ ] **Step 5: Rodar e ver passar**

```bash
cd "$SCRATCH/fase1" && for c in nova-squad pessoa-global aposentado hire-por-squad nome-duplicado-legado; do npx tsx hire.ts $c || break; done
cd "$SCRATCH/fase1" && for c in v2-producao concorrencia resolver-e-ids; do npx tsx roster.ts $c || break; done
```

Esperado: 5 + 3 linhas `OK`.

- [ ] **Step 6: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros.

- [ ] **Step 7: Commit**

```bash
cd "$REPO" && git add server/hire.ts server.ts && git commit -m "$(cat <<'EOF'
feat(roster): contratar dentro da squad da proposta e criar squad

aplicarContratacao resolve a squad por sugestao.squad_id, nao pela tela: o
usuario pode trocar de squad entre o turno e o clique. Dominio novo ganha id
<squad>--<slug> e pessoa ganha id unico entre todas as squads e aposentados.

criarSquad nasce com um dominio Geral e o PO dele, porque o escritorio precisa
de um PO raiz para desenhar. Erro sem classificacao na contratacao vira 500 em
vez de 400.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Contrato do evento, capacidades por squad e `sugerir_troca_squad`

**Files:**
- Modify: `server/calendar.ts`
- Modify: `server/capabilities.ts`
- Modify: `server/orchestrator.ts` (só o contexto; prompt é Task 4)
- Modify: `server.ts` (só a chamada de `listarQuests`)
- Test: `$SCRATCH/fase1/capacidades.ts`

**Interfaces:**
- Consumes (Task 1): `Roster`, `Squad`, `acharDominio`, `acharPessoa`, `idsDePessoas`, `proximoSlot`, `novoIdDeDominio`, `MAX_DOMINIOS`, `readRoster`; pontes `readSquad`.
- Produces:
  - `calendar.ts`: `PROP_SQUAD = "squadone_squad"`; `marcasDoEvento(m: { squadId: string; dominioId: string; pessoaId: string; tipo: "time_blocking" | "deadline" }): Record<string, string>`; `urlDeEventos(calendarId: string): string`; `listarQuests(token: string, calendarId: string, dominios: string[], agora: Date)`; `QuestCalendario.squad: string`. `marcasDoMembro` deixa de existir.
  - `capabilities.ts`: `CapabilityContext { token; roster: Roster; squad: Squad; agora; modo; demanda: string }`; `PropostaDominio.squad_id`, `PropostaIntegrante.squad_id`; `interface PropostaTrocaSquad { kind: "troca_squad"; squad_id: string; destino_id: string; destino_nome: string; justificativa: string; demanda: string }`; `Sugestao = (PropostaDominio | PropostaIntegrante | PropostaTrocaSquad) & { id: string }`; `CAPABILITIES.sugerir_troca_squad`.

- [ ] **Step 1: Escrever o script**

`$SCRATCH/fase1/capacidades.ts`:

```ts
import assert from "node:assert/strict";
import { importar, prepararDiretorio, rejeitaCom, V3_DUAS } from "./harness.ts";

const cenario = process.argv[2];

type Chamada = { url: string; init?: RequestInit };
function mockarFetch(resposta: unknown): Chamada[] {
  const chamadas: Chamada[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    return new Response(JSON.stringify(resposta), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return chamadas;
}

function contexto(ativa: "pessoal" | "pay4fun", mudar?: (r: any) => void) {
  const roster = structuredClone(V3_DUAS) as any;
  mudar?.(roster);
  return {
    token: "tok", roster, squad: roster.squads.find((s: any) => s.id === ativa),
    agora: new Date("2026-09-14T12:00:00Z"), modo: "auto", demanda: "revisar o PR do checkout",
  };
}

async function main() {
  await prepararDiretorio();
  const { CAPABILITIES } = await importar("server/capabilities.ts");

  switch (cenario) {
    case "agendar": {
      const chamadas = mockarFetch({ id: "ev1", htmlLink: "https://x" });
      const r = await CAPABILITIES.agendar_evento.handler(
        { titulo: "Revisar PR", responsavel_id: "bia", tipo: "time_blocking", inicio: "2026-09-14T10:00:00-03:00", duracao_min: 30 },
        contexto("pay4fun"),
      );
      assert.equal(r.eventId, "ev1");
      assert.equal(chamadas.length, 1);
      assert.ok(chamadas[0].url.endsWith("/calendars/primary/events"), chamadas[0].url);
      const corpo = JSON.parse(String(chamadas[0].init?.body));
      assert.deepEqual(corpo.extendedProperties.private, {
        squadone_squad: "pay4fun", squadone_dominio: "pay4fun--geral", squadone_membro: "bia", squadone_tipo: "time_blocking",
      });
      break;
    }
    case "agendar-outra-squad": {
      const chamadas = mockarFetch({ id: "ev1" });
      await assert.rejects(CAPABILITIES.agendar_evento.handler(
        { titulo: "x", responsavel_id: "romulo", tipo: "deadline", prazo_final: "2026-09-15T18:00:00-03:00" },
        contexto("pay4fun"),
      ));
      assert.equal(chamadas.length, 0);
      break;
    }
    case "calendar-id": {
      const chamadas = mockarFetch({ id: "ev1" });
      await CAPABILITIES.agendar_evento.handler(
        { titulo: "x", responsavel_id: "bia", tipo: "deadline", prazo_final: "2026-09-15T18:00:00-03:00" },
        contexto("pay4fun", (r) => { r.squads[1].calendarId = "abc@group.calendar.google.com"; }),
      );
      assert.ok(chamadas[0].url.includes("/calendars/abc%40group.calendar.google.com/events"), chamadas[0].url);
      break;
    }
    case "propostas": {
      const d = await CAPABILITIES.criar_po_dominio.handler(
        { dominio: "Financeiro", papel_po: "PO Fin", justificativa: "j", escopo: "contas" }, contexto("pay4fun"),
      );
      assert.equal(d.kind, "dominio");
      assert.equal(d.squad_id, "pay4fun");
      assert.deepEqual(d.slot, [1, 0]);
      await assert.rejects(CAPABILITIES.criar_po_dominio.handler(
        { dominio: "Geral", papel_po: "PO", justificativa: "j", escopo: "e" }, contexto("pay4fun"),
      ));
      const i = await CAPABILITIES.contratar_integrante.handler(
        { dominio_id: "pay4fun--geral", papel: "QA", justificativa: "j", escopo: "t" }, contexto("pay4fun"),
      );
      assert.equal(i.squad_id, "pay4fun");
      await assert.rejects(CAPABILITIES.contratar_integrante.handler(
        { dominio_id: "casa", papel: "QA", justificativa: "j", escopo: "t" }, contexto("pay4fun"),
      ));
      break;
    }
    case "troca": {
      const t = await CAPABILITIES.sugerir_troca_squad.handler(
        { squad_id: "pessoal", justificativa: "é da vida pessoal" }, contexto("pay4fun"),
      );
      assert.deepEqual(t, {
        kind: "troca_squad", squad_id: "pay4fun", destino_id: "pessoal", destino_nome: "Pessoal",
        justificativa: "é da vida pessoal", demanda: "revisar o PR do checkout",
      });
      await assert.rejects(CAPABILITIES.sugerir_troca_squad.handler({ squad_id: "pay4fun", justificativa: "j" }, contexto("pay4fun")));
      await assert.rejects(CAPABILITIES.sugerir_troca_squad.handler({ squad_id: "nao", justificativa: "j" }, contexto("pay4fun")));
      break;
    }
    case "mochila": {
      const { listarQuests } = await importar("server/calendar.ts");
      const chamadas = mockarFetch({
        items: [
          { id: "a", summary: "A", start: { dateTime: "2026-09-14T10:00:00-03:00" }, end: { dateTime: "2026-09-14T11:00:00-03:00" },
            extendedProperties: { private: { squadone_squad: "pay4fun", squadone_dominio: "pay4fun--geral", squadone_membro: "bia", squadone_tipo: "time_blocking" } } },
          { id: "b", summary: "B", start: { dateTime: "2026-09-14T12:00:00-03:00" }, end: { dateTime: "2026-09-14T13:00:00-03:00" },
            extendedProperties: { private: { squadone_dominio: "pay4fun--geral", squadone_membro: "bia" } } },
        ],
      });
      const { quests, erros } = await listarQuests("tok", "primary", ["pay4fun--geral"], new Date("2026-09-14T12:00:00Z"));
      assert.deepEqual(erros, []);
      assert.equal(quests.find((q: any) => q.eventId === "a").squad, "pay4fun");
      assert.equal(quests.find((q: any) => q.eventId === "b").squad, "");
      assert.ok(chamadas[0].url.includes("/calendars/primary/events?"), chamadas[0].url);
      assert.ok(decodeURIComponent(chamadas[0].url).includes("privateExtendedProperty=squadone_dominio=pay4fun--geral"));
      break;
    }
    default:
      throw new Error(`Cenário desconhecido: ${cenario}`);
  }
  console.log(`OK ${cenario}`);
}

main().catch((e) => { console.error(`FALHOU ${cenario}:`, e); process.exit(1); });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase1" && for c in agendar agendar-outra-squad calendar-id propostas troca mochila; do npx tsx capacidades.ts $c || break; done
```

Esperado: `FALHOU agendar` (a URL passa, mas `private` não tem `squadone_squad`).

- [ ] **Step 3: `server/calendar.ts`**

Releia. Mudanças:

1. Remova `const API = ".../calendars/primary/events"` e o import de `Pessoa`.
2. Ao lado das constantes existentes, e estendendo o comentário das marcas com um item para a nova:

```ts
/**
 * - `squadone_squad` é INFORMATIVA: diz de qual squad o evento veio. Não é
 *   filtro — eventos criados antes da Fase 1 não a têm, e o filtro por
 *   domínio já separa as squads porque ids de domínio são globais.
 */
export const PROP_SQUAD = "squadone_squad";
```

3. Substitua `marcasDoMembro` por:

```ts
/**
 * As quatro marcas de todo evento criado pelo app (contrato da Fase 1, spec §5).
 * Uma função só para que nenhum ponto de escrita esqueça uma delas: um evento
 * sem `squadone_dominio` simplesmente some da Mochila.
 */
export function marcasDoEvento(m: {
  squadId: string;
  dominioId: string;
  pessoaId: string;
  tipo: "time_blocking" | "deadline";
}): Record<string, string> {
  return {
    [PROP_SQUAD]: m.squadId,
    [PROP_DOMINIO]: m.dominioId,
    [PROP_MEMBRO]: m.pessoaId,
    [PROP_TIPO]: m.tipo,
  };
}

/** Coleção de eventos de um calendário. `calendarId` vem da squad (hoje "primary"). */
export function urlDeEventos(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}
```

4. `QuestCalendario` ganha, depois de `membro`:

```ts
  /** `squadone_squad`; "" em eventos anteriores à Fase 1. Informativo. */
  squad: string;
```

   e `paraQuest` preenche `squad: priv[PROP_SQUAD] ?? "",`.

5. `listarQuests` ganha `calendarId: string` como segundo parâmetro, e a URL passa a ser `` `${urlDeEventos(calendarId)}?` + new URLSearchParams({...}) ``.

- [ ] **Step 4: `server/capabilities.ts`**

Releia (a Fase 0 mexeu em `agendar_evento`: `forcado`, `transparency`, `PROP_TIPO`). Mudanças:

1. Imports:

```ts
import {
  acharDominio,
  acharPessoa,
  idsDePessoas,
  MAX_DOMINIOS,
  novoIdDeDominio,
  proximoSlot,
  type Dominio,
  type Pessoa,
  type Roster,
  type Squad,
} from "./squad.ts";
import { marcasDoEvento, PREFIXO_DEADLINE, urlDeEventos } from "./calendar.ts";
```

   (`slug` sai se não sobrar uso; `PROP_TIPO` sai porque `marcasDoEvento` já grava o tipo.)

2. `CapabilityContext` ganha, preservando os campos e comentários da Fase 0:

```ts
  /** O roster inteiro: unicidade de id é global. */
  roster: Roster;
  /** A squad ATIVA do turno. Capacidades só leem e agem dentro dela. */
  squad: Squad;
  /** Texto original da demanda — vai na proposta de troca para "Trocar e reenviar". */
  demanda: string;
```

3. `PropostaDominio` e `PropostaIntegrante` ganham, como primeiro campo depois de `kind`:

```ts
  /** Squad em que o turno rodou: a aprovação aplica nela, não na que a tela mostra. */
  squad_id: string;
```

4. Nova proposta e tipos:

```ts
/** Proposta de levar a demanda para OUTRA squad. Só propõe: trocar é gesto do usuário. */
export interface PropostaTrocaSquad {
  kind: "troca_squad";
  /** Squad em que o turno rodou (origem), como nas outras propostas. */
  squad_id: string;
  destino_id: string;
  destino_nome: string;
  justificativa: string;
  demanda: string;
}

export type Sugestao = (PropostaDominio | PropostaIntegrante | PropostaTrocaSquad) & { id: string };
export type CapabilityResult = EventoCriado | PropostaDominio | PropostaIntegrante | PropostaTrocaSquad;
```

   (mantenha o comentário da Fase 0 sobre o `id` ser carimbado no orchestrator.)

5. `exigirPessoa`: mensagem `` `responsavel_id '${String(id)}' não está na squad '${squad.nome}'. Disponíveis: ${idsDePessoas(squad).join(", ")}` ``.

6. `agendar_evento.handler`: troque o bloco `extendedProperties` e o `fetch`:

```ts
      // Quatro marcas (contrato da Fase 1, ver server/calendar.ts): squad
      // informa, domínio filtra, membro atribui, tipo dá a semântica.
      extendedProperties: {
        private: marcasDoEvento({
          squadId: ctx.squad.id,
          dominioId: dominio.id,
          pessoaId: pessoa.id,
          tipo,
        }),
      },
    };

    const resp = await fetch(urlDeEventos(ctx.squad.calendarId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
```

   `indice = ctx.squad.dominios.indexOf(dominio)` já é por squad; mantenha.

7. `criar_po_dominio.handler`:

```ts
  async handler(args, ctx): Promise<PropostaDominio> {
    const dominio = String(args.dominio ?? "").trim();
    if (!dominio) throw new Error("Campo 'dominio' vazio.");

    const slot = proximoSlot(ctx.squad);
    if (!slot) {
      throw new Error(
        `A squad '${ctx.squad.nome}' já tem ${MAX_DOMINIOS} domínios — não há sala livre para um novo.`,
      );
    }
    // Proposta só vale se for executável: a mesma regra de id que a aprovação
    // vai aplicar (nome repetido na squad, id já usado em qualquer squad).
    try {
      novoIdDeDominio(ctx.roster, ctx.squad, dominio);
    } catch (err: any) {
      throw new Error(`${err.message} Para reforçar um domínio existente, use contratar_integrante.`);
    }

    return {
      kind: "dominio",
      squad_id: ctx.squad.id,
      dominio,
      papel_po: String(args.papel_po ?? "PO").trim() || "PO",
      justificativa: String(args.justificativa ?? ""),
      escopo: String(args.escopo ?? ""),
      slot,
    };
  },
```

   Na `description` da declaração, troque "num squad que só tem 'Produto'" por "numa squad que só tem 'Produto'".

8. `contratar_integrante.handler`: o `acharDominio(ctx.squad, ...)` já é por squad; acrescente `squad_id: ctx.squad.id` ao retorno e `na squad '${ctx.squad.nome}'` à mensagem de domínio inexistente.

9. Nova capacidade, antes do registry:

```ts
/**
 * A demanda é de OUTRA squad. O modelo não troca de squad nem agenda lá — ele
 * não vê os domínios e pessoas das outras. Só devolve um card; trocar (e
 * reenviar) é gesto do usuário.
 */
const sugerirTrocaSquad: Capability = {
  declaration: {
    name: "sugerir_troca_squad",
    description:
      "Propõe levar a demanda para OUTRA squad do usuário quando ela pertence " +
      "claramente ao escopo de uma das outras squads listadas no prompt. Não " +
      "agenda nada e não troca de squad: devolve uma proposta para o usuário aprovar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        squad_id: {
          type: Type.STRING,
          description: "id de uma das OUTRAS squads, exatamente como listado no prompt.",
        },
        justificativa: {
          type: Type.STRING,
          description: "Por que a demanda pertence ao escopo daquela squad e não desta.",
        },
      },
      required: ["squad_id", "justificativa"],
    },
  },

  async handler(args, ctx): Promise<PropostaTrocaSquad> {
    const destino = ctx.roster.squads.find((s) => s.id === args.squad_id);
    if (!destino) {
      const outras = ctx.roster.squads.filter((s) => s.id !== ctx.squad.id).map((s) => s.id);
      throw new Error(
        `squad_id '${String(args.squad_id)}' não existe. Outras squads: ${outras.join(", ") || "(nenhuma)"}.`,
      );
    }
    if (destino.id === ctx.squad.id) {
      throw new Error(`A demanda já está na squad '${destino.nome}': não há troca a sugerir.`);
    }
    return {
      kind: "troca_squad",
      squad_id: ctx.squad.id,
      destino_id: destino.id,
      destino_nome: destino.nome,
      justificativa: String(args.justificativa ?? ""),
      demanda: ctx.demanda,
    };
  },
};
```

   e registre `sugerir_troca_squad: sugerirTrocaSquad,` em `CAPABILITIES`.

- [ ] **Step 5: `server/orchestrator.ts` (contexto provisório)**

Releia. Em `executarTurno`, troque `const squad = await readSquad();` por:

```ts
  // Provisório (Task 4 passa roster e squad prontos pela rota).
  const roster = await readRoster();
  const squad = roster.squads[0];
```

e o contexto por `const ctx: CapabilityContext = { token, roster, squad, agora, modo, demanda };`. Import `readRoster` em vez de `readSquad`. O `buildSystemInstruction(rosterTree(squad), ...)` fica como está.

- [ ] **Step 6: `server.ts` (Mochila com `calendarId`)**

Releia. Na rota `/api/mochila` troque a chamada por `listarQuests(token, squad.calendarId, dominiosDoSquad(squad), new Date())` (a `squad` ainda vem de `readSquad()`).

- [ ] **Step 7: Rodar e ver passar**

```bash
cd "$SCRATCH/fase1" && for c in agendar agendar-outra-squad calendar-id propostas troca mochila; do npx tsx capacidades.ts $c || break; done
```

Esperado: 6 linhas `OK`.

- [ ] **Step 8: Typecheck, build e caça a marcas soltas**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build && ! grep -rn "marcasDoMembro\|calendars/primary" server server.ts
```

Esperado: sem erros; grep sem saída.

- [ ] **Step 9: Commit**

```bash
cd "$REPO" && git add server/calendar.ts server/capabilities.ts server/orchestrator.ts server.ts && git commit -m "$(cat <<'EOF'
feat(agenda): gravar squadone_squad e agir dentro da squad ativa

Todo evento novo carrega as quatro marcas numa funcao so (squad, dominio,
membro, tipo). squadone_squad e informativa: o filtro da Mochila segue por
dominio, que ja e unico entre squads, entao nao ha backfill. Escrita e leitura
usam o calendarId da squad, hoje sempre primary.

Capacidades recebem roster e squad ativa; propostas carregam squad_id para a
aprovacao cair na squad certa. Nova sugerir_troca_squad so propoe.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Prompt da squad ativa e rotas por squad

**Files:**
- Modify: `server/orchestrator.ts`
- Modify: `server.ts`
- Modify: `server/squad.ts` (remover pontes)
- Test: `$SCRATCH/fase1/prompt.ts`, `$SCRATCH/fase1/http.ts`, `$SCRATCH/fase1/util-servidor.ts`

**Interfaces:**
- Consumes: Task 1 (`readRoster`, `resolverSquad`, `paraVista`, `rosterTree`, `outrasSquads`, `dominiosDoSquad`, erros), Task 2 (`aplicarContratacao`, `criarSquad`), Task 3 (`CapabilityContext`, `listarQuests`).
- Produces:
  - `orchestrator.ts`: `interface ContextoDoPrompt { squadNome: string; squadEscopo: string; arvore: string; outrasSquads: string }`; `buildSystemInstruction(contexto: ContextoDoPrompt, agoraISO: string, modo?: Modo): string`; `interface PedidoDeTurno { demanda: string; token: string | null; modo: Modo; roster: Roster; squad: Squad }`; `executarTurno(ai: GoogleGenAI, pedido: PedidoDeTurno): Promise<TurnoResult>`.
  - HTTP (spec §7.2): `GET /api/squad` → `RosterView`; `POST /api/squad/nova` → 201 `NovaSquadResult`; `POST /api/squad/hire` → `HireResult`; `GET /api/mochila?squadId=`; `POST /api/orquestrar { demanda, modo?, squadId? }`. 409 de squad inexistente leva `squadInexistente: true`.

- [ ] **Step 1: Script do prompt**

`$SCRATCH/fase1/prompt.ts`:

```ts
import assert from "node:assert/strict";
import { importar, prepararDiretorio, V3_DUAS } from "./harness.ts";

async function main() {
  await prepararDiretorio();
  const sq = await importar("server/squad.ts");
  const { buildSystemInstruction } = await importar("server/orchestrator.ts");
  const roster = structuredClone(V3_DUAS) as any;
  const ativa = roster.squads[1];

  const texto = buildSystemInstruction(
    { squadNome: ativa.nome, squadEscopo: ativa.escopo, arvore: sq.rosterTree(ativa), outrasSquads: sq.outrasSquads(roster, ativa.id) },
    "2026-09-14T09:00:00-03:00",
    "auto",
  );
  assert.ok(texto.includes("squad 'Pay4Fun'"), "nome da squad ativa");
  assert.ok(texto.includes("trabalho na Pay4Fun"), "escopo da squad ativa");
  assert.ok(texto.includes("'pay4fun--geral'"), "árvore da ativa");
  assert.ok(texto.includes("- squad 'pessoal' — Pessoal"), "outras squads");
  assert.ok(texto.includes("sugerir_troca_squad"), "regra de troca");
  assert.ok(!texto.includes("'casa'"), "domínio de outra squad vazou");
  assert.ok(!texto.includes("'romulo'"), "pessoa de outra squad vazou");
  assert.ok(!texto.includes("squad pessoal"), "literal antigo");

  const sozinha = { ...roster, squads: [roster.squads[0]] };
  const texto2 = buildSystemInstruction(
    { squadNome: "Pessoal", squadEscopo: "vida pessoal", arvore: sq.rosterTree(sozinha.squads[0]), outrasSquads: sq.outrasSquads(sozinha, "pessoal") },
    "2026-09-14T09:00:00-03:00",
  );
  assert.ok(texto2.includes("(nenhuma)"));
  console.log("OK prompt");
}

main().catch((e) => { console.error("FALHOU prompt:", e); process.exit(1); });
```

- [ ] **Step 2: Script HTTP**

`$SCRATCH/fase1/http.ts` (espera um servidor já rodando em `BASE`):

```ts
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:3917";

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/squad`)).status) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Servidor não subiu em 30s.");
}

const post = (rota: string, corpo: unknown) =>
  fetch(`${BASE}${rota}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

async function main() {
  await esperarServidor();

  const roster = await (await fetch(`${BASE}/api/squad`)).json();
  assert.equal(roster.version, 3);
  assert.equal(roster.squads[0].id, "pessoal");
  assert.ok(Array.isArray(roster.squads[0].unlockedSlots));

  let r = await fetch(`${BASE}/api/mochila?squadId=nao-existe`);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).squadInexistente, true);

  r = await fetch(`${BASE}/api/mochila?squadId=a&squadId=b`);
  assert.equal(r.status, 400);

  // Squad válida sem credencial no diretório temporário: 401, sem chamar o Google.
  r = await fetch(`${BASE}/api/mochila?squadId=pessoal`);
  assert.equal(r.status, 401);

  r = await post("/api/orquestrar", { demanda: "x", squadId: "nao-existe" });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).squadInexistente, true);

  r = await post("/api/orquestrar", { demanda: "x", squadId: 7 });
  assert.equal(r.status, 400);

  r = await post("/api/squad/nova", { nome: "Pay4Fun", escopo: "trabalho na Pay4Fun", papel_po: "PO Pay4Fun" });
  assert.equal(r.status, 201);
  const nova = await r.json();
  assert.equal(nova.squad.id, "pay4fun");
  assert.equal(nova.roster.squads.length, 2);

  r = await post("/api/squad/nova", { nome: "Pay4Fun", escopo: "e", papel_po: "PO" });
  assert.equal(r.status, 409);

  r = await post("/api/squad/nova", { escopo: "e", papel_po: "PO" });
  assert.equal(r.status, 400);

  r = await post("/api/squad/hire", { sugestao: { kind: "troca_squad", squad_id: "pessoal" } });
  assert.equal(r.status, 400);

  r = await post("/api/squad/hire", {
    sugestao: { kind: "integrante", squad_id: "pay4fun", dominio_id: "pay4fun--geral", papel: "QA", justificativa: "j", escopo: "t" },
  });
  assert.equal(r.status, 200);
  const hire = await r.json();
  assert.equal(hire.squadId, "pay4fun");
  assert.equal(hire.roster.squads[1].dominios[0].integrantes.length, 1);

  console.log("OK http");
}

main().catch((e) => { console.error("FALHOU http:", e); process.exit(1); });
```

`$SCRATCH/fase1/util-servidor.ts` (apoio para subir servidores temporários; usado também nas Tasks 5 e 6):

```ts
import { txt, V2_PRODUCAO } from "./harness.ts";

const [comando, base] = process.argv.slice(2);

async function esperar(url: string) {
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${url}/api/squad`); return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Servidor não subiu em 30s.");
}

async function main() {
  if (comando === "fixture-v2") {
    process.stdout.write(txt(V2_PRODUCAO));
  } else if (comando === "criar-pay4fun") {
    await esperar(base);
    const r = await fetch(`${base}/api/squad/nova`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Pay4Fun", escopo: "trabalho", papel_po: "PO Pay4Fun" }),
    });
    console.log("nova squad:", r.status);
  } else {
    throw new Error(`Comando desconhecido: ${comando}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Rodar o prompt e confirmar que falha**

```bash
cd "$SCRATCH/fase1" && npx tsx prompt.ts
```

Esperado: `FALHOU prompt` (`buildSystemInstruction` ainda recebe string; o texto não tem `squad 'Pay4Fun'`).

- [ ] **Step 4: `server/orchestrator.ts`**

Releia. Mudanças:

1. Imports: `import { rosterTree, outrasSquads, type Roster, type Squad } from "./squad.ts";` (sai `readRoster`/`readSquad`).

2. Antes de `buildSystemInstruction`:

```ts
/** O que o prompt sabe da squad: a árvore só da ativa, as outras só por nome. */
export interface ContextoDoPrompt {
  squadNome: string;
  squadEscopo: string;
  arvore: string;
  outrasSquads: string;
}
```

3. Assinatura: `export function buildSystemInstruction(contexto: ContextoDoPrompt, agoraISO: string, modo: Modo = "auto"): string`. Mantenha `regraModo` da Fase 0. No template:
   - primeira linha: `` Você é o PO raiz da squad '${contexto.squadNome}' (escopo: ${contexto.squadEscopo}). Recebe demandas em português e as ``
   - `A squad é uma ÁRVORE: ...` (troque "O squad é" por "A squad é")
   - `Squad atual:` seguido de `${contexto.arvore}`
   - logo depois da árvore, bloco novo:

```
Outras squads do usuário (você NÃO vê os domínios nem as pessoas delas e NÃO agenda nelas):
${contexto.outrasSquads}
```

   - na lista de regras, depois da regra de crescimento e antes de "Não responda em texto":

```
- Se a demanda pertence claramente ao escopo de uma das OUTRAS squads listadas,
  chame APENAS sugerir_troca_squad com o squad_id dela e não agende nada nesta
  squad. Na dúvida, trate a demanda na squad atual. Se não há outras squads,
  nunca chame sugerir_troca_squad.
```

   - "Se o squad atual dá conta" → "Se a squad atual dá conta".
   Atualize o comentário de `buildSystemInstruction` dizendo que só a squad ativa entra inteira, e por quê (o modelo não pode agendar fora dela).

4. `executarTurno`:

```ts
/** Tudo que um turno precisa, já resolvido pela rota antes de tocar Google e Gemini. */
export interface PedidoDeTurno {
  demanda: string;
  token: string | null;
  modo: Modo;
  roster: Roster;
  squad: Squad;
}

export async function executarTurno(ai: GoogleGenAI, pedido: PedidoDeTurno): Promise<TurnoResult> {
  const { demanda, token, modo, roster, squad } = pedido;
  const agora = new Date();

  const response = await gerarComRetry(ai, {
    model: MODEL,
    contents: demanda,
    config: {
      systemInstruction: buildSystemInstruction(
        {
          squadNome: squad.nome,
          squadEscopo: squad.escopo,
          arvore: rosterTree(squad),
          outrasSquads: outrasSquads(roster, squad.id),
        },
        agoraLocalISO(agora),
        modo,
      ),
      // tools, toolConfig e comentários: manter como estão
    },
  });

  const calls: FunctionCall[] = response.functionCalls ?? [];
  const ctx: CapabilityContext = { token, roster, squad, agora, modo, demanda };
  // resto: manter como está (Promise.all, carimbo de id nas sugestões, erro sem calls)
}
```

- [ ] **Step 5: Rodar o prompt e ver passar**

```bash
cd "$SCRATCH/fase1" && npx tsx prompt.ts
```

Esperado: `OK prompt`.

- [ ] **Step 6: `server.ts`**

Releia. Mudanças:

1. Imports:

```ts
import {
  ConflitoDeRoster,
  dominiosDoSquad,
  paraVista,
  PedidoInvalido,
  readRoster,
  resolverSquad,
  SquadInexistente,
  type Squad,
} from "./server/squad.ts";
import { aplicarContratacao, criarSquad } from "./server/hire.ts";
```

2. Depois de `responderErroDeAuth`:

```ts
/**
 * Erros do roster em status HTTP. A flag `squadInexistente` separa "a squad
 * desta aba sumiu" (a UI recarrega e cai na primeira) de um conflito comum.
 * Devolve false quando o erro não é do roster e a rota decide o 500.
 */
function responderErroDeRoster(res: express.Response, err: unknown): boolean {
  if (err instanceof SquadInexistente) {
    res.status(409).json({ error: err.message, squadInexistente: true });
  } else if (err instanceof ConflitoDeRoster) {
    res.status(409).json({ error: err.message });
  } else if (err instanceof PedidoInvalido) {
    res.status(400).json({ error: err.message });
  } else {
    return false;
  }
  return true;
}
```

3. `GET /api/squad`:

```ts
  // Roster inteiro, todas as squads: o seletor precisa da lista, o arquivo tem
  // poucos KB e a squad ativa é conveniência da aba, não estado do servidor.
  app.get("/api/squad", async (_req, res) => {
    try {
      res.json(paraVista(await readRoster()));
    } catch (error: any) {
      console.error("Erro ao ler o roster:", error);
      res.status(500).json({ error: error.message });
    }
  });
```

4. Nova rota, depois de `GET /api/squad`:

```ts
  // Gesto "Nova squad": nasce com um domínio e o PO dele. Não toca o Google.
  app.post("/api/squad/nova", async (req, res) => {
    try {
      res.status(201).json(await criarSquad(req.body ?? {}));
    } catch (error: any) {
      console.error("Erro ao criar squad:", error);
      if (!responderErroDeRoster(res, error)) res.status(500).json({ error: error.message });
    }
  });
```

5. `POST /api/squad/hire` catch: `if (!responderErroDeRoster(res, error)) res.status(500).json({ error: error.message });` (substitui o cálculo de status da Task 2; mantenha o `console.error` e o comentário de conflito).

6. `GET /api/mochila`: antes do bloco do token:

```ts
    // Squad antes do token: um squadId velho se corrige sem gastar chamada
    // ao Google, e o erro volta classificado.
    let squad: Squad;
    try {
      squad = resolverSquad(await readRoster(), req.query.squadId);
    } catch (error: any) {
      if (responderErroDeRoster(res, error)) return;
      console.error("Erro ao ler o roster:", error);
      return res.status(500).json({ error: error.message });
    }
```

   e remova o `readSquad()` de dentro do segundo `try`, usando a `squad` resolvida em `listarQuests(token, squad.calendarId, dominiosDoSquad(squad), new Date())` e em `const todos = dominiosDoSquad(squad).length`.

7. `POST /api/orquestrar`: `const { demanda, modo = "auto", squadId } = req.body ?? {};`. Depois da validação de `modo` (Fase 0) e **antes** de `tokenValido`:

```ts
      // Squad antes do token e do Gemini: um squadId inexistente não pode
      // custar uma chamada ao modelo para depois falhar.
      const roster = await readRoster();
      const squad = resolverSquad(roster, squadId);
```

   Chamada: `const turno = await executarTurno(ai, { demanda: demanda.trim(), token, modo, roster, squad });`. No `catch`, antes do teste de `ModeloOcupado`: `if (responderErroDeRoster(res, error)) return;`.

- [ ] **Step 7: Remover as pontes**

Em `server/squad.ts`, apague `readSquad` e `atualizarSquad` (bloco "PONTE da Fase 1").

```bash
cd "$REPO" && ! grep -rn "readSquad\|atualizarSquad\|writeSquad" server server.ts src
```

Esperado: sem saída.

- [ ] **Step 8: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros. (Se o typecheck acusar `App.vue`/`GameMap.vue` por tipos do frontend, é a Task 5 — mas nesta task nada em `src/` mudou, então não deve acusar.)

- [ ] **Step 9: Subir o build num diretório temporário e rodar o HTTP**

```bash
TMPD=$(mktemp -d "$SCRATCH/fase1-http-XXXX")
cp -r "$REPO/seed" "$TMPD/seed"
mkdir "$TMPD/data"
cd "$SCRATCH/fase1" && npx tsx util-servidor.ts fixture-v2 > "$TMPD/data/squad.json"
cd "$TMPD" && PORT=3917 NODE_ENV=production GEMINI_API_KEY=fake IPS_PERMITIDOS= node "$REPO/dist/server.cjs" > "$TMPD/server.log" 2>&1 &
echo $! > "$TMPD/pid"
cd "$SCRATCH/fase1" && npx tsx http.ts; STATUS=$?
kill "$(cat "$TMPD/pid")"
ls "$TMPD/data"
exit $STATUS
```

Esperado: `OK http`; `ls` mostra `squad.json` e `squad.v2.bak.json` e **não** mostra `google-auth.json`. Se falhar, leia `$TMPD/server.log`.

- [ ] **Step 10: Commit**

```bash
cd "$REPO" && git add server/orchestrator.ts server.ts server/squad.ts && git commit -m "$(cat <<'EOF'
feat(orquestrador): prompt e rotas operam na squad escolhida

O prompt recebe a arvore so da squad ativa e as outras apenas por id, nome e
escopo, para o modelo sugerir troca sem poder agendar fora dela. O texto fixo
"squad pessoal" vira nome e escopo da squad.

/api/orquestrar e /api/mochila resolvem squadId antes de pedir token e antes
do Gemini: squad inexistente e 409 com squadInexistente, tipo errado e 400.
GET /api/squad devolve todas as squads; POST /api/squad/nova cria uma.
Pontes readSquad/atualizarSquad saem.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend — squad ativa, Mochila e turno por squad, `GameMap` por `:key`

**Files:**
- Modify: `src/types.ts`
- Create: `src/squadAtiva.ts`
- Modify: `src/App.vue`
- Modify: `src/components/GameMap.vue`
- Modify: `src/components/QuestBackpack.vue`

**Interfaces:**
- Consumes (Task 4): contratos HTTP de §7.2.
- Produces (Task 6): em `App.vue`, `roster: Ref<RosterView | null>`, `squadAtiva: ComputedRef<SquadView | null>`, `trocarSquad(id: string): Promise<void>`, `carregarRoster(): Promise<void>`, `handleDelegation(payload: { demanda: string; modo: Modo })`, `sugestoesDeCrescimento` (computed); em `src/types.ts`, `SquadView`, `RosterView`, `PropostaTrocaSquad`, `Sugestao`.

- [ ] **Step 1: `src/types.ts`**

Releia (a Fase 0 acrescentou `Modo` e `id` em `Sugestao`). Mudanças:

1. Comentário de topo: a árvore agora é `roster → squad → domínio → { po, integrantes }`.
2. `Pessoa` e `Dominio` ganham `arquivado?: boolean;` com o comentário "Reservado (Fase 2)".
3. Troque `SquadResponse` por:

```ts
export interface Squad {
  /** valor de `squadone_squad` no Google Calendar. */
  id: string;
  nome: string;
  escopo: string;
  calendarId: string;
  conta?: string;
  unlockOrder: [number, number][];
  dominios: Dominio[];
}

export type SquadView = Squad & { unlockedSlots: [number, number][] };

export interface RosterView {
  version: 3;
  squads: SquadView[];
  idsAposentados: { pessoas: string[]; dominios: string[] };
}
```

4. `PropostaDominio` e `PropostaIntegrante` ganham `squad_id: string;`.
5. Nova proposta e união:

```ts
/** A demanda parece de outra squad. Só proposta: trocar é clique do usuário. */
export interface PropostaTrocaSquad {
  kind: "troca_squad";
  squad_id: string;
  destino_id: string;
  destino_nome: string;
  justificativa: string;
  demanda: string;
}

export type Sugestao = (PropostaDominio | PropostaIntegrante | PropostaTrocaSquad) & { id: string };
```

6. `QuestCalendario` ganha `squad: string;` com o comentário "`squadone_squad`; vazio em eventos antigos".

- [ ] **Step 2: `src/squadAtiva.ts`**

```ts
/**
 * Squad ativa desta aba. Conveniência do browser, não estado do servidor: as
 * rotas recebem `squadId` a cada chamada. `localStorage` pode lançar (modo
 * privado, storage bloqueado) — sem ele a escolha só não sobrevive ao reload.
 */
const CHAVE = 'squadone:squadAtiva'

export function lerSquadAtiva(): string | null {
  try {
    return localStorage.getItem(CHAVE)
  } catch {
    return null
  }
}

export function gravarSquadAtiva(id: string): void {
  try {
    localStorage.setItem(CHAVE, id)
  } catch {
    // Sem storage: a escolha vale até o próximo reload.
  }
}
```

- [ ] **Step 3: `src/components/GameMap.vue`**

Releia. Troque `SquadResponse` por `SquadView` no import e em `defineProps<{ agent?: string; squad?: SquadView | null }>()`. Acrescente ao comentário de topo:

```
 * Uma instância por SQUAD: App.vue monta com `:key="squadAtiva.id"`. Trocar de
 * squad recria o componente, e com ele o `knownRooms` de useOffice — sem isso
 * as salas da outra squad seriam lidas como crescimento e animariam.
```

- [ ] **Step 4: `src/components/QuestBackpack.vue`**

Releia (a Fase 0 corrigiu datas de dia inteiro). Acrescente a prop:

```ts
  // id -> nome dos domínios da squad ativa. Ids novos são `<squad>--<slug>`,
  // feios de ler num badge; sem nome conhecido, cai no id.
  nomesDeDominio: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
```

e no badge do domínio troque `{{ quest.dominio }}` por `{{ nomesDeDominio[quest.dominio] ?? quest.dominio }}`.

- [ ] **Step 5: `src/App.vue` — estado e carregamento**

Releia inteiro. Mudanças no `<script setup>`:

1. Imports: `import { computed, onMounted, ref } from 'vue'`, `import type { Modo, RosterView, SquadView, Sugestao } from './types'` (mantenha o que a Fase 0 importa) e `import { gravarSquadAtiva, lerSquadAtiva } from './squadAtiva'`.
2. Troque `const squad = ref(null)` por:

```ts
// O roster inteiro (todas as squads). Mapa e Mochila mostram só a ativa.
const roster = ref<RosterView | null>(null)
const squadAtivaId = ref<string | null>(lerSquadAtiva())
/** Id guardado que não existe (outro volume, squad de outra instalação): primeira squad. */
const squadAtiva = computed<SquadView | null>(() => {
  const squads = roster.value?.squads ?? []
  return squads.find((s) => s.id === squadAtivaId.value) ?? squads[0] ?? null
})
const nomesDeDominio = computed<Record<string, string>>(() =>
  Object.fromEntries((squadAtiva.value?.dominios ?? []).map((d) => [d.id, d.nome]))
)
const nomeDaSquad = (id: string) => roster.value?.squads.find((s) => s.id === id)?.nome ?? id
const sugestoesDeCrescimento = computed(() => sugestoes.value.filter((s) => s.kind !== 'troca_squad'))
```

3. Funções novas, antes de `carregarMochila`:

```ts
const carregarRoster = async () => {
  const response = await fetch('/api/squad')
  if (!response.ok) throw new Error('Falha ao carregar o roster')
  roster.value = await response.json()
  // Corrige o guardado quando ele apontava para uma squad que não existe.
  const ativa = squadAtiva.value
  if (ativa && ativa.id !== squadAtivaId.value) {
    squadAtivaId.value = ativa.id
    gravarSquadAtiva(ativa.id)
  }
}

const trocarSquad = async (id: string) => {
  if (id === squadAtiva.value?.id) return
  // Squad criada em outra aba: o roster local ainda não a conhece.
  if (!roster.value?.squads.some((s) => s.id === id)) await carregarRoster()
  squadAtivaId.value = id
  gravarSquadAtiva(id)
  quests.value = []
  currentAgent.value = 'Idle'
  await carregarMochila()
}

/** 409 squadInexistente: a squad desta aba sumiu do servidor. */
const recuperarSquadInexistente = async () => {
  squadAtivaId.value = null
  await carregarRoster()
  avisar('A squad selecionada não existe mais: voltei para a primeira.')
}
```

4. `onMounted`: troque o bloco do `fetch('/api/squad')` por:

```ts
  try {
    await carregarRoster()
  } catch (error) {
    console.error('Falha ao carregar o roster:', error)
  }
```

5. `carregarMochila` passa a ser:

```ts
const carregarMochila = async (recuperando = false) => {
  if (!conectado.value || !squadAtiva.value) return
  const squadId = squadAtiva.value.id
  carregandoMochila.value = true
  try {
    const response = await fetch(`/api/mochila?squadId=${encodeURIComponent(squadId)}`)
    const corpo = await response.json().catch(() => ({}))
    // Trocou de squad enquanto esperava: esta resposta é da squad anterior.
    if (squadAtiva.value?.id !== squadId) return
    if (!response.ok) {
      if (response.status === 409 && corpo.squadInexistente && !recuperando) {
        await recuperarSquadInexistente()
        return await carregarMochila(true)
      }
      // 401 = o servidor nao tem credencial valida (nunca conectou, ou o
      // Google recusou o refresh). Derruba o estado pra UI voltar a oferecer
      // o botao de conectar.
      if (response.status === 401) conectado.value = false
      throw new Error(corpo.error ?? `HTTP ${response.status}`)
    }
    quests.value = corpo.quests ?? []
    if (corpo.erros?.length) console.warn('Dominios com erro na Mochila:', corpo.erros)
  } catch (error) {
    // (manter o comentário atual)
    console.error('Falha ao ler a Mochila:', error)
    avisar(`Mochila: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    carregandoMochila.value = false
  }
}
```

6. `aprovarSugestao`: troque `squad.value = dados.squad` por `roster.value = dados.roster` e o toast por:

```ts
    const onde = dados.squadId !== squadAtiva.value?.id ? ` na squad ${nomeDaSquad(dados.squadId)}` : ''
    avisar(
      dados.kind === 'dominio'
        ? `${dados.pessoa.nome} abriu o dominio ${dados.dominio.nome}${onde}`
        : `${dados.pessoa.nome} entrou no squad (${dados.dominio.nome})${onde}`
    )
```

7. `handleDelegation`: tipar `payload: { demanda: string; modo: Modo }`; body `JSON.stringify({ demanda: payload.demanda, modo: payload.modo, squadId: squadAtiva.value?.id })`; no `if (!response.ok)`, depois de ler `corpo`:

```ts
      if (response.status === 409 && corpo.squadInexistente) {
        await recuperarSquadInexistente()
        alert('A squad selecionada não existe mais. Confira a squad no topo e reenvie a demanda.')
        return
      }
```

- [ ] **Step 6: `src/App.vue` — template**

1. `QuestBackpack`: acrescente `:nomes-de-dominio="nomesDeDominio"` e troque `@recarregar="carregarMochila"` por `@recarregar="() => carregarMochila()"` (o handler recebe argumento opcional agora).
2. `GrowthCard`: itere `sugestoesDeCrescimento` em vez de `sugestoes` (mantenha `:key="sugestao.id"` e os handlers da Fase 0). Cards `troca_squad` ganham componente na Task 6.
3. `GameMap`: `<GameMap :key="squadAtiva?.id ?? 'sem-squad'" :agent="currentAgent" :squad="squadAtiva" />`.

- [ ] **Step 7: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build && ! grep -rn "SquadResponse" src
```

Esperado: sem erros; grep sem saída.

- [ ] **Step 8: Verificação no navegador (sem Google)**

```bash
TMPD=$(mktemp -d "$SCRATCH/fase1-ui-XXXX")
cp -r "$REPO/seed" "$TMPD/seed" && cp -r "$REPO/dist" "$TMPD/dist"
cd "$TMPD" && PORT=3918 NODE_ENV=production GEMINI_API_KEY=fake IPS_PERMITIDOS= node "$REPO/dist/server.cjs" > "$TMPD/server.log" 2>&1 &
echo $! > "$TMPD/pid"
cd "$SCRATCH/fase1" && npx tsx util-servidor.ts criar-pay4fun http://127.0.0.1:3918
```

Esperado: `nova squad: 201`.

Abra `http://127.0.0.1:3918` (Browser pane, se disponível). Verifique:
- o escritório da squad Pessoal aparece (sala "Geral" com o PO);
- no console da página: `localStorage.setItem('squadone:squadAtiva','pay4fun'); location.reload()` → o mapa mostra a sala "Geral" com o PO `PO Pay4Fun`, sem animação de obra;
- `localStorage.setItem('squadone:squadAtiva','nao-existe'); location.reload()` → volta para Pessoal sem erro no console, e `localStorage.getItem('squadone:squadAtiva')` passa a ser `pessoal`.

Pare o servidor: `kill "$(cat "$TMPD/pid")"`.

- [ ] **Step 9: Commit**

```bash
cd "$REPO" && git add src/types.ts src/squadAtiva.ts src/App.vue src/components/GameMap.vue src/components/QuestBackpack.vue && git commit -m "$(cat <<'EOF'
feat(ui): squad ativa por aba, Mochila e turno por squad

O frontend guarda o roster inteiro e a squad ativa no localStorage. Mochila e
turno mandam squadId; resposta da Mochila que chega depois de trocar de squad
e descartada, e 409 squadInexistente recarrega o roster e cai na primeira.

GameMap ganha :key por squad para recriar useOffice ao trocar: sem isso as
salas da outra squad virariam animacao de crescimento. Mochila mostra o nome
do dominio em vez do id prefixado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Frontend — seletor, "Nova squad" e card de troca

**Files:**
- Create: `src/components/SquadSelector.vue`
- Create: `src/components/NovaSquadModal.vue`
- Create: `src/components/TrocaSquadCard.vue`
- Modify: `src/components/GrowthCard.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes (Task 5): `roster`, `squadAtiva`, `trocarSquad`, `handleDelegation`, `nomeDaSquad`, `sugestoesDeCrescimento`, `isLoading`, `avisar`, tipos `SquadView`, `PropostaTrocaSquad`, `Sugestao`.
- Produces: componentes com os eventos abaixo; nenhuma interface consumida por tasks seguintes.

- [ ] **Step 1: `src/components/SquadSelector.vue`**

```vue
<script setup lang="ts">
/**
 * Seletor de squad no header. Cada squad é um escritório inteiro; trocar aqui
 * troca Mapa e Mochila. Desabilitado durante um turno: a resposta do turno é da
 * squad em que ele começou.
 */
import type { PropType } from 'vue'
import type { SquadView } from '../types'

defineProps({
  squads: { type: Array as PropType<SquadView[]>, default: () => [] },
  ativaId: { type: String, default: '' },
  desabilitado: { type: Boolean, default: false }
})

const emit = defineEmits<{ trocar: [id: string]; nova: [] }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <label for="squad-ativa" class="font-black text-xs uppercase">Squad</label>
    <select
      id="squad-ativa"
      :value="ativaId"
      :disabled="desabilitado"
      class="border-4 border-black bg-white px-2 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
      @change="emit('trocar', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="s in squads" :key="s.id" :value="s.id">{{ s.nome }}</option>
    </select>
    <button
      type="button"
      :disabled="desabilitado"
      class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all disabled:opacity-50"
      @click="emit('nova')"
    >
      + Nova squad
    </button>
  </div>
</template>
```

- [ ] **Step 2: `src/components/NovaSquadModal.vue`**

```vue
<script setup lang="ts">
/**
 * Gesto "Nova squad" (Fase 1): nome, escopo e papel do PO. A squad nasce com um
 * domínio e o PO dele. Redigir papel/escopo com o Gemini é Fase 2 — aqui o
 * usuário escreve. Limites iguais aos do servidor, para o erro aparecer antes.
 */
import { reactive } from 'vue'

defineProps({
  enviando: { type: Boolean, default: false },
  erro: { type: String, default: '' }
})

export interface DadosNovaSquad {
  nome: string
  escopo: string
  papel_po: string
  nome_po: string
}

const emit = defineEmits<{ criar: [dados: DadosNovaSquad]; fechar: [] }>()

const form = reactive<DadosNovaSquad>({ nome: '', escopo: '', papel_po: '', nome_po: '' })

const enviar = () => {
  const dados = {
    nome: form.nome.trim(),
    escopo: form.escopo.trim(),
    papel_po: form.papel_po.trim(),
    nome_po: form.nome_po.trim()
  }
  if (!dados.nome || !dados.escopo || !dados.papel_po) return
  emit('criar', dados)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('fechar')">
    <form
      class="w-full max-w-md border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-3"
      @submit.prevent="enviar"
    >
      <h2 class="font-black text-xl uppercase">🏢 Nova squad</h2>

      <label class="flex flex-col gap-1 text-xs font-black uppercase">
        Nome
        <input v-model="form.nome" required maxlength="40" :disabled="enviando" placeholder="Pay4Fun"
          class="border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58]" />
      </label>

      <label class="flex flex-col gap-1 text-xs font-black uppercase">
        Escopo
        <textarea v-model="form.escopo" required maxlength="200" rows="3" :disabled="enviando"
          placeholder="Que tipo de demanda pertence a esta squad"
          class="border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58]"></textarea>
      </label>

      <label class="flex flex-col gap-1 text-xs font-black uppercase">
        Papel do PO
        <input v-model="form.papel_po" required maxlength="60" :disabled="enviando" placeholder="PO Pay4Fun"
          class="border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58]" />
      </label>

      <label class="flex flex-col gap-1 text-xs font-black uppercase">
        Nome do PO (opcional)
        <input v-model="form.nome_po" maxlength="40" :disabled="enviando"
          class="border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58]" />
      </label>

      <p v-if="erro" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erro }}</p>

      <div class="flex justify-end gap-2">
        <button type="button" :disabled="enviando" @click="emit('fechar')"
          class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" :disabled="enviando"
          class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50">
          {{ enviando ? 'Criando...' : 'Criar' }}
        </button>
      </div>
    </form>
  </div>
</template>
```

**Correção (implementação):** `DadosNovaSquad` mora em `src/types.ts` desde o início — `export` dentro de `<script setup>` é recusado pelo compilador de SFC — e o modal importa de lá.

- [ ] **Step 3: `src/components/TrocaSquadCard.vue`**

```vue
<script setup lang="ts">
/**
 * O modelo achou que a demanda é de outra squad. Ele só propõe: nada troca e
 * nada é reenviado sem um destes cliques.
 */
import type { PropType } from 'vue'
import type { PropostaTrocaSquad } from '../types'

defineProps({
  sugestao: { type: Object as PropType<PropostaTrocaSquad & { id: string }>, required: true },
  desabilitado: { type: Boolean, default: false }
})

const emit = defineEmits<{ trocar: []; reenviar: []; descartar: [] }>()
</script>

<template>
  <div class="border-4 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] shrink-0">
    <span class="bg-black text-white px-2 py-0.5 text-xs uppercase font-bold">🔀 Outra squad</span>
    <h3 class="font-bold text-lg leading-tight mt-2">Levar para a squad {{ sugestao.destino_nome }}?</h3>
    <p class="font-bold text-sm mt-2">{{ sugestao.justificativa }}</p>
    <p class="text-xs font-bold mt-1 opacity-70">Demanda: {{ sugestao.demanda }}</p>
    <div class="flex items-stretch gap-2 mt-3">
      <button type="button" :disabled="desabilitado" @click="emit('trocar')"
        class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50">
        Trocar
      </button>
      <button type="button" :disabled="desabilitado" @click="emit('reenviar')"
        class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50">
        Trocar e reenviar
      </button>
      <button type="button" :disabled="desabilitado" title="Descartar a proposta" @click="emit('descartar')"
        class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase disabled:opacity-50">
        ✕
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 4: `src/components/GrowthCard.vue`**

Releia. Acrescente a prop `squadNome: { type: String, default: '' }` com o comentário "Nome da squad de origem quando ela não é a que a tela mostra; vazio esconde o badge." e, na primeira linha de badges, depois do badge de slot/domínio:

```vue
      <span v-if="squadNome" class="border-2 border-black bg-[#ffdb58] px-2 py-0.5 text-xs uppercase font-bold">
        Squad {{ squadNome }}
      </span>
```

- [ ] **Step 5: `src/App.vue`**

Releia. Script:

```ts
import SquadSelector from './components/SquadSelector.vue'
import NovaSquadModal from './components/NovaSquadModal.vue'
import TrocaSquadCard from './components/TrocaSquadCard.vue'

const criandoSquad = ref(false)
const enviandoSquad = ref(false)
const erroNovaSquad = ref('')

const sugestoesDeTroca = computed(() =>
  sugestoes.value.filter((s): s is Extract<Sugestao, { kind: 'troca_squad' }> => s.kind === 'troca_squad')
)

const abrirNovaSquad = () => {
  erroNovaSquad.value = ''
  criandoSquad.value = true
}

const criarSquad = async (dados: { nome: string; escopo: string; papel_po: string; nome_po: string }) => {
  enviandoSquad.value = true
  erroNovaSquad.value = ''
  try {
    const response = await fetch('/api/squad/nova', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    })
    const corpo = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(corpo.error ?? `HTTP ${response.status}`)
    roster.value = corpo.roster
    criandoSquad.value = false
    await trocarSquad(corpo.squad.id)
    avisar(`Squad ${corpo.squad.nome} criada`)
  } catch (error) {
    erroNovaSquad.value = error instanceof Error ? error.message : String(error)
  } finally {
    enviandoSquad.value = false
  }
}

/** Aceite do card de troca. Reenviar usa `auto`: o modo forçado era da squad anterior. */
const aceitarTroca = async (id: string, reenviar: boolean) => {
  const proposta = sugestoesDeTroca.value.find((s) => s.id === id)
  if (!proposta) return
  sugestoes.value = sugestoes.value.filter((s) => s.id !== id)
  await trocarSquad(proposta.destino_id)
  if (reenviar) await handleDelegation({ demanda: proposta.demanda, modo: 'auto' })
}
```

Template:

1. No header, dentro do `<div class="flex items-center gap-4">` da direita, como primeiro filho:

```vue
        <SquadSelector
          v-if="roster"
          :squads="roster.squads"
          :ativa-id="squadAtiva?.id ?? ''"
          :desabilitado="isLoading"
          @trocar="trocarSquad"
          @nova="abrirNovaSquad"
        />
```

2. Antes da lista de `GrowthCard`:

```vue
        <TrocaSquadCard
          v-for="sugestao in sugestoesDeTroca"
          :key="sugestao.id"
          :sugestao="sugestao"
          :desabilitado="isLoading"
          @trocar="aceitarTroca(sugestao.id, false)"
          @reenviar="aceitarTroca(sugestao.id, true)"
          @descartar="descartarSugestao(sugestao.id)"
        />
```

3. No `GrowthCard`: `:squad-nome="sugestao.squad_id !== squadAtiva?.id ? nomeDaSquad(sugestao.squad_id) : ''"`.

4. Antes do toast:

```vue
    <NovaSquadModal
      v-if="criandoSquad"
      :enviando="enviandoSquad"
      :erro="erroNovaSquad"
      @criar="criarSquad"
      @fechar="criandoSquad = false"
    />
```

Se o header ficar apertado com o seletor, reduza o `h1` (`text-2xl` → `text-xl`) — não esconda o seletor.

- [ ] **Step 6: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros.

- [ ] **Step 7: Verificação no navegador (sem Google)**

```bash
TMPD=$(mktemp -d "$SCRATCH/fase1-ui2-XXXX")
cp -r "$REPO/seed" "$TMPD/seed" && cp -r "$REPO/dist" "$TMPD/dist"
cd "$TMPD" && PORT=3919 NODE_ENV=production GEMINI_API_KEY=fake IPS_PERMITIDOS= node "$REPO/dist/server.cjs" > "$TMPD/server.log" 2>&1 &
echo $! > "$TMPD/pid"
```

Abra `http://127.0.0.1:3919` e verifique (critério 17 da spec):
- o seletor mostra "Pessoal";
- **+ Nova squad** → preencher Nome "Pay4Fun", Escopo "trabalho", Papel do PO "PO Pay4Fun" → Criar: o modal fecha, o toast diz "Squad Pay4Fun criada", o seletor mostra Pay4Fun selecionada e o mapa mostra a sala Geral com o PO;
- repetir com o mesmo nome → mensagem de erro dentro do modal (409), modal continua aberto;
- trocar para Pessoal no seletor → mapa troca, sem animação de obra; recarregar a página → continua Pessoal;
- `ls "$TMPD/data"` mostra só `squad.json` (seed v3 não gera backup).

Pare o servidor: `kill "$(cat "$TMPD/pid")"`.

- [ ] **Step 8: Commit**

```bash
cd "$REPO" && git add src/components/SquadSelector.vue src/components/NovaSquadModal.vue src/components/TrocaSquadCard.vue src/components/GrowthCard.vue src/App.vue src/types.ts && git commit -m "$(cat <<'EOF'
feat(ui): seletor de squad, gesto Nova squad e card de troca

O header ganha o seletor de squad e o botao Nova squad, que cria a squad com
um dominio e o PO e ja troca para ela. O card de troca so aparece quando o
modelo propoe: Trocar ou Trocar e reenviar sao cliques do usuario. Card de
contratacao de outra squad mostra de qual squad veio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

(`src/types.ts` só entra se `DadosNovaSquad` tiver sido movido para lá; senão tire do `git add`.)

---

### Task 7: Documentação, integração e grafo

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: tudo acima.
- Produces: nada de código.

- [ ] **Step 1: Atualizar `CLAUDE.md`**

Releia. Edições:

1. Primeira linha de descrição: "um squad de agentes" → "squads de agentes (Pessoal, Pay4Fun...)".
2. Árvore de arquitetura: `server/squad.ts  roster v3 em árvore; única fonte de verdade das squads`; `server/hire.ts  aplica contratação aprovada e cria squad`; acrescente `src/squadAtiva.ts  squad ativa da aba (localStorage)` e, em `src/components/`, `SquadSelector, NovaSquadModal, TrocaSquadCard`.
3. Invariante 1 vira:

   **1. O roster é uma árvore de três níveis.** `roster → squad → domínio → { po, integrantes }`. Uma squad = um escritório 3x3; uma sala = um domínio. Contratar um integrante entra na sala existente; criar um domínio ocupa o primeiro slot livre de `unlockOrder` (derivado dos slots ocupados, não de `dominios.length`). Máximo 9 domínios por squad. Squad nasce com 1 domínio + PO (o `GameMap` precisa de `dominios[0].po`). Ids de domínio e de pessoa são únicos entre **todas** as squads e `idsAposentados`; domínio novo é `<squad>--<slug>`.

4. Invariante 2: "A árvore inteira vai literal" → "A árvore **da squad ativa** vai literal para o `systemInstruction`; as outras squads entram só por id, nome e escopo, para o modelo poder chamar `sugerir_troca_squad`."
5. Invariante 3 ganha: "Todo evento criado carrega `squadone_squad` (informativa), `squadone_dominio` (filtro), `squadone_membro`, `squadone_tipo`. A Mochila filtra por domínio da squad ativa; eventos antigos sem `squadone_squad` continuam aparecendo."
6. "Escrita no roster": `atualizarSquad()` → `atualizarRoster()`; acrescente "Um arquivo para todas as squads, então uma fila só."
7. Persistência: tabela `data/squad.json` = "roster v3 `{version:3, squads, idsAposentados}` = os agentes com seu treino"; nova linha `data/squad.v2.bak.json` = "texto cru do roster v2, gravado uma vez pela migração; nunca sobrescrito". Parágrafo novo:

   **Migração e rollback.** `readRoster()` detecta a versão pela forma (`squads` / `dominios` / `members`), grava o backup e escreve v3. Forma desconhecida lança `RosterIlegivel` e não grava. O código anterior à Fase 1 não lê v3: reverter o deploy exige copiar `data/squad.v2.bak.json` por cima de `data/squad.json` no volume, perdendo squads e contratações feitas depois. Ordem: primeiro implantar o commit anterior, depois `cp /app/data/squad.v2.bak.json /app/data/squad.json` no console do container — restaurar com o código da Fase 1 no ar só dispara a migração de novo.

8. Seção "Convenções", item de erros: acrescente `PedidoInvalido` (400), `SquadInexistente` (409 + `squadInexistente: true`), `RosterIlegivel` (500).

- [ ] **Step 2: Verificação final completa**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
cd "$SCRATCH/fase1" && for c in v2-producao v2-seed v1 idempotente v3-no-disco ilegivel json-quebrado falha-no-meio crash tmp-orfao concorrencia vazio vazio-concorrente copia-real slots resolver-e-ids; do npx tsx roster.ts $c || break; done
cd "$SCRATCH/fase1" && for c in nova-squad pessoa-global aposentado hire-por-squad nome-duplicado-legado; do npx tsx hire.ts $c || break; done
cd "$SCRATCH/fase1" && for c in agendar agendar-outra-squad calendar-id propostas troca mochila; do npx tsx capacidades.ts $c || break; done
cd "$SCRATCH/fase1" && npx tsx prompt.ts
```

Esperado: tudo `OK` (ou `SKIP copia-real`). Repita o Step 9 da Task 4 (servidor temporário + `http.ts`) contra o build final.

- [ ] **Step 3: Commit da documentação**

```bash
cd "$REPO" && git add CLAUDE.md && git commit -m "$(cat <<'EOF'
docs: registrar roster v3 multi-squad, contrato do evento e rollback

CLAUDE.md passa a descrever a arvore roster > squad > dominio, ids globais,
as quatro marcas do evento, o backup da migracao e por que reverter o deploy
exige restaurar squad.v2.bak.json no volume.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Integrar com `main` e publicar**

```bash
cd "$REPO" && git status --short
```

Confirme que `graphify-out/` e `docs/daily-summary/` aparecem só como não rastreados e **não** foram adicionados. Então:

```bash
cd "$REPO" && git pull --rebase origin main && npx vue-tsc --noEmit && npm run build && git push origin main
```

Se o rebase conflitar (outra sessão mexe em `server/auth-store.ts` e pode ter tocado `server.ts`), resolva preservando as duas mudanças, rode typecheck + build e `git rebase --continue`. Não use `--force`.

- [ ] **Step 5: Atualizar o grafo**

```bash
cd "$REPO" && graphify update . && git status --short
```

Esperado: `graphify-out/` muda e continua **fora** de qualquer commit.

- [ ] **Step 6: Lembrete de deploy (não executar)**

Push em `main` não implanta. Ao relatar, diga ao usuário: clicar **Implantar** no Easypanel; no primeiro acesso depois do deploy o volume ganha `data/squad.v2.bak.json` e o `squad.json` vira v3; rollback = restaurar o backup (ver CLAUDE.md).

---

## Self-review (feito ao escrever)

- **Cobertura da spec:** §3 tipos → T1/T5; §3.3 slots → T1; §3.4 seed → T1; §4 migração/backup/concorrência/rollback → T1/T7; §5 contrato → T3; §6 ids → T1/T2/T3; §7.1 erros → T1/T4; §7.2 rotas → T2/T4; §7.3 capacidades → T3/T4; §8.1–8.3 → T5; §8.2/8.4 → T6; §9 prompt → T4; §10 riscos → mitigados nas tasks citadas; §11 critérios 1–9 → `roster.ts`, 10–12 → `hire.ts`, 13–14 → `capacidades.ts`, 15 → `prompt.ts`, 16 → `http.ts`, 17 → T5/T6 Step de navegador, 18 → T1 Step 7 + typecheck/build em toda task.
- **Nomes consistentes:** `readRoster`, `writeRoster`, `atualizarRoster`, `resolverSquad`, `paraVista`, `novoIdDeDominio(roster, squad, nome)`, `marcasDoEvento`, `urlDeEventos`, `PedidoDeTurno`, `ContextoDoPrompt`, `squadone:squadAtiva` usados igual em todas as tasks.
- **Ponte entre tasks:** T1 cria `readSquad`/`atualizarSquad` sobre `squads[0]`; T3 troca o uso em `orchestrator.ts`; T4 remove as pontes e verifica com grep.
