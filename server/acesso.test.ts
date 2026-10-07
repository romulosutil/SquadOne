import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identidadeAceita, listaDePermitidos, origemAceita } from "./acesso.ts";

describe("Porteiro de IP", () => {
  it("aceita IP exato e as faixas da tailnet (Tailscale Serve na frente da Central)", () => {
    const permitido = listaDePermitidos(["127.0.0.1", "::1", "100.64.0.0/10", "fd7a:115c:a1e0::/48"]);
    assert.equal(permitido("127.0.0.1"), true);
    assert.equal(permitido("100.95.237.32"), true);
    assert.equal(permitido("100.128.0.1"), false, "fora de 100.64.0.0/10");
    assert.equal(permitido("fd7a:115c:a1e0::1234:5678"), true);
    assert.equal(permitido("fd7a:115c:a1e1::1"), false);
    assert.equal(permitido("203.0.113.9"), false);
    assert.equal(permitido(""), false);
  });

  it("item ilegível derruba o boot em vez de abrir o porteiro", () => {
    assert.throws(() => listaDePermitidos(["100.64.0.0/33"]), /prefixo/);
    assert.throws(() => listaDePermitidos(["casa"]), /nao e IP/);
  });
});

describe("identidade do Tailscale (RULES 7)", () => {
  const logins = ["dono@exemplo.com"];
  const casos: [string, Record<string, string>, readonly string[], boolean][] = [
    ["local direto passa sem header", {}, logins, true],
    ["pelo Serve com o login da lista", { "x-forwarded-for": "100.100.1.2", "tailscale-user-login": "Dono@Exemplo.com" }, logins, true],
    ["pelo Serve com outro login", { "x-forwarded-for": "100.100.1.2", "tailscale-user-login": "outro@exemplo.com" }, logins, false],
    ["pelo Serve sem login (nó com tag)", { "x-forwarded-for": "100.100.1.2" }, logins, false],
    ["lista vazia fecha quem vem pelo Serve", { "x-forwarded-for": "100.100.1.2", "tailscale-user-login": "dono@exemplo.com" }, [], false],
  ];
  for (const [nome, headers, lista, esperado] of casos) {
    it(nome, () => assert.equal(identidadeAceita(headers, lista), esperado));
  }
});

describe("mesma origem nas escritas (RULES 7)", () => {
  const casos: [string, Record<string, string>, boolean][] = [
    ["Sec-Fetch-Site same-origin", { "sec-fetch-site": "same-origin", "x-forwarded-for": "100.1.1.1" }, true],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site", origin: "https://mal.exemplo" }, false],
    ["Sec-Fetch-Site same-site também recusa", { "sec-fetch-site": "same-site" }, false],
    ["sem Sec-Fetch-Site, Origin do mesmo host", { origin: "https://dell.ts.net:8443", host: "dell.ts.net:8443" }, true],
    ["sem Sec-Fetch-Site, Origin de outro host", { origin: "https://mal.exemplo", host: "dell.ts.net:8443" }, false],
    ["Origin ilegível", { origin: "null", host: "dell.ts.net:8443" }, false],
    ["sem os dois, local direto", {}, true],
    ["sem os dois, pelo Serve", { "x-forwarded-for": "100.1.1.1" }, false],
  ];
  for (const [nome, headers, esperado] of casos) {
    it(nome, () => assert.equal(origemAceita(headers), esperado));
  }
});
