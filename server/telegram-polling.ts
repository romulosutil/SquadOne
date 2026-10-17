import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ErroDeTelegram } from "./telegram.ts";

/**
 * Entrada do bot por long polling (TELEGRAM_TRANSPORTE=polling, no Dell): o
 * processo busca as mensagens com `getUpdates` em vez de receber um webhook,
 * porque webhook exigiria URL pública e Funnel é proibido (regra 7).
 *
 * - **Offset persistido e confirmado ao enfileirar.** Cada update vai para o
 *   bot (`receber`, que deduplica e enfileira o turno sem esperá-lo) e só
 *   então o offset avança para `update_id + 1` e vai ao disco. O `getUpdates`
 *   seguinte manda esse offset, e é isso que confirma ao Telegram: o update
 *   some de lá. Avançar ANTES de enfileirar perderia a mensagem num crash;
 *   avançar só DEPOIS do turno rodaria de novo um turno que já criou o
 *   compromisso. Crash entre o enfileirar e o turno perde aquela resposta, o
 *   mesmo custo aceito do webhook depois do 200.
 * - **Nunca setWebhook.** O Telegram recusa `getUpdates` (409) enquanto houver
 *   webhook; quem o tira é o runbook, com `deleteWebhook` SEM
 *   `drop_pending_updates`. Aqui o 409 só vira log e espera.
 * - A guarda de demanda atrasada (10 min) é do `interpretarUpdate`, a mesma do
 *   webhook: o backlog de até 24 h que o Telegram guardou enquanto ninguém
 *   buscava vira "⌛ Não processei", nunca compromisso marcado tarde.
 */

