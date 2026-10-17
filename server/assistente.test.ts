import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import express from "express";
import type { GenerateContentParameters } from "@google/genai";
import { guardaDeOrigem } from "./acesso.ts";
import { criarAssistente, prepararAssistente, TetoDoAssistente, type Assistente, type DepsDoAssistente, type RespostaDoGemini } from "./assistente.ts";
import type { FontesDoAssistente } from "./assistente-ferramentas.ts";
import { HermesFalhou, type ConsultaAoHermes } from "./hermes-consulta.ts";
import { montarCrm, validarRetrato } from "./crm.ts";
import { createOperationsRouter, HermesReadingsStore, OperationsProjectStore, type OperationsConfig } from "./operations.ts";
import { ModeloOcupado } from "./orchestrator.ts";
import type { CrmVisao } from "../src/operations/types.ts";

// O Assistente da Central (RULES 28), a cola: o que nem vai ao modelo, o que vai mascarado, o cartão
// que nasce "proposto" sem escrita nenhuma, os tetos, o Hermes que falha e as rotas. Tudo fixture:
// o Gemini e o Hermes são dublês, o CRM é montado em memória e o histórico vai para um diretório
// temporário, nunca para data/.

const AGORA = new Date("2026-10-17T14:00:00Z"); // sábado, 11:00 em SP
const COLUNAS = ["row_number", "place_id", "nome", "vertical", "cidade", "status", "site_url", "criado_em", "enviado_em",
  "visto_em", "respondeu_em", "followup_em", "recusado_em", "fechado_em", "acoes_link", "wa_link", "wa_me",
  "resposta_tipo", "resposta_trecho", "resposta_em", "mensagem_variante"];
const horas = (n: number) => new Date(AGORA.getTime() - n * 3600_000).toISOString();

function visaoDoCrm(): CrmVisao {
  const linha = {
    ...Object.fromEntries(COLUNAS.map((c) => [c, ""])), row_number: "3", place_id: "ChIJkulniski", nome: "Kulniski Advocacia",
    vertical: "advocacia", cidade: "Ribeirão Preto", criado_em: horas(200), status: "enviado", enviado_em: horas(30),
    respondeu_em: horas(2), resposta_tipo: "interesse", resposta_trecho: "pode sim, meu número é (16) 98100-0093", resposta_em: horas(2),
    wa_me: "https://wa.me/5516981000093", mensagem_variante: "A",
  };
  const retrato = validarRetrato({
    versao: 1,
    geradoEm: new Date(AGORA.getTime() - 60_000).toISOString(),
    links: { webhook: "https://dell.exemplo.ts.net/webhook" },
    fontes: {
      site: { planilha: "Leads", aba: "Leads", colunas: COLUNAS, linhas: [linha] },
      registros: { aba: "CRM", colunas: ["em", "produto", "id", "tipo", "texto", "data"], linhas: [] },
    },
  });
  return montarCrm(retrato, { agora: AGORA, pastas: [] }) as unknown as CrmVisao;
}

const dirs: string[] = [];
const servidores: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servidores.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), "squadone-assistente-"));
  dirs.push(d);
  return d;
}

const silencio = { log() {}, warn() {}, error() {} };

/** Um Gemini de roteiro: devolve as respostas em ordem e guarda o que recebeu. */
function geminiDeRoteiro(roteiro: Array<RespostaDoGemini | Error | (() => Promise<RespostaDoGemini>)>) {
  const pedidos: GenerateContentParameters[] = [];
  const gerar = async (p: GenerateContentParameters): Promise<RespostaDoGemini> => {
    pedidos.push(JSON.parse(JSON.stringify(p)));
    const passo = roteiro[pedidos.length - 1] ?? { text: "ok" };
    if (passo instanceof Error) throw passo;
    return typeof passo === "function" ? passo() : passo;
  };
  return { gerar, pedidos };
}

/** O CRM de mentira: só a visão; o `registrar` está aqui para provar que ninguém o chama. */
function crmDeMentira() {
  const visao = visaoDoCrm();
  const chamadas = { registrar: 0 };
  return { visao: async () => visao, registrar: async () => { chamadas.registrar++; }, chamadas, lead: visao.leads[0] };
}

