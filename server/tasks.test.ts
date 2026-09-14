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
