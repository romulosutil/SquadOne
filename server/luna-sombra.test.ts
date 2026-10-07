/**
 * Luna em sombra: a leitura da saída dela (dado, nunca instrução), a comparação
 * com o Gemini, as flags do --help e a cola com o `codex` dublado. Tudo grava
 * num diretório temporário; o `codex` nunca roda.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, before, describe, it } from "node:test";
// Só tipos: apagados na transpilação, então o módulo ainda carrega DEPOIS da env.
import type { ChamadaDeCapacidade, ExecutorDoCodex, ObservacaoDeTurno, ProcessoDoCodex, RegistroDaSombra } from "./luna-sombra.ts";

process.env.SQUADONE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-luna-dados-"));

const {
  compararChamadas,
  contarLinhasDoDia,
  criarSombra,
  diaLocal,
  flagsAusentes,
  FLAGS_DO_CODEX,
  interpretarSaidaDaLuna,
  lerConfigDaSombra,
  MODELO_LUNA,
  prepararSombra,
  promptDaSombra,
  SombraMalConfigurada,
} = await import("./luna-sombra.ts");
const { declarations } = await import("./capabilities.ts");

const NOMES = ["agendar_evento", "criar_tarefa", "criar_po_dominio", "contratar_integrante", "sugerir_troca_squad"];
const silencio = { log() {}, warn() {}, error() {} };

const chamada = (nome: string, args: Record<string, unknown> = {}): ChamadaDeCapacidade => ({ nome, args });
const bloco = (extra: Record<string, unknown> = {}) =>
  chamada("agendar_evento", { titulo: "Revisar contrato", responsavel_id: "ana", tipo: "time_blocking", duracao_min: 60, a_partir_de: "2026-10-08", ...extra });

describe("interpretarSaidaDaLuna (a resposta é dado)", () => {
  const casos: [string, string, string][] = [
    ["JSON puro", '{"chamadas":[{"nome":"agendar_evento","args":{"titulo":"x"}}]}', "ok"],
    ["com cerca de código", '```json\n{"chamadas":[{"nome":"criar_tarefa","args":{"titulo":"x"}}]}\n```', "ok"],
    ["texto antes e depois", 'Aqui vai:\n{"chamadas":[]}\nPronto.', "ok"],
    ["args ausente vira objeto vazio", '{"chamadas":[{"nome":"criar_tarefa"}]}', "ok"],
    ["vazio", "   ", "vazio"],
    ["lixo", "não sei o que fazer com isso", "json_invalido"],
    ["nome fora do schema", '{"chamadas":[{"nome":"apagar_tudo","args":{}}]}', "nome_desconhecido"],
    ["sem a lista", '{"resposta":"ok"}', "formato"],
    ["lista de strings", '{"chamadas":["agendar_evento"]}', "formato"],
    ["args que não é objeto", '{"chamadas":[{"nome":"agendar_evento","args":[1]}]}', "formato"],
  ];
  for (const [nome, texto, esperado] of casos) {
    it(nome, () => {
      const r = interpretarSaidaDaLuna(texto, NOMES);
      assert.equal(r.ok === false ? r.motivo : "ok", esperado);
    });
  }

  it("devolve as chamadas na ordem e com os args", () => {
    const r = interpretarSaidaDaLuna('{"chamadas":[{"nome":"agendar_evento","args":{"duracao_min":30}},{"nome":"criar_tarefa"}]}', NOMES);
    assert.ok(r.ok);
    assert.deepEqual(r.chamadas, [{ nome: "agendar_evento", args: { duracao_min: 30 } }, { nome: "criar_tarefa", args: {} }]);
  });

  it("o detalhe da falha nunca repete o texto da Luna", () => {
    const r = interpretarSaidaDaLuna("a demanda secreta do usuário era X", NOMES);
    assert.ok(r.ok === false && !r.detalhe.includes("secreta"));
  });

  it("os nomes padrão são os de declarations()", () => {
    const r = interpretarSaidaDaLuna('{"chamadas":[{"nome":"sugerir_troca_squad","args":{"squad_id":"prumo"}}]}');
    assert.ok(r.ok);
    assert.deepEqual(declarations().map((d) => d.name).sort(), [...NOMES].sort());
  });
});

describe("compararChamadas", () => {
  const casos: [string, ChamadaDeCapacidade[], ChamadaDeCapacidade[], string][] = [
    ["mesma chamada", [bloco()], [bloco({ titulo: "outro título" })], "igual"],
    ["duração 20 % acima", [bloco()], [bloco({ duracao_min: 72 })], "igual"],
    ["duração 30 % acima", [bloco()], [bloco({ duracao_min: 78 })], "parcial"],
    ["duração 25 % abaixo", [bloco()], [bloco({ duracao_min: 45 })], "igual"],
    ["duração como texto", [bloco()], [bloco({ duracao_min: "60" })], "igual"],
    ["data diferente", [bloco()], [bloco({ a_partir_de: "2026-10-09" })], "parcial"],
    ["responsável diferente", [bloco()], [bloco({ responsavel_id: "bia" })], "parcial"],
    ["tipo diferente", [bloco()], [bloco({ tipo: "deadline", prazo_final: "2026-10-10", esforco_min: 120 })], "parcial"],
    ["troca de squad igual", [chamada("sugerir_troca_squad", { squad_id: "prumo", justificativa: "a" })], [chamada("sugerir_troca_squad", { squad_id: "prumo", justificativa: "b" })], "igual"],
    ["troca de squad diferente", [chamada("sugerir_troca_squad", { squad_id: "prumo" })], [chamada("sugerir_troca_squad", { squad_id: "pj" })], "parcial"],
    ["Gemini sem chamada, Luna com", [], [bloco()], "diferente"],
    ["Luna sem chamada, Gemini com", [bloco()], [], "diferente"],
    ["nenhum dos dois chamou", [], [], "igual"],
    ["capacidades distintas", [bloco()], [chamada("criar_tarefa", { titulo: "x", responsavel_id: "ana" })], "diferente"],
    ["Luna com uma a mais", [bloco()], [bloco(), chamada("criar_tarefa", { responsavel_id: "ana" })], "parcial"],
    ["Gemini com uma a mais", [bloco(), chamada("criar_tarefa", { responsavel_id: "ana" })], [bloco()], "parcial"],
    ["duas iguais fora de ordem", [bloco(), chamada("criar_tarefa", { responsavel_id: "ana", data: "2026-10-10" })], [chamada("criar_tarefa", { responsavel_id: "ana", data: "2026-10-10" }), bloco()], "igual"],
  ];
  for (const [nome, gemini, luna, esperado] of casos) {
    it(nome, () => assert.equal(compararChamadas(gemini, luna).veredito, esperado));
  }

  it("os detalhes dizem o campo e os dois valores, e nunca levam o título", () => {
    const { detalhes } = compararChamadas([bloco()], [bloco({ duracao_min: 90, responsavel_id: "bia" })]);
    assert.equal(detalhes.length, 1);
    assert.equal(detalhes[0].resultado, "divergente");
    assert.deepEqual(detalhes[0].divergencias, ["responsavel_id: ana → bia", "duracao_min: 60 → 90"]);
    assert.equal("titulo" in (detalhes[0].gemini ?? {}), false);
    assert.equal(detalhes[0].gemini?.a_partir_de, "2026-10-08");
  });

  it("escolhe, entre duas da Luna com o mesmo nome, a que menos diverge", () => {
    const { detalhes, veredito } = compararChamadas([bloco()], [bloco({ responsavel_id: "bia", duracao_min: 120 }), bloco()]);
    assert.equal(veredito, "parcial");
    assert.deepEqual(detalhes.map((d) => d.resultado), ["igual", "so_luna"]);
  });

  it("passos entram como contagem", () => {
    const { detalhes } = compararChamadas([bloco({ passos: ["a", "b"] })], [bloco({ passos: ["a"] })]);
    assert.equal(detalhes[0].gemini?.passos, 2);
    assert.equal(detalhes[0].luna?.passos, 1);
    assert.equal(detalhes[0].resultado, "igual");
  });
});

describe("flagsAusentes (a conferência do codex no boot)", () => {
  const help = [
    "Run Codex non-interactively",
    "Usage: codex exec [OPTIONS] [PROMPT]",
    "  -m, --model <MODEL>                 Model the agent should use",
    "  -s, --sandbox <SANDBOX_MODE>        [possible values: read-only, workspace-write]",
    "      --skip-git-repo-check           Allow running outside a Git repository",
    "  -o, --output-last-message <FILE>    Write the last message to a file",
  ].join("\n");
  it("ajuda completa: nada falta", () => assert.deepEqual(flagsAusentes(help), []));
  it("sem --output-last-message", () => {
    assert.deepEqual(flagsAusentes(help.replace("--output-last-message", "--output")), ["--output-last-message"]);
  });
  it("--model-reasoning não vale por --model", () => {
    assert.deepEqual(flagsAusentes("--model-reasoning <X>", ["--model"]), ["--model"]);
  });
  it("ajuda vazia: faltam todas", () => assert.deepEqual(flagsAusentes(""), [...FLAGS_DO_CODEX]));
});

describe("lerConfigDaSombra", () => {
  it("ausente = desligada, teto 10, codex do PATH", () => {
    assert.deepEqual(lerConfigDaSombra({}), { ligada: false, tetoDia: 10, guardarDemanda: false, bin: "codex" });
  });
  it("true liga; teto e binário lidos", () => {
    const c = lerConfigDaSombra({ SQUADONE_LUNA_SOMBRA: "true", SQUADONE_LUNA_TETO_DIA: "3", SQUADONE_CODEX_BIN: "/opt/codex", SQUADONE_LUNA_GUARDAR_DEMANDA: "true" });
    assert.deepEqual(c, { ligada: true, tetoDia: 3, guardarDemanda: true, bin: "/opt/codex" });
  });
  for (const teto of ["0", "-1", "dez", "2.5"]) {
    it(`teto '${teto}' lança`, () => assert.throws(() => lerConfigDaSombra({ SQUADONE_LUNA_TETO_DIA: teto }), SombraMalConfigurada));
  }
});

describe("promptDaSombra", () => {
  it("leva o systemInstruction, a demanda e as capacidades, e pede só o JSON", () => {
    const p = promptDaSombra("Você é o PO raiz.", "reunião amanhã", declarations());
    assert.ok(p.startsWith("Você é o PO raiz."));
    assert.ok(p.includes("reunião amanhã"));
    for (const n of NOMES) assert.ok(p.includes(`"nome": "${n}"`), n);
    assert.ok(p.includes('{"chamadas":[{"nome":"<nome da capacidade>","args":{...}}]}'));
  });
});

// --- A cola, com o codex dublado ------------------------------------------------

const AGORA = new Date("2026-10-07T15:00:00-03:00");
const observacao = (demanda = "revisar o contrato amanhã", extra: Partial<ObservacaoDeTurno> = {}): ObservacaoDeTurno => ({
  systemInstruction: "Você é o PO raiz da squad 'Pessoal'.",
  demanda,
  chamadasDoGemini: [{ name: "agendar_evento", args: { titulo: "Revisar contrato", responsavel_id: "ana", tipo: "time_blocking", duracao_min: 60 } }],
  squadId: "pessoal",
  modo: "auto",
  ...extra,
});

interface Execucao {
  bin: string;
  args: string[];
  cwd?: string;
  stdin?: string;
}

/**
 * codex dublê: cada resposta é o texto da última mensagem (escrito no arquivo
 * de --output-last-message, como o codex faz) ou um processo pronto.
 */
