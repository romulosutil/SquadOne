# Bot do Telegram como canal de entrada — Plano de Implementação

> **Para o agente que vai executar:** este documento É o seu prompt. Leia `CLAUDE.md` inteiro antes do primeiro comando (em especial "O roster é o prompt", "Redirecionamento automático de squad", "Lembretes push (ntfy)", "Porteiro de IP" e "Convenções"). SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans`, tarefa por tarefa. Passos usam checkbox (`- [ ]`). TDD: teste falhando antes do código. Um commit por tarefa. Ao terminar tudo: `git push` + `graphify update .`.

**Goal:** mensagem de texto enviada ao bot do SquadOne no Telegram roda o mesmo turno de `POST /api/orquestrar` e o bot responde no chat o que foi marcado (o equivalente ao toast de `handleDelegation`), com erros legíveis.

**Architecture:** o corpo de `/api/orquestrar` sai para `server/turno.ts` (`rodarDemanda`), chamado pela rota HTTP e pelo bot — nada de o servidor fazer HTTP para si mesmo. Uma rota `POST /api/telegram/webhook` é montada **antes** do porteiro de IP e tem porteiro próprio: header secreto do Telegram + allowlist de `chat_id`. O webhook responde 200 na hora e processa numa fila serial em memória; a resposta vai por `sendMessage`. Mesma divisão de `push.ts` / `lembretes.ts` / `vigia.ts`: transporte, regras puras de entrada, regras puras de resposta, e a cola.

**Tech Stack:** Node 22 (`fetch` nativo), Express 4, TypeScript via `tsx`, testes `node:test`. **Sem dependência nova** (nada de telegraf/grammy): a Bot API é 3 métodos HTTP, igual ao ntfy em `push.ts`.

**Spec:** este documento (decisões abaixo). Contexto: `CLAUDE.md`.

## Global Constraints

- Comentários e identificadores em **português**; comentário explica *por quê*.
- Módulos marcados PURO não importam `fetch`, `process.env`, relógio nem Express.
- Testes: `node:test` + `node:assert/strict`, `fetch` sempre dublê, nada grava em `data/`. Rodar com `npm test` (o glob `server/*.test.ts` já pega os arquivos novos).
- Verificação de cada tarefa: `npm test` + `npx vue-tsc --noEmit`. Na última: `npm run build` também.
- **O token do bot nunca aparece em log, mensagem de erro ou resposta HTTP.** Ele vai na URL da Bot API (`/bot<TOKEN>/metodo`): nunca logar a URL nem o `err.message` cru do `fetch`.
- Erros classificados, não só mensagem (`TelegramMalConfigurado`, `ErroDeTelegram`), no padrão de `PushMalConfigurado`/`ErroDePush`.
- Falha do Telegram não derruba nada: config ilegível = log no boot e bot desligado; `sendMessage` que falha = `console.error`, o turno já rodou.
- Sem arquivo novo em `data/`. Persistência continua só `squad.json` + `google-auth.json`.
- Rota `/api/orquestrar` não muda de contrato (mesmos status, mesmas flags).

---

## Decisões (o que foi decidido e por quê)

### D1. Validação do webhook: header `X-Telegram-Bot-Api-Secret-Token`

`setWebhook` aceita `secret_token` (1–256 chars, `A-Za-z0-9_-`); o Telegram manda esse valor em **todo** POST no header `X-Telegram-Bot-Api-Secret-Token`. Escolhido o header, não segredo no path:

- path com segredo vaza em log de acesso do Traefik e em qualquer `console.warn` de `req.path` (o porteiro de IP já loga `req.path`);
- o header é o mecanismo oficial e dispensa rota dinâmica.

Formato exigido: `TELEGRAM_WEBHOOK_SECRET` com `^[A-Za-z0-9_-]{32,256}$` (≥ 32 por entropia, mesmo o Telegram aceitando 1). Comparação em tempo constante: SHA-256 dos dois lados + `crypto.timingSafeEqual` (o hash iguala o tamanho; `timingSafeEqual` lança com buffers de tamanhos diferentes).

Ordem na rota: **segredo antes do parse do corpo** (`portao` → `express.json({ limit: "256kb" })` → `processar`). Quem não tem o segredo leva 401 sem corpo e sem o JSON ser lido.

### D2. Convivência com o porteiro de IP

O Telegram não tem IP fixo garantido (publica faixas, que podem mudar). Então a rota do webhook é montada em `server.ts` **antes** de `app.use(porteiroDeIp())`, e só ela: `app.post("/api/telegram/webhook", ...)`. Qualquer outro método ou caminho continua atrás do porteiro. Com o bot desligado a rota **não é montada** e o caminho cai no porteiro (403) como hoje.

O porteiro próprio da rota é D1 (segredo) + D4 (allowlist de chat).

### D3. Env vars (padrão ausente = desligado, igual `LEMBRETES_NTFY_URL`)

| Var | Regra |
|---|---|
| `TELEGRAM_BOT_TOKEN` | ausente/vazia = bot desligado (as outras duas são ignoradas). Presente: `^\d+:[A-Za-z0-9_-]{30,}$`, senão `TelegramMalConfigurado` |
| `TELEGRAM_WEBHOOK_SECRET` | obrigatória com token presente; `^[A-Za-z0-9_-]{32,256}$` |
| `TELEGRAM_CHAT_IDS` | obrigatória com token presente; inteiros positivos separados por vírgula |

Token presente e qualquer uma inválida/ausente = `TelegramMalConfigurado`: log de erro no boot, bot desligado, resto do app igual. Mensagens de erro **nunca** repetem o valor lido.

### D4. Allowlist de `chat_id` — fecha quando vazia (difere de `IPS_PERMITIDOS` de propósito)

`IPS_PERMITIDOS` vazia desliga o porteiro porque em dev não há proxy. Aqui vazia **não pode** abrir: o username do bot é público e buscável, e um bot aberto deixa qualquer pessoa criar eventos no seu Google Calendar e gastar Gemini. Então `TELEGRAM_CHAT_IDS` vazia com token presente = config inválida.

- Só `chat.type === "private"` (chat_id positivo = id do usuário). Grupo é ignorado mesmo que alguém ponha o id na lista.
- Chat fora da lista: **200 sem resposta nenhuma** (nem "não autorizado" — quem não passa não precisa saber que o bot está vivo) e `console.warn("[telegram] chat <id> não autorizado")`. É assim que o dono descobre o próprio `chat_id`: manda `/start`, lê o log do Easypanel.
- 200 e não 403: status ≠ 2xx faz o Telegram reentregar o mesmo update com backoff e segurar os seguintes.

### D5. Squad ativa sem aba: primeira squad ativa, sem estado novo

`rodarDemanda` recebe `squadId` **ausente** e `resolverSquad(roster, undefined)` já devolve `squadsAtivas(roster)[0]` (ordem do roster = ordem de criação; hoje `pessoal`). O redirecionamento automático (`sugerir_troca_squad` → `executarTurno` troca e reprocessa) resolve demanda de outra squad, que é o comportamento pedido: "o usuário começa a mensagem dizendo do que se trata".

Alternativas descartadas:

- **Arquivo `data/telegram.json` com a squad ativa:** quebra o escopo de persistência V1 (só dois blobs) para guardar algo que o redirecionamento já resolve.
- **"Última squad usada" em memória:** estado escondido muda o prompt inteiro (invariante 2) sem o usuário ver, e some no redeploy — mesma mensagem, resultado diferente conforme o histórico.
- **Env `TELEGRAM_SQUAD_PADRAO`:** duplica verdade do roster; squad arquivada/renomeada deixaria a env apontando para o nada.

Custo aceito: demanda de squad que não é a primeira custa **2 chamadas ao Gemini** (um salto). Empate (destino também sugere troca) volta como proposta e vira texto pedindo para reenviar mais explícito (ver D7). **Adiado:** prefixo explícito de squad (`/s pay4fun ...`).

### D6. Webhook responde 200 imediatamente; turno em fila serial

- Um turno leva até ~3 min (teto do Gemini, CLAUDE.md "Teto de tempo do Gemini") + chamadas do Tasks. Se o webhook segurasse a resposta, o Telegram desistiria e **reentregaria o update** → o mesmo compromisso criado duas vezes. Então: validou → `res.sendStatus(200)` → processa depois.
- **Deduplicação por `update_id`** em memória (últimos 500): reentrega por ACK perdido não roda o turno de novo. Redeploy zera; custo aceito (mesmo raciocínio da deduplicação da vigia).
- **Fila serial** (cadeia de promessas): duas mensagens seguidas rodariam dois turnos em paralelo, cada um lendo a agenda antes do outro reservar — os dois pegariam o mesmo slot. A CommandBar evita isso com `isLoading`; o bot precisa da fila. Turno da UI e do bot ao mesmo tempo continua possível — custo aceito, documentar.
- Enquanto roda: `sendChatAction typing` a cada 4 s (a ação dura 5 s no Telegram). Mensagem que chega com fila ocupada recebe "⏳ Na fila (N antes desta)."
- Crash do processo depois do 200 e antes da resposta perde a resposta (o turno pode ou não ter gravado). Custo aceito, documentar.

### D7. Erro/resultado → texto do chat, sem componente Vue

Novo módulo PURO `server/telegram-resposta.ts` espelhando o que `handleDelegation` (`src/App.vue:676-776`) faz com o `TurnoResult`, mas em texto puro (sem `parse_mode`: título de evento com `_`/`*` quebraria Markdown).

Reuso do resumo: `src/contribuicao.ts` é sem Vue e já testado com `tsx`; ganha `linhasDosEventosCriados(eventos, fmt): string[]` (uma linha por compromisso, mesma dobra de blocos no marco) e `resumoDosEventosCriados` vira `linhas.join(' · ')`. O servidor importa de `../src/contribuicao.ts` com `{ locale: "pt-BR", timeZone: FUSO }` — o container roda em UTC, então o fuso é obrigatório. Os tipos `EventoCriado` de `server/agendamento.ts` e `src/types.ts` são estruturalmente iguais (conferido).

Tabela de textos (motivo classificado → linha):

| Origem | Texto |
|---|---|
| `redirecionado` | `🔀 Squad <para_nome> (a demanda não era de <de_nome>).` |
| `eventos_criados` | `✅ ` + cada item de `linhasDosEventosCriados` |
| aviso `ampliarAcesso` | `📋 Passos não criados: falta autorizar o Google Tasks. Abra o SquadOne e clique em "Autorizar Google Tasks" (não use Desconectar).` — uma vez por turno |
| outro aviso | `⚠️ <titulo>: <aviso>` |
| erro `precisaConectar` (erro ou aviso) | `🔌 Google desconectado: abra o SquadOne e clique em Conectar.` — uma vez por turno, além da linha do erro |
| erro `semHorarioLivre` | `❌ <titulo>: <erro>` (a mensagem de `SemHorarioLivre` já é legível) |
| erro `agendaIndisponivel` | `❌ <titulo>: não consegui ler sua agenda no Google agora. Tente de novo.` |
| erro `configuracao` | `❌ <titulo>: configuração do servidor — <erro>` |
| erro sem motivo | `❌ <capacidade>: <erro>` |
| erro `descartado: true` | omitido (a proposta de troca explica) |
| sugestão `dominio` | `💡 Proposta: abrir a sala "<dominio>" (<papel_po>). Para aprovar, peça de novo pelo app.` |
| sugestão `integrante` | `💡 Proposta: contratar <papel> em <dominio_nome>. Para aprovar, peça de novo pelo app.` |
| sugestão `troca_squad` | `🔀 Parece da squad <destino_nome>: <justificativa>. Reenvie dizendo de qual squad é.` |
| nada acima | `Nada foi agendado.` |

`<titulo>` do erro = `args.titulo` quando string não vazia, senão `capacidade`. Propostas de contratação **não** são aprováveis pelo Telegram (V1): o card só existe na aba, e o turno não é persistido.

Falha lançada pelo turno inteiro (`textoDaFalha`):

| Erro | Texto |
|---|---|
| `ModeloOcupado` | `⏳ Gemini sobrecarregado agora. Reenvie a mensagem em alguns segundos.` |
| `JanelaMalConfigurada` | `⚙️ JANELA_TRABALHO/DIAS_TRABALHO inválida no servidor: <msg>` |
| `RosterIlegivel` | `⚙️ squad.json ilegível no servidor. Veja o log do Easypanel.` |
| qualquer outro | `❌ Erro ao processar a demanda: <msg>` |

Texto final cortado em 4096 caracteres (limite do `sendMessage`): acima disso, 4000 + `\n…(cortado)`.

### D8. Comandos

Parse em `server/telegram-entrada.ts` (PURO), **depois** da checagem de chat:

| Mensagem | Resultado |
|---|---|
| texto sem `/` | demanda, `modo: "auto"` |
| `/foco <texto>` | demanda, `modo: "foco"` |
| `/baixa <texto>` | demanda, `modo: "baixa_prioridade"` |
| `/start`, `/ajuda`, `/help`, `/foco` ou `/baixa` sem texto, comando desconhecido | texto de ajuda, sem Gemini |
| sem `text` (foto, áudio, figurinha) | `Só texto por enquanto.` |
| `edited_message`, `channel_post`, qualquer update sem `message` | ignorado |

Sufixo `@NomeDoBot` do comando é descartado (`/foco@SquadOneBot reunião`).

### D9. Registro do webhook no boot, só em produção

Com o bot ligado **e** `NODE_ENV === "production"` **e** `APP_URL` presente, o boot chama `setWebhook` (idempotente) com `url = APP_URL + /api/telegram/webhook`, `secret_token`, `allowed_updates: ["message"]`. Falha = `console.error`, sem derrubar. Motivo de ser no boot: trocar `TELEGRAM_WEBHOOK_SECRET` e clicar **Implantar** já reconfigura o Telegram; um passo manual esquecido deixaria o bot recebendo 401 calado.

Em dev **nunca** registra: `APP_URL` de dev é `http://localhost` (o Telegram exige HTTPS) e registrar com o token de produção roubaria o webhook do servidor real. Teste local é com `curl` simulando o update (Tarefa 7).

### D10. Privacidade (registrar no CLAUDE.md)

O ntfy é próprio porque "o título do compromisso é dado pessoal". Chat de bot do Telegram **não é E2E**: demanda e resposta (títulos, horários) passam pelos servidores do Telegram. Decisão do usuário, registrada como custo conhecido.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `server/turno.ts` | criar | `rodarDemanda`: roster → squad → janela → token → escopos → `executarTurno`. Extraído da rota |
| `server.ts` | modificar | rota usa `rodarDemanda`; monta webhook antes do porteiro; log/registro no boot |
| `src/contribuicao.ts` | modificar | `linhasDosEventosCriados`; `resumoDosEventosCriados` vira join |
| `src/ajuste-do-usuario.test.ts` | modificar | casos de `linhasDosEventosCriados` |
| `server/telegram.ts` | criar | config (env), transporte Bot API, `segredoConfere` |
| `server/telegram.test.ts` | criar | tabela da config, segredo, transporte com `fetch` dublê |
| `server/telegram-entrada.ts` | criar | PURO: update → `Entrada`; memória de `update_id`; texto de ajuda |
| `server/telegram-entrada.test.ts` | criar | tabela de updates |
| `server/telegram-resposta.ts` | criar | PURO: `TurnoResult`/erro → texto; corte em 4096 |
| `server/telegram-resposta.test.ts` | criar | tabela de textos |
| `server/telegram-bot.ts` | criar | cola: `portao` + `processar` + fila serial + digitando |
| `server/telegram-bot.test.ts` | criar | handler com req/res/deps dublês |
| `.env.example` | modificar | três vars novas |
| `CLAUDE.md` | modificar | seção "Bot do Telegram", arquitetura, env, lista de testes, erros |

---

### Tarefa 1: Extrair `rodarDemanda` para `server/turno.ts` (refactor sem mudança de comportamento)

**Files:**
- Create: `server/turno.ts`
- Modify: `server.ts:331-389`

**Interfaces:**
- Produces:
  ```ts
  export interface PedidoDeDemanda { demanda: string; modo: Modo; squadId?: unknown }
  export async function rodarDemanda(ai: GoogleGenAI, pedido: PedidoDeDemanda): Promise<TurnoResult>
  ```
  Lança exatamente o que o trecho atual lança (`SquadInexistente`, `SquadArquivada`, `PedidoInvalido`, `JanelaMalConfigurada`, `ModeloOcupado`, `RosterIlegivel`...). Não valida `demanda`/`modo`: isso segue na rota (400) e no parser do bot.

- [ ] **Step 1: Criar `server/turno.ts`**

```ts
import type { GoogleGenAI } from "@google/genai";
import { readRoster, resolverSquad } from "./squad.ts";
import { executarTurno, type TurnoResult } from "./orchestrator.ts";
import { lerJanela } from "./alocador.ts";
import { escoposConcedidos, tokenValido } from "./auth-store.ts";
import type { Modo } from "./capabilities.ts";

/**
 * Um turno a partir de uma demanda já validada. Mora fora da rota porque há
 * duas portas de entrada — a CommandBar (`POST /api/orquestrar`) e o bot do
 * Telegram — e as duas precisam da MESMA ordem: squad e janela antes do token e
 * do Gemini, para config quebrada ou squadId velho não custarem chamada ao modelo.
 */
