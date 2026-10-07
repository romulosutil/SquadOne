import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guardaDeIdentidade, guardaDeOrigem, lerLoginsPermitidos, listaDePermitidos, origemConfere, veioPeloServe } from "./acesso.ts";

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

function pedido(metodo: string, headers: Record<string, string>): any {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method: metodo, path: "/api/x", headers: h, get: (n: string) => h[n.toLowerCase()] };
}
function resposta() {
  const r: any = { statusCode: 200 };
  r.status = (n: number) => { r.statusCode = n; return r; };
  r.type = () => r;
  r.send = () => r;
  r.json = () => r;
  return r;
}
function passa(mw: (req: any, res: any, next: () => void) => void, req: any): boolean {
  let seguiu = false;
  const res = resposta();
  mw(req, res, () => { seguiu = true; });
  return seguiu && res.statusCode === 200;
}

const SERVE = { "X-Forwarded-For": "100.95.237.32", Host: "mel.tail0000.ts.net:8443" };

describe("guardaDeIdentidade (Tailscale-User-Login)", () => {
  const guarda = guardaDeIdentidade(lerLoginsPermitidos({ SQUADONE_LOGINS_TAILSCALE: " Romulo@Exemplo.com , outro@exemplo.com" }));

  it("pelo Serve com login da lista passa, sem diferenciar maiúsculas", () => {
    assert.equal(passa(guarda, pedido("GET", { ...SERVE, "Tailscale-User-Login": "romulo@exemplo.com" })), true);
  });

  it("pelo Serve sem login (nó com tag) ou com login de fora: 403, inclusive leitura", () => {
    assert.equal(passa(guarda, pedido("GET", SERVE)), false);
    assert.equal(passa(guarda, pedido("GET", { ...SERVE, "Tailscale-User-Login": "intruso@exemplo.com" })), false);
  });

  it("Funnel nunca passa, mesmo com login", () => {
    assert.equal(passa(guarda, pedido("GET", { ...SERVE, "Tailscale-User-Login": "romulo@exemplo.com", "Tailscale-Funnel-Request": "?1" })), false);
  });

  it("pedido local direto (sem headers do Serve) segue: túnel do PC, atualizar-central", () => {
    assert.equal(passa(guarda, pedido("GET", { Host: "127.0.0.1:9120" })), true);
  });

  it("lista vazia FECHA a tailnet", () => {
    const fechada = guardaDeIdentidade(lerLoginsPermitidos({}));
    assert.equal(passa(fechada, pedido("GET", { ...SERVE, "Tailscale-User-Login": "romulo@exemplo.com" })), false);
    assert.equal(passa(fechada, pedido("GET", { Host: "127.0.0.1:9120" })), true);
  });

  it("veioPeloServe", () => {
    assert.equal(veioPeloServe(pedido("GET", SERVE)), true);
    assert.equal(veioPeloServe(pedido("GET", { "Tailscale-User-Login": "a@b" })), true);
    assert.equal(veioPeloServe(pedido("GET", { Host: "127.0.0.1:9120" })), false);
  });
});

describe("origemConfere / guardaDeOrigem (escrita da mesma origem)", () => {
  it("mesma origem pela tailnet e pelo loopback passa", () => {
    assert.equal(origemConfere({ origin: "https://mel.tail0000.ts.net:8443", host: "mel.tail0000.ts.net:8443", secFetchSite: "same-origin" }), true);
    assert.equal(origemConfere({ origin: "http://127.0.0.1:9120", host: "127.0.0.1:9120" }), true);
    assert.equal(origemConfere({ origin: "https://exemplo.ts.net", host: "exemplo.ts.net:443" }), true);
  });

  const recusados: [string, Parameters<typeof origemConfere>[0]][] = [
    ["sem Origin (CSRF por formulário antigo, curl)", { host: "127.0.0.1:9120" }],
    ["outra página no celular", { origin: "https://site-qualquer.com", host: "mel.tail0000.ts.net:8443", secFetchSite: "cross-site" }],
    ["mesmo host, outra porta (o painel do Hermes na 443)", { origin: "https://mel.tail0000.ts.net", host: "mel.tail0000.ts.net:8443" }],
    ["Sec-Fetch-Site same-site", { origin: "https://mel.tail0000.ts.net:8443", host: "mel.tail0000.ts.net:8443", secFetchSite: "same-site" }],
    ["Origin null", { origin: "null", host: "127.0.0.1:9120" }],
  ];
  for (const [nome, h] of recusados) {
    it(`recusa: ${nome}`, () => assert.equal(origemConfere(h), false));
  }

  it("GET passa sem Origin (GET nunca escreve); POST, PATCH e DELETE exigem", () => {
    const guarda = guardaDeOrigem();
    assert.equal(passa(guarda, pedido("GET", SERVE)), true);
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
      assert.equal(passa(guarda, pedido(m, SERVE)), false, m);
      assert.equal(passa(guarda, pedido(m, { ...SERVE, Origin: "https://mel.tail0000.ts.net:8443", "Sec-Fetch-Site": "same-origin" })), true, m);
    }
  });
});
