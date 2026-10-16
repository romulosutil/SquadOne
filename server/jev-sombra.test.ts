/**
 * Jev em sombra: as perguntas (ordem embaralhada e gravada, nada de finanças),
 * o resumo do Gemini, a comparação, e a cola — fila serial, teto do dia, teto
 * de gasto, JSONL 600, finanças que nem saem, falha que nunca derruba o turno —
 * com o `fetch` dublado e tudo num diretório temporário. A "chave" é inventada.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
// Só tipos: apagados na transpilação, então os módulos ainda carregam DEPOIS da env.
import type { ObservacaoDeDemanda, RegistroDoJev, LinhaDoJev, OpcaoDeRoteamento } from "./jev-sombra.ts";
import type { Roster, Squad } from "./squad.ts";

process.env.SQUADONE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-jev-dados-"));

const {
  compararComGemini,
  contarChamadasDoDia,
  criarJevSombra,
  descricaoDaOpcao,
  embaralhar,
  pareceFinancas,
  perguntasDoTurno,
  prepararJevSombra,
  resumoDoGemini,
  somarGasto,
} = await import("./jev-sombra.ts");
const { criarClienteDoJev } = await import("./openrouter-decisoes.ts");
const { diaLocal } = await import("./luna-sombra.ts");

const CHAVE = "sk-or-v1-chave-de-mentira-0123456789abcdefABCDEF";
const silencio = { log() {}, warn() {}, error() {} };
const AGORA = new Date("2026-10-11T15:00:00-03:00");

/** Sorteio fixo: repete a sequência dada. */
const sequencia = (valores: number[]) => {
  let i = 0;
  return () => valores[i++ % valores.length];
};

// --- Roster de teste ----------------------------------------------------------

const pessoa = (id: string) => ({ id, nome: id, papel: "p", escopo: "e", sprite: "s", hiredAt: "2026-01-01" });
const dominio = (id: string, nome: string, escopo: string, po: string, integrantes: string[] = [], arquivado = false) => ({
  id, nome, escopo, slot: [0, 0] as [number, number], room: "r", criadoEm: "2026-01-01", po: pessoa(po), integrantes: integrantes.map(pessoa), ...(arquivado ? { arquivado: true } : {}),
});
const squad = (id: string, nome: string, escopo: string, dominios: ReturnType<typeof dominio>[], arquivado = false): Squad => ({
  id, nome, escopo, calendarId: "primary", unlockOrder: [], dominios, ...(arquivado ? { arquivado: true } : {}),
});

const PESSOAL = squad("pessoal", "Pessoal", "vida pessoal e tudo que não pertence a outra squad", [
  dominio("po", "Geral", "o que não tem sala", "ana", ["bia"]),
  dominio("pessoal--financeiro", "Finanças", "cartão, orçamento, alertas de R$ 3.000", "fin"),
  dominio("pessoal--saude", "Saúde", "consultas, exames e treino", "dra"),
]);
const PAY4FUN = squad("pay4fun", "Pay4Fun", "trabalho na Pay4Fun: produto e reuniões", [
  dominio("pay4fun--geral", "Geral", "reuniões e entregas", "leo", ["mia"]),
  dominio("pay4fun--dados", "Dados", "relatórios e painéis", "dan"),
]);
const PRUMO = squad("prumo", "PRUMO", "sites e consultoria para pequenas empresas", [dominio("prumo--geral", "Atendimento", "contato com lead", "zeca")]);
const ARQUIVADA = squad("velha", "Velha", "não existe mais", [dominio("velha--geral", "Geral", "x", "vel")], true);
const ROSTER: Roster = { version: 3, squads: [PESSOAL, PAY4FUN, PRUMO, ARQUIVADA], idsAposentados: { pessoas: [], dominios: [] } };

const obs = (extra: Partial<ObservacaoDeDemanda> = {}): ObservacaoDeDemanda => ({
  demanda: "reunião de planejamento do produto amanhã às 10h",
  modo: "auto",
  roster: ROSTER,
  squadInicial: PESSOAL,
  squadExplicita: false,
  redirecionadoPara: "pay4fun",
  chamadas: [{ name: "agendar_evento", args: { titulo: "Planejamento", responsavel_id: "mia", tipo: "time_blocking", duracao_min: 60 } }],
  ...extra,
});