function codexDuble(respostas: (string | Partial<ProcessoDoCodex>)[], opcoes: { demoraMs?: number } = {}) {
  const execucoes: Execucao[] = [];
  let simultaneas = 0;
  let maxSimultaneas = 0;
  const executar: ExecutorDoCodex = async (bin, args, { cwd, stdin }) => {
    execucoes.push({ bin, args, cwd, stdin });
    simultaneas++;
    maxSimultaneas = Math.max(maxSimultaneas, simultaneas);
    try {
      if (opcoes.demoraMs) await new Promise((r) => setTimeout(r, opcoes.demoraMs));
      const r = respostas.shift() ?? '{"chamadas":[]}';
      if (typeof r === "string") {
        const arquivo = args[args.indexOf("--output-last-message") + 1];
        await fs.writeFile(arquivo, r, "utf8");
        return { stdout: "progresso...\n", stderr: "", codigo: 0, estourouTempo: false };
      }
      return { stdout: "", stderr: "", codigo: 0, estourouTempo: false, ...r };
    } finally {
      simultaneas--;
    }
  };
  return { executar, execucoes, maxSimultaneas: () => maxSimultaneas };
}

async function linhasDe(dir: string, quando = AGORA): Promise<RegistroDaSombra[]> {
  const arquivo = path.join(dir, `${diaLocal(quando).slice(0, 7)}.jsonl`);
  const texto = await fs.readFile(arquivo, "utf8");
  return texto.trim().split("\n").map((l) => JSON.parse(l));
}

