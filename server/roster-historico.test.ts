/**
 * Histórico do roster: cada `writeRoster` guarda o `squad.json` ANTERIOR em
 * `historico/`. Roda num diretório temporário: o cwd vai para ele (assim, sem
 * SQUADONE_DATA_DIR, o padrão `./data` também é do teste, nunca do repositório)
 * e SQUADONE_DATA_DIR é definida ANTES do import dinâmico. Nada grava em `data/`.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, it, mock } from "node:test";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-historico-"));
process.chdir(tmp);
const dados = path.join(tmp, "dados");
process.env.SQUADONE_DATA_DIR = dados;
delete process.env.SQUADONE_ROSTER_CONGELADO;

const squad = await import("./squad.ts");
const hist = await import("./roster-historico.ts");

const pasta = path.join(dados, "historico");
const squadJson = path.join(dados, "squad.json");

/** Roster mínimo válido (atualizarRoster relê com validação), distinguível pela `marca`. */
const pessoa = (id: string) => ({ id, nome: id, papel: "PO", escopo: "treino", sprite: "x", hiredAt: "2026-09-01" });
const versao = (n: number) => ({
  version: 3,
  idsAposentados: { pessoas: [], dominios: [] },
  squads: [{
    id: "pessoal", nome: "Pessoal", escopo: "vida", calendarId: "primary", unlockOrder: [[0, 0]],
    dominios: [{ id: "geral", nome: "Geral", escopo: "tema", slot: [0, 0], room: "ROOM_SOLO", criadoEm: "2026-09-01", po: pessoa("po"), integrantes: [] }],
  }],
  marca: `v${n}`,
}) as any;
const marcaDe = async (arquivo: string) => JSON.parse(await fs.readFile(arquivo, "utf8")).marca;
const copias = async () => hist.nomesDasCopias(dados);

async function zerar(): Promise<void> {
  process.env.SQUADONE_DATA_DIR = dados;
  delete process.env.SQUADONE_ROSTER_CONGELADO;
  await fs.rm(dados, { recursive: true, force: true });
  await fs.rm(path.join(tmp, "data"), { recursive: true, force: true });
  await fs.mkdir(dados, { recursive: true });
  hist.reiniciarLogDeFalhas();
}

describe("nomeDaCopia e dataDoNome", () => {
  it("nome sem ':' e que ordena como texto", () => {
    assert.equal(hist.nomeDaCopia(new Date("2026-10-07T14:30:15.999Z")), "squad.2026-10-07T143015Z.json");
    assert.ok(hist.nomeDaCopia(new Date("2026-10-07T14:30:15Z")) < hist.nomeDaCopia(new Date("2026-10-07T14:30:16Z")));
    assert.ok(hist.nomeDaCopia(new Date("2026-12-31T23:59:59Z")) < hist.nomeDaCopia(new Date("2027-01-01T00:00:00Z")));
  });

  it("dataDoNome devolve a data, e null para o que não é cópia nossa", () => {
    assert.equal(hist.dataDoNome("squad.2026-10-07T143015Z.json")?.toISOString(), "2026-10-07T14:30:15.000Z");
    for (const ruim of ["squad.json", "squad.v2.bak.json", "squad.2026-13-01T000000Z.json", "squad.2026-02-31T000000Z.json", ".squad.2026-10-07T143015Z.json.1.tmp", "outra.2026-10-07T143015Z.json"]) {
      assert.equal(hist.dataDoNome(ruim), null, ruim);
    }
  });
});