// --- Perguntas ----------------------------------------------------------------

describe("perguntasDoTurno", () => {
  const squads: OpcaoDeRoteamento[] = [
    { id: "pessoal", nome: "Pessoal", escopo: "vida pessoal" },
    { id: "pay4fun", nome: "Pay4Fun", escopo: "trabalho" },
    { id: "prumo", nome: "PRUMO", escopo: "sites" },
  ];
  const dominios: OpcaoDeRoteamento[] = [
    { id: "po", nome: "Geral", escopo: "o resto" },
    { id: "pessoal--financeiro", nome: "Finanças", escopo: "cartão e orçamento de R$ 3.000" },
  ];

  it("quatro perguntas, rótulo = id, ordem gravada igual à ordem das chaves", () => {
    const { perguntas, ordem } = perguntasDoTurno(squads, dominios, sequencia([0.1, 0.9, 0.5]));
    assert.deepEqual(Object.keys(perguntas), ["squad", "dominio", "natureza", "pede_contratacao"]);
    assert.equal(perguntas.squad.type, "choice");
    assert.equal(perguntas.pede_contratacao.type, "noul");
    for (const nome of ["squad", "dominio", "natureza"] as const) {
      const p = perguntas[nome];
      assert.ok(p.type === "choice");
      assert.deepEqual(Object.keys(p.criteria), ordem[nome]);
    }
    assert.deepEqual([...ordem.squad!].sort(), ["pay4fun", "pessoal", "prumo"]);
    assert.deepEqual([...ordem.natureza!].sort(), ["agenda", "tarefa"]);
  });

  it("a ordem muda com o sorteio (o viés da primeira opção fica medível)", () => {
    const a = perguntasDoTurno(squads, dominios, sequencia([0.99])).ordem.squad;
    const b = perguntasDoTurno(squads, dominios, sequencia([0.0])).ordem.squad;
    assert.notDeepEqual(a, b);
  });

  it("com uma squad ou um domínio só, a pergunta não entra", () => {
    const { perguntas, ordem } = perguntasDoTurno([squads[0]], [dominios[0]]);
    assert.deepEqual(Object.keys(perguntas), ["natureza", "pede_contratacao"]);
    assert.equal(ordem.squad, undefined);
  });

  it("nenhum texto financeiro nas descrições", () => {
    const { perguntas } = perguntasDoTurno(squads, dominios);
    const texto = JSON.stringify(perguntas);
    assert.ok(!texto.includes("R$"));
    assert.ok(!texto.includes("3.000"));
    assert.ok(!texto.includes("cartão"));
    assert.equal((perguntas.dominio as any).criteria["pessoal--financeiro"], "Finanças");
  });
});

describe("descricaoDaOpcao e embaralhar", () => {
  it("nome + escopo, sem valor em dinheiro, cortada", () => {
    assert.equal(descricaoDaOpcao({ id: "x", nome: "Casa", escopo: "reforma de 2 mil reais e R$ 500,00 de tinta" }), "Casa: reforma de e de tinta");
    assert.equal(descricaoDaOpcao({ id: "x", nome: "Casa", escopo: "a".repeat(1000) }).length, 400);
    assert.equal(descricaoDaOpcao({ id: "x", nome: "Casa", escopo: "" }), "Casa");
  });
  it("embaralhar é permutação e não mexe na entrada", () => {
    const entrada = [1, 2, 3, 4, 5];
    const saida = embaralhar(entrada, Math.random);
    assert.deepEqual([...saida].sort(), entrada);
    assert.deepEqual(entrada, [1, 2, 3, 4, 5]);
  });
  it("com sorteio uniforme, cada item cai em primeiro mais ou menos 1/n das vezes", () => {
    let semente = 42;
    const lcg = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const primeiros = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const p = embaralhar(["a", "b", "c"], lcg)[0];
      primeiros.set(p, (primeiros.get(p) ?? 0) + 1);
    }
    for (const n of primeiros.values()) assert.ok(n > 850 && n < 1150, String(n));
  });
});

