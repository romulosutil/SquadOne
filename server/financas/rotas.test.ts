import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { lerLoginsPermitidos } from "../acesso.ts";
import { criarRotasDeFinancas } from "./rotas.ts";

// As travas das finanças (RULES 7) com a lista única de logins da agenda,
// SQUADONE_LOGINS_TAILSCALE. Sem banco: quem passa pelas travas leva o 503
// de "finanças indisponíveis", e é por ele que se sabe que passou.

const SERVE = { "x-forwarded-for": "100.95.237.32", host: "mel.tail0000.ts.net:8443" };
const MESMA_ORIGEM = { origin: "https://mel.tail0000.ts.net:8443", "sec-fetch-site": "same-origin" };

function servidor(logins: string) {
  const app = express();
  const estado = { banco: null, sincronizador: null, avisador: null, problema: null };
  app.use("/api/financas", criarRotasDeFinancas(estado, { logins: lerLoginsPermitidos({ SQUADONE_LOGINS_TAILSCALE: logins }) }));
  return http.createServer(app);
}

function pedir(porta: number, metodo: string, headers: Record<string, string>): Promise<{ status: number; corpo: string; cache: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: porta, path: "/api/financas/visao", method: metodo, headers }, (res) => {
      let corpo = "";
      res.on("data", (c) => (corpo += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo, cache: res.headers["cache-control"] }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("rotas de finanças: travas com SQUADONE_LOGINS_TAILSCALE", () => {
  const comLista = servidor("Romulo@Exemplo.com");
  const semLista = servidor("");
  let portaCom = 0;
  let portaSem = 0;

  before(async () => {
    await new Promise<void>((r) => comLista.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => semLista.listen(0, "127.0.0.1", r));
    portaCom = (comLista.address() as AddressInfo).port;
    portaSem = (semLista.address() as AddressInfo).port;
  });
  after(() => {
    comLista.close();
    semLista.close();
  });

  it("lista vazia fecha pela tailnet, com configuracao e sem cache", async () => {
    const r = await pedir(portaSem, "GET", { ...SERVE, "tailscale-user-login": "romulo@exemplo.com" });
    assert.equal(r.status, 403);
    assert.match(r.corpo, /SQUADONE_LOGINS_TAILSCALE/);
    assert.equal(JSON.parse(r.corpo).configuracao, true);
    assert.equal(r.cache, "no-store");
  });

  it("lista vazia não fecha o pedido local direto", async () => {
    assert.equal((await pedir(portaSem, "GET", { host: "127.0.0.1:9120" })).status, 503);
  });

  it("pelo Serve: login da lista passa; outro, ausente ou Funnel, não", async () => {
    assert.equal((await pedir(portaCom, "GET", { ...SERVE, "tailscale-user-login": "romulo@exemplo.com" })).status, 503);
    assert.equal((await pedir(portaCom, "GET", { ...SERVE, "tailscale-user-login": "outro@exemplo.com" })).status, 403);
    assert.equal((await pedir(portaCom, "GET", SERVE)).status, 403);
    const funnel = { ...SERVE, "tailscale-user-login": "romulo@exemplo.com", "tailscale-funnel-request": "?1" };
    assert.equal((await pedir(portaCom, "GET", funnel)).status, 403);
  });

  it("escrita exige a mesma origem, até no pedido local direto", async () => {
    const login = { ...SERVE, "tailscale-user-login": "romulo@exemplo.com" };
    assert.equal((await pedir(portaCom, "POST", login)).status, 403);
    assert.equal((await pedir(portaCom, "POST", { ...login, origin: "https://outro.exemplo", "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await pedir(portaCom, "POST", { ...login, ...MESMA_ORIGEM })).status, 503);
    assert.equal((await pedir(portaCom, "POST", { host: "127.0.0.1:9120" })).status, 403);
    assert.equal((await pedir(portaCom, "POST", { host: "127.0.0.1:9120", origin: "http://127.0.0.1:9120" })).status, 503);
  });
});