describe("criarSombra (fila, teto, arquivo)", () => {
  const dirs: string[] = [];
  const tmp = async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-luna-"));
    dirs.push(d);
    return d;
  };
  afterEach(async () => {
    for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
  });

  it("grava uma linha do mês com veredito, hash e sem a demanda, com o codex chamado como combinado", async () => {
    const dir = await tmp();
    const codex = codexDuble(['{"chamadas":[{"nome":"agendar_evento","args":{"titulo":"Contrato","responsavel_id":"ana","tipo":"time_blocking","duracao_min":70}}]}']);
    const sombra = criarSombra({ dir, bin: "codex", tetoDia: 10, guardarDemanda: false, executar: codex.executar, agora: () => AGORA, log: silencio });
    sombra.observar(observacao());
    await sombra.aguardar();

    const [linha] = await linhasDe(dir);
    assert.equal(linha.veredito, "igual");
    assert.equal(linha.squad, "pessoal");
    assert.equal(linha.modo, "auto");
    assert.equal(linha.tamanhoDaDemanda, "revisar o contrato amanhã".length);
    assert.match(linha.hashDaDemanda, /^[0-9a-f]{64}$/);
    assert.equal("demanda" in linha, false);
    assert.equal(JSON.stringify(linha).includes("revisar o contrato"), false);
    assert.equal(JSON.stringify(linha).includes("Contrato"), false, "título não entra no registro");
    assert.deepEqual(linha.gemini, [{ nome: "agendar_evento", responsavel_id: "ana", tipo: "time_blocking", duracao_min: 60 }]);
    assert.deepEqual(linha.luna, [{ nome: "agendar_evento", responsavel_id: "ana", tipo: "time_blocking", duracao_min: 70 }]);

    const [exec] = codex.execucoes;
    assert.equal(exec.bin, "codex");
    assert.deepEqual(exec.args.slice(0, 7), ["exec", "--model", MODELO_LUNA, "--sandbox", "read-only", "--skip-git-repo-check", "--output-last-message"]);
    assert.equal(path.dirname(exec.args[7]), path.join(dir, "cwd"));
    assert.equal(exec.cwd, path.join(dir, "cwd"));
    assert.ok(exec.stdin!.includes("Você é o PO raiz da squad 'Pessoal'."));
    assert.ok(exec.stdin!.includes("revisar o contrato amanhã"));
    // A resposta foi lida e apagada; o cwd fica vazio.
    assert.deepEqual(await fs.readdir(path.join(dir, "cwd")), []);
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(path.join(dir, `${diaLocal(AGORA).slice(0, 7)}.jsonl`))).mode & 0o777, 0o600);
      assert.equal((await fs.stat(path.join(dir, "cwd"))).mode & 0o777, 0o700);
    }
  });

  it("a demanda em claro só com guardarDemanda", async () => {
    const dir = await tmp();
    const sombra = criarSombra({ dir, bin: "codex", tetoDia: 10, guardarDemanda: true, executar: codexDuble([]).executar, agora: () => AGORA, log: silencio });
    sombra.observar(observacao("comprar leite"));
    await sombra.aguardar();
    const [linha] = await linhasDe(dir);
    assert.equal(linha.demanda, "comprar leite");
    assert.equal(linha.veredito, "diferente");
  });

  it("falha da Luna vira linha com `falha`, sem derrubar nada", async () => {
    const dir = await tmp();
    const codex = codexDuble(["isso não é JSON", { codigo: 1, stderr: "error: something broke\nmais" }, { estourouTempo: true, codigo: null }, { codigo: 0 }]);
    const sombra = criarSombra({ dir, bin: "codex", tetoDia: 10, guardarDemanda: false, executar: codex.executar, agora: () => AGORA, log: silencio });
    for (let i = 0; i < 4; i++) sombra.observar(observacao());
    await sombra.aguardar();
    const linhas = await linhasDe(dir);
    assert.deepEqual(linhas.map((l) => l.veredito), ["falhou", "falhou", "falhou", "falhou"]);
    assert.deepEqual(linhas.map((l) => l.falha?.motivo), ["json_invalido", "execucao", "timeout", "sem_mensagem"]);
    assert.equal(linhas[1].falha?.detalhe, "código 1: error: something broke");
    assert.equal(linhas[1].luna, null);
  });

  it("teto diário: para no teto, avisa uma vez e volta no dia seguinte", async () => {
    const dir = await tmp();
    const codex = codexDuble([]);
    let agora = AGORA;
    const avisos: string[] = [];
    const sombra = criarSombra({ dir, bin: "codex", tetoDia: 2, guardarDemanda: false, executar: codex.executar, agora: () => agora, log: { ...silencio, log: (m) => avisos.push(String(m)) } });
    for (let i = 0; i < 4; i++) sombra.observar(observacao());
    await sombra.aguardar();
    assert.equal(codex.execucoes.length, 2);
    assert.equal(avisos.filter((a) => a.includes("teto do dia")).length, 1);

    agora = new Date("2026-10-08T03:01:00Z"); // 00:01 em São Paulo: dia novo
    sombra.observar(observacao());
    await sombra.aguardar();
    assert.equal(codex.execucoes.length, 3);
  });

  it("o teto conta as linhas já gravadas hoje: reiniciar não zera", async () => {
    const dir = await tmp();
    const antes = criarSombra({ dir, bin: "codex", tetoDia: 5, guardarDemanda: false, executar: codexDuble([]).executar, agora: () => AGORA, log: silencio });
    antes.observar(observacao());
    antes.observar(observacao());
    await antes.aguardar();

    const codex = codexDuble([]);
    const depois = criarSombra({ dir, bin: "codex", tetoDia: 3, guardarDemanda: false, executar: codex.executar, agora: () => AGORA, log: silencio });
    for (let i = 0; i < 3; i++) depois.observar(observacao());
    await depois.aguardar();
    assert.equal(codex.execucoes.length, 1);
    assert.equal((await linhasDe(dir)).length, 3);
    assert.equal(await contarLinhasDoDia(path.join(dir, "2026-10.jsonl"), "2026-10-07"), 3);
  });

  it("a fila é serial: uma execução por vez", async () => {
    const dir = await tmp();
    const codex = codexDuble([], { demoraMs: 15 });
    const sombra = criarSombra({ dir, bin: "codex", tetoDia: 10, guardarDemanda: false, executar: codex.executar, agora: () => AGORA, log: silencio });
    for (let i = 0; i < 3; i++) sombra.observar(observacao());
    await sombra.aguardar();
    assert.equal(codex.execucoes.length, 3);
    assert.equal(codex.maxSimultaneas(), 1);
  });

  it("erro de cota: uma linha, log uma vez, parada até o dia seguinte", async () => {
    const dir = await tmp();
    const codex = codexDuble([{ codigo: 1, stderr: "Error: You have hit your usage limit." }]);
    let agora = AGORA;
    const warns: string[] = [];
    const sombra = criarSombra({ dir, bin: "codex", tetoDia: 10, guardarDemanda: false, executar: codex.executar, agora: () => agora, log: { ...silencio, warn: (m) => warns.push(String(m)) } });
    for (let i = 0; i < 3; i++) sombra.observar(observacao());
    await sombra.aguardar();
    assert.equal(codex.execucoes.length, 1);
    assert.equal(warns.filter((w) => w.includes("cota")).length, 1);
    const linhas = await linhasDe(dir);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].falha?.motivo, "cota");

    agora = new Date("2026-10-08T03:01:00Z");
    sombra.observar(observacao());
    await sombra.aguardar();
    assert.equal(codex.execucoes.length, 2);
  });

  it("observar nunca lança nem rejeita, mesmo com o executor quebrado", async () => {
    const dir = await tmp();
    const warns: string[] = [];
    const sombra = criarSombra({
      dir, bin: "codex", tetoDia: 10, guardarDemanda: false,
      executar: async () => { throw new Error("boom"); },
      agora: () => AGORA,
      log: { ...silencio, warn: (m) => warns.push(String(m)) },
    });
    assert.doesNotThrow(() => sombra.observar(observacao()));
    await sombra.aguardar();
    assert.ok(warns.some((w) => w.includes("boom")));
  });
});

