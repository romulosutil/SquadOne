# Lembretes push via ntfy — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** mandar notificação push para o celular (app ntfy oficial no Android/Samsung) `ANTECEDENCIA_PUSH_MIN` minutos antes de cada bloco de trabalho e de cada marco de prazo criados pelo SquadOne, usando um servidor ntfy próprio no Easypanel.

**Arquitetura:** uma **vigia** dentro do mesmo processo Express varre o Google Calendar a cada 60 s numa janela curta (agora → agora + antecedência + 2 min), filtra os eventos com marca `squadone_dominio` de domínio ativo e manda um POST JSON ao ntfy para cada evento cujo "momento de avisar" já chegou e cujo horário ainda não chegou. A decisão de "quem avisar e o que dizer" é uma função **pura** (`server/lembretes.ts`, mesmo espírito do `alocador.ts`), testável com `agora` injetado. Nada é agendado para o futuro e nada é gravado em disco: o Google continua a única fonte de verdade.

**Tech stack:** Node 22 + Express 4 + TypeScript (tsx), `fetch` nativo, `node:test` (`npm test`), ntfy self-hosted (`binwiederhier/ntfy`) no Easypanel.

**Spec:** este documento — seção "Decisões" abaixo. Leia também o `CLAUDE.md` da raiz **antes de tudo** (invariantes, marcas no Calendar, convenções de erro).

## Decisões (fechadas — não reabrir)

Tomadas pelo usuário:
- ntfy **self-hosted**, nunca `ntfy.sh` (privacidade).
- Sem app Android novo: o app ntfy oficial assina o tópico do servidor próprio.
- Gatilho: X minutos **antes** do horário do evento, não no momento da criação.

Tomadas neste plano (com o porquê):

1. **Onde mora o disparo futuro: varredura periódica da agenda, não `setTimeout`, não cron, não `X-Delay` do ntfy.**
   - `setTimeout` por evento morre em todo redeploy e não enxerga edição/remoção no Google nem o Ajuste de tempo (que move eventos).
   - `X-Delay`/`At` do ntfy guarda a mensagem no servidor ntfy, mas não há como desmarcar quando o usuário apaga ou move o evento no Google (invariante 3: "as quests vivem no Google") e o atraso tem teto (3 dias no padrão).
   - Cron externo seria outro serviço para uma coisa que o processo já faz com `setInterval`.
   - Varrer relendo o Google a cada minuto respeita tudo que o usuário mudou no Google, sobrevive a redeploy sem estado e custa **1 `events.list` por calendário distinto por minuto** (hoje todas as squads usam `primary`: 1 chamada/min ≈ 1440/dia, longe da quota).
2. **Deduplicação só em memória** (`Map` chave → instante), sem arquivo novo em `data/`. A persistência da V1 é só `squad.json` + `google-auth.json`, por decisão do usuário. A chave é `eventId@instanteDeReferencia`: se o Ajuste (ou o usuário no Google) mover o evento, a chave muda e o lembrete volta a valer para o novo horário.
   - **Custo aceito:** um redeploy dentro dos 10 min antes de um evento já avisado reenvia aquele aviso uma vez. Um servidor fora do ar durante toda a janela de 10 min perde o aviso. Deploy é manual e raro; uso pessoal.
3. **Que eventos disparam:** só eventos do SquadOne (têm `squadone_dominio`) de **domínio ativo** — mesmo critério da Mochila. Os dois tipos que existem:
   - `time_blocking` com horário (foco avulso **e** blocos de prazo `squadone_prazo_ref`): referência = **início**.
   - `deadline` com horário: referência = **fim** do evento, que é o prazo real (o marco é gravado de `prazo − 15 min` até `prazo`; o início é folga artificial).
   - `deadline` de dia inteiro: referência = início da `JANELA_TRABALHO` naquele dia (ex.: aviso 08:50 para "vence hoje").
   - `time_blocking` de dia inteiro: **não avisa** (não tem hora; é o mesmo caso sem alvo do Ajuste).
   - Eventos que o SquadOne não criou: **não avisa** — o próprio Google já tem lembrete para eles.
   - Integrante arquivado com quest em domínio ativo: avisa (a Mochila também mostra).
4. **Configuração: uma env var nova, `LEMBRETES_NTFY_URL`.** Formato `https://:TOKEN@host/topico` (token do ntfy como senha na URL, usuário vazio). O código tira o token da URL e manda como `Authorization: Bearer`. Ausente/vazia = push **desligado** e o resto do app igual. Presente e ilegível = log de erro no boot, push desligado, `POST /api/push/*` responde 500 `configuracao: true` — **nunca derruba o boot nem as outras rotas** (diferente da `JANELA_TRABALHO`, que é pré-requisito do turno; push não é). O prefixo não é `NTFY_` para não confundir com as envs de configuração do **container** ntfy.
5. **Antecedência: constante `ANTECEDENCIA_PUSH_MIN = 10`** em `server/lembretes.ts`, não env (o pedido foi de uma env var só). Virar env depois é trocar a constante por um `lerAntecedencia(env)`; fora do escopo.
6. **Falha do ntfy não toca o agendamento por construção:** `server/agendamento.ts` e `server/ajuste.ts` **não mudam**. O push roda num laço separado; timeout de 5 s no POST ao ntfy; push que falha fica fora da deduplicação e é tentado de novo na varredura seguinte (no máximo ~10 tentativas, até o evento começar).
7. **Credencial do Google perdida:** a vigia manda **um** push "SquadOne sem acesso ao Google" (uma vez por perda, não a cada minuto) — o objetivo do push é justamente não precisar abrir o app para descobrir que parou.
8. **Testar sem esperar o horário:** testes puros com `agora` injetado + duas rotas atrás do porteiro de IP:
   - `POST /api/push/teste` — manda um push fixo agora (confere ntfy + celular).
   - `POST /api/push/varrer {agora?, enviar?}` — roda uma varredura **real** contra o Google com relógio simulado; `enviar` padrão `false` (só devolve as mensagens que sairiam); nunca grava na deduplicação da vigia.

## Restrições globais

- Comentários e identificadores em **português**; comentário explica *por quê*, não *o quê*.
- `server/lembretes.ts` é **puro**: sem `fetch`, sem `Date.now()`/`new Date()`, sem `process.env`. `agora`, janela e estado entram por parâmetro.
- Datas do Google são lidas com `lerInstante(valor, fuso)` de `server/alocador.ts`, **nunca** `Date.parse`/`new Date(texto)` (texto sem offset seria lido no fuso do container, UTC).
- Fuso: `FUSO = "America/Sao_Paulo"` (de `server/alocador.ts`); texto de hora via `Intl.DateTimeFormat("pt-BR", { timeZone: fuso, ... })`.
- Erros classificados, não mensagem solta: `PushMalConfigurado` (500 + `configuracao: true`), `ErroDePush` (502 + `pushFalhou: true`).
- O token do ntfy **nunca** aparece em log nem em mensagem de erro.
- Nenhum arquivo novo em `data/`. Nenhuma dependência npm nova.
- Não alterar `server/agendamento.ts`, `server/ajuste.ts`, `server/alocador.ts`.
- Testes: `node:test` + `node:assert/strict`, arquivos `server/*.test.ts` (o glob do `npm test` já os pega). Nada nos testes toca rede: `globalThis.fetch` é substituído e restaurado no `afterEach`, como em `server/baixa-prioridade.test.ts`.
- Verificação final: `npx vue-tsc --noEmit` + `npm test` + `npm run build` + exercitar as rotas.
- Ao terminar: `git commit` + `git push` + `graphify update .`.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `server/push.ts` | criar | transporte: ler `LEMBRETES_NTFY_URL`, POST JSON ao ntfy, erros classificados |
| `server/push.test.ts` | criar | config e envio |
| `server/lembretes.ts` | criar | **puro**: alvos do roster, instante de referência, disparos devidos, texto da mensagem |
| `server/lembretes.test.ts` | criar | tabela de casos do disparo e do texto |
| `server/calendar.ts` | modificar | `listarQuestsDaJanela`: um `events.list` por calendário numa janela curta |
| `server/vigia.ts` | criar | laço: roster + token + leitura + disparos + envio + deduplicação em memória |
| `server/vigia.test.ts` | criar | deduplicação, retentativa, desconexão, isolamento de falha, leitura da janela |
| `server.ts` | modificar | boot da vigia, log, `POST /api/push/teste`, `POST /api/push/varrer` |
| `.env.example` | modificar | documentar `LEMBRETES_NTFY_URL` |
| `CLAUDE.md` | modificar | arquitetura, seção "Lembretes push", env, convenções de erro |

---

### Tarefa 1: transporte ntfy (`server/push.ts`)

**Arquivos:**
- Criar: `server/push.ts`
- Teste: `server/push.test.ts`

**Interfaces:**
- Consome: nada do projeto.
- Produz:
  - `interface MensagemDePush { titulo: string; corpo: string; prioridade: 1 | 2 | 3 | 4 | 5; tags: string[]; clique?: string }`
  - `interface ConfigDePush { servidor: string; topico: string; token: string | null }`
  - `class PushMalConfigurado extends Error`
  - `class ErroDePush extends Error { readonly status: number | null; get credencial(): boolean }`
  - `const TIMEOUT_NTFY_MS = 5000`
  - `function lerConfigDePush(env: Record<string, string | undefined>): ConfigDePush | null`
  - `function descreverPush(c: ConfigDePush): string`
  - `async function enviarPush(c: ConfigDePush, m: MensagemDePush): Promise<void>`