export interface PedidoDeDemanda {
  demanda: string;
  modo: Modo;
  /** Ausente = primeira squad ativa (`resolverSquad`). O bot não tem aba. */
  squadId?: unknown;
}

export async function rodarDemanda(ai: GoogleGenAI, pedido: PedidoDeDemanda): Promise<TurnoResult> {
  const roster = await readRoster();
  const squad = resolverSquad(roster, pedido.squadId);
  const janela = lerJanela(process.env);

  // Sem credencial o turno ainda roda: nem toda demanda toca o calendário. O
  // MOTIVO vai junto para agendar_evento devolver o erro classificado certo.
  let token: string | null = null;
  let falhaDoToken: unknown = null;
  try {
    token = await tokenValido();
  } catch (err) {
    falhaDoToken = err;
  }
  // O scope gravado é lido UMA vez por turno, antes do Gemini.
  const { tasks: tasksLiberado } = await escoposConcedidos();
  return executarTurno(ai, {
    demanda: pedido.demanda,
    token,
    falhaDoToken,
    modo: pedido.modo,
    roster,
    squad,
    janela,
    tasksLiberado,
    obterToken: tokenValido,
  });
}
```

Confira se `TurnoResult` é exportado por `orchestrator.ts` (é, linha 95).

- [ ] **Step 2: Rota usa `rodarDemanda`**

Em `server.ts`, dentro de `app.post("/api/orquestrar")`, substitua do `const roster = await readRoster();` até `res.json(turno);` por:

```ts
      res.json(await rodarDemanda(ai, { demanda: demanda.trim(), modo, squadId }));
```

Mantenha a validação de `demanda`/`modo` e o `catch` inteiro como estão. Adicione `import { rodarDemanda } from "./server/turno.ts";` e remova de `server.ts` imports que ficarem sem uso (`executarTurno` — `ModeloOcupado` continua usado; `escoposConcedidos` continua usado em `/api/auth/status`; `resolverSquad` continua usado em `/api/mochila`). Deixe o `vue-tsc` apontar.

- [ ] **Step 3: Verificar**

Run: `npm test` → PASS (nada mudou). Run: `npx vue-tsc --noEmit` → sem erro.
Run manual: `npm run dev` e, em outro terminal:

```bash
curl -s -X POST http://localhost:3000/api/orquestrar -H "Content-Type: application/json" -d "{\"demanda\":\"\"}"
```
Expected: `400` com `Campo 'demanda' é obrigatório`.

```bash
curl -s -X POST http://localhost:3000/api/orquestrar -H "Content-Type: application/json" -d "{\"demanda\":\"teste\",\"squadId\":\"nao-existe\"}"
```
Expected: `409` com `squadInexistente: true`.

- [ ] **Step 4: Commit**

```bash
git add server/turno.ts server.ts
git commit -m "refactor(turno): rodarDemanda fora da rota, para o bot do Telegram reusar"
```

---

### Tarefa 2: `linhasDosEventosCriados` em `src/contribuicao.ts`

**Files:**
- Modify: `src/contribuicao.ts:81-102`
- Test: `src/ajuste-do-usuario.test.ts`

**Interfaces:**
- Produces: `export function linhasDosEventosCriados(eventos: EventoCriado[], fmt?: FormatoDeData): string[]`
- `resumoDosEventosCriados(eventos, fmt)` passa a ser `linhasDosEventosCriados(eventos, fmt).join(' · ')`; saída idêntica à atual.

- [ ] **Step 1: Teste falhando** — acrescente ao `describe` do toast em `src/ajuste-do-usuario.test.ts` (importe `linhasDosEventosCriados` junto dos outros; `evento` e `FMT` já existem no arquivo — reaproveite o `marco`/`blocos` do caso existente da linha ~112 se estiverem no escopo, senão crie como abaixo):

```ts
  it("linhasDosEventosCriados: uma linha por compromisso, blocos dobrados no marco", () => {
    const marco = evento({
      titulo: "Relatório", papel: "marco", tipo: "deadline", eventId: "m1",
      inicio: "2026-09-18T17:45:00-03:00", fim: "2026-09-18T18:00:00-03:00",
    });
    const bloco = evento({ titulo: "Relatório", papel: "bloco", prazo_ref: "m1", eventId: "b1" });
    const foco = evento({ titulo: "Ligar pro banco", eventId: "f1", passos: 2 });
    const linhas = linhasDosEventosCriados([marco, bloco, foco], FMT);
    assert.equal(linhas.length, 2);
    assert.match(linhas[0], /^Relatório: prazo .*\(1 bloco\(s\), 45 min\)$/);
    assert.match(linhas[1], /^Ligar pro banco: 45 min, .* · 2 passo\(s\) no Google Tasks$/);
    assert.equal(resumoDosEventosCriados([marco, bloco, foco], FMT), linhas.join(" · "));
  });

  it("linhasDosEventosCriados: lista vazia", () => {
    assert.deepEqual(linhasDosEventosCriados([], FMT), []);
  });
