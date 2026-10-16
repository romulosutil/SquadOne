import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import {
  cabecalhosDaResposta,
  cabecalhosParaAEntrada,
  criarRepasseDaEntrada,
  ENTRADA_PREFIXO,
  rotaPermitida,
} from "./entrada-proxy.ts";

interface Visto {
  metodo: string;
  caminho: string;
  cabecalhos: http.IncomingHttpHeaders;
  bytes: number;
  sha: string;
}

/** Uma Entrada de mentira: grava o que recebeu e responde como a de verdade. */
function iniciarEntradaFalsa() {
  const vistos: Visto[] = [];
  const servidor = http.createServer((req, res) => {
    const hash = createHash("sha256");
    let bytes = 0;
    req.on("data", (c: Buffer) => {
      bytes += c.length;
      hash.update(c);
    });
    req.on("end", () => {
      vistos.push({ metodo: req.method ?? "", caminho: req.url ?? "", cabecalhos: req.headers, bytes, sha: hash.digest("hex") });
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'", "cache-control": "no-store", connection: "close" });
        return void res.end("<html>Entrada</html>");
      }
      if (req.url === "/api/estado") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ pendentes: 0 }));
      if (req.url === "/api/enviar") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, bytes }));
      res.writeHead(404).end("?");
    });
  });
  return { servidor, vistos };
}

function pedir(porta: number, opcoes: http.RequestOptions, corpo?: Buffer | string): Promise<{ status: number; cabecalhos: http.IncomingHttpHeaders; corpo: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: porta, ...opcoes }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (c: Buffer) => partes.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, cabecalhos: res.headers, corpo: Buffer.concat(partes).toString() }));
    });
    req.on("error", reject);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