- [ ] **Passo 1: escrever o teste que falha**

`server/push.test.ts`:

```ts
/**
 * Transporte do push: leitura de LEMBRETES_NTFY_URL e POST ao ntfy.
 * Nada toca a rede: `fetch` é substituído.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { descreverPush, enviarPush, ErroDePush, lerConfigDePush, PushMalConfigurado } from "./push.ts";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("lerConfigDePush", () => {
  it("ausente ou vazia desliga o push", () => {
    assert.equal(lerConfigDePush({}), null);
    assert.equal(lerConfigDePush({ LEMBRETES_NTFY_URL: "   " }), null);
  });

  it("separa servidor, tópico e token", () => {
    assert.deepEqual(
      lerConfigDePush({ LEMBRETES_NTFY_URL: "https://:tk_abc123@ntfy.exemplo.com/squadone-lembretes/" }),
      { servidor: "https://ntfy.exemplo.com", topico: "squadone-lembretes", token: "tk_abc123" },
    );
  });

  it("aceita sem token (servidor sem auth, ex.: ntfy local)", () => {
    assert.deepEqual(lerConfigDePush({ LEMBRETES_NTFY_URL: "http://localhost:8080/dev" }), {
      servidor: "http://localhost:8080",
      topico: "dev",
      token: null,
    });
  });

  it("aceita o token no lugar do usuário", () => {
    assert.equal(lerConfigDePush({ LEMBRETES_NTFY_URL: "https://tk_xyz@ntfy.exemplo.com/t1" })?.token, "tk_xyz");
  });

  for (const [caso, valor] of [
    ["não é URL", "tk_segredo sem url"],
    ["protocolo errado", "ftp://:tk_segredo@ntfy.exemplo.com/t1"],
    ["sem tópico", "https://:tk_segredo@ntfy.exemplo.com/"],
    ["tópico com barra", "https://:tk_segredo@ntfy.exemplo.com/a/b"],
    ["tópico com caractere inválido", "https://:tk_segredo@ntfy.exemplo.com/t%C3%B3pico"],
    ["com query", "https://:tk_segredo@ntfy.exemplo.com/t1?x=1"],
  ] as const) {
    it(`recusa ${caso} sem vazar o token`, () => {
      assert.throws(
        () => lerConfigDePush({ LEMBRETES_NTFY_URL: valor }),
        (err: unknown) => err instanceof PushMalConfigurado && !(err as Error).message.includes("tk_segredo"),
      );
    });
  }

  it("descreverPush não mostra o token", () => {
    const c = lerConfigDePush({ LEMBRETES_NTFY_URL: "https://:tk_abc123@ntfy.exemplo.com/t1" })!;
    assert.equal(descreverPush(c), "https://ntfy.exemplo.com/t1 (com token)");
  });
});

describe("enviarPush", () => {
  const config = { servidor: "https://ntfy.exemplo.com", topico: "t1", token: "tk_abc" };
  const mensagem = { titulo: "Em 10 min: Revisar", corpo: "12:10–13:10 · Geral", prioridade: 3 as const, tags: ["hourglass_flowing_sand"], clique: "https://calendar.google.com/x" };

  it("publica JSON na raiz do servidor com Bearer", async () => {
    const chamadas: { url: string; init: any }[] = [];
    globalThis.fetch = (async (url: string, init: any) => {
      chamadas.push({ url, init });
      return { ok: true, status: 200, text: async () => "" };
    }) as unknown as typeof fetch;

    await enviarPush(config, mensagem);

    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, "https://ntfy.exemplo.com/");
    assert.equal(chamadas[0].init.method, "POST");
    assert.equal(chamadas[0].init.headers.Authorization, "Bearer tk_abc");
    assert.deepEqual(JSON.parse(chamadas[0].init.body), {
      topic: "t1",
      title: "Em 10 min: Revisar",
      message: "12:10–13:10 · Geral",
      priority: 3,
      tags: ["hourglass_flowing_sand"],
      click: "https://calendar.google.com/x",
    });
  });

  it("sem token não manda Authorization", async () => {
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (_url: string, init: any) => {
      headers = init.headers;
      return { ok: true, status: 200, text: async () => "" };
    }) as unknown as typeof fetch;
    await enviarPush({ ...config, token: null }, mensagem);
    assert.equal("Authorization" in headers, false);
  });

  it("resposta não-ok vira ErroDePush com status", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 403, text: async () => "forbidden" })) as unknown as typeof fetch;
    await assert.rejects(enviarPush(config, mensagem), (err: unknown) => {
      assert.ok(err instanceof ErroDePush);
      assert.equal(err.status, 403);
      assert.equal(err.credencial, true);
      return true;
    });
  });

  it("falha de rede vira ErroDePush sem status", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await assert.rejects(enviarPush(config, mensagem), (err: unknown) => {
      assert.ok(err instanceof ErroDePush);
      assert.equal(err.status, null);
      assert.equal(err.credencial, false);
      return true;
    });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test server/push.test.ts`
Esperado: FAIL — `Cannot find module './push.ts'`.

- [ ] **Passo 3: implementar**

`server/push.ts`:

```ts
/**
 * Transporte dos lembretes: servidor ntfy PRÓPRIO (nunca ntfy.sh — o título do
 * compromisso é dado pessoal). Só sabe publicar; quem decide o que e quando
 * avisar é `lembretes.ts`, e quem varre é `vigia.ts`.
 */

export interface MensagemDePush {
  titulo: string;
  corpo: string;
  /** Escala do ntfy: 3 = padrão, 4 = alta (vibra/soa mais insistente). */
  prioridade: 1 | 2 | 3 | 4 | 5;
  /** Nomes de emoji do ntfy (viram ícone no início do título). */
  tags: string[];
  /** URL aberta ao tocar na notificação: o evento no Google Calendar. */
  clique?: string;
}

export interface ConfigDePush {
  /** Origem, sem barra final: `https://ntfy.exemplo.com`. */
  servidor: string;
  topico: string;
  /** Access token do ntfy (`tk_...`); null = servidor sem auth (dev local). */
  token: string | null;
}

/** LEMBRETES_NTFY_URL presente e ilegível. Ambiente: nenhum clique conserta. */
export class PushMalConfigurado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PushMalConfigurado";
  }
}

export class ErroDePush extends Error {
  /** Status HTTP do ntfy; null quando nem houve resposta (rede, timeout). */
  readonly status: number | null;
  constructor(mensagem: string, status: number | null) {
    super(mensagem);
    this.name = "ErroDePush";
    this.status = status;
  }

  /** 401/403: token errado ou sem escrita no tópico. Repetir não resolve. */
  get credencial(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * Lembrete que demora mais que isto já não serve, e a varredura seguinte tenta
 * de novo: esperar mais só atrasaria os outros avisos da mesma varredura.
 */
export const TIMEOUT_NTFY_MS = 5000;

/** Regra de nome de tópico do ntfy. */
const TOPICO = /^[-_A-Za-z0-9]{1,64}$/;

/**
 * Uma env só: `https://:TOKEN@host/topico`. Ausente/vazia = push desligado.
 * Presente e ilegível = erro — nunca liga calado num tópico errado. As mensagens
 * NUNCA repetem o valor: ele carrega o token.
 */
export function lerConfigDePush(env: Record<string, string | undefined>): ConfigDePush | null {
  const bruto = (env.LEMBRETES_NTFY_URL ?? "").trim();
  if (!bruto) return null;
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new PushMalConfigurado("LEMBRETES_NTFY_URL não é uma URL (formato: https://:TOKEN@host/topico).");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PushMalConfigurado("LEMBRETES_NTFY_URL precisa começar com https:// (ou http:// só em dev).");
  }
  if (url.search || url.hash) {
    throw new PushMalConfigurado("LEMBRETES_NTFY_URL não aceita query nem fragmento: só https://:TOKEN@host/topico.");
  }
  const topico = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!TOPICO.test(topico)) {
    throw new PushMalConfigurado(
      "LEMBRETES_NTFY_URL precisa de um tópico no caminho: letras, dígitos, '-' e '_', até 64, sem barra.",
    );
  }
  // Token como senha com usuário vazio (`https://:tk@host`) ou no lugar do usuário.
  const token = decodeURIComponent(url.password || url.username) || null;
  return { servidor: url.origin, topico, token };
}

/** Para o log do boot: nunca o token. */
export function descreverPush(c: ConfigDePush): string {
  return `${c.servidor}/${c.topico} (${c.token ? "com token" : "sem token"})`;
}

/**
 * Publicação JSON na raiz do servidor (`POST /` com `topic` no corpo): é o
 * formato do ntfy que aceita UTF-8 no título. Por cabeçalho (`Title:`) acento e
 * emoji exigiriam codificação à parte.
 */
