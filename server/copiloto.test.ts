import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { CrmLead } from "../src/operations/types.ts";
import {
  caminhosDoRaioX,
  CopilotoFalhou,
  CopilotoMalConfigurado,
  criarCopiloto,
  LeadForaDoCrm,
  lerConfigDoCopiloto,
  lerRaioXDoDisco,
  lerRegistros,
  PassoSemCopiloto,
  prepararCopiloto,
  provedorCodex,
  provedorGemini,
  TetoDoCopiloto,
  type ProvedorDoCopiloto,
  type RespostaDoProvedor,
} from "./copiloto.ts";
import type { ExecutorDoCodex } from "./luna-sombra.ts";

// Tudo em diretório temporário próprio: nada aqui toca data/, ~/auto-site nem ~/prumo-entregas.
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "copiloto-"));
const silencio = { log() {}, warn() {}, error() {} };

const leadCrm = (extra: Partial<CrmLead> = {}): CrmLead => ({
  id: "ChIJabc", produto: "site", chave: "27999991234", empresa: "Desentupidora Estrela", nicho: "desentupidora", cidade: "Vitória",
  etapa: "contato", sinal: "respondeu", subEtapa: "Respondeu", estadoNaPlanilha: "enviado", leitura: "viu",
  marcos: { enviado: "2026-10-14T12:00:00Z" }, followupHoje: false, respostaNova: true, acervo: false, notas: 0,
  resposta: { tipo: "interesse", trecho: "pode mandar", em: "2026-10-14T13:00:00Z" },
  eventos: [], links: {}, divergencias: [],
  ...extra,
});

const BOA = JSON.stringify({
  mensagem: "Aqui é o Rômulo, do PRUMO. Posso pôr o site no ar? O Encontrado é R$ 690 + R$ 39/mês, pago só depois de ver.",
  porque: "Disse que quer ver.",
  ofertas: [{ id: "encontrado", porque: "Sem site." }],
  proposta: { itens: [{ id: "encontrado", porque: "Pediu." }] },
  falta_saber: [],
});

function provedorDuble(respostas: RespostaDoProvedor[]): ProvedorDoCopiloto & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    nome: "gemini",
    descricao: "dublê",
    prompts,
    async gerar(prompt) {
      prompts.push(prompt);
      return respostas.shift() ?? { ok: true, texto: BOA };
    },
  };
}

async function montar(opcoes: { leads?: CrmLead[]; respostas?: RespostaDoProvedor[]; teto?: number; raioX?: string | null; dir?: string } = {}) {
  const dir = opcoes.dir ?? (await temp());
  const leads = opcoes.leads ?? [leadCrm()];
  const provedor = provedorDuble(opcoes.respostas ?? []);
  const copiloto = criarCopiloto({
    dir,
    provedor,
    tetoDia: opcoes.teto ?? 20,
    fontes: { visao: async () => ({ leads }), raioX: async () => opcoes.raioX ?? null },
    agora: () => new Date("2026-10-15T15:00:00Z"),
    log: silencio,
  });
  return { dir, leads, provedor, copiloto, arquivo: path.join(dir, "2026-10.jsonl") };
}

