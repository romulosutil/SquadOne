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