export async function enviarPush(c: ConfigDePush, m: MensagemDePush): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`${c.servidor}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
      },
      body: JSON.stringify({
        topic: c.topico,
        title: m.titulo,
        message: m.corpo,
        priority: m.prioridade,
        tags: m.tags,
        ...(m.clique ? { click: m.clique } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_NTFY_MS),
    });
  } catch (err: any) {
    throw new ErroDePush(`ntfy inacessível: ${err?.message ?? String(err)}`, null);
  }
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new ErroDePush(`ntfy respondeu ${resp.status}: ${texto.slice(0, 200)}`, resp.status);
  }
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test server/push.test.ts`
Esperado: PASS (todos).

- [ ] **Passo 5: commit**

```bash
git add server/push.ts server/push.test.ts
git commit -m "feat(push): transporte ntfy com config por LEMBRETES_NTFY_URL"
```

---

### Tarefa 2: regra pura do disparo (`server/lembretes.ts`)

**Arquivos:**
- Criar: `server/lembretes.ts`
- Teste: `server/lembretes.test.ts`

**Interfaces:**
- Consome:
  - `lerInstante(valor: unknown, fuso: string): { instante: number; data: DataLocal | null } | null`, `instanteLocal(data: DataLocal, minutos: number, fuso: string): number`, `type Janela` (`{ inicioMin, fimMin, dias, fuso }`), `lerJanela(env)` — de `server/alocador.ts`
  - `type QuestCalendario`, `PREFIXO_DEADLINE` — de `server/calendar.ts`
  - `squadsAtivas(roster)`, `dominiosAtivos(squad)`, `type Roster` — de `server/squad.ts`
  - `type MensagemDePush` — da Tarefa 1
- Produz:
  - `const ANTECEDENCIA_PUSH_MIN = 10`, `const VARREDURA_MS = 60_000`
  - `interface AlvosDaVarredura { calendarios: string[]; dominios: Map<string, string> }`
  - `function alvosDoRoster(roster: Roster): AlvosDaVarredura`
  - `interface Disparo { chave; eventId; tipo; titulo; dominio; referencia: number; fim: number | null; diaInteiro: boolean; htmlLink?: string }`
  - `function referenciaDoEvento(q: QuestCalendario, janela: Janela): number | null`
  - `function disparosDevidos(quests: QuestCalendario[], agora: number, janela: Janela, dominiosAtivos: { has(id: string): boolean }, jaEnviados: { has(chave: string): boolean }, antecedenciaMin?: number): Disparo[]`
  - `function mensagemDoDisparo(d: Disparo, agora: number, fuso: string, nomeDoDominio: string): MensagemDePush`

- [ ] **Passo 1: escrever o teste que falha**

`server/lembretes.test.ts`:

```ts
/**
 * Regra pura dos lembretes: quem avisar, quando e com que texto. `agora` é
 * injetado — é assim que se testa o disparo sem esperar o horário real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerJanela } from "./alocador.ts";
import type { QuestCalendario } from "./calendar.ts";
import {
  alvosDoRoster,
  disparosDevidos,
  mensagemDoDisparo,
  referenciaDoEvento,
} from "./lembretes.ts";
import type { Roster } from "./squad.ts";

const JANELA = lerJanela({}); // 09:00-19:00, seg-sex, America/Sao_Paulo
const t = (iso: string) => new Date(iso).getTime();
/** Segunda-feira, 12:00 em São Paulo. */
const AGORA = t("2026-09-14T12:00:00-03:00");
const ATIVOS = new Set(["geral"]);
const NADA = new Set<string>();

function quest(p: Partial<QuestCalendario> = {}): QuestCalendario {
  return {
    eventId: "ev1",
    titulo: "[PO] Revisar contrato",
    inicio: "2026-09-14T12:10:00-03:00",
    fim: "2026-09-14T13:10:00-03:00",
    diaInteiro: false,
    tipo: "time_blocking",
    dominio: "geral",
    membro: "po",
    squad: "pessoal",
    prazoRef: "",
    htmlLink: "https://calendar.google.com/ev1",
    ...p,
  };
}

const pessoa = { id: "po", nome: "Ana", papel: "PO", escopo: "", sprite: "x", hiredAt: "2026-09-01" };
function dominio(id: string, nome: string, arquivado = false) {
  return { id, nome, escopo: "", slot: [1, 1] as [number, number], room: "r", criadoEm: "2026-09-01", po: pessoa, integrantes: [], ...(arquivado ? { arquivado: true } : {}) };
}

describe("alvosDoRoster", () => {
  it("só squads e domínios ativos; calendários sem repetição", () => {
    const roster: Roster = {
      version: 3,
      idsAposentados: { pessoas: [], dominios: [] },
      squads: [
        { id: "pessoal", nome: "Pessoal", escopo: "", calendarId: "primary", unlockOrder: [[1, 1]], dominios: [dominio("geral", "Geral"), dominio("velho", "Velho", true)] },
        { id: "p4f", nome: "Pay4Fun", escopo: "", calendarId: "primary", unlockOrder: [[1, 1]], dominios: [dominio("p4f--dev", "Dev")] },
        { id: "morta", nome: "Morta", escopo: "", calendarId: "outro", unlockOrder: [[1, 1]], dominios: [dominio("morta--x", "X")], arquivado: true },
      ],
    };
    const alvos = alvosDoRoster(roster);
    assert.deepEqual(alvos.calendarios, ["primary"]);
    assert.deepEqual([...alvos.dominios.entries()], [["geral", "Geral"], ["p4f--dev", "Dev"]]);
  });
});

describe("referenciaDoEvento", () => {
  it("bloco com horário: o início", () => {
    assert.equal(referenciaDoEvento(quest(), JANELA), t("2026-09-14T12:10:00-03:00"));
  });

  it("bloco de dia inteiro: não tem referência", () => {
    assert.equal(referenciaDoEvento(quest({ diaInteiro: true, inicio: "2026-09-14", fim: "2026-09-15" }), JANELA), null);
  });

  it("marco com horário: o FIM (o prazo real; o início é prazo − 15 min)", () => {
    const marco = quest({ tipo: "deadline", inicio: "2026-09-14T17:45:00-03:00", fim: "2026-09-14T18:00:00-03:00" });
    assert.equal(referenciaDoEvento(marco, JANELA), t("2026-09-14T18:00:00-03:00"));
  });

  it("marco de dia inteiro: início da janela de trabalho naquele dia", () => {
    const marco = quest({ tipo: "deadline", diaInteiro: true, inicio: "2026-09-18", fim: "2026-09-19" });
    assert.equal(referenciaDoEvento(marco, JANELA), t("2026-09-18T09:00:00-03:00"));
  });
});

describe("disparosDevidos", () => {
  it("avisa exatamente 10 min antes", () => {
    const [d] = disparosDevidos([quest()], AGORA, JANELA, ATIVOS, NADA);
    assert.equal(d.chave, `ev1@${t("2026-09-14T12:10:00-03:00")}`);
  });

  it("11 min antes ainda não", () => {
    assert.deepEqual(disparosDevidos([quest({ inicio: "2026-09-14T12:11:00-03:00" })], AGORA, JANELA, ATIVOS, NADA), []);
  });

  it("no horário ou depois: não avisa mais", () => {
    assert.deepEqual(disparosDevidos([quest({ inicio: "2026-09-14T12:00:00-03:00" })], AGORA, JANELA, ATIVOS, NADA), []);
    assert.deepEqual(disparosDevidos([quest({ inicio: "2026-09-14T11:55:00-03:00" })], AGORA, JANELA, ATIVOS, NADA), []);
  });

  it("dentro da janela mas atrasado (servidor voltou): ainda avisa", () => {
    assert.equal(disparosDevidos([quest({ inicio: "2026-09-14T12:03:00-03:00" })], AGORA, JANELA, ATIVOS, NADA).length, 1);
  });

  it("já enviado: não repete", () => {
    const enviados = new Set([`ev1@${t("2026-09-14T12:10:00-03:00")}`]);
    assert.deepEqual(disparosDevidos([quest()], AGORA, JANELA, ATIVOS, enviados), []);
  });

  it("evento movido depois do aviso: a chave muda e avisa de novo", () => {
    const enviados = new Set([`ev1@${t("2026-09-14T11:00:00-03:00")}`]);
    assert.equal(disparosDevidos([quest()], AGORA, JANELA, ATIVOS, enviados).length, 1);
  });

  it("domínio inativo ou evento sem domínio: não avisa", () => {
    assert.deepEqual(disparosDevidos([quest({ dominio: "velho" })], AGORA, JANELA, ATIVOS, NADA), []);
    assert.deepEqual(disparosDevidos([quest({ dominio: "" })], AGORA, JANELA, ATIVOS, NADA), []);
  });

  it("marco de dia inteiro avisa às 08:50", () => {
    const marco = quest({ tipo: "deadline", diaInteiro: true, inicio: "2026-09-14", fim: "2026-09-15" });
    assert.equal(disparosDevidos([marco], t("2026-09-14T08:50:00-03:00"), JANELA, ATIVOS, NADA).length, 1);
    assert.equal(disparosDevidos([marco], t("2026-09-14T08:49:00-03:00"), JANELA, ATIVOS, NADA).length, 0);
  });

  it("volta em ordem de referência e tira o prefixo do título do marco", () => {
    const marco = quest({ eventId: "m1", tipo: "deadline", titulo: "⏰ DEADLINE: [PO] Entregar", inicio: "2026-09-14T11:50:00-03:00", fim: "2026-09-14T12:05:00-03:00" });
    const ds = disparosDevidos([quest(), marco], AGORA, JANELA, ATIVOS, NADA);
    assert.deepEqual(ds.map((d) => d.eventId), ["m1", "ev1"]);
    assert.equal(ds[0].titulo, "[PO] Entregar");
  });
});

describe("mensagemDoDisparo", () => {
  const fuso = JANELA.fuso;

  it("bloco: minutos que faltam, intervalo e domínio", () => {
    const [d] = disparosDevidos([quest()], AGORA, JANELA, ATIVOS, NADA);
    assert.deepEqual(mensagemDoDisparo(d, AGORA, fuso, "Geral"), {
      titulo: "Em 10 min: [PO] Revisar contrato",
      corpo: "12:10–13:10 · Geral",
      prioridade: 3,
      tags: ["hourglass_flowing_sand"],
      clique: "https://calendar.google.com/ev1",
    });
  });

  it("marco com horário: prioridade alta e hora do prazo", () => {
    const marco = quest({ tipo: "deadline", titulo: "⏰ DEADLINE: [PO] Entregar", inicio: "2026-09-14T11:50:00-03:00", fim: "2026-09-14T12:05:00-03:00" });
    const [d] = disparosDevidos([marco], AGORA, JANELA, ATIVOS, NADA);
    const m = mensagemDoDisparo(d, AGORA, fuso, "Geral");
    assert.equal(m.titulo, "Prazo em 5 min: [PO] Entregar");
    assert.equal(m.corpo, "Vence às 12:05 · Geral");
    assert.equal(m.prioridade, 4);
  });

  it("marco de dia inteiro: 'Prazo hoje'", () => {
    const marco = quest({ tipo: "deadline", titulo: "⏰ DEADLINE: [PO] Entregar", diaInteiro: true, inicio: "2026-09-14", fim: "2026-09-15" });
    const agora = t("2026-09-14T08:50:00-03:00");
    const [d] = disparosDevidos([marco], agora, JANELA, ATIVOS, NADA);
    const m = mensagemDoDisparo(d, agora, fuso, "Geral");
    assert.equal(m.titulo, "Prazo hoje: [PO] Entregar");
    assert.equal(m.corpo, "Vence hoje · Geral");
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test server/lembretes.test.ts`
Esperado: FAIL — `Cannot find module './lembretes.ts'`.