async function montar(extra: Partial<DepsDoAssistente> & { gerar: DepsDoAssistente["gerar"] }, dir?: string): Promise<{ a: Assistente; dir: string }> {
  const d = dir ?? await tempDir();
  let n = 0;
  const crm = crmDeMentira();
  const fontes: FontesDoAssistente = {
    visao: crm.visao,
    agenda: async () => ({ state: "connected", events: [{ id: "e1", title: "Reunião com a Kulniski", start: "2026-10-17T17:00:00Z", end: "2026-10-17T18:00:00Z", allDay: false }] }),
    dell: async () => ({ geradoEm: new Date(AGORA.getTime() - 60_000).toISOString(), verificacoes: [] }),
  };
  const a = await criarAssistente({ dir: d, tetoDia: 60, fontes, agora: () => AGORA, log: silencio, novoId: () => `id-${String(++n).padStart(3, "0")}-abcdef`, ...extra });
  return { a, dir: d };
}

async function linhasDoArquivo(dir: string): Promise<string[]> {
  const nomes = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
  const textos = await Promise.all(nomes.map((n) => readFile(path.join(dir, n), "utf8")));
  return textos.join("").split("\n").filter(Boolean);
}

// O id curto que o painel manda (src/casca/assistente.ts, contextoDoEndereco).
const PAGINA = { pagina: "vendas" };

describe("finanças nem saem do processo", () => {
  for (const texto of ["gastei 30 no mercado", "quanto custa R$ 200 de farmácia?"]) {
    it(`${JSON.stringify(texto)}: regra fixa, modelo não chamado, nada do texto no arquivo`, async () => {
      const g = geminiDeRoteiro([]);
      const { a, dir } = await montar({ gerar: g.gerar });
      const r = await a.receber({ texto, contexto: PAGINA });
      assert.equal(g.pedidos.length, 0);
      const c = a.conversa(r.conversaId)!;
      assert.equal(c.pendente, null);
      assert.deepEqual(c.mensagens.map((m) => [m.autor, m.texto, m.cerebro ?? null]), [
        ["romulo", "[assunto de finanças]", null],
        ["assistente", "Isso fica em Finanças: abra /financas. Não mando finanças a nenhum modelo.", "regra"],
      ]);
      const arquivo = (await linhasDoArquivo(dir)).join("\n");
      assert.doesNotMatch(arquivo, /30|mercado|200|farm|R\$/);
      assert.equal((await a.estado()).usadosHoje, 0, "regra fixa não gasta o teto");
    });
  }
});

describe("tudo o que vai ao modelo e ao arquivo sai mascarado", () => {
  it("telefone, e-mail, wa.me e CPF viram rótulos no prompt e no JSONL", async () => {
    const g = geminiDeRoteiro([{ text: "Anotei mentalmente: (41) 98888-7777." }]);
    const { a, dir } = await montar({ gerar: g.gerar });
    const r = await a.receber({ texto: "liga (41) 99999-1234, joao@exemplo.com, wa.me/5541999991234, CPF 529.982.247-25", contexto: PAGINA });
    await a.ocioso();
    const enviado = JSON.stringify(g.pedidos);
    assert.doesNotMatch(enviado, /\d{8,}|99999|joao@|529\.982/);
    const linhas = await linhasDoArquivo(dir);
    assert.ok(linhas.length >= 2);
    for (const l of linhas) assert.doesNotMatch(l, /\d{8,}|99999|98888|joao@/);
    const resposta = a.conversa(r.conversaId)!.mensagens.at(-1)!;
    assert.doesNotMatch(resposta.texto, /98888/);
  });

  it("o lead da Ficha entra no prompt pelo nome, sem o telefone da planilha", async () => {
    const g = geminiDeRoteiro([{ text: "ok" }]);
    const { a } = await montar({ gerar: g.gerar });
    await a.receber({ texto: "o que falta neste lead?", contexto: { pagina: "ficha", lead: { produto: "site", id: "site:ChIJkulniski" } } });
    await a.ocioso();
    const si = String(g.pedidos[0].config?.systemInstruction);
    assert.match(si, /Kulniski Advocacia/);
    assert.doesNotMatch(si, /\d{8,}|98100|R\$/);
  });
});

