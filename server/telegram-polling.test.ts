/**
 * Entrada do bot por getUpdates. `fetch` é dublê: nada sai para o Telegram. O
 * offset grava num diretório temporário. O bot é o de verdade
 * (`criarBotDoTelegram`) com as dependências dubladas, para a guarda de demanda
 * atrasada e a fila serem as mesmas do webhook.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { buscarAtualizacoes, ErroDeTelegram, type ConfigDeTelegram } from "./telegram.ts";
import { criarBotDoTelegram, type DepsDoBot } from "./telegram-bot.ts";
import {
  arquivoDeOffset,
  criarPollingDoTelegram,
  declararQueda,
  ESPERA_CONFLITO_MS,
  ESPERA_CREDENCIAL_MS,
  ESPERA_OUTRO_MS,
  ESPERA_SOLUCO_MS,
  esperaDepoisDe,
  FALHAS_PARA_DECLARAR,
  tipoDaFalha,
  type TipoDeFalha,
} from "./telegram-polling.ts";
import type { TurnoResult } from "./orchestrator.ts";

const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
const CONFIG: ConfigDeTelegram = { transporte: "polling", token: TOKEN, chatsPermitidos: new Set([111]) };
const AGORA = new Date("2026-10-07T12:00:00Z");
const TURNO_VAZIO: TurnoResult = { eventos_criados: [], tarefas_criadas: [], sugestoes: [], avisos: [], erros: [] };
const silencio = { log() {}, error() {} };

const mensagem = (id: number, text: string, idadeS = 5) => ({
  update_id: id,
  message: { message_id: id * 10, chat: { id: 111, type: "private" }, text, date: AGORA.getTime() / 1000 - idadeS },
});

function bot(x: Partial<DepsDoBot> = {}) {
  const rodadas: string[] = [];
  const enviadas: string[] = [];
  const deps: DepsDoBot = {
    segredo: null,
    chatsPermitidos: new Set([111]),
    rodar: async (demanda) => { rodadas.push(demanda); return TURNO_VAZIO; },
    enviar: async (_c, texto) => { enviadas.push(texto); },
    digitando: async () => {},
    transcrever: async () => "",
    contratar: async () => "",
    responderBotao: async () => {},
    editar: async () => {},
    fmt: { locale: "pt-BR", timeZone: "America/Sao_Paulo" },
    agora: () => AGORA,
    ...x,
  };
  const b = criarBotDoTelegram(deps);
  return { b, rodadas, enviadas };
}

/** fetch dublê: responde `getUpdates` com as levas dadas, em ordem, e registra tudo. */
function telegramDuble(levas: (unknown[] | { status: number; description: string })[]) {
  const chamadas: { metodo: string; corpo: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const metodo = String(url).split("/").pop()!;
    chamadas.push({ metodo, corpo: JSON.parse(String(init.body)) });
    const leva = levas.shift() ?? [];
    if (!Array.isArray(leva)) {
      return new Response(JSON.stringify({ ok: false, error_code: leva.status, description: leva.description }), { status: leva.status });
    }
    return new Response(JSON.stringify({ ok: true, result: leva }));
  }) as unknown as typeof fetch;
  return chamadas;
}

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "squadone-offset-"));
const flush = () => new Promise<void>((r) => setImmediate(r));