```

- [ ] **Step 2:** Run `npm test` → FAIL (`linhasDosEventosCriados` não exportado).

- [ ] **Step 3: Implementar** — em `src/contribuicao.ts`, renomeie o corpo atual:

```ts
/**
 * Uma linha por compromisso do turno. Os blocos de um prazo entram DOBRADOS no
 * marco: um prazo pode render até 20 blocos, e listá-los um a um viraria um
 * muro de texto. Bloco cujo marco não veio neste turno (o marco já existia)
 * continua aparecendo sozinho. Lista e não string porque o bot do Telegram
 * mostra uma por linha e o toast junta numa só.
 */
export function linhasDosEventosCriados(eventos: EventoCriado[], fmt: FormatoDeData = {}): string[] {
  const marcos = new Set(eventos.filter((e) => e.papel === 'marco').map((e) => e.eventId))
  return eventos
    .filter((e) => !(e.papel === 'bloco' && e.prazo_ref && marcos.has(e.prazo_ref)))
    .map((e) => {
      const blocos = e.papel === 'marco' ? eventos.filter((b) => b.prazo_ref === e.eventId) : []
      const total = blocos.reduce((t, b) => t + duracaoMin(b), 0)
      const base = blocos.length
        ? `${resumoDoEvento(e, fmt)} (${blocos.length} bloco(s), ${formatarMinutos(total)})`
        : resumoDoEvento(e, fmt)
      // A checklist mora fora do app (Google Tasks): esta linha é o único lugar
      // em que o usuário fica sabendo que ela nasceu.
      return e.passos ? `${base} · ${e.passos} passo(s) no Google Tasks` : base
    })
}

/** Um toast para o turno inteiro (4 segundos na tela): as linhas numa só. */
export function resumoDosEventosCriados(eventos: EventoCriado[], fmt: FormatoDeData = {}): string {
  return linhasDosEventosCriados(eventos, fmt).join(' · ')
}
```

- [ ] **Step 4:** Run `npm test` → PASS (novos e os antigos de `resumoDosEventosCriados`). Run `npx vue-tsc --noEmit` → ok.

- [ ] **Step 5: Commit**

```bash
git add src/contribuicao.ts src/ajuste-do-usuario.test.ts
git commit -m "refactor(contribuicao): linhasDosEventosCriados, uma linha por compromisso"
```

---

### Tarefa 3: `server/telegram.ts` — config, segredo e transporte

**Files:**
- Create: `server/telegram.ts`
- Test: `server/telegram.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ConfigDeTelegram { token: string; segredo: string; chatsPermitidos: ReadonlySet<number> }
  export class TelegramMalConfigurado extends Error {}
  export class ErroDeTelegram extends Error { readonly status: number | null }
  export const TIMEOUT_TELEGRAM_MS = 10_000
  export const ROTA_WEBHOOK_TELEGRAM = "/api/telegram/webhook"
  export function lerConfigDeTelegram(env: Record<string, string | undefined>): ConfigDeTelegram | null
  export function descreverTelegram(c: ConfigDeTelegram): string
  export function segredoConfere(esperado: string, recebido: unknown): boolean
  export async function enviarMensagem(c: ConfigDeTelegram, chatId: number, texto: string, responderA?: number): Promise<void>
  export async function avisarDigitando(c: ConfigDeTelegram, chatId: number): Promise<void>
  export async function registrarWebhook(c: ConfigDeTelegram, url: string): Promise<void>
  ```

- [ ] **Step 1: Testes falhando** — `server/telegram.test.ts`:

```ts
/**
 * Config do bot (env), segredo do webhook e transporte da Bot API. `fetch` é
 * dublê: nada sai para o Telegram. O token nunca pode aparecer em mensagem de erro.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  avisarDigitando,
  descreverTelegram,
  enviarMensagem,
  ErroDeTelegram,
  lerConfigDeTelegram,
  registrarWebhook,
  segredoConfere,
  TelegramMalConfigurado,
  type ConfigDeTelegram,
} from "./telegram.ts";

const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
const SEGREDO = "s".repeat(40);
const env = (x: Record<string, string>) => ({
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_WEBHOOK_SECRET: SEGREDO,
  TELEGRAM_CHAT_IDS: "111",
  ...x,
});

describe("lerConfigDeTelegram", () => {
  it("token ausente ou vazio = desligado, mesmo com as outras vars", () => {
    assert.equal(lerConfigDeTelegram({}), null);
    assert.equal(lerConfigDeTelegram(env({ TELEGRAM_BOT_TOKEN: "  " })), null);
  });

  it("lê token, segredo e allowlist", () => {
    const c = lerConfigDeTelegram(env({ TELEGRAM_CHAT_IDS: " 111, 222 " }))!;
    assert.equal(c.token, TOKEN);
    assert.equal(c.segredo, SEGREDO);
    assert.deepEqual([...c.chatsPermitidos], [111, 222]);
  });

  const invalidos: [string, Record<string, string>][] = [
    ["token sem formato", { TELEGRAM_BOT_TOKEN: "abc" }],
    ["segredo ausente", { TELEGRAM_WEBHOOK_SECRET: "" }],
    ["segredo curto", { TELEGRAM_WEBHOOK_SECRET: "curto" }],
    ["segredo com caractere proibido", { TELEGRAM_WEBHOOK_SECRET: "a".repeat(40) + "!" }],
    ["allowlist vazia NÃO abre o bot", { TELEGRAM_CHAT_IDS: "" }],
    ["chat id não numérico", { TELEGRAM_CHAT_IDS: "111,abc" }],
    ["chat id de grupo (negativo)", { TELEGRAM_CHAT_IDS: "-100123" }],
  ];
  for (const [nome, x] of invalidos) {
    it(`recusa: ${nome}`, () => {
      assert.throws(
        () => lerConfigDeTelegram(env(x)),
        (e: unknown) => e instanceof TelegramMalConfigurado && !(e as Error).message.includes(TOKEN) && !(e as Error).message.includes(SEGREDO),
      );
    });
  }

  it("descrição do boot nunca mostra token nem segredo", () => {
    const d = descreverTelegram(lerConfigDeTelegram(env({ TELEGRAM_CHAT_IDS: "1,2" }))!);
    assert.equal(d.includes(TOKEN) || d.includes(SEGREDO), false);
    assert.match(d, /2 chat/);
  });
});

describe("segredoConfere", () => {
  it("igual confere; diferente, outro tamanho ou não-string não", () => {
    assert.equal(segredoConfere(SEGREDO, SEGREDO), true);
    assert.equal(segredoConfere(SEGREDO, "x".repeat(40)), false);
    assert.equal(segredoConfere(SEGREDO, "s"), false);
    assert.equal(segredoConfere(SEGREDO, undefined), false);
    assert.equal(segredoConfere(SEGREDO, ["a"]), false);
  });
});

describe("transporte", () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; });
  const c: ConfigDeTelegram = { token: TOKEN, segredo: SEGREDO, chatsPermitidos: new Set([111]) };

  function duble(resposta: { status: number; corpo: unknown }) {
    const chamadas: { url: string; corpo: any }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      chamadas.push({ url: String(url), corpo: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(resposta.corpo), { status: resposta.status });
    }) as unknown as typeof fetch;
    return chamadas;
  }

  it("sendMessage em texto puro, respondendo à mensagem original", async () => {
    const chamadas = duble({ status: 200, corpo: { ok: true, result: {} } });
    await enviarMensagem(c, 111, "oi", 42);
    assert.equal(chamadas[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
    assert.equal(chamadas[0].corpo.chat_id, 111);
    assert.equal(chamadas[0].corpo.text, "oi");
    assert.equal(chamadas[0].corpo.parse_mode, undefined);
    assert.deepEqual(chamadas[0].corpo.reply_parameters, { message_id: 42, allow_sending_without_reply: true });
  });

  it("sendChatAction typing", async () => {
    const chamadas = duble({ status: 200, corpo: { ok: true, result: true } });
    await avisarDigitando(c, 111);
    assert.match(chamadas[0].url, /\/sendChatAction$/);
    assert.deepEqual(chamadas[0].corpo, { chat_id: 111, action: "typing" });
  });

  it("setWebhook com segredo e só updates de mensagem", async () => {
    const chamadas = duble({ status: 200, corpo: { ok: true, result: true } });
    await registrarWebhook(c, "https://app.exemplo/api/telegram/webhook");
    assert.match(chamadas[0].url, /\/setWebhook$/);
    assert.equal(chamadas[0].corpo.secret_token, SEGREDO);
    assert.deepEqual(chamadas[0].corpo.allowed_updates, ["message"]);
  });

  it("resposta de erro vira ErroDeTelegram com status, sem o token", async () => {
    duble({ status: 403, corpo: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } });
    await assert.rejects(enviarMensagem(c, 111, "oi"), (e: unknown) =>
      e instanceof ErroDeTelegram && e.status === 403 && /blocked/.test(e.message) && !e.message.includes(TOKEN));
  });

  it("rede fora vira ErroDeTelegram status null, sem o token", async () => {
    globalThis.fetch = (async () => { throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/x`); }) as unknown as typeof fetch;
    await assert.rejects(enviarMensagem(c, 111, "oi"), (e: unknown) =>
      e instanceof ErroDeTelegram && e.status === null && !e.message.includes(TOKEN));
  });
});
```

- [ ] **Step 2:** Run `npm test` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** — `server/telegram.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Transporte do bot do Telegram: lê a config do ambiente e fala com a Bot API.
 * Só sabe mandar; quem decide o que uma mensagem significa é
 * `telegram-entrada.ts`, o que responder é `telegram-resposta.ts`, e quem cola
 * os dois ao turno é `telegram-bot.ts` (mesma divisão de push/lembretes/vigia).
 *
 * O token vai na URL da Bot API. Por isso nenhuma mensagem de erro deste módulo
 * repete a URL nem o `err.message` cru do fetch.
 */

