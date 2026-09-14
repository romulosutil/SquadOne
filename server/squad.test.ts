/**
 * `tasksListaId` no roster: gravado pela fila, preservado por toda escrita do
 * ciclo de vida, e fora do prompt e da vista. Roda num diretório temporário:
 * squad.ts fixa o caminho de data/squad.json a partir do cwd NO IMPORT, por
 * isso o chdir vem antes do import dinâmico (cada arquivo de teste roda no seu
 * próprio processo).
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-squad-"));
process.chdir(tmp);
const squad = await import("./squad.ts");
const ciclo = await import("./ciclo-de-vida.ts");

const pessoa = (id: string) => ({ id, nome: id, papel: "PO", escopo: "treino", sprite: "x", hiredAt: "2026-09-01" });
const dominio = (id: string, slot: [number, number]) => ({
  id, nome: id, escopo: "tema", slot, room: "ROOM_SOLO", criadoEm: "2026-09-01", po: pessoa(`po-${id}`), integrantes: [],
});

async function semear(): Promise<void> {
  await fs.mkdir(path.join(tmp, "data"), { recursive: true });
  const roster = {
    version: 3,
    idsAposentados: { pessoas: [], dominios: [] },
    squads: [
      {
        id: "pessoal", nome: "Pessoal", escopo: "vida", calendarId: "primary", unlockOrder: [[0, 0], [1, 0]],
        dominios: [dominio("geral", [0, 0]), dominio("pessoal--saude", [1, 0])],
        tasksListaId: "LISTA-PESSOAL",
      },
      {
        id: "p4f", nome: "Pay4Fun", escopo: "trabalho", calendarId: "primary", unlockOrder: [[0, 0]],
        dominios: [dominio("p4f--dev", [0, 0])],
      },
    ],
  };
  await fs.writeFile(path.join(tmp, "data", "squad.json"), JSON.stringify(roster, null, 2));
}

const listaDe = async (id: string) => squad.localizarSquad(await squad.readRoster(), id)?.tasksListaId;

describe("tasksListaId", () => {
  beforeEach(semear);

  it("gravarTasksListaId grava e a leitura seguinte vê", async () => {
    assert.equal(await squad.gravarTasksListaId("p4f", "LISTA-P4F"), true);
    assert.equal(await listaDe("p4f"), "LISTA-P4F");
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
  });

  it("gravarTasksListaId sobrescreve (lista apagada no Google e recriada)", async () => {
    await squad.gravarTasksListaId("pessoal", "LISTA-NOVA");
    assert.equal(await listaDe("pessoal"), "LISTA-NOVA");
  });

  it("gravarTasksListaId em squad inexistente: false, nada muda", async () => {
    assert.equal(await squad.gravarTasksListaId("nao-existe", "X"), false);
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
  });

  it("editarSquad, editarDominio, arquivarSquad e reativarSquad preservam o campo", async () => {
    await ciclo.editarSquad("pessoal", { nome: "Pessoal Renomeada", escopo: "outra coisa" });
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
    await ciclo.editarDominio("pessoal--saude", { escopo: "saúde e treino" });
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
    await ciclo.arquivarSquad("pessoal");
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
    await ciclo.reativarSquad("pessoal");
    assert.equal(await listaDe("pessoal"), "LISTA-PESSOAL");
  });

  it("paraVista não expõe o campo, nem nas ativas nem nas arquivadas", async () => {
    const r1 = await ciclo.arquivarSquad("pessoal");
    assert.equal(JSON.stringify(r1).includes("tasksListaId"), false);
    const r2 = await ciclo.reativarSquad("pessoal");
    assert.equal(JSON.stringify(r2).includes("tasksListaId"), false);
    assert.equal(JSON.stringify(squad.paraVista(await squad.readRoster())).includes("LISTA-PESSOAL"), false);
  });

  it("rosterTree (prompt) não leva o id da lista", async () => {
    const pessoal = squad.localizarSquad(await squad.readRoster(), "pessoal")!;
    assert.equal(squad.rosterTree(pessoal).includes("LISTA-PESSOAL"), false);
  });
});
