/**
 * Transporte do Jev: o corpo (questions é objeto, provider sempre com
 * data_collection deny e ZDR), a máscara, a validação da resposta (dado, nunca
 * instrução), a classificação dos erros e a config. `fetch` é dublê: nada vai
 * à rede, e a "chave" daqui é inventada.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classificarErro,
  criarClienteDoJev,
  descreverJev,
  ErroDeJev,
  JevMalConfigurado,
  lerConfigDoJev,
  mascararParaJev,
  montarPedido,
  MODELO_JEV_PADRAO,
  URL_DECISOES,
  validarResposta,
  type Logger,
  type Perguntas,
} from "./openrouter-decisoes.ts";

// Inventada para o teste; tem a forma de uma chave para as travas valerem.
const CHAVE = "sk-or-v1-chave-de-mentira-0123456789abcdefABCDEF";
const silencio = { log() {}, warn() {}, error() {} };

const PERGUNTAS: Perguntas = {
  squad: { type: "choice", instructions: "Qual squad cuida?", criteria: { pessoal: "Pessoal: vida pessoal", prumo: "PRUMO: sites" } },
  pede_contratacao: { type: "noul", instructions: "Pede contratação?", criteria: { true: "sim", false: "não" } },
};

const RESPOSTA_OK = {
  model: "typesafe/jev-1.13-20260917",
  answers: {
    squad: { type: "choice", choice: "prumo", probabilities: { pessoal: 0.08, prumo: 0.92 }, confidence: 0.9 },
    pede_contratacao: { type: "noul", noul: 0.03 },
  },
  usage: { input_tokens: 210, output_tokens: 4, cost: 0.000021 },
  id: "gen-123",
  provider: "TypeSafe",
};

interface Chamada {
  url: string;
  init: RequestInit;
}

function fetchDuble(respostas: (Response | Error | "pendurar")[]) {
  const chamadas: Chamada[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const r = respostas.shift() ?? new Response(JSON.stringify(RESPOSTA_OK), { status: 200 });
    if (r === "pendurar") {
      return new Promise((_, rejeitar) => {
        init.signal?.addEventListener("abort", () => rejeitar(new DOMException(`aborted ${CHAVE}`, "AbortError")));
      });
    }
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fn, chamadas };
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe("montarPedido", () => {
  it("questions é objeto indexado pelo nome, nunca array; provider com deny e ZDR", () => {
    const p = montarPedido(MODELO_JEV_PADRAO, "reunião amanhã", PERGUNTAS);
    assert.equal(Array.isArray(p.questions), false);
    assert.deepEqual(Object.keys(p.questions), ["squad", "pede_contratacao"]);
    assert.deepEqual(p.provider, { data_collection: "deny", zdr: true });
    assert.equal(p.model, "typesafe/jev-1.13");
  });
  it("zdr:false tira só o zdr; o deny fica", () => {
    assert.deepEqual(montarPedido("a/b", "x", PERGUNTAS, { zdr: false }).provider, { data_collection: "deny" });
  });
  it("mascara o state e as descrições, não os rótulos", () => {
    const p = montarPedido("a/b", "ligar para (11) 98765-4321", {
      squad: { type: "choice", instructions: "Qual?", criteria: { pessoal: "contato joao@x.com", prumo: "sites" } },
    });
    assert.equal(p.state, "ligar para [TEL]");
    assert.deepEqual(Object.keys((p.questions.squad as any).criteria), ["pessoal", "prumo"]);
    assert.equal((p.questions.squad as any).criteria.pessoal, "contato [EMAIL]");
  });
  it("a ordem dos rótulos é a de inserção", () => {
    const p = montarPedido("a/b", "x", { q: { type: "choice", instructions: "?", criteria: { zeta: "z", alfa: "a", meio: "m" } } });
    assert.deepEqual(Object.keys((p.questions.q as any).criteria), ["zeta", "alfa", "meio"]);
  });
  const ruins: [string, unknown][] = [
    ["array", [PERGUNTAS.squad]],
    ["vazio", {}],
    ["choice com 1 rótulo", { q: { type: "choice", instructions: "?", criteria: { a: "a" } } }],
    ["noul sem false", { q: { type: "noul", instructions: "?", criteria: { true: "s" } } }],
    ["score (não testado no Jev)", { q: { type: "score", instructions: "?", criteria: ["baixo", "alto"] } }],
    ["nome com espaço", { "a b": PERGUNTAS.pede_contratacao }],
  ];
  for (const [nome, perguntas] of ruins) {
    it(`recusa ${nome}`, () => assert.throws(() => montarPedido("a/b", "x", perguntas as Perguntas)));
  }
});

describe("mascararParaJev", () => {
  const casos: [string, string, string][] = [
    ["celular com DDD entre parênteses", "ligar (11) 98765-4321 hoje", "ligar [TEL] hoje"],
    ["celular com +55", "whats +55 11 98765-4321", "whats [TEL]"],
    ["celular +55 colado", "5511987654321", "[TEL]"],
    ["celular cru com DDD", "11987654321", "[TEL]"],
    ["fixo com DDD", "fone 11 3456-7890", "fone [TEL]"],
    ["fixo com DDD colado", "1134567890", "[TEL]"],
    ["celular sem DDD", "liga 98765-4321", "liga [TEL]"],
    ["fixo sem DDD", "ramal 3456-7890", "ramal [TEL]"],
    ["faixa de anos não é telefone", "planejamento 2026-2027", "planejamento 2026-2027"],
    ["data e hora ficam", "dia 11/10/2026 às 14:30 por 45 min", "dia 11/10/2026 às 14:30 por 45 min"],
    ["e-mail", "mandar para Ana.Souza+x@empresa.com.br", "mandar para [EMAIL]"],
    ["CPF formatado", "CPF 123.456.789-09", "CPF [DOC]"],
    ["CPF cru com dígito válido", "cpf 52998224725", "cpf [DOC]"],
    ["CNPJ formatado", "CNPJ 12.345.678/0001-95", "CNPJ [DOC]"],
    ["CNPJ cru", "12345678000195", "[DOC]"],
    ["URL com caminho", "ver https://exemplo.com/lead/123?x=1 depois", "ver [URL] depois"],
    ["URL só com host fica", "site https://exemplo.com.br", "site https://exemplo.com.br"],
    ["www com caminho", "www.exemplo.com/abc/9", "[URL]"],
    ["chave sk-", "a chave é sk-or-v1-abcdef123456", "a chave é [SEGREDO]"],
    ["chave do Google", "AIzaSyA1234567890abcdefghijklmnop", "[SEGREDO]"],
    ["token do GitHub", "ghp_abcdefghijklmnopqrstuvwxyz0123", "[SEGREDO]"],
    ["Bearer", "Authorization: Bearer abc.def-123", "Authorization: [SEGREDO]"],
    ["senha:", "a senha: hunter2 do wifi", "a senha: [SEGREDO] do wifi"],
    ["hex longo", "hash 0123456789abcdef0123456789abcdef01", "hash [SEGREDO]"],
    ["texto comum fica", "revisar o contrato da Pay4Fun amanhã de manhã", "revisar o contrato da Pay4Fun amanhã de manhã"],
  ];
  for (const [nome, entrada, esperado] of casos) {
    it(nome, () => assert.equal(mascararParaJev(entrada), esperado));
  }
});

describe("validarResposta (a resposta é dado)", () => {
  it("200 válido vira resposta tipada", () => {
    const r = validarResposta(RESPOSTA_OK, PERGUNTAS);
    assert.equal(r.modelo, "typesafe/jev-1.13-20260917");
    assert.deepEqual(r.respostas.squad, { type: "choice", choice: "prumo", probabilities: { pessoal: 0.08, prumo: 0.92 }, confidence: 0.9 });
    assert.deepEqual(r.respostas.pede_contratacao, { type: "noul", noul: 0.03 });
    assert.deepEqual(r.usage, { input_tokens: 210, output_tokens: 4, cost: 0.000021 });
    assert.equal(r.provedor, "TypeSafe");
  });
  const muda = (f: (c: any) => void) => {
    const c = structuredClone(RESPOSTA_OK) as any;
    f(c);
    return c;
  };
  const ruins: [string, unknown][] = [
    ["choice fora dos rótulos", muda((c) => (c.answers.squad.choice = "pay4fun"))],
    ["probabilidade de rótulo não enviado", muda((c) => (c.answers.squad.probabilities.pay4fun = 0.1))],
    ["probabilidade > 1", muda((c) => (c.answers.squad.probabilities.prumo = 1.2))],
    ["noul negativo", muda((c) => (c.answers.pede_contratacao.noul = -0.1))],
    ["noul texto", muda((c) => (c.answers.pede_contratacao.noul = "0.5"))],
    ["sem usage", muda((c) => delete c.usage)],
    ["usage.cost texto", muda((c) => (c.usage.cost = "0.00002"))],
    ["model sem data", muda((c) => (c.model = "typesafe/jev-1.13"))],
    ["pergunta sem resposta", muda((c) => delete c.answers.pede_contratacao)],
    ["tipo trocado", muda((c) => (c.answers.pede_contratacao = { type: "choice", choice: "true", probabilities: {} }))],
    ["array", [RESPOSTA_OK]],
  ];
  for (const [nome, corpo] of ruins) {
    it(nome, () => {
      assert.throws(() => validarResposta(corpo, PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "respostaInvalida");
    });
  }
});

describe("classificarErro", () => {
  const casos: [number | null, string][] = [
    [400, "pedidoInvalido"], [413, "pedidoInvalido"], [401, "credencial"], [403, "credencial"], [402, "semCredito"],
    [429, "limite"], [500, "indisponivel"], [502, "indisponivel"], [524, "indisponivel"], [529, "indisponivel"], [null, "indisponivel"],
  ];
  for (const [status, motivo] of casos) {
    it(`${status} → ${motivo}`, () => assert.equal(classificarErro(status, {}).motivo, motivo));
  }
  it("só 401/403/402 desligam", () => {
    assert.equal(classificarErro(402, {}).desliga, true);
    assert.equal(classificarErro(401, {}).desliga, true);
    assert.equal(classificarErro(429, {}).desliga, false);
    assert.equal(classificarErro(500, {}).desliga, false);
  });
  it("a mensagem da OpenRouter entra curta e sem nada com cara de chave", () => {
    const e = classificarErro(401, { error: { message: `Invalid key sk-or-v1-abcdef0123456789 (Bearer xyz)`, code: 401 } });
    assert.ok(!e.message.includes("sk-or-v1-abcdef"));
    assert.ok(!e.message.includes("xyz"));
    assert.match(e.message, /Invalid key/);
  });
});

describe("lerConfigDoJev", () => {
  it("ausente = desligada, padrões, sem exigir a chave, ZDR ligado", () => {
    assert.deepEqual(lerConfigDoJev({}), {
      ligada: false, chave: "", modelo: "typesafe/jev-1.13", tetoDia: 50, tetoUsd: 1, timeoutMs: 5000, guardarDemanda: false, zdr: true,
    });
  });
  it("ligada lê tudo", () => {
    const c = lerConfigDoJev({
      SQUADONE_JEV_SOMBRA: "true", OPENROUTER_API_KEY: CHAVE, SQUADONE_JEV_MODELO: "typesafe/jev-1.14", SQUADONE_JEV_TETO_DIA: "20",
      SQUADONE_JEV_TETO_USD: "0.5", SQUADONE_JEV_TIMEOUT_MS: "3000", SQUADONE_JEV_GUARDAR_DEMANDA: "true", SQUADONE_JEV_ZDR: "false",
    });
    assert.deepEqual(c, { ligada: true, chave: CHAVE, modelo: "typesafe/jev-1.14", tetoDia: 20, tetoUsd: 0.5, timeoutMs: 3000, guardarDemanda: true, zdr: false });
  });
  const ruins: [string, Record<string, string>][] = [
    ["ligada sem chave", { SQUADONE_JEV_SOMBRA: "true" }],
    ["chave com espaço", { SQUADONE_JEV_SOMBRA: "true", OPENROUTER_API_KEY: "sk-or v1 abcdefghijklmnopqrst" }],
    ["teto dia zero", { SQUADONE_JEV_TETO_DIA: "0" }],
    ["teto dia texto", { SQUADONE_JEV_TETO_DIA: "cinquenta" }],
    ["teto USD com vírgula", { SQUADONE_JEV_TETO_USD: "0,5" }],
    ["teto USD zero", { SQUADONE_JEV_TETO_USD: "0" }],
    ["timeout baixo demais", { SQUADONE_JEV_TIMEOUT_MS: "10" }],
    ["modelo sem provedor", { SQUADONE_JEV_MODELO: "jev" }],
    ["ZDR ilegível", { SQUADONE_JEV_ZDR: "sim" }],
  ];
  for (const [nome, env] of ruins) {
    it(`${nome} lança JevMalConfigurado`, () => assert.throws(() => lerConfigDoJev(env), JevMalConfigurado));
  }
  it("a mensagem do erro nunca repete a chave", () => {
    const ruim = "sk-or-v1-com espaço-0123456789";
    assert.throws(() => lerConfigDoJev({ SQUADONE_JEV_SOMBRA: "true", OPENROUTER_API_KEY: ruim }), (e: Error) => !e.message.includes(ruim) && !e.message.includes("sk-or"));
  });
  it("descreverJev nunca leva a chave", () => {
    const c = lerConfigDoJev({ SQUADONE_JEV_SOMBRA: "true", OPENROUTER_API_KEY: CHAVE });
    assert.ok(!descreverJev(c).includes(CHAVE));
  });
});

describe("criarClienteDoJev (fetch dublado)", () => {
  const cliente = (respostas: (Response | Error | "pendurar")[], extra: { timeoutMs?: number; log?: Logger } = {}) => {
    const f = fetchDuble(respostas);
    const c = criarClienteDoJev({ chave: CHAVE, modelo: MODELO_JEV_PADRAO, timeoutMs: extra.timeoutMs ?? 2000, fetch: f.fn, log: extra.log ?? silencio });
    return { c, chamadas: f.chamadas };
  };

  it("200 válido: um POST no endpoint de decisões, Bearer, corpo com questions objeto e provider", async () => {
    const { c, chamadas } = cliente([json(RESPOSTA_OK)]);
    const r = await c.decidir("reunião sobre o site amanhã", PERGUNTAS);
    assert.equal(r.respostas.squad.type === "choice" && r.respostas.squad.choice, "prumo");
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, URL_DECISOES);
    assert.equal(chamadas[0].init.method, "POST");
    assert.equal((chamadas[0].init.headers as Record<string, string>).Authorization, `Bearer ${CHAVE}`);
    const corpo = JSON.parse(String(chamadas[0].init.body));
    assert.equal(Array.isArray(corpo.questions), false);
    assert.equal(typeof corpo.questions, "object");
    assert.deepEqual(corpo.provider, { data_collection: "deny", zdr: true });
    assert.equal(corpo.model, "typesafe/jev-1.13");
  });

  it("o state sai mascarado", async () => {
    const { c, chamadas } = cliente([json(RESPOSTA_OK)]);
    await c.decidir("ligar para joao@x.com no 11 98765-4321", PERGUNTAS);
    assert.equal(JSON.parse(String(chamadas[0].init.body)).state, "ligar para [EMAIL] no [TEL]");
  });

  it("choice fora dos rótulos: respostaInvalida", async () => {
    const corpo = structuredClone(RESPOSTA_OK) as any;
    corpo.answers.squad.choice = "outra";
    const { c } = cliente([json(corpo)]);
    await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "respostaInvalida");
  });

  it("corpo sem usage: respostaInvalida", async () => {
    const corpo = structuredClone(RESPOSTA_OK) as any;
    delete corpo.usage;
    const { c } = cliente([json(corpo)]);
    await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "respostaInvalida");
  });

  it("402 desliga até reiniciar: log uma vez, e as próximas nem chamam o fetch", async () => {
    const erros: string[] = [];
    const { c, chamadas } = cliente([json({ error: { message: "Insufficient credits" } }, 402)], { log: { ...silencio, error: (m: unknown) => erros.push(String(m)) } });
    await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "semCredito" && e.status === 402);
    assert.equal(c.desligado(), "semCredito");
    await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "semCredito");
    await assert.rejects(c.decidir("x", PERGUNTAS));
    assert.equal(chamadas.length, 1);
    assert.equal(erros.length, 1);
  });

  it("401 também desliga", async () => {
    const { c } = cliente([json({ error: { message: "No auth" } }, 401)]);
    await assert.rejects(c.decidir("x", PERGUNTAS));
    assert.equal(c.desligado(), "credencial");
  });

  it("429: limite, sem retry e sem desligar", async () => {
    const { c, chamadas } = cliente([json({ error: { message: "rate" } }, 429), json(RESPOSTA_OK)]);
    await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "limite");
    assert.equal(chamadas.length, 1, "nenhuma segunda tentativa dentro da mesma chamada");
    assert.equal(c.desligado(), null);
    await c.decidir("x", PERGUNTAS);
    assert.equal(chamadas.length, 2);
  });

  it("400: pedidoInvalido (contrato)", async () => {
    const { c } = cliente([json({ error: { message: "questions must be an object" } }, 400)]);
    await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "pedidoInvalido" && /object/.test(e.message));
  });

  it("timeout: aborta e vira indisponivel com status null", async () => {
    const { c } = cliente(["pendurar"], { timeoutMs: 30 });
    const inicio = Date.now();
    await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "indisponivel" && e.status === null && /timeout/.test(e.message));
    assert.ok(Date.now() - inicio < 1500);
  });

  it("rede caída: indisponivel", async () => {
    const { c } = cliente([new TypeError("fetch failed")]);
    await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "indisponivel");
  });

  it("corpo que não é JSON: respostaInvalida", async () => {
    const { c } = cliente([new Response("<html>oi</html>", { status: 200 })]);
    await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => e instanceof ErroDeJev && e.motivo === "respostaInvalida");
  });

  it("a chave nunca aparece em erro nem em log, mesmo se a rede ou a OpenRouter a ecoarem", async () => {
    const logs: string[] = [];
    const log = { log: (m: unknown) => logs.push(String(m)), warn: (m: unknown) => logs.push(String(m)), error: (m: unknown) => logs.push(String(m)) };
    const cenarios: (Response | Error | "pendurar")[][] = [
      [new TypeError(`fetch failed: Authorization: Bearer ${CHAVE}`)],
      [json({ error: { message: `bad key ${CHAVE}` } }, 401)],
      [json({ error: { message: `chave ${CHAVE.replace("sk-", "")}` } }, 400)],
      [new Response(`erro ${CHAVE}`, { status: 500 })],
      ["pendurar"],
    ];
    for (const respostas of cenarios) {
      const { c } = cliente(respostas, { timeoutMs: 30, log });
      await assert.rejects(c.decidir("x", PERGUNTAS), (e: unknown) => {
        assert.ok(e instanceof ErroDeJev);
        assert.ok(!e.message.includes(CHAVE), e.message);
        assert.ok(!e.message.includes(CHAVE.replace("sk-", "")), e.message);
        assert.ok(!(e.stack ?? "").includes(CHAVE));
        return true;
      });
    }
    assert.ok(logs.every((l) => !l.includes(CHAVE) && !l.includes(CHAVE.replace("sk-", ""))));
  });
});
