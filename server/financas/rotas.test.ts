import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { GoogleGenAI } from "@google/genai";
import express from "express";
import { lerLoginsPermitidos } from "../acesso.ts";
import { ModeloOcupado } from "../orchestrator.ts";
import { abrirBanco, type BancoDeFinancas } from "./banco.ts";
import { promptDaExplicacao } from "./explicacao.ts";
import { criarRotasDeFinancas } from "./rotas.ts";
import { reprocessar } from "./sync.ts";
import { conta, tx } from "./teste-apoio.ts";

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

// "Explicar este mês" (fase 8d) com o SQLite num diretório temporário e um
// dublê do Gemini que guarda o que recebeu: o texto enviado tem de ser,
// byte a byte, o da prévia.
describe("rotas de finanças: explicar este mês", () => {
  const ESCRITA = { host: "127.0.0.1:9120", origin: "http://127.0.0.1:9120", "content-type": "application/json" };
  const AGORA = new Date("2026-10-20T15:00:00Z");
  const PEDIDO = { mes: "2026-10", visao: "competencia", comValores: false, comEstabelecimentos: false };

  let dir: string;
  let banco: BancoDeFinancas;
  const servidores: http.Server[] = [];
  let portaLigada = 0;
  let portaDesligada = 0;
  /** O que o dublê recebeu em cada chamada. */
  const chamadas: { contents: unknown; systemInstruction: unknown; tools: unknown }[] = [];
  let resposta: () => Promise<{ text: string }> = async () => ({ text: "Mercado subiu 25%." });

  const dubleDoGemini = {
    models: {
      generateContent: async (params: { contents: unknown; config?: { systemInstruction?: unknown; tools?: unknown } }) => {
        chamadas.push({ contents: params.contents, systemInstruction: params.config?.systemInstruction, tools: params.config?.tools });
        return resposta();
      },
    },
  } as unknown as GoogleGenAI;

  function pedirJson(porta: number, caminho: string, corpo: unknown) {
    return new Promise<{ status: number; corpo: any }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: porta, path: `/api/financas${caminho}`, method: "POST", headers: ESCRITA }, (res) => {
        let texto = "";
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: texto ? JSON.parse(texto) : null }));
      });
      req.on("error", reject);
      req.write(JSON.stringify(corpo));
      req.end();
    });
  }

  async function subir(env: NodeJS.ProcessEnv): Promise<number> {
    const app = express();
    const estado = { banco, sincronizador: null, avisador: null, problema: null };
    app.use("/api/financas", criarRotasDeFinancas(estado, { logins: new Set(), agora: () => AGORA, env, ai: dubleDoGemini }));
    const s = http.createServer(app);
    servidores.push(s);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    return (s.address() as AddressInfo).port;
  }

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "financas-explicar-"));
    banco = await abrirBanco(dir);
    banco.gravarLeitura({
      conexao: { itemId: "item", nome: "Banco Teste", status: "UPDATED", executionStatus: "SUCCESS", dadosAte: "2026-10-20T09:00:00Z", consentimentoAte: null, lidoEm: null, erroLeitura: null },
      contas: [conta("cc", "corrente", { saldoCentavos: 300_000 })],
      faturas: [],
      transacoes: [
        tx("cc", "2026-10-05", -20_000, "SUPERMERCADO EXEMPLO", { id: "pluggy:m1", chaveDedupe: "pluggy:m1" }),
        tx("cc", "2026-10-06", -4_590, "FARMACIA EXEMPLO", { id: "pluggy:f1", chaveDedupe: "pluggy:f1" }),
        tx("cc", "2026-09-06", -10_000, "SUPERMERCADO EXEMPLO", { id: "pluggy:m0", chaveDedupe: "pluggy:m0" }),
      ],
      removerTransacoes: [],
    });
    reprocessar(banco);
    portaLigada = await subir({ SQUADONE_FINANCAS_IA: "true" });
    portaDesligada = await subir({});
  });

  after(() => {
    for (const s of servidores) s.close();
    banco.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sem a flag: 404 que diz que está desligada, e a situação diz explicacaoIa false", async () => {
    for (const caminho of ["/explicar/previa", "/explicar"]) {
      const r = await pedirJson(portaDesligada, caminho, { ...PEDIDO, hash: "x" });
      assert.equal(r.status, 404);
      assert.match(r.corpo.error, /Explicação com IA desligada/);
    }
    const visao = await new Promise<any>((resolve) =>
      http.get({ host: "127.0.0.1", port: portaDesligada, path: "/api/financas/visao", headers: { host: "127.0.0.1:9120" } }, (res) => {
        let t = "";
        res.on("data", (c) => (t += c));
        res.on("end", () => resolve(JSON.parse(t)));
      }),
    );
    assert.equal(visao.explicacaoIa, false);
    assert.equal(chamadas.length, 0);
  });

  it("a prévia não chama o modelo e, no padrão, não tem R$ nem estabelecimento", async () => {
    const r = await pedirJson(portaLigada, "/explicar/previa", PEDIDO);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(r.corpo.hash, /^[0-9a-f]{16}$/);
    assert.equal(r.corpo.caracteres, r.corpo.pacote.length);
    assert.doesNotMatch(r.corpo.pacote, /R\s*\$/);
    assert.ok(!r.corpo.pacote.includes("FARMACIA") && !r.corpo.pacote.includes("SUPERMERCADO"));
    assert.equal(chamadas.length, 0);
  });

  it("os toggles mudam o texto e o hash", async () => {
    const padrao = await pedirJson(portaLigada, "/explicar/previa", PEDIDO);
    const tudo = await pedirJson(portaLigada, "/explicar/previa", { ...PEDIDO, comValores: true, comEstabelecimentos: true });
    assert.notEqual(padrao.corpo.hash, tudo.corpo.hash);
    assert.match(tudo.corpo.pacote, /R\$/);
    assert.ok(tudo.corpo.pacote.includes("FARMACIA EXEMPLO"));
  });

  it("pedido malformado é 400", async () => {
    assert.equal((await pedirJson(portaLigada, "/explicar/previa", { ...PEDIDO, mes: "outubro" })).status, 400);
    assert.equal((await pedirJson(portaLigada, "/explicar/previa", { ...PEDIDO, visao: "outra" })).status, 400);
  });

  it("hash errado (ou de outro toggle) é 409 previaDesatualizada, sem chamar o modelo", async () => {
    const previa = await pedirJson(portaLigada, "/explicar/previa", PEDIDO);
    const errado = await pedirJson(portaLigada, "/explicar", { ...PEDIDO, hash: "0000000000000000" });
    assert.equal(errado.status, 409);
    assert.equal(errado.corpo.previaDesatualizada, true);
    const outroToggle = await pedirJson(portaLigada, "/explicar", { ...PEDIDO, comValores: true, hash: previa.corpo.hash });
    assert.equal(outroToggle.status, 409);
    assert.equal((await pedirJson(portaLigada, "/explicar", PEDIDO)).status, 409);
    assert.equal(chamadas.length, 0);
  });

  it("hash certo: uma chamada com o MESMO texto da prévia e o prompt fixo, sem ferramentas", async () => {
    const previa = await pedirJson(portaLigada, "/explicar/previa", { ...PEDIDO, comEstabelecimentos: true });
    const r = await pedirJson(portaLigada, "/explicar", { ...PEDIDO, comEstabelecimentos: true, hash: previa.corpo.hash });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo, { explicacao: "Mercado subiu 25%." });
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].contents, previa.corpo.pacote);
    assert.equal(chamadas[0].systemInstruction, promptDaExplicacao());
    assert.equal(chamadas[0].tools, undefined);
  });

  it("a resposta é cortada em 4000 caracteres", async () => {
    resposta = async () => ({ text: "a".repeat(5000) });
    try {
      const previa = await pedirJson(portaLigada, "/explicar/previa", PEDIDO);
      const r = await pedirJson(portaLigada, "/explicar", { ...PEDIDO, hash: previa.corpo.hash });
      assert.equal(r.status, 200);
      assert.equal(r.corpo.explicacao.length, 4000);
    } finally {
      resposta = async () => ({ text: "Mercado subiu 25%." });
    }
  });

  it("ModeloOcupado vira 503 modeloOcupado", async () => {
    resposta = async () => {
      throw new ModeloOcupado("Os modelos do Gemini estão sobrecarregados agora.");
    };
    try {
      const previa = await pedirJson(portaLigada, "/explicar/previa", PEDIDO);
      const r = await pedirJson(portaLigada, "/explicar", { ...PEDIDO, hash: previa.corpo.hash });
      assert.equal(r.status, 503);
      assert.equal(r.corpo.modeloOcupado, true);
    } finally {
      resposta = async () => ({ text: "Mercado subiu 25%." });
    }
  });
});