export const ROTA_WEBHOOK_TELEGRAM = "/api/telegram/webhook";

/** Turno de 3 min já é da fila; uma chamada à Bot API que passa disto não vai voltar. */
export const TIMEOUT_TELEGRAM_MS = 10_000;

export interface ConfigDeTelegram {
  token: string;
  /** Valor do header `X-Telegram-Bot-Api-Secret-Token`; o mesmo passado ao setWebhook. */
  segredo: string;
  chatsPermitidos: ReadonlySet<number>;
}

/** Env presente e ilegível. Ambiente: nenhuma mensagem no chat conserta. */
export class TelegramMalConfigurado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "TelegramMalConfigurado";
  }
}

export class ErroDeTelegram extends Error {
  /** Status HTTP da Bot API; null quando nem houve resposta (rede, timeout). */
  readonly status: number | null;
  constructor(mensagem: string, status: number | null) {
    super(mensagem);
    this.name = "ErroDeTelegram";
    this.status = status;
  }
}

const FORMATO_TOKEN = /^\d+:[A-Za-z0-9_-]{30,}$/;
/** O Telegram aceita 1–256; exigimos 32 porque é a única trava além do chat_id. */
const FORMATO_SEGREDO = /^[A-Za-z0-9_-]{32,256}$/;
/** Só chat privado: id positivo. Grupo (negativo) nunca entra, nem por engano na env. */
const FORMATO_CHAT = /^\d+$/;

/**
 * Token ausente/vazio = bot desligado. Token presente exige segredo e allowlist
 * válidos — e allowlist VAZIA É ERRO, ao contrário de IPS_PERMITIDOS: o username
 * do bot é público, e um bot aberto deixaria qualquer um criar eventos na sua
 * agenda. As mensagens nunca repetem o valor lido.
 */
export function lerConfigDeTelegram(env: Record<string, string | undefined>): ConfigDeTelegram | null {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) return null;
  if (!FORMATO_TOKEN.test(token)) {
    throw new TelegramMalConfigurado("TELEGRAM_BOT_TOKEN fora do formato do BotFather (<número>:<chave>).");
  }
  const segredo = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!FORMATO_SEGREDO.test(segredo)) {
    throw new TelegramMalConfigurado(
      "TELEGRAM_WEBHOOK_SECRET obrigatória com o bot ligado: 32 a 256 caracteres entre letras, dígitos, '_' e '-'.",
    );
  }
  const ids = (env.TELEGRAM_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new TelegramMalConfigurado("TELEGRAM_CHAT_IDS vazia: allowlist vazia não abre o bot. Informe o seu chat_id.");
  }
  if (!ids.every((id) => FORMATO_CHAT.test(id))) {
    throw new TelegramMalConfigurado("TELEGRAM_CHAT_IDS aceita só chat_id de conversa privada: inteiros positivos separados por vírgula.");
  }
  return { token, segredo, chatsPermitidos: new Set(ids.map(Number)) };
}

/** Para o log do boot: nunca token nem segredo. */
export function descreverTelegram(c: ConfigDeTelegram): string {
  return `webhook em ${ROTA_WEBHOOK_TELEGRAM}, ${c.chatsPermitidos.size} chat(s) permitido(s)`;
}

/**
 * Tempo constante. O hash iguala o tamanho: `timingSafeEqual` lança com buffers
 * de tamanhos diferentes, e um `if` de tamanho antes vazaria o tamanho do segredo.
 */
export function segredoConfere(esperado: string, recebido: unknown): boolean {
  if (typeof recebido !== "string") return false;
  const a = createHash("sha256").update(esperado).digest();
  const b = createHash("sha256").update(recebido).digest();
  return timingSafeEqual(a, b);
}

async function chamar(c: ConfigDeTelegram, metodo: string, corpo: Record<string, unknown>): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`https://api.telegram.org/bot${c.token}/${metodo}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_TELEGRAM_MS),
    });
  } catch (err: any) {
    // Só o nome/código: a mensagem do fetch pode trazer a URL, e a URL traz o token.
    const causa = err?.cause?.code ?? err?.name ?? "erro de rede";
    throw new ErroDeTelegram(`Telegram inacessível em ${metodo} (${causa}).`, null);
  }
  if (!resp.ok) {
    const lido: any = await resp.json().catch(() => ({}));
    const descricao = typeof lido?.description === "string" ? lido.description.slice(0, 200) : "";
    throw new ErroDeTelegram(`Telegram respondeu ${resp.status} em ${metodo}: ${descricao}`, resp.status);
  }
}

/**
 * Texto PURO, sem parse_mode: título de compromisso com `_` ou `*` quebraria o
 * Markdown do Telegram e a mensagem inteira seria recusada.
 */
export function enviarMensagem(c: ConfigDeTelegram, chatId: number, texto: string, responderA?: number): Promise<void> {
  return chamar(c, "sendMessage", {
    chat_id: chatId,
    text: texto,
    ...(responderA ? { reply_parameters: { message_id: responderA, allow_sending_without_reply: true } } : {}),
  });
}

/** "digitando..." dura 5 s no Telegram: quem chama repete enquanto o turno roda. */
export function avisarDigitando(c: ConfigDeTelegram, chatId: number): Promise<void> {
  return chamar(c, "sendChatAction", { chat_id: chatId, action: "typing" });
}

/** Idempotente: o boot chama a cada deploy, então trocar o segredo e implantar já basta. */
export function registrarWebhook(c: ConfigDeTelegram, url: string): Promise<void> {
  return chamar(c, "setWebhook", { url, secret_token: c.segredo, allowed_updates: ["message"] });
}
```

- [ ] **Step 4:** Run `npm test` → PASS. Run `npx vue-tsc --noEmit` → ok.

- [ ] **Step 5: Commit**

```bash
git add server/telegram.ts server/telegram.test.ts
git commit -m "feat(telegram): config por env, segredo do webhook e transporte da Bot API"
```

---

### Tarefa 4: `server/telegram-entrada.ts` (PURO) — update → entrada

**Files:**
- Create: `server/telegram-entrada.ts`
- Test: `server/telegram-entrada.test.ts`

**Interfaces:**
- Consumes: `Modo` de `server/capabilities.ts`.
- Produces:
  ```ts
  export type Entrada =
    | { tipo: "demanda"; updateId: number; chatId: number; mensagemId: number; demanda: string; modo: Modo }
    | { tipo: "ajuda"; updateId: number; chatId: number; mensagemId: number }
    | { tipo: "semTexto"; updateId: number; chatId: number; mensagemId: number }
    | { tipo: "naoAutorizado"; updateId: number; chatId: number }
    | { tipo: "ignorar"; updateId: number | null };
  export const TEXTO_DE_AJUDA: string
  export const TEXTO_SEM_TEXTO: string
  export function interpretarUpdate(update: unknown, chatsPermitidos: ReadonlySet<number>): Entrada
  export function criarMemoriaDeUpdates(capacidade?: number): { jaVisto(updateId: number): boolean }
  ```

- [ ] **Step 1: Testes falhando** — `server/telegram-entrada.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarMemoriaDeUpdates, interpretarUpdate } from "./telegram-entrada.ts";

const PERMITIDOS = new Set([111]);
const msg = (x: Record<string, unknown>, chat: Record<string, unknown> = { id: 111, type: "private" }) => ({
  update_id: 9,
  message: { message_id: 5, chat, date: 0, ...x },
});

describe("interpretarUpdate", () => {
  it("texto comum = demanda auto, aparado", () => {
    assert.deepEqual(interpretarUpdate(msg({ text: "  reunião com o João amanhã 15h " }), PERMITIDOS), {
      tipo: "demanda", updateId: 9, chatId: 111, mensagemId: 5, demanda: "reunião com o João amanhã 15h", modo: "auto",
    });
  });

  const comandos: [string, string, string | null][] = [
    ["/foco revisar contrato", "foco", "revisar contrato"],
    ["/baixa trocar lâmpada", "baixa_prioridade", "trocar lâmpada"],
    ["/foco@SquadOneBot revisar contrato", "foco", "revisar contrato"],
    ["/foco\nlinha 1\nlinha 2", "foco", "linha 1\nlinha 2"],
  ];
  for (const [texto, modo, demanda] of comandos) {
    it(`comando de modo: ${JSON.stringify(texto)}`, () => {
      const e = interpretarUpdate(msg({ text: texto }), PERMITIDOS);
      assert.equal(e.tipo, "demanda");
      assert.equal((e as any).modo, modo);
      assert.equal((e as any).demanda, demanda);
    });
  }

  for (const texto of ["/start", "/ajuda", "/help", "/foco", "/baixa   ", "/qualquer coisa"]) {
    it(`ajuda: ${JSON.stringify(texto)}`, () => {
      assert.equal(interpretarUpdate(msg({ text: texto }), PERMITIDOS).tipo, "ajuda");
    });
  }

  it("foto/áudio sem texto = semTexto", () => {
    assert.equal(interpretarUpdate(msg({ photo: [{}] }), PERMITIDOS).tipo, "semTexto");
  });

  it("chat fora da allowlist = naoAutorizado, ANTES de olhar o comando", () => {
    assert.deepEqual(interpretarUpdate(msg({ text: "/start" }, { id: 222, type: "private" }), PERMITIDOS), {
      tipo: "naoAutorizado", updateId: 9, chatId: 222,
    });
  });

  it("grupo é ignorado mesmo com o id na lista", () => {
    const e = interpretarUpdate(msg({ text: "oi" }, { id: 111, type: "group" }), PERMITIDOS);
    assert.equal(e.tipo, "ignorar");
  });

  it("edited_message, channel_post e lixo são ignorados", () => {
    assert.deepEqual(interpretarUpdate({ update_id: 3, edited_message: {} }, PERMITIDOS), { tipo: "ignorar", updateId: 3 });
    assert.deepEqual(interpretarUpdate({ update_id: 4, channel_post: {} }, PERMITIDOS), { tipo: "ignorar", updateId: 4 });
    assert.deepEqual(interpretarUpdate(null, PERMITIDOS), { tipo: "ignorar", updateId: null });
    assert.deepEqual(interpretarUpdate({ message: {} }, PERMITIDOS), { tipo: "ignorar", updateId: null });
  });
});

describe("criarMemoriaDeUpdates", () => {
  it("primeira vez false, repetida true", () => {
    const m = criarMemoriaDeUpdates();
    assert.equal(m.jaVisto(1), false);
    assert.equal(m.jaVisto(1), true);
    assert.equal(m.jaVisto(2), false);
  });

  it("esquece o mais antigo acima da capacidade", () => {
    const m = criarMemoriaDeUpdates(2);
    m.jaVisto(1); m.jaVisto(2); m.jaVisto(3);
    assert.equal(m.jaVisto(1), false);
    assert.equal(m.jaVisto(3), true);
  });
});
```

