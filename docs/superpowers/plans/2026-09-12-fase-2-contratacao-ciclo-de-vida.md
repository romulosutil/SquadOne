# Fase 2 — Contratação explícita e ciclo de vida dos agentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O usuário contrata pela UI com treino redigido pelo Gemini (editável, opcional), edita pessoas/domínios/squads e arquiva/reativa integrante, domínio e squad sem perder ids nem eventos, com o escritório animando a saída e a volta das salas.

**Architecture:** `server/squad.ts` ganha a noção de "ativo" e passa a filtrar arquivados em todo helper de turno, Mochila, prompt e vista, mantendo tudo nos helpers de unicidade de id. `server/ciclo-de-vida.ts` (novo) edita, arquiva e reativa dentro de `atualizarRoster`. `server/hire.ts` ganha escopo longo e substituição de PO. `server/redacao.ts` (novo) faz uma chamada de function calling restrita via `gerarComRetry`. O frontend ganha um painel de salas fora do canvas e três modais; `useOffice` passa a esquecer salas e anima o fechamento.

**Tech Stack:** Node + Express + tsx, `@google/genai`, Vue 3.5 (`<script setup>`), Vite 6, TypeScript via `vue-tsc`. Sem suíte de testes: scripts `tsx` descartáveis fora do repo.

**Spec:** `docs/superpowers/specs/2026-09-12-fase-2-contratacao-ciclo-de-vida-design.md`. Leia inteira antes da Task 1; seções citadas como §N. Também leia §3, §6 e §7 da spec da Fase 1 (`docs/superpowers/specs/2026-09-12-fase-1-multi-squad-design.md`).

## Global Constraints

- **Pré-requisito: a Fase 1 aterrissou em `main`** (commits `2ff5e1a..1b122e0`). Três fatos do código real que esta fase resolve: `proximoSlot`/`unlockedSlots` contam todo domínio, arquivado inclusive (Task 1 corrige); ninguém grava `idsAposentados` ainda (Task 2 grava); `DadosNovaSquad` mora em `src/types.ts` e a criação de squad é `POST /api/squad/nova` (Tasks 6–7 não mexem nisso). Antes da Task 1 rode `git pull --rebase origin main` e depois:
  ```bash
  grep -n "export async function readRoster\|export function resolverSquad\|export function paraVista\|export class SquadInexistente" server/squad.ts
  grep -n "api/squad/nova\|function responderErroDeRoster" server.ts
  grep -n "sugerir_troca_squad" server/capabilities.ts
  ```
  Se qualquer um vier vazio, **pare** e reporte: este plano não se aplica sobre o código anterior à Fase 1.
- **A Fase 3 (alocador de agenda, `docs/superpowers/specs/2026-09-12-fase-3-alocador-de-agenda-design.md`) é implementada ANTES desta.** Ela reescreve o contrato de `agendar_evento`, o turno e partes do prompt (`server/orchestrator.ts`, `server/capabilities.ts`), e mexe em `server.ts`, `src/App.vue`, `src/types.ts`, `src/components/QuestBackpack.vue` e `CommandBar.vue`. Toda task que toca esses arquivos começa relendo o código **pós-Fase 3**. Trechos deste plano sobre eles valem pela **intenção**, não pela assinatura nem pelo número de linha. Localize pelo texto, preserve o que a Fase 3 fez e aplique só a mudança descrita. As partes de roster (`squad.ts`), hire, ciclo de vida, redação, mapa e UI de contratação/arquivamento não dependem da Fase 3. Antes da Task 1, confirme com `git log --oneline -15` que os commits da Fase 3 estão em `main`; se ela ainda estiver em andamento, **pare** e reporte.
- **Releia o código antes de cada task.** Os arquivos pós-Fase 1 e pós-Fase 3 são a verdade. Os trechos deste plano mostram a forma esperada; onde o arquivo divergir (nomes de variável, comentários, ordem), preserve o comportamento da Fase 0 e da Fase 1 e aplique a mudança descrita. Cada task começa com um Step 0 de releitura.
- **Nunca** ler/gravar/rodar contra o `data/` do repo, exceto *copiar* `data/squad.json` para um diretório temporário (cenário `copia-real`).
- **Nunca** chamar Google Calendar nem Gemini reais. O Gemini é mockado nos scripts; o servidor de teste roda com `GEMINI_API_KEY=fake` e só rotas que falham **antes** de chamar serviços externos são exercitadas por HTTP. Nenhum clique em "Redigir" com pedido válido contra servidor que tenha chave real.
- **Não tocar** `server/auth-store.ts` (sessão paralela).
- **Não commitar** `graphify-out/`, `docs/daily-summary/`, nem specs/planos de **outras** fases (roadmap, Fase 1, Fase 3). Sempre `git add` com caminhos explícitos.
- Toda escrita no roster via `atualizarRoster`. Erros classificados: `PedidoInvalido` → 400, `ConflitoDeRoster` → 409, `SquadInexistente`/`SquadArquivada` → 409 + `squadInexistente: true`, `RedacaoInvalida` → 502 + `redacaoFalhou: true`, `ModeloOcupado` → 503 + `modeloOcupado: true`, resto → 500.
- Limites exatos (`LIMITES`): `squadNome` 40, `squadEscopo` 200, `dominioNome` 60, `dominioEscopo` 200, `pessoaNome` 40, `papel` 60, `escopoPessoa` 1500, `frase` 300.
- Nenhuma rota desta fase chama o Google. `server/ciclo-de-vida.ts` e `server/redacao.ts` não contêm `fetch(` nem importam `calendar.ts`.
- O formulário **não** pede `horario`. Janela de agenda é Fase 3.
- Comentários e identificadores em português; comentário explica *por quê*.
- Commits em português, `tipo(escopo): descrição`, corpo com o porquê, última linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Verificação por task: `npx vue-tsc --noEmit`, `npm run build` e o script da task.

## Ambiente dos scripts de verificação

Git Bash. Uma vez por sessão:

```bash
export REPO="C:/Users/sutil/Documents/dev/PESSOAL/apps/SquadOne"
export SCRATCH="<diretório de rascunho da sua sessão, FORA do repo>"
mkdir -p "$SCRATCH/fase2"
```

Os scripts ficam em `$SCRATCH/fase2/` e **não** são commitados. `server/squad.ts` calcula `data/` a partir de `process.cwd()` no import, então cada cenário roda num processo próprio que faz `chdir` para um diretório temporário antes de importar.

## Mapa de arquivos

| Arquivo | Responsabilidade | Tasks |
|---|---|---|
| `server/squad.ts` | `arquivado` em Squad, helpers ativos, `SquadArquivada`, vista com arquivo, limites e normalização, localizar, `aposentarIds`, árvore com escopo em bloco | 1 |
| `server/capabilities.ts` | troca de squad só para ativa; descrição de crescimento | 1, 3 |
| `server/hire.ts` | escopo longo, `escopo_po`, sala por ativos, nome de arquivado, `substituirPo` | 2 |
| `server/ciclo-de-vida.ts` (novo) | editar, arquivar e reativar pessoa/domínio/squad | 2 |
| `server/orchestrator.ts` | exportar `gerarComRetry`; viés de crescimento | 3 |
| `server/redacao.ts` (novo) | pedido, prompt e chamada restrita de redação | 3 |
| `server.ts` | rotas novas e `/redigir` | 4 |
| `src/office/salas.ts` (novo) | diferença pura entre salas conhecidas e roster (abrir/fechar/trocar dono) | 5 |
| `src/office/useOffice.ts`, `src/components/GameMap.vue`, `src/index.css` | `knownRooms` por dono, fechamento, gerações, reassento | 5 |
| `src/types.ts` | espelho da vista nova, `LIMITES`, tipos de redação | 6 |
| `src/rosterApi.ts` (novo) | chamadas HTTP do roster com erro classificado | 6 |
| `src/components/SalasPainel.vue` (novo) | gestos por sala fora do canvas | 6 |
| `src/components/ContratarModal.vue` (novo) | contratar integrante/domínio/PO com redação | 6 |
| `src/components/GrowthCard.vue` | botão Ajustar | 6 |
| `src/App.vue` | estado dos modais e fluxos | 6, 7 |
| `src/components/EditarModal.vue` (novo) | editar pessoa/domínio/squad | 7 |
| `src/components/ArquivoModal.vue` (novo) | listar e reativar | 7 |
| `src/components/SquadSelector.vue` | editar/arquivar squad | 7 |
| `src/components/QuestBackpack.vue` | nome da pessoa, "(arquivado)" | 7 |
| `CLAUDE.md` | invariantes e rotas novas | 8 |

---

### Task 1: Arquivado, helpers ativos e vista em `server/squad.ts`

**Files:**
- Modify: `server/squad.ts`
- Modify: `server/capabilities.ts` (só `sugerir_troca_squad`)
- Test (fora do repo): `$SCRATCH/fase2/harness.ts`, `$SCRATCH/fase2/roster.ts`

**Interfaces:**
- Consumes (Fase 1): `Roster`, `Squad`, `Dominio`, `Pessoa`, `SquadInexistente`, `ConflitoDeRoster`, `PedidoInvalido`, `readRoster`, `atualizarRoster`, `resolverSquad`, `paraVista`, `pessoas`, `todasAsPessoas`, `idsEmUso`, `novoIdDePessoa`, `novoIdDeDominio`, `novoIdDeSquad`, `outrasSquads`, `rosterTree`, `acharDominio`, `acharPessoa`, `idsDePessoas`, `dominiosDoSquad`, `unlockedSlots`, `proximoSlot`, `slug`, `salaPara`.
- Produces (Tasks 2–7):
  - campos `arquivado?: boolean; arquivadoEm?: string` em `Pessoa`, `Dominio`, `Squad`
  - `LIMITES` (constantes da Global Constraints), `textoDeUmaLinha(v: string): string`, `normalizarEscopo(v: string): string`, `limitar(texto: string, max: number): { texto: string; truncado: boolean }`
  - `ativo(x: { arquivado?: boolean }): boolean`, `squadsAtivas(r: Roster): Squad[]`, `dominiosAtivos(s: Squad): Dominio[]`, `integrantesAtivos(d: Dominio): Pessoa[]`, `pessoasAtivas(s: Squad): { pessoa: Pessoa; dominio: Dominio }[]`
  - `class SquadArquivada extends SquadInexistente` (`name = "SquadArquivada"`, `squadId`)
  - `interface PessoaLocalizada { squad: Squad; dominio: Dominio; pessoa: Pessoa; posicao: "po" | "integrante" }`, `localizarPessoa(r, id: unknown): PessoaLocalizada | null`, `localizarDominio(r, id: unknown): { squad: Squad; dominio: Dominio } | null`, `localizarSquad(r, id: unknown): Squad | null`
  - `aposentarIds(r: Roster, ids: { pessoas?: string[]; dominios?: string[] }): void`
  - `interface IntegranteArquivadoView { pessoa: Pessoa; dominioId: string; dominioNome: string }`, `SquadView`, `RosterView` na forma de spec §6.3
  - semântica nova (só ativos): `acharDominio`, `acharPessoa`, `idsDePessoas`, `dominiosDoSquad`, `rosterTree`, `unlockedSlots`, `proximoSlot`, `outrasSquads`, `resolverSquad`
  - semântica mantida (tudo): `pessoas`, `todasAsPessoas`, `idsEmUso`, `novoIdDe*`

- [ ] **Step 0: Reler**

Leia `server/squad.ts` e `server/hire.ts` inteiros, como a Fase 1 deixou. Leia `server/capabilities.ts` e `server.ts` **pós-Fase 3** (`git log --oneline -10 -- server/capabilities.ts server.ts`). Nesta task só `sugerir_troca_squad` muda em `capabilities.ts`: localize o handler pelo nome e não toque em `agendar_evento`. Se a Fase 3 tiver passado a usar algum helper de `squad.ts` que esta task filtra por ativos (`acharPessoa`, `idsDePessoas`, `dominiosDoSquad`...), isso é desejado: pessoa arquivada não recebe compromisso. Anote onde cada helper da tabela de spec §6.4 é chamado (`grep -rn "acharDominio\|acharPessoa\|idsDePessoas\|dominiosDoSquad\|unlockedSlots\|proximoSlot\|outrasSquads\|resolverSquad\|paraVista" server server.ts`).

- [ ] **Step 1: Criar o harness**

`$SCRATCH/fase2/harness.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.REPO) throw new Error("Defina REPO antes de rodar.");
export const REPO = path.resolve(process.env.REPO);
const BASE = process.env.SCRATCH ?? os.tmpdir();

export const UO: [number, number][] = [[0,0],[1,0],[0,1],[1,1],[2,0],[2,1],[0,2],[1,2],[2,2]];
const T = "2026-09-11T09:00:00-03:00";

const pessoa = (id: string, nome: string, papel = "PO", escopo = "tudo") => ({
  id, nome, papel, escopo, sprite: "", hiredAt: T,
});

/**
 * Fixture F2 (spec §10): pessoal = casa [0,0] (PO romulo + integrante ana) e
 * pessoal--financeiro [1,0] (PO fin); pay4fun = pay4fun--geral [0,0] (PO bia).
 */
export const F2 = {
  version: 3,
  idsAposentados: { pessoas: [] as string[], dominios: [] as string[] },
  squads: [
    {
      id: "pessoal", nome: "Pessoal", escopo: "vida pessoal", calendarId: "primary", unlockOrder: UO,
      dominios: [
        { id: "casa", nome: "Casa", escopo: "casa e família", slot: [0, 0], room: "ROOM_DEV", criadoEm: T,
          po: pessoa("romulo", "Rômulo"), integrantes: [pessoa("ana", "Ana", "Contadora", "impostos")] },
        { id: "pessoal--financeiro", nome: "Financeiro", escopo: "contas", slot: [1, 0], room: "ROOM_SOLO", criadoEm: T,
          po: pessoa("fin", "Fin", "PO Financeiro"), integrantes: [] },
      ],
    },
    {
      id: "pay4fun", nome: "Pay4Fun", escopo: "trabalho na Pay4Fun", calendarId: "primary", unlockOrder: UO,
      dominios: [
        { id: "pay4fun--geral", nome: "Geral", escopo: "trabalho", slot: [0, 0], room: "ROOM_SOLO", criadoEm: T,
          po: pessoa("bia", "Bia", "PO Pay4Fun"), integrantes: [] },
      ],
    },
  ],
};

export const f2 = (): any => structuredClone(F2);
export const txt = (o: unknown) => JSON.stringify(o, null, 2) + "\n";

/** Diretório descartável com seed/ e, opcionalmente, data/squad.json. Faz chdir. */
export async function prepararDiretorio(squadJson?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(BASE, "fase2-"));
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

export async function lerRoster(dir: string): Promise<any> {
  return JSON.parse(await fs.readFile(path.join(dir, "data", "squad.json"), "utf8"));
}

/** Compara pelo `name` da classe: robusto a identidade de módulo no import dinâmico. */
export async function rejeitaCom(p: Promise<unknown>, nome: string, trecho?: string): Promise<any> {
  try {
    await p;
  } catch (err: any) {
    if (err?.name !== nome) throw new Error(`Esperava ${nome}, veio ${err?.name}: ${err?.message}`);
    if (trecho && !String(err.message).includes(trecho)) throw new Error(`Mensagem sem '${trecho}': ${err.message}`);
    return err;
  }
  throw new Error(`Esperava ${nome}, mas resolveu.`);
}

export function lancaCom(fn: () => unknown, nome: string): any {
  try {
    fn();
  } catch (err: any) {
    if (err?.name !== nome) throw new Error(`Esperava ${nome}, veio ${err?.name}: ${err?.message}`);
    return err;
  }
  throw new Error(`Esperava ${nome}, mas não lançou.`);
}
```

- [ ] **Step 2: Escrever o script do roster**

`$SCRATCH/fase2/roster.ts`:

```ts
import assert from "node:assert/strict";
import { f2, importar, lancaCom, prepararDiretorio } from "./harness.ts";

const cenario = process.argv[2];

async function main() {
  await prepararDiretorio();
  const sq = await importar("server/squad.ts");

  /** ana (integrante de casa) e o domínio pessoal--financeiro arquivados. */
  const comArquivados = () => {
    const r = f2();
    r.squads[0].dominios[0].integrantes[0].arquivado = true;
    r.squads[0].dominios[1].arquivado = true;
    return r;
  };

  switch (cenario) {
    case "ativos": {
      const r = comArquivados();
      const s = r.squads[0];
      assert.deepEqual(sq.idsDePessoas(s), ["romulo"]);
      assert.equal(sq.acharDominio(s, "pessoal--financeiro"), null);
      assert.equal(sq.acharDominio(s, "casa").id, "casa");
      assert.equal(sq.acharPessoa(s, "ana"), null);
      assert.equal(sq.acharPessoa(s, "fin"), null);
      assert.deepEqual(sq.dominiosDoSquad(s), ["casa"]);
      assert.deepEqual(sq.unlockedSlots(s), [[0, 0]]);
      assert.deepEqual(sq.proximoSlot(s), [1, 0]);
      const arvore = sq.rosterTree(s);
      assert.ok(!arvore.includes("'ana'"), "integrante arquivado na árvore");
      assert.ok(!arvore.includes("'pessoal--financeiro'"), "domínio arquivado na árvore");
      const ids = sq.idsEmUso(r);
      assert.ok(ids.pessoas.has("ana") && ids.pessoas.has("fin"), "unicidade precisa ver arquivados");
      assert.ok(ids.dominios.has("pessoal--financeiro"));
      assert.equal(sq.pessoas(s).length, 3, "pessoas() continua vendo tudo");
      assert.equal(sq.novoIdDePessoa(r, "Ana"), "ana-2");
      assert.equal(sq.pessoasAtivas(s).length, 1);
      assert.equal(sq.squadsAtivas(r).length, 2);
      break;
    }
    case "vista": {
      const r = comArquivados();
      let v = sq.paraVista(r);
      assert.deepEqual(v.squads[0].dominios.map((d: any) => d.id), ["casa"]);
      assert.equal(v.squads[0].dominios[0].integrantes.length, 0);
      assert.equal(v.squads[0].arquivo.dominios[0].id, "pessoal--financeiro");
      assert.equal(v.squads[0].arquivo.integrantes.length, 1);
      assert.deepEqual(
        { id: v.squads[0].arquivo.integrantes[0].pessoa.id, dominioId: v.squads[0].arquivo.integrantes[0].dominioId, dominioNome: v.squads[0].arquivo.integrantes[0].dominioNome },
        { id: "ana", dominioId: "casa", dominioNome: "Casa" },
      );
      assert.deepEqual(v.squads[0].proximoSlot, [1, 0]);
      assert.deepEqual(v.squads[0].unlockedSlots, [[0, 0]]);
      assert.deepEqual(v.squadsArquivadas, []);
      // A vista não pode alterar o roster de origem.
      assert.equal(r.squads[0].dominios.length, 2);
      assert.equal(r.squads[0].dominios[0].integrantes.length, 1);
      r.squads[1].arquivado = true;
      v = sq.paraVista(r);
      assert.equal(v.squads.length, 1);
      assert.equal(v.squadsArquivadas[0].id, "pay4fun");
      break;
    }
    case "resolver": {
      const r = f2();
      r.squads[1].arquivado = true;
      const e = lancaCom(() => sq.resolverSquad(r, "pay4fun"), "SquadArquivada");
      assert.equal(e.squadId, "pay4fun");
      assert.ok(e instanceof sq.SquadInexistente, "SquadArquivada precisa ser SquadInexistente");
      assert.ok(e.message.includes("arquivada"));
      assert.equal(sq.outrasSquads(r, "pessoal"), "(nenhuma)");
      const r2 = f2();
      r2.squads[0].arquivado = true;
      assert.equal(sq.resolverSquad(r2, undefined).id, "pay4fun");
      assert.equal(sq.resolverSquad(r2, "").id, "pay4fun");
      lancaCom(() => sq.resolverSquad(r2, "nao-existe"), "SquadInexistente");
      break;
    }
    case "arvore": {
      const r = f2();
      r.squads[0].dominios[0].integrantes[0].escopo = "Missão: a\nCuida de: b\nNão cuida de: c";
      const arvore = sq.rosterTree(r.squads[0]);
      assert.ok(
        arvore.includes("    integrante: 'ana' Ana (Contadora)\n      Missão: a\n      Cuida de: b\n      Não cuida de: c"),
        arvore,
      );
      assert.ok(arvore.includes("    PO: 'romulo' Rômulo (PO)\n      tudo"), arvore);
      assert.ok(arvore.includes("- domínio 'casa' — Casa (escopo: casa e família)"), arvore);
      break;
    }
    case "texto": {
      assert.equal(sq.normalizarEscopo("  a  b \r\n\r\n\r\n\tc\u0007 "), "a b\n\nc");
      assert.equal(sq.textoDeUmaLinha(" a \n  b "), "a b");
      assert.deepEqual(sq.limitar("abc", 5), { texto: "abc", truncado: false });
      assert.deepEqual(sq.limitar("x".repeat(10), 5), { texto: "xxxxx", truncado: true });
      assert.deepEqual(sq.limitar("aaaaaa\nbbbb", 8), { texto: "aaaaaa", truncado: true });
      assert.deepEqual(sq.limitar("aaaa\nbbbbbb", 8), { texto: "aaaa\nbbb", truncado: true });
      assert.equal(sq.LIMITES.escopoPessoa, 1500);
      assert.equal(sq.LIMITES.frase, 300);
      break;
    }
    case "localizar-e-aposentar": {
      const r = f2();
      const a = sq.localizarPessoa(r, "ana");
      assert.equal(a.posicao, "integrante");
      assert.equal(a.dominio.id, "casa");
      assert.equal(a.squad.id, "pessoal");
      assert.equal(sq.localizarPessoa(r, "bia").posicao, "po");
      assert.equal(sq.localizarPessoa(r, "zzz"), null);
      assert.equal(sq.localizarDominio(r, "pay4fun--geral").squad.id, "pay4fun");
      assert.equal(sq.localizarSquad(r, "pay4fun").nome, "Pay4Fun");
      sq.aposentarIds(r, { pessoas: ["ana", "ana"], dominios: ["casa"] });
      sq.aposentarIds(r, { pessoas: ["ana"] });
      assert.deepEqual(r.idsAposentados, { pessoas: ["ana"], dominios: ["casa"] });
      break;
    }
    case "troca-arquivada": {
      const { CAPABILITIES } = await importar("server/capabilities.ts");
      const r = f2();
      r.squads[1].arquivado = true;
      const ctx = { token: null, roster: r, squad: r.squads[0], agora: new Date(), modo: "auto", demanda: "x" };
      await assert.rejects(CAPABILITIES.sugerir_troca_squad.handler({ squad_id: "pay4fun", justificativa: "j" }, ctx));
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
cd "$SCRATCH/fase2" && for c in ativos vista resolver arvore texto localizar-e-aposentar troca-arquivada; do npx tsx roster.ts $c || break; done
```

Esperado: `FALHOU ativos` (`idsDePessoas` ainda devolve `ana` e `fin`).

- [ ] **Step 4: Tipos, limites e normalização**

Em `server/squad.ts`:

1. `Pessoa` e `Dominio`: troque o comentário "Reservado para a Fase 2" de `arquivado` por:

```ts
  /**
   * Arquivado sai do prompt, do mapa e da vista, mas NÃO sai da árvore: o id
   * continua reservado e o registro volta intacto ao reativar. Reativar apaga
   * esta chave e `arquivadoEm`.
   */
  arquivado?: boolean;
  /** ISO do arquivamento; só para ordenar e exibir no Arquivo. */
  arquivadoEm?: string;
```

2. `Squad` ganha os mesmos dois campos, com o mesmo comentário.

3. Depois das constantes (`ESCOPO_PESSOAL_PADRAO`):

```ts
/**
 * Limites de texto do roster (spec Fase 2 §5.4). Um lugar só, espelhado em
 * src/types.ts: o formulário corta antes de enviar e o servidor recusa ou
 * trunca com o mesmo número. Escopo de pessoa é o "treino" do agente, por isso
 * bem maior que os demais, que são linhas de roteamento.
 */
export const LIMITES = {
  squadNome: 40,
  squadEscopo: 200,
  dominioNome: 60,
  dominioEscopo: 200,
  pessoaNome: 40,
  papel: 60,
  escopoPessoa: 1500,
  frase: 300,
} as const;

/** Nome, papel, escopo de domínio/squad: uma linha só, espaços colapsados. */
export function textoDeUmaLinha(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * Escopo de pessoa: várias linhas (as cinco seções do treino), sem lixo de
 * colagem. Caractere de controle e linha em branco em excesso só gastam prompt.
 */
export function normalizarEscopo(texto: string): string {
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .split("\n")
    .map((linha) => linha.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Corta no limite preferindo uma quebra de linha, para não deixar uma seção
 * do treino pela metade. Só para texto que veio do modelo ou de card: texto
 * que o usuário revisou é recusado (400), não cortado.
 */
export function limitar(texto: string, max: number): { texto: string; truncado: boolean } {
  if (texto.length <= max) return { texto, truncado: false };
  const quebra = texto.lastIndexOf("\n", max);
  const corte = quebra > max * 0.6 ? quebra : max;
  return { texto: texto.slice(0, corte).trimEnd(), truncado: true };
}
```