describe("copiloto: a cola", () => {
  it("gera, grava no JSONL 600 e devolve a mesma sugestão guardada enquanto o dossiê não muda", async () => {
    const { copiloto, provedor, arquivo } = await montar({ raioX: "<p>4,8 nota no Google</p>" });
    const primeira = await copiloto.sugerir("site", "ChIJabc");
    assert.equal(primeira.guardada, false);
    assert.equal(primeira.raioX, "com texto");
    assert.match(primeira.sugestao.mensagem, /Encontrado/);
    const segunda = await copiloto.sugerir("site", "ChIJabc");
    assert.equal(segunda.guardada, true);
    assert.equal(segunda.hashDoDossie, primeira.hashDoDossie);
    assert.equal(provedor.prompts.length, 1);
    assert.match(provedor.prompts[0], /4,8 nota no Google/);
    assert.deepEqual(await copiloto.ler("site", "ChIJabc"), { ...segunda });
    if (process.platform !== "win32") assert.equal((await fs.stat(arquivo)).mode & 0o777, 0o600);
    const [registro] = await lerRegistros(arquivo);
    assert.equal(registro.tipo, "sugestao");
    assert.equal(registro.lead, "site:ChIJabc");
  });

  it("o prompt não leva o telefone do lead", async () => {
    const { copiloto, provedor } = await montar({ leads: [leadCrm({ resposta: { tipo: "interesse", trecho: "me liga no 27 99999-1234" } })] });
    await copiloto.sugerir("site", "ChIJabc");
    assert.doesNotMatch(provedor.prompts[0], /99999|27999991234/);
  });

  it("forçar gera de novo; dossiê mudou também", async () => {
    const leads = [leadCrm()];
    const { copiloto, provedor } = await montar({ leads });
    await copiloto.sugerir("site", "ChIJabc");
    await copiloto.sugerir("site", "ChIJabc", true);
    leads[0] = leadCrm({ resposta: { tipo: "interesse", trecho: "quanto fica?" } });
    assert.equal(await copiloto.ler("site", "ChIJabc"), null);
    await copiloto.sugerir("site", "ChIJabc");
    assert.equal(provedor.prompts.length, 3);
  });

  it("a sugestão guardada sobrevive a reinício (relida do arquivo do mês)", async () => {
    const { dir } = await montar();
    const a = await montar({ dir });
    await a.copiloto.sugerir("site", "ChIJabc");
    const b = await montar({ dir });
    const lida = await b.copiloto.ler("site", "ChIJabc");
    assert.equal(lida?.guardada, true);
    assert.equal(b.provedor.prompts.length, 0);
  });

  it("clique duplo: uma geração só", async () => {
    const { copiloto, provedor } = await montar();
    const [a, b] = await Promise.all([copiloto.sugerir("site", "ChIJabc"), copiloto.sugerir("site", "ChIJabc")]);
    assert.equal(provedor.prompts.length, 1);
    assert.equal(a.hashDoDossie, b.hashDoDossie);
  });

  it("teto do dia conta a tentativa, inclusive a que falhou, e sobrevive a reinício", async () => {
    const { dir, copiloto } = await montar({ teto: 2, respostas: [{ ok: false, motivo: "timeout", detalhe: "120 s" }] });
    await assert.rejects(copiloto.sugerir("site", "ChIJabc"), CopilotoFalhou);
    await copiloto.sugerir("site", "ChIJabc");
    await assert.rejects(copiloto.sugerir("site", "ChIJabc", true), TetoDoCopiloto);
    const depois = await montar({ dir, teto: 2 });
    assert.equal((await depois.copiloto.estado()).usadosHoje, 2);
    await assert.rejects(depois.copiloto.sugerir("site", "ChIJabc", true), TetoDoCopiloto);
  });

  it("saída recusada (preço sob proposta) vira falha classificada e não fica guardada", async () => {
    const ruim = JSON.stringify({ mensagem: "O Respondido é R$ 2.400.", ofertas: [], proposta: { itens: [] } });
    const { copiloto, arquivo } = await montar({ respostas: [{ ok: true, texto: ruim }] });
    await assert.rejects(copiloto.sugerir("site", "ChIJabc"), (e: unknown) => e instanceof CopilotoFalhou && e.motivo === "preco_proibido");
    assert.equal(await copiloto.ler("site", "ChIJabc"), null);
    const [registro] = await lerRegistros(arquivo);
    assert.equal(registro.tipo === "sugestao" && registro.falha?.motivo, "preco_proibido");
  });

  it("lead fora do CRM e passo sem copiloto", async () => {
    const { copiloto } = await montar({ leads: [leadCrm({ sinal: "enviado", resposta: undefined })] });
    await assert.rejects(copiloto.sugerir("site", "outro"), LeadForaDoCrm);
    await assert.rejects(copiloto.sugerir("site", "ChIJabc"), PassoSemCopiloto);
  });

  it("a cópia é registrada para medir o uso", async () => {
    const { copiloto, arquivo } = await montar();
    const s = await copiloto.sugerir("site", "ChIJabc");
    await copiloto.copiou("site", "ChIJabc", s.hashDoDossie, "mensagem");
    const registros = await lerRegistros(arquivo);
    assert.deepEqual(registros.map((r) => r.tipo), ["sugestao", "copiou"]);
  });
});

describe("copiloto: sozinho (16/10/2026)", () => {
  it("automática: começa em segundo plano, depois fica pronta sem chamar o modelo de novo", async () => {
    const { copiloto, provedor, leads } = await montar();
    assert.deepEqual(await copiloto.automatica(leads[0]), { estado: "gerando" });
    // A Ficha pedindo junto pega a mesma geração (uma só por lead).
    await copiloto.sugerir("site", "ChIJabc");
    const pronta = await copiloto.automatica(leads[0]);
    assert.equal(pronta.estado, "pronta");
    assert.equal(provedor.prompts.length, 1);
    const prontas = await copiloto.prontas(leads);
    assert.match(prontas.get("ChIJabc")?.sugestao.mensagem ?? "", /Encontrado/);
  });

  it("falhou: não tenta de novo o mesmo dossiê (nada de laço gastando o teto)", async () => {
    const { copiloto, provedor, leads } = await montar({ respostas: [{ ok: false, motivo: "timeout", detalhe: "lento" }] });
    assert.deepEqual(await copiloto.automatica(leads[0]), { estado: "gerando" });
    await copiloto.sugerir("site", "ChIJabc").catch(() => undefined);
    assert.deepEqual(await copiloto.automatica(leads[0]), { estado: "sem" });
    assert.equal(provedor.prompts.length, 1);
  });

  it("fora do trecho do copiloto (ainda não respondeu) não gera", async () => {
    const lead = leadCrm({ sinal: "enviado", respostaNova: false, resposta: undefined });
    const { copiloto, provedor } = await montar({ leads: [lead] });
    assert.deepEqual(await copiloto.automatica(lead), { estado: "sem" });
    assert.equal(provedor.prompts.length, 0);
  });
});