- [ ] **Step 2:** Run `npm test` → FAIL.

- [ ] **Step 3: Implementar** — `server/telegram-entrada.ts`:

```ts
import type { Modo } from "./capabilities.ts";

/**
 * PURO: o que um update do Telegram significa para o SquadOne. Sem fetch, env,
 * relógio nem Express — dá para fixar em tabela de casos.
 */

export type Entrada =
  | { tipo: "demanda"; updateId: number; chatId: number; mensagemId: number; demanda: string; modo: Modo }
  | { tipo: "ajuda"; updateId: number; chatId: number; mensagemId: number }
  | { tipo: "semTexto"; updateId: number; chatId: number; mensagemId: number }
  | { tipo: "naoAutorizado"; updateId: number; chatId: number }
  | { tipo: "ignorar"; updateId: number | null };

export const TEXTO_DE_AJUDA = [
  "Mande a demanda em texto, começando pelo assunto — a squad certa é escolhida pelo conteúdo.",
  "",
  "/foco <demanda> — primeiro horário livre a partir de agora",
  "/baixa <demanda> — encaixa até o 7º dia útil, depois dos outros",
  "Sem comando = o modelo escolhe o tipo (como o Auto do app).",
].join("\n");

export const TEXTO_SEM_TEXTO = "Só texto por enquanto.";

/** Comandos que mudam o modo; o resto do texto é a demanda. Espelha o toggle da CommandBar. */
const MODOS: Record<string, Modo> = { foco: "foco", baixa: "baixa_prioridade" };

const COMANDO = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

export function interpretarUpdate(update: unknown, chatsPermitidos: ReadonlySet<number>): Entrada {
  const u = update as any;
  const updateId = typeof u?.update_id === "number" ? u.update_id : null;
  const m = u?.message;
  // Só `message`: editar uma mensagem já enviada rodaria o turno de novo e
  // duplicaria o compromisso.
  if (updateId === null || !m || typeof m !== "object") return { tipo: "ignorar", updateId };
  const chatId = m.chat?.id;
  if (typeof chatId !== "number" || m.chat?.type !== "private" || typeof m.message_id !== "number") {
    return { tipo: "ignorar", updateId };
  }
  // Autorização antes de qualquer interpretação: quem não está na lista não
  // recebe nem a ajuda.
  if (!chatsPermitidos.has(chatId)) return { tipo: "naoAutorizado", updateId, chatId };
  const base = { updateId, chatId, mensagemId: m.message_id as number };

  if (typeof m.text !== "string") return { tipo: "semTexto", ...base };
  const texto = m.text.trim();
  if (!texto) return { tipo: "semTexto", ...base };

  const cmd = COMANDO.exec(texto);
  if (!cmd) return { tipo: "demanda", ...base, demanda: texto, modo: "auto" };
  const modo = MODOS[cmd[1].toLowerCase()];
  const resto = (cmd[2] ?? "").trim();
  if (modo && resto) return { tipo: "demanda", ...base, demanda: resto, modo };
  return { tipo: "ajuda", ...base };
}

/**
 * O webhook responde 200 antes do turno; se o ACK se perder, o Telegram
 * reentrega o MESMO update_id e o compromisso nasceria duas vezes. Só memória:
 * redeploy zera, e reentrega atravessando um redeploy é custo aceito.
 */
export function criarMemoriaDeUpdates(capacidade = 500): { jaVisto(updateId: number): boolean } {
  const vistos = new Set<number>();
  const ordem: number[] = [];
  return {
    jaVisto(updateId) {
      if (vistos.has(updateId)) return true;
      vistos.add(updateId);
      ordem.push(updateId);
      if (ordem.length > capacidade) vistos.delete(ordem.shift()!);
      return false;
    },
  };
}
```

- [ ] **Step 4:** Run `npm test` → PASS. `npx vue-tsc --noEmit` → ok.

- [ ] **Step 5: Commit**

```bash
git add server/telegram-entrada.ts server/telegram-entrada.test.ts
git commit -m "feat(telegram): interpreta update em demanda, ajuda ou recusa"
```

---

### Tarefa 5: `server/telegram-resposta.ts` (PURO) — turno/erro → texto

**Files:**
- Create: `server/telegram-resposta.ts`
- Test: `server/telegram-resposta.test.ts`

**Interfaces:**
- Consumes: `TurnoResult`, `ModeloOcupado` de `server/orchestrator.ts`; `JanelaMalConfigurada` de `server/alocador.ts`; `RosterIlegivel` de `server/squad.ts`; `linhasDosEventosCriados`, `FormatoDeData` de `src/contribuicao.ts` (Tarefa 2).
- Produces:
  ```ts
  export const MAX_MENSAGEM_TELEGRAM = 4096
  export function textoDoTurno(turno: TurnoResult, fmt: FormatoDeData): string
  export function textoDaFalha(err: unknown): string
  export function cortarParaTelegram(texto: string): string
  ```

- [ ] **Step 1: Testes falhando** — `server/telegram-resposta.test.ts` (`JanelaMalConfigurada` e `RosterIlegivel` recebem `(mensagem: string)`; conferido em `server/alocador.ts:77` e `server/squad.ts:152`).

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cortarParaTelegram, MAX_MENSAGEM_TELEGRAM, textoDaFalha, textoDoTurno } from "./telegram-resposta.ts";
import { ModeloOcupado, type TurnoResult } from "./orchestrator.ts";
import { JanelaMalConfigurada } from "./alocador.ts";
import { RosterIlegivel } from "./squad.ts";
import type { EventoCriado } from "./capabilities.ts";

const FMT = { locale: "pt-BR", timeZone: "America/Sao_Paulo" };
const vazio = (x: Partial<TurnoResult> = {}): TurnoResult => ({ eventos_criados: [], sugestoes: [], avisos: [], erros: [], ...x });
const evento = (x: Partial<EventoCriado> = {}): EventoCriado => ({
  kind: "evento", titulo: "Ligar pro banco", responsavel_id: "ana", tipo: "time_blocking", dominio: "pessoal--financas",
  inicio: "2026-09-15T14:00:00-03:00", fim: "2026-09-15T14:30:00-03:00", dia_inteiro: false, papel: "foco", eventId: "e1", ...x,
});

describe("textoDoTurno", () => {
  it("turno sem nada", () => {
    assert.equal(textoDoTurno(vazio(), FMT), "Nada foi agendado.");
  });

  it("um evento por linha com ✅", () => {
    const t = textoDoTurno(vazio({ eventos_criados: [evento(), evento({ titulo: "Academia", eventId: "e2" })] }), FMT);
    const linhas = t.split("\n");
    assert.equal(linhas.length, 2);
    assert.match(linhas[0], /^✅ Ligar pro banco: 30 min, /);
    assert.match(linhas[1], /^✅ Academia: /);
  });

  it("redirecionado vem primeiro", () => {
    const t = textoDoTurno(vazio({
      eventos_criados: [evento()],
      redirecionado: { de_id: "pessoal", de_nome: "Pessoal", para_id: "p4f", para_nome: "Pay4Fun", justificativa: "trabalho" },
    }), FMT);
    assert.match(t.split("\n")[0], /^🔀 Squad Pay4Fun \(a demanda não era de Pessoal\)\.$/);
  });

  it("precisaConectar: linha do erro + um pedido de conectar só", () => {
    const erro = { capacidade: "agendar_evento", args: { titulo: "A" }, erro: "sem credencial", motivo: "precisaConectar" as const };
    const t = textoDoTurno(vazio({ erros: [erro, { ...erro, args: { titulo: "B" } }] }), FMT);
    assert.equal(t.match(/Conectar/g)?.length, 1);
    assert.match(t, /❌ A: /);
    assert.match(t, /❌ B: /);
  });

  it("semHorarioLivre usa a mensagem do servidor; agendaIndisponivel e configuracao têm texto próprio", () => {
    const t = textoDoTurno(vazio({ erros: [
      { capacidade: "agendar_evento", args: { titulo: "A" }, erro: "Nenhum horário livre de 2h até 28/09.", motivo: "semHorarioLivre" },
      { capacidade: "agendar_evento", args: { titulo: "B" }, erro: "timeout", motivo: "agendaIndisponivel" },
      { capacidade: "agendar_evento", args: {}, erro: "JANELA_TRABALHO inválida", motivo: "configuracao" },
    ] }), FMT);
    assert.match(t, /❌ A: Nenhum horário livre de 2h até 28\/09\./);
    assert.match(t, /❌ B: não consegui ler sua agenda no Google agora/);
    assert.match(t, /❌ agendar_evento: configuração do servidor — JANELA_TRABALHO inválida/);
  });

  it("descartados somem; troca de squad vira pedido de reenviar", () => {
    const t = textoDoTurno(vazio({
      erros: [{ capacidade: "agendar_evento", args: {}, erro: "descartado: ...", descartado: true }],
      sugestoes: [{ id: "s1", kind: "troca_squad", squad_id: "pessoal", destino_id: "p4f", destino_nome: "Pay4Fun", justificativa: "é do trabalho", demanda: "x" }],
    }), FMT);
    assert.equal(t.includes("descartado"), false);
    assert.match(t, /^🔀 Parece da squad Pay4Fun: é do trabalho\. Reenvie dizendo de qual squad é\.$/);
  });

  it("ampliarAcesso: uma linha, nunca sugere Desconectar como gesto", () => {
    const aviso = { capacidade: "agendar_evento", titulo: "A", aviso: "sem escopo", motivo: "ampliarAcesso" as const };
    const t = textoDoTurno(vazio({ eventos_criados: [evento()], avisos: [aviso, { ...aviso, titulo: "B" }] }), FMT);
    assert.equal(t.match(/Autorizar Google Tasks/g)?.length, 1);
    assert.match(t, /não use Desconectar/);
  });

  it("aviso comum e propostas de contratação", () => {
    const t = textoDoTurno(vazio({
      avisos: [{ capacidade: "agendar_evento", titulo: "Relatório", aviso: "faltaram 60 min antes do prazo" }],
      sugestoes: [
        { id: "s1", kind: "dominio", squad_id: "pessoal", dominio: "Saúde", papel_po: "Coach", justificativa: "", escopo: "", slot: null },
        { id: "s2", kind: "integrante", squad_id: "pessoal", dominio_id: "d", dominio_nome: "Finanças", papel: "Contador", justificativa: "", escopo: "" },
      ],
    }), FMT);
    assert.match(t, /⚠️ Relatório: faltaram 60 min antes do prazo/);
    assert.match(t, /💡 Proposta: abrir a sala "Saúde" \(Coach\)\. Para aprovar, peça de novo pelo app\./);
    assert.match(t, /💡 Proposta: contratar Contador em Finanças\. Para aprovar, peça de novo pelo app\./);
  });
});