- [ ] **Step 5: Erro de squad arquivada**

Logo depois de `SquadInexistente`:

```ts
/**
 * Squad arquivada pedida por id. Herda de SquadInexistente de propósito: para a
 * UI o gesto é o mesmo (recarregar o roster e cair na primeira ativa), e a rota
 * já mapeia a classe mãe para 409 com `squadInexistente: true`.
 */
export class SquadArquivada extends SquadInexistente {
  constructor(squad: Squad, ativas: string[]) {
    super(squad.id, ativas);
    this.message = `A squad '${squad.nome}' está arquivada. Squads ativas: ${ativas.join(", ")}.`;
    this.name = "SquadArquivada";
  }
}
```

- [ ] **Step 6: Helpers ativos e filtragem dos existentes**

Antes de `pessoas()`:

```ts
/**
 * Ativo = não arquivado NESTE nível. Quem precisa da regra completa (pessoa
 * ativa exige domínio e squad ativos) compõe pelos helpers abaixo, que sempre
 * descem a partir de uma squad já resolvida como ativa.
 */
export function ativo(x: { arquivado?: boolean }): boolean {
  return x.arquivado !== true;
}

export function squadsAtivas(roster: Roster): Squad[] {
  return roster.squads.filter(ativo);
}

export function dominiosAtivos(squad: Squad): Dominio[] {
  return squad.dominios.filter(ativo);
}

export function integrantesAtivos(dominio: Dominio): Pessoa[] {
  return dominio.integrantes.filter(ativo);
}

/** Pessoas que podem receber compromisso: de domínios ativos, PO primeiro. */
export function pessoasAtivas(squad: Squad): { pessoa: Pessoa; dominio: Dominio }[] {
  return dominiosAtivos(squad).flatMap((d) =>
    [d.po, ...integrantesAtivos(d)].map((pessoa) => ({ pessoa, dominio: d })),
  );
}
```

Acima de `pessoas()`, acrescente ao comentário: `TODAS, arquivadas inclusive: é a base da unicidade de id (idsEmUso). Para turno, prompt e Mochila use pessoasAtivas.`

Troque os corpos (mantenha assinaturas e comentários, acrescentando "só ativos" onde couber):

```ts
export function acharDominio(squad: Squad, id: unknown): Dominio | null {
  // Só ativos: domínio arquivado não recebe integrante nem compromisso.
  return dominiosAtivos(squad).find((d) => d.id === id) ?? null;
}

export function acharPessoa(squad: Squad, id: unknown): { pessoa: Pessoa; dominio: Dominio } | null {
  return pessoasAtivas(squad).find((p) => p.pessoa.id === id) ?? null;
}

export function idsDePessoas(squad: Squad): string[] {
  return pessoasAtivas(squad).map((p) => p.pessoa.id);
}

/**
 * Domínios que a Mochila lê: só ativos. Domínio arquivado sai da Mochila (spec
 * Fase 2 §7.11) — os eventos ficam no Google e voltam ao reativar.
 */
export function dominiosDoSquad(squad: Squad): string[] {
  return dominiosAtivos(squad).map((d) => d.id);
}

export function unlockedSlots(squad: Squad): [number, number][] {
  return dominiosAtivos(squad).map((d) => d.slot);
}

export function proximoSlot(squad: Squad): [number, number] | null {
  // Domínio arquivado libera o slot: quem ocupa é só quem aparece no mapa.
  const ocupados = new Set(dominiosAtivos(squad).map((d) => d.slot.join(",")));
  return squad.unlockOrder.find((s) => !ocupados.has(s.join(","))) ?? null;
}
```

`rosterTree` inteiro:

```ts
/** Recuo de bloco: escopo de pessoa tem várias linhas e não cabe entre parênteses. */
function emBloco(texto: string, recuo: string): string {
  return texto.split("\n").map((linha) => recuo + linha).join("\n");
}

/**
 * A ÁRVORE da squad injetada no systemInstruction — só o que está ATIVO. O
 * escopo de pessoa (até 1500 caracteres, cinco seções) vai como bloco recuado
 * abaixo da pessoa; o de domínio é uma linha e segue inline.
 */
export function rosterTree(squad: Squad): string {
  return dominiosAtivos(squad)
    .map((d) => {
      const linhas = [
        `- domínio '${d.id}' — ${d.nome} (escopo: ${d.escopo})`,
        `    PO: '${d.po.id}' ${d.po.nome} (${d.po.papel})`,
        emBloco(d.po.escopo, "      "),
      ];
      for (const i of integrantesAtivos(d)) {
        linhas.push(`    integrante: '${i.id}' ${i.nome} (${i.papel})`, emBloco(i.escopo, "      "));
      }
      return linhas.join("\n");
    })
    .join("\n");
}
```

`resolverSquad`:

```ts
export function resolverSquad(roster: Roster, squadId: unknown): Squad {
  const ativas = squadsAtivas(roster);
  // Ausente = primeira ATIVA. Validação garante ≥1 squad e o ciclo de vida
  // garante ≥1 ativa (não se arquiva a última).
  if (squadId === undefined || squadId === null || squadId === "") return ativas[0];
  if (typeof squadId !== "string") throw new PedidoInvalido("Campo 'squadId' deve ser texto.");
  const achada = roster.squads.find((s) => s.id === squadId);
  if (!achada) throw new SquadInexistente(squadId, ativas.map((s) => s.id));
  if (!ativo(achada)) throw new SquadArquivada(achada, ativas.map((s) => s.id));
  return achada;
}
```

`outrasSquads`: troque `roster.squads.filter((s) => s.id !== ativaId)` por `squadsAtivas(roster).filter((s) => s.id !== ativaId)`.

`novoIdDeDominio`: na mensagem do conflito por nome, use:

```ts
    throw new ConflitoDeRoster(
      ativo(mesmoNome)
        ? `O domínio '${mesmoNome.nome}' (id '${mesmoNome.id}') já existe na squad '${squad.nome}'.`
        : `O domínio '${mesmoNome.nome}' existe arquivado na squad '${squad.nome}': reative-o no Arquivo.`,
    );
```

`novoIdDeSquad`: mensagem

```ts
    throw new ConflitoDeRoster(
      ativo(existente)
        ? `A squad '${existente.nome}' (id '${id}') já existe.`
        : `A squad '${existente.nome}' existe arquivada: reative-a.`,
    );
```

- [ ] **Step 7: Localizar e aposentar**

Depois de `outrasSquads`:

```ts
export interface PessoaLocalizada {
  squad: Squad;
  dominio: Dominio;
  pessoa: Pessoa;
  posicao: "po" | "integrante";
}

/**
 * Busca por id GLOBAL, arquivados inclusive. Ids de pessoa e domínio são únicos
 * entre todas as squads, então as rotas de ciclo de vida não precisam de squadId.
 */
export function localizarPessoa(roster: Roster, id: unknown): PessoaLocalizada | null {
  for (const squad of roster.squads) {
    for (const dominio of squad.dominios) {
      if (dominio.po.id === id) return { squad, dominio, pessoa: dominio.po, posicao: "po" };
      const pessoa = dominio.integrantes.find((p) => p.id === id);
      if (pessoa) return { squad, dominio, pessoa, posicao: "integrante" };
    }
  }
  return null;
}

export function localizarDominio(roster: Roster, id: unknown): { squad: Squad; dominio: Dominio } | null {
  for (const squad of roster.squads) {
    const dominio = squad.dominios.find((d) => d.id === id);
    if (dominio) return { squad, dominio };
  }
  return null;
}

export function localizarSquad(roster: Roster, id: unknown): Squad | null {
  return roster.squads.find((s) => s.id === id) ?? null;
}

/**
 * Só acréscimo, sem duplicata. Reativar NÃO remove: o id volta para o próprio
 * dono e segue proibido para ids novos. Hoje o arquivado nunca sai da árvore;
 * a lista mantém a garantia se um dia uma poda remover subárvores arquivadas.
 */
export function aposentarIds(roster: Roster, ids: { pessoas?: string[]; dominios?: string[] }): void {
  for (const id of ids.pessoas ?? []) {
    if (!roster.idsAposentados.pessoas.includes(id)) roster.idsAposentados.pessoas.push(id);
  }
  for (const id of ids.dominios ?? []) {
    if (!roster.idsAposentados.dominios.includes(id)) roster.idsAposentados.dominios.push(id);
  }
}
```

- [ ] **Step 8: Vista com arquivo**

Substitua `SquadView`, `RosterView` e `paraVista`:

```ts
export interface IntegranteArquivadoView {
  pessoa: Pessoa;
  dominioId: string;
  dominioNome: string;
}

/**
 * O que sai pela API. `dominios` e `integrantes` só com ativos: GameMap,
 * seletor e Mochila leem estes campos sem saber que arquivamento existe. O que
 * foi arquivado vai à parte, em `arquivo`, para a tela de reativar.
 */
export type SquadView = Omit<Squad, "dominios"> & {
  dominios: Dominio[];
  unlockedSlots: [number, number][];
  proximoSlot: [number, number] | null;
  arquivo: { dominios: Dominio[]; integrantes: IntegranteArquivadoView[] };
};

export type RosterView = Omit<Roster, "squads"> & {
  squads: SquadView[];
  squadsArquivadas: SquadView[];
};

function vistaDaSquad(squad: Squad): SquadView {
  const ativos = dominiosAtivos(squad);
  return {
    ...squad,
    dominios: ativos.map((d) => ({ ...d, integrantes: integrantesAtivos(d) })),
    unlockedSlots: unlockedSlots(squad),
    proximoSlot: proximoSlot(squad),
    arquivo: {
      dominios: squad.dominios.filter((d) => !ativo(d)),
      // Integrante de domínio arquivado aparece junto do domínio, não aqui:
      // reativá-lo sozinho seria recusado (pai arquivado).
      integrantes: ativos.flatMap((d) =>
        d.integrantes
          .filter((i) => !ativo(i))
          .map((pessoa) => ({ pessoa, dominioId: d.id, dominioNome: d.nome })),
      ),
    },
  };
}

export function paraVista(roster: Roster): RosterView {
  return {
    ...roster,
    squads: squadsAtivas(roster).map(vistaDaSquad),
    squadsArquivadas: roster.squads.filter((s) => !ativo(s)).map(vistaDaSquad),
  };
}
```

Se algum chamador da Fase 1 usar `vista.squads[vista.squads.length - 1]` (em `criarSquad`), continua certo: a squad nova é ativa e vai para o fim.

- [ ] **Step 9: `sugerir_troca_squad` só para squad ativa**

Em `server/capabilities.ts`, importe `squadsAtivas` de `./squad.ts` e, no handler de `sugerirTrocaSquad`, troque as duas buscas em `ctx.roster.squads` por `squadsAtivas(ctx.roster)`:

```ts
    // Só ativas: squad arquivada não aparece no prompt e não pode ser destino.
    const ativas = squadsAtivas(ctx.roster);
    const destino = ativas.find((s) => s.id === args.squad_id);
    if (!destino) {
      const outras = ativas.filter((s) => s.id !== ctx.squad.id).map((s) => s.id);
      throw new Error(
        `squad_id '${String(args.squad_id)}' não existe ou está arquivada. Outras squads: ${outras.join(", ") || "(nenhuma)"}.`,
      );
    }
```

- [ ] **Step 10: Rodar e ver passar**

```bash
cd "$SCRATCH/fase2" && for c in ativos vista resolver arvore texto localizar-e-aposentar troca-arquivada; do npx tsx roster.ts $c || break; done
```

Esperado: 7 linhas `OK`.

- [ ] **Step 11: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros. `src/` tem espelho próprio dos tipos (`src/types.ts`) e o JSON só ganhou campos, então nada em `src/` quebra; o espelho novo é a Task 6. Um erro de tipo em `server/` por causa de `SquadView`/`RosterView` (algum chamador que monta a vista à mão) deve ser corrigido aqui, usando `paraVista`.

- [ ] **Step 12: Commit**

```bash
cd "$REPO" && git add server/squad.ts server/capabilities.ts && git commit -m "$(cat <<'EOF'
feat(roster): arquivado sai do prompt, do mapa e da vista

Pessoa, dominio e squad ganham arquivado/arquivadoEm. Helpers de turno,
Mochila, prompt e slots passam a ver so ativos; os de unicidade de id
continuam vendo tudo, porque o arquivado nunca sai da arvore e o id dele
nao pode voltar para outra pessoa.

A vista entrega dominios e squads ativos nos mesmos campos de antes e o
arquivado a parte, para GameMap e seletor nao precisarem saber que existe
arquivamento. Squad arquivada pedida por id e SquadArquivada, filha de
SquadInexistente: a UI faz o mesmo gesto. rosterTree mostra o escopo em
bloco, preparado para o treino de 1500 caracteres.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 2: Editar, arquivar e reativar (`server/ciclo-de-vida.ts`) + hire estendido e substituição de PO

**Files:**
- Create: `server/ciclo-de-vida.ts`
- Modify: `server/hire.ts`
- Test: `$SCRATCH/fase2/ciclo.ts`

**Interfaces:**
- Consumes (Task 1): `LIMITES`, `textoDeUmaLinha`, `normalizarEscopo`, `limitar`, `ativo`, `squadsAtivas`, `dominiosAtivos`, `integrantesAtivos`, `localizarPessoa`, `localizarDominio`, `localizarSquad`, `aposentarIds`, `proximoSlot`, `paraVista`, `salaPara`, `slug`, `atualizarRoster`, `acharDominio`, `resolverSquad`, erros.
- Produces (Tasks 4, 6, 7):
  - `ciclo-de-vida.ts`:
    - `interface ResultadoDoRoster { roster: RosterView }`;
    - `textoRevisado(valor: string, campo: string, max: number, multilinha?: boolean): string`;
    - `editarPessoa(pessoaId: string, corpo: unknown)`, `editarDominio(dominioId: string, corpo: unknown)`, `editarSquad(squadId: string, corpo: unknown)`;
    - `arquivarPessoa(id: string)`, `reativarPessoa(id: string)`, `arquivarDominio(id: string)`, `reativarDominio(id: string)`, `arquivarSquad(id: string)`, `reativarSquad(id: string)`;
    - todas devolvem `Promise<ResultadoDoRoster>`.
  - `hire.ts`:
    - `aplicarContratacao` aceita `sugestao.escopo_po?`;
    - `interface SubstituicaoResult { roster: RosterView; po: Pessoa; anterior: Pessoa }`;
    - `substituirPo(dominioId: string, corpo: unknown): Promise<SubstituicaoResult>`.

- [ ] **Step 0: Reler**

Releia `server/hire.ts` e `server/squad.ts`, este já com a Task 1. Confirme que `aplicarContratacao` e `criarSquad` estão como a Fase 1 deixou: `texto()` lançando `PedidoInvalido`, `nomeEscolhido`, `novaPessoa`.

- [ ] **Step 1: Escrever o script**

`$SCRATCH/fase2/ciclo.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { f2, importar, lerRoster, prepararDiretorio, REPO, rejeitaCom, txt } from "./harness.ts";

const cenario = process.argv[2];

/** Todos os ids do roster (squads, domínios, pessoas), ordenados: ids nunca mudam. */
const idsDe = (r: any): string[] =>
  r.squads
    .flatMap((s: any) => [s.id, ...s.dominios.flatMap((d: any) => [d.id, d.po.id, ...d.integrantes.map((p: any) => p.id)])])
    .sort();
const casaNoDisco = (r: any) => r.squads[0].dominios.find((d: any) => d.id === "casa");
const dominioNoDisco = (r: any, id: string) => r.squads.flatMap((s: any) => s.dominios).find((d: any) => d.id === id);
const novoDominio = (squad_id: string, dominio: string, extra: Record<string, unknown> = {}) => ({
  kind: "dominio", squad_id, dominio, papel_po: `PO ${dominio}`, escopo: dominio.toLowerCase(), ...extra,
});

async function main() {
  if (cenario === "copia-real") {
    let texto: string;
    try { texto = await fs.readFile(path.join(REPO, "data", "squad.json"), "utf8"); } catch { console.log("SKIP copia-real (sem data/squad.json)"); return; }
    const dir = await prepararDiretorio(texto);
    const sq = await importar("server/squad.ts");
    const ciclo = await importar("server/ciclo-de-vida.ts");
    const antes = await sq.readRoster();
    const r = await ciclo.editarSquad(antes.squads[0].id, { escopo: "teste da cópia" });
    assert.equal(r.roster.squads[0].escopo, "teste da cópia");
    assert.deepEqual(idsDe(await lerRoster(dir)), idsDe(antes));
    console.log("OK copia-real");
    return;
  }

  const dir = await prepararDiretorio(txt(f2()));
  const ciclo = await importar("server/ciclo-de-vida.ts");
  const hire = await importar("server/hire.ts");

  switch (cenario) {
    case "editar": {
      const antes = idsDe(await lerRoster(dir));
      const longo = "Missão: x\n" + "a".repeat(1490);
      assert.equal(longo.length, 1500);
      const r1 = await ciclo.editarPessoa("ana", { papel: "Contadora PJ", escopo: longo });
      const ana = r1.roster.squads[0].dominios[0].integrantes[0];
      assert.equal(ana.papel, "Contadora PJ");
      assert.equal(ana.escopo.length, 1500);
      await rejeitaCom(ciclo.editarPessoa("ana", { escopo: longo + "b" }), "PedidoInvalido", "1500");
      await rejeitaCom(ciclo.editarPessoa("ana", { id: "x" }), "PedidoInvalido", "Ids nunca mudam");
      await rejeitaCom(ciclo.editarPessoa("ana", {}), "PedidoInvalido");
      await rejeitaCom(ciclo.editarPessoa("ana", { papel: "   " }), "PedidoInvalido");
      await rejeitaCom(ciclo.editarPessoa("ana", { papel: 7 }), "PedidoInvalido");
      await rejeitaCom(ciclo.editarPessoa("ana", { nome: "Outra" }), "PedidoInvalido");
      await rejeitaCom(ciclo.editarPessoa("zzz", { papel: "x" }), "ConflitoDeRoster");
      await ciclo.editarPessoa("romulo", { escopo: "Missão: tudo" }); // PO também se edita
      await rejeitaCom(ciclo.editarDominio("pessoal--financeiro", { nome: "Casa" }), "ConflitoDeRoster");
      const r2 = await ciclo.editarDominio("pessoal--financeiro", { nome: "Finanças", escopo: "contas\ne impostos" });
      const fin = r2.roster.squads[0].dominios.find((d: any) => d.id === "pessoal--financeiro");
      assert.equal(fin.nome, "Finanças");
      assert.equal(fin.escopo, "contas e impostos");
      await rejeitaCom(ciclo.editarDominio("casa", { escopo: "x".repeat(201) }), "PedidoInvalido");
      const r3 = await ciclo.editarSquad("pessoal", { escopo: "minha vida" });
      assert.equal(r3.roster.squads[0].escopo, "minha vida");
      await rejeitaCom(ciclo.editarSquad("pay4fun", { nome: "Pessoal" }), "ConflitoDeRoster");
      await ciclo.editarSquad("pay4fun", { nome: "PAY4FUN" }); // mesmo slug do próprio id: não conflita consigo
      await rejeitaCom(ciclo.editarSquad("pay4fun", { calendarId: "x" }), "PedidoInvalido");
      assert.deepEqual(idsDe(await lerRoster(dir)), antes);
      break;
    }
    case "arquivar-integrante": {
      const a = await ciclo.arquivarPessoa("ana");
      let disco = await lerRoster(dir);
      const ana = casaNoDisco(disco).integrantes[0];
      assert.equal(ana.arquivado, true);
      assert.ok(!Number.isNaN(Date.parse(ana.arquivadoEm)));
      assert.equal(a.roster.squads[0].dominios[0].integrantes.length, 0);
      assert.equal(a.roster.squads[0].arquivo.integrantes[0].pessoa.id, "ana");
      await ciclo.arquivarPessoa("ana"); // idempotente
      disco = await lerRoster(dir);
      assert.deepEqual(disco.idsAposentados.pessoas, ["ana"]);
      await rejeitaCom(ciclo.arquivarPessoa("romulo"), "ConflitoDeRoster", "substitu");
      await rejeitaCom(ciclo.arquivarPessoa("zzz"), "ConflitoDeRoster");
      const b = await ciclo.reativarPessoa("ana");
      assert.equal(b.roster.squads[0].dominios[0].integrantes.length, 1);
      disco = await lerRoster(dir);
      assert.equal("arquivado" in casaNoDisco(disco).integrantes[0], false);
      assert.equal("arquivadoEm" in casaNoDisco(disco).integrantes[0], false);
      assert.deepEqual(disco.idsAposentados.pessoas, ["ana"], "reativar não tira de idsAposentados");
      await rejeitaCom(ciclo.reativarPessoa("romulo"), "ConflitoDeRoster");
      break;
    }
    case "arquivar-dominio": {
      const leo = await hire.aplicarContratacao(
        { kind: "integrante", squad_id: "pessoal", dominio_id: "pessoal--financeiro", papel: "QA", escopo: "testes" }, "Leo",
      );
      assert.equal(leo.pessoa.id, "leo");
      await ciclo.arquivarPessoa("leo");
      const r = await ciclo.arquivarDominio("pessoal--financeiro");
      const disco = await lerRoster(dir);
      assert.equal(dominioNoDisco(disco, "pessoal--financeiro").arquivado, true);
      assert.deepEqual(disco.idsAposentados.dominios, ["pessoal--financeiro"]);
      assert.ok(disco.idsAposentados.pessoas.includes("fin") && disco.idsAposentados.pessoas.includes("leo"));
      assert.deepEqual(r.roster.squads[0].dominios.map((d: any) => d.id), ["casa"]);
      assert.equal(r.roster.squads[0].arquivo.dominios[0].id, "pessoal--financeiro");
      assert.deepEqual(r.roster.squads[0].proximoSlot, [1, 0]);
      await rejeitaCom(ciclo.arquivarDominio("casa"), "ConflitoDeRoster", "raiz");
      await rejeitaCom(ciclo.reativarPessoa("leo"), "ConflitoDeRoster", "domínio");
      await rejeitaCom(
        hire.aplicarContratacao({ kind: "integrante", squad_id: "pessoal", dominio_id: "pessoal--financeiro", papel: "QA", escopo: "t" }),
        "ConflitoDeRoster", "arquivado",
      );
      break;
    }
    case "reativar-dominio": {
      await ciclo.arquivarDominio("pessoal--financeiro");
      const saude = await hire.aplicarContratacao(novoDominio("pessoal", "Saúde"));
      assert.deepEqual(saude.dominio.slot, [1, 0]);
      let r = await ciclo.reativarDominio("pessoal--financeiro");
      assert.deepEqual(r.roster.squads[0].dominios.find((d: any) => d.id === "pessoal--financeiro").slot, [0, 1]);
      assert.equal("arquivado" in dominioNoDisco(await lerRoster(dir), "pessoal--financeiro"), false);
      await ciclo.reativarDominio("pessoal--financeiro"); // idempotente
      // Slot antigo livre tem preferência sobre o primeiro livre da ordem.
      await ciclo.arquivarDominio("pessoal--saude");       // libera [1,0]
      await ciclo.arquivarDominio("pessoal--financeiro");  // libera [0,1]
      r = await ciclo.reativarDominio("pessoal--financeiro");
      assert.deepEqual(r.roster.squads[0].dominios.find((d: any) => d.id === "pessoal--financeiro").slot, [0, 1]);
      break;
    }
    case "sem-sala": {
      await ciclo.arquivarDominio("pessoal--financeiro");
      for (const nome of ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"]) {
        await hire.aplicarContratacao(novoDominio("pessoal", nome));
      }
      await rejeitaCom(ciclo.reativarDominio("pessoal--financeiro"), "ConflitoDeRoster", "sala livre");
      break;
    }
    case "squad": {
      await hire.aplicarContratacao(novoDominio("pay4fun", "Ops"));
      await ciclo.arquivarDominio("pay4fun--ops");
      const a = await ciclo.arquivarSquad("pay4fun");
      assert.equal(a.roster.squads.length, 1);
      assert.equal(a.roster.squadsArquivadas[0].id, "pay4fun");
      await ciclo.arquivarSquad("pay4fun"); // idempotente
      await rejeitaCom(ciclo.arquivarSquad("pessoal"), "ConflitoDeRoster", "última");
      await rejeitaCom(ciclo.reativarDominio("pay4fun--ops"), "ConflitoDeRoster", "squad");
      await rejeitaCom(
        hire.aplicarContratacao({ kind: "integrante", squad_id: "pay4fun", dominio_id: "pay4fun--geral", papel: "QA", escopo: "t" }),
        "SquadArquivada",
      );
      await rejeitaCom(hire.criarSquad({ nome: "Pay4Fun", escopo: "x", papel_po: "PO" }), "ConflitoDeRoster", "arquivada");
      const b = await ciclo.reativarSquad("pay4fun");
      assert.equal(b.roster.squads.length, 2);
      assert.equal("arquivado" in (await lerRoster(dir)).squads[1], false);
      await rejeitaCom(ciclo.arquivarSquad("nao-existe"), "ConflitoDeRoster");
      break;
    }
    case "substituir-po": {
      const r = await hire.substituirPo("casa", { nome: "Bruno", papel: "PO Casa", escopo: "Missão: casa" });
      assert.equal(r.anterior.id, "romulo");
      assert.equal(r.po.id, "bruno");
      let disco = await lerRoster(dir);
      let casa = casaNoDisco(disco);
      assert.equal(casa.po.id, "bruno");
      assert.equal(casa.integrantes.at(-1).id, "romulo");
      assert.equal(casa.integrantes.at(-1).arquivado, true);
      assert.ok(disco.idsAposentados.pessoas.includes("romulo"));
      assert.deepEqual(r.roster.squads[0].dominios[0].integrantes.map((p: any) => p.id), ["ana"]);
      assert.ok(r.roster.squads[0].arquivo.integrantes.some((i: any) => i.pessoa.id === "romulo"));
      await rejeitaCom(hire.substituirPo("casa", { integranteId: "fin" }), "ConflitoDeRoster");
      await rejeitaCom(hire.substituirPo("casa", { integranteId: "ana", papel: "x" }), "PedidoInvalido");
      await rejeitaCom(hire.substituirPo("casa", { papel: "x" }), "PedidoInvalido");
      await rejeitaCom(hire.substituirPo("casa", {}), "PedidoInvalido");
      await rejeitaCom(hire.substituirPo("casa", { papel: "x", escopo: "y".repeat(1501) }), "PedidoInvalido");
      await rejeitaCom(hire.substituirPo("nao-existe", { integranteId: "ana" }), "ConflitoDeRoster");
      const p = await hire.substituirPo("casa", { integranteId: "ana" });
      assert.equal(p.po.id, "ana");
      assert.equal(p.anterior.id, "bruno");
      disco = await lerRoster(dir);
      casa = casaNoDisco(disco);
      assert.deepEqual(casa.integrantes.map((x: any) => [x.id, x.arquivado]), [["romulo", true], ["bruno", true]]);
      await rejeitaCom(hire.substituirPo("casa", { integranteId: "romulo" }), "ConflitoDeRoster");
      await ciclo.reativarPessoa("romulo"); // ex-PO volta como integrante
      assert.equal("arquivado" in casaNoDisco(await lerRoster(dir)).integrantes[0], false);
      break;
    }
    case "hire-estendido": {
      const i = await hire.aplicarContratacao({ kind: "integrante", squad_id: "pessoal", dominio_id: "casa", papel: "QA", escopo: "x".repeat(2000) });
      assert.equal(i.pessoa.escopo.length, 1500);
      const d = await hire.aplicarContratacao(novoDominio("pessoal", "Saúde", {
        escopo: "saúde\ne\nbem-estar", escopo_po: "Missão: s\n" + "y".repeat(3000),
      }));
      assert.equal(d.dominio.escopo, "saúde e bem-estar");
      assert.ok(d.pessoa.escopo.length <= 1500);
      assert.ok(d.pessoa.escopo.startsWith("Missão: s"));
      const d2 = await hire.aplicarContratacao(novoDominio("pessoal", "Lazer"));
      assert.equal(d2.pessoa.escopo, "lazer");
      await ciclo.arquivarDominio("pessoal--saude");
      await rejeitaCom(
        hire.aplicarContratacao({ kind: "integrante", squad_id: "pessoal", dominio_id: "pessoal--saude", papel: "QA", escopo: "t" }),
        "ConflitoDeRoster", "arquivado",
      );
      await rejeitaCom(hire.aplicarContratacao(novoDominio("pessoal", "Saúde")), "ConflitoDeRoster", "reative");
      break;
    }
    case "concorrencia": {
      await Promise.all([
        ciclo.arquivarPessoa("ana"),
        ciclo.editarPessoa("romulo", { papel: "Chefe" }),
        ciclo.editarSquad("pessoal", { escopo: "vida" }),
      ]);
      const disco = await lerRoster(dir);
      assert.equal(casaNoDisco(disco).integrantes[0].arquivado, true);
      assert.equal(casaNoDisco(disco).po.papel, "Chefe");
      assert.equal(disco.squads[0].escopo, "vida");
      const sobras = (await fs.readdir(path.join(dir, "data"))).filter((f) => f.endsWith(".tmp"));
      assert.deepEqual(sobras, []);
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
cd "$SCRATCH/fase2" && for c in editar arquivar-integrante arquivar-dominio reativar-dominio sem-sala squad substituir-po hire-estendido concorrencia copia-real; do npx tsx ciclo.ts $c || break; done
```

Esperado: `FALHOU editar`, porque o módulo `server/ciclo-de-vida.ts` ainda não existe.

- [ ] **Step 3: Criar `server/ciclo-de-vida.ts`**

```ts
/**
 * Ciclo de vida do roster (spec Fase 2 §4.4–§4.7): editar, arquivar e reativar
 * pessoa, domínio e squad.
 *
 * Nada aqui apaga. Arquivar marca e tira do prompt, do mapa e da vista; o
 * registro fica na árvore com o id reservado, e reativar devolve tudo como era.
 * Nada aqui toca o Google: os eventos continuam onde estão, com as marcas
 * originais — é isso que permite reativar sem migrar nada.
 *
 * Toda mutação dentro de `atualizarRoster`. Validação de FORMA roda antes da
 * fila (400 sem esperar escritor nenhum); validação de ESTADO roda dentro,
 * contra o roster lido na vez dela (409).
 */

import {
  aposentarIds,
  atualizarRoster,
  ativo,
  ConflitoDeRoster,
  dominiosAtivos,
  integrantesAtivos,
  LIMITES,
  localizarDominio,
  localizarPessoa,
  localizarSquad,
  normalizarEscopo,
  paraVista,
  PedidoInvalido,
  proximoSlot,
  salaPara,
  slug,
  squadsAtivas,
  textoDeUmaLinha,
  type Roster,
  type RosterView,
} from "./squad.ts";

export interface ResultadoDoRoster {
  roster: RosterView;
}

function objeto(corpo: unknown): Record<string, unknown> {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new PedidoInvalido("O corpo deve ser um objeto JSON.");
  }
  return corpo as Record<string, unknown>;
}

/**
 * Só os campos editáveis, todos texto. Chave desconhecida é 400, não ignorada:
 * um `id` no corpo é alguém achando que dá para renomear o id, e ignorar calado
 * deixaria achar que deu.
 */
function camposEditaveis(corpo: unknown, permitidos: readonly string[]): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(objeto(corpo))) {
    if (!permitidos.includes(chave)) {
      throw new PedidoInvalido(
        chave === "id"
          ? "Ids nunca mudam: 'id' não é editável."
          : `Campo '${chave}' não é editável aqui. Editáveis: ${permitidos.join(", ")}.`,
      );
    }
    if (typeof valor !== "string") throw new PedidoInvalido(`Campo '${chave}' deve ser texto.`);
    saida[chave] = valor;
  }
  if (Object.keys(saida).length === 0) {
    throw new PedidoInvalido(`Nada para editar. Editáveis: ${permitidos.join(", ")}.`);
  }
  return saida;
}

