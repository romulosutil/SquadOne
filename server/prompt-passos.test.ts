/**
 * A regra dos passos entra no prompt nos três modos (o toggle é sobre o tipo
 * do compromisso, não sobre ter passos), logo depois da nota_de_execucao, e o
 * campo existe na declaração sem ser obrigatório.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Type } from "@google/genai";
import { CAPABILITIES } from "./capabilities.ts";
import { buildSystemInstruction, calendarioDaSemana } from "./orchestrator.ts";

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
      assert.match(p, /Pedido de checklist ou\s+lista sem compromisso na agenda: chame criar_tarefa com os itens em passos/);
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

describe("criar_tarefa no prompt e na declaração", () => {
  it("auto: regra de agenda ou tarefa presente, sem proibir criar_tarefa", () => {
    const p = buildSystemInstruction(CONTEXTO, "2026-09-14T12:00:00-03:00", "auto");
    assert.match(p, /- Agenda ou tarefa:/);
    assert.doesNotMatch(p, /Não use\s+criar_tarefa/);
  });

  for (const modo of ["foco", "baixa_prioridade"] as const) {
    it(`${modo}: o prompt manda não usar criar_tarefa`, () => {
      const p = buildSystemInstruction(CONTEXTO, "2026-09-14T12:00:00-03:00", modo);
      assert.match(p, /Não use\s+criar_tarefa: o usuário pediu\s+tempo na agenda/);
    });
  }

  it("titulo e responsavel_id obrigatórios; data, notas e passos opcionais", () => {
    const params = CAPABILITIES.criar_tarefa.declaration.parameters!;
    assert.deepEqual(params.required, ["titulo", "responsavel_id"]);
    assert.equal(params.properties!.passos!.type, Type.ARRAY);
    for (const campo of ["data", "notas", "passos"]) assert.ok(params.properties![campo], campo);
  });
});

describe("calendário da semana no prompt", () => {
  it("hoje e os 7 dias seguintes com o nome certo, virando o mês", () => {
    assert.equal(
      calendarioDaSemana("2026-09-27T23:30:00-03:00"),
      'Dias: hoje, domingo 2026-09-27; segunda 2026-09-28; terça 2026-09-29; quarta 2026-09-30; quinta 2026-10-01; sexta 2026-10-02; sábado 2026-10-03; domingo 2026-10-04. Use esta lista para "amanhã", "sexta", "semana que vem".',
    );
  });

  it("entra no prompt logo depois do agora", () => {
    const p = buildSystemInstruction(CONTEXTO, "2026-09-23T19:54:00-03:00", "auto");
    assert.match(p, /hoje, quarta 2026-09-23; quinta 2026-09-24; sexta 2026-09-25/);
  });
});