export interface DepsDoPolling {
  /** `getUpdates` com o offset (null = o Telegram decide: tudo que está pendente). */
  buscar(offset: number | null): Promise<unknown[]>;
  /** O `receber` do bot: deduplica e enfileira, sem esperar o turno. */
  receber(update: unknown): void;
  lerOffset(): Promise<number | null>;
  gravarOffset(offset: number): Promise<void>;
  esperar(ms: number): Promise<void>;
  log?: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

/**
 * Falhas de rede seguidas a partir das quais o polling se declara "inacessível".
 * No journal da Mel de 13 a 17/10/2026, 49 das 51 quedas logadas eram UMA
 * tentativa (ECONNRESET de conexão reaproveitada, TimeoutError de long poll que
 * ficou mudo no Wi-Fi) e a seguinte já voltava; só as 2 de DNS (EAI_AGAIN, 2,5 e
 * 6,5 min) eram queda de verdade. Com 1, cada soluço virava um par
 * "inacessível"/"voltou" (5 a 17 por dia) e a queda real se perdia no meio.
 */
export const FALHAS_PARA_DECLARAR = 2;
/** Primeira falha de rede: tenta de novo quase na hora, numa conexão nova. */
export const ESPERA_SOLUCO_MS = 1_000;
/** Rede fora (já declarada): começa curto e sobe até 1 min. */
export const ESPERA_REDE_MS = [5_000, 10_000, 30_000, 60_000] as const;
/** 409: webhook ainda registrado, ou outro processo buscando com o mesmo token. */
export const ESPERA_CONFLITO_MS = 30_000;
/** 401/404: token revogado ou errado. Repetir rápido não conserta. */
export const ESPERA_CREDENCIAL_MS = 5 * 60_000;
export const ESPERA_OUTRO_MS = 30_000;

/**
 * `rede`: sem resposta (status null) ou 5xx do Telegram; os dois passam sozinhos.
 * O resto é configuração (409, 401/404) ou resposta que repetir não muda, e
 * aparece na primeira vez: esperar a segunda só atrasaria o aviso.
 */
export type TipoDeFalha = "rede" | "conflito" | "credencial" | "outro";

export function tipoDaFalha(err: unknown): TipoDeFalha {
  if (!(err instanceof ErroDeTelegram)) return "outro";
  if (err.status === null || err.status >= 500) return "rede";
  if (err.status === 409) return "conflito";
  if (err.status === 401 || err.status === 404) return "credencial";
  return "outro";
}

/**
 * PURO: esta falha (a `falhasSeguidas`-ésima seguida, contando com ela) já é
 * queda? Soluço de rede de uma tentativa não é; a segunda seguida é.
 */
export function declararQueda(tipo: TipoDeFalha, falhasSeguidas: number): boolean {
  return tipo !== "rede" || falhasSeguidas >= FALHAS_PARA_DECLARAR;
}

/**
 * O que fazer depois de uma falha do getUpdates: quanto esperar, o que logar e
 * se já é queda (`declarar`). O offset não muda numa falha: o getUpdates
 * seguinte pede o mesmo, e o Telegram reentrega o que não foi confirmado.
 */
export function esperaDepoisDe(err: unknown, falhasSeguidas: number): { ms: number; motivo: string; declarar: boolean } {
  const tipo = tipoDaFalha(err);
  const declarar = declararQueda(tipo, falhasSeguidas);
  const motivo = (err as Error)?.message ?? String(err);
  if (tipo === "conflito") {
    return {
      ms: ESPERA_CONFLITO_MS,
      declarar,
      motivo: "getUpdates recusado (409): webhook ainda registrado ou outro processo buscando. Rode o deleteWebhook do runbook (sem drop).",
    };
  }
  if (tipo === "credencial") {
    const status = (err as ErroDeTelegram).status;
    return { ms: ESPERA_CREDENCIAL_MS, declarar, motivo: `token do bot recusado (${status}): confira TELEGRAM_BOT_TOKEN.` };
  }
  if (tipo === "rede") {
    if (!declarar) return { ms: ESPERA_SOLUCO_MS, declarar, motivo };
    const i = Math.min(falhasSeguidas - FALHAS_PARA_DECLARAR, ESPERA_REDE_MS.length - 1);
    return { ms: ESPERA_REDE_MS[i], declarar, motivo };
  }
  return { ms: ESPERA_OUTRO_MS, declarar, motivo };
}

export function criarPollingDoTelegram(deps: DepsDoPolling) {
  const log = deps.log ?? console;
  let offset: number | null = null;
  let carregado = false;
  let falhaDoOffset: string | null = null;

  /**
   * Um getUpdates. Devolve quantos updates foram entregues ao bot. Falha do
   * getUpdates sobe (quem roda o laço decide a espera); falha ao GRAVAR o
   * offset não: o offset em memória já avançou e o próximo getUpdates confirma
   * do mesmo jeito; só um reinício nesse meio repetiria (e a deduplicação de
   * update_id do bot não sobrevive a ele, custo aceito como o do webhook).
   */
  async function rodada(): Promise<number> {
    if (!carregado) {
      offset = await deps.lerOffset();
      carregado = true;
    }
    const updates = await deps.buscar(offset);
    let entregues = 0;
    for (const u of updates) {
      const id = (u as any)?.update_id;
      if (typeof id !== "number" || !Number.isInteger(id)) continue;
      // Já confirmado: o Telegram não devolve abaixo do offset, mas um offset
      // regravado à mão ou uma resposta fora de ordem não roda o turno de novo.
      if (offset !== null && id < offset) continue;
      deps.receber(u);
      entregues++;
      offset = id + 1;
      try {
        await deps.gravarOffset(offset);
        if (falhaDoOffset !== null) {
          log.error("[telegram] offset voltou a ser gravado");
          falhaDoOffset = null;
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (msg !== falhaDoOffset) log.error(`[telegram] offset não gravado (segue em memória): ${msg}`);
        falhaDoOffset = msg;
      }
    }
    return entregues;
  }

  /** Liga o laço. Devolve a função que desliga (a busca em curso termina sozinha em até ~65 s). */
  function iniciar(): () => void {
    let parado = false;
    void (async () => {
      let falhasSeguidas = 0;
      let motivoAntes: string | null = null;
      while (!parado) {
        try {
          await rodada();
          if (motivoAntes !== null) log.error("[telegram] polling voltou a funcionar");
          falhasSeguidas = 0;
          motivoAntes = null;
        } catch (err) {
          falhasSeguidas++;
          const { ms, motivo, declarar } = esperaDepoisDe(err, falhasSeguidas);
          if (declarar) {
            // Só loga quando muda: um webhook esquecido logaria 2880x/dia.
            if (motivo !== motivoAntes) log.error(`[telegram] polling: ${motivo}`);
            motivoAntes = motivo;
          } else {
            // Soluço: fica no journal SEM a palavra "inacessível", para medir sem
            // virar queda num grep; o "voltou" só sai se a queda foi declarada.
            const onde = motivo.replace(/^Telegram inacessível em /, "").replace(/\.$/, "");
            log.log(`[telegram] polling: soluço de rede em ${onde}, nova tentativa em ${ms / 1000} s`);
          }
          if (!parado) await deps.esperar(ms);
        }
      }
    })();
    return () => {
      parado = true;
    };
  }

  return { rodada, iniciar };
}

/**
 * O offset em disco: `{ "offset": n }`, gravado em `.tmp` + rename. Ausente =
 * primeira vez (null: o Telegram entrega o que estiver pendente). Ilegível
 * também vira null, com log: perder o offset reprocessa no máximo o que o
 * Telegram ainda guarda, e a guarda de 10 min impede que vire compromisso.
 */
export function arquivoDeOffset(caminho: string, log: { error: (...a: unknown[]) => void } = console) {
  return {
    async ler(): Promise<number | null> {
      let texto: string;
      try {
        texto = await fs.readFile(caminho, "utf8");
      } catch (err: any) {
        if (err?.code === "ENOENT") return null;
        throw err;
      }
      try {
        const n = JSON.parse(texto)?.offset;
        if (Number.isInteger(n) && n >= 0) return n;
      } catch {
        // cai no log abaixo
      }
      log.error(`[telegram] ${path.basename(caminho)} ilegível: começa sem offset`);
      return null;
    },
    async gravar(offset: number): Promise<void> {
      const tmp = `${caminho}.${randomBytes(4).toString("hex")}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify({ offset }) + "\n", { encoding: "utf8", mode: 0o600 });
        await fs.rename(tmp, caminho);
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
    },
  };
}