describe("para agir, só cartão proposto", () => {
  it("\"marca reunião amanhã\": o Gemini propõe, o cartão nasce proposto e nada é escrito", async () => {
    const crm = crmDeMentira();
    const fetchOriginal = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { fetches++; return fetchOriginal(...args); }) as typeof fetch;
    try {
      const g = geminiDeRoteiro([
        { functionCalls: [{ name: "propor_pedido_ao_time", args: { demanda: "Marcar reunião amanhã às 10h" } }] },
        { text: "Deixei um cartão para você confirmar." },
      ]);
      const { a } = await montar({ gerar: g.gerar, fontes: { visao: crm.visao } });
      const r = await a.receber({ texto: "marca reunião amanhã", contexto: PAGINA });
      await a.ocioso();
      const resposta = a.conversa(r.conversaId)!.mensagens.at(-1)!;
      assert.equal(resposta.id, r.respostaId);
      assert.equal(resposta.cartoes.length, 1);
      assert.equal(resposta.cartoes[0].tipo, "pedido_ao_time");
      assert.equal(resposta.cartoes[0].estado, "proposto");
      assert.deepEqual(resposta.cartoes[0].dados, { demanda: "Marcar reunião amanhã às 10h", modo: "auto" });
      assert.equal(fetches, 0, "nenhuma chamada a /api/orquestrar nem a lugar nenhum");
      assert.equal(crm.chamadas.registrar, 0, "nada vai ao crm.registrar");
      // A segunda rodada recebeu a resposta da ferramenta: proposto, nada feito.
      assert.match(JSON.stringify(g.pedidos[1].contents), /"proposto":true/);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  it("anotação para lead fora do CRM é recusada e o modelo fica sabendo", async () => {
    const g = geminiDeRoteiro([
      { functionCalls: [{ name: "propor_anotacao_no_crm", args: { produto: "site", id: "ChIJinventado", tipo: "nota", texto: "x" } }] },
      { text: "Não achei esse lead." },
    ]);
    const { a } = await montar({ gerar: g.gerar });
    const r = await a.receber({ texto: "anota no lead X", contexto: PAGINA });
    await a.ocioso();
    assert.equal(a.conversa(r.conversaId)!.mensagens.at(-1)!.cartoes.length, 0);
    assert.match(JSON.stringify(g.pedidos[1].contents), /lead fora de Vendas/);
  });

  it("o desfecho do cartão só mede, e vale depois de reiniciar", async () => {
    const g = geminiDeRoteiro([
      { functionCalls: [{ name: "propor_mensagem_ao_lead", args: { produto: "site", id: "site:ChIJkulniski", texto: "Oi, tudo bem?" } }] },
      { text: "Deixei a mensagem para você copiar." },
    ]);
    const { a, dir } = await montar({ gerar: g.gerar });
    const r = await a.receber({ texto: "escreve para a Kulniski", contexto: PAGINA });
    await a.ocioso();
    const cartao = a.conversa(r.conversaId)!.mensagens.at(-1)!.cartoes[0];
    assert.equal(cartao.tipo, "mensagem_ao_lead");
    assert.equal(await a.decidirCartao(cartao.id, "confirmado"), "ok");
    assert.equal(await a.decidirCartao(cartao.id, "descartado"), "jaDecidido");
    assert.equal(await a.decidirCartao("nao-existe-123", "descartado"), "naoAchou");
    const { a: depois } = await montar({ gerar: geminiDeRoteiro([]).gerar }, dir);
    assert.equal(depois.conversa(r.conversaId)!.mensagens.at(-1)!.cartoes[0].estado, "confirmado");
  });
});

describe("de onde veio: só as leituras que rodaram", () => {
  it("só a agenda rodou: a fonte é só a agenda", async () => {
    const g = geminiDeRoteiro([{ functionCalls: [{ name: "ler_agenda_do_dia", args: {} }] }, { text: "Às 14:00 você tem a reunião." }]);
    const { a } = await montar({ gerar: g.gerar });
    const r = await a.receber({ texto: "o que tenho hoje?", contexto: PAGINA });
    await a.ocioso();
    assert.deepEqual(a.conversa(r.conversaId)!.mensagens.at(-1)!.fontes, [{ rotulo: "agenda" }]);
  });

  it("CRM e Dell: os rótulos com a hora do retrato", async () => {
    const g = geminiDeRoteiro([{ functionCalls: [{ name: "ler_funil", args: {} }, { name: "ler_estado_do_dell", args: {} }] }, { text: "ok" }]);
    const { a } = await montar({ gerar: g.gerar });
    const r = await a.receber({ texto: "como está tudo?", contexto: PAGINA });
    await a.ocioso();
    assert.deepEqual(a.conversa(r.conversaId)!.mensagens.at(-1)!.fontes.map((f) => f.rotulo), ["Vendas às 10:59", "Dell às 10:59"]);
  });

  it("buscar_lead e ler_lead: o id intacto, o dossiê sem telefone nem preço do cardápio", async () => {
    const g = geminiDeRoteiro([
      { functionCalls: [{ name: "buscar_lead", args: { nome: "kulni" } }] },
      { functionCalls: [{ name: "ler_lead", args: { produto: "site", id: "site:ChIJkulniski" } }] },
      { text: "Ela disse que pode." },
    ]);
    const { a } = await montar({ gerar: g.gerar });
    await a.receber({ texto: "como está a Kulniski?", contexto: PAGINA });
    await a.ocioso();
    const busca = JSON.stringify(g.pedidos[1].contents);
    assert.match(busca, /"id":"site:ChIJkulniski"/);
    assert.match(busca, /Kulniski Advocacia/);
    const dossie = JSON.stringify(g.pedidos[2].contents);
    assert.match(dossie, /pode sim/);
    assert.doesNotMatch(dossie, /\d{8,}|98100|R\$|cardapio/);
  });

  it("sem CRM: a leitura diz sem sinal e a resposta leva a falha semCrm", async () => {
    const g = geminiDeRoteiro([{ functionCalls: [{ name: "ler_hoje", args: {} }] }, { text: "Não li o CRM." }]);
    const { a } = await montar({ gerar: g.gerar, fontes: {} });
    const r = await a.receber({ texto: "o que tenho em vendas?", contexto: PAGINA });
    await a.ocioso();
    const resposta = a.conversa(r.conversaId)!.mensagens.at(-1)!;
    assert.equal(resposta.falha?.tipo, "semCrm");
    assert.deepEqual(resposta.fontes, []);
    assert.match(JSON.stringify(g.pedidos[1].contents), /semSinal/);
  });
});

describe("falhas classificadas", () => {
  it("Gemini ocupado vira modeloOcupado", async () => {
    const { a } = await montar({ gerar: geminiDeRoteiro([new ModeloOcupado("503")]).gerar });
    const r = await a.receber({ texto: "oi", contexto: PAGINA });
    await a.ocioso();
    assert.equal(a.conversa(r.conversaId)!.mensagens.at(-1)!.falha?.tipo, "modeloOcupado");
  });

  it("o teto conta a tentativa, mesmo a que falhou, e sobrevive a reinício", async () => {
    const g = geminiDeRoteiro([new Error("boom"), new Error("boom")]);
    const { a, dir } = await montar({ gerar: g.gerar, tetoDia: 2 });
    const r1 = await a.receber({ texto: "um", contexto: PAGINA });
    await a.ocioso();
    assert.equal(a.conversa(r1.conversaId)!.mensagens.at(-1)!.falha?.tipo, "outro");
    await a.receber({ texto: "dois", contexto: PAGINA });
    await a.ocioso();
    await assert.rejects(a.receber({ texto: "três", contexto: PAGINA }), TetoDoAssistente);
    assert.equal(g.pedidos.length, 2);
    const { a: depois } = await montar({ gerar: g.gerar, tetoDia: 2 }, dir);
    assert.equal((await depois.estado()).usadosHoje, 2);
    await assert.rejects(depois.receber({ texto: "quatro", contexto: PAGINA }), TetoDoAssistente);
  });

  it("Hermes falhando: a resposta sai com o que foi lido e a falha hermes", async () => {
    const hermes: ConsultaAoHermes = { consultar: async () => { throw new HermesFalhou("timeout"); } };
    const g = geminiDeRoteiro([
      { functionCalls: [{ name: "ler_funil", args: {} }, { name: "consultar_hermes", args: { pergunta: "como abordar a semana?" } }] },
      { text: "Pelo funil, foque nos que responderam." },
    ]);
    const { a } = await montar({ gerar: g.gerar, hermes });
    const r = await a.receber({ texto: "qual a estratégia da semana?", contexto: PAGINA });
    await a.ocioso();
    const resposta = a.conversa(r.conversaId)!.mensagens.at(-1)!;
    assert.equal(resposta.falha?.tipo, "hermes");
    assert.match(resposta.texto, /^O Hermes não respondeu; isto é só o que li\./);
    assert.match(resposta.texto, /foque nos que responderam/);
    assert.deepEqual(resposta.fontes.map((f) => f.rotulo), ["Vendas às 10:59"]);
    assert.equal(resposta.cerebro, "gemini");
  });

  it("Hermes respondendo: o texto dele vai direto, sem voltar ao Gemini, e o pacote é só o que foi lido", async () => {
    const pacotes: string[] = [];
    const hermes: ConsultaAoHermes = { consultar: async (_p, pacote) => { pacotes.push(pacote); return { texto: "Comece pela Kulniski (16) 98100-0093.", ms: 24_000 }; } };
    const g = geminiDeRoteiro([
      { functionCalls: [{ name: "ler_hoje", args: {} }, { name: "consultar_hermes", args: { pergunta: "por onde começo?" } }] },
      { functionCalls: [{ name: "propor_mensagem_ao_lead", args: { produto: "site", id: "site:ChIJkulniski", texto: "oi" } }] },
    ]);
    const { a } = await montar({ gerar: g.gerar, hermes });
    const r = await a.receber({ texto: "por onde começo hoje?", contexto: PAGINA });
    await a.ocioso();
    const resposta = a.conversa(r.conversaId)!.mensagens.at(-1)!;
    assert.equal(g.pedidos.length, 1, "o texto do Hermes nunca volta ao Gemini");
    assert.equal(resposta.cerebro, "hermes");
    assert.match(resposta.texto, /Comece pela Kulniski/);
    assert.doesNotMatch(resposta.texto, /98100/);
    assert.deepEqual(resposta.cartoes, [], "o Hermes nunca vira cartão");
    assert.deepEqual(resposta.fontes.map((f) => f.rotulo), ["Vendas às 10:59", "Hermes (24 s)"]);
    assert.equal(pacotes.length, 1);
    assert.match(pacotes[0], /ler_hoje/);
    assert.doesNotMatch(pacotes[0], /\d{8,}|98100|R\$/);
  });
});

describe("o histórico", () => {
  it("relê as conversas ao subir e poda o que passou de 90 dias", async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, "2026-06.jsonl"), `${JSON.stringify({ tipo: "mensagem", quando: "2026-06-10T12:00:00Z", conversaId: "velha-123", mensagem: { id: "m-velha-1", n: 1, autor: "romulo", texto: "antiga", quando: "2026-06-10T12:00:00Z", fontes: [], cartoes: [] } })}\n`);
    const g = geminiDeRoteiro([{ text: "resposta" }]);
    const { a } = await montar({ gerar: g.gerar }, dir);
    assert.equal(a.conversa("velha-123"), null);
    assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".jsonl")), []);
    const r = await a.receber({ texto: "oi", contexto: PAGINA });
    await a.ocioso();
    const { a: depois } = await montar({ gerar: g.gerar }, dir);
    const c = depois.conversa(r.conversaId)!;
    assert.deepEqual(c.mensagens.map((m) => [m.n, m.autor, m.texto]), [[1, "romulo", "oi"], [2, "assistente", "resposta"]]);
    // A segunda mensagem leva o histórico ao Gemini.
    const g2 = geminiDeRoteiro([{ text: "de novo" }]);
    const { a: terceira } = await montar({ gerar: g2.gerar }, dir);
    await terceira.receber({ conversaId: r.conversaId, texto: "e agora?", contexto: PAGINA });
    await terceira.ocioso();
    assert.deepEqual(g2.pedidos[0].contents, [
      { role: "user", parts: [{ text: "oi" }] },
      { role: "model", parts: [{ text: "resposta" }] },
      { role: "user", parts: [{ text: "e agora?" }] },
    ]);
  });
});