- [ ] **Passo 3: implementar**

`server/lembretes.ts`:

```ts
/**
 * Lembretes push: QUAIS eventos avisar e O QUE dizer. Sem fetch, relógio, env
 * ou estado — quem varre (`vigia.ts`) passa o `agora`, a janela e o que já foi
 * enviado. É isso que deixa testar o disparo sem esperar o horário real.
 */
import { instanteLocal, lerInstante, type Janela } from "./alocador.ts";
import { PREFIXO_DEADLINE, type QuestCalendario } from "./calendar.ts";
import type { MensagemDePush } from "./push.ts";
import { dominiosAtivos, squadsAtivas, type Roster } from "./squad.ts";

const MIN_MS = 60_000;

/**
 * Minutos de antecedência. Constante e não env: uma env só foi o combinado
 * (LEMBRETES_NTFY_URL). Virar env é trocar isto por um leitor como lerJanela.
 */
export const ANTECEDENCIA_PUSH_MIN = 10;

/**
 * Intervalo entre varreduras. O aviso sai com até 1 min de atraso — irrelevante
 * frente a 10 de antecedência — e custa 1 events.list por calendário por minuto.
 */
export const VARREDURA_MS = 60_000;

export interface AlvosDaVarredura {
  /** Calendários distintos das squads ativas: um events.list por calendário. */
  calendarios: string[];
  /** id → nome dos domínios ativos. Evento de domínio fora daqui não avisa (mesmo critério da Mochila). */
  dominios: Map<string, string>;
}

export function alvosDoRoster(roster: Roster): AlvosDaVarredura {
  const squads = squadsAtivas(roster);
  const dominios = new Map<string, string>();
  for (const squad of squads) {
    for (const d of dominiosAtivos(squad)) dominios.set(d.id, d.nome);
  }
  return { calendarios: [...new Set(squads.map((s) => s.calendarId))], dominios };
}

export interface Disparo {
  /**
   * `eventId@referencia`. Com o instante na chave, um evento movido (Ajuste ou
   * edição no Google) depois do aviso volta a ser avisado no horário novo.
   */
  chave: string;
  eventId: string;
  tipo: "time_blocking" | "deadline";
  /** Título sem o prefixo de deadline: a mensagem já diz que é prazo. */
  titulo: string;
  dominio: string;
  /** Instante contra o qual a antecedência conta. */
  referencia: number;
  /** Fim do bloco, para o intervalo no texto; null em marco. */
  fim: number | null;
  diaInteiro: boolean;
  htmlLink?: string;
}

/**
 * Contra que instante a antecedência conta. null = não avisa.
 * - bloco com horário: o início;
 * - bloco de dia inteiro: sem hora, sem aviso (mesmo caso sem alvo do Ajuste);
 * - marco com horário: o FIM — o marco é gravado de prazo − 15 min até o prazo,
 *   e o início é só a folga para ele aparecer na grade do Google;
 * - marco de dia inteiro: início da janela de trabalho do dia ("vence hoje"
 *   às 08:50, não meia-noite menos 10).
 */
export function referenciaDoEvento(q: QuestCalendario, janela: Janela): number | null {
  const { fuso } = janela;
  if (q.tipo === "time_blocking") {
    if (q.diaInteiro) return null;
    return lerInstante(q.inicio, fuso)?.instante ?? null;
  }
  if (q.diaInteiro) {
    const dia = lerInstante(q.inicio, fuso);
    return dia?.data ? instanteLocal(dia.data, janela.inicioMin, fuso) : null;
  }
  return lerInstante(q.fim, fuso)?.instante ?? null;
}

/**
 * Eventos cujo momento de avisar já chegou e cujo horário ainda não. A janela é
 * [referência − antecedência, referência): um aviso atrasado (servidor que
 * voltou no meio dela) ainda serve; depois do horário, não.
 */
export function disparosDevidos(
  quests: QuestCalendario[],
  agora: number,
  janela: Janela,
  dominiosAtivos: { has(id: string): boolean },
  jaEnviados: { has(chave: string): boolean },
  antecedenciaMin = ANTECEDENCIA_PUSH_MIN,
): Disparo[] {
  const disparos: Disparo[] = [];
  for (const q of quests) {
    if (!q.dominio || !dominiosAtivos.has(q.dominio)) continue;
    const referencia = referenciaDoEvento(q, janela);
    if (referencia === null) continue;
    if (agora < referencia - antecedenciaMin * MIN_MS || agora >= referencia) continue;
    const chave = `${q.eventId}@${referencia}`;
    if (jaEnviados.has(chave)) continue;
    disparos.push({
      chave,
      eventId: q.eventId,
      tipo: q.tipo,
      titulo: q.titulo.startsWith(PREFIXO_DEADLINE) ? q.titulo.slice(PREFIXO_DEADLINE.length).trim() : q.titulo,
      dominio: q.dominio,
      referencia,
      fim: q.tipo === "time_blocking" ? (lerInstante(q.fim, janela.fuso)?.instante ?? null) : null,
      diaInteiro: q.diaInteiro,
      ...(q.htmlLink ? { htmlLink: q.htmlLink } : {}),
    });
  }
  return disparos.sort((a, b) => a.referencia - b.referencia);
}

/**
 * Texto da notificação. Minutos contados do `agora` real, não da antecedência
 * nominal: um aviso atrasado diz quanto falta de verdade.
 */
export function mensagemDoDisparo(d: Disparo, agora: number, fuso: string, nomeDoDominio: string): MensagemDePush {
  const formato = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hora = (instante: number) => formato.format(instante);
  const faltam = Math.max(1, Math.ceil((d.referencia - agora) / MIN_MS));
  const clique = d.htmlLink ? { clique: d.htmlLink } : {};

  if (d.tipo === "time_blocking") {
    const intervalo = d.fim === null ? hora(d.referencia) : `${hora(d.referencia)}–${hora(d.fim)}`;
    return {
      titulo: `Em ${faltam} min: ${d.titulo}`,
      corpo: `${intervalo} · ${nomeDoDominio}`,
      prioridade: 3,
      tags: ["hourglass_flowing_sand"],
      ...clique,
    };
  }
  if (d.diaInteiro) {
    return { titulo: `Prazo hoje: ${d.titulo}`, corpo: `Vence hoje · ${nomeDoDominio}`, prioridade: 4, tags: ["alarm_clock"], ...clique };
  }
  return {
    titulo: `Prazo em ${faltam} min: ${d.titulo}`,
    corpo: `Vence às ${hora(d.referencia)} · ${nomeDoDominio}`,
    prioridade: 4,
    tags: ["alarm_clock"],
    ...clique,
  };
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test server/lembretes.test.ts`
Esperado: PASS. Se o texto da hora vier diferente de `12:10` (ICU sem pt-BR), confira `node -p "new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(0)"` — deve imprimir `21:00`. Node 22 oficial vem com ICU completo.