/**
 * Texto que o usuário revisou: acima do limite é 400, não corte. Cortar calado
 * perderia justamente o fim do treino que ele acabou de escrever.
 */
export function textoRevisado(valor: string, campo: string, max: number, multilinha = false): string {
  const v = multilinha ? normalizarEscopo(valor) : textoDeUmaLinha(valor);
  if (!v) throw new PedidoInvalido(`Campo '${campo}' não pode ficar vazio.`);
  if (v.length > max) {
    throw new PedidoInvalido(`Campo '${campo}' tem ${v.length} caracteres; o máximo é ${max}.`);
  }
  return v;
}

function exigirPessoa(roster: Roster, id: string) {
  const achada = localizarPessoa(roster, id);
  if (!achada) throw new ConflitoDeRoster(`A pessoa '${id}' não existe.`);
  return achada;
}

function exigirDominio(roster: Roster, id: string) {
  const achado = localizarDominio(roster, id);
  if (!achado) throw new ConflitoDeRoster(`O domínio '${id}' não existe.`);
  return achado;
}

function exigirSquad(roster: Roster, id: string) {
  const achada = localizarSquad(roster, id);
  if (!achada) throw new ConflitoDeRoster(`A squad '${id}' não existe.`);
  return achada;
}

function marcarArquivado(x: { arquivado?: boolean; arquivadoEm?: string }): void {
  x.arquivado = true;
  x.arquivadoEm = new Date().toISOString();
}

/** Apaga as chaves em vez de gravar `false`: o JSON do ativo fica igual ao de antes da Fase 2. */
function desmarcarArquivado(x: { arquivado?: boolean; arquivadoEm?: string }): void {
  delete x.arquivado;
  delete x.arquivadoEm;
}

const vista = (roster: Roster): ResultadoDoRoster => ({ roster: paraVista(roster) });

// --- Editar -----------------------------------------------------------------

/** Papel e escopo de PO ou integrante, ativo ou arquivado. O nome não é editável nesta fase. */
export async function editarPessoa(pessoaId: string, corpo: unknown): Promise<ResultadoDoRoster> {
  const c = camposEditaveis(corpo, ["papel", "escopo"]);
  const papel = c.papel === undefined ? undefined : textoRevisado(c.papel, "papel", LIMITES.papel);
  const escopo = c.escopo === undefined ? undefined : textoRevisado(c.escopo, "escopo", LIMITES.escopoPessoa, true);
  return atualizarRoster((roster) => {
    const { pessoa } = exigirPessoa(roster, pessoaId);
    if (papel !== undefined) pessoa.papel = papel;
    if (escopo !== undefined) pessoa.escopo = escopo;
    return vista(roster);
  });
}

export async function editarDominio(dominioId: string, corpo: unknown): Promise<ResultadoDoRoster> {
  const c = camposEditaveis(corpo, ["nome", "escopo"]);
  const nome = c.nome === undefined ? undefined : textoRevisado(c.nome, "nome", LIMITES.dominioNome);
  const escopo = c.escopo === undefined ? undefined : textoRevisado(c.escopo, "escopo", LIMITES.dominioEscopo);
  return atualizarRoster((roster) => {
    const { squad, dominio } = exigirDominio(roster, dominioId);
    if (nome !== undefined) {
      // Mesma regra da criação (novoIdDeDominio): dois domínios com o mesmo nome
      // na mesma squad são engano. Arquivado conta, senão reativá-lo depois
      // criaria a duplicata.
      const outro = squad.dominios.find((d) => d !== dominio && slug(d.nome) === slug(nome));
      if (outro) {
        throw new ConflitoDeRoster(
          ativo(outro)
            ? `Já existe o domínio '${outro.nome}' na squad '${squad.nome}'.`
            : `O domínio '${outro.nome}' existe arquivado na squad '${squad.nome}': reative-o ou escolha outro nome.`,
        );
      }
      dominio.nome = nome;
    }
    if (escopo !== undefined) dominio.escopo = escopo;
    return vista(roster);
  });
}

/** Vale também para a squad `pessoal`, cujo escopo a migração fixou. O id nunca muda. */
export async function editarSquad(squadId: string, corpo: unknown): Promise<ResultadoDoRoster> {
  const c = camposEditaveis(corpo, ["nome", "escopo"]);
  const nome = c.nome === undefined ? undefined : textoRevisado(c.nome, "nome", LIMITES.squadNome);
  const escopo = c.escopo === undefined ? undefined : textoRevisado(c.escopo, "escopo", LIMITES.squadEscopo);
  return atualizarRoster((roster) => {
    const squad = exigirSquad(roster, squadId);
    if (nome !== undefined) {
      // O id de uma squad nasce do slug do nome. Renomear para o slug de OUTRA
      // deixaria duas entradas indistinguíveis no seletor.
      const alvo = slug(nome);
      const outra = roster.squads.find((s) => s !== squad && (s.id === alvo || slug(s.nome) === alvo));
      if (outra) {
        throw new ConflitoDeRoster(
          ativo(outra)
            ? `Já existe a squad '${outra.nome}'.`
            : `A squad '${outra.nome}' existe arquivada: reative-a ou escolha outro nome.`,
        );
      }
      squad.nome = nome;
    }
    if (escopo !== undefined) squad.escopo = escopo;
    return vista(roster);
  });
}

// --- Pessoa -----------------------------------------------------------------

export async function arquivarPessoa(pessoaId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const { pessoa, dominio, posicao } = exigirPessoa(roster, pessoaId);
    // Toda sala precisa de dono: o PO raiz circula pelo escritório e um domínio
    // sem PO não tem a quem rotear. Por isso PO se substitui (hire.substituirPo).
    if (posicao === "po") {
      throw new ConflitoDeRoster(
        `'${pessoa.nome}' é o PO do domínio '${dominio.nome}': PO não se arquiva, substitua-o.`,
      );
    }
    if (!ativo(pessoa)) return vista(roster); // duplo clique não é erro
    marcarArquivado(pessoa);
    aposentarIds(roster, { pessoas: [pessoa.id] });
    return vista(roster);
  });
}

export async function reativarPessoa(pessoaId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const { pessoa, dominio, squad, posicao } = exigirPessoa(roster, pessoaId);
    if (posicao === "po") {
      throw new ConflitoDeRoster(`'${pessoa.nome}' é PO e nunca é arquivado: não há o que reativar.`);
    }
    // Pai arquivado: a pessoa continuaria fora do escritório mesmo sem a marca,
    // e o botão pareceria não ter feito nada.
    if (!ativo(squad)) {
      throw new ConflitoDeRoster(`A squad '${squad.nome}' está arquivada: reative a squad antes.`);
    }
    if (!ativo(dominio)) {
      throw new ConflitoDeRoster(`O domínio '${dominio.nome}' está arquivado: reative o domínio antes.`);
    }
    if (ativo(pessoa)) return vista(roster);
    desmarcarArquivado(pessoa);
    // A sala só promove, e só por quem está ativo: arquivado não ocupa cadeira.
    dominio.room = salaPara(1 + integrantesAtivos(dominio).length, dominio.room);
    return vista(roster);
  });
}

// --- Domínio ----------------------------------------------------------------

export async function arquivarDominio(dominioId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const { squad, dominio } = exigirDominio(roster, dominioId);
    // dominios[0] é o domínio raiz: o PO dele é quem circula pelo escritório
    // (GameMap) e a squad precisa de ≥1 domínio ativo. Nunca arquivando a raiz,
    // não é preciso regra de sucessão.
    if (squad.dominios[0] === dominio) {
      throw new ConflitoDeRoster(
        `'${dominio.nome}' é o domínio raiz da squad '${squad.nome}': não pode ser arquivado. ` +
          `Arquive a squad inteira ou substitua o PO dele.`,
      );
    }
    if (!ativo(dominio)) return vista(roster);
    marcarArquivado(dominio);
    aposentarIds(roster, {
      dominios: [dominio.id],
      pessoas: [dominio.po.id, ...dominio.integrantes.map((p) => p.id)],
    });
    return vista(roster);
  });
}

export async function reativarDominio(dominioId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const { squad, dominio } = exigirDominio(roster, dominioId);
    if (!ativo(squad)) {
      throw new ConflitoDeRoster(`A squad '${squad.nome}' está arquivada: reative a squad antes.`);
    }
    if (ativo(dominio)) return vista(roster);
    // O slot antigo, se livre, devolve a sala ao lugar onde o usuário a
    // conhecia. Ocupado por quem entrou depois, vai para o primeiro livre.
    const ocupados = new Set(dominiosAtivos(squad).map((d) => d.slot.join(",")));
    const slot = ocupados.has(dominio.slot.join(",")) ? proximoSlot(squad) : dominio.slot;
    if (!slot) {
      throw new ConflitoDeRoster(
        `A squad '${squad.nome}' não tem sala livre: arquive outro domínio antes de reativar '${dominio.nome}'.`,
      );
    }
    dominio.slot = [slot[0], slot[1]];
    desmarcarArquivado(dominio);
    return vista(roster);
  });
}

// --- Squad ------------------------------------------------------------------

export async function arquivarSquad(squadId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const squad = exigirSquad(roster, squadId);
    if (!ativo(squad)) return vista(roster);
    // Sem squad ativa não há escritório para abrir nem para onde mandar demanda.
    if (squadsAtivas(roster).length <= 1) {
      throw new ConflitoDeRoster(`'${squad.nome}' é a última squad ativa: não pode ser arquivada.`);
    }
    // Domínios e pessoas NÃO são marcados: ao reativar, a squad volta como estava.
    marcarArquivado(squad);
    return vista(roster);
  });
}

export async function reativarSquad(squadId: string): Promise<ResultadoDoRoster> {
  return atualizarRoster((roster) => {
    const squad = exigirSquad(roster, squadId);
    if (ativo(squad)) return vista(roster);
    desmarcarArquivado(squad);
    return vista(roster);
  });
}
```

- [ ] **Step 4: Estender `server/hire.ts`**

1. Imports de `./squad.ts`: acrescente `aposentarIds`, `ativo`, `dominiosAtivos`, `integrantesAtivos`, `LIMITES`, `limitar`, `localizarDominio`, `normalizarEscopo`, `textoDeUmaLinha`. Novo import: `import { textoRevisado } from "./ciclo-de-vida.ts";` (`ciclo-de-vida.ts` não importa `hire.ts`, então não há ciclo).

2. Depois de `texto()`, que continua servindo `criarSquad`:

```ts
/** Linha que veio de card do modelo ou do formulário: uma linha, cortada no limite. */
function linha(valor: unknown, campo: string, max: number): string {
  const v = textoDeUmaLinha(String(valor ?? ""));
  if (!v) throw new PedidoInvalido(`Campo '${campo}' é obrigatório.`);
  return v.slice(0, max);
}

/**
 * Treino (escopo de pessoa) de card ou formulário: normalizado e cortado em
 * 1500. Corta em vez de recusar porque o texto dos cards vem do modelo e pode
 * passar; o formulário já respeita o limite antes de enviar.
 */
function treino(valor: unknown, campo: string): string {
  const v = normalizarEscopo(String(valor ?? ""));
  if (!v) throw new PedidoInvalido(`Campo '${campo}' é obrigatório.`);
  return limitar(v, LIMITES.escopoPessoa).texto;
}
```

3. Em `aplicarContratacao`, ramo `dominio`, troque as três leituras por:

```ts
      const nomeDominio = linha(sugestao.dominio, "sugestao.dominio", LIMITES.dominioNome);
      // Escopo do DOMÍNIO é uma linha de roteamento (vai inline na árvore).
      const escopo = linha(sugestao.escopo, "sugestao.escopo", LIMITES.dominioEscopo);
      const papelPo = linha(sugestao.papel_po, "sugestao.papel_po", LIMITES.papel);
      // escopo_po é o treino do PO. Ausente = o escopo do domínio, que é o que
      // os cards do modelo mandam: eles continuam funcionando sem mudança.
      const semEscopoPo = sugestao.escopo_po === undefined || sugestao.escopo_po === null || sugestao.escopo_po === "";
      const escopoPo = semEscopoPo ? escopo : treino(sugestao.escopo_po, "sugestao.escopo_po");
```

   e, no `novaPessoa` do PO, use `escopo: escopoPo`.

4. Ramo `integrante`: troque as leituras e o bloco de domínio inexistente por:

```ts
    const papel = linha(sugestao.papel, "sugestao.papel", LIMITES.papel);
    const escopo = treino(sugestao.escopo, "sugestao.escopo");
    const dominio = acharDominio(squad, sugestao.dominio_id);
    if (!dominio) {
      // acharDominio só vê ativos. Distinguir o arquivado diz ao usuário o gesto
      // certo (reativar) em vez de "não existe", que parece bug.
      const arquivado = squad.dominios.find((d) => d.id === sugestao.dominio_id);
      if (arquivado) {
        throw new ConflitoDeRoster(
          `O domínio '${arquivado.nome}' está arquivado: reative-o no Arquivo antes de contratar.`,
        );
      }
      const ids = dominiosAtivos(squad).map((d) => d.id).join(", ");
      throw new ConflitoDeRoster(
        `dominio_id '${String(sugestao.dominio_id)}' não existe na squad '${squad.nome}'. Domínios: ${ids}.`,
      );
    }
```

   A promoção da sala passa a ser `dominio.room = salaPara(1 + integrantesAtivos(dominio).length, dominio.room);`. Mantenha o comentário atual e acrescente "arquivado não ocupa cadeira".

5. Ao fim do arquivo:

```ts
export interface SubstituicaoResult {
  roster: RosterView;
  po: Pessoa;
  anterior: Pessoa;
}

/**
 * PO não é demitido, é substituído (spec Fase 2 §4.8): o domínio nunca fica sem
 * dono. O anterior vira integrante ARQUIVADO do mesmo domínio — continua na
 * árvore, com o id reservado, os eventos dele seguem com o mesmo
 * `squadone_membro`, e ele pode voltar como integrante pelo Arquivo.
 */
export async function substituirPo(dominioId: string, corpo: unknown): Promise<SubstituicaoResult> {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new PedidoInvalido("O corpo deve ser um objeto JSON.");
  }
  const b = corpo as Record<string, unknown>;
  const promover = "integranteId" in b;
  const pessoaNova = ["nome", "papel", "escopo"].some((k) => k in b);
  if (promover === pessoaNova) {
    throw new PedidoInvalido(
      "Mande 'integranteId' (promover integrante) OU 'papel' e 'escopo' (pessoa nova): exatamente uma das formas.",
    );
  }

  let integranteId = "";
  let nova: { nome: unknown; papel: string; escopo: string } | null = null;
  if (promover) {
    if (typeof b.integranteId !== "string" || !b.integranteId) {
      throw new PedidoInvalido("Campo 'integranteId' deve ser texto.");
    }
    integranteId = b.integranteId;
  } else {
    if (typeof b.papel !== "string" || typeof b.escopo !== "string") {
      throw new PedidoInvalido("Campos 'papel' e 'escopo' são obrigatórios e devem ser texto.");
    }
    if (b.nome !== undefined && typeof b.nome !== "string") {
      throw new PedidoInvalido("Campo 'nome' deve ser texto.");
    }
    nova = {
      nome: b.nome,
      papel: textoRevisado(b.papel, "papel", LIMITES.papel),
      escopo: textoRevisado(b.escopo, "escopo", LIMITES.escopoPessoa, true),
    };
  }

  return atualizarRoster((roster) => {
    const achado = localizarDominio(roster, dominioId);
    if (!achado) throw new ConflitoDeRoster(`O domínio '${dominioId}' não existe.`);
    const { squad, dominio } = achado;
    if (!ativo(squad) || !ativo(dominio)) {
      throw new ConflitoDeRoster(
        `O domínio '${dominio.nome}' ou a squad '${squad.nome}' está arquivado: reative antes de substituir o PO.`,
      );
    }
    const agora = new Date().toISOString();
    const anterior = dominio.po;

    let po: Pessoa;
    if (nova) {
      // Id calculado com o anterior ainda na árvore: não há como colidir com ele.
      po = novaPessoa(roster, { nome: nomeEscolhido(roster, nova.nome), papel: nova.papel, escopo: nova.escopo }, agora);
    } else {
      const indice = dominio.integrantes.findIndex((p) => p.id === integranteId && ativo(p));
      if (indice < 0) {
        throw new ConflitoDeRoster(`'${integranteId}' não é integrante ativo do domínio '${dominio.nome}'.`);
      }
      [po] = dominio.integrantes.splice(indice, 1);
    }

    anterior.arquivado = true;
    anterior.arquivadoEm = agora;
    dominio.integrantes.push(anterior);
    dominio.po = po;
    aposentarIds(roster, { pessoas: [anterior.id] });
    dominio.room = salaPara(1 + integrantesAtivos(dominio).length, dominio.room);
    return { roster: paraVista(roster), po, anterior };
  });
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd "$SCRATCH/fase2" && for c in editar arquivar-integrante arquivar-dominio reativar-dominio sem-sala squad substituir-po hire-estendido concorrencia copia-real; do npx tsx ciclo.ts $c || break; done
cd "$SCRATCH/fase2" && for c in ativos vista resolver arvore texto localizar-e-aposentar troca-arquivada; do npx tsx roster.ts $c || break; done
```

Esperado: 10 linhas `OK` (ou `SKIP copia-real`) seguidas de 7 `OK`.

- [ ] **Step 6: Typecheck, build e garantias**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build && ! grep -n "fetch(\|calendar.ts" server/ciclo-de-vida.ts
```

Esperado: typecheck e build sem erros; grep sem saída.