describe("textoDaFalha", () => {
  it("classifica", () => {
    assert.match(textoDaFalha(new ModeloOcupado("x")), /Gemini sobrecarregado/);
    assert.match(textoDaFalha(new JanelaMalConfigurada("JANELA_TRABALHO ilegível")), /^⚙️ .*JANELA_TRABALHO ilegível/);
    assert.match(textoDaFalha(new RosterIlegivel("forma desconhecida")), /^⚙️ squad\.json ilegível no servidor/);
    assert.match(textoDaFalha(new Error("boom")), /^❌ Erro ao processar a demanda: boom$/);
    assert.match(textoDaFalha("string solta"), /^❌ Erro ao processar a demanda: string solta$/);
  });
});

describe("cortarParaTelegram", () => {
  it("curto passa igual; longo corta com aviso dentro do limite", () => {
    assert.equal(cortarParaTelegram("oi"), "oi");
    const cortado = cortarParaTelegram("x".repeat(5000));
    assert.ok(cortado.length <= MAX_MENSAGEM_TELEGRAM);
    assert.ok(cortado.endsWith("…(cortado)"));
  });
});
```

- [ ] **Step 2:** Run `npm test` → FAIL.

- [ ] **Step 3: Implementar** — `server/telegram-resposta.ts`:

```ts
import { linhasDosEventosCriados, type FormatoDeData } from "../src/contribuicao.ts";
import { ModeloOcupado, type ErroTarefa, type TurnoResult } from "./orchestrator.ts";
import { JanelaMalConfigurada } from "./alocador.ts";
import { RosterIlegivel } from "./squad.ts";

/**
 * PURO: o `TurnoResult` em texto de chat. É o `handleDelegation` do App.vue sem
 * Vue: toast, alert e cards viram linhas. Texto puro (sem Markdown) — ver
 * `enviarMensagem`. O resumo dos eventos é o MESMO da UI (`src/contribuicao.ts`),
 * com o fuso fixado por quem chama: o container roda em UTC.
 */

export const MAX_MENSAGEM_TELEGRAM = 4096;
const CORTE = "\n…(cortado)";

const CONECTAR = "🔌 Google desconectado: abra o SquadOne e clique em Conectar.";
const AMPLIAR =
  '📋 Passos não criados: falta autorizar o Google Tasks. Abra o SquadOne e clique em "Autorizar Google Tasks" (não use Desconectar).';
/** O card de aprovação só existe na aba, e o turno não é gravado em lugar nenhum. */
const APROVAR_NO_APP = "Para aprovar, peça de novo pelo app.";

function tituloDoErro(e: ErroTarefa): string {
  const t = e.args?.titulo;
  return typeof t === "string" && t.trim() ? t.trim() : e.capacidade;
}

function linhaDoErro(e: ErroTarefa): string {
  switch (e.motivo) {
    case "agendaIndisponivel":
      return `❌ ${tituloDoErro(e)}: não consegui ler sua agenda no Google agora. Tente de novo.`;
    case "configuracao":
      return `❌ ${tituloDoErro(e)}: configuração do servidor — ${e.erro}`;
    case "precisaConectar":
    case "semHorarioLivre":
      return `❌ ${tituloDoErro(e)}: ${e.erro}`;
    default:
      return `❌ ${e.capacidade}: ${e.erro}`;
  }
}

export function textoDoTurno(turno: TurnoResult, fmt: FormatoDeData): string {
  const linhas: string[] = [];
  const r = turno.redirecionado;
  if (r) linhas.push(`🔀 Squad ${r.para_nome} (a demanda não era de ${r.de_nome}).`);

  linhas.push(...linhasDosEventosCriados(turno.eventos_criados ?? [], fmt).map((l) => `✅ ${l}`));

  const avisos = turno.avisos ?? [];
  // Um gesto por turno, não um por compromisso: três passos sem escopo não são três pedidos.
  if (avisos.some((a) => a.motivo === "ampliarAcesso")) linhas.push(AMPLIAR);
  for (const a of avisos) if (a.motivo !== "ampliarAcesso") linhas.push(`⚠️ ${a.titulo}: ${a.aviso}`);

  // Descartados não são falha: o turno sugeriu outra squad, e a proposta abaixo explica.
  const erros = (turno.erros ?? []).filter((e) => !e.descartado);
  linhas.push(...erros.map(linhaDoErro));
  if ([...erros, ...avisos].some((x) => x.motivo === "precisaConectar")) linhas.push(CONECTAR);

  for (const s of turno.sugestoes ?? []) {
    if (s.kind === "dominio") linhas.push(`💡 Proposta: abrir a sala "${s.dominio}" (${s.papel_po}). ${APROVAR_NO_APP}`);
    else if (s.kind === "integrante") linhas.push(`💡 Proposta: contratar ${s.papel} em ${s.dominio_nome}. ${APROVAR_NO_APP}`);
    else linhas.push(`🔀 Parece da squad ${s.destino_nome}: ${s.justificativa}. Reenvie dizendo de qual squad é.`);
  }

  return linhas.length ? linhas.join("\n") : "Nada foi agendado.";
}

/** O turno inteiro falhou antes de devolver resultado (mesmas classes que a rota traduz em status). */
export function textoDaFalha(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof ModeloOcupado) return "⏳ Gemini sobrecarregado agora. Reenvie a mensagem em alguns segundos.";
  if (err instanceof JanelaMalConfigurada) return `⚙️ JANELA_TRABALHO/DIAS_TRABALHO inválida no servidor: ${msg}`;
  if (err instanceof RosterIlegivel) return "⚙️ squad.json ilegível no servidor. Veja o log do Easypanel.";
  return `❌ Erro ao processar a demanda: ${msg}`;
}

export function cortarParaTelegram(texto: string): string {
  if (texto.length <= MAX_MENSAGEM_TELEGRAM) return texto;
  return texto.slice(0, MAX_MENSAGEM_TELEGRAM - CORTE.length) + CORTE;
}
```

Se `ErroTarefa`/`AvisoTarefa` não tiverem `motivo` compatível com a comparação em `[...erros, ...avisos]`, tipar a união explicitamente como `{ motivo?: string }[]`.

- [ ] **Step 4:** Run `npm test` → PASS. `npx vue-tsc --noEmit` → ok. Run `npm run build` → o esbuild precisa resolver `../src/contribuicao.ts` → `./mochila` (sem extensão) a partir do bundle do servidor; deve passar. Se falhar, pare e relate: não mova código sem decidir.

- [ ] **Step 5: Commit**

```bash
git add server/telegram-resposta.ts server/telegram-resposta.test.ts
git commit -m "feat(telegram): turno e falhas em texto de chat, sem Vue"
```

---

### Tarefa 6: `server/telegram-bot.ts` — portão, fila serial e resposta

**Files:**
- Create: `server/telegram-bot.ts`
- Test: `server/telegram-bot.test.ts`

**Interfaces:**
- Consumes: Tarefas 3, 4, 5.
- Produces:
  ```ts
  export interface DepsDoBot {
    segredo: string;
    chatsPermitidos: ReadonlySet<number>;
    rodar(demanda: string, modo: Modo): Promise<TurnoResult>;
    enviar(chatId: number, texto: string, responderA?: number): Promise<void>;
    digitando(chatId: number): Promise<void>;
    fmt: FormatoDeData;
  }
  export const INTERVALO_DIGITANDO_MS = 4000
  export function criarBotDoTelegram(deps: DepsDoBot): {
    portao: RequestHandler;     // segredo; 401 sem corpo
    processar: RequestHandler;  // 200 imediato + fila
    ocioso(): Promise<void>;    // resolve quando a fila esvazia (testes)
  }
  ```

- [ ] **Step 1: Testes falhando** — `server/telegram-bot.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarBotDoTelegram, type DepsDoBot } from "./telegram-bot.ts";
import { ModeloOcupado, type TurnoResult } from "./orchestrator.ts";

const SEGREDO = "s".repeat(40);
const FMT = { locale: "pt-BR", timeZone: "America/Sao_Paulo" };
const TURNO_VAZIO: TurnoResult = { eventos_criados: [], sugestoes: [], avisos: [], erros: [] };

function res() {
  const r: any = { statusCode: 0, finalizado: false };
  r.status = (n: number) => { r.statusCode = n; return r; };
  r.end = () => { r.finalizado = true; return r; };
  r.sendStatus = (n: number) => { r.statusCode = n; r.finalizado = true; return r; };
  return r;
}
const req = (corpo: unknown, segredo: string | undefined = SEGREDO): any => ({
  body: corpo,
  get: (h: string) => (h.toLowerCase() === "x-telegram-bot-api-secret-token" ? segredo : undefined),
});
const update = (id: number, text: string, chat = 111) => ({
  update_id: id, message: { message_id: id * 10, chat: { id: chat, type: "private" }, text },
});

function montar(x: Partial<DepsDoBot> = {}) {
  const enviadas: { chatId: number; texto: string; responderA?: number }[] = [];
  const rodadas: { demanda: string; modo: string }[] = [];
  const deps: DepsDoBot = {
    segredo: SEGREDO,
    chatsPermitidos: new Set([111]),
    rodar: async (demanda, modo) => { rodadas.push({ demanda, modo }); return TURNO_VAZIO; },
    enviar: async (chatId, texto, responderA) => { enviadas.push({ chatId, texto, responderA }); },
    digitando: async () => {},
    fmt: FMT,
    ...x,
  };
  return { bot: criarBotDoTelegram(deps), enviadas, rodadas };
}