- [ ] **Passo 5: commit**

```bash
git add server/lembretes.ts server/lembretes.test.ts
git commit -m "feat(push): regra pura de quando e o que avisar"
```

---

### Tarefa 3: leitura da janela no Calendar + vigia (`server/calendar.ts`, `server/vigia.ts`)

**Arquivos:**
- Modificar: `server/calendar.ts` (acrescentar `listarQuestsDaJanela` logo depois de `listarQuests`, ~linha 296)
- Criar: `server/vigia.ts`
- Teste: `server/vigia.test.ts`

**Interfaces:**
- Consome:
  - Tarefa 1: `type MensagemDePush`
  - Tarefa 2: `ANTECEDENCIA_PUSH_MIN`, `VARREDURA_MS`, `alvosDoRoster`, `disparosDevidos`, `mensagemDoDisparo`
  - `PrecisaConectar` de `server/auth-store.ts`; `type Janela` de `server/alocador.ts`; `type Roster` de `server/squad.ts`
  - Internos de `server/calendar.ts`: `listarPaginado<T>(calendarId, params, token)`, `paraQuest(ev)`, `PROP_DOMINIO`, `interface GoogleEvent`
- Produz:
  - `async function listarQuestsDaJanela(token: string, calendarId: string, de: Date, ate: Date): Promise<QuestCalendario[]>` (em `calendar.ts`)
  - `interface DependenciasDaVigia`, `interface ResultadoDaVarredura`, `interface Vigia { varrer(agora: Date, opcoes: { enviar: boolean; registrar: boolean }): Promise<ResultadoDaVarredura>; iniciar(relogio?: () => Date): () => void }`
  - `function criarVigia(dep: DependenciasDaVigia): Vigia`
  - `const AVISO_DESCONECTADO: MensagemDePush`

- [ ] **Passo 1: escrever o teste que falha**

`server/vigia.test.ts`:

```ts
/**
 * Vigia dos lembretes: deduplicação em memória, retentativa, aviso de
 * desconexão e isolamento de falhas. Dependências são dublês — nada toca o
 * Google nem o ntfy.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { lerJanela } from "./alocador.ts";
import { PrecisaConectar } from "./auth-store.ts";
import { listarQuestsDaJanela, type QuestCalendario } from "./calendar.ts";
import type { MensagemDePush } from "./push.ts";
import type { Roster } from "./squad.ts";
import { AVISO_DESCONECTADO, criarVigia, type DependenciasDaVigia } from "./vigia.ts";

const JANELA = lerJanela({});
const AGORA = new Date("2026-09-14T12:00:00-03:00");

const pessoa = { id: "po", nome: "Ana", papel: "PO", escopo: "", sprite: "x", hiredAt: "2026-09-01" };
const ROSTER: Roster = {
  version: 3,
  idsAposentados: { pessoas: [], dominios: [] },
  squads: [
    {
      id: "pessoal", nome: "Pessoal", escopo: "", calendarId: "primary", unlockOrder: [[1, 1]],
      dominios: [{ id: "geral", nome: "Geral", escopo: "", slot: [1, 1], room: "r", criadoEm: "2026-09-01", po: pessoa, integrantes: [] }],
    },
  ],
};

function quest(p: Partial<QuestCalendario> = {}): QuestCalendario {
  return {
    eventId: "ev1", titulo: "[PO] Revisar contrato",
    inicio: "2026-09-14T12:10:00-03:00", fim: "2026-09-14T13:10:00-03:00",
    diaInteiro: false, tipo: "time_blocking", dominio: "geral", membro: "po", squad: "pessoal", prazoRef: "",
    ...p,
  };
}

function montar(sobre: Partial<DependenciasDaVigia> = {}) {
  const enviadas: MensagemDePush[] = [];
  const dep: DependenciasDaVigia = {
    lerJanela: () => JANELA,
    lerRoster: async () => ROSTER,
    obterToken: async () => "tk",
    listar: async () => [quest()],
    enviar: async (m) => {
      enviadas.push(m);
    },
    log: { log() {}, error() {} },
    ...sobre,
  };
  return { vigia: criarVigia(dep), enviadas };
}

const REAL = { enviar: true, registrar: true };

describe("vigia", () => {
  it("avisa uma vez só em varreduras seguidas", async () => {
    const { vigia, enviadas } = montar();
    await vigia.varrer(AGORA, REAL);
    await vigia.varrer(new Date(AGORA.getTime() + 60_000), REAL);
    assert.equal(enviadas.length, 1);
    assert.equal(enviadas[0].titulo, "Em 10 min: [PO] Revisar contrato");
  });

  it("push que falhou não entra na deduplicação e é tentado de novo", async () => {
    let falhar = true;
    const enviadas: MensagemDePush[] = [];
    const { vigia } = montar({
      enviar: async (m) => {
        if (falhar) throw new Error("ntfy fora");
        enviadas.push(m);
      },
    });
    const r1 = await vigia.varrer(AGORA, REAL);
    assert.equal(r1.erros.length, 1);
    assert.equal(r1.mensagens[0].enviada, false);
    falhar = false;
    await vigia.varrer(new Date(AGORA.getTime() + 60_000), REAL);
    assert.equal(enviadas.length, 1);
  });

  it("enviar=false só monta a mensagem", async () => {
    const { vigia, enviadas } = montar();
    const r = await vigia.varrer(AGORA, { enviar: false, registrar: false });
    assert.equal(enviadas.length, 0);
    assert.equal(r.mensagens.length, 1);
    assert.equal(r.mensagens[0].enviada, false);
    assert.equal(r.mensagens[0].eventId, "ev1");
  });

  it("varredura de teste (registrar=false) não suprime o aviso real", async () => {
    const { vigia, enviadas } = montar();
    await vigia.varrer(AGORA, { enviar: true, registrar: false });
    await vigia.varrer(AGORA, REAL);
    assert.equal(enviadas.length, 2);
  });

  it("evento movido depois do aviso: avisa de novo", async () => {
    let atual = quest();
    const { vigia, enviadas } = montar({ listar: async () => [atual] });
    await vigia.varrer(AGORA, REAL);
    atual = quest({ inicio: "2026-09-14T12:08:00-03:00", fim: "2026-09-14T13:08:00-03:00" });
    await vigia.varrer(AGORA, REAL);
    assert.equal(enviadas.length, 2);
  });

  it("sem credencial: um aviso de desconexão por perda, não por minuto", async () => {
    let conectado = false;
    const { vigia, enviadas } = montar({
      obterToken: async () => {
        if (!conectado) throw new PrecisaConectar("sem credencial");
        return "tk";
      },
      listar: async () => [],
    });
    const r = await vigia.varrer(AGORA, REAL);
    assert.equal(r.semCredencial, true);
    await vigia.varrer(AGORA, REAL);
    assert.deepEqual(enviadas, [AVISO_DESCONECTADO]);

    conectado = true;
    await vigia.varrer(AGORA, REAL);
    conectado = false;
    await vigia.varrer(AGORA, REAL);
    assert.equal(enviadas.length, 2);
  });

  it("varredura de teste sem credencial não manda aviso de desconexão", async () => {
    const { vigia, enviadas } = montar({
      obterToken: async () => {
        throw new PrecisaConectar("sem credencial");
      },
    });
    const r = await vigia.varrer(AGORA, { enviar: true, registrar: false });
    assert.equal(r.semCredencial, true);
    assert.equal(enviadas.length, 0);
  });

  it("falha na leitura de um calendário vira erro, não exceção", async () => {
    const { vigia } = montar({
      listar: async () => {
        throw new Error("Google Calendar respondeu 503");
      },
    });
    const r = await vigia.varrer(AGORA, REAL);
    assert.equal(r.mensagens.length, 0);
    assert.match(r.erros[0], /primary/);
  });

  it("pede ao Google a janela agora → agora + antecedência + 2 varreduras", async () => {
    let pedido: { de: Date; ate: Date } | null = null;
    const { vigia } = montar({
      listar: async (_t, _c, de, ate) => {
        pedido = { de, ate };
        return [];
      },
    });
    await vigia.varrer(AGORA, REAL);
    assert.equal(pedido!.de.getTime(), AGORA.getTime());
    assert.equal(pedido!.ate.getTime(), AGORA.getTime() + 12 * 60_000);
  });
});

describe("listarQuestsDaJanela", () => {
  const fetchOriginal = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("uma leitura sem filtro de marca; só volta evento do SquadOne não cancelado", async () => {
    const urls: string[] = [];
    const marcas = { squadone_dominio: "geral", squadone_membro: "po", squadone_tipo: "time_blocking", squadone_squad: "pessoal" };
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { id: "a1", summary: "do app", start: { dateTime: "2026-09-14T12:10:00-03:00" }, end: { dateTime: "2026-09-14T13:10:00-03:00" }, extendedProperties: { private: marcas } },
            { id: "b2", summary: "reunião de fora", start: { dateTime: "2026-09-14T12:10:00-03:00" }, end: { dateTime: "2026-09-14T13:00:00-03:00" } },
            { id: "c3", status: "cancelled", summary: "apagado", start: { dateTime: "2026-09-14T12:10:00-03:00" }, end: { dateTime: "2026-09-14T13:00:00-03:00" }, extendedProperties: { private: marcas } },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const quests = await listarQuestsDaJanela("tk", "primary", AGORA, new Date(AGORA.getTime() + 12 * 60_000));

    assert.deepEqual(quests.map((q) => q.eventId), ["a1"]);
    assert.equal(urls.length, 1);
    const busca = new URL(urls[0]).searchParams;
    assert.equal(busca.get("timeMin"), AGORA.toISOString());
    assert.equal(busca.get("singleEvents"), "true");
    assert.equal(busca.has("privateExtendedProperty"), false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx tsx --test server/vigia.test.ts`