- [ ] **Step 7: Commit**

```bash
cd "$REPO" && git add server/ciclo-de-vida.ts server/hire.ts && git commit -m "$(cat <<'EOF'
feat(roster): editar, arquivar, reativar e substituir PO

Pessoa, dominio e squad ganham edicao de texto (ids nunca mudam) e
arquivamento reversivel. Arquivar grava idsAposentados pela primeira vez;
reativar nao tira de la, porque o id so volta para o proprio dono. Dominio
raiz e ultima squad ativa nao se arquivam; reativar dominio tenta o slot
antigo e, ocupado, o primeiro livre.

PO nao e demitido: substituir promove um integrante ou contrata alguem, e
o anterior vira integrante arquivado com os eventos intactos no Google.
Hire aceita escopo de 1500 e escopo_po separado do escopo do dominio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Redação do treino (`server/redacao.ts`) e viés do prompt de crescimento

**Files:**
- Create: `server/redacao.ts`
- Modify: `server/orchestrator.ts` (exportar `gerarComRetry`; bloco de crescimento)
- Modify: `server/capabilities.ts` (descrições de `criar_po_dominio` e `contratar_integrante`)
- Test: `$SCRATCH/fase2/redacao.ts`, `$SCRATCH/fase2/prompt.ts`

**Interfaces:**
- Consumes: Task 1 (`LIMITES`, `limitar`, `normalizarEscopo`, `textoDeUmaLinha`, `acharDominio`, `ativo`, `dominiosAtivos`, `integrantesAtivos`, `localizarPessoa`, `resolverSquad`, erros); `orchestrator.ts` (`MODEL`, `ModeloOcupado`).
- Produces (Task 4, 6, 7):
  - `orchestrator.ts`: `export async function gerarComRetry(ai, params, tentativas?)`. A assinatura e o comportamento não mudam.
  - `redacao.ts`:
    - `class RedacaoInvalida extends Error` (`name = "RedacaoInvalida"`);
    - `type PedidoDeRedacao`;
    - `interface RedacaoDePessoa { alvo: "integrante" | "po" | "pessoa"; papel: string; escopo: string; truncado: boolean }`;
    - `interface RedacaoDeDominio { alvo: "dominio"; nome: string; escopo_dominio: string; papel_po: string; escopo_po: string; truncado: boolean }`;
    - `type Redacao = RedacaoDePessoa | RedacaoDeDominio`;
    - `interpretarPedidoDeRedacao(roster: Roster, corpo: unknown): PedidoDeRedacao`;
    - `promptDeRedacao(p: PedidoDeRedacao): string`;
    - `redigirTreino(ai: GoogleGenAI, p: PedidoDeRedacao): Promise<Redacao>`.

- [ ] **Step 0: Reler**

**Releia o código pós-Fase 3.** A Fase 3 (alocador de agenda) aterrissa antes desta e reescreve `agendar_evento`, o turno e partes do prompt em `server/orchestrator.ts` e `server/capabilities.ts`. Rode `git log --oneline -10 -- server/orchestrator.ts server/capabilities.ts` e leia os dois arquivos inteiros: `buildSystemInstruction` e o `ContextoDoPrompt` atual (a Fase 3 acrescenta `janela`), `gerarComRetry`, `MODELOS_RESERVA`, `TRANSITORIO`, `ModeloOcupado`, `MODEL`, `executarTurno` e as `description` de `criar_po_dominio`/`contratar_integrante`. **Não confie em número de linha nem nas assinaturas citadas aqui.** Localize os trechos pelo texto, preserve tudo o que a Fase 3 fez e aplique só as mudanças desta task: exportar `gerarComRetry`, trocar o bloco de crescimento e acrescentar uma frase em duas descrições. Se o bloco de crescimento tiver sido reescrito pela Fase 3, aplique a mesma intenção (§5.1 da spec) sobre o texto novo e ajuste as asserções de `prompt.ts` às frases que você gravou.

- [ ] **Step 1: Script da redação**

`$SCRATCH/fase2/redacao.ts`:

```ts
import assert from "node:assert/strict";
import { f2, importar, lancaCom, prepararDiretorio } from "./harness.ts";

const cenario = process.argv[2];

/** Gemini falso: guarda os parâmetros de cada chamada e responde pelo callback. */
function aiFalso(responder: (params: any) => any) {
  const chamadas: any[] = [];
  const ai = {
    models: {
      generateContent: async (params: any) => {
        chamadas.push(params);
        return responder(params);
      },
    },
  } as any;
  return { ai, chamadas };
}

const ESCOPO = [
  "Missão: cuidar do imposto de renda",
  "Cuida de: IR; notas da PJ",
  "Não cuida de: investimentos",
  "Ao opinar sobre um compromisso: prazo da Receita",
  "Sinais de alerta: multa",
].join("\n");

async function main() {
  await prepararDiretorio();
  const red = await importar("server/redacao.ts");
  const orq = await importar("server/orchestrator.ts");
  const r = f2();
  // Arquivado na casa: não pode aparecer no prompt de redação.
  r.squads[0].dominios[0].integrantes.push({ id: "velho", nome: "Velho", papel: "Arquivista", escopo: "x", sprite: "", hiredAt: "", arquivado: true });

  switch (cenario) {
    case "sucesso-pessoa": {
      const pedido = red.interpretarPedidoDeRedacao(r, { alvo: "integrante", squadId: "pessoal", dominioId: "casa", frase: "alguém para\no meu IR" });
      assert.equal(pedido.frase, "alguém para o meu IR");
      const { ai, chamadas } = aiFalso(() => ({ functionCalls: [{ name: "redigir_pessoa", args: { papel: "  Contador PF ", escopo: ESCOPO } }] }));
      const saida = await red.redigirTreino(ai, pedido);
      assert.deepEqual(saida, { alvo: "integrante", papel: "Contador PF", escopo: ESCOPO, truncado: false });
      assert.equal(chamadas.length, 1);
      const p = chamadas[0];
      assert.equal(p.model, orq.MODEL);
      assert.equal(p.contents, "alguém para o meu IR");
      assert.equal(p.config.toolConfig.functionCallingConfig.mode, "ANY");
      assert.deepEqual(p.config.toolConfig.functionCallingConfig.allowedFunctionNames, ["redigir_pessoa"]);
      assert.deepEqual(p.config.tools[0].functionDeclarations.map((d: any) => d.name), ["redigir_pessoa"]);
      assert.equal(p.config.responseMimeType, undefined, "sem resposta estruturada");
      const s: string = p.config.systemInstruction;
      for (const t of ["'Pessoal'", "'Casa'", "Missão:", "Cuida de:", "Não cuida de:", "Ao opinar sobre um compromisso:", "Sinais de alerta:", "- PO (Rômulo)", "- Contadora (Ana)", "INTEGRANTE novo"]) {
        assert.ok(s.includes(t), `prompt sem '${t}'`);
      }
      assert.ok(!s.includes("Arquivista"), "pessoa arquivada no prompt de redação");
      break;
    }
    case "po-e-pessoa": {
      const { ai, chamadas } = aiFalso(() => ({ functionCalls: [{ name: "redigir_pessoa", args: { papel: "PO Casa", escopo: ESCOPO } }] }));
      await red.redigirTreino(ai, red.interpretarPedidoDeRedacao(r, { alvo: "po", dominioId: "casa", frase: "novo dono da casa" }));
      assert.ok(chamadas[0].config.systemInstruction.includes("NOVO PO"));
      const pessoa = await red.redigirTreino(ai, red.interpretarPedidoDeRedacao(r, { alvo: "pessoa", pessoaId: "ana", frase: "foque em PJ" }));
      assert.equal(pessoa.alvo, "pessoa");
      const s: string = chamadas[1].config.systemInstruction;
      assert.ok(s.includes("REESCRITO de Ana"));
      assert.ok(s.includes("impostos"), "treino atual no prompt");
      break;
    }
    case "sucesso-dominio": {
      const pedido = red.interpretarPedidoDeRedacao(r, { alvo: "dominio", squadId: "pessoal", frase: "cuidar da saúde" });
      const { ai, chamadas } = aiFalso(() => ({
        functionCalls: [{ name: "redigir_dominio", args: { nome: "Saúde", escopo_dominio: "saúde\ne bem-estar", papel_po: "PO Saúde", escopo_po: ESCOPO } }],
      }));
      const saida = await red.redigirTreino(ai, pedido);
      assert.deepEqual(saida, { alvo: "dominio", nome: "Saúde", escopo_dominio: "saúde e bem-estar", papel_po: "PO Saúde", escopo_po: ESCOPO, truncado: false });
      assert.deepEqual(chamadas[0].config.toolConfig.functionCallingConfig.allowedFunctionNames, ["redigir_dominio"]);
      const s: string = chamadas[0].config.systemInstruction;
      for (const t of ["- Casa: casa e família", "- Financeiro: contas", "DOMÍNIO novo", "escopo_dominio", "Sinais de alerta:"]) {
        assert.ok(s.includes(t), `prompt sem '${t}'`);
      }
      break;
    }
    case "truncado": {
      const pedido = red.interpretarPedidoDeRedacao(r, { alvo: "integrante", dominioId: "casa", frase: "x" });
      const { ai } = aiFalso(() => ({ functionCalls: [{ name: "redigir_pessoa", args: { papel: "p".repeat(80), escopo: "Missão: a\n" + "b".repeat(1700) } }] }));
      const saida = await red.redigirTreino(ai, pedido);
      assert.equal(saida.papel.length, 60);
      assert.ok(saida.escopo.length <= 1500);
      assert.equal(saida.truncado, true);
      break;
    }
    case "sem-chamada": {
      const pedido = red.interpretarPedidoDeRedacao(r, { alvo: "integrante", dominioId: "casa", frase: "x" });
      const semCall = aiFalso(() => ({ functionCalls: undefined, text: "blá" }));
      await assert.rejects(red.redigirTreino(semCall.ai, pedido), (e: any) => e.name === "RedacaoInvalida");
      const outroNome = aiFalso(() => ({ functionCalls: [{ name: "redigir_dominio", args: {} }] }));
      await assert.rejects(red.redigirTreino(outroNome.ai, pedido), (e: any) => e.name === "RedacaoInvalida");
      const vazio = aiFalso(() => ({ functionCalls: [{ name: "redigir_pessoa", args: { papel: "QA", escopo: "   " } }] }));
      await assert.rejects(red.redigirTreino(vazio.ai, pedido), (e: any) => e.name === "RedacaoInvalida");
      break;
    }
    case "ocupado": {
      const pedido = red.interpretarPedidoDeRedacao(r, { alvo: "integrante", dominioId: "casa", frase: "x" });
      const { ai, chamadas } = aiFalso(() => { throw new Error("got status: 503 UNAVAILABLE"); });
      await assert.rejects(red.redigirTreino(ai, pedido), (e: any) => e instanceof orq.ModeloOcupado);
      assert.deepEqual(chamadas.map((c) => c.model), [orq.MODEL, orq.MODEL, "gemini-3.5-flash", "gemini-3.5-flash"]);
      break;
    }
    case "erro-gemini": {
      const pedido = red.interpretarPedidoDeRedacao(r, { alvo: "integrante", dominioId: "casa", frase: "x" });
      const { ai, chamadas } = aiFalso(() => { throw new Error("400 INVALID_ARGUMENT API key not valid"); });
      await assert.rejects(red.redigirTreino(ai, pedido), (e: any) => e.name === "RedacaoInvalida" && e.message.includes("INVALID_ARGUMENT"));
      assert.equal(chamadas.length, 1, "erro não transitório não retenta");
      break;
    }
    case "pedido": {
      lancaCom(() => red.interpretarPedidoDeRedacao(r, null), "PedidoInvalido");
      lancaCom(() => red.interpretarPedidoDeRedacao(r, { alvo: "integrante", dominioId: "casa" }), "PedidoInvalido");
      lancaCom(() => red.interpretarPedidoDeRedacao(r, { alvo: "integrante", dominioId: "casa", frase: "a".repeat(301) }), "PedidoInvalido");
      lancaCom(() => red.interpretarPedidoDeRedacao(r, { alvo: "x", frase: "a" }), "PedidoInvalido");
      lancaCom(() => red.interpretarPedidoDeRedacao(r, { alvo: "integrante", frase: "a" }), "PedidoInvalido");
      lancaCom(() => red.interpretarPedidoDeRedacao(r, { alvo: "pessoa", pessoaId: "velho", frase: "a" }), "ConflitoDeRoster");
      const arq = f2();
      arq.squads[0].dominios[1].arquivado = true;
      arq.squads[1].arquivado = true;
      lancaCom(() => red.interpretarPedidoDeRedacao(arq, { alvo: "integrante", squadId: "pessoal", dominioId: "pessoal--financeiro", frase: "a" }), "ConflitoDeRoster");
      lancaCom(() => red.interpretarPedidoDeRedacao(arq, { alvo: "pessoa", pessoaId: "fin", frase: "a" }), "ConflitoDeRoster");
      lancaCom(() => red.interpretarPedidoDeRedacao(arq, { alvo: "dominio", squadId: "pay4fun", frase: "a" }), "SquadArquivada");
      lancaCom(() => red.interpretarPedidoDeRedacao(arq, { alvo: "integrante", squadId: "pessoal", dominioId: "pay4fun--geral", frase: "a" }), "ConflitoDeRoster");
      break;
    }
    default:
      throw new Error(`Cenário desconhecido: ${cenario}`);
  }
  console.log(`OK ${cenario}`);
}

main().catch((e) => { console.error(`FALHOU ${cenario}:`, e); process.exit(1); });
```

- [ ] **Step 2: Script do prompt do turno**

`$SCRATCH/fase2/prompt.ts`:

```ts
import assert from "node:assert/strict";
import { f2, importar, prepararDiretorio } from "./harness.ts";

async function main() {
  await prepararDiretorio();
  const sq = await importar("server/squad.ts");
  const orq = await importar("server/orchestrator.ts");
  const { CAPABILITIES } = await importar("server/capabilities.ts");

  const r = f2();
  r.squads[0].dominios[0].integrantes[0].arquivado = true;
  r.squads[0].dominios[1].arquivado = true;
  const s = r.squads[0];
  // Contexto completo exigido pela assinatura pós-Fase 3. A Fase 3 acrescenta
  // `janela`; se o ContextoDoPrompt tiver outros campos obrigatórios, preencha
  // aqui com valores fixos. Campo a mais não atrapalha.
  const contexto = {
    squadNome: s.nome,
    squadEscopo: s.escopo,
    arvore: sq.rosterTree(s),
    outrasSquads: sq.outrasSquads(r, s.id),
    janela: "09:00–19:00 (seg, ter, qua, qui, sex)",
  };
  const texto: string = orq.buildSystemInstruction(contexto, "2026-09-14T09:00:00-03:00", "auto");
  assert.ok(texto.includes("PEDE EXPLICITAMENTE"), "regra de pedido explícito");
  assert.ok(texto.includes("SEMPRE chame criar_po_dominio ou contratar_integrante"));
  assert.ok(texto.includes("Sem pedido explícito"));
  assert.ok(!texto.includes("'ana'") && !texto.includes("'fin'") && !texto.includes("pessoal--financeiro"), "arquivado no prompt");
  assert.ok(texto.includes("- squad 'pay4fun'"));
  for (const nome of ["criar_po_dominio", "contratar_integrante"]) {
    assert.ok(CAPABILITIES[nome].declaration.description.includes("pedir explicitamente"), `descrição de ${nome}`);
  }
  assert.equal(typeof orq.gerarComRetry, "function");
  console.log("OK prompt");
}

main().catch((e) => { console.error("FALHOU prompt:", e); process.exit(1); });
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase2" && npx tsx prompt.ts; for c in sucesso-pessoa po-e-pessoa sucesso-dominio truncado sem-chamada ocupado erro-gemini pedido; do npx tsx redacao.ts $c || break; done
```

Esperado: `FALHOU prompt` (sem "PEDE EXPLICITAMENTE") e `FALHOU sucesso-pessoa` (módulo `server/redacao.ts` não existe).

- [ ] **Step 4: `server/orchestrator.ts`**

1. Troque `async function gerarComRetry(` por `export async function gerarComRetry(`. Acrescente ao comentário dela: `Exportada para server/redacao.ts: a redação sofre o mesmo 503 e merece o mesmo modelo reserva.`

2. Em `buildSystemInstruction`, substitua o bloco

```
- Crescimento tem dois níveis, e escolher o errado é erro:
  - criar_po_dominio quando o TEMA não pertence a nenhum domínio existente.
  - contratar_integrante quando o tema já tem domínio mas falta um PAPEL dentro
    dele; passe o dominio_id exato.
  Se a squad atual dá conta, não chame nenhuma das duas.
```

por

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

   Acima do `return` do template, acrescente:

```ts
  // Pedido explícito de contratação SEMPRE vira capacidade: a regra antiga
  // ("se a squad dá conta, não chame") fazia o modelo engolir "contrate um
  // designer" quando já havia alguém parecido. Sem roteamento por regex no
  // servidor — o card continua sendo a decisão do usuário.
```

- [ ] **Step 5: `server/capabilities.ts`**

Na `description` de `criar_po_dominio`, logo antes de `"Não cria nada: devolve uma proposta..."`, acrescente a frase `"Use também sempre que o usuário pedir explicitamente para abrir um domínio ou uma sala. "`. Em `contratar_integrante`, antes de `"Não contrata ninguém: ..."`, acrescente `"Use também sempre que o usuário pedir explicitamente para contratar ou trazer alguém para um domínio existente. "`.

- [ ] **Step 6: Criar `server/redacao.ts`**

```ts
/**
 * Redação do treino de um agente (spec Fase 2 §5.5). O usuário escreve uma
 * frase, uma chamada curta ao Gemini devolve papel + escopo, e o usuário edita
 * e aprova. Esta rota NÃO escreve no roster: contratar é outro gesto, e falhar
 * aqui nunca impede contratar escrevendo à mão.
 *
 * Function calling restrito (mode ANY + allowedFunctionNames com um nome só),
 * não resposta estruturada. gerarComRetry troca de gemini-3.7-flash para
 * gemini-3.5-flash no meio da tentativa; function calling é o que os dois já
 * servem em todo turno, e responseMimeType foi medido como campo minado nessa
 * troca (ver executarTurno). A objeção do turno a ANY, forçar proposta
 * espúria, não vale aqui: a chamada É a resposta.
 */

import { FunctionCallingConfigMode, Type, type FunctionDeclaration, type GoogleGenAI } from "@google/genai";
import { gerarComRetry, MODEL, ModeloOcupado } from "./orchestrator.ts";
import {
  acharDominio,
  ativo,
  ConflitoDeRoster,
  dominiosAtivos,
  integrantesAtivos,
  LIMITES,
  limitar,
  localizarPessoa,
  normalizarEscopo,
  PedidoInvalido,
  resolverSquad,
  textoDeUmaLinha,
  type Dominio,
  type Pessoa,
  type Roster,
  type Squad,
} from "./squad.ts";

/** O modelo respondeu, mas não com o que dá para usar. 502: não é culpa do pedido nem passa sozinho. */
export class RedacaoInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RedacaoInvalida";
  }
}

export type PedidoDeRedacao =
  | { alvo: "integrante" | "po"; squad: Squad; dominio: Dominio; frase: string }
  | { alvo: "pessoa"; squad: Squad; dominio: Dominio; pessoa: Pessoa; frase: string }
  | { alvo: "dominio"; squad: Squad; frase: string };

export interface RedacaoDePessoa {
  alvo: "integrante" | "po" | "pessoa";
  papel: string;
  escopo: string;
  /** Algum campo passou do limite e foi cortado: a UI avisa. */
  truncado: boolean;
}

export interface RedacaoDeDominio {
  alvo: "dominio";
  nome: string;
  escopo_dominio: string;
  papel_po: string;
  escopo_po: string;
  truncado: boolean;
}

export type Redacao = RedacaoDePessoa | RedacaoDeDominio;

/**
 * Forma e estado ANTES de chamar o Gemini: domínio, pessoa ou squad arquivados
 * e ids velhos falham sem gastar chamada ao modelo.
 */
export function interpretarPedidoDeRedacao(roster: Roster, corpo: unknown): PedidoDeRedacao {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new PedidoInvalido("O corpo deve ser um objeto JSON.");
  }
  const b = corpo as Record<string, unknown>;
  const frase = typeof b.frase === "string" ? textoDeUmaLinha(b.frase) : "";
  if (!frase) throw new PedidoInvalido("Campo 'frase' é obrigatório.");
  if (frase.length > LIMITES.frase) {
    throw new PedidoInvalido(`Campo 'frase' tem ${frase.length} caracteres; o máximo é ${LIMITES.frase}.`);
  }

  switch (b.alvo) {
    case "integrante":
    case "po": {
      if (typeof b.dominioId !== "string" || !b.dominioId) {
        throw new PedidoInvalido("Campo 'dominioId' é obrigatório.");
      }
      const squad = resolverSquad(roster, b.squadId);
      const dominio = acharDominio(squad, b.dominioId);
      if (!dominio) {
        throw new ConflitoDeRoster(`O domínio '${b.dominioId}' não está ativo na squad '${squad.nome}'.`);
      }
      return { alvo: b.alvo, squad, dominio, frase };
    }
    case "pessoa": {
      if (typeof b.pessoaId !== "string" || !b.pessoaId) {
        throw new PedidoInvalido("Campo 'pessoaId' é obrigatório.");
      }
      const achada = localizarPessoa(roster, b.pessoaId);
      if (!achada || !ativo(achada.squad) || !ativo(achada.dominio) || !ativo(achada.pessoa)) {
        throw new ConflitoDeRoster(`A pessoa '${b.pessoaId}' não existe ou não está ativa.`);
      }
      return { alvo: "pessoa", squad: achada.squad, dominio: achada.dominio, pessoa: achada.pessoa, frase };
    }
    case "dominio":
      return { alvo: "dominio", squad: resolverSquad(roster, b.squadId), frase };
    default:
      throw new PedidoInvalido("Campo 'alvo' deve ser 'integrante', 'po', 'pessoa' ou 'dominio'.");
  }
}

/**
 * Formato do escopo (spec Fase 2 §5.3). As três primeiras linhas servem ao
 * orquestrador agora, para escolher responsavel_id; "Ao opinar" e "Sinais de
 * alerta" são a rubrica do agente que contribui em quests na Fase 4.
 */
const FORMATO_ESCOPO = `O escopo tem EXATAMENTE cinco linhas, nesta ordem, cada uma começando pelo rótulo:
Missão: uma ou duas frases sobre para que este agente existe.
Cuida de: itens concretos separados por "; ".
Não cuida de: itens separados por "; " — principalmente o que é de outros papéis listados.
Ao opinar sobre um compromisso: o que este agente verifica num evento do calendário (prazo realista, preparação, dependências, riscos).
Sinais de alerta: situações em que deve avisar o usuário.`;

export function promptDeRedacao(p: PedidoDeRedacao): string {
  const cabecalho = `Você redige o TREINO de um agente do SquadOne. O treino é papel + escopo: vai
literal para o prompt do orquestrador, que escolhe quem recebe cada compromisso,
e numa fase seguinte para o próprio agente opinar sobre compromissos do
calendário. Escreva em português, concreto ao tema, sem inventar ferramentas,
pessoas ou fatos que o pedido não sugere.

Squad: '${p.squad.nome}' (escopo: ${p.squad.escopo})`;

  if (p.alvo === "dominio") {
    const existentes = dominiosAtivos(p.squad).map((d) => `- ${d.nome}: ${d.escopo}`).join("\n");
    return `${cabecalho}
Domínios ativos desta squad (o novo não pode repetir o tema deles):
${existentes}

Tarefa: a partir do pedido do usuário, proponha um DOMÍNIO novo e o PO dono
dele. Chame redigir_dominio uma vez; não responda em texto.
- nome: 1 a 3 palavras, até 60 caracteres (ex.: "Financeiro").
- escopo_dominio: UMA frase de até 200 caracteres dizendo que demandas pertencem
  a este domínio.
- papel_po: até 60 caracteres (ex.: "PO Financeiro").
- escopo_po: até 1400 caracteres.
${FORMATO_ESCOPO}`;
  }

  // Só ativos: quem saiu não deve moldar o "Não cuida de" do recém-chegado.
  const pessoasDoDominio = [p.dominio.po, ...integrantesAtivos(p.dominio)]
    .map((x) => `- ${x.papel} (${x.nome})`)
    .join("\n");
  const alvo =
    p.alvo === "integrante"
      ? "um INTEGRANTE novo deste domínio"
      : p.alvo === "po"
        ? "o NOVO PO deste domínio, que substitui o atual"
        : `o treino REESCRITO de ${p.pessoa.nome}, que hoje é:\n${p.pessoa.papel}\n${p.pessoa.escopo}`;

  return `${cabecalho}
Domínio: '${p.dominio.nome}' (escopo: ${p.dominio.escopo})
Pessoas ativas neste domínio:
${pessoasDoDominio}

Tarefa: a partir do pedido do usuário, redija ${alvo}. Chame redigir_pessoa uma
vez; não responda em texto.
- papel: 1 a 4 palavras, sem nome próprio, até 60 caracteres.
- escopo: até 1400 caracteres.
${FORMATO_ESCOPO}`;
}