describe("pareceFinancas", () => {
  const sim = ["gastei 30 no mercado", "paguei a fatura do cartão", "ver o saldo", "boleto da luz vence dia 10", "proposta de R$ 1.500", "orçamento do mês"];
  const nao = ["reunião com a Pay4Fun amanhã", "revisar o site da padaria", "consulta no dentista sexta", "contratar alguém para dados"];
  for (const t of sim) it(`sim: ${t}`, () => assert.equal(pareceFinancas(t), true));
  for (const t of nao) it(`não: ${t}`, () => assert.equal(pareceFinancas(t), false));
});

describe("resumoDoGemini", () => {
  const dominioDe = (id: string) => ({ ana: "po", mia: "pay4fun--geral" } as Record<string, string>)[id] ?? null;
  it("agendar_evento: agenda, tipo e domínio do responsável", () => {
    const r = resumoDoGemini([{ name: "agendar_evento", args: { responsavel_id: "mia", tipo: "deadline" } }], "pay4fun", dominioDe);
    assert.deepEqual(r, { squad: "pay4fun", dominio: "pay4fun--geral", natureza: "agenda", tipo: "deadline", crescimento: false, trocaSugerida: false });
  });
  it("só criar_tarefa: tarefa, sem tipo", () => {
    const r = resumoDoGemini([{ name: "criar_tarefa", args: { responsavel_id: "ana" } }], "pessoal", dominioDe);
    assert.equal(r.natureza, "tarefa");
    assert.equal(r.tipo, null);
    assert.equal(r.dominio, "po");
  });
  it("contratação e troca", () => {
    const r = resumoDoGemini([{ name: "contratar_integrante", args: {} }, { name: "sugerir_troca_squad", args: { squad_id: "prumo" } }], "pessoal", dominioDe);
    assert.equal(r.crescimento, true);
    assert.equal(r.trocaSugerida, true);
    assert.equal(r.natureza, null);
    assert.equal(r.dominio, null);
  });
  it("sem chamada nenhuma", () => {
    assert.deepEqual(resumoDoGemini([], "pessoal", dominioDe), { squad: "pessoal", dominio: null, natureza: null, tipo: null, crescimento: false, trocaSugerida: false });
  });
});

describe("compararComGemini", () => {
  const gemini = { squad: "pay4fun", dominio: "pay4fun--geral", natureza: "agenda" as const, tipo: "time_blocking", crescimento: false, trocaSugerida: false };
  it("concorda, discorda e não comparável", () => {
    const c = compararComGemini(
      {
        squad: { c: "pay4fun", p: 0.9 },
        dominio: { c: "pay4fun--dados", p: 0.6 },
        natureza: { c: "agenda", p: 0.97 },
        pede_contratacao: { c: "false", p: 0.04 },
      },
      gemini,
    );
    assert.equal(c.squad!.concorda, true);
    assert.equal(c.dominio!.concorda, false);
    assert.equal(c.natureza!.concorda, true);
    assert.equal(c.pede_contratacao!.concorda, true);
    assert.equal(c.pede_contratacao!.p, 0.96);
    const semDominio = compararComGemini({ dominio: { c: "x", p: 0.5 } }, { ...gemini, dominio: null });
    assert.equal(semDominio.dominio!.concorda, null);
  });
  it("troca sugerida: squad e domínio ficam não comparáveis, o resto segue", () => {
    const c = compararComGemini(
      {
        squad: { c: "pessoal", p: 0.8 },
        dominio: { c: "pay4fun--geral", p: 0.6 },
        natureza: { c: "agenda", p: 0.97 },
      },
      { ...gemini, trocaSugerida: true },
    );
    assert.equal(c.squad!.concorda, null);
    assert.equal(c.squad!.gemini, "pay4fun");
    assert.equal(c.dominio!.concorda, null);
    assert.equal(c.natureza!.concorda, true);
  });
});

// --- A cola, com o fetch dublado ------------------------------------------------

interface OpcoesDoDuble {
  /** Escolha por pergunta; ausente = o primeiro rótulo mandado. */
  escolhas?: Record<string, string>;
  status?: number[];
  cost?: number;
  demoraMs?: number;
  /** Segura a resposta até `soltar()`. */
  segurar?: boolean;
}

