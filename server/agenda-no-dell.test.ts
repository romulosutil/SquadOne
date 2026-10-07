/**
 * A agenda no perfil operations (Dell): diretório de dados próprio, nunca
 * semear, roster congelado durante o cutover e callback do Google só pelo
 * loopback. Roda em diretórios temporários: o "checkout" é o cwd e os dados
 * ficam FORA dele, como no Dell. As envs vêm antes do import dinâmico porque
 * squad.ts fixa o caminho no import (cada arquivo de teste é um processo).
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-clone-"));
const dados = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-dados-"));
process.chdir(checkout);
process.env.SQUADONE_MODE = "operations";
process.env.SQUADONE_DATA_DIR = dados;
// Uma seed no checkout: no Dell ela existe, e mesmo assim não pode ser usada.
await fs.mkdir(path.join(checkout, "seed"), { recursive: true });
await fs.writeFile(path.join(checkout, "seed", "squad.seed.json"), JSON.stringify({ version: 3, squads: [], idsAposentados: {} }));

const squad = await import("./squad.ts");
const ciclo = await import("./ciclo-de-vida.ts");
const { motivoParaAgendaDesligada, diretorioDeDados, estaDentro } = await import("./dados.ts");
const { redirectUri, ErroDeConfig } = await import("./auth-store.ts");

const pessoa = (id: string) => ({ id, nome: id, papel: "PO", escopo: "treino", sprite: "x", hiredAt: "2026-09-01" });
const ROSTER_DE_PRODUCAO = {
  version: 3,
  idsAposentados: { pessoas: [], dominios: [] },
  squads: [
    {
      id: "pessoal", nome: "Pessoal", escopo: "vida", calendarId: "primary", unlockOrder: [[0, 0]],
      dominios: [{ id: "geral", nome: "Geral", escopo: "tema", slot: [0, 0], room: "ROOM_SOLO", criadoEm: "2026-09-01", po: pessoa("po"), integrantes: [] }],
    },
  ],
};

afterEach(() => {
  delete process.env.SQUADONE_ROSTER_CONGELADO;
});

describe("roster no Dell", () => {
  it("sem squad.json: RosterAusente, e a seed NÃO é copiada", async () => {
    await assert.rejects(squad.readRoster(), squad.RosterAusente);
    await assert.rejects(fs.access(path.join(dados, "squad.json")));
    await assert.rejects(fs.access(path.join(checkout, "data", "squad.json")));
  });

  it("lê o roster do SQUADONE_DATA_DIR, não do data/ do checkout", async () => {
    await fs.mkdir(path.join(checkout, "data"), { recursive: true });
    await fs.writeFile(path.join(checkout, "data", "squad.json"), JSON.stringify({ ...ROSTER_DE_PRODUCAO, squads: [] }));
    await fs.writeFile(path.join(dados, "squad.json"), JSON.stringify(ROSTER_DE_PRODUCAO));
    const roster = await squad.readRoster();
    assert.deepEqual(roster.squads.map((s) => s.id), ["pessoal"]);
  });

  it("congelado: editar, contratar o id da lista e arquivar recusam, e o arquivo não muda", async () => {
    await fs.writeFile(path.join(dados, "squad.json"), JSON.stringify(ROSTER_DE_PRODUCAO));
    const antes = await fs.readFile(path.join(dados, "squad.json"), "utf8");
    process.env.SQUADONE_ROSTER_CONGELADO = "true";
    await assert.rejects(ciclo.editarSquad("pessoal", { nome: "Outra" }), squad.RosterCongelado);
    await assert.rejects(squad.gravarTasksListaId("pessoal", "L1"), squad.RosterCongelado);
    // É conflito (409), não erro nosso: a rota já mapeia ConflitoDeRoster.
    await assert.rejects(ciclo.editarSquad("pessoal", { nome: "Outra" }), squad.ConflitoDeRoster);
    assert.equal(await fs.readFile(path.join(dados, "squad.json"), "utf8"), antes);
    // A leitura continua: o bot e a vigia seguem rodando durante a troca.
    assert.equal((await squad.readRoster()).squads[0].nome, "Pessoal");
  });

  it("descongelado volta a gravar (a fila não morre no erro)", async () => {
    await fs.writeFile(path.join(dados, "squad.json"), JSON.stringify(ROSTER_DE_PRODUCAO));
    process.env.SQUADONE_ROSTER_CONGELADO = "true";
    await assert.rejects(ciclo.editarSquad("pessoal", { nome: "Outra" }));
    delete process.env.SQUADONE_ROSTER_CONGELADO;
    await ciclo.editarSquad("pessoal", { nome: "Outra" });
    assert.equal((await squad.readRoster()).squads[0].nome, "Outra");
  });

  it("só 'true' congela", () => {
    assert.equal(squad.rosterCongelado({ SQUADONE_ROSTER_CONGELADO: "true" }), true);
    assert.equal(squad.rosterCongelado({ SQUADONE_ROSTER_CONGELADO: " true " }), true);
    for (const v of [undefined, "", "1", "sim", "TRUE"]) {
      assert.equal(squad.rosterCongelado({ SQUADONE_ROSTER_CONGELADO: v }), false, String(v));
    }
  });
});

describe("motivoParaAgendaDesligada", () => {
  it("sem SQUADONE_DATA_DIR a agenda não liga (o Dell antes do runbook)", () => {
    assert.match(motivoParaAgendaDesligada({}, checkout)!, /SQUADONE_DATA_DIR ausente/);
    assert.match(motivoParaAgendaDesligada({ SQUADONE_DATA_DIR: "  " }, checkout)!, /ausente/);
  });

  it("dentro do checkout não liga (o retrato de 14/09 mora no data/ do clone)", () => {
    assert.match(motivoParaAgendaDesligada({ SQUADONE_DATA_DIR: path.join(checkout, "data") }, checkout)!, /dentro do checkout/);
    assert.match(motivoParaAgendaDesligada({ SQUADONE_DATA_DIR: checkout }, checkout)!, /dentro do checkout/);
  });

  it("fora do checkout liga", () => {
    assert.equal(motivoParaAgendaDesligada({ SQUADONE_DATA_DIR: dados }, checkout), null);
    // Prefixo de nome não é "dentro": ~/SquadOne-dados não está em ~/SquadOne.
    assert.equal(estaDentro("/home/x/SquadOne", "/home/x/SquadOne-dados"), false);
  });

  it("padrão ./data", () => {
    assert.equal(diretorioDeDados({}), path.join(process.cwd(), "data"));
    assert.equal(diretorioDeDados({ SQUADONE_DATA_DIR: dados }), path.resolve(dados));
  });
});

describe("callback do Google no Dell", () => {
  it("loopback passa", () => {
    assert.equal(
      redirectUri({ SQUADONE_MODE: "operations", APP_URL: "http://127.0.0.1:9120" }),
      "http://127.0.0.1:9120/api/auth/callback",
    );
  });

  it("endereço da tailnet ou https é erro de ambiente, nunca redirect em ts.net", () => {
    for (const APP_URL of ["https://mel.tail0000.ts.net:8443", "http://mel.tail0000.ts.net:8443", "https://127.0.0.1:9120", "lixo"]) {
      assert.throws(() => redirectUri({ SQUADONE_MODE: "operations", APP_URL }), ErroDeConfig, APP_URL);
    }
  });

  it("no perfil app nada muda", () => {
    assert.equal(
      redirectUri({ APP_URL: "https://aladdin-squadone-app.exemplo/" }),
      "https://aladdin-squadone-app.exemplo/api/auth/callback",
    );
  });
});