describe("copiloto: provedores", () => {
  it("codex: execFile com stdin, sandbox read-only, resposta pelo arquivo (apagado depois)", async () => {
    const dir = await temp();
    let visto: { bin: string; args: string[]; stdin?: string } | null = null;
    const executar: ExecutorDoCodex = async (bin, args, { stdin }) => {
      visto = { bin, args, stdin };
      await fs.writeFile(args[args.indexOf("--output-last-message") + 1], BOA);
      return { stdout: "", stderr: "", codigo: 0, estourouTempo: false };
    };
    const r = await provedorCodex({ bin: "codex", dir, executar }).gerar("o prompt");
    assert.deepEqual(r, { ok: true, texto: BOA });
    assert.equal(visto!.stdin, "o prompt");
    assert.ok(!visto!.args.includes("--model"));
    assert.deepEqual(visto!.args.slice(0, 4), ["exec", "--sandbox", "read-only", "--skip-git-repo-check"]);
    assert.deepEqual(await fs.readdir(path.join(dir, "cwd")), []);
  });

  it("codex: modelo, cota, timeout e saída sem mensagem", async () => {
    const dir = await temp();
    const com = (p: Partial<{ stderr: string; codigo: number | null; estourouTempo: boolean }>): ExecutorDoCodex => async () =>
      ({ stdout: "", stderr: "", codigo: 0, estourouTempo: false, ...p });
    let args: string[] = [];
    await provedorCodex({ bin: "codex", dir, modelo: "gpt-x", executar: async (_b, a) => { args = a; return { stdout: "", stderr: "", codigo: 0, estourouTempo: false }; } }).gerar("p");
    assert.deepEqual(args.slice(1, 3), ["--model", "gpt-x"]);
    assert.equal((await provedorCodex({ bin: "codex", dir, executar: com({ codigo: 1, stderr: "usage limit reached" }) }).gerar("p") as any).motivo, "cota");
    assert.equal((await provedorCodex({ bin: "codex", dir, executar: com({ codigo: null, estourouTempo: true }) }).gerar("p") as any).motivo, "timeout");
    assert.equal((await provedorCodex({ bin: "codex", dir, executar: com({}) }).gerar("p") as any).motivo, "sem_mensagem");
  });

  it("gemini: pede JSON e devolve o texto; erro classificado", async () => {
    let params: any = null;
    const ai = { models: { generateContent: async (p: any) => { params = p; return { text: BOA }; } } } as any;
    assert.deepEqual(await provedorGemini(ai, "modelo-x").gerar("o prompt"), { ok: true, texto: BOA });
    assert.equal(params.model, "modelo-x");
    assert.equal(params.config.responseMimeType, "application/json");
    assert.equal(params.contents[0].parts[0].text, "o prompt");
    // Erro que não é transitório: sem retentativa (o 429/503 retenta no gerarComRetry e vira ModeloOcupado = "cota").
    const quebrado = { models: { generateContent: async () => { throw new Error("400 INVALID_ARGUMENT"); } } } as any;
    assert.deepEqual(await provedorGemini(quebrado).gerar("p"), { ok: false, motivo: "execucao", detalhe: "400 INVALID_ARGUMENT" });
  });
});