function jevDuble(opcoes: OpcoesDoDuble = {}) {
  const corpos: any[] = [];
  let simultaneas = 0;
  let maxSimultaneas = 0;
  let soltar: () => void = () => {};
  const solto = new Promise<void>((r) => (soltar = r));
  const fn = (async (_url: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body));
    corpos.push(corpo);
    simultaneas++;
    maxSimultaneas = Math.max(maxSimultaneas, simultaneas);
    try {
      if (opcoes.demoraMs) await new Promise((r) => setTimeout(r, opcoes.demoraMs));
      if (opcoes.segurar) await solto;
      const status = opcoes.status?.shift() ?? 200;
      if (status !== 200) return new Response(JSON.stringify({ error: { message: "falhou" } }), { status });
      const answers: Record<string, unknown> = {};
      for (const [nome, q] of Object.entries<any>(corpo.questions)) {
        if (q.type === "noul") answers[nome] = { type: "noul", noul: 0.1 };
        else {
          const rotulos = Object.keys(q.criteria);
          const escolha = opcoes.escolhas?.[nome] ?? rotulos[0];
          answers[nome] = { type: "choice", choice: escolha, probabilities: Object.fromEntries(rotulos.map((r) => [r, r === escolha ? 0.95 : 0.05 / (rotulos.length - 1)])), confidence: 0.9 };
        }
      }
      return new Response(JSON.stringify({ model: "typesafe/jev-1.13-20260917", answers, usage: { input_tokens: 200, output_tokens: 5, cost: opcoes.cost ?? 0.00002 }, id: "g", provider: "TypeSafe" }), { status: 200 });
    } finally {
      simultaneas--;
    }
  }) as unknown as typeof fetch;
  return { fn, corpos, maxSimultaneas: () => maxSimultaneas, soltar: () => soltar() };
}

async function linhasDe(dir: string, quando = AGORA): Promise<LinhaDoJev[]> {
  const texto = await fs.readFile(path.join(dir, `${diaLocal(quando).slice(0, 7)}.jsonl`), "utf8");
  return texto.trim().split("\n").map((l) => JSON.parse(l));
}