describe("prepararSombra (o boot)", () => {
  let dataDir: string;
  before(async () => { dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-luna-boot-")); });
  const HELP = "Usage: codex exec [OPTIONS] [PROMPT]\n  -m, --model <MODEL>\n  -s, --sandbox <MODE>\n      --skip-git-repo-check\n  -o, --output-last-message <FILE>\n";
  const ok: ExecutorDoCodex = async () => ({ stdout: HELP, stderr: "", codigo: 0, estourouTempo: false });
  const contexto = () => ({ dataDir, operations: true, agendaAtiva: true });

  it("desligada por padrão, sem rodar o codex", async () => {
    let chamou = false;
    const r = await prepararSombra({}, contexto(), { executar: async () => { chamou = true; return { stdout: HELP, stderr: "", codigo: 0, estourouTempo: false }; }, log: silencio });
    assert.equal(r, null);
    assert.equal(chamou, false);
  });

  it("ligada fora do operations ou sem a agenda: ignorada com log", async () => {
    const logs: string[] = [];
    const log = { ...silencio, log: (m: unknown) => logs.push(String(m)) };
    assert.equal(await prepararSombra({ SQUADONE_LUNA_SOMBRA: "true" }, { ...contexto(), operations: false }, { executar: ok, log }), null);
    assert.equal(await prepararSombra({ SQUADONE_LUNA_SOMBRA: "true" }, { ...contexto(), agendaAtiva: false }, { executar: ok, log }), null);
    assert.equal(logs.filter((l) => l.includes("ignorada")).length, 2);
  });

  const falhas: [string, ProcessoDoCodex, RegExp][] = [
    ["binário fora do PATH", { stdout: "", stderr: "", codigo: null, estourouTempo: false, erro: "ENOENT" }, /não encontrado/],
    ["--help com código 2", { stdout: "", stderr: "unknown subcommand", codigo: 2, estourouTempo: false }, /código 2/],
    ["flag que falta", { stdout: HELP.replace("--skip-git-repo-check", "--skip-git"), stderr: "", codigo: 0, estourouTempo: false }, /--skip-git-repo-check/],
  ];
  for (const [nome, processo, re] of falhas) {
    it(`${nome}: desligada com log`, async () => {
      const erros: string[] = [];
      const r = await prepararSombra({ SQUADONE_LUNA_SOMBRA: "true" }, contexto(), { executar: async () => processo, log: { ...silencio, error: (m) => erros.push(String(m)) } });
      assert.equal(r, null);
      assert.equal(erros.length, 1);
      assert.match(erros[0], re);
      assert.match(erros[0], /sombra desligada/);
    });
  }

  it("teto ilegível: desligada com log, sem rodar o codex", async () => {
    const erros: string[] = [];
    const r = await prepararSombra({ SQUADONE_LUNA_SOMBRA: "true", SQUADONE_LUNA_TETO_DIA: "x" }, contexto(), { executar: ok, log: { ...silencio, error: (m) => erros.push(String(m)) } });
    assert.equal(r, null);
    assert.match(erros[0], /SQUADONE_LUNA_TETO_DIA/);
  });

  it("tudo certo: confere o --help, cria o cwd e devolve a sombra", async () => {
    const chamadas: string[][] = [];
    const logs: string[] = [];
    const r = await prepararSombra(
      { SQUADONE_LUNA_SOMBRA: "true", SQUADONE_CODEX_BIN: "/opt/bin/codex" },
      contexto(),
      { executar: async (bin, args) => { chamadas.push([bin, ...args]); return ok(bin, args, { timeoutMs: 1 }); }, log: { ...silencio, log: (m) => logs.push(String(m)) } },
    );
    assert.ok(r);
    assert.deepEqual(chamadas, [["/opt/bin/codex", "exec", "--help"]]);
    assert.ok((await fs.stat(path.join(dataDir, "luna-sombra", "cwd"))).isDirectory());
    assert.ok(logs.some((l) => l.includes("sombra ligada") && l.includes("teto 10/dia")));
  });
});