describe("Repasse da Entrada pela Central", () => {
  const falsa = iniciarEntradaFalsa();
  let portaCentral = 0;
  let central: http.Server;
  let portaFalsa = 0;

  before(async () => {
    await new Promise<void>((ok) => falsa.servidor.listen(0, "127.0.0.1", ok));
    portaFalsa = (falsa.servidor.address() as AddressInfo).port;
    const app = express();
    app.use(ENTRADA_PREFIXO, criarRepasseDaEntrada({ host: "127.0.0.1", porta: portaFalsa }));
    app.use(express.json());                                    // como no server.ts: DEPOIS do repasse
    app.get("/api/runtime", (_req, res) => res.json({ da: "central" }));
    app.use((_req, res) => res.status(200).send("spa"));
    central = http.createServer(app);
    await new Promise<void>((ok) => central.listen(0, "127.0.0.1", ok));
    portaCentral = (central.address() as AddressInfo).port;
  });

  after(async () => {
    central.closeAllConnections();
    falsa.servidor.closeAllConnections();
    await new Promise((ok) => central.close(ok));
    await new Promise((ok) => falsa.servidor.close(ok));
  });

  it("a lista de rotas é fechada", () => {
    assert.equal(rotaPermitida("GET", "/"), "ok");
    assert.equal(rotaPermitida("GET", "/api/estado"), "ok");
    assert.equal(rotaPermitida("POST", "/api/enviar"), "ok");
    assert.equal(rotaPermitida("GET", "/inter.woff2"), "ok");
    assert.equal(rotaPermitida("POST", "/inter.woff2"), "metodo");
    assert.equal(rotaPermitida("GET", "/api/enviar"), "metodo");
    assert.equal(rotaPermitida("POST", "/"), "metodo");
    for (const c of ["/healthz", "/../x", "/api", "/api/estado/", "//", "/api/outra", ""]) assert.equal(rotaPermitida("GET", c), "nao", c);
  });

  it("a página abre em /entrada/ com os cabeçalhos de segurança da própria Entrada", async () => {
    const r = await pedir(portaCentral, { path: "/entrada/", headers: { host: "127.0.0.1:9120" } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo, "<html>Entrada</html>");
    assert.equal(r.cabecalhos["content-security-policy"], "default-src 'none'");
    assert.equal(r.cabecalhos["cache-control"], "no-store");
    const v = falsa.vistos.at(-1)!;
    assert.equal(v.caminho, "/");
    assert.equal(v.cabecalhos.host, "127.0.0.1:9120", "o Host original segue (a Entrada confere o nome)");
  });

  it("/entrada sem a barra final redireciona (senão as URLs relativas cairiam na API da Central)", async () => {
    const r = await pedir(portaCentral, { path: "/entrada" });
    assert.equal(r.status, 301);
    assert.equal(r.cabecalhos.location, "/entrada/");
    const r2 = await pedir(portaCentral, { path: "/entrada?x=1" });
    assert.equal(r2.status, 301);
  });

  it("repassa o envio em fluxo, byte a byte, com os cabeçalhos da Entrada", async () => {
    const corpo = Buffer.alloc(5 * 1024 * 1024, "abc123");
    const esperado = createHash("sha256").update(corpo).digest("hex");
    const r = await pedir(portaCentral, {
      path: "/entrada/api/enviar", method: "POST",
      headers: {
        host: "mel.tail1.ts.net:8443", origin: "https://mel.tail1.ts.net:8443", "content-length": String(corpo.length),
        "content-type": "application/octet-stream", "x-acao": "organizar", "x-rotulo": "nota%20boa", "x-nome": "a.txt",
        "x-com-cofre": "1", "sec-fetch-site": "same-origin", "x-forwarded-for": "100.95.237.32",
      },
    }, corpo);
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.corpo), { ok: true, bytes: corpo.length });
    const v = falsa.vistos.at(-1)!;
    assert.equal(v.metodo, "POST");
    assert.equal(v.caminho, "/api/enviar");
    assert.equal(v.sha, esperado, "os bytes chegam intactos");
    for (const [k, valor] of Object.entries({ "x-acao": "organizar", "x-rotulo": "nota%20boa", "x-nome": "a.txt", "x-com-cofre": "1",
      origin: "https://mel.tail1.ts.net:8443", "sec-fetch-site": "same-origin", "x-forwarded-for": "100.95.237.32" })) {
      assert.equal(v.cabecalhos[k], valor, k);
    }
  });

  it("Cookie, Authorization e cabeçalhos desconhecidos não seguem", async () => {
    await pedir(portaCentral, {
      path: "/entrada/api/estado",
      headers: { cookie: "sessao=segredo", authorization: "Bearer abc", "x-qualquer": "1", "x-api-key": "k", "proxy-authorization": "p", "x-acao": "guardar" },
    });
    const v = falsa.vistos.at(-1)!;
    for (const k of ["cookie", "authorization", "x-qualquer", "x-api-key", "proxy-authorization"]) assert.equal(v.cabecalhos[k], undefined, k);
    assert.equal(v.cabecalhos["x-acao"], "guardar");
  });

  it("a query não segue", async () => {
    await pedir(portaCentral, { path: "/entrada/api/estado?token=SEGREDO-NA-QUERY" });
    assert.equal(falsa.vistos.at(-1)!.caminho, "/api/estado");
  });

  it("rota fora da lista é 404 e método errado é 405, sem chegar à Entrada", async () => {
    const antes = falsa.vistos.length;
    for (const [metodo, caminho, status] of [["GET", "/entrada/healthz", 404], ["GET", "/entrada/../api/runtime", 404], ["GET", "/entrada/api/enviar", 405],
      ["PUT", "/entrada/", 405], ["DELETE", "/entrada/api/estado", 405], ["POST", "/entrada/", 405], ["GET", "/entrada/api/outra", 404]] as const) {
      const r = await pedir(portaCentral, { path: caminho, method: metodo, headers: metodo === "GET" ? {} : { "content-length": "0" } });
      assert.equal(r.status, status, `${metodo} ${caminho}`);
    }
    assert.equal(falsa.vistos.length, antes, "nada disso chegou à Entrada");
  });

  it("POST sem Content-Length ou com Transfer-Encoding é recusado aqui", async () => {
    const antes = falsa.vistos.length;
    const r = await pedir(portaCentral, { path: "/entrada/api/enviar", method: "POST", headers: { "transfer-encoding": "chunked" } }, "oi");
    assert.equal(r.status, 501);
    assert.equal(falsa.vistos.length, antes);
  });

  it("GET com corpo é recusado aqui (senão contrabandearia um segundo pedido)", async () => {
    const antes = falsa.vistos.length;
    const comLength = await pedir(portaCentral, { path: "/entrada/api/estado", method: "GET", headers: { "content-length": "5" } }, "12345");
    assert.equal(comLength.status, 400);
    const emPartes = await pedir(portaCentral, { path: "/entrada/", method: "GET", headers: { "transfer-encoding": "chunked" } }, "oi");
    assert.equal(emPartes.status, 400);
    assert.equal(falsa.vistos.length, antes, "nada disso chegou à Entrada");
    const normal = await pedir(portaCentral, { path: "/entrada/api/estado", headers: { "content-length": "0" } });
    assert.equal(normal.status, 200, "GET com Content-Length: 0 continua valendo");
  });

  it("bytes além do Content-Length não viram parte do envio (viram outro pedido, que cai na regra de rotas)", async () => {
    const antes = falsa.vistos.length;
    const bruto = await new Promise<string>((resolve, reject) => {
      const s = net.connect(portaCentral, "127.0.0.1", () => {
        s.write("POST /entrada/api/enviar HTTP/1.1\r\nHost: 127.0.0.1:9120\r\nContent-Length: 3\r\nX-Acao: guardar\r\n\r\nabc"
          + "GET /api/runtime HTTP/1.1\r\nHost: 127.0.0.1:9120\r\nConnection: close\r\n\r\n");
      });
      const partes: Buffer[] = [];
      s.on("data", (c) => partes.push(c));
      s.on("end", () => resolve(Buffer.concat(partes).toString()));
      s.on("error", reject);
    });
    const novos = falsa.vistos.slice(antes);
    assert.equal(novos.length, 1, "só o POST chegou à Entrada");
    assert.equal(novos[0].bytes, 3, "a Entrada recebeu exatamente 3 bytes");
    assert.equal(novos[0].sha, createHash("sha256").update("abc").digest("hex"));
    assert.match(bruto, /"da":"central"/, "o segundo pedido foi atendido pela Central, e não pela Entrada");
  });

  it("a API da própria Central continua respondendo (o repasse não a engole)", async () => {
    const r = await pedir(portaCentral, { path: "/api/runtime" });
    assert.deepEqual(JSON.parse(r.corpo), { da: "central" });
    const spa = await pedir(portaCentral, { path: "/crm" });
    assert.equal(spa.corpo, "spa");
  });

  it("Entrada desligada: 502 genérico, sem detalhe de erro", async () => {
    const app = express();
    app.use(ENTRADA_PREFIXO, criarRepasseDaEntrada({ host: "127.0.0.1", porta: 1 }));      // nada escuta na porta 1
    const s = http.createServer(app);
    await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
    try {
      const r = await pedir((s.address() as AddressInfo).port, { path: "/entrada/api/estado" });
      assert.equal(r.status, 502);
      const j = JSON.parse(r.corpo);
      assert.equal(j.ok, false);
      assert.doesNotMatch(r.corpo, /ECONNREFUSED|127\.0\.0\.1|port/i);
    } finally {
      s.closeAllConnections();
      await new Promise((ok) => s.close(ok));
    }
  });

  it("filtros de cabeçalho", () => {
    const entra = cabecalhosParaAEntrada({ host: "h", cookie: "c", "x-acao": "cofre", authorization: "a", "content-length": "3" });
    assert.deepEqual(Object.keys(entra).sort(), ["content-length", "host", "x-acao"]);
    const volta = cabecalhosDaResposta({ "content-type": "text/html", connection: "close", "transfer-encoding": "chunked", "keep-alive": "x", "cache-control": "no-store" });
    assert.deepEqual(Object.keys(volta).sort(), ["cache-control", "content-type"]);
  });
});