describe("criarJevSombra (fila, tetos, arquivo)", () => {
  const dirs: string[] = [];
  const tmp = async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-jev-"));
    dirs.push(d);
    return d;
  };
  afterEach(async () => {
    for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
  });

  const sombra = (dir: string, duble: ReturnType<typeof jevDuble>, extra: Partial<Parameters<typeof criarJevSombra>[0]> = {}) =>
    criarJevSombra({
      dir,
      cliente: criarClienteDoJev({ chave: CHAVE, modelo: "typesafe/jev-1.13", timeoutMs: 1000, fetch: duble.fn, log: silencio }),
      modelo: "typesafe/jev-1.13",
      tetoDia: 50,
      tetoUsd: 1,
      guardarDemanda: false,
      agora: () => AGORA,
      aleatorio: sequencia([0.3, 0.7]),
      log: silencio,
      ...extra,
    });

  it("grava uma linha com a comparação, sem a demanda, e o pedido certo", async () => {
    const dir = await tmp();
    const duble = jevDuble({ escolhas: { squad: "pay4fun", dominio: "pay4fun--geral", natureza: "agenda" } });
    const s = sombra(dir, duble);
    s.observarDemanda(obs({ demanda: "reunião com o time amanhã, ligar para (11) 98765-4321" }));
    await s.aguardar();

    const [linha] = (await linhasDe(dir)) as RegistroDoJev[];
    assert.equal(linha.modeloPedido, "typesafe/jev-1.13");
    assert.equal(linha.modeloRespondeu, "typesafe/jev-1.13-20260917");
    assert.equal(linha.squadInicial, "pessoal");
    assert.equal(linha.squadFinal, "pay4fun");
    assert.equal(linha.redirecionado, true);
    assert.equal(linha.squadExplicita, false);
    assert.equal(linha.cost, 0.00002);
    assert.equal(linha.input_tokens, 200);
    assert.ok(linha.latenciaMs >= 0);
    assert.match(linha.hashDaDemanda, /^[0-9a-f]{64}$/);
    assert.equal("demanda" in linha, false);
    assert.ok(!JSON.stringify(linha).includes("reunião"));
    assert.ok(!JSON.stringify(linha).includes("Planejamento"), "título do Gemini não entra");
    assert.deepEqual(linha.comparacao, {
      squad: { jev: "pay4fun", p: 0.95, gemini: "pay4fun", concorda: true },
      dominio: { jev: "pay4fun--geral", p: 0.95, gemini: "pay4fun--geral", concorda: true },
      natureza: { jev: "agenda", p: 0.95, gemini: "agenda", concorda: true },
      pede_contratacao: { jev: "false", p: 0.9, gemini: "false", concorda: true },
    });
    // squad entre as ATIVAS (a arquivada não entra); domínio entre as salas da squad final.
    assert.deepEqual([...linha.ordem.squad!].sort(), ["pay4fun", "pessoal", "prumo"]);
    assert.deepEqual([...linha.ordem.dominio!].sort(), ["pay4fun--dados", "pay4fun--geral"]);

    const [corpo] = duble.corpos;
    assert.equal(Array.isArray(corpo.questions), false);
    assert.equal(corpo.state, "reunião com o time amanhã, ligar para [TEL]");
    assert.deepEqual(corpo.provider, { data_collection: "deny", zdr: true });
    assert.ok(!JSON.stringify(corpo).includes("R$"));
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(path.join(dir, `${diaLocal(AGORA).slice(0, 7)}.jsonl`))).mode & 0o777, 0o600);
    }
  });

  it("a máscara vem antes do corte: telefone na fronteira dos 2000 caracteres não vaza pela metade", async () => {
    const dir = await tmp();
    const duble = jevDuble({ escolhas: { squad: "pay4fun", dominio: "pay4fun--geral", natureza: "agenda" } });
    const s = sombra(dir, duble);
    s.observarDemanda(obs({ demanda: `${"x".repeat(1990)} (11) 98765-4321 depois` }));
    await s.aguardar();
    const [corpo] = duble.corpos;
    assert.ok(corpo.state.length <= 2000);
    assert.ok(!/\d{3}/.test(corpo.state), `sobrou pedaço do número: ${corpo.state.slice(-30)}`);
  });

  it("a demanda (mascarada) só com guardarDemanda", async () => {
    const dir = await tmp();
    const s = sombra(dir, jevDuble(), { guardarDemanda: true });
    s.observarDemanda(obs({ demanda: "mandar o contrato para ana@x.com" }));
    await s.aguardar();
    const [linha] = (await linhasDe(dir)) as RegistroDoJev[];
    assert.equal(linha.demanda, "mandar o contrato para [EMAIL]");
  });

  it("finanças nem saem: linha 'pulada', sem fetch e fora do teto", async () => {
    const dir = await tmp();
    const duble = jevDuble();
    const s = sombra(dir, duble, { tetoDia: 1 });
    s.observarDemanda(obs({ demanda: "gastei 30 no mercado" }));
    // A sala que o Gemini escolheu é a de finanças: também não sai.
    s.observarDemanda(obs({ demanda: "revisar os alertas", redirecionadoPara: null, chamadas: [{ name: "criar_tarefa", args: { responsavel_id: "fin" } }] }));
    s.observarDemanda(obs());
    await s.aguardar();
    assert.equal(duble.corpos.length, 1);
    const linhas = await linhasDe(dir);
    assert.deepEqual(linhas.map((l) => ("pulada" in l ? l.pulada : "chamada")), ["financas", "financas", "chamada"]);
    assert.ok(!JSON.stringify(linhas).includes("mercado"));
  });

  it("a fila é serial: uma chamada por vez", async () => {
    const dir = await tmp();
    const duble = jevDuble({ demoraMs: 15 });
    const s = sombra(dir, duble);
    for (let i = 0; i < 3; i++) s.observarDemanda(obs());
    await s.aguardar();
    assert.equal(duble.corpos.length, 3);
    assert.equal(duble.maxSimultaneas(), 1);
  });

  it("teto do dia: para, avisa uma vez, volta no dia seguinte e sobrevive a reinício", async () => {
    const dir = await tmp();
    const duble = jevDuble();
    let agora = AGORA;
    const avisos: string[] = [];
    const s = sombra(dir, duble, { tetoDia: 2, agora: () => agora, log: { ...silencio, log: (m: unknown) => avisos.push(String(m)) } });
    for (let i = 0; i < 4; i++) s.observarDemanda(obs());
    await s.aguardar();
    assert.equal(duble.corpos.length, 2);
    assert.equal(avisos.filter((a) => a.includes("teto do dia")).length, 1);

    const outra = jevDuble();
    const reiniciada = sombra(dir, outra, { tetoDia: 3 });
    for (let i = 0; i < 3; i++) reiniciada.observarDemanda(obs());
    await reiniciada.aguardar();
    assert.equal(outra.corpos.length, 1, "as 2 de hoje já contam");
    assert.equal(await contarChamadasDoDia(path.join(dir, "2026-10.jsonl"), "2026-10-11"), 3);

    agora = new Date("2026-10-12T03:01:00Z"); // 00:01 em São Paulo
    s.observarDemanda(obs());
    await s.aguardar();
    assert.equal(duble.corpos.length, 3);
  });

  it("teto de gasto: soma o custo gravado e o de agora, e para de vez", async () => {
    const dir = await tmp();
    // Gasto de um mês anterior: o teto é do total, não do mês.
    await fs.writeFile(path.join(dir, "2026-09.jsonl"), `${JSON.stringify({ quando: "2026-09-30T12:00:00Z", cost: 0.00004 })}\n{torta\n`);
    assert.equal(await somarGasto(dir), 0.00004);
    const duble = jevDuble({ cost: 0.00003 });
    const warns: string[] = [];
    const s = sombra(dir, duble, { tetoUsd: 0.00009, log: { ...silencio, warn: (m: unknown) => warns.push(String(m)) } });
    for (let i = 0; i < 5; i++) s.observarDemanda(obs());
    await s.aguardar();
    // 0,00004 → sai (0,00007) → sai (0,0001 ≥ 0,00009) → a terceira já não sai.
    assert.equal(duble.corpos.length, 2);
    assert.equal(warns.filter((w) => w.includes("teto de gasto")).length, 1);
  });

  it("falha do Jev vira linha com motivo e status, e 402 desliga sem gravar mais nada", async () => {
    const dir = await tmp();
    const duble = jevDuble({ status: [500, 429, 402] });
    const s = sombra(dir, duble);
    for (let i = 0; i < 5; i++) s.observarDemanda(obs());
    await s.aguardar();
    assert.equal(duble.corpos.length, 3, "sem retry e nada depois do 402");
    const linhas = (await linhasDe(dir)) as RegistroDoJev[];
    assert.deepEqual(linhas.map((l) => l.falha), [
      { motivo: "indisponivel", status: 500 },
      { motivo: "limite", status: 429 },
      { motivo: "semCredito", status: 402 },
    ]);
    assert.ok(linhas.every((l) => l.respostas === null && l.comparacao === null && l.cost === 0));
    assert.ok(!JSON.stringify(linhas).includes(CHAVE));
  });

  it("observarDemanda volta na hora: o turno não espera o Jev", async () => {
    const dir = await tmp();
    const duble = jevDuble({ segurar: true });
    const s = sombra(dir, duble);
    let gravou = false;
    const inicio = Date.now();
    s.observarDemanda(obs());
    // O "turno" segue e termina com o Jev ainda pendurado.
    const turno = await Promise.resolve("TurnoResult");
    assert.equal(turno, "TurnoResult");
    assert.ok(Date.now() - inicio < 100);
    await new Promise((r) => setTimeout(r, 20));
    try {
      await fs.access(path.join(dir, "2026-10.jsonl"));
      gravou = true;
    } catch {
      gravou = false;
    }
    assert.equal(gravou, false, "nada gravado enquanto o Jev não respondeu");
    duble.soltar();
    await s.aguardar();
    assert.equal((await linhasDe(dir)).length, 1);
  });

  it("observarDemanda nunca lança, nem com observação torta nem com o fetch quebrado", async () => {
    const dir = await tmp();
    const warns: string[] = [];
    const quebrado = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const s = criarJevSombra({
      dir,
      cliente: criarClienteDoJev({ chave: CHAVE, modelo: "a/b", timeoutMs: 1000, fetch: quebrado, log: silencio }),
      modelo: "a/b", tetoDia: 5, tetoUsd: 1, guardarDemanda: false, agora: () => AGORA,
      log: { ...silencio, warn: (m: unknown) => warns.push(String(m)) },
    });
    assert.doesNotThrow(() => s.observarDemanda({ ...obs(), roster: undefined as unknown as Roster }));
    assert.doesNotThrow(() => s.observarDemanda(obs()));
    await s.aguardar();
    assert.ok(warns.some((w) => w.includes("descartada")));
    const [linha] = (await linhasDe(dir)) as RegistroDoJev[];
    assert.deepEqual(linha.falha, { motivo: "indisponivel", status: null });
  });
});

