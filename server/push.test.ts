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
