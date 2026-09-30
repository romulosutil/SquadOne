import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listaDePermitidos } from "./acesso.ts";

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