Esperado: FAIL — `Cannot find module './vigia.ts'` (e `listarQuestsDaJanela` não exportado).

- [ ] **Passo 3a: implementar `listarQuestsDaJanela` em `server/calendar.ts`**

Inserir logo depois do fim de `listarQuests` (depois da linha `return { quests, erros };` + `}`):

```ts
/**
 * Eventos do SquadOne numa janela CURTA, para os lembretes (vigia.ts). Uma
 * chamada por calendário e sem `privateExtendedProperty`: o filtro por marca
 * exige uma chamada por domínio (match exato, sem wildcard), e numa janela de
 * minutos o payload sem filtro é pequeno. A marca é conferida aqui, e o
 * domínio ativo em `disparosDevidos`.
 */
export async function listarQuestsDaJanela(
  token: string,
  calendarId: string,
  de: Date,
  ate: Date,
): Promise<QuestCalendario[]> {
  const eventos = await listarPaginado<GoogleEvent>(
    calendarId,
    {
      timeMin: de.toISOString(),
      timeMax: ate.toISOString(),
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "250",
    },
    token,
  );
  const quests: QuestCalendario[] = [];
  for (const ev of eventos) {
    if (ev.status === "cancelled") continue;
    if (!ev.extendedProperties?.private?.[PROP_DOMINIO]) continue;
    const quest = paraQuest(ev);
    if (quest) quests.push(quest);
  }
  return quests;
}
```

- [ ] **Passo 3b: implementar `server/vigia.ts`**

```ts
/**
 * A vigia dos lembretes: a cada VARREDURA_MS relê a agenda numa janela curta e
 * publica no ntfy o que ficou devido. Nada é agendado para o futuro e nada vai
 * para o disco: o Google é a verdade (editar, apagar ou ajustar lá reflete na
 * varredura seguinte) e um redeploy não deixa timer órfão.
 *
 * Roda separada do turno: falha do ntfy ou da leitura nunca chega em
 * agendamento.ts nem em ajuste.ts.
 */
import type { Janela } from "./alocador.ts";
import { PrecisaConectar } from "./auth-store.ts";
import type { QuestCalendario } from "./calendar.ts";
import {
  alvosDoRoster,
  ANTECEDENCIA_PUSH_MIN,
  disparosDevidos,
  mensagemDoDisparo,
  VARREDURA_MS,
} from "./lembretes.ts";
import type { MensagemDePush } from "./push.ts";
import type { Roster } from "./squad.ts";

const MIN_MS = 60_000;

/** Chaves enviadas somem depois disto: o evento já começou há muito. */
const RETENCAO_MS = 60 * MIN_MS;

export interface DependenciasDaVigia {
  /** Lida a cada varredura: JANELA_TRABALHO ilegível vira erro da varredura, não do boot. */
  lerJanela: () => Janela;
  lerRoster: () => Promise<Roster>;
  obterToken: () => Promise<string>;
  listar: (token: string, calendarId: string, de: Date, ate: Date) => Promise<QuestCalendario[]>;
  enviar: (m: MensagemDePush) => Promise<void>;
  log?: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export interface ResultadoDaVarredura {
  /** Na ordem dos eventos. `enviada` false = só montada (enviar=false) ou o ntfy falhou (ver erros). */
  mensagens: (MensagemDePush & { eventId: string; enviada: boolean })[];
  erros: string[];
  semCredencial: boolean;
}

export interface Vigia {
  /**
   * Uma varredura com o relógio dado. `registrar` false (rota de teste) consulta
   * a deduplicação mas não grava nada nela nem no aviso de desconexão: um teste
   * não pode engolir o aviso real.
   */
  varrer(agora: Date, opcoes: { enviar: boolean; registrar: boolean }): Promise<ResultadoDaVarredura>;
  /** Liga o laço. Devolve a função que desliga. */
  iniciar(relogio?: () => Date): () => void;
}

/**
 * Sem credencial a vigia fica cega e o usuário não abriria o app para
 * descobrir: o próprio push avisa, uma vez por perda.
 */
export const AVISO_DESCONECTADO: MensagemDePush = {
  titulo: "SquadOne sem acesso ao Google",
  corpo: "Os lembretes pararam. Abra o SquadOne e reconecte o calendário.",
  prioridade: 4,
  tags: ["warning"],
};

const mensagemDe = (err: unknown) => (err as Error)?.message ?? String(err);

export function criarVigia(dep: DependenciasDaVigia): Vigia {
  const log = dep.log ?? console;
  /** chave → referência. Só memória: redeploy na janela de 10 min reenvia uma vez (custo aceito). */
  const enviados = new Map<string, number>();
  let avisouDesconexao = false;
  let emAndamento = false;

  async function varrer(agora: Date, opcoes: { enviar: boolean; registrar: boolean }): Promise<ResultadoDaVarredura> {
    const resultado: ResultadoDaVarredura = { mensagens: [], erros: [], semCredencial: false };
    const janela = dep.lerJanela();
    const alvos = alvosDoRoster(await dep.lerRoster());

    let token: string;
    try {
      token = await dep.obterToken();
    } catch (err) {
      // ErroDeConfig e o resto sobem: é ambiente, e quem chama loga ou responde 500.
      if (!(err instanceof PrecisaConectar)) throw err;
      resultado.semCredencial = true;
      if (opcoes.enviar && opcoes.registrar && !avisouDesconexao) {
        try {
          await dep.enviar(AVISO_DESCONECTADO);
          avisouDesconexao = true;
        } catch (e) {
          resultado.erros.push(`aviso de desconexão não saiu: ${mensagemDe(e)}`);
        }
      }
      return resultado;
    }
    if (opcoes.registrar) avisouDesconexao = false;

    // Margem de 2 varreduras: um tick atrasado (Google lento) não perde evento na borda.
    const ate = new Date(agora.getTime() + ANTECEDENCIA_PUSH_MIN * MIN_MS + 2 * VARREDURA_MS);
    const quests: QuestCalendario[] = [];
    for (const calendarId of alvos.calendarios) {
      // Um calendário quebrado não cala os outros.
      try {
        quests.push(...(await dep.listar(token, calendarId, agora, ate)));
      } catch (err) {
        resultado.erros.push(`calendário '${calendarId}': ${mensagemDe(err)}`);
      }
    }

    for (const d of disparosDevidos(quests, agora.getTime(), janela, alvos.dominios, enviados)) {
      const m = mensagemDoDisparo(d, agora.getTime(), janela.fuso, alvos.dominios.get(d.dominio) ?? d.dominio);
      let enviada = false;
      if (opcoes.enviar) {
        try {
          await dep.enviar(m);
          enviada = true;
          if (opcoes.registrar) enviados.set(d.chave, d.referencia);
        } catch (err) {
          // Fora da deduplicação: a próxima varredura tenta de novo enquanto o evento não começar.
          resultado.erros.push(`push de '${d.titulo}' não saiu: ${mensagemDe(err)}`);
        }
      }
      resultado.mensagens.push({ ...m, eventId: d.eventId, enviada });
    }

    if (opcoes.registrar) {
      for (const [chave, referencia] of enviados) {
        if (referencia < agora.getTime() - RETENCAO_MS) enviados.delete(chave);
      }
    }
    return resultado;
  }

  function iniciar(relogio: () => Date = () => new Date()): () => void {
    let semCredencialAntes = false;
    const tick = async () => {
      // Google lento: não empilha varreduras nem manda o mesmo aviso duas vezes em paralelo.
      if (emAndamento) return;
      emAndamento = true;
      try {
        const r = await varrer(relogio(), { enviar: true, registrar: true });
        if (r.semCredencial !== semCredencialAntes) {
          log.error(
            r.semCredencial
              ? "[push] sem credencial do Google: lembretes parados até reconectar"
              : "[push] credencial de volta: lembretes retomados",
          );
          semCredencialAntes = r.semCredencial;
        }
        for (const m of r.mensagens) if (m.enviada) log.log(`[push] ${m.titulo}`);
        for (const e of r.erros) log.error(`[push] ${e}`);
      } catch (err) {
        log.error(`[push] varredura falhou: ${mensagemDe(err)}`);
      } finally {
        emAndamento = false;
      }
    };
    const id = setInterval(tick, VARREDURA_MS);
    void tick();
    return () => clearInterval(id);
  }

  return { varrer, iniciar };
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx tsx --test server/vigia.test.ts`
Esperado: PASS.