const REDIGIR_PESSOA: FunctionDeclaration = {
  name: "redigir_pessoa",
  description: "Entrega o papel e o escopo redigidos para um agente.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      papel: { type: Type.STRING, description: "Papel, até 60 caracteres, sem nome próprio." },
      escopo: { type: Type.STRING, description: "Escopo nas cinco linhas rotuladas, até 1400 caracteres." },
    },
    required: ["papel", "escopo"],
  },
};

const REDIGIR_DOMINIO: FunctionDeclaration = {
  name: "redigir_dominio",
  description: "Entrega o domínio novo e o treino do PO dele.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      nome: { type: Type.STRING, description: "Nome do domínio, até 60 caracteres." },
      escopo_dominio: { type: Type.STRING, description: "Uma frase, até 200 caracteres." },
      papel_po: { type: Type.STRING, description: "Papel do PO, até 60 caracteres." },
      escopo_po: { type: Type.STRING, description: "Escopo do PO nas cinco linhas rotuladas, até 1400 caracteres." },
    },
    required: ["nome", "escopo_dominio", "papel_po", "escopo_po"],
  },
};

function campoRedigido(
  args: Record<string, unknown>,
  nome: string,
  max: number,
  multilinha = false,
): { texto: string; truncado: boolean } {
  const bruto = typeof args[nome] === "string" ? (args[nome] as string) : "";
  const limpo = multilinha ? normalizarEscopo(bruto) : textoDeUmaLinha(bruto);
  if (!limpo) throw new RedacaoInvalida(`O modelo devolveu '${nome}' vazio. Escreva à mão ou tente de novo.`);
  return limitar(limpo, max);
}

export async function redigirTreino(ai: GoogleGenAI, pedido: PedidoDeRedacao): Promise<Redacao> {
  const declaracao = pedido.alvo === "dominio" ? REDIGIR_DOMINIO : REDIGIR_PESSOA;
  const nome = declaracao.name as string;

  let response: Awaited<ReturnType<typeof gerarComRetry>>;
  try {
    response = await gerarComRetry(ai, {
      model: MODEL,
      contents: pedido.frase,
      config: {
        systemInstruction: promptDeRedacao(pedido),
        tools: [{ functionDeclarations: [declaracao] }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [nome] },
        },
      },
    });
  } catch (err: any) {
    // Sobrecarga passa sozinha e já tem classificação própria (503). O resto
    // (chave inválida, argumento recusado) não passa: vira 502 com o motivo.
    if (err instanceof ModeloOcupado) throw err;
    throw new RedacaoInvalida(`O Gemini recusou a redação: ${String(err?.message ?? err).slice(0, 300)}`);
  }

  const call = response.functionCalls?.find((c) => c.name === nome);
  if (!call) throw new RedacaoInvalida("O modelo não devolveu a redação. Escreva à mão ou tente de novo.");
  const args = (call.args ?? {}) as Record<string, unknown>;

  if (pedido.alvo === "dominio") {
    const nomeDominio = campoRedigido(args, "nome", LIMITES.dominioNome);
    const escopoDominio = campoRedigido(args, "escopo_dominio", LIMITES.dominioEscopo);
    const papelPo = campoRedigido(args, "papel_po", LIMITES.papel);
    const escopoPo = campoRedigido(args, "escopo_po", LIMITES.escopoPessoa, true);
    return {
      alvo: "dominio",
      nome: nomeDominio.texto,
      escopo_dominio: escopoDominio.texto,
      papel_po: papelPo.texto,
      escopo_po: escopoPo.texto,
      truncado: nomeDominio.truncado || escopoDominio.truncado || papelPo.truncado || escopoPo.truncado,
    };
  }

  const papel = campoRedigido(args, "papel", LIMITES.papel);
  const escopo = campoRedigido(args, "escopo", LIMITES.escopoPessoa, true);
  return { alvo: pedido.alvo, papel: papel.texto, escopo: escopo.texto, truncado: papel.truncado || escopo.truncado };
}
```

- [ ] **Step 7: Rodar e ver passar**

```bash
cd "$SCRATCH/fase2" && npx tsx prompt.ts && for c in sucesso-pessoa po-e-pessoa sucesso-dominio truncado sem-chamada ocupado erro-gemini pedido; do npx tsx redacao.ts $c || break; done
```

Esperado: `OK prompt` + 8 linhas `OK`. O cenário `ocupado` leva ~3 s por causa do backoff real de `gerarComRetry`.

- [ ] **Step 8: Typecheck, build e garantias**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build && ! grep -n "fetch(\|calendar.ts" server/redacao.ts
```

Esperado: sem erros; grep sem saída.

- [ ] **Step 9: Commit**

```bash
cd "$REPO" && git add server/redacao.ts server/orchestrator.ts server/capabilities.ts && git commit -m "$(cat <<'EOF'
feat(squad): redigir treino com Gemini e nao engolir pedido de contratacao

Uma chamada curta transforma a frase do usuario em papel e escopo de cinco
linhas: missao, cuida de, nao cuida de, o que verifica ao opinar sobre um
compromisso e sinais de alerta (rubrica que a Fase 4 vai usar). Function
calling restrito com ANY e um nome so, porque gerarComRetry troca de modelo
no meio e responseMimeType ja se mostrou instavel nessa troca. A rota nao
grava nada: falhar aqui nunca impede contratar a mao.

O prompt do turno passa a chamar a capacidade de crescimento sempre que o
usuario pede contratacao explicitamente, sem regex no servidor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rotas HTTP do ciclo de vida e da redação

**Files:**
- Modify: `server.ts`
- Test: `$SCRATCH/fase2/http.ts`, `$SCRATCH/fase2/util.ts`

**Interfaces:**
- Consumes: Task 2 (`editar*`, `arquivar*`, `reativar*`, `substituirPo`), Task 3 (`interpretarPedidoDeRedacao`, `redigirTreino`, `RedacaoInvalida`), Fase 1 (`responderErroDeRoster`, `ModeloOcupado`, `readRoster`).
- Produces (Tasks 5–7), contratos de spec §4:
  - `POST /api/squad/redigir`;
  - `PATCH /api/squad/pessoas/:id`, `POST /api/squad/pessoas/:id/arquivar`, `POST /api/squad/pessoas/:id/reativar`;
  - `PATCH /api/squad/dominios/:id`, `POST /api/squad/dominios/:id/arquivar`, `POST /api/squad/dominios/:id/reativar`, `POST /api/squad/dominios/:id/po`;
  - `PATCH /api/squad/squads/:id`, `POST /api/squad/squads/:id/arquivar`, `POST /api/squad/squads/:id/reativar`.

- [ ] **Step 0: Reler**

**Releia `server.ts` pós-Fase 3.** A Fase 3 pode ter mexido em `/api/orquestrar` e `/api/mochila` (avisos, erros de alocação). Rode `git log --oneline -10 -- server.ts` e leia o arquivo inteiro: `responderErroDeRoster`, as rotas `/api/squad*`, `/api/mochila`, `/api/orquestrar`. Esta task só acrescenta imports e rotas novas depois de `/api/squad/hire` e troca um comentário. Não altere as rotas da Fase 3 nem confie nas linhas citadas aqui. Se `responderErroDeRoster` tiver mudado de nome ou de forma, use o equivalente atual.

- [ ] **Step 1: Utilitário e script HTTP**

`$SCRATCH/fase2/util.ts`:

```ts
import { f2, txt } from "./harness.ts";

const [comando, base, metodo, rota, corpo] = process.argv.slice(2);