describe("portao", () => {
  it("segredo errado ou ausente = 401, next não roda", () => {
    const { bot } = montar();
    for (const s of ["errado", undefined]) {
      const r = res();
      let seguiu = false;
      bot.portao(req({}, s), r, () => { seguiu = true; });
      assert.equal(r.statusCode, 401);
      assert.equal(seguiu, false);
    }
  });

  it("segredo certo chama next", () => {
    const { bot } = montar();
    let seguiu = false;
    bot.portao(req({}), res(), () => { seguiu = true; });
    assert.equal(seguiu, true);
  });
});

describe("processar", () => {
  it("responde 200 ANTES do turno terminar e depois manda o texto em resposta à mensagem", async () => {
    let liberar!: () => void;
    const { bot, enviadas } = montar({ rodar: () => new Promise((ok) => { liberar = () => ok(TURNO_VAZIO); }) });
    const r = res();
    bot.processar(req(update(1, "reunião amanhã")), r, () => {});
    assert.equal(r.statusCode, 200);
    assert.equal(enviadas.length, 0);
    await new Promise((ok) => setImmediate(ok));
    liberar();
    await bot.ocioso();
    assert.deepEqual(enviadas, [{ chatId: 111, texto: "Nada foi agendado.", responderA: 10 }]);
  });

  it("chat não autorizado: 200, sem turno e sem resposta", async () => {
    const { bot, enviadas, rodadas } = montar();
    const r = res();
    bot.processar(req(update(1, "/start", 999)), r, () => {});
    await bot.ocioso();
    assert.equal(r.statusCode, 200);
    assert.equal(rodadas.length + enviadas.length, 0);
  });

  it("update_id repetido roda uma vez só", async () => {
    const { bot, rodadas } = montar();
    bot.processar(req(update(7, "x")), res(), () => {});
    bot.processar(req(update(7, "x")), res(), () => {});
    await bot.ocioso();
    assert.equal(rodadas.length, 1);
  });

  it("/foco passa o modo; /start responde ajuda sem turno", async () => {
    const { bot, rodadas, enviadas } = montar();
    bot.processar(req(update(1, "/foco revisar contrato")), res(), () => {});
    bot.processar(req(update(2, "/start")), res(), () => {});
    await bot.ocioso();
    assert.deepEqual(rodadas, [{ demanda: "revisar contrato", modo: "foco" }]);
    assert.ok(enviadas.some((e) => e.texto.includes("/foco")));
  });

  it("falha do turno vira texto classificado", async () => {
    const { bot, enviadas } = montar({ rodar: async () => { throw new ModeloOcupado("ocupado"); } });
    bot.processar(req(update(1, "x")), res(), () => {});
    await bot.ocioso();
    assert.match(enviadas.at(-1)!.texto, /Gemini sobrecarregado/);
  });

  it("fila serial: o segundo turno só começa depois do primeiro, e avisa a posição", async () => {
    const ordem: string[] = [];
    let liberar!: () => void;
    const { bot, enviadas } = montar({
      rodar: async (demanda) => {
        ordem.push(`inicio ${demanda}`);
        if (demanda === "a") await new Promise<void>((ok) => { liberar = ok; });
        ordem.push(`fim ${demanda}`);
        return TURNO_VAZIO;
      },
    });
    bot.processar(req(update(1, "a")), res(), () => {});
    bot.processar(req(update(2, "b")), res(), () => {});
    await new Promise((ok) => setImmediate(ok));
    assert.deepEqual(ordem, ["inicio a"]);
    assert.ok(enviadas.some((e) => /Na fila \(1 antes desta\)/.test(e.texto)));
    liberar();
    await bot.ocioso();
    assert.deepEqual(ordem, ["inicio a", "fim a", "inicio b", "fim b"]);
  });

  it("enviar que falha não derruba a fila", async () => {
    let n = 0;
    const { bot, rodadas } = montar({ enviar: async () => { n++; throw new Error("403 blocked"); } });
    bot.processar(req(update(1, "a")), res(), () => {});
    bot.processar(req(update(2, "b")), res(), () => {});
    await bot.ocioso();
    assert.equal(rodadas.length, 2);
    assert.ok(n >= 2);
  });
});
```

- [ ] **Step 2:** Run `npm test` → FAIL.

- [ ] **Step 3: Implementar** — `server/telegram-bot.ts`:

```ts
import type { RequestHandler } from "express";
import type { Modo } from "./capabilities.ts";
import type { TurnoResult } from "./orchestrator.ts";
import type { FormatoDeData } from "../src/contribuicao.ts";
import { segredoConfere } from "./telegram.ts";
import { criarMemoriaDeUpdates, interpretarUpdate, TEXTO_DE_AJUDA, TEXTO_SEM_TEXTO } from "./telegram-entrada.ts";
import { cortarParaTelegram, textoDaFalha, textoDoTurno } from "./telegram-resposta.ts";

/**
 * A cola do bot: portão próprio (a rota fica FORA do porteiro de IP), 200
 * imediato e uma fila serial de turnos.
 *
 * - 200 antes do turno: um turno leva até ~3 min; segurar a resposta faria o
 *   Telegram desistir e reentregar o update, e o compromisso nasceria duas vezes.
 * - Fila serial: dois turnos em paralelo leriam a agenda antes de o outro
 *   reservar e pegariam o mesmo horário. A CommandBar evita isso com isLoading.
 *   Turno da UI e do bot ao mesmo tempo continua possível (custo aceito).
 * - Tudo por dependência injetada: o teste roda sem Express, Google e Telegram.
 */

export interface DepsDoBot {
  segredo: string;
  chatsPermitidos: ReadonlySet<number>;
  rodar(demanda: string, modo: Modo): Promise<TurnoResult>;
  enviar(chatId: number, texto: string, responderA?: number): Promise<void>;
  digitando(chatId: number): Promise<void>;
  fmt: FormatoDeData;
}

/** "digitando..." some em 5 s no Telegram. */
export const INTERVALO_DIGITANDO_MS = 4000;

export function criarBotDoTelegram(deps: DepsDoBot) {
  const memoria = criarMemoriaDeUpdates();
  let fila: Promise<void> = Promise.resolve();
  let pendentes = 0;

  const falhouAoEnviar = (err: unknown) =>
    console.error(`[telegram] falha ao responder: ${err instanceof Error ? err.message : String(err)}`);

  function enfileirar(tarefa: () => Promise<void>): number {
    const antes = pendentes;
    pendentes++;
    fila = fila
      .then(tarefa)
      .catch((err) => console.error("[telegram] tarefa da fila falhou:", err))
      .finally(() => { pendentes--; });
    return antes;
  }

  const portao: RequestHandler = (req, res, next) => {
    if (!segredoConfere(deps.segredo, req.get("X-Telegram-Bot-Api-Secret-Token"))) {
      // Sem detalhe e sem logar o header: quem não tem o segredo não é o Telegram.
      console.warn("[telegram] webhook com segredo inválido");
      res.status(401).end();
      return;
    }
    next();
  };

  const processar: RequestHandler = (req, res) => {
    const entrada = interpretarUpdate(req.body, deps.chatsPermitidos);
    // 200 para tudo que passou do segredo, inclusive o que é ignorado: status
    // diferente faz o Telegram reentregar e segurar os updates seguintes.
    res.sendStatus(200);
    if (entrada.updateId !== null && memoria.jaVisto(entrada.updateId)) return;

    switch (entrada.tipo) {
      case "ignorar":
        return;
      case "naoAutorizado":
        // Sem resposta no chat. O log é como o dono descobre o próprio chat_id.
        console.warn(`[telegram] chat ${entrada.chatId} não autorizado (TELEGRAM_CHAT_IDS)`);
        return;
      case "ajuda":
        deps.enviar(entrada.chatId, TEXTO_DE_AJUDA, entrada.mensagemId).catch(falhouAoEnviar);
        return;
      case "semTexto":
        deps.enviar(entrada.chatId, TEXTO_SEM_TEXTO, entrada.mensagemId).catch(falhouAoEnviar);
        return;
      case "demanda": {
        const { chatId, mensagemId, demanda, modo } = entrada;
        const antes = enfileirar(async () => {
          deps.digitando(chatId).catch(() => {});
          const relogio = setInterval(() => deps.digitando(chatId).catch(() => {}), INTERVALO_DIGITANDO_MS);
          let texto: string;
          try {
            texto = textoDoTurno(await deps.rodar(demanda, modo), deps.fmt);
          } catch (err) {
            console.error("[telegram] erro no turno:", err);
            texto = textoDaFalha(err);
          } finally {
            clearInterval(relogio);
          }
          await deps.enviar(chatId, cortarParaTelegram(texto), mensagemId).catch(falhouAoEnviar);
        });
        if (antes > 0) deps.enviar(chatId, `⏳ Na fila (${antes} antes desta).`, mensagemId).catch(falhouAoEnviar);
        return;
      }
    }
  };

  return { portao, processar, ocioso: () => fila };
}
```

Nota para o teste "ocioso": `ocioso()` devolve a `fila` atual; se um teste enfileira depois de chamar `ocioso`, chame de novo. Os testes acima enfileiram antes.

- [ ] **Step 4:** Run `npm test` → PASS. `npx vue-tsc --noEmit` → ok.

- [ ] **Step 5: Commit**

```bash
git add server/telegram-bot.ts server/telegram-bot.test.ts
git commit -m "feat(telegram): webhook com portão próprio, 200 imediato e fila serial"
```

---

### Tarefa 7: Ligar no `server.ts`, env, docs e verificação ponta a ponta

**Files:**
- Modify: `server.ts` (antes de `app.use(porteiroDeIp())`, linha ~138; e bloco de logs do boot, linha ~515)
- Modify: `.env.example`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `rodarDemanda` (T1), `lerConfigDeTelegram`, `descreverTelegram`, `enviarMensagem`, `avisarDigitando`, `registrarWebhook`, `ROTA_WEBHOOK_TELEGRAM`, `TelegramMalConfigurado` (T3), `criarBotDoTelegram` (T6), `FUSO` (`server/alocador.ts`).

- [ ] **Step 1: Montar a rota antes do porteiro** — em `startServer()`, logo depois de `app.set("trust proxy", true);` e **antes** de `app.use(porteiroDeIp());`:

```ts
  // --- Bot do Telegram ------------------------------------------------
  // ANTES do porteiro de IP, e só esta rota: o Telegram não tem IP fixo. A
  // trava dela é o segredo do webhook + a allowlist de chat_id. Desligado, a
  // rota nem existe e o caminho cai no porteiro como qualquer outro.
  let configDeTelegram: ConfigDeTelegram | null = null;
  let falhaDoTelegram: string | null = null;
  try {
    configDeTelegram = lerConfigDeTelegram(process.env);
  } catch (error: any) {
    falhaDoTelegram = error instanceof TelegramMalConfigurado ? error.message : String(error?.message ?? error);
  }
  if (configDeTelegram) {
    const c = configDeTelegram;
    const bot = criarBotDoTelegram({
      segredo: c.segredo,
      chatsPermitidos: c.chatsPermitidos,
      // Sem squadId: o bot não tem aba. Primeira squad ativa + redirecionamento automático.
      rodar: (demanda, modo) => rodarDemanda(ai, { demanda, modo }),
      enviar: (chatId, texto, responderA) => enviarMensagem(c, chatId, texto, responderA),
      digitando: (chatId) => avisarDigitando(c, chatId),
      // O container roda em UTC: sem o fuso o horário da resposta sairia 3h adiantado.
      fmt: { locale: "pt-BR", timeZone: FUSO },
    });
    app.post(ROTA_WEBHOOK_TELEGRAM, bot.portao, express.json({ limit: "256kb" }), bot.processar);
  }

  app.use(porteiroDeIp());