Rodar: `npm test`
Esperado: PASS em tudo (inclui os testes antigos).

- [ ] **Passo 5: commit**

```bash
git add server/calendar.ts server/vigia.ts server/vigia.test.ts
git commit -m "feat(push): vigia que varre a agenda e avisa antes do horario"
```

---

### Tarefa 4: ligar no servidor, rotas de teste e documentação

**Arquivos:**
- Modificar: `server.ts` (imports ~linha 17-45; boot da vigia antes das rotas de quest ~linha 374; rotas novas depois de `/api/quests/:eventId/ajustar` ~linha 399; log e início do laço ~linha 416-426)
- Modificar: `.env.example` (fim do arquivo)
- Modificar: `CLAUDE.md`

**Interfaces:**
- Consome: `lerConfigDePush`, `descreverPush`, `enviarPush`, `PushMalConfigurado`, `ErroDePush`, `type ConfigDePush` (Tarefa 1); `ANTECEDENCIA_PUSH_MIN` (Tarefa 2); `criarVigia`, `type Vigia` (Tarefa 3); `listarQuestsDaJanela` (Tarefa 3); `FUSO`, `lerInstante`, `lerJanela`, `JanelaMalConfigurada` de `server/alocador.ts`; `readRoster`; `tokenValido`, `ErroDeConfig`.
- Produz:
  - `POST /api/push/teste` → 200 `{ enviado: true }` | 409 `{ error, pushDesligado: true }` | 500 `{ error, configuracao: true }` | 502 `{ error, pushFalhou: true, credencial }`
  - `POST /api/push/varrer` body `{ agora?: string (ISO com hora), enviar?: boolean }` → 200 `ResultadoDaVarredura` | 400 | 409 `pushDesligado` | 500 `configuracao`

- [ ] **Passo 1: imports em `server.ts`**

Trocar a linha de import do calendar e do alocador e acrescentar os novos:

```ts
import { ErroCalendario, LeituraIncompleta, listarQuests, listarQuestsDaJanela, MarcasPerdidas, QuestSumiu } from "./server/calendar.ts";
```

```ts
import { descreverJanela, FUSO, JanelaMalConfigurada, lerInstante, lerJanela, SemHorarioLivre } from "./server/alocador.ts";
import { descreverPush, enviarPush, ErroDePush, lerConfigDePush, PushMalConfigurado, type ConfigDePush } from "./server/push.ts";
import { ANTECEDENCIA_PUSH_MIN } from "./server/lembretes.ts";
import { criarVigia, type Vigia } from "./server/vigia.ts";
```

- [ ] **Passo 2: montar a vigia no boot (dentro de `startServer`, antes das rotas de quest)**

Logo antes do comentário `// Ajuste APROVADO pelo usuário.`:

```ts
  // --- Lembretes push ---------------------------------------------------
  // Config ilegível NÃO derruba o boot: push é acessório, o turno e a Mochila
  // seguem. O erro fica guardado para o log e para as rotas /api/push/*.
  let configDePush: ConfigDePush | null = null;
  let falhaDoPush: string | null = null;
  try {
    configDePush = lerConfigDePush(process.env);
  } catch (error: any) {
    falhaDoPush = error instanceof PushMalConfigurado ? error.message : String(error?.message ?? error);
  }
  const vigia: Vigia | null = configDePush
    ? criarVigia({
        lerJanela: () => lerJanela(process.env),
        lerRoster: readRoster,
        obterToken: tokenValido,
        listar: listarQuestsDaJanela,
        enviar: (m) => enviarPush(configDePush!, m),
      })
    : null;

  /** 409 quando desligado, 500 quando mal configurado; false = pode seguir. */
  function pushIndisponivel(res: express.Response): boolean {
    if (falhaDoPush) {
      res.status(500).json({ error: falhaDoPush, configuracao: true });
      return true;
    }
    if (!configDePush || !vigia) {
      res.status(409).json({ error: "Push desligado: LEMBRETES_NTFY_URL vazia.", pushDesligado: true });
      return true;
    }
    return false;
  }
```

- [ ] **Passo 3: rotas (logo depois da rota `/api/quests/:eventId/ajustar`)**

```ts
  // Confere servidor ntfy + celular sem esperar evento nenhum.
  app.post("/api/push/teste", async (_req, res) => {
    if (pushIndisponivel(res)) return;
    try {
      const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" }).format(new Date());
      await enviarPush(configDePush!, {
        titulo: "SquadOne: teste de lembrete",
        corpo: `Push funcionando (${hora}).`,
        prioridade: 3,
        tags: ["white_check_mark"],
      });
      res.json({ enviado: true });
    } catch (error: any) {
      if (error instanceof ErroDePush) {
        return res.status(502).json({ error: error.message, pushFalhou: true, credencial: error.credencial });
      }
      console.error("Erro no push de teste:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Uma varredura REAL contra o Google com relógio simulado: mostra o que
  // sairia (enviar=false, padrão) ou manda de fato (enviar=true). Nunca grava
  // na deduplicação da vigia — o teste não engole o aviso de verdade.
  app.post("/api/push/varrer", async (req, res) => {
    if (pushIndisponivel(res)) return;
    const { agora, enviar = false } = req.body ?? {};
    let relogio = new Date();
    if (agora !== undefined) {
      const lido = lerInstante(agora, FUSO);
      if (!lido || lido.data !== null) {
        return res.status(400).json({ error: "Campo 'agora' deve ser data/hora ISO, ex.: 2026-09-15T13:50:00-03:00" });
      }
      relogio = new Date(lido.instante);
    }
    if (typeof enviar !== "boolean") {
      return res.status(400).json({ error: "Campo 'enviar' deve ser booleano" });
    }
    try {
      res.json(await vigia!.varrer(relogio, { enviar, registrar: false }));
    } catch (error: any) {
      if (error instanceof JanelaMalConfigurada || error instanceof ErroDeConfig) {
        return res.status(500).json({ error: error.message, configuracao: true });
      }
      console.error("Erro na varredura de teste:", error);
      res.status(500).json({ error: error.message });
    }
  });
```

- [ ] **Passo 4: log do boot e início do laço**

Substituir o bloco final de `startServer` (log da janela + `app.listen`) por:

```ts
  // A janela e lida a cada turno; logar no boot mostra no painel do Easypanel
  // o que vale agora, ou o erro, sem esperar alguem delegar uma quest.
  try {
    console.log(`Janela de trabalho: ${descreverJanela(lerJanela(process.env))}`);
  } catch (error: any) {
    console.error(`Janela de trabalho inválida: ${error.message}`);
  }
  if (falhaDoPush) console.error(`Lembretes push inválidos (desligados): ${falhaDoPush}`);
  else if (configDePush) console.log(`Lembretes push: ${descreverPush(configDePush)}, ${ANTECEDENCIA_PUSH_MIN} min antes`);
  else console.log("Lembretes push desligados (LEMBRETES_NTFY_URL vazia)");

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    // Depois do listen: a primeira varredura não disputa o boot do Vite.
    vigia?.iniciar();
  });
```

- [ ] **Passo 5: `.env.example`** — acrescentar ao fim:

```bash
# LEMBRETES_NTFY_URL: servidor ntfy PROPRIO + topico para os lembretes push,
# com o access token do ntfy como senha na URL (usuario vazio):
#   https://:tk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXX@ntfy.seu-dominio/squadone-lembretes
# Vazio ou ausente = push desligado, o resto do app igual. Valor ilegivel =
# erro no log do boot e push desligado (nao derruba nada). Nunca use ntfy.sh:
# o titulo do compromisso vai na notificacao. Em dev use OUTRO topico, senao
# o `npm run dev` com a mesma credencial do Google duplica os avisos do celular.
LEMBRETES_NTFY_URL=""
```

- [ ] **Passo 6: `CLAUDE.md`**

a) Na árvore de "Arquitetura", depois da linha de `server/calendar.ts`:

```
  server/push.ts          transporte ntfy: LEMBRETES_NTFY_URL, POST JSON, erros classificados
  server/lembretes.ts     PURO: quais eventos avisar, quando e com que texto
  server/vigia.ts         laço de 60 s: relê a agenda e publica os lembretes devidos
```

b) Nova seção logo antes de `### Escrita no roster`:

```markdown
### Lembretes push (ntfy)

Push no celular `ANTECEDENCIA_PUSH_MIN` (10) minutos antes de cada bloco e de cada marco, via servidor **ntfy próprio** (serviço `ntfy` no projeto `aladdin` do Easypanel; nunca `ntfy.sh`). O celular usa o app ntfy oficial assinando o tópico.

- **Nada é agendado para o futuro.** `server/vigia.ts` roda a cada 60 s: lê o roster, pede o token, faz **um** `events.list` por calendário distinto das squads ativas na janela `agora → agora + 12 min` (`listarQuestsDaJanela`, sem filtro de marca) e publica o que `disparosDevidos` (`server/lembretes.ts`, puro) devolver. Editar, apagar ou ajustar no Google reflete na varredura seguinte; redeploy não deixa timer órfão.
- **Quem avisa:** só evento com `squadone_dominio` de domínio ativo. Bloco com horário (foco ou bloco de prazo) conta do **início**; marco com horário conta do **fim** (o prazo real — o marco vai de prazo − 15 min até o prazo); marco de dia inteiro conta do início da `JANELA_TRABALHO` do dia; bloco de dia inteiro não avisa. Evento que o SquadOne não criou não avisa.
- **Janela do disparo:** `[referência − 10 min, referência)`. Aviso atrasado ainda sai; depois do horário, não.
- **Deduplicação só em memória** (`eventId@referência`), sem arquivo em `data/`. Evento movido ganha chave nova e é avisado de novo. Custo aceito: redeploy dentro dos 10 min reenvia uma vez; servidor fora do ar durante a janela inteira perde o aviso.
- **Falha não se propaga:** `agendamento.ts` e `ajuste.ts` não sabem que o push existe. POST ao ntfy com timeout de 5 s; push que falha fica fora da deduplicação e é tentado na varredura seguinte. Um calendário que falha não cala os outros. Varreduras não se sobrepõem.
- **Sem credencial do Google:** um push "SquadOne sem acesso ao Google" por perda (não por minuto); volta a avisar normalmente quando reconecta.
- **Testar sem esperar o horário:** `POST /api/push/teste` manda um push fixo agora. `POST /api/push/varrer {"agora":"2026-09-15T13:50:00-03:00","enviar":false}` roda uma varredura real contra o Google com relógio simulado e devolve as mensagens que sairiam; `enviar: true` manda de fato. Nenhuma das duas grava na deduplicação da vigia.
- **Dev:** com `LEMBRETES_NTFY_URL` no `.env` o `npm run dev` também varre. Use outro tópico, senão o celular recebe em dobro.
```

c) Na tabela de "Variáveis de ambiente", nova linha no fim:

```
| `LEMBRETES_NTFY_URL` | servidor | lembretes push: `https://:TOKEN@host/topico` do ntfy próprio; ausente/vazia = desligado; ilegível = log de erro no boot e desligado (não derruba nada) |
```

d) Em "Convenções", na lista de erros classificados, acrescentar depois de `JanelaMalConfigurada (500 + configuracao)`:

```
`PushMalConfigurado` (500 + `configuracao`, só nas rotas `/api/push/*`), `ErroDePush` (502 + `pushFalhou`; `credencial` quando o ntfy deu 401/403),
```

- [ ] **Passo 7: verificação estática**

Rodar: `npx vue-tsc --noEmit`
Esperado: sem erros.

Rodar: `npm test`
Esperado: PASS.

Rodar: `npm run build`
Esperado: `dist/server.cjs` gerado sem erro.

- [ ] **Passo 8: exercitar as rotas localmente (sem esperar o horário)**

1. Sem ntfy — só a regra, contra o Google real. No `.env` local: `LEMBRETES_NTFY_URL="http://localhost:9/dev-squadone"` (porta sem nada; o POST falharia, mas `enviar:false` não publica). `npm run dev`. O log do boot deve mostrar `Lembretes push: http://localhost:9/dev-squadone (sem token), 10 min antes` e, a cada minuto, `[push] ...` só se houver evento na janela.
2. Com o app conectado ao Google, pegue uma quest da Mochila (ex.: início `2026-09-15T14:00:00-03:00`) e simule 10 min antes:

```bash
curl -s -X POST http://localhost:3000/api/push/varrer -H "Content-Type: application/json" -d "{\"agora\":\"2026-09-15T13:50:00-03:00\"}"
```

Esperado: `{"mensagens":[{"titulo":"Em 10 min: ...","corpo":"14:00–15:00 · <Domínio>","enviada":false,...}],"erros":[],"semCredencial":false}`.

3. Mesmo comando com `"agora":"2026-09-15T13:49:00-03:00"` → `mensagens: []`. Com `"agora":"2026-09-15T14:00:00-03:00"` → `mensagens: []`.
4. Validação: `-d "{\"agora\":\"amanha\"}"` → 400. Com `LEMBRETES_NTFY_URL` vazia → 409 `pushDesligado`. Com `LEMBRETES_NTFY_URL="ftp://x/y"` → boot loga `Lembretes push inválidos (desligados): ...`, `/api/squad` segue 200, `/api/push/teste` → 500 `configuracao`.
5. (Opcional, se houver Docker) ntfy local de verdade:

```bash
docker run --rm -p 8080:80 binwiederhier/ntfy serve
```

`LEMBRETES_NTFY_URL="http://localhost:8080/dev-squadone"`, reiniciar o dev, abrir `http://localhost:8080/dev-squadone` no navegador e chamar `POST /api/push/teste` → notificação aparece na página. Depois `varrer` com `"enviar":true` → a mensagem do evento aparece.

- [ ] **Passo 9: commit**

```bash
git add server.ts .env.example CLAUDE.md
git commit -m "feat(push): ligar vigia de lembretes ntfy e rotas de teste"
```

---

### Tarefa 5: ntfy no Easypanel, celular e implantação (manual, com o usuário)

O agente **não** clica no Easypanel nem no celular: entrega este checklist ao usuário e só marca como feito com a confirmação dele. A parte do agente é `git push` + `graphify update .`.

- [ ] **Passo 1: push do código e grafo**

```bash
git push
```

```bash
graphify update .
```

- [ ] **Passo 2 (usuário): serviço ntfy no projeto `aladdin`**

1. Easypanel → projeto `aladdin` → novo serviço **App** chamado `ntfy`, fonte **imagem Docker** `binwiederhier/ntfy` (fixar a última tag estável `v2.x` em vez de `latest`), comando `serve`.
2. Volume montado em `/var/lib/ntfy` (banco de usuários e cache de mensagens).
3. Variáveis de ambiente do **container ntfy**:

   | Var | Valor |
   |---|---|
   | `NTFY_BASE_URL` | `https://<domínio do serviço ntfy no Easypanel>` |
   | `NTFY_BEHIND_PROXY` | `true` |
   | `NTFY_AUTH_FILE` | `/var/lib/ntfy/user.db` |
   | `NTFY_AUTH_DEFAULT_ACCESS` | `deny-all` |
   | `NTFY_CACHE_FILE` | `/var/lib/ntfy/cache.db` |

4. Domínio: porta interna `80`, HTTPS pelo Traefik do Easypanel. **Sem** porteiro de IP aqui: o celular muda de IP na rede móvel. A proteção é `deny-all` + usuários/token — por isso o tópico sem auth nunca pode ficar aberto.
5. Implantar. Abrir `https://<domínio>/v1/health` → `{"healthy":true}`.

- [ ] **Passo 3 (usuário): usuários, acesso e token — no console do container ntfy**

```bash
ntfy user add --role=user romulo
```

```bash
ntfy user add --role=user squadone
```

```bash
ntfy access romulo squadone-lembretes read-only
```

```bash
ntfy access squadone squadone-lembretes write-only
```

```bash
ntfy token add squadone
```

Guardar o `tk_...` impresso. `romulo` só lê (celular); `squadone` só escreve (servidor). Token vazado não lê as notificações.

- [ ] **Passo 4 (usuário): env no app `squadone-app` e implantar**

No app `squadone-app`, nova env:

```
LEMBRETES_NTFY_URL=https://:tk_...@<domínio do ntfy>/squadone-lembretes
```

(Se o Easypanel expuser hostname interno entre serviços do mesmo projeto — confira no painel do serviço `ntfy` —, `http://<hostname-interno>/squadone-lembretes` com o mesmo token evita sair para a internet.) Clicar **Implantar**. O log deve mostrar `Lembretes push: https://<domínio>/squadone-lembretes (com token), 10 min antes`.

- [ ] **Passo 5 (usuário): celular Samsung**

1. Play Store → **ntfy** (Philipp C. Heckel) → instalar.
2. Configurações do app → usuários → adicionar servidor `https://<domínio>` com usuário `romulo` e a senha dele.
3. **+** → tópico `squadone-lembretes`, "usar outro servidor" → `https://<domínio>`.
4. Samsung: Configurações → Bateria → Limites de uso em segundo plano → pôr o ntfy em **"Apps nunca suspensos"**; e em Apps → ntfy → Bateria → **Irrestrito**. Sem isso a One UI mata a conexão persistente que o app mantém com servidor próprio e os avisos chegam atrasados ou não chegam.

- [ ] **Passo 6: verificação em produção (sem esperar horário)**

Do IP permitido pelo porteiro:

```bash
curl -s -X POST https://aladdin-squadone-app.jicnzg.easypanel.host/api/push/teste
```

Esperado: `{"enviado":true}` e notificação no celular em segundos. Depois, com uma quest real da Mochila, `POST /api/push/varrer` com `agora` = 10 min antes do início e `"enviar":true` → notificação com o título do evento. Por fim, criar pela CommandBar um foco "daqui a 12 minutos" (ou horário fixo 12 min à frente) e esperar o aviso real ~2 min depois.

- [ ] **Passo 7: memória do projeto**

Registrar em memória (`squadone-...`) que os lembretes push existem, a env nova e que dependem do serviço `ntfy` no Easypanel — é infra fora do repositório.