describe("o boot", () => {
  it("desligado por padrão, ignorado fora do operations, sem chave não sobe", async () => {
    const dataDir = await tempDir();
    const logs: string[] = [];
    const log = { log: (m: unknown) => logs.push(String(m)), warn() {}, error: (m: unknown) => logs.push(String(m)) };
    assert.equal(await prepararAssistente({}, { dataDir, operations: true, fontes: {} }, { log }), null);
    assert.equal(await prepararAssistente({ SQUADONE_ASSISTENTE: "true" }, { dataDir, operations: false, fontes: {} }, { log }), null);
    assert.match(logs.join("\n"), /ignorada: só no perfil operations/);
    assert.equal(await prepararAssistente({ SQUADONE_ASSISTENTE: "true" }, { dataDir, operations: true, fontes: {} }, { log }), null);
    assert.equal(await prepararAssistente({ SQUADONE_ASSISTENTE: "true", SQUADONE_ASSISTENTE_TETO_DIA: "muitos" }, { dataDir, operations: true, fontes: {} }, { log }), null);
    const a = await prepararAssistente({ SQUADONE_ASSISTENTE: "true", SQUADONE_ASSISTENTE_HERMES: "true", SQUADONE_ASSISTENTE_TETO_DIA: "5" },
      { dataDir, operations: true, fontes: {}, criarHermes: ({ tetoDia }) => { assert.equal(tetoDia, 20); return { consultar: async () => ({ texto: "x", ms: 1 }) }; } },
      { log, gerar: geminiDeRoteiro([]).gerar });
    assert.ok(a);
    assert.deepEqual(await a.estado(), { ligado: true, hermes: true, tetoDia: 5, usadosHoje: 0 });
  });
});