describe("copiloto: configuração e boot", () => {
  it("desligado por padrão, codex por padrão, teto 20", () => {
    assert.deepEqual(lerConfigDoCopiloto({}), { ligado: false, provedor: "codex", tetoDia: 20, bin: "codex" });
  });
  it("lê provedor, teto, modelo e binário", () => {
    assert.deepEqual(
      lerConfigDoCopiloto({ SQUADONE_COPILOTO: "true", SQUADONE_COPILOTO_PROVEDOR: "gemini", SQUADONE_COPILOTO_TETO_DIA: "5", SQUADONE_COPILOTO_MODELO: "m", SQUADONE_CODEX_BIN: "/opt/codex" }),
      { ligado: true, provedor: "gemini", tetoDia: 5, bin: "/opt/codex", modelo: "m" },
    );
  });
  it("valor ilegível lança, não cai no padrão calado", () => {
    assert.throws(() => lerConfigDoCopiloto({ SQUADONE_COPILOTO_PROVEDOR: "openai" }), CopilotoMalConfigurado);
    assert.throws(() => lerConfigDoCopiloto({ SQUADONE_COPILOTO_TETO_DIA: "0" }), CopilotoMalConfigurado);
  });
  it("fora do operations a env é ignorada; sem a flag, nada", async () => {
    const dir = await temp();
    const fontes = { visao: async () => ({ leads: [] }), raioX: async () => null };
    assert.equal(await prepararCopiloto({}, { dataDir: dir, operations: true, fontes }, { log: silencio }), null);
    assert.equal(await prepararCopiloto({ SQUADONE_COPILOTO: "true" }, { dataDir: dir, operations: false, fontes }, { log: silencio }), null);
  });
  it("codex que não confere desliga com motivo", async () => {
    const dir = await temp();
    const fontes = { visao: async () => ({ leads: [] }), raioX: async () => null };
    const erros: string[] = [];
    const executar: ExecutorDoCodex = async () => ({ stdout: "", stderr: "", codigo: null, estourouTempo: false, erro: "ENOENT" });
    const c = await prepararCopiloto({ SQUADONE_COPILOTO: "true" }, { dataDir: dir, operations: true, fontes }, { executar, log: { ...silencio, error: (m: unknown) => erros.push(String(m)) } });
    assert.equal(c, null);
    assert.match(erros[0], /não encontrado/);
  });
  it("gemini sem chave desliga; com chave, liga", async () => {
    const dir = await temp();
    const fontes = { visao: async () => ({ leads: [] }), raioX: async () => null };
    const ai = { models: { generateContent: async () => ({ text: "" }) } } as any;
    const env = { SQUADONE_COPILOTO: "true", SQUADONE_COPILOTO_PROVEDOR: "gemini" };
    assert.equal(await prepararCopiloto(env, { dataDir: dir, operations: true, ai, fontes }, { log: silencio }), null);
    const c = await prepararCopiloto({ ...env, GEMINI_API_KEY: "x" }, { dataDir: dir, operations: true, ai, fontes }, { log: silencio });
    assert.ok(c);
    assert.equal((await c!.estado()).ligado, true);
  });
});

describe("copiloto: o Raio-X no disco", () => {
  it("Site com pasta e o avulso do raio-x-prumo", () => {
    const raizes = { autoDirectory: "/a", entregasPrumo: "/e" };
    assert.deepEqual(
      caminhosDoRaioX({ pasta: { lugar: "_em-conversa", slug: "estrela" }, links: { raioX: "https://raio-x-prumo.vercel.app/estrela" } }, raizes),
      [path.join("/a", "_em-conversa", "estrela", "raio-x.html"), path.join("/e", "prumo-raio-x", "estrela.html")],
    );
  });
  it("o lugar como a visão do CRM entrega: \"_em-conversa/\" e \"raiz\"", () => {
    const raizes = { autoDirectory: "/a" };
    assert.deepEqual(caminhosDoRaioX({ pasta: { lugar: "_em-conversa/", slug: "estrela" }, links: {} }, raizes), [path.join("/a", "_em-conversa", "estrela", "raio-x.html")]);
    assert.deepEqual(caminhosDoRaioX({ pasta: { lugar: "raiz", slug: "estrela" }, links: {} }, raizes), [path.join("/a", "estrela", "raio-x.html")]);
    assert.deepEqual(caminhosDoRaioX({ pasta: { lugar: "../", slug: "estrela" }, links: {} }, raizes), []);
  });
  it("slug ou lugar com ../ não vira caminho; link de outro domínio também não", () => {
    const raizes = { autoDirectory: "/a", entregasPrumo: "/e" };
    assert.deepEqual(caminhosDoRaioX({ pasta: { lugar: "..", slug: "x" }, links: { raioX: "https://raio-x-prumo.vercel.app/..%2Fsegredo" } }, raizes), []);
    assert.deepEqual(caminhosDoRaioX({ links: { raioX: "https://demo-x.vercel.app/raio-x" } }, raizes), []);
  });
  it("lê o primeiro que existe; nenhum = null", async () => {
    const raiz = await temp();
    await fs.mkdir(path.join(raiz, "prumo-raio-x"), { recursive: true });
    await fs.writeFile(path.join(raiz, "prumo-raio-x", "estrela.html"), "<p>oi</p>");
    const lead = leadCrm({ links: { raioX: "https://raio-x-prumo.vercel.app/estrela" } });
    assert.equal(await lerRaioXDoDisco(lead, { entregasPrumo: raiz }), "<p>oi</p>");
    assert.equal(await lerRaioXDoDisco(leadCrm(), { entregasPrumo: raiz }), null);
  });
});
