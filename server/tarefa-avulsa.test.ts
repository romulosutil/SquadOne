/**
 * Roteamento de `criar_tarefa` no turno, com o Gemini dublê e sem credencial:
 * nada toca o Google nem o disco. Em `auto` a tarefa vai para o Tasks (e, sem o
 * escopo, falha com o gesto de ampliar); nos modos forçados vira bloco na agenda
 * (e, sem credencial, falha com o gesto de reconectar) — é essa diferença de
 * motivo que prova por qual caminho a chamada passou.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GoogleGenAI } from "@google/genai";
import { executarTurno } from "./orchestrator.ts";
import type { Roster, Squad } from "./squad.ts";

const pessoa = { id: "po", nome: "Ana", papel: "PO", escopo: "", sprite: "x", hiredAt: "2026-09-01" };
const squad: Squad = {
  id: "pessoal", nome: "Pessoal", escopo: "vida pessoal", calendarId: "primary", unlockOrder: [[0, 0]],
  dominios: [{ id: "geral", nome: "Geral", escopo: "", slot: [0, 0], room: "r", criadoEm: "2026-09-01", po: pessoa, integrantes: [] }],
};
const roster: Roster = { version: 3, idsAposentados: { pessoas: [], dominios: [] }, squads: [squad] };

function geminiQueChama(args: Record<string, unknown>): GoogleGenAI {
  return {
    models: { generateContent: async () => ({ functionCalls: [{ name: "criar_tarefa", args }] }) },
  } as unknown as GoogleGenAI;
}

const turno = (modo: "auto" | "foco" | "baixa_prioridade") =>
  executarTurno(geminiQueChama({ titulo: "Comprar leite", responsavel_id: "po", data: "2026-09-30" }), {
    demanda: "lembrar de comprar leite", token: null, modo, roster, squad,
    agora: new Date("2026-09-23T15:00:00-03:00"), tasksLiberado: false,
  });

describe("criar_tarefa no turno", () => {
  it("auto: vai para o Tasks; sem o escopo vira erro com o gesto ampliarAcesso", async () => {
    const r = await turno("auto");
    assert.deepEqual(r.tarefas_criadas, []);
    assert.deepEqual(r.eventos_criados, []);
    assert.equal(r.erros.length, 1);
    assert.equal(r.erros[0].capacidade, "criar_tarefa");
    assert.equal(r.erros[0].motivo, "ampliarAcesso");
  });

  for (const modo of ["foco", "baixa_prioridade"] as const) {
    it(`${modo}: vira bloco na agenda; sem credencial vira precisaConectar, não ampliar`, async () => {
      const r = await turno(modo);
      assert.equal(r.erros.length, 1);
      assert.equal(r.erros[0].capacidade, "criar_tarefa");
      assert.equal(r.erros[0].motivo, "precisaConectar");
    });
  }

  it("responsavel_id inventado falha antes de qualquer chamada ao Google", async () => {
    const r = await executarTurno(geminiQueChama({ titulo: "x", responsavel_id: "ninguem" }), {
      demanda: "x", token: null, modo: "auto", roster, squad, tasksLiberado: true,
    });
    assert.match(r.erros[0].erro, /responsavel_id 'ninguem' não está na squad/);
    assert.equal(r.erros[0].motivo, undefined);
  });
});
