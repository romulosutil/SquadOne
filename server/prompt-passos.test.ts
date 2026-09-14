/**
 * A regra dos passos entra no prompt nos três modos (o toggle é sobre o tipo
 * do compromisso, não sobre ter passos), logo depois da nota_de_execucao, e o
 * campo existe na declaração sem ser obrigatório.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Type } from "@google/genai";
import { CAPABILITIES } from "./capabilities.ts";
import { buildSystemInstruction } from "./orchestrator.ts";

const CONTEXTO = {
  squadNome: "Pessoal",
  squadEscopo: "vida pessoal",
  arvore: "- domínio 'geral' — Geral (escopo: tudo)",
  outrasSquads: "(nenhuma)",
  janela: "09:00–19:00, seg–sex",
};

describe("regra de passos no prompt", () => {
  for (const modo of ["auto", "foco", "baixa_prioridade"] as const) {
    it(`modo ${modo}: presente, depois da nota_de_execucao e antes do crescimento`, () => {
      const p = buildSystemInstruction(CONTEXTO, "2026-09-14T12:00:00-03:00", modo);
      const passos = p.indexOf("- passos: mande SÓ quando");
      assert.ok(passos > p.indexOf("- nota_de_execucao:"), "depois da nota");
      assert.ok(passos < p.indexOf("- Crescimento tem dois níveis"), "antes do crescimento");
      assert.match(p, /Pedido de checklist sem\s+compromisso: chame agendar_evento com os passos/);
      assert.match(p, /Entre 2 e 8 itens/);
    });
  }
});

describe("declaração de agendar_evento", () => {
  it("passos é ARRAY de STRING e opcional", () => {
    const params = CAPABILITIES.agendar_evento.declaration.parameters!;
    const passos = params.properties!.passos!;
    assert.equal(passos.type, Type.ARRAY);
    assert.equal(passos.items!.type, Type.STRING);
    assert.equal(params.required!.includes("passos"), false);
  });
});