describe("as rotas", () => {
  async function servidor(assistente: Assistente | null): Promise<string> {
    const dataDir = await tempDir();
    const app = express();
    app.use("/api", guardaDeOrigem());
    app.use(express.json());
    app.use("/api/operations", createOperationsRouter({
      config: { displayName: "", tools: {} } as unknown as OperationsConfig,
      store: new OperationsProjectStore(dataDir),
      readings: new HermesReadingsStore(dataDir),
      readAgenda: async () => ({ state: "disconnected", events: [] }),
      dataDir,
      assistente,
    }));
    const s = http.createServer(app);
    servidores.push(s);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  }
  const post = (base: string, rota: string, corpo: unknown, origem = true) => fetch(`${base}/api/operations${rota}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(origem ? { Origin: base } : {}) }, body: JSON.stringify(corpo),
  });

  it("POST 202, GET com pendente e depois a resposta; avaliação e cartão", async () => {
    let soltar!: () => void;
    const segura = new Promise<void>((r) => { soltar = r; });
    const g = geminiDeRoteiro([
      async () => { await segura; return { functionCalls: [{ name: "propor_pedido_ao_time", args: { demanda: "Marcar reunião" } }] }; },
      { text: "Deixei o cartão." },
    ]);
    const { a } = await montar({ gerar: g.gerar });
    const base = await servidor(a);

    const r = await post(base, "/assistente/mensagens", { texto: "marca reunião amanhã", contexto: { pagina: "/" } });
    assert.equal(r.status, 202);
    const recebido = await r.json() as { conversaId: string; mensagemId: string; respostaId: string };
    const antes = await (await fetch(`${base}/api/operations/assistente/conversas/${recebido.conversaId}`)).json() as any;
    assert.equal(antes.pendente.respostaId, recebido.respostaId);
    assert.equal(antes.mensagens.length, 1);

    soltar();
    await a.ocioso();
    const depois = await fetch(`${base}/api/operations/assistente/conversas/${recebido.conversaId}?desde=1`);
    assert.equal(depois.headers.get("cache-control"), "no-store");
    const conversa = await depois.json() as any;
    assert.equal(conversa.pendente, null);
    assert.deepEqual(conversa.mensagens.map((m: any) => m.id), [recebido.respostaId]);

    assert.equal((await post(base, "/assistente/avaliacao", { respostaId: recebido.respostaId, nota: 1 })).status, 204);
    assert.equal((await post(base, "/assistente/avaliacao", { respostaId: "nao-existe-1", nota: 1 })).status, 404);
    assert.equal((await post(base, "/assistente/avaliacao", { respostaId: recebido.respostaId, nota: 5 })).status, 400);
    const cartaoId = conversa.mensagens[0].cartoes[0].id;
    assert.equal((await post(base, `/assistente/cartoes/${cartaoId}`, { desfecho: "descartado" })).status, 204);
    assert.equal((await post(base, `/assistente/cartoes/${cartaoId}`, { desfecho: "confirmado" })).status, 409);
    assert.equal((await fetch(`${base}/api/operations/assistente/conversas/nao-existe-1`)).status, 404);
  });

  it("corpo torto 400, teto 429, sem Origin 403", async () => {
    const { a } = await montar({ gerar: geminiDeRoteiro([{ text: "ok" }]).gerar, tetoDia: 1 });
    const base = await servidor(a);
    assert.equal((await post(base, "/assistente/mensagens", { texto: "", contexto: { pagina: "/" } })).status, 400);
    assert.equal((await post(base, "/assistente/mensagens", { texto: "x".repeat(2001), contexto: { pagina: "/" } })).status, 400);
    assert.equal((await post(base, "/assistente/mensagens", { texto: "oi" })).status, 400);
    assert.equal((await post(base, "/assistente/mensagens", { texto: "oi", contexto: { pagina: "/", lead: { produto: "loja", id: "x" } } })).status, 400);
    assert.equal((await post(base, "/assistente/mensagens", { texto: "oi", contexto: { pagina: "/" } }, false)).status, 403);
    assert.equal((await post(base, "/assistente/mensagens", { texto: "oi", contexto: { pagina: "/" } })).status, 202);
    await a.ocioso();
    const r = await post(base, "/assistente/mensagens", { texto: "de novo", contexto: { pagina: "/" } });
    assert.equal(r.status, 429);
    assert.equal((await r.json() as any).teto, true);
    assert.deepEqual(await (await fetch(`${base}/api/operations/assistente`)).json(), { ligado: true, hermes: false, tetoDia: 1, usadosHoje: 1 });
  });

  it("desligado: GET diz ligado false e o resto 503", async () => {
    const base = await servidor(null);
    assert.deepEqual(await (await fetch(`${base}/api/operations/assistente`)).json(), { ligado: false, hermes: false, tetoDia: 0, usadosHoje: 0 });
    const r = await post(base, "/assistente/mensagens", { texto: "oi", contexto: { pagina: "/" } });
    assert.equal(r.status, 503);
    assert.equal((await r.json() as any).desligado, true);
    assert.equal((await fetch(`${base}/api/operations/assistente/conversas/abc-12345`)).status, 503);
  });
});

describe("não há caminho daqui até uma escrita", () => {
  it("os módulos do Assistente não importam o CrmStore, as capacidades do turno nem chamam rede", async () => {
    for (const arquivo of ["./assistente.ts", "./assistente-ferramentas.ts", "../src/operations/assistente.ts"]) {
      const texto = await readFile(new URL(arquivo, import.meta.url), "utf8");
      assert.doesNotMatch(texto, /from ["']\.\/crm\.ts["']|capabilities|CAPABILITIES/, `${arquivo} importa escrita`);
      assert.doesNotMatch(texto, /\.registrar\(|\/api\/orquestrar["'`]|\bfetch\(/, `${arquivo} escreve ou chama rede`);
    }
  });
});
