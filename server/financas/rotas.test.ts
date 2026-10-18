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
    // O selo de saúde diz de qual conta é a conexão (AC-26), pelo itemId que o banco guardou.
    assert.deepEqual(visao.saude.conexoes.map((c: any) => c.contas), [["cc"]]);
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

// O cartão de gasto falado do Assistente (fase 2 da RULES 28, 17/10/2026): só grava no toque, por esta
// rota, com a guarda de mesma origem; relê a frase pela regra do Telegram; o mesmo cartão não duplica;
// o log não leva valor nem lugar (RULES 24).
describe("rotas de finanças: POST /gasto (cartão do Assistente)", () => {
  const ESCRITA = { host: "127.0.0.1:9120", origin: "http://127.0.0.1:9120", "content-type": "application/json" };
  const ORIGEM = "3f2a9c1e-77b0-4a51-9c3e-0d1f2a3b4c5d";
  let dir: string;
  let banco: BancoDeFinancas;
  let porta = 0;
  let s: http.Server;

  function postar(corpo: unknown, headers: Record<string, string> = ESCRITA) {
    return new Promise<{ status: number; corpo: any }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: porta, path: "/api/financas/gasto", method: "POST", headers }, (res) => {
        let texto = "";
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: texto ? JSON.parse(texto) : null }));
      });
      req.on("error", reject);
      req.write(JSON.stringify(corpo));
      req.end();
    });
  }

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "financas-gasto-"));
    banco = await abrirBanco(dir);
    const app = express();
    const estado = { banco, sincronizador: null, avisador: null, problema: null };
    app.use("/api/financas", criarRotasDeFinancas(estado, { logins: new Set(), agora: () => new Date("2026-10-17T15:00:00Z") }));
    s = http.createServer(app);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    porta = (s.address() as AddressInfo).port;
  });
  after(() => {
    s.close();
    banco.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sem a mesma origem não grava", async () => {
    assert.equal((await postar({ texto: "gastei 30 no mercado", origem: ORIGEM }, { host: "127.0.0.1:9120", "content-type": "application/json" })).status, 403);
    assert.equal((await postar({ texto: "gastei 30 no mercado", origem: ORIGEM }, { ...ESCRITA, origin: "https://outro.exemplo", "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal(banco.transacoes().length, 0);
  });

  it("frase que não é gasto é 400, e nada grava", async () => {
    const r = await postar({ texto: "quanto gastei esse mês?", origem: ORIGEM });
    assert.equal(r.status, 400);
    assert.equal(banco.transacoes().length, 0);
  });

  it("grava na conta manual com a categoria; o mesmo cartão de novo não duplica; o log não diz valor nem lugar", async () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
    try {
      const r = await postar({ texto: "gastei 30 no mercado", origem: ORIGEM });
      assert.equal(r.status, 200, JSON.stringify(r.corpo));
      assert.deepEqual(r.corpo, { ok: true, categoria: "Mercado", novo: true, texto: "Anotado: Mercado" });
      const de_novo = await postar({ texto: "gastei 30 no mercado", origem: ORIGEM });
      assert.equal(de_novo.corpo.novo, false);
      const outro = await postar({ texto: "gastei 30 no mercado", origem: "a1b2c3d4-0000-4000-8000-000000000001" });
      assert.equal(outro.corpo.novo, true);
    } finally {
      console.log = original;
    }
    const manuais = banco.transacoes().filter((t) => t.fonte === "manual");
    assert.equal(manuais.length, 2);
    assert.equal(manuais[0].id, `manual:painel:${ORIGEM}`);
    assert.equal(manuais[0].centavos, -3000);
    for (const l of logs.filter((l) => l.includes("[financas]"))) assert.doesNotMatch(l, /30|mercado|R\$/i);
    assert.ok(logs.some((l) => /gasto anotado pelo painel/.test(l)));
  });
});