```

Imports: `import { avisarDigitando, descreverTelegram, enviarMensagem, lerConfigDeTelegram, registrarWebhook, ROTA_WEBHOOK_TELEGRAM, TelegramMalConfigurado, type ConfigDeTelegram } from "./server/telegram.ts";` e `import { criarBotDoTelegram } from "./server/telegram-bot.ts";`. `FUSO` já é importado.

- [ ] **Step 2: Boot: log e registro** — junto dos logs de janela/push (antes de `app.listen`):

```ts
  if (falhaDoTelegram) console.error(`Bot do Telegram inválido (desligado): ${falhaDoTelegram}`);
  else if (configDeTelegram) console.log(`Bot do Telegram: ${descreverTelegram(configDeTelegram)}`);
  else console.log("Bot do Telegram desligado (TELEGRAM_BOT_TOKEN vazia)");
```

E dentro do callback de `app.listen`, depois de `vigia?.iniciar();`:

```ts
    // Só em produção: o APP_URL de dev é http://localhost (o Telegram exige
    // HTTPS) e registrar com o token real roubaria o webhook do servidor no ar.
    if (configDeTelegram && process.env.NODE_ENV === "production") {
      const base = process.env.APP_URL;
      if (!base) {
        console.error("Bot do Telegram: APP_URL vazia, webhook não registrado.");
      } else {
        const url = new URL(ROTA_WEBHOOK_TELEGRAM, base).href;
        registrarWebhook(configDeTelegram, url)
          .then(() => console.log(`Bot do Telegram: webhook registrado em ${url}`))
          .catch((error) => console.error(`Bot do Telegram: falha ao registrar o webhook: ${error.message}`));
      }
    }
```

- [ ] **Step 3: `.env.example`** — ao final:

```bash
# TELEGRAM_BOT_TOKEN: token do bot criado no @BotFather. Vazio ou ausente = bot
# desligado (as duas abaixo sao ignoradas). Presente, as duas abaixo sao
# obrigatorias; qualquer uma invalida = erro no log do boot e bot desligado.
# Em dev deixe VAZIO (ou use outro bot): o boot so registra o webhook em
# producao, mas o mesmo token em dois lugares confunde o teste.
TELEGRAM_BOT_TOKEN=""

# TELEGRAM_WEBHOOK_SECRET: 32 a 256 caracteres [A-Za-z0-9_-]. O Telegram manda
# no header X-Telegram-Bot-Api-Secret-Token; sem ele o webhook responde 401.
# Gere com:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# Trocar exige Implantar: o boot registra o webhook de novo com o valor novo.
TELEGRAM_WEBHOOK_SECRET=""

# TELEGRAM_CHAT_IDS: chat_id das conversas privadas autorizadas, por virgula.
# VAZIA NAO ABRE O BOT (ao contrario de IPS_PERMITIDOS). Para descobrir o seu:
# mande /start ao bot e procure "[telegram] chat <id> nao autorizado" no log.
TELEGRAM_CHAT_IDS=""
```

- [ ] **Step 4: Verificação local ponta a ponta** — `.env` de dev com um token de formato válido (pode ser falso: sem `NODE_ENV=production` nada é registrado; a resposta vai falhar no `sendMessage` e aparecer como `[telegram] falha ao responder`, o que prova o fluxo), `TELEGRAM_WEBHOOK_SECRET` de 40 chars e `TELEGRAM_CHAT_IDS=111`. `npm run dev`. Boot deve logar `Bot do Telegram: webhook em /api/telegram/webhook, 1 chat(s) permitido(s)`.

Sem segredo → 401:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/telegram/webhook -H "Content-Type: application/json" -d "{}"
```

Chat não autorizado → 200 e log `[telegram] chat 999 não autorizado`, nenhuma chamada ao Gemini:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/telegram/webhook -H "Content-Type: application/json" -H "X-Telegram-Bot-Api-Secret-Token: <SEGREDO>" -d "{\"update_id\":1,\"message\":{\"message_id\":1,\"chat\":{\"id\":999,\"type\":\"private\"},\"text\":\"oi\"}}"
```

Demanda autorizada → 200 imediato; no log, o turno roda (mesmo log de `/api/orquestrar`) e depois `[telegram] falha ao responder: Telegram respondeu 401 ...` (token falso). Com um token real e seu chat_id real, a resposta chega no celular:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/telegram/webhook -H "Content-Type: application/json" -H "X-Telegram-Bot-Api-Secret-Token: <SEGREDO>" -d "{\"update_id\":2,\"message\":{\"message_id\":2,\"chat\":{\"id\":111,\"type\":\"private\"},\"text\":\"ligar pro banco amanhã 30 minutos\"}}"
```

Repetir o mesmo `update_id: 2` → 200 e **nenhum** turno novo no log.

Bot desligado (tirar `TELEGRAM_BOT_TOKEN`, reiniciar) com `IPS_PERMITIDOS` preenchida com outro IP → o POST acima leva 403 do porteiro.

Rodar também: `npm test`, `npx vue-tsc --noEmit`, `npm run build` → todos ok.

- [ ] **Step 5: `CLAUDE.md`** — atualize, em português e no tom do arquivo:
  1. **Arquitetura:** linhas para `server/turno.ts`, `server/telegram.ts`, `server/telegram-entrada.ts` (PURO), `server/telegram-resposta.ts` (PURO), `server/telegram-bot.ts`; `server.ts` "monta o webhook do Telegram antes do porteiro".
  2. **Comandos/testes:** acrescente os quatro `*.test.ts` novos à lista.
  3. **Nova seção "Bot do Telegram"** depois de "Lembretes push (ntfy)", com: D1 (header secreto, tempo constante, 401 antes do parse), D2 (única rota fora do porteiro), D4 (allowlist fecha vazia; 200 sem resposta a chat estranho; como achar o chat_id), D5 (primeira squad ativa + redirecionamento; custo de 2 chamadas; alternativas descartadas em uma frase cada), D6 (200 imediato, dedupe de `update_id` em memória, fila serial e o custo aceito de UI + bot ao mesmo tempo, crash perde a resposta), D7 (reusa `linhasDosEventosCriados`; propostas não se aprovam pelo chat), D8 (comandos), D9 (registro no boot só em produção) e D10 (privacidade: chat de bot não é E2E, títulos passam pelo Telegram).
  4. **Porteiro de IP:** "exceto `POST /api/telegram/webhook`, montada antes, com trava própria".
  5. **Variáveis de ambiente:** as três linhas da D3.
  6. **Convenções / erros:** `TelegramMalConfigurado` (log no boot, bot desligado), `ErroDeTelegram` (`status`; só log).
  7. **Rollback:** sem migração; implantar o commit anterior. O webhook continua registrado no Telegram apontando para uma rota que passa a dar 403 (porteiro): chame `deleteWebhook` ou ignore.

- [ ] **Step 6: Commit, push e grafo**

```bash
git add server.ts .env.example CLAUDE.md
git commit -m "feat(telegram): webhook montado antes do porteiro, registro no boot e docs"
git push
graphify update .
```

---

### Tarefa 8 (usuário, não o agente): colocar no ar

Listar no relatório final, sem executar:

1. `@BotFather` → `/newbot` → guardar o token. Opcional: `/setcommands` com `foco - primeiro horário livre`, `baixa - encaixa até o 7º dia útil`, `ajuda - como usar`.
2. Easypanel (`aladdin` → `squadone-app`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (gerado) e `TELEGRAM_CHAT_IDS=1` **provisório** (vazia recusa a config e o bot nem sobe para você descobrir o id; `1` não é chat de ninguém). **Implantar**.
3. Mandar `/start` ao bot; no log, `[telegram] chat <id> não autorizado`. Pôr esse id em `TELEGRAM_CHAT_IDS` e **Implantar** de novo.
4. Conferir `Bot do Telegram: webhook registrado em https://aladdin-squadone-app.jicnzg.easypanel.host/api/telegram/webhook` no log. Se preciso: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` (no navegador; não colar o token em lugar nenhum) deve mostrar a URL e `last_error_message` vazio.
5. Mandar uma demanda real e conferir o evento no Google Calendar e na Mochila.

---

## Autorrevisão (feita)

- **Cobertura:** validação do webhook (D1, T3, T6); porteiro de IP (D2, T7); env ausente = desligado (D3, T3); squad sem frontend (D5, T1, T7); erros legíveis (D7, T5); allowlist de chat_id (D4, T3, T4, T6); resposta equivalente ao toast (T2, T5). Fora do escopo, de propósito: aprovar contratação pelo chat, botões inline para o empate de troca, prefixo de squad, áudio/foto, push de lembrete pelo Telegram.
- **Nomes conferidos entre tarefas:** `rodarDemanda`, `linhasDosEventosCriados`, `lerConfigDeTelegram`, `segredoConfere`, `enviarMensagem`, `avisarDigitando`, `registrarWebhook`, `ROTA_WEBHOOK_TELEGRAM`, `interpretarUpdate`, `criarMemoriaDeUpdates`, `textoDoTurno`, `textoDaFalha`, `cortarParaTelegram`, `criarBotDoTelegram`.
- **Pontos a confirmar no código durante a execução** (marcados nas tarefas): imports que ficam sem uso em `server.ts` (T1 Step 2); `npm run build` resolvendo `../src/contribuicao.ts` no bundle do servidor (T5 Step 4).