describe("prepararJevSombra (o boot)", () => {
  const contexto = async () => ({ dataDir: await fs.mkdtemp(path.join(os.tmpdir(), "squadone-jev-boot-")), operations: true, agendaAtiva: true });
  const nuncaChama = (() => {
    throw new Error("não devia chamar a rede");
  }) as unknown as typeof fetch;

  it("desligada por padrão, sem log e sem rede", async () => {
    const logs: string[] = [];
    const r = await prepararJevSombra({}, await contexto(), { fetch: nuncaChama, log: { log: (m) => logs.push(String(m)), warn: () => {}, error: (m) => logs.push(String(m)) } });
    assert.equal(r, null);
    assert.deepEqual(logs, []);
  });

  it("fora do operations ou sem a agenda (Easypanel): null, com log", async () => {
    const logs: string[] = [];
    const log = { ...silencio, log: (m: unknown) => logs.push(String(m)) };
    const env = { SQUADONE_JEV_SOMBRA: "true", OPENROUTER_API_KEY: CHAVE };
    assert.equal(await prepararJevSombra(env, { ...(await contexto()), operations: false }, { fetch: nuncaChama, log }), null);
    assert.equal(await prepararJevSombra(env, { ...(await contexto()), agendaAtiva: false }, { fetch: nuncaChama, log }), null);
    assert.equal(logs.filter((l) => l.includes("ignorada")).length, 2);
  });

  it("config ilegível: log de erro e null, sem a chave no log", async () => {
    const erros: string[] = [];
    const r = await prepararJevSombra({ SQUADONE_JEV_SOMBRA: "true", OPENROUTER_API_KEY: CHAVE, SQUADONE_JEV_TETO_DIA: "x" }, await contexto(), { fetch: nuncaChama, log: { ...silencio, error: (m) => erros.push(String(m)) } });
    assert.equal(r, null);
    assert.equal(erros.length, 1);
    assert.match(erros[0], /SQUADONE_JEV_TETO_DIA/);
    assert.ok(!erros[0].includes(CHAVE));
    const semChave: string[] = [];
    assert.equal(await prepararJevSombra({ SQUADONE_JEV_SOMBRA: "true" }, await contexto(), { log: { ...silencio, error: (m) => semChave.push(String(m)) } }), null);
    assert.match(semChave[0], /OPENROUTER_API_KEY ausente/);
  });

  it("ligada: cria a pasta, soma o gasto, loga sem a chave e observa", async () => {
    const ctx = await contexto();
    const logs: string[] = [];
    const duble = jevDuble();
    const r = await prepararJevSombra(
      { SQUADONE_JEV_SOMBRA: "true", OPENROUTER_API_KEY: CHAVE },
      ctx,
      { fetch: duble.fn, log: { log: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) } },
    );
    assert.ok(r);
    assert.ok((await fs.stat(path.join(ctx.dataDir, "jev-sombra"))).isDirectory());
    assert.ok(logs.some((l) => l.includes("sombra ligada") && l.includes("typesafe/jev-1.13") && l.includes("ZDR exigido")));
    r.observarDemanda(obs());
    await r.aguardar();
    assert.equal(duble.corpos.length, 1);
    assert.ok(logs.every((l) => !l.includes(CHAVE)));
  });
});