describe("quaisPodar", () => {
  const agora = new Date("2026-10-07T12:00:00Z");
  const opcoes = { manter: 30, dias: 90 };
  /** n cópias, uma por dia, terminando `fim` dias antes de agora (nome em ordem). */
  const diarias = (n: number, fim: number) =>
    Array.from({ length: n }, (_, i) => hist.nomeDaCopia(new Date(agora.getTime() - (fim + n - 1 - i) * 86_400_000)));

  const casos: { quando: string; nomes: string[]; opcoes?: { manter: number; dias: number }; podar: number }[] = [
    { quando: "vazio", nomes: [], podar: 0 },
    { quando: "menos que o teto, todas recentes", nomes: diarias(5, 0), podar: 0 },
    { quando: "31 recentes (dentro de 90 dias): todas ficam", nomes: diarias(31, 0), podar: 0 },
    { quando: "40 dentro de 90 dias: todas ficam (os dias vencem as 30)", nomes: diarias(40, 0), podar: 0 },
    { quando: "5 cópias de mais de 90 dias, só elas: ficam (cabem nas 30)", nomes: diarias(5, 200), podar: 0 },
    { quando: "35 de mais de 90 dias: sai a 5 mais antigas", nomes: diarias(35, 200), podar: 5 },
    { quando: "100 diárias terminando hoje: saem as 9 de mais de 90 dias fora das 30", nomes: diarias(100, 0), podar: 9 },
    { quando: "manter 0 e dias 0: só a do próprio instante fica", nomes: diarias(3, 0), opcoes: { manter: 0, dias: 0 }, podar: 2 },
    { quando: "nome que não é cópia nunca é podado", nomes: ["squad.json", "squad.v2.bak.json", ...diarias(35, 200)], podar: 5 },
  ];
  for (const c of casos) {
    it(c.quando, () => assert.equal(hist.quaisPodar(c.nomes, agora, c.opcoes ?? opcoes).length, c.podar));
  }

  it("poda sempre as mais antigas", () => {
    const nomes = diarias(35, 200);
    assert.deepEqual(hist.quaisPodar(nomes, agora, opcoes), [...nomes].sort().slice(0, 5));
  });

  it("limite de 90 dias: o dia exato ainda fica", () => {
    const noLimite = hist.nomeDaCopia(new Date(agora.getTime() - 90 * 86_400_000));
    const passou = hist.nomeDaCopia(new Date(agora.getTime() - 90 * 86_400_000 - 1000));
    assert.deepEqual(hist.quaisPodar([noLimite, passou], agora, { manter: 0, dias: 90 }), [passou]);
  });
});

describe("writeRoster guarda o anterior", () => {
  beforeEach(zerar);

  it("sem squad.json anterior não há o que copiar (nem pasta)", async () => {
    await squad.writeRoster(versao(1));
    assert.equal(await marcaDe(squadJson), "v1");
    await assert.rejects(fs.stat(pasta));
  });

  it("grava: 1 cópia com o conteúdo ANTERIOR e squad.json novo", async () => {
    await squad.writeRoster(versao(1));
    await squad.writeRoster(versao(2));
    const nomes = await copias();
    assert.equal(nomes.length, 1);
    assert.equal(await marcaDe(path.join(pasta, nomes[0])), "v1");
    assert.equal(await marcaDe(squadJson), "v2");
  });

  it("a cópia é byte a byte o arquivo de antes", async () => {
    await squad.writeRoster(versao(1));
    const antes = await fs.readFile(squadJson);
    await squad.writeRoster(versao(2));
    const [nome] = await copias();
    assert.deepEqual(await fs.readFile(path.join(pasta, nome)), antes);
  });

  it("modo 600 (não há bits de grupo no Windows)", { skip: process.platform === "win32" }, async () => {
    await squad.writeRoster(versao(1));
    await squad.writeRoster(versao(2));
    const [nome] = await copias();
    assert.equal((await fs.stat(path.join(pasta, nome))).mode & 0o777, 0o600);
  });

  it("não deixa .tmp para trás", async () => {
    await squad.writeRoster(versao(1));
    await squad.writeRoster(versao(2));
    assert.deepEqual((await fs.readdir(pasta)).filter((n) => n.endsWith(".tmp")), []);
  });

  it("atualizarRoster também guarda (pela fila)", async () => {
    await squad.writeRoster(versao(1));
    await squad.atualizarRoster((r: any) => {
      r.marca = "v2";
    });
    const nomes = await copias();
    assert.equal(nomes.length, 1);
    assert.equal(await marcaDe(path.join(pasta, nomes[0])), "v1");
  });

  it("mutador que lança não grava nem copia", async () => {
    await squad.writeRoster(versao(1));
    await assert.rejects(squad.atualizarRoster(() => {
      throw new Error("recusado");
    }));
    assert.equal((await copias()).length, 0);
    assert.equal(await marcaDe(squadJson), "v1");
  });

  it("31 gravações espaçadas além de 90 dias: ficam 30 cópias e a mais antiga saiu", async () => {
    // Relógio simulado: com o relógio real as 31 cópias nascem no mesmo minuto
    // e TODAS estão dentro de 90 dias, que é justamente o que as faz ficar.
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-01T12:00:00Z") });
    try {
      await squad.writeRoster(versao(0));
      for (let i = 1; i <= 31; i++) {
        mock.timers.setTime(new Date("2026-01-01T12:00:00Z").getTime() + i * 100 * 86_400_000);
        await squad.writeRoster(versao(i));
      }
    } finally {
      mock.timers.reset();
    }
    const nomes = await copias();
    assert.equal(nomes.length, 30);
    const marcas = await Promise.all(nomes.map((n) => marcaDe(path.join(pasta, n))));
    assert.equal(marcas.includes("v0"), false);
    assert.equal(marcas[0], "v1");
    assert.equal(marcas[29], "v30");
  });

  it("31 gravações no mesmo dia: as 31 ficam (dentro dos 90 dias, o critério que guarda mais vence)", async () => {
    await squad.writeRoster(versao(0));
    for (let i = 1; i <= 31; i++) await squad.writeRoster(versao(i));
    const nomes = await copias();
    assert.equal(nomes.length, 31);
    assert.equal(new Set(nomes).size, 31, "gravações no mesmo segundo não podem apagar a cópia anterior");
  });

  it("cópias de mais de 90 dias, dentro das 30, ficam", async () => {
    await fs.mkdir(pasta, { recursive: true });
    const velhas = ["2025-01-01T000000Z", "2025-02-01T000000Z", "2025-03-01T000000Z"].map((d) => `squad.${d}.json`);
    for (const n of velhas) await fs.writeFile(path.join(pasta, n), "{}");
    await squad.writeRoster(versao(1));
    await squad.writeRoster(versao(2));
    const nomes = await copias();
    assert.equal(nomes.length, 4);
    for (const n of velhas) assert.ok(nomes.includes(n), n);
  });

  it("passou de 30 e de 90 dias: sai a mais velha", async () => {
    await fs.mkdir(pasta, { recursive: true });
    const velhas = Array.from({ length: 30 }, (_, i) => `squad.2025-01-${String(i + 1).padStart(2, "0")}T000000Z.json`);
    for (const n of velhas) await fs.writeFile(path.join(pasta, n), "{}");
    await squad.writeRoster(versao(1));
    await squad.writeRoster(versao(2));
    const nomes = await copias();
    assert.equal(nomes.length, 30);
    assert.equal(nomes.includes(velhas[0]), false);
  });

  it("outros arquivos da pasta não são tocados", async () => {
    await fs.mkdir(pasta, { recursive: true });
    await fs.writeFile(path.join(pasta, "anotacao.txt"), "meu");
    await squad.writeRoster(versao(1));
    await squad.writeRoster(versao(2));
    assert.equal(await fs.readFile(path.join(pasta, "anotacao.txt"), "utf8"), "meu");
  });
});