describe("polling", () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; });

  it("entrega cada update ao bot e grava o offset DEPOIS de enfileirar", async () => {
    const ordem: string[] = [];
    const chamadas = telegramDuble([[mensagem(5, "reunião amanhã"), mensagem(6, "dentista sexta")]]);
    const { b } = bot();
    const p = criarPollingDoTelegram({
      buscar: (o) => buscarAtualizacoes(CONFIG, o),
      receber: (u) => { ordem.push(`receber ${(u as any).update_id}`); b.receber(u); },
      lerOffset: async () => null,
      gravarOffset: async (o) => { ordem.push(`gravar ${o}`); },
      esperar: async () => {},
      log: silencio,
    });
    assert.equal(await p.rodada(), 2);
    assert.deepEqual(ordem, ["receber 5", "gravar 6", "receber 6", "gravar 7"]);
    assert.deepEqual(chamadas.map((c) => c.metodo), ["getUpdates"]);
    assert.equal("offset" in chamadas[0].corpo, false, "primeira vez sem offset: o Telegram entrega o pendente");
  });

  it("o getUpdates seguinte confirma com update_id + 1, com timeout 50 e mensagens + botões", async () => {
    const chamadas = telegramDuble([[mensagem(5, "a")], []]);
    const { b } = bot();
    const p = criarPollingDoTelegram({
      buscar: (o) => buscarAtualizacoes(CONFIG, o), receber: b.receber,
      lerOffset: async () => null, gravarOffset: async () => {}, esperar: async () => {}, log: silencio,
    });
    await p.rodada();
    await p.rodada();
    assert.deepEqual(chamadas[1].corpo, { offset: 6, timeout: 50, allowed_updates: ["message", "callback_query"] });
  });

  it("offset persistido sobrevive ao reinício (arquivo real, atômico)", async () => {
    const dir = await tmp();
    const arquivo = arquivoDeOffset(path.join(dir, "telegram-offset.json"), silencio);
    assert.equal(await arquivo.ler(), null);
    telegramDuble([[mensagem(41, "a")]]);
    const um = criarPollingDoTelegram({
      buscar: (o) => buscarAtualizacoes(CONFIG, o), receber: bot().b.receber,
      lerOffset: arquivo.ler, gravarOffset: arquivo.gravar, esperar: async () => {}, log: silencio,
    });
    await um.rodada();
    assert.deepEqual(await fs.readdir(dir), ["telegram-offset.json"], "sem .tmp sobrando");

    const chamadas = telegramDuble([[]]);
    const dois = criarPollingDoTelegram({
      buscar: (o) => buscarAtualizacoes(CONFIG, o), receber: bot().b.receber,
      lerOffset: arquivo.ler, gravarOffset: arquivo.gravar, esperar: async () => {}, log: silencio,
    });
    await dois.rodada();
    assert.equal(chamadas[0].corpo.offset, 42);
  });

  it("offset ilegível: começa sem offset em vez de travar", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "telegram-offset.json"), "{lixo");
    assert.equal(await arquivoDeOffset(path.join(dir, "telegram-offset.json"), silencio).ler(), null);
  });

  it("falha ao gravar o offset não perde o update nem para o laço", async () => {
    const chamadas = telegramDuble([[mensagem(5, "a")], []]);
    const { b, rodadas } = bot();
    const p = criarPollingDoTelegram({
      buscar: (o) => buscarAtualizacoes(CONFIG, o), receber: b.receber,
      lerOffset: async () => null, gravarOffset: async () => { throw new Error("disco cheio"); }, esperar: async () => {}, log: silencio,
    });
    await p.rodada();
    await p.rodada();
    await b.ocioso();
    assert.deepEqual(rodadas, ["a"]);
    assert.equal(chamadas[1].corpo.offset, 6, "o offset em memória confirma do mesmo jeito");
  });

  it("update reentregue (mesmo update_id) não roda o turno de novo", async () => {
    telegramDuble([[mensagem(5, "a")], [mensagem(5, "a")]]);
    const { b, rodadas } = bot();
    let offset: number | null = null;
    const p = criarPollingDoTelegram({
      buscar: (o) => buscarAtualizacoes(CONFIG, o), receber: b.receber,
      lerOffset: async () => offset, gravarOffset: async (o) => { offset = o; }, esperar: async () => {}, log: silencio,
    });
    await p.rodada();
    await p.rodada();
    await b.ocioso();
    assert.deepEqual(rodadas, ["a"]);
  });

  it("guarda de 10 min mantida: o backlog do deleteWebhook sem drop vira ⌛, não turno", async () => {
    telegramDuble([[mensagem(9, "/foco reunião", 3 * 3600), mensagem(10, "agora sim", 5)]]);
    const { b, rodadas, enviadas } = bot();
    const p = criarPollingDoTelegram({
      buscar: (o) => buscarAtualizacoes(CONFIG, o), receber: b.receber,
      lerOffset: async () => null, gravarOffset: async () => {}, esperar: async () => {}, log: silencio,
    });
    await p.rodada();
    await flush();
    await b.ocioso();
    assert.deepEqual(rodadas, ["agora sim"]);
    assert.match(enviadas[0], /⌛ Não processei: .*180 min de atraso/);
  });

  it("webhook ainda ativo (409): espera e loga uma vez, NUNCA chama setWebhook nem deleteWebhook", async () => {
    const chamadas = telegramDuble([
      { status: 409, description: "Conflict: can't use getUpdates method while webhook is active" },
      { status: 409, description: "Conflict: can't use getUpdates method while webhook is active" },
      [mensagem(5, "a")],
    ]);
    const esperas: number[] = [];
    const logs: string[] = [];
    const { b, rodadas } = bot();
    let parar = () => {};
    const p = criarPollingDoTelegram({
      buscar: (o) => buscarAtualizacoes(CONFIG, o),
      receber: (u) => { b.receber(u); parar(); },
      lerOffset: async () => null, gravarOffset: async () => {},
      esperar: async (ms) => { esperas.push(ms); },
      log: { log() {}, error: (m: unknown) => logs.push(String(m)) },
    });
    parar = p.iniciar();
    for (let i = 0; i < 20 && rodadas.length === 0; i++) await flush();
    await b.ocioso();
    assert.deepEqual(esperas, [ESPERA_CONFLITO_MS, ESPERA_CONFLITO_MS]);
    assert.equal(logs.filter((l) => /409/.test(l)).length, 1);
    assert.ok(chamadas.every((c) => c.metodo === "getUpdates"), "só getUpdates");
    assert.deepEqual(rodadas, ["a"]);
  });

  it("espera por tipo de falha", () => {
    assert.equal(esperaDepoisDe(new ErroDeTelegram("x", 409), 1).ms, ESPERA_CONFLITO_MS);
    assert.equal(esperaDepoisDe(new ErroDeTelegram("x", 401), 1).ms, ESPERA_CREDENCIAL_MS);
    assert.equal(esperaDepoisDe(new ErroDeTelegram("x", null), 1).ms, ESPERA_SOLUCO_MS);
    assert.equal(esperaDepoisDe(new ErroDeTelegram("x", null), 2).ms, 5_000);
    assert.equal(esperaDepoisDe(new ErroDeTelegram("x", null), 9).ms, 60_000, "backoff limitado a 1 min");
    assert.equal(esperaDepoisDe(new ErroDeTelegram("x", 502), 1).ms, ESPERA_SOLUCO_MS, "5xx passa sozinho como rede");
    assert.equal(esperaDepoisDe(new ErroDeTelegram("x", 400), 1).ms, ESPERA_OUTRO_MS);
    assert.equal(esperaDepoisDe(new Error("x"), 1).ms, ESPERA_OUTRO_MS);
    assert.doesNotMatch(esperaDepoisDe(new ErroDeTelegram("x", 401), 1).motivo, new RegExp(TOKEN));
  });

  // Tabela da regra (13 a 17/10/2026, journal da Mel): 49 de 51 "inacessível"
  // eram uma tentativa só; a queda real (DNS) passava de duas.
  const casos: { nome: string; err: unknown; falhas: number; tipo: TipoDeFalha; declarar: boolean }[] = [
    { nome: "ECONNRESET isolado", err: new ErroDeTelegram("Telegram inacessível em getUpdates (ECONNRESET).", null), falhas: 1, tipo: "rede", declarar: false },
    { nome: "TimeoutError isolado", err: new ErroDeTelegram("Telegram inacessível em getUpdates (TimeoutError).", null), falhas: 1, tipo: "rede", declarar: false },
    { nome: "segunda falha de rede seguida", err: new ErroDeTelegram("Telegram inacessível em getUpdates (EAI_AGAIN).", null), falhas: 2, tipo: "rede", declarar: true },
    { nome: "rede fora há muito", err: new ErroDeTelegram("x", null), falhas: 30, tipo: "rede", declarar: true },
    { nome: "502 isolado", err: new ErroDeTelegram("Telegram respondeu 502 em getUpdates: Bad Gateway", 502), falhas: 1, tipo: "rede", declarar: false },
    { nome: "409 já na primeira", err: new ErroDeTelegram("x", 409), falhas: 1, tipo: "conflito", declarar: true },
    { nome: "401 já na primeira", err: new ErroDeTelegram("x", 401), falhas: 1, tipo: "credencial", declarar: true },
    { nome: "404 já na primeira", err: new ErroDeTelegram("x", 404), falhas: 1, tipo: "credencial", declarar: true },
    { nome: "400 já na primeira", err: new ErroDeTelegram("x", 400), falhas: 1, tipo: "outro", declarar: true },
    { nome: "erro que não é do Telegram", err: new TypeError("bug"), falhas: 1, tipo: "outro", declarar: true },
  ];
  for (const c of casos) {
    it(`quando declarar queda: ${c.nome}`, () => {
      assert.equal(tipoDaFalha(c.err), c.tipo);
      assert.equal(declararQueda(c.tipo, c.falhas), c.declarar);
      assert.equal(esperaDepoisDe(c.err, c.falhas).declarar, c.declarar);
    });
  }
  it(`FALHAS_PARA_DECLARAR é ${FALHAS_PARA_DECLARAR}`, () => assert.equal(FALHAS_PARA_DECLARAR, 2));

  /** Roda o laço contra um `buscar` roteirizado até entregar o update 5; devolve logs e esperas. */
  async function laco(roteiro: (Error | unknown[])[]) {
    const logs: string[] = [];
    const avisos: string[] = [];
    const esperas: number[] = [];
    const pedidos: (number | null)[] = [];
    const recebidos: number[] = [];
    let parar = () => {};
    let acabou = false;
    const p = criarPollingDoTelegram({
      buscar: async (o) => {
        pedidos.push(o);
        const passo = roteiro.shift();
        // Roteiro no fim: para o laço por dentro (tudo aqui resolve em
        // microtarefa, e um laço sem fim não deixaria o teste respirar).
        if (roteiro.length === 0) { parar(); acabou = true; }
        if (passo instanceof Error) throw passo;
        return (passo ?? []) as unknown[];
      },
      receber: (u) => { recebidos.push((u as any).update_id); },
      lerOffset: async () => 5, gravarOffset: async () => {},
      esperar: async (ms) => { esperas.push(ms); },
      log: { log: (m: unknown) => logs.push(String(m)), error: (m: unknown) => avisos.push(String(m)) },
    });
    parar = p.iniciar();
    for (let i = 0; i < 50 && !acabou; i++) await flush();
    await flush();
    return { logs, avisos, esperas, pedidos, recebidos };
  }
  const reset = () => new ErroDeTelegram("Telegram inacessível em getUpdates (ECONNRESET).", null);

  it("soluço de uma tentativa: nem 'inacessível' nem 'voltou', só a linha do soluço, e o offset se mantém", async () => {
    const r = await laco([reset(), [mensagem(5, "a")], []]);
    assert.deepEqual(r.avisos, []);
    assert.equal(r.logs.length, 1);
    assert.match(r.logs[0], /soluço de rede em getUpdates \(ECONNRESET\), nova tentativa em 1 s/);
    assert.doesNotMatch(r.logs[0], /inacessível/, "o grep das quedas não conta o soluço");
    assert.deepEqual(r.esperas, [ESPERA_SOLUCO_MS]);
    assert.deepEqual(r.pedidos.slice(0, 3), [5, 5, 6], "a falha pede o mesmo offset: nada perdido nem repetido");
    assert.deepEqual(r.recebidos, [5]);
  });

  it("queda real: duas falhas seguidas logam 'inacessível' uma vez e 'voltou' na volta, com backoff", async () => {
    const r = await laco([reset(), reset(), reset(), [mensagem(5, "a")], []]);
    assert.deepEqual(r.avisos, ["[telegram] polling: Telegram inacessível em getUpdates (ECONNRESET).", "[telegram] polling voltou a funcionar"]);
    assert.deepEqual(r.esperas, [ESPERA_SOLUCO_MS, 5_000, 10_000]);
    assert.deepEqual(r.pedidos.slice(0, 4), [5, 5, 5, 5]);
    assert.deepEqual(r.recebidos, [5]);
  });
});