async function main() {
  if (comando === "fixture-f2") {
    process.stdout.write(txt(f2()));
  } else if (comando === "acao") {
    // Uso: npx tsx util.ts acao <base> <METODO> <rota> ['<json>']
    const r = await fetch(base + rota, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo,
    });
    console.log(metodo, rota, r.status, (await r.text()).slice(0, 200));
  } else {
    throw new Error(`Comando desconhecido: ${comando}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

`$SCRATCH/fase2/http.ts`:

```ts
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:3927";

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/squad`)).status) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Servidor não subiu em 30s.");
}

async function status(metodo: string, rota: string, corpo: unknown, esperado: number): Promise<any> {
  const r = await fetch(`${BASE}${rota}`, {
    method: metodo,
    headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const json = await r.json().catch(() => ({}));
  assert.equal(r.status, esperado, `${metodo} ${rota} -> ${r.status} ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  await esperarServidor();

  let v = await status("GET", "/api/squad", undefined, 200);
  assert.ok(Array.isArray(v.squadsArquivadas));
  assert.deepEqual(v.squads[0].proximoSlot, [0, 1]);

  await status("PATCH", "/api/squad/pessoas/romulo", { papel: "PO Geral" }, 200);
  await status("PATCH", "/api/squad/pessoas/romulo", { id: "x" }, 400);
  await status("PATCH", "/api/squad/pessoas/nao-existe", { papel: "x" }, 409);
  await status("PATCH", "/api/squad/dominios/casa", { escopo: "lar" }, 200);
  await status("PATCH", "/api/squad/squads/pessoal", { escopo: "vida" }, 200);

  await status("POST", "/api/squad/pessoas/romulo/arquivar", undefined, 409);
  await status("POST", "/api/squad/pessoas/ana/arquivar", undefined, 200);
  await status("POST", "/api/squad/pessoas/ana/arquivar", undefined, 200);
  await status("POST", "/api/squad/pessoas/ana/reativar", undefined, 200);

  await status("POST", "/api/squad/dominios/casa/arquivar", undefined, 409);
  await status("POST", "/api/squad/dominios/pessoal--financeiro/arquivar", undefined, 200);
  v = await status("GET", "/api/squad", undefined, 200);
  assert.ok(!v.squads[0].dominios.some((d: any) => d.id === "pessoal--financeiro"));
  assert.equal(v.squads[0].arquivo.dominios[0].id, "pessoal--financeiro");
  await status("POST", "/api/squad/dominios/pessoal--financeiro/reativar", undefined, 200);

  await status("POST", "/api/squad/squads/pay4fun/arquivar", undefined, 200);
  let j = await status("GET", "/api/mochila?squadId=pay4fun", undefined, 409);
  assert.equal(j.squadInexistente, true);
  j = await status("POST", "/api/orquestrar", { demanda: "x", squadId: "pay4fun" }, 409);
  assert.equal(j.squadInexistente, true);
  await status("POST", "/api/squad/hire", { sugestao: { kind: "integrante", squad_id: "pay4fun", dominio_id: "pay4fun--geral", papel: "QA", escopo: "t" } }, 409);
  await status("POST", "/api/squad/squads/pessoal/arquivar", undefined, 409);

  // Redação: só pedidos que falham ANTES do Gemini. Nunca um pedido válido.
  await status("POST", "/api/squad/redigir", { alvo: "integrante", dominioId: "casa" }, 400);
  await status("POST", "/api/squad/redigir", { alvo: "dominio", squadId: "pay4fun", frase: "x" }, 409);
  await status("POST", "/api/squad/redigir", { alvo: "integrante", squadId: "pessoal", dominioId: "nao-existe", frase: "x" }, 409);

  await status("POST", "/api/squad/squads/pay4fun/reativar", undefined, 200);

  j = await status("POST", "/api/squad/dominios/casa/po", { nome: "Bruno", papel: "PO", escopo: "Missão: x" }, 200);
  assert.equal(j.anterior.id, "romulo");
  await status("POST", "/api/squad/dominios/casa/po", { integranteId: "ana", papel: "x" }, 400);

  j = await status("POST", "/api/squad/hire", { sugestao: { kind: "integrante", squad_id: "pessoal", dominio_id: "casa", papel: "QA", escopo: "x".repeat(1800) } }, 200);
  assert.equal(j.pessoa.escopo.length, 1500);

  console.log("OK http");
}

main().catch((e) => { console.error("FALHOU http:", e); process.exit(1); });
```

- [ ] **Step 2: `server.ts`**

1. Imports:

```ts
import { aplicarContratacao, criarSquad, substituirPo } from "./server/hire.ts";
import {
  arquivarDominio,
  arquivarPessoa,
  arquivarSquad,
  editarDominio,
  editarPessoa,
  editarSquad,
  reativarDominio,
  reativarPessoa,
  reativarSquad,
} from "./server/ciclo-de-vida.ts";
import { interpretarPedidoDeRedacao, RedacaoInvalida, redigirTreino } from "./server/redacao.ts";
```

2. Atualize o comentário de `POST /api/squad/hire`: troque "o unico endpoint que ESCREVE no roster" por "contrata a partir de card do modelo OU do formulário da UI (Fase 2)".

3. Logo depois da rota `/api/squad/hire`:

```ts
  // Redacao do treino (Fase 2 §4.2): uma chamada ao Gemini, NADA gravado.
  // Roster e alvo sao validados antes do modelo; falhar aqui nunca impede
  // contratar a mao, entao cada falha volta classificada para a UI dizer isso.
  app.post("/api/squad/redigir", async (req, res) => {
    try {
      const pedido = interpretarPedidoDeRedacao(await readRoster(), req.body);
      res.json(await redigirTreino(ai, pedido));
    } catch (error: any) {
      if (responderErroDeRoster(res, error)) return;
      if (error instanceof ModeloOcupado) {
        return res.status(503).json({ error: error.message, modeloOcupado: true });
      }
      if (error instanceof RedacaoInvalida) {
        return res.status(502).json({ error: error.message, redacaoFalhou: true });
      }
      console.error("Erro ao redigir:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Ciclo de vida (Fase 2 §4.4-§4.8): todas escrevem so em data/squad.json,
   * nenhuma toca o Google, e todas devolvem o roster inteiro para a UI trocar
   * o dela. Ids de pessoa e dominio sao globais, por isso o caminho nao leva
   * squadId.
   */
  const rotaDoRoster =
    (acao: (req: express.Request) => Promise<unknown>) =>
    async (req: express.Request, res: express.Response) => {
      try {
        res.json(await acao(req));
      } catch (error: any) {
        if (responderErroDeRoster(res, error)) return;
        console.error(`Erro em ${req.method} ${req.path}:`, error);
        res.status(500).json({ error: error.message });
      }
    };

  app.patch("/api/squad/pessoas/:id", rotaDoRoster((req) => editarPessoa(req.params.id, req.body)));
  app.post("/api/squad/pessoas/:id/arquivar", rotaDoRoster((req) => arquivarPessoa(req.params.id)));
  app.post("/api/squad/pessoas/:id/reativar", rotaDoRoster((req) => reativarPessoa(req.params.id)));
  app.patch("/api/squad/dominios/:id", rotaDoRoster((req) => editarDominio(req.params.id, req.body)));
  app.post("/api/squad/dominios/:id/arquivar", rotaDoRoster((req) => arquivarDominio(req.params.id)));
  app.post("/api/squad/dominios/:id/reativar", rotaDoRoster((req) => reativarDominio(req.params.id)));
  // PO nao se arquiva: substitui-se. O anterior vira integrante arquivado.
  app.post("/api/squad/dominios/:id/po", rotaDoRoster((req) => substituirPo(req.params.id, req.body)));
  app.patch("/api/squad/squads/:id", rotaDoRoster((req) => editarSquad(req.params.id, req.body)));
  app.post("/api/squad/squads/:id/arquivar", rotaDoRoster((req) => arquivarSquad(req.params.id)));
  app.post("/api/squad/squads/:id/reativar", rotaDoRoster((req) => reativarSquad(req.params.id)));
```

Se o typecheck reclamar do tipo de `req.params.id` (versão do `@types/express`), use `String(req.params.id)`.

- [ ] **Step 3: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros.

- [ ] **Step 4: Subir o build num diretório temporário e rodar o HTTP**

```bash
TMPD=$(mktemp -d "$SCRATCH/fase2-http-XXXX")
cp -r "$REPO/seed" "$TMPD/seed"
mkdir "$TMPD/data"
cd "$SCRATCH/fase2" && npx tsx util.ts fixture-f2 > "$TMPD/data/squad.json"
cd "$TMPD" && PORT=3927 NODE_ENV=production GEMINI_API_KEY=fake IPS_PERMITIDOS= node "$REPO/dist/server.cjs" > "$TMPD/server.log" 2>&1 &
echo $! > "$TMPD/pid"
cd "$SCRATCH/fase2" && npx tsx http.ts; STATUS=$?
kill "$(cat "$TMPD/pid")"
ls "$TMPD/data"
exit $STATUS
```

Esperado: `OK http`; `ls` mostra `squad.json` e **não** mostra `google-auth.json`. Se falhar, leia `$TMPD/server.log`.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add server.ts && git commit -m "$(cat <<'EOF'
feat(api): rotas de editar, arquivar, reativar, substituir PO e redigir

Cada rota de ciclo de vida escreve so no roster, devolve o roster inteiro
e mapeia erro pela classificacao: 400 forma, 409 estado, squad arquivada
com squadInexistente para a UI fazer o mesmo gesto de squad sumida.
/redigir valida roster e alvo antes do Gemini e separa modelo ocupado (503)
de redacao inutilizavel (502): nos dois a UI oferece escrever a mao.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Escritório esquece salas, anima o fechamento e reassenta atores

**Files:**
- Create: `src/office/salas.ts`
- Modify: `src/office/useOffice.ts`
- Modify: `src/components/GameMap.vue` (só `faseClasse`)
- Modify: `src/index.css`
- Test: `$SCRATCH/fase2/salas.ts`

**Interfaces:**
- Consumes: `slotKey` de `src/office/rooms.ts`; `OfficeDominio` de `useOffice.ts`.
- Produces:
  - `src/office/salas.ts`: `interface MudancaDeSalas<D> { fechar: D[]; trocadas: string[]; abrir: D[] }` e `planejarSalas<D extends { id: string; slot: [number, number] }>(conhecidas: ReadonlyMap<string, D>, atuais: readonly D[]): MudancaDeSalas<D>`;
  - `RoomPhase = 'pending' | 'building' | 'closing' | null`;
  - classe CSS `room--closing`.

Nenhuma interface consumida por tasks seguintes: o mapa reage sozinho à troca de `roster` que as Tasks 6 e 7 fazem. O efeito visual é verificado no navegador na Task 7 (Step 9), quando existirem os gestos de arquivar.

- [ ] **Step 0: Reler**

Releia `src/office/useOffice.ts` inteiro, com atenção a `roomPhase`, `knownRooms`, `primeiraCarga`, `agendar`, `unlocked`, `mapTiles`, `rooms`, `syncActors`, `registrarSalas`, `moveTo` e o `watch(dominios)`. Leia também `src/components/GameMap.vue` (`faseClasse`, `poRaiz`, o watch de `agent`) e as regras `room--` em `src/index.css`.

- [ ] **Step 1: Escrever o script da decisão de salas**

`$SCRATCH/fase2/salas.ts`:

```ts
import assert from "node:assert/strict";
import { importar } from "./harness.ts";

type Sala = { id: string; slot: [number, number]; nome?: string };
const sala = (id: string, x: number, y: number, nome = id): Sala => ({ id, slot: [x, y], nome });
const mapa = (...salas: Sala[]) => new Map(salas.map((s) => [`${s.slot[0]},${s.slot[1]}`, s]));
const ids = (xs: Sala[]) => xs.map((s) => s.id);

async function main() {
  const { planejarSalas } = await importar("src/office/salas.ts");

  // Primeira leitura: tudo entra (quem decide não animar é o primeiraCarga do useOffice).
  let m = planejarSalas(new Map(), [sala("a", 0, 0), sala("b", 1, 0)]);
  assert.deepEqual([ids(m.abrir), ids(m.fechar), m.trocadas], [["a", "b"], [], []]);

  // Mesmo roster com objetos novos (o computed recria tudo) e nome trocado: nada muda.
  m = planejarSalas(mapa(sala("a", 0, 0), sala("b", 1, 0)), [sala("a", 0, 0, "Casa 2"), sala("b", 1, 0)]);
  assert.deepEqual([ids(m.abrir), ids(m.fechar), m.trocadas], [[], [], []]);

  // Domínio arquivado: a sala fecha.
  m = planejarSalas(mapa(sala("a", 0, 0), sala("b", 1, 0)), [sala("a", 0, 0)]);
  assert.deepEqual([ids(m.abrir), ids(m.fechar), m.trocadas], [[], ["b"], []]);

  // Slot reaberto por outro domínio depois de a sala sair: obra de novo.
  m = planejarSalas(mapa(sala("a", 0, 0)), [sala("a", 0, 0), sala("c", 1, 0)]);
  assert.deepEqual([ids(m.abrir), ids(m.fechar), m.trocadas], [["c"], [], []]);

  // Troca de dono no mesmo slot numa leitura só (roster recarregado): sem fechar, abre a nova.
  m = planejarSalas(mapa(sala("a", 0, 0), sala("b", 1, 0)), [sala("a", 0, 0), sala("c", 1, 0)]);
  assert.deepEqual([ids(m.abrir), ids(m.fechar), m.trocadas], [["c"], [], ["1,0"]]);

  console.log("OK salas");
}

main().catch((e) => { console.error("FALHOU salas:", e); process.exit(1); });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "$SCRATCH/fase2" && npx tsx salas.ts
```

Esperado: `FALHOU salas`, porque o módulo `src/office/salas.ts` ainda não existe.

- [ ] **Step 3: Criar `src/office/salas.ts`**

```ts
/**
 * Diferença entre as salas que o escritório conhece e as do roster atual
 * (spec Fase 2 §8). Função pura para ser testável fora do Vue: useOffice só
 * aplica o resultado (fases, timers, câmera).
 *
 * Por que comparar DONO e não só slot: com arquivamento um slot esvazia e pode
 * voltar ocupado por outro domínio. Um conjunto de slots que nunca esquece
 * (o `knownRooms` antigo) fazia a sala nova nascer sem obra.
 */

import { slotKey } from './rooms'

export interface MudancaDeSalas<D> {
  /** Saíram do roster (domínio arquivado): fecham com animação. */
  fechar: D[]
  /** Slots cujo dono mudou numa leitura só: não fecham, a sala nova já anima. */
  trocadas: string[]
  /** Entraram (sala nova, reativada ou dono novo): obra. */
  abrir: D[]
}

export function planejarSalas<D extends { id: string; slot: [number, number] }>(
  conhecidas: ReadonlyMap<string, D>,
  atuais: readonly D[]
): MudancaDeSalas<D> {
  const porSlot = new Map(atuais.map((d) => [slotKey(d.slot), d]))
  const fechar: D[] = []
  const trocadas: string[] = []
  for (const [chave, anterior] of conhecidas) {
    const atual = porSlot.get(chave)
    if (!atual) fechar.push(anterior)
    else if (atual.id !== anterior.id) trocadas.push(chave)
  }
  const abrir = atuais.filter((d) => conhecidas.get(slotKey(d.slot))?.id !== d.id)
  return { fechar, trocadas, abrir }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd "$SCRATCH/fase2" && npx tsx salas.ts
```

Esperado: `OK salas`.

- [ ] **Step 5: `src/office/useOffice.ts`**

1. `export type RoomPhase = 'pending' | 'building' | 'closing' | null`. Acrescente `import { planejarSalas } from './salas'`.

2. Substitua `const knownRooms = new Set<string>()` por:

```ts
  /**
   * Última forma conhecida de cada sala, por slot. Guarda o domínio e não só o
   * slot: um slot pode esvaziar (domínio arquivado) e voltar com outro dono, e
   * a sala que sai precisa da última aparência para fechar na tela.
   */
  const knownRooms = new Map<string, OfficeDominio>()
  /** Salas fora do roster ainda desenhadas, com fase 'closing', até a animação acabar. */
  const fechando = shallowRef<OfficeDominio[]>([])
  /**
   * Geração por slot. Todo timer de obra ou fechamento guarda a geração em que
   * nasceu e não faz nada se ela mudou: arquivar no meio da obra, ou reabrir no
   * meio do fechamento, não deixa fase presa na sala nova do mesmo slot.
   */
  const geracao = new Map<string, number>()
  function novaGeracao(key: string): number {
    const g = (geracao.get(key) ?? 0) + 1
    geracao.set(key, g)
    return g
  }
```

3. `mapTiles`: `computed(() => mapSizeTiles([...dominios.value, ...fechando.value].map((d) => d.slot)))`. A sala que fecha ainda precisa caber no mundo até sumir.

4. `rooms`: troque a abertura `dominios.value.map((d) => {` por

```ts
    [
      ...dominios.value.map((d) => ({ d, fase: (roomPhase.get(slotKey(d.slot)) ?? null) as RoomPhase })),
      // Fora do roster, mas ainda na tela até `room--closing` terminar.
      ...fechando.value.map((d) => ({ d, fase: 'closing' as RoomPhase })),
    ].map(({ d, fase }) => {
```

   Dentro do corpo, troque `phase: roomPhase.get(key) ?? null,` por `phase: fase,`. O resto do corpo não muda: as portas continuam derivadas de `unlocked`, só de salas ativas, então a sala que fecha já perde as portas.

5. Substitua `registrarSalas` inteira:

```ts
  /**
   * Sala nova: pan da câmera, materialização, e só então a entrada de quem
   * mora nela — sequencial de propósito. Sala que sai: fecha no lugar, e quem
   * morava nela já saiu do roster (syncActors remove). Primeira carga só
   * registra: o escritório já existia antes do app abrir.
   */
  function registrarSalas() {
    const { fechar, trocadas, abrir } = planejarSalas(knownRooms, dominios.value)

    for (const d of fechar) {
      const key = slotKey(d.slot)
      knownRooms.delete(key)
      roomPhase.delete(key)
      const g = novaGeracao(key)
      if (primeiraCarga) continue
      // A câmera não pode ficar presa olhando um slot que ficou vazio.
      lookPoint.value = null
      fechando.value = [...fechando.value.filter((f) => slotKey(f.slot) !== key), d]
      agendar(() => {
        if (geracao.get(key) !== g) return
        fechando.value = fechando.value.filter((f) => slotKey(f.slot) !== key)
      }, ROOM_BUILD_MS)
      kick()
    }

    // Dono novo no mesmo slot: sem fechamento, a entrada abaixo anima a sala nova.
    for (const key of trocadas) {
      knownRooms.delete(key)
      roomPhase.delete(key)
    }

    for (const d of abrir) {
      const key = slotKey(d.slot)
      knownRooms.set(key, d)
      // Duas salas com o mesmo key colidiriam no v-for do template.
      fechando.value = fechando.value.filter((f) => slotKey(f.slot) !== key)
      const g = novaGeracao(key)
      if (primeiraCarga) continue

      roomPhase.set(key, 'pending')
      lookPoint.value = localCenterPx(d.slot, [ROOM_W >> 1, ROOM_H >> 1])
      kick()

      agendar(() => {
        if (geracao.get(key) !== g) return
        roomPhase.set(key, 'building')
        agendar(() => {
          if (geracao.get(key) !== g) return
          roomPhase.delete(key)
          for (const { pessoa, dominio, idx } of porPessoa.value.values()) {
            if (slotKey(dominio.slot) !== key) continue
            const a = actors.get(pessoa.id)
            if (a?.hidden) iniciarEntrada(a, dominio, idx)
          }
        }, ROOM_BUILD_MS)
      }, ROOM_PAN_MS)
    }

    // Salas que ficaram guardam a forma nova (nome, template): se saírem
    // depois, fecham com a aparência atual.
    for (const d of dominios.value) knownRooms.set(slotKey(d.slot), d)
  }
```

6. Em `syncActors`, depois do bloco `if (!a) { ... }`, acrescente um `else`:

```ts
      } else if (!a.hidden) {
        a.dominioId = dominio.id
        const [x, y] = stationPx(dominio, idx)
        if (!unlocked.value.has(slotKey(a.slot))) {
          // A sala onde ele estava (ou para onde ia) foi arquivada. O BFS parte
          // de um slot desbloqueado, então não há rota de volta: vai direto à cadeira.
          a.x = x
          a.y = y
          a.slot = dominio.slot
          a.route = []
          a.walking = false
        } else if (!a.walking && slotKey(a.slot) === slotKey(dominio.slot)) {
          // Reassento: substituir PO, arquivar integrante ou promover o template
          // muda a ordem das cadeiras. Parado na própria sala, senta na cadeira nova.
          a.x = x
          a.y = y
        }
      }
```

   Ajuste as chaves para que `paint(a)` continue rodando para todo ator depois do `if/else`. Depois do bloco, o `let a` já está definido nos dois ramos.

- [ ] **Step 6: `GameMap.vue` e `index.css`**

Em `faseClasse` (`GameMap.vue`), acrescente `'room--closing': room.phase === 'closing',` e, no comentário acima, a frase `'closing' toca room-build ao contrário: a sala de um domínio arquivado some no lugar em que estava.`

Em `src/index.css`, depois de `.room-objects.room--new`:

```css
/* Domínio arquivado: a sala desmaterializa com a mesma animação, ao contrário
   (spec Fase 2 §8). Casado com ROOM_BUILD_MS em useOffice.ts. */
.floor.room--closing,
.base.room--closing {
  animation: room-build 450ms steps(6, end) reverse both;
}

.room-objects.room--closing {
  animation: room-build-objects 450ms steps(6, end) reverse both;
}
```

- [ ] **Step 7: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build && cd "$SCRATCH/fase2" && npx tsx salas.ts
```

Esperado: sem erros; `OK salas`.

- [ ] **Step 8: Fumaça no navegador (sem gestos ainda)**

```bash
TMPD=$(mktemp -d "$SCRATCH/fase2-mapa-XXXX")
cp -r "$REPO/seed" "$TMPD/seed" && cp -r "$REPO/dist" "$TMPD/dist" && mkdir "$TMPD/data"
cd "$SCRATCH/fase2" && npx tsx util.ts fixture-f2 > "$TMPD/data/squad.json"
cd "$TMPD" && PORT=3928 NODE_ENV=production GEMINI_API_KEY=fake IPS_PERMITIDOS= node "$REPO/dist/server.cjs" > "$TMPD/server.log" 2>&1 &
echo $! > "$TMPD/pid"
```

Abra `http://127.0.0.1:3928`. Confirme:

- as salas Casa e Financeiro aparecem;
- no console da página, `document.querySelectorAll('.room--closing, .room--pending, .room--new').length === 0` depois de 2 s: a primeira carga não anima;
- não há erros no console.

Pare o servidor: `kill "$(cat "$TMPD/pid")"`.

- [ ] **Step 9: Commit**

```bash
cd "$REPO" && git add src/office/salas.ts src/office/useOffice.ts src/components/GameMap.vue src/index.css && git commit -m "$(cat <<'EOF'
feat(escritorio): sala arquivada fecha e slot reaberto anima de novo

knownRooms guardava so slots e nunca esquecia: uma sala que saisse e
voltasse no mesmo slot nasceria sem obra. Agora guarda o dominio dono de
cada slot, e a diferenca entre o que o escritorio conhece e o roster sai de
uma funcao pura testavel. Sala que sai toca room-build ao contrario; cada
timer carrega a geracao do slot para nao atropelar a sala seguinte.

Ator parado numa sala que deixou de existir volta direto para a cadeira (o
BFS nao parte de slot vazio), e quem esta parado na propria sala reassenta
quando a ordem das cadeiras muda.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: UI de contratação — painel de salas, modal com redação e Ajustar no card

**Files:**
- Modify: `src/types.ts`
- Create: `src/rosterApi.ts`
- Create: `src/components/SalasPainel.vue`
- Create: `src/components/ContratarModal.vue`
- Modify: `src/components/GrowthCard.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: contratos HTTP da Task 4 (spec §4).
- Produces (Task 7):
  - `src/types.ts`:
    - `LIMITES`;
    - `IntegranteArquivadoView`, `SquadView` (com `proximoSlot` e `arquivo`), `RosterView` (com `squadsArquivadas`);
    - `PedidoDeRedacao`, `RedacaoDePessoa`, `RedacaoDeDominio`, `Redacao`;
    - `HireResponse`, `SubstituicaoResponse`;
    - `AlvoDeContratacao`, `PreenchimentoDeContratacao`, `DadosDeContratacao`.
  - `src/rosterApi.ts`:
    - `class ErroDaApi extends Error { status: number; corpo: Record<string, any> }`;
    - `type TipoDoRoster = 'pessoas' | 'dominios' | 'squads'`;
    - `rosterApi.{ redigir, contratar, substituirPo, editar, arquivar, reativar }`;
    - `mensagemDeRedacao(err: unknown): string`.
  - `SalasPainel.vue`:
    - props `squad: SquadView`, `totalArquivado: number`, `desabilitado: boolean`;
    - eventos `contratar(dominioId)`, `abrirSala()`, `substituirPo(dominioId)`, `editarPessoa(pessoaId)`, `arquivarPessoa(pessoaId)`, `editarDominio(dominioId)`, `arquivarDominio(dominioId)`, `abrirArquivo()`.
  - `App.vue`: `squadAtiva`, `roster`, `avisar`, `carregarMochila`, `recuperarSquadInexistente` (Fase 1) e o novo `enviandoContratacao`.

- [ ] **Step 0: Reler o frontend pós-Fase 3**

Rode `git log --oneline -10 -- src`. Leia `src/types.ts`, `src/App.vue`, `src/components/GrowthCard.vue` e `src/components/SquadSelector.vue` inteiros, **como a Fase 3 deixou**. A Fase 3 mexe em `types.ts` (`EventoCriado`, `AvisoTarefa`, `TurnoResponse.avisos`, `QuestCalendario.prazoRef`) e no `alert` do turno em `App.vue`. Preserve tudo isso. Os trechos abaixo sobre `App.vue` valem pela intenção: acrescente estado, funções e template sem reescrever o que já existe. `DadosNovaSquad` continua em `src/types.ts` e `POST /api/squad/nova` não muda.

- [ ] **Step 1: `src/types.ts`**

1. `Pessoa` e `Dominio`: troque o comentário "Reservado (Fase 2)" de `arquivado` por `Arquivado: fora do mapa e do prompt; vem só em SquadView.arquivo.` e acrescente `arquivadoEm?: string;`. `Squad` ganha `arquivado?: boolean;` e `arquivadoEm?: string;`.

2. Substitua `SquadView` e `RosterView` por:

```ts
export interface IntegranteArquivadoView {
  pessoa: Pessoa;
  dominioId: string;
  dominioNome: string;
}

/**
 * `dominios` e `integrantes` só com ATIVOS: GameMap, seletor e Mochila leem
 * estes campos sem saber que arquivamento existe. O arquivado vem à parte.
 */
export type SquadView = Squad & {
  unlockedSlots: [number, number][];
  proximoSlot: [number, number] | null;
  arquivo: { dominios: Dominio[]; integrantes: IntegranteArquivadoView[] };
};

/** `GET /api/squad`: squads ativas + arquivadas. A ativa é escolha da aba. */
export interface RosterView {
  version: 3;
  squads: SquadView[];
  squadsArquivadas: SquadView[];
  idsAposentados: { pessoas: string[]; dominios: string[] };
}
```

3. Ao fim do arquivo:

```ts
/** Espelho de LIMITES em server/squad.ts: o formulário corta antes de o servidor recusar. */
export const LIMITES = {
  squadNome: 40,
  squadEscopo: 200,
  dominioNome: 60,
  dominioEscopo: 200,
  pessoaNome: 40,
  papel: 60,
  escopoPessoa: 1500,
  frase: 300,
} as const;

/** Corpo de `POST /api/squad/redigir`. */
export type PedidoDeRedacao =
  | { alvo: "integrante" | "po"; squadId: string; dominioId: string; frase: string }
  | { alvo: "pessoa"; pessoaId: string; frase: string }
  | { alvo: "dominio"; squadId: string; frase: string };

export interface RedacaoDePessoa {
  alvo: "integrante" | "po" | "pessoa";
  papel: string;
  escopo: string;
  truncado: boolean;
}

export interface RedacaoDeDominio {
  alvo: "dominio";
  nome: string;
  escopo_dominio: string;
  papel_po: string;
  escopo_po: string;
  truncado: boolean;
}

export type Redacao = RedacaoDePessoa | RedacaoDeDominio;

export interface HireResponse {
  kind: "dominio" | "integrante";
  squadId: string;
  roster: RosterView;
  dominio: Dominio;
  pessoa: Pessoa;
}

export interface SubstituicaoResponse {
  roster: RosterView;
  po: Pessoa;
  anterior: Pessoa;
}

/** De onde o modal de contratação foi aberto. */
export type AlvoDeContratacao =
  | { alvo: "integrante"; squadId: string; dominio: Dominio }
  | { alvo: "dominio"; squadId: string; slot: [number, number] }
  | { alvo: "po"; squadId: string; dominio: Dominio };

/** Texto inicial do modal quando vem do "Ajustar" de um card do modelo. */
export interface PreenchimentoDeContratacao {
  papel?: string;
  escopo?: string;
  nomeDominio?: string;
  escopoDominio?: string;
}

/** O que o modal entrega ao App. No alvo `dominio`, papel/escopo/nome são do PO. */
export type DadosDeContratacao =
  | { alvo: "integrante"; nome: string; papel: string; escopo: string }
  | { alvo: "dominio"; nome: string; nomeDominio: string; escopoDominio: string; papelPo: string; escopoPo: string }
  | { alvo: "po"; integranteId: string }
  | { alvo: "po"; nome: string; papel: string; escopo: string };
```

- [ ] **Step 2: `src/rosterApi.ts`**

```ts
/**
 * Escritas no roster da Fase 2. O erro carrega status e corpo porque a UI
 * decide pela CLASSIFICAÇÃO (`modeloOcupado`, `redacaoFalhou`,
 * `squadInexistente`), não pelo texto da mensagem.
 */
import type { HireResponse, PedidoDeRedacao, Redacao, RosterView, SubstituicaoResponse } from './types'

export class ErroDaApi extends Error {
  readonly status: number
  readonly corpo: Record<string, any>
  constructor(status: number, corpo: Record<string, any>) {
    super(corpo.error ?? `HTTP ${status}`)
    this.name = 'ErroDaApi'
    this.status = status
    this.corpo = corpo
  }
}

async function chamar<T>(metodo: 'POST' | 'PATCH', rota: string, corpo?: unknown): Promise<T> {
  const response = await fetch(rota, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  })
  const dados = await response.json().catch(() => ({}))
  if (!response.ok) throw new ErroDaApi(response.status, dados)
  return dados as T
}

/** Segmento do caminho nas rotas de ciclo de vida. */
export type TipoDoRoster = 'pessoas' | 'dominios' | 'squads'

const seg = encodeURIComponent

export const rosterApi = {
  redigir: (pedido: PedidoDeRedacao) => chamar<Redacao>('POST', '/api/squad/redigir', pedido),
  contratar: (sugestao: Record<string, unknown>, nome?: string) =>
    chamar<HireResponse>('POST', '/api/squad/hire', { sugestao, nome }),
  substituirPo: (dominioId: string, corpo: { integranteId: string } | { nome?: string; papel: string; escopo: string }) =>
    chamar<SubstituicaoResponse>('POST', `/api/squad/dominios/${seg(dominioId)}/po`, corpo),
  editar: (tipo: TipoDoRoster, id: string, corpo: Record<string, string>) =>
    chamar<{ roster: RosterView }>('PATCH', `/api/squad/${tipo}/${seg(id)}`, corpo),
  arquivar: (tipo: TipoDoRoster, id: string) =>
    chamar<{ roster: RosterView }>('POST', `/api/squad/${tipo}/${seg(id)}/arquivar`),
  reativar: (tipo: TipoDoRoster, id: string) =>
    chamar<{ roster: RosterView }>('POST', `/api/squad/${tipo}/${seg(id)}/reativar`)
}

/**
 * Mensagem de falha da redação. Toda falha termina oferecendo escrever à mão:
 * redigir é ajuda, nunca pré-requisito para contratar.
 */
export function mensagemDeRedacao(err: unknown): string {
  if (err instanceof ErroDaApi) {
    if (err.corpo.modeloOcupado) return 'Gemini ocupado agora. Tente de novo em alguns segundos ou escreva à mão.'
    if (err.corpo.redacaoFalhou) return `${err.message} Você pode escrever à mão.`
    return err.message
  }
  return 'Sem resposta do servidor. Escreva à mão ou tente de novo.'
}
```

- [ ] **Step 3: `src/components/SalasPainel.vue`**

```vue
<script setup lang="ts">
/**
 * Gestos por sala, FORA do canvas (spec Fase 2 §3.1). O GameMap segue com
 * pointer-events: none e sem eventos: um overlay isométrico teria de seguir
 * câmera, escala e projeção; botões aqui fazem o mesmo sem nada disso.
 * Só emite. Quem chama a API é o App.
 */
import type { Dominio, SquadView } from '../types'

const props = defineProps<{ squad: SquadView; totalArquivado: number; desabilitado: boolean }>()

const emit = defineEmits<{
  contratar: [dominioId: string]
  abrirSala: []
  substituirPo: [dominioId: string]
  editarPessoa: [pessoaId: string]
  arquivarPessoa: [pessoaId: string]
  editarDominio: [dominioId: string]
  arquivarDominio: [dominioId: string]
  abrirArquivo: []
}>()

/** dominios[0] nunca é arquivado: o PO dele é quem circula pelo escritório. */
const ehRaiz = (d: Dominio) => d.id === props.squad.dominios[0]?.id

const BOTAO =
  'border-2 border-black bg-white px-2 py-0.5 font-black text-xs uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-40'
const MINI = 'ml-1 font-black disabled:opacity-40'
</script>

<template>
  <section class="border-4 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] shrink-0">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b-4 border-black bg-[#f4f0e6] px-3 py-2">
      <span class="font-black uppercase text-sm">🏢 Salas de {{ squad.nome }}</span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          :class="BOTAO"
          :disabled="desabilitado || !squad.proximoSlot"
          :title="squad.proximoSlot ? 'Abrir um domínio novo no próximo slot livre' : 'As 9 salas estão ocupadas'"
          @click="emit('abrirSala')"
        >
          {{ squad.proximoSlot ? `+ Abrir sala (${squad.proximoSlot[0]},${squad.proximoSlot[1]})` : 'Escritório cheio' }}
        </button>
        <button type="button" :class="BOTAO" :disabled="desabilitado" @click="emit('abrirArquivo')">
          🗄 Arquivo ({{ totalArquivado }})
        </button>
      </div>
    </div>

    <ul class="divide-y-2 divide-black">
      <li v-for="d in squad.dominios" :key="d.id" class="flex flex-wrap items-center gap-2 px-3 py-2">
        <span class="font-black text-sm uppercase">{{ d.nome }}</span>
        <button type="button" :class="MINI" :disabled="desabilitado" title="Editar domínio" @click="emit('editarDominio', d.id)">✎</button>
        <button
          type="button"
          :class="MINI"
          :disabled="desabilitado || ehRaiz(d)"
          :title="ehRaiz(d) ? 'Sala raiz: o PO dela circula pelo escritório. Arquive a squad inteira ou substitua o PO.' : 'Arquivar domínio'"
          @click="emit('arquivarDominio', d.id)"
        >🗄</button>

        <span class="flex flex-wrap items-center gap-1 text-xs font-bold">
          <span class="border-2 border-black bg-[#ffdb58] px-1">
            {{ d.po.nome }} · {{ d.po.papel }}
            <button type="button" :class="MINI" :disabled="desabilitado" title="Editar treino" @click="emit('editarPessoa', d.po.id)">✎</button>
            <button type="button" :class="MINI" :disabled="desabilitado" title="Substituir PO (PO não se arquiva)" @click="emit('substituirPo', d.id)">⇄</button>
          </span>
          <span v-for="p in d.integrantes" :key="p.id" class="border-2 border-black px-1">
            {{ p.nome }} · {{ p.papel }}
            <button type="button" :class="MINI" :disabled="desabilitado" title="Editar treino" @click="emit('editarPessoa', p.id)">✎</button>
            <button type="button" :class="MINI" :disabled="desabilitado" title="Arquivar" @click="emit('arquivarPessoa', p.id)">🗄</button>
          </span>
        </span>

        <button type="button" :class="BOTAO + ' ml-auto'" :disabled="desabilitado" @click="emit('contratar', d.id)">+ Contratar</button>
      </li>
    </ul>
  </section>
</template>
```

- [ ] **Step 4: `src/components/ContratarModal.vue`**

```vue
<script setup lang="ts">
/**
 * Contratar integrante, abrir sala (domínio + PO) ou substituir PO (spec
 * Fase 2 §3.2). A frase + "Redigir com Gemini" é AJUDA: toda falha vira
 * mensagem acima dos campos, que seguem editáveis, e contratar à mão sempre
 * funciona. A frase não é salva; o que vai para o roster é papel + escopo.
 * Sem campo de horário: janela de agenda é global (Fase 3).
 */
import { computed, reactive, ref } from 'vue'
import { LIMITES, type AlvoDeContratacao, type DadosDeContratacao, type PreenchimentoDeContratacao } from '../types'
import { mensagemDeRedacao, rosterApi } from '../rosterApi'

const props = defineProps<{
  alvo: AlvoDeContratacao
  inicial?: PreenchimentoDeContratacao
  enviando: boolean
  erro: string
}>()

const emit = defineEmits<{ contratar: [dados: DadosDeContratacao]; fechar: [] }>()

/** O formato que o Gemini também segue (spec §5.3), mostrado como exemplo. */
const PLACEHOLDER_ESCOPO =
  'Missão: ...\nCuida de: ...; ...\nNão cuida de: ...\nAo opinar sobre um compromisso: ...\nSinais de alerta: ...'

const form = reactive({
  frase: '',
  nome: '',
  papel: props.inicial?.papel ?? '',
  escopo: props.inicial?.escopo ?? '',
  nomeDominio: props.inicial?.nomeDominio ?? '',
  escopoDominio: props.inicial?.escopoDominio ?? '',
  /** Substituir PO: id do integrante a promover; vazio = pessoa nova. */
  integranteId: ''
})
const redigindo = ref(false)
const erroRedacao = ref('')
const avisoTruncado = ref(false)

const titulo = computed(() => {
  const a = props.alvo
  if (a.alvo === 'integrante') return `Contratar em ${a.dominio.nome}`
  if (a.alvo === 'po') return `Substituir o PO de ${a.dominio.nome}`
  return `Abrir sala (${a.slot[0]},${a.slot[1]})`
})
const integrantes = computed(() => (props.alvo.alvo === 'po' ? props.alvo.dominio.integrantes : []))
const promovendo = computed(() => props.alvo.alvo === 'po' && form.integranteId !== '')

const podeContratar = computed(() => {
  if (props.enviando || redigindo.value) return false
  if (promovendo.value) return true
  const pessoaOk = form.papel.trim() !== '' && form.escopo.trim() !== ''
  if (props.alvo.alvo === 'dominio') {
    return pessoaOk && form.nomeDominio.trim() !== '' && form.escopoDominio.trim() !== ''
  }
  return pessoaOk
})

const temTexto = () => [form.papel, form.escopo, form.nomeDominio, form.escopoDominio].some((v) => v.trim() !== '')

const redigir = async () => {
  const frase = form.frase.trim()
  if (!frase || redigindo.value) return
  redigindo.value = true
  erroRedacao.value = ''
  avisoTruncado.value = false
  try {
    const a = props.alvo
    const r = await rosterApi.redigir(
      a.alvo === 'dominio'
        ? { alvo: 'dominio', squadId: a.squadId, frase }
        : { alvo: a.alvo, squadId: a.squadId, dominioId: a.dominio.id, frase }
    )
    // O usuário pode ter escrito enquanto esperava: sobrescrever calado perderia o texto dele.
    if (temTexto() && !window.confirm('Substituir o texto atual pelo redigido?')) return
    if (r.alvo === 'dominio') {
      form.nomeDominio = r.nome
      form.escopoDominio = r.escopo_dominio
      form.papel = r.papel_po
      form.escopo = r.escopo_po
    } else {
      form.papel = r.papel
      form.escopo = r.escopo
    }
    avisoTruncado.value = r.truncado
  } catch (error) {
    erroRedacao.value = mensagemDeRedacao(error)
  } finally {
    redigindo.value = false
  }
}

const contratar = () => {
  if (!podeContratar.value) return
  const a = props.alvo
  if (a.alvo === 'po' && form.integranteId) {
    emit('contratar', { alvo: 'po', integranteId: form.integranteId })
  } else if (a.alvo === 'dominio') {
    emit('contratar', {
      alvo: 'dominio',
      nome: form.nome.trim(),
      nomeDominio: form.nomeDominio.trim(),
      escopoDominio: form.escopoDominio.trim(),
      papelPo: form.papel.trim(),
      escopoPo: form.escopo.trim()
    })
  } else if (a.alvo === 'po') {
    emit('contratar', { alvo: 'po', nome: form.nome.trim(), papel: form.papel.trim(), escopo: form.escopo.trim() })
  } else {
    emit('contratar', { alvo: 'integrante', nome: form.nome.trim(), papel: form.papel.trim(), escopo: form.escopo.trim() })
  }
}

const CAMPO =
  'border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58] disabled:opacity-50'
const ROTULO = 'flex flex-col gap-1 text-xs font-black uppercase'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('fechar')">
    <form
      class="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-y-auto border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
      @submit.prevent="contratar"
    >
      <h2 class="font-black text-xl uppercase">🤝 {{ titulo }}</h2>

      <label v-if="alvo.alvo === 'po'" :class="ROTULO">
        Quem assume
        <select v-model="form.integranteId" :disabled="enviando" :class="CAMPO">
          <option value="">Pessoa nova</option>
          <option v-for="p in integrantes" :key="p.id" :value="p.id">Promover {{ p.nome }} · {{ p.papel }}</option>
        </select>
      </label>

      <template v-if="!promovendo">
        <div class="flex flex-col gap-1 border-2 border-dashed border-black p-2">
          <label :class="ROTULO">
            Em uma frase, o que você precisa
            <textarea
              v-model="form.frase"
              rows="2"
              :maxlength="LIMITES.frase"
              :disabled="enviando"
              placeholder="alguém para cuidar do meu imposto de renda e das notas da PJ"
              :class="CAMPO"
            ></textarea>
          </label>
          <button
            type="button"
            :disabled="redigindo || enviando || !form.frase.trim()"
            class="self-start border-4 border-black bg-[#bbf7d0] px-3 py-1 font-black text-xs uppercase disabled:opacity-50"
            @click="redigir"
          >
            {{ redigindo ? 'Redigindo...' : '✨ Redigir com Gemini' }}
          </button>
          <p class="text-xs font-bold opacity-70">Opcional: você pode preencher tudo à mão.</p>
        </div>

        <p v-if="erroRedacao" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erroRedacao }}</p>
        <p v-if="avisoTruncado" class="border-2 border-black bg-[#ffdb58] px-2 py-1 text-xs font-bold">
          O texto veio maior que o limite e foi cortado. Revise o fim.
        </p>

        <template v-if="alvo.alvo === 'dominio'">
          <label :class="ROTULO">
            Nome do domínio
            <input v-model="form.nomeDominio" :maxlength="LIMITES.dominioNome" :disabled="enviando" placeholder="Financeiro" :class="CAMPO" />
          </label>
          <label :class="ROTULO">
            Escopo do domínio (uma linha)
            <input v-model="form.escopoDominio" :maxlength="LIMITES.dominioEscopo" :disabled="enviando" placeholder="contas, impostos e investimentos" :class="CAMPO" />
          </label>
        </template>

        <label :class="ROTULO">
          {{ alvo.alvo === 'integrante' ? 'Nome (opcional)' : 'Nome do PO (opcional)' }}
          <input v-model="form.nome" :maxlength="LIMITES.pessoaNome" :disabled="enviando" :class="CAMPO" />
        </label>
        <label :class="ROTULO">
          {{ alvo.alvo === 'integrante' ? 'Papel' : 'Papel do PO' }}
          <input v-model="form.papel" :maxlength="LIMITES.papel" :disabled="enviando" placeholder="Contador PF" :class="CAMPO" />
        </label>
        <label :class="ROTULO">
          {{ alvo.alvo === 'integrante' ? 'Escopo (treino)' : 'Escopo do PO (treino)' }}
          <textarea
            v-model="form.escopo"
            rows="8"
            :maxlength="LIMITES.escopoPessoa"
            :disabled="enviando"
            :placeholder="PLACEHOLDER_ESCOPO"
            :class="CAMPO"
          ></textarea>
          <span class="self-end text-[10px]">{{ form.escopo.length }}/{{ LIMITES.escopoPessoa }}</span>
        </label>
      </template>

      <p v-if="alvo.alvo === 'po'" class="text-xs font-bold opacity-70">
        O PO atual vira integrante arquivado deste domínio. Os eventos dele continuam no Google.
      </p>
      <p v-if="erro" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erro }}</p>

      <div class="flex justify-end gap-2">
        <button type="button" :disabled="enviando" class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase disabled:opacity-50" @click="emit('fechar')">
          Cancelar
        </button>
        <button
          type="submit"
          :disabled="!podeContratar"
          class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
        >
          {{ enviando ? 'Contratando...' : alvo.alvo === 'po' ? 'Substituir' : 'Contratar' }}
        </button>
      </div>
    </form>
  </div>
</template>
```

- [ ] **Step 5: `src/components/GrowthCard.vue`**

Acrescente `'ajustar'` a `defineEmits` (`defineEmits(['aprovar', 'descartar', 'ajustar'])`) e, entre o botão Aprovar e o ✕:

```vue
      <!-- Ajustar abre o modal de contratação com a proposta pré-preenchida:
           o usuário edita papel/escopo (ou redige de novo) antes de contratar. -->
      <button
        :disabled="enviando"
        title="Editar a proposta antes de contratar"
        class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all disabled:opacity-50"
        @click="emit('ajustar')"
      >
        Ajustar
      </button>
```

- [ ] **Step 6: `src/App.vue`**

Script. Acrescente, preservando o que a Fase 1 e a Fase 3 deixaram:

```ts
import SalasPainel from './components/SalasPainel.vue'
import ContratarModal from './components/ContratarModal.vue'
import { ErroDaApi, rosterApi } from './rosterApi'
import type { AlvoDeContratacao, DadosDeContratacao, PreenchimentoDeContratacao } from './types'

// Modal de contratação aberto pela sala, pelo slot livre ou pelo "Ajustar" de
// um card. `sugestaoId` existe só no último caso: contratar remove o card.
const contratacao = ref<{ alvo: AlvoDeContratacao; inicial?: PreenchimentoDeContratacao; sugestaoId?: string } | null>(null)
const enviandoContratacao = ref(false)
const erroContratacao = ref('')

const totalArquivado = computed(
  () =>
    (squadAtiva.value?.arquivo.dominios.length ?? 0) +
    (squadAtiva.value?.arquivo.integrantes.length ?? 0) +
    (roster.value?.squadsArquivadas.length ?? 0)
)

const acharDominioAtivo = (id: string) => squadAtiva.value?.dominios.find((d) => d.id === id)

const abrirContratacao = (alvo: AlvoDeContratacao, inicial?: PreenchimentoDeContratacao, sugestaoId?: string) => {
  erroContratacao.value = ''
  contratacao.value = { alvo, inicial, sugestaoId }
}

const contratarNaSala = (dominioId: string) => {
  const dominio = acharDominioAtivo(dominioId)
  if (dominio && squadAtiva.value) abrirContratacao({ alvo: 'integrante', squadId: squadAtiva.value.id, dominio })
}

const abrirSala = () => {
  const squad = squadAtiva.value
  if (squad?.proximoSlot) abrirContratacao({ alvo: 'dominio', squadId: squad.id, slot: squad.proximoSlot })
}

const substituirPoDaSala = (dominioId: string) => {
  const dominio = acharDominioAtivo(dominioId)
  if (dominio && squadAtiva.value) abrirContratacao({ alvo: 'po', squadId: squadAtiva.value.id, dominio })
}

/** "Ajustar" do card: o mesmo modal, com a proposta do modelo como ponto de partida. */
const ajustarSugestao = (id: string) => {
  const s = sugestoes.value.find((x) => x.id === id)
  if (!s || s.kind === 'troca_squad') return
  const falhar = (msg: string) => (erroSugestao.value = { ...erroSugestao.value, [id]: msg })
  const squad = roster.value?.squads.find((q) => q.id === s.squad_id)
  if (!squad) return falhar('A squad desta proposta não está ativa.')
  if (s.kind === 'integrante') {
    const dominio = squad.dominios.find((d) => d.id === s.dominio_id)
    if (!dominio) return falhar('O domínio desta proposta não está mais ativo.')
    abrirContratacao({ alvo: 'integrante', squadId: squad.id, dominio }, { papel: s.papel, escopo: s.escopo }, id)
  } else {
    if (!squad.proximoSlot) return falhar('Escritório cheio: não há sala livre.')
    abrirContratacao(
      { alvo: 'dominio', squadId: squad.id, slot: squad.proximoSlot },
      { nomeDominio: s.dominio, escopoDominio: s.escopo, papel: s.papel_po, escopo: s.escopo },
      id
    )
  }
}

/**
 * Contratar pela UI usa as mesmas rotas do card (hire) e da substituição de PO.
 * Trocar `roster` é o único gatilho de que o escritório precisa: o GameMap vê a
 * sala ou a pessoa nova e anima sozinho.
 */
const confirmarContratacao = async (dados: DadosDeContratacao) => {
  const atual = contratacao.value
  if (!atual || enviandoContratacao.value) return
  const { alvo } = atual
  enviandoContratacao.value = true
  erroContratacao.value = ''
  try {
    if (dados.alvo === 'po' && alvo.alvo === 'po') {
      const corpo =
        'integranteId' in dados
          ? { integranteId: dados.integranteId }
          : { nome: dados.nome || undefined, papel: dados.papel, escopo: dados.escopo }
      const r = await rosterApi.substituirPo(alvo.dominio.id, corpo)
      roster.value = r.roster
      avisar(`${r.po.nome} é o novo PO de ${alvo.dominio.nome}`)
    } else if (dados.alvo === 'integrante' && alvo.alvo === 'integrante') {
      const r = await rosterApi.contratar(
        { kind: 'integrante', squad_id: alvo.squadId, dominio_id: alvo.dominio.id, papel: dados.papel, escopo: dados.escopo },
        dados.nome || undefined
      )
      roster.value = r.roster
      avisar(`${r.pessoa.nome} entrou em ${r.dominio.nome}`)
    } else if (dados.alvo === 'dominio' && alvo.alvo === 'dominio') {
      const r = await rosterApi.contratar(
        {
          kind: 'dominio',
          squad_id: alvo.squadId,
          dominio: dados.nomeDominio,
          escopo: dados.escopoDominio,
          papel_po: dados.papelPo,
          escopo_po: dados.escopoPo
        },
        dados.nome || undefined
      )
      roster.value = r.roster
      avisar(`${r.pessoa.nome} abriu o domínio ${r.dominio.nome}`)
    }
    if (atual.sugestaoId) descartarSugestao(atual.sugestaoId)
    contratacao.value = null
  } catch (error) {
    // Squad sumiu ou foi arquivada em outra aba: mesmo gesto da Fase 1.
    if (error instanceof ErroDaApi && error.corpo.squadInexistente) {
      contratacao.value = null
      await recuperarSquadInexistente()
      return
    }
    erroContratacao.value = error instanceof Error ? error.message : String(error)
  } finally {
    enviandoContratacao.value = false
  }
}
```

Template:

1. No `GrowthCard`, acrescente `@ajustar="ajustarSugestao(sugestao.id)"`.
2. Entre a lista de `GrowthCard` e o `GameMap`:

```vue
        <!-- Gestos por sala fora do canvas: o mapa segue sem eventos (Fase 2 §3.1). -->
        <SalasPainel
          v-if="squadAtiva"
          :squad="squadAtiva"
          :total-arquivado="totalArquivado"
          :desabilitado="isLoading || enviandoContratacao"
          @contratar="contratarNaSala"
          @abrir-sala="abrirSala"
          @substituir-po="substituirPoDaSala"
        />
```

3. Antes de `NovaSquadModal`:

```vue
    <ContratarModal
      v-if="contratacao"
      :alvo="contratacao.alvo"
      :inicial="contratacao.inicial"
      :enviando="enviandoContratacao"
      :erro="erroContratacao"
      @contratar="confirmarContratacao"
      @fechar="contratacao = null"
    />
```

- [ ] **Step 7: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros. Se `vue-tsc` recusar o `emit` com união em `ContratarModal`, mantenha os quatro ramos explícitos do Step 4; não use `as any`.

- [ ] **Step 8: Verificação no navegador (sem Google, sem Gemini)**

```bash
TMPD=$(mktemp -d "$SCRATCH/fase2-ui-XXXX")
cp -r "$REPO/seed" "$TMPD/seed" && cp -r "$REPO/dist" "$TMPD/dist" && mkdir "$TMPD/data"
cd "$SCRATCH/fase2" && npx tsx util.ts fixture-f2 > "$TMPD/data/squad.json"
cd "$TMPD" && PORT=3929 NODE_ENV=production GEMINI_API_KEY=fake IPS_PERMITIDOS= node "$REPO/dist/server.cjs" > "$TMPD/server.log" 2>&1 &
echo $! > "$TMPD/pid"
```

Abra `http://127.0.0.1:3929`. **Antes de qualquer clique em "Redigir"**, intercepte a rota no console da página, para que nenhuma chamada chegue ao Gemini:

```js
window.__fetchOriginal = window.fetch
window.__redacao = { status: 503, corpo: { error: 'Os modelos do Gemini estão sobrecarregados agora.', modeloOcupado: true } }
window.fetch = (url, init) =>
  String(url).includes('/api/squad/redigir')
    ? Promise.resolve(new Response(JSON.stringify(window.__redacao.corpo), { status: window.__redacao.status, headers: { 'Content-Type': 'application/json' } }))
    : window.__fetchOriginal(url, init)
```

Verifique:

1. O painel mostra "Salas de Pessoal" com Casa (Rômulo, Ana) e Financeiro (Fin), e o botão "+ Abrir sala (0,1)". O 🗄 de Casa está desabilitado.
2. Anote `document.querySelectorAll('.actor').length` (esperado 3). Em Casa, **+ Contratar** → Papel "Designer", Escopo "Missão: telas" → **Contratar**. O toast diz "... entrou em Casa" e, depois de 2 s, `.actor` passa a 4.
3. **+ Contratar** de novo → frase "alguém para o IR" → **Redigir com Gemini** → aparece a mensagem "Gemini ocupado agora..." e os campos Papel/Escopo continuam editáveis.
4. No console: `window.__redacao = { status: 200, corpo: { alvo: 'integrante', papel: 'Contador', escopo: 'Missão: IR\nCuida de: notas', truncado: true } }`. Clique **Redigir** de novo: Papel vira "Contador", o escopo tem 2 linhas e aparece o aviso de corte. Clique **Cancelar**.
5. **+ Abrir sala (0,1)** → Nome do domínio "Saúde", Escopo do domínio "saúde", Papel do PO "PO Saúde", Escopo do PO "Missão: saúde" → **Contratar**. Em até 1 s, `document.querySelectorAll('.room--pending, .room--new').length > 0`; depois de 3 s a placa "Saúde" aparece e as fases zeram.
6. Em Casa, **⇄** → "Promover Ana" → **Substituir**. O toast diz "Ana é o novo PO de Casa". Depois de 2 s, `[...document.querySelectorAll('.actor')].filter((e) => e.style.visibility === 'hidden').length === 0`.
7. Console sem erros.

Pare o servidor: `kill "$(cat "$TMPD/pid")"`.

- [ ] **Step 9: Commit**

```bash
cd "$REPO" && git add src/types.ts src/rosterApi.ts src/components/SalasPainel.vue src/components/ContratarModal.vue src/components/GrowthCard.vue src/App.vue && git commit -m "$(cat <<'EOF'
feat(ui): contratar pela sala, abrir sala e substituir PO com redacao

Um painel fora do canvas da os gestos por sala: o GameMap segue sem
eventos, e botoes aqui dispensam acompanhar camera e projecao. O modal de
contratacao aceita uma frase e pede ao Gemini papel e escopo; qualquer
falha vira mensagem e os campos seguem editaveis, porque redigir e ajuda,
nao requisito. Cards do modelo ganham Ajustar, que abre o mesmo modal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: UI de ciclo de vida — editar, arquivar, Arquivo e reativar

**Files:**
- Modify: `src/types.ts` (só `AlvoDeEdicao`)
- Create: `src/components/EditarModal.vue`
- Create: `src/components/ArquivoModal.vue`
- Modify: `src/components/SquadSelector.vue`
- Modify: `src/components/QuestBackpack.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes (Task 6): `rosterApi`, `ErroDaApi`, `mensagemDeRedacao`, `TipoDoRoster`, `LIMITES`, `SquadView`, `RosterView`, os eventos do `SalasPainel`, `enviandoContratacao`, `acharDominioAtivo`; (Fase 1) `trocarSquad`, `carregarMochila`, `avisar`, `squadAtivaId`, `gravarSquadAtiva`, `quests`, `currentAgent`.
- Produces:
  - `type AlvoDeEdicao = { tipo: 'pessoa'; pessoa: Pessoa } | { tipo: 'dominio'; dominio: Dominio } | { tipo: 'squad'; squad: SquadView }`;
  - `EditarModal` com eventos `salvar(corpo: Record<string, string>)` e `fechar`;
  - `ArquivoModal` com eventos `reativar(tipo: TipoDoRoster, id: string)` e `fechar`.

- [ ] **Step 0: Reler o frontend pós-Fase 3**

Leia `src/App.vue`, `src/types.ts`, `src/components/SquadSelector.vue` e `src/components/QuestBackpack.vue` inteiros, como a Task 6 e a Fase 3 deixaram. A Fase 3 muda as linhas de tipo e prazo do card da Mochila e o `alert` do turno: preserve. Em `QuestBackpack` esta task só troca o texto do badge do membro.

- [ ] **Step 1: `src/types.ts`**

Ao fim:

```ts
/** De onde o modal de edição foi aberto. Ids nunca são editáveis. */
export type AlvoDeEdicao =
  | { tipo: "pessoa"; pessoa: Pessoa }
  | { tipo: "dominio"; dominio: Dominio }
  | { tipo: "squad"; squad: SquadView };
```

- [ ] **Step 2: `src/components/EditarModal.vue`**

```vue
<script setup lang="ts">
/**
 * Editar texto do roster (spec Fase 2 §3.3): papel/escopo de pessoa, nome/escopo
 * de domínio e de squad. Ids não aparecem nem mudam. Só os campos alterados
 * vão no PATCH, e o servidor recusa (400) texto acima do limite em vez de
 * cortar o que o usuário revisou.
 */
import { computed, reactive, ref } from 'vue'
import { LIMITES, type AlvoDeEdicao } from '../types'
import { mensagemDeRedacao, rosterApi } from '../rosterApi'

const props = defineProps<{ alvo: AlvoDeEdicao; enviando: boolean; erro: string }>()
const emit = defineEmits<{ salvar: [corpo: Record<string, string>]; fechar: [] }>()

/** Valores de partida: a diferença contra eles é o corpo do PATCH. */
const original = (() => {
  const a = props.alvo
  if (a.tipo === 'pessoa') return { primeiro: a.pessoa.papel, escopo: a.pessoa.escopo }
  if (a.tipo === 'dominio') return { primeiro: a.dominio.nome, escopo: a.dominio.escopo }
  return { primeiro: a.squad.nome, escopo: a.squad.escopo }
})()

const form = reactive({ primeiro: original.primeiro, escopo: original.escopo, frase: '' })
const redigindo = ref(false)
const erroRedacao = ref('')

const ehPessoa = computed(() => props.alvo.tipo === 'pessoa')
const titulo = computed(() => {
  const a = props.alvo
  if (a.tipo === 'pessoa') return `Editar ${a.pessoa.nome}`
  if (a.tipo === 'dominio') return `Editar a sala ${a.dominio.nome}`
  return `Editar a squad ${a.squad.nome}`
})
const rotuloPrimeiro = computed(() => (ehPessoa.value ? 'Papel' : 'Nome'))
const limitePrimeiro = computed(() =>
  props.alvo.tipo === 'pessoa' ? LIMITES.papel : props.alvo.tipo === 'dominio' ? LIMITES.dominioNome : LIMITES.squadNome
)
const limiteEscopo = computed(() =>
  props.alvo.tipo === 'pessoa' ? LIMITES.escopoPessoa : props.alvo.tipo === 'dominio' ? LIMITES.dominioEscopo : LIMITES.squadEscopo
)

const mudancas = computed<Record<string, string>>(() => {
  const corpo: Record<string, string> = {}
  const chave = ehPessoa.value ? 'papel' : 'nome'
  if (form.primeiro.trim() !== original.primeiro) corpo[chave] = form.primeiro.trim()
  if (form.escopo.trim() !== original.escopo) corpo.escopo = form.escopo.trim()
  return corpo
})
const podeSalvar = computed(
  () =>
    !props.enviando &&
    !redigindo.value &&
    Object.keys(mudancas.value).length > 0 &&
    form.primeiro.trim() !== '' &&
    form.escopo.trim() !== ''
)

/** Reescrever treino existente: mesma regra do modal de contratação (ajuda, nunca bloqueio). */
const reescrever = async () => {
  const a = props.alvo
  const frase = form.frase.trim()
  if (a.tipo !== 'pessoa' || !frase || redigindo.value) return
  redigindo.value = true
  erroRedacao.value = ''
  try {
    const r = await rosterApi.redigir({ alvo: 'pessoa', pessoaId: a.pessoa.id, frase })
    if (r.alvo === 'dominio') return
    if (!window.confirm('Substituir o texto atual pelo redigido?')) return
    form.primeiro = r.papel
    form.escopo = r.escopo
  } catch (error) {
    erroRedacao.value = mensagemDeRedacao(error)
  } finally {
    redigindo.value = false
  }
}

const CAMPO = 'border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58] disabled:opacity-50'
const ROTULO = 'flex flex-col gap-1 text-xs font-black uppercase'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('fechar')">
    <form
      class="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-y-auto border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
      @submit.prevent="podeSalvar && emit('salvar', mudancas)"
    >
      <h2 class="font-black text-xl uppercase">✎ {{ titulo }}</h2>

      <div v-if="ehPessoa" class="flex flex-col gap-1 border-2 border-dashed border-black p-2">
        <label :class="ROTULO">
          Reescrever o treino a partir de uma frase (opcional)
          <textarea v-model="form.frase" rows="2" :maxlength="LIMITES.frase" :disabled="enviando" :class="CAMPO"></textarea>
        </label>
        <button
          type="button"
          :disabled="redigindo || enviando || !form.frase.trim()"
          class="self-start border-4 border-black bg-[#bbf7d0] px-3 py-1 font-black text-xs uppercase disabled:opacity-50"
          @click="reescrever"
        >
          {{ redigindo ? 'Redigindo...' : '✨ Reescrever com Gemini' }}
        </button>
      </div>
      <p v-if="erroRedacao" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erroRedacao }}</p>

      <label :class="ROTULO">
        {{ rotuloPrimeiro }}
        <input v-model="form.primeiro" :maxlength="limitePrimeiro" :disabled="enviando" :class="CAMPO" />
      </label>
      <label :class="ROTULO">
        Escopo{{ ehPessoa ? ' (treino)' : ' (uma linha)' }}
        <textarea v-if="ehPessoa" v-model="form.escopo" rows="8" :maxlength="limiteEscopo" :disabled="enviando" :class="CAMPO"></textarea>
        <input v-else v-model="form.escopo" :maxlength="limiteEscopo" :disabled="enviando" :class="CAMPO" />
        <span class="self-end text-[10px]">{{ form.escopo.length }}/{{ limiteEscopo }}</span>
      </label>

      <p class="text-xs font-bold opacity-70">
        Mudar o escopo muda para quem as próximas demandas vão. Eventos já criados não mudam.
      </p>
      <p v-if="erro" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erro }}</p>

      <div class="flex justify-end gap-2">
        <button type="button" :disabled="enviando" class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase disabled:opacity-50" @click="emit('fechar')">
          Cancelar
        </button>
        <button
          type="submit"
          :disabled="!podeSalvar"
          class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
        >
          {{ enviando ? 'Salvando...' : 'Salvar' }}
        </button>
      </div>
    </form>
  </div>
</template>
```

- [ ] **Step 3: `src/components/ArquivoModal.vue`**

```vue
<script setup lang="ts">
/**
 * Arquivo da squad ativa + squads arquivadas (spec Fase 2 §3.5). Reativar
 * nunca é automático, e erro (409 "sem sala livre", pai arquivado) fica na
 * linha, com o modal aberto: o usuário decide o que arquivar para abrir espaço.
 */
import type { SquadView } from '../types'
import type { TipoDoRoster } from '../rosterApi'

defineProps<{
  squad: SquadView
  squadsArquivadas: SquadView[]
  /** `${tipo}:${id}` em curso; vazio = nenhum. */
  reativando: string
  erros: Record<string, string>
}>()

const emit = defineEmits<{ reativar: [tipo: TipoDoRoster, id: string]; fechar: [] }>()

const data = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '')
const BOTAO = 'border-2 border-black bg-[#bbf7d0] px-2 py-0.5 font-black text-xs uppercase disabled:opacity-50'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('fechar')">
    <div class="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-y-auto border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
      <h2 class="font-black text-xl uppercase">🗄 Arquivo</h2>
      <p class="text-xs font-bold opacity-70">
        Arquivar não apaga nada. Os eventos continuam no Google; ao reativar, os de um domínio voltam para a Mochila.
      </p>

      <h3 class="font-black text-sm uppercase">Salas arquivadas de {{ squad.nome }}</h3>
      <p v-if="!squad.arquivo.dominios.length" class="text-xs font-bold opacity-60">Nenhuma.</p>
      <div v-for="d in squad.arquivo.dominios" :key="d.id" class="flex flex-col gap-1 border-2 border-black p-2">
        <div class="flex items-center justify-between gap-2 text-sm font-bold">
          <span>{{ d.nome }} · {{ 1 + d.integrantes.length }} pessoa(s) · {{ data(d.arquivadoEm) }}</span>
          <button type="button" :class="BOTAO" :disabled="!!reativando" @click="emit('reativar', 'dominios', d.id)">
            {{ reativando === `dominios:${d.id}` ? '...' : 'Reativar' }}
          </button>
        </div>
        <p v-if="erros[`dominios:${d.id}`]" class="bg-[#ff9b71] px-1 text-xs font-bold">{{ erros[`dominios:${d.id}`] }}</p>
      </div>

      <h3 class="font-black text-sm uppercase">Pessoas arquivadas</h3>
      <p v-if="!squad.arquivo.integrantes.length" class="text-xs font-bold opacity-60">Nenhuma.</p>
      <div v-for="i in squad.arquivo.integrantes" :key="i.pessoa.id" class="flex flex-col gap-1 border-2 border-black p-2">
        <div class="flex items-center justify-between gap-2 text-sm font-bold">
          <span>{{ i.pessoa.nome }} · {{ i.pessoa.papel }} · sala {{ i.dominioNome }}</span>
          <button type="button" :class="BOTAO" :disabled="!!reativando" @click="emit('reativar', 'pessoas', i.pessoa.id)">
            {{ reativando === `pessoas:${i.pessoa.id}` ? '...' : 'Reativar' }}
          </button>
        </div>
        <p v-if="erros[`pessoas:${i.pessoa.id}`]" class="bg-[#ff9b71] px-1 text-xs font-bold">{{ erros[`pessoas:${i.pessoa.id}`] }}</p>
      </div>

      <h3 class="font-black text-sm uppercase">Squads arquivadas</h3>
      <p v-if="!squadsArquivadas.length" class="text-xs font-bold opacity-60">Nenhuma.</p>
      <div v-for="s in squadsArquivadas" :key="s.id" class="flex flex-col gap-1 border-2 border-black p-2">
        <div class="flex items-center justify-between gap-2 text-sm font-bold">
          <span>{{ s.nome }} · {{ s.escopo }}</span>
          <button type="button" :class="BOTAO" :disabled="!!reativando" @click="emit('reativar', 'squads', s.id)">
            {{ reativando === `squads:${s.id}` ? '...' : 'Reativar' }}
          </button>
        </div>
        <p v-if="erros[`squads:${s.id}`]" class="bg-[#ff9b71] px-1 text-xs font-bold">{{ erros[`squads:${s.id}`] }}</p>
      </div>

      <div class="flex justify-end">
        <button type="button" class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase" @click="emit('fechar')">Fechar</button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: `src/components/SquadSelector.vue`**

1. Prop nova: `podeArquivar: { type: Boolean, default: false }`, com o comentário "Falso com uma squad ativa só: a última não se arquiva."
2. `defineEmits<{ trocar: [id: string]; nova: []; editar: []; arquivar: [] }>()`.
3. Depois do `<select>`, antes de **+ Nova squad**:

```vue
    <button
      type="button"
      :disabled="desabilitado"
      title="Editar nome e escopo da squad"
      class="border-4 border-black bg-white px-2 py-1 font-black text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
      @click="emit('editar')"
    >✎</button>
    <button
      type="button"
      :disabled="desabilitado || !podeArquivar"
      :title="podeArquivar ? 'Arquivar esta squad' : 'A última squad ativa não pode ser arquivada'"
      class="border-4 border-black bg-white px-2 py-1 font-black text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
      @click="emit('arquivar')"
    >🗄</button>
```

- [ ] **Step 5: `src/components/QuestBackpack.vue`**

1. Prop nova, ao lado de `nomesDeDominio`:

```ts
  // id -> nome das pessoas da squad ativa. Quem foi arquivado continua dono das
  // quests do domínio (spec Fase 2 §7.11) e aparece como "Nome (arquivado)".
  nomesDePessoa: { type: Object as PropType<Record<string, string>>, default: () => ({}) }
```

2. No badge preto do membro, troque o conteúdo por `{{ nomesDePessoa[quest.membro] ?? (quest.membro || '?') }}`.

- [ ] **Step 6: `src/App.vue`**

Script. Acrescente:

```ts
import EditarModal from './components/EditarModal.vue'
import ArquivoModal from './components/ArquivoModal.vue'
import type { TipoDoRoster } from './rosterApi'
import type { AlvoDeEdicao } from './types'

const edicao = ref<AlvoDeEdicao | null>(null)
const enviandoEdicao = ref(false)
const erroEdicao = ref('')
const arquivoAberto = ref(false)
const reativando = ref('')
const errosArquivo = ref<Record<string, string>>({})
// Arquivar em curso: um por vez, e o painel fica desabilitado enquanto isso.
const arquivando = ref(false)
const ocupadoComRoster = computed(() => isLoading.value || enviandoContratacao.value || arquivando.value)

const nomesDePessoa = computed<Record<string, string>>(() => {
  const squad = squadAtiva.value
  if (!squad) return {}
  const mapa: Record<string, string> = {}
  for (const i of squad.arquivo.integrantes) mapa[i.pessoa.id] = `${i.pessoa.nome} (arquivado)`
  for (const d of squad.dominios) for (const p of [d.po, ...d.integrantes]) mapa[p.id] = p.nome
  return mapa
})

const acharPessoaAtiva = (id: string) =>
  squadAtiva.value?.dominios.flatMap((d) => [d.po, ...d.integrantes]).find((p) => p.id === id)

const abrirEdicao = (alvo: AlvoDeEdicao) => {
  erroEdicao.value = ''
  edicao.value = alvo
}
const editarPessoa = (id: string) => {
  const pessoa = acharPessoaAtiva(id)
  if (pessoa) abrirEdicao({ tipo: 'pessoa', pessoa })
}
const editarDominio = (id: string) => {
  const dominio = acharDominioAtivo(id)
  if (dominio) abrirEdicao({ tipo: 'dominio', dominio })
}
const editarSquadAtiva = () => {
  if (squadAtiva.value) abrirEdicao({ tipo: 'squad', squad: squadAtiva.value })
}

const salvarEdicao = async (corpo: Record<string, string>) => {
  const alvo = edicao.value
  if (!alvo || enviandoEdicao.value) return
  const [tipo, id]: [TipoDoRoster, string] =
    alvo.tipo === 'pessoa' ? ['pessoas', alvo.pessoa.id] : alvo.tipo === 'dominio' ? ['dominios', alvo.dominio.id] : ['squads', alvo.squad.id]
  enviandoEdicao.value = true
  erroEdicao.value = ''
  try {
    const r = await rosterApi.editar(tipo, id, corpo)
    roster.value = r.roster
    edicao.value = null
    avisar('Salvo')
  } catch (error) {
    erroEdicao.value = error instanceof Error ? error.message : String(error)
  } finally {
    enviandoEdicao.value = false
  }
}

/**
 * Arquivar pede confirmação com o efeito explícito (spec §3.4). O perigo não é
 * perder dado, é o usuário achar que perdeu.
 */
const arquivar = async (tipo: TipoDoRoster, id: string, pergunta: string) => {
  if (arquivando.value || !window.confirm(pergunta)) return
  arquivando.value = true
  try {
    const eraSquadAtiva = tipo === 'squads' && id === squadAtiva.value?.id
    const r = await rosterApi.arquivar(tipo, id)
    roster.value = r.roster
    if (eraSquadAtiva && r.roster.squads[0]) {
      // trocarSquad sairia cedo: o computed já caiu na primeira squad ativa
      // quando o roster mudou. Grava a escolha e relê a Mochila à mão.
      const nova = r.roster.squads[0]
      squadAtivaId.value = nova.id
      gravarSquadAtiva(nova.id)
      quests.value = []
      currentAgent.value = 'Idle'
      await carregarMochila()
    } else if (tipo === 'dominios') {
      await carregarMochila()
    }
    avisar('Arquivado')
  } catch (error) {
    avisar(error instanceof Error ? error.message : String(error))
  } finally {
    arquivando.value = false
  }
}

const arquivarPessoa = (id: string) => {
  const p = acharPessoaAtiva(id)
  if (!p) return
  arquivar('pessoas', id, `Arquivar ${p.nome}? Sai do escritório e do prompt. Os eventos dele continuam no Google e na Mochila do domínio. Dá para reativar no Arquivo.`)
}
const arquivarDominio = (id: string) => {
  const d = acharDominioAtivo(id)
  if (!d) return
  arquivar('dominios', id, `Arquivar a sala ${d.nome} com ${1 + d.integrantes.length} pessoa(s)? A sala fecha e libera o slot. Os eventos continuam no Google, mas saem da Mochila até você reativar.`)
}
const arquivarSquadAtiva = () => {
  const s = squadAtiva.value
  if (!s) return
  arquivar('squads', s.id, `Arquivar a squad ${s.nome}? Ela some do seletor e do prompt. Os eventos continuam no Google.`)
}

const abrirArquivo = () => {
  errosArquivo.value = {}
  arquivoAberto.value = true
}

const reativar = async (tipo: TipoDoRoster, id: string) => {
  if (reativando.value) return
  const chave = `${tipo}:${id}`
  reativando.value = chave
  errosArquivo.value = { ...errosArquivo.value, [chave]: '' }
  try {
    const r = await rosterApi.reativar(tipo, id)
    roster.value = r.roster
    avisar('Reativado')
    if (tipo === 'dominios') await carregarMochila()
  } catch (error) {
    errosArquivo.value = { ...errosArquivo.value, [chave]: error instanceof Error ? error.message : String(error) }
  } finally {
    reativando.value = ''
  }
}
```

Template:

1. `SquadSelector`: acrescente `:pode-arquivar="(roster?.squads.length ?? 0) > 1"`, `@editar="editarSquadAtiva"`, `@arquivar="arquivarSquadAtiva"`, e troque `:desabilitado="isLoading"` por `:desabilitado="ocupadoComRoster"`.
2. `SalasPainel`: `:desabilitado="ocupadoComRoster"`, mais `@editar-pessoa="editarPessoa"`, `@arquivar-pessoa="arquivarPessoa"`, `@editar-dominio="editarDominio"`, `@arquivar-dominio="arquivarDominio"`, `@abrir-arquivo="abrirArquivo"`.
3. `QuestBackpack`: `:nomes-de-pessoa="nomesDePessoa"`.
4. Antes de `NovaSquadModal`:

```vue
    <EditarModal
      v-if="edicao"
      :alvo="edicao"
      :enviando="enviandoEdicao"
      :erro="erroEdicao"
      @salvar="salvarEdicao"
      @fechar="edicao = null"
    />

    <ArquivoModal
      v-if="arquivoAberto && squadAtiva && roster"
      :squad="squadAtiva"
      :squads-arquivadas="roster.squadsArquivadas"
      :reativando="reativando"
      :erros="errosArquivo"
      @reativar="reativar"
      @fechar="arquivoAberto = false"
    />
```

- [ ] **Step 7: Typecheck e build**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
```

Esperado: sem erros.

- [ ] **Step 8: Rodar todos os scripts de novo**

```bash
cd "$SCRATCH/fase2" && for c in ativos vista resolver arvore texto localizar-e-aposentar troca-arquivada; do npx tsx roster.ts $c || break; done
cd "$SCRATCH/fase2" && for c in editar arquivar-integrante arquivar-dominio reativar-dominio sem-sala squad substituir-po hire-estendido concorrencia copia-real; do npx tsx ciclo.ts $c || break; done
cd "$SCRATCH/fase2" && for c in sucesso-pessoa po-e-pessoa sucesso-dominio truncado sem-chamada ocupado erro-gemini pedido; do npx tsx redacao.ts $c || break; done
cd "$SCRATCH/fase2" && npx tsx prompt.ts && npx tsx salas.ts
```

Esperado: todos `OK` (ou `SKIP copia-real`). Repita o Step 4 da Task 4 (servidor temporário + `http.ts`) contra o build atual.

- [ ] **Step 9: Verificação no navegador (critérios 17 e 18 da spec)**

```bash
TMPD=$(mktemp -d "$SCRATCH/fase2-ui2-XXXX")
cp -r "$REPO/seed" "$TMPD/seed" && cp -r "$REPO/dist" "$TMPD/dist" && mkdir "$TMPD/data"
cd "$SCRATCH/fase2" && npx tsx util.ts fixture-f2 > "$TMPD/data/squad.json"
cd "$TMPD" && PORT=3930 NODE_ENV=production GEMINI_API_KEY=fake IPS_PERMITIDOS= node "$REPO/dist/server.cjs" > "$TMPD/server.log" 2>&1 &
echo $! > "$TMPD/pid"
```

Abra `http://127.0.0.1:3930`. No console da página, instale o mesmo interceptador de `/api/squad/redigir` do Step 8 da Task 6 e rode `window.confirm = () => true`, para que as confirmações não bloqueiem a automação. Verifique:

1. **Editar pessoa:** ✎ em Ana → Escopo "Missão: impostos PJ" → **Salvar**. O toast diz "Salvo". Reabrir ✎ mostra o escopo novo.
2. **Editar squad:** ✎ do seletor → Escopo "minha vida" → **Salvar**. `fetch('/api/squad').then(r => r.json()).then(v => v.squads[0].escopo)` devolve `"minha vida"`.
3. **Arquivar integrante:** 🗄 em Ana → Ana some do painel; `.actor` cai de 3 para 2; **Arquivo (1)** lista "Ana · Contadora · sala Casa".
4. **Reativar:** **Reativar** de Ana → Ana volta ao painel e ao mapa (`.actor` = 3); o Arquivo fica vazio.
5. **Fechar sala (mapa):** 🗄 em Financeiro. Em até 300 ms, `document.querySelectorAll('.room--closing').length > 0`; depois de 1 s, `=== 0`, a placa "Financeiro" sumiu e `document.querySelectorAll('.room--pending, .room--new').length === 0`. O botão passa a "+ Abrir sala (1,0)".
6. **Reabrir o slot:** **+ Abrir sala (1,0)** → domínio "Saúde" com campos à mão → **Contratar**. Em até 1 s, `.room--pending, .room--new` > 0; depois de 3 s a placa "Saúde" aparece.
7. **Reativar sem sala:** no Arquivo, **Reativar** de Financeiro → volta num slot livre (`[0,1]`), sem erro. Arquive Saúde de novo para o próximo passo.
8. **Raiz e última squad:** o 🗄 de Casa está desabilitado. Arquive a squad Pay4Fun: selecione-a no seletor, 🗄 → a tela volta para Pessoal e o 🗄 do seletor fica desabilitado (uma squad ativa só). O Arquivo lista Pay4Fun em "Squads arquivadas"; **Reativar** a traz de volta ao seletor.
9. **Substituir PO da raiz:** ⇄ em Casa → "Pessoa nova", Papel "PO Casa", Escopo "Missão: casa" → **Substituir**. Depois de 2 s, `[...document.querySelectorAll('.actor')].filter((e) => e.style.visibility === 'hidden').length === 0` e o Arquivo lista Rômulo.
10. **Redigir com falha:** em ✎ de uma pessoa, frase "x" → **Reescrever com Gemini** com o interceptador em 503 → aparece a mensagem de Gemini ocupado, e **Salvar** continua disponível depois de mudar o papel à mão.
11. Console sem erros; `ls "$TMPD/data"` não mostra `google-auth.json`.

Pare o servidor: `kill "$(cat "$TMPD/pid")"`.

- [ ] **Step 10: Commit**

```bash
cd "$REPO" && git add src/types.ts src/components/EditarModal.vue src/components/ArquivoModal.vue src/components/SquadSelector.vue src/components/QuestBackpack.vue src/App.vue && git commit -m "$(cat <<'EOF'
feat(ui): editar, arquivar e reativar pessoa, sala e squad

Editar manda so o que mudou e nunca expoe id. Arquivar pede confirmacao
que diz o efeito real: sai do escritorio e do prompt, mas os eventos
continuam no Google. O Arquivo lista salas, pessoas e squads arquivadas
e mostra na propria linha o motivo de uma reativacao recusada. A Mochila
mostra quem foi arquivado como "(arquivado)" em vez do id cru.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Documentação, integração e grafo

**Files:**
- Modify: `CLAUDE.md`
- Add (se ainda não versionados): `docs/superpowers/specs/2026-09-12-fase-2-contratacao-ciclo-de-vida-design.md`, `docs/superpowers/plans/2026-09-12-fase-2-contratacao-ciclo-de-vida.md`

**Interfaces:**
- Consumes: tudo acima.
- Produces: nada de código.

- [ ] **Step 0: Reler**

Leia `CLAUDE.md` inteiro, como as Fases 1 e 3 deixaram.

- [ ] **Step 1: Atualizar `CLAUDE.md`**

1. Árvore de arquitetura:
   - acrescente `server/ciclo-de-vida.ts  editar, arquivar e reativar pessoa/domínio/squad`;
   - acrescente `server/redacao.ts  Gemini redige papel + escopo (não grava)`;
   - `server/hire.ts` passa a "contratação (card ou UI), nova squad, substituição de PO";
   - acrescente `src/rosterApi.ts  escritas do roster com erro classificado` e `src/office/salas.ts  diferença de salas (abrir/fechar)`;
   - em `src/components/`, acrescente `SalasPainel, ContratarModal, EditarModal, ArquivoModal`.

2. Invariantes: acrescente um item depois do 3:

   **4. Arquivar não apaga.** Pessoa, domínio e squad arquivados ficam na árvore com `arquivado: true` e somem do prompt, do mapa e da vista (`paraVista` só põe ativos em `dominios`/`squads`; o resto vai em `arquivo`/`squadsArquivadas`). Arquivar grava o id em `idsAposentados` (só acréscimo, e reativar não tira). O PO não se arquiva: substitui-se, e o anterior vira integrante arquivado. `dominios[0]` e a última squad ativa nunca se arquivam. Helpers de turno, Mochila, prompt e slots veem só ativos; os de unicidade de id veem tudo. Nada no ciclo de vida chama o Google.

3. Invariante 2 ("O roster é o prompt"): acrescente "O escopo de pessoa (até 1500 caracteres, cinco linhas: Missão, Cuida de, Não cuida de, Ao opinar sobre um compromisso, Sinais de alerta) é o treino; entra em bloco recuado na árvore."

4. Nova subseção depois de "Escrita no roster":

   ### Contratação e ciclo de vida

   Contratar: botão por sala e **+ Abrir sala** (painel fora do canvas; o `GameMap` segue sem eventos), ou card do modelo (Aprovar/Ajustar). O modelo sempre chama a capacidade de crescimento quando o pedido é explícito. Redigir (`POST /api/squad/redigir`) é uma chamada de function calling restrita (`ANY` + um nome), via `gerarComRetry`, e não grava nada. Falha dela nunca impede contratar à mão.

   | Rota | Efeito |
   |---|---|
   | `PATCH /api/squad/{pessoas,dominios,squads}/:id` | edita texto; ids nunca mudam |
   | `POST /api/squad/{pessoas,dominios,squads}/:id/arquivar` | arquiva (idempotente) |
   | `POST /api/squad/{pessoas,dominios,squads}/:id/reativar` | reativa; domínio precisa de sala livre |
   | `POST /api/squad/dominios/:id/po` | substitui o PO (`integranteId` ou pessoa nova) |

   Mochila: domínio arquivado some (um `events.list` só por domínio ativo); quest de integrante arquivado continua, com "(arquivado)".

5. Persistência: na linha de `data/squad.json`, acrescente "inclui arquivados (`arquivado`, `arquivadoEm`)". No parágrafo de rollback: "Código anterior à Fase 2 ignora `arquivado` e mostraria arquivados como ativos; o formato não mudou de versão, então a leitura não quebra."

6. Convenções, item de erros: acrescente `SquadArquivada` (409 + `squadInexistente`), `RedacaoInvalida` (502 + `redacaoFalhou`).

- [ ] **Step 2: Verificação final**

```bash
cd "$REPO" && npx vue-tsc --noEmit && npm run build
cd "$SCRATCH/fase2" && for c in ativos vista resolver arvore texto localizar-e-aposentar troca-arquivada; do npx tsx roster.ts $c || break; done
cd "$SCRATCH/fase2" && for c in editar arquivar-integrante arquivar-dominio reativar-dominio sem-sala squad substituir-po hire-estendido concorrencia copia-real; do npx tsx ciclo.ts $c || break; done
cd "$SCRATCH/fase2" && for c in sucesso-pessoa po-e-pessoa sucesso-dominio truncado sem-chamada ocupado erro-gemini pedido; do npx tsx redacao.ts $c || break; done
cd "$SCRATCH/fase2" && npx tsx prompt.ts && npx tsx salas.ts
cd "$REPO" && ! grep -n "fetch(\|calendar.ts" server/ciclo-de-vida.ts server/redacao.ts && git diff --stat origin/main -- server/auth-store.ts
```

Esperado: tudo `OK`; o grep não tem saída; o diff de `server/auth-store.ts` vem vazio. Repita o Step 4 da Task 4 contra o build final.

- [ ] **Step 3: Commit da documentação**

```bash
cd "$REPO" && git status --short
```

Confirme que `graphify-out/`, `docs/daily-summary/` e specs/planos de **outras** fases não estão no índice. Depois:

```bash
cd "$REPO" && git add CLAUDE.md docs/superpowers/specs/2026-09-12-fase-2-contratacao-ciclo-de-vida-design.md docs/superpowers/plans/2026-09-12-fase-2-contratacao-ciclo-de-vida.md && git commit -m "$(cat <<'EOF'
docs: registrar contratacao pela UI e ciclo de vida dos agentes

CLAUDE.md ganha o invariante de que arquivar nao apaga (e o que isso
filtra), as rotas de editar/arquivar/reativar/substituir PO, o formato do
treino de 1500 caracteres e por que a redacao usa function calling
restrito. Versiona spec e plano da Fase 2.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

(Se spec e plano já estiverem versionados, tire-os do `git add`.)

- [ ] **Step 4: Integrar com `main` e publicar**

```bash
cd "$REPO" && git pull --rebase origin main && npx vue-tsc --noEmit && npm run build && git push origin main
```

Se o rebase conflitar (a sessão paralela do `auth-store.ts` e a Fase 3 podem ter tocado `server.ts`, `App.vue` ou `types.ts`), resolva preservando as duas mudanças, rode typecheck e build e siga com `git rebase --continue`. Nunca use `--force`. Nunca resolva conflito em `server/auth-store.ts` a favor desta fase: esta fase não o toca.

- [ ] **Step 5: Atualizar o grafo**

```bash
cd "$REPO" && graphify update . && git status --short
```

Esperado: `graphify-out/` muda e continua **fora** de qualquer commit.

- [ ] **Step 6: Lembrete de deploy (não executar)**

Push em `main` não implanta. Ao relatar, diga ao usuário: clicar **Implantar** no Easypanel. Não há migração: o `squad.json` do volume só ganha `arquivado`/`arquivadoEm` quando algo for arquivado. Antes de arquivar em produção, vale confirmar no mapa que a animação de fechamento e o Arquivo funcionam.

---

## Self-review (feito ao escrever)

- **Cobertura da spec:**
  - §1–2 → Tasks 1–7;
  - §3.1 painel e seletor → Tasks 6 e 7; §3.2 contratar/redigir/Ajustar → Task 6; §3.3 editar → Task 7; §3.4–3.5 arquivar/Arquivo → Task 7;
  - §4.1 erros → Tasks 1 (`SquadArquivada`), 3 (`RedacaoInvalida`) e 4 (mapeamento); §4.2 → Tasks 3 e 4; §4.3 → Task 2; §4.4–4.8 → Tasks 2 e 4; §4.9 → Task 1 (`resolverSquad`, mensagens de conflito);
  - §5.1 → Task 3; §5.2 → Task 1; §5.3–5.5 → Tasks 1 (normalização) e 3;
  - §6 → Task 1; §7 → Tasks 1 e 2; §8 → Task 5 + navegador da Task 7;
  - §10: critérios 1–4 → `roster.ts`; 5–12 → `ciclo.ts`; 13–14 → `redacao.ts`; 15 → `prompt.ts` + `troca-arquivada`; 16 → `http.ts`; 17–18 → Task 7 Step 9 (e Task 6 Step 8); 19 → Task 8 Step 2.
- **Placeholders:** nenhum TBD. Os trechos de `orchestrator.ts`, `capabilities.ts`, `server.ts`, `App.vue` e `types.ts` são deliberadamente "pela intenção", por causa da Fase 3; cada um tem o código a inserir e a âncora textual.
- **Nomes consistentes:** `ativo`, `dominiosAtivos`, `integrantesAtivos`, `pessoasAtivas`, `squadsAtivas`, `localizarPessoa/Dominio/Squad`, `aposentarIds`, `LIMITES`, `textoRevisado`, `substituirPo`, `interpretarPedidoDeRedacao`, `redigirTreino`, `RedacaoInvalida`, `SquadArquivada`, `planejarSalas`, `rosterApi`, `ErroDaApi`, `TipoDoRoster`, `AlvoDeContratacao`, `DadosDeContratacao`, `AlvoDeEdicao`, a mesma grafia em todas as tasks.
- **Portas de teste:** 3927 (HTTP), 3928 (mapa), 3929 (UI contratação), 3930 (UI ciclo de vida). Nenhuma colide com as da Fase 1 (3917–3919).