describe("histórico inerte", () => {
  beforeEach(zerar);

  it("SQUADONE_ROSTER_CONGELADO=true: grava o roster e não cria a pasta", async () => {
    await squad.writeRoster(versao(1));
    process.env.SQUADONE_ROSTER_CONGELADO = "true";
    await squad.writeRoster(versao(2));
    assert.equal(await marcaDe(squadJson), "v2");
    await assert.rejects(fs.stat(pasta));
  });

  it("sem SQUADONE_DATA_DIR: nenhuma pasta, nem no padrão ./data", async () => {
    delete process.env.SQUADONE_DATA_DIR;
    await squad.writeRoster(versao(1));
    await squad.writeRoster(versao(2));
    assert.equal(await marcaDe(path.join(tmp, "data", "squad.json")), "v2");
    await assert.rejects(fs.stat(path.join(tmp, "data", "historico")));
    await assert.rejects(fs.stat(pasta));
  });
});

describe("falha do histórico não impede a gravação", () => {
  beforeEach(zerar);

  it("pasta impossível: o roster grava e o erro vai ao log uma vez só", async () => {
    await squad.writeRoster(versao(1));
    // Um ARQUIVO no lugar da pasta: mkdir falha em toda tentativa.
    await fs.writeFile(pasta, "não sou uma pasta");
    const erros: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void erros.push(args.join(" "));
    try {
      await squad.writeRoster(versao(2));
      await squad.writeRoster(versao(3));
      await squad.writeRoster(versao(4));
    } finally {
      console.error = original;
    }
    assert.equal(await marcaDe(squadJson), "v4");
    const doHistorico = erros.filter((e) => e.includes("[roster-historico]"));
    assert.ok(doHistorico.length >= 1 && doHistorico.length <= 2, `log: ${doHistorico.length}`);
    // O log não carrega conteúdo do roster.
    assert.equal(doHistorico.some((e) => e.includes("marca")), false);
  });
});

describe("descreverHistorico", () => {
  beforeEach(zerar);

  it("sem pasta: nenhuma cópia ainda", async () => {
    assert.equal(await hist.descreverHistorico(dados), "histórico do roster: nenhuma cópia ainda");
  });

  it("com cópias: contagem e a mais recente, sem conteúdo", async () => {
    await fs.mkdir(pasta, { recursive: true });
    for (const d of ["2026-10-05T100000Z", "2026-10-07T143015Z", "2026-10-06T090000Z"]) {
      await fs.writeFile(path.join(pasta, `squad.${d}.json`), "{}");
    }
    assert.equal(
      await hist.descreverHistorico(dados),
      "histórico do roster: 3 cópia(s), a mais recente de 2026-10-07T14:30:15.000Z",
    );
  });
});
