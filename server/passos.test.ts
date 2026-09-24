/**
 * Regras puras dos passos no Google Tasks: o que vira subtarefa, com que
 * título, e em que DIA a tarefa-mãe cai. Fuso passado por parâmetro e
 * instantes com offset explícito, para o teste não depender da máquina.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dueDaData,
  dueDaTarefa,
  escopoConcedido,
  MAX_PASSOS,
  MAX_NOTAS_TAREFA,
  MAX_TITULO_PASSO,
  MAX_TITULO_TAREFA,
  normalizarPassos,
  normalizarTituloDaTarefa,
  notasDaTarefaAvulsa,
  notasDaTarefaMae,
  tituloDaLista,
} from "./passos.ts";

const FUSO = "America/Sao_Paulo";

describe("normalizarPassos", () => {
  const casos: Array<[string, unknown, string[], number]> = [
    ["não-array (undefined)", undefined, [], 0],
    ["não-array (string)", "slides, dados", [], 0],
    ["não-array (objeto)", { 0: "a" }, [], 0],
    ["array vazio", [], [], 0],
    ["descarta vazios e só-espaço", ["", "   ", "Montar slides"], ["Montar slides"], 0],
    ["descarta não-string", [null, 3, { a: 1 }, "Revisar dados"], ["Revisar dados"], 0],
    ["trim e espaços colapsados", ["  Montar \n  slides  "], ["Montar slides"], 0],
    ["dedupe sem diferenciar maiúsculas, mantém o primeiro", ["Ensaiar", "ensaiar", "ENSAIAR ", "Revisar"], ["Ensaiar", "Revisar"], 0],
    ["um item só cria", ["Comprar pão"], ["Comprar pão"], 0],
  ];
  for (const [nome, entrada, passos, cortados] of casos) {
    it(nome, () => {
      assert.deepEqual(normalizarPassos(entrada), { passos, cortados });
    });
  }

  it("corta item longo em MAX_TITULO_PASSO com reticências", () => {
    const longo = "a".repeat(MAX_TITULO_PASSO + 50);
    const { passos } = normalizarPassos([longo]);
    assert.equal(passos[0].length, MAX_TITULO_PASSO);
    assert.equal(passos[0].endsWith("…"), true);
  });

  it("item com exatamente MAX_TITULO_PASSO não é cortado", () => {
    const exato = "b".repeat(MAX_TITULO_PASSO);
    assert.deepEqual(normalizarPassos([exato]).passos, [exato]);
  });

  it("limita a MAX_PASSOS e conta os cortados (duplicados não contam)", () => {
    const itens = Array.from({ length: 13 }, (_, i) => `Passo ${i + 1}`);
    const r = normalizarPassos([...itens, "passo 1"]);
    assert.equal(r.passos.length, MAX_PASSOS);
    assert.equal(r.passos[0], "Passo 1");
    assert.equal(r.passos[MAX_PASSOS - 1], "Passo 10");
    assert.equal(r.cortados, 3);
  });
});

describe("tituloDaLista e notasDaTarefaMae", () => {
  it("título da lista leva o nome da squad", () => {
    assert.equal(tituloDaLista("Pay4Fun"), "SquadOne · Pay4Fun");
  });

  it("notas: link do evento e, na última linha, o vínculo", () => {
    assert.equal(
      notasDaTarefaMae("https://www.google.com/calendar/event?eid=abc", "ev123"),
      "https://www.google.com/calendar/event?eid=abc\nsquadone_evento=ev123",
    );
  });

  it("notas sem htmlLink: só o vínculo", () => {
    assert.equal(notasDaTarefaMae(undefined, "ev123"), "squadone_evento=ev123");
  });
});

describe("dueDaTarefa", () => {
  const casos: Array<[string, Parameters<typeof dueDaTarefa>[0], string]> = [
    [
      "foco de manhã: dia local do início",
      { papel: "foco", dia_inteiro: false, inicio: "2026-09-14T09:00:00.000Z", fim: "2026-09-14T10:00:00.000Z" },
      "2026-09-14T00:00:00.000Z",
    ],
    [
      "foco às 22:30 em SP (01:30 UTC do dia seguinte) continua no mesmo dia local",
      { papel: "foco", dia_inteiro: false, inicio: "2026-09-14T22:30:00-03:00", fim: "2026-09-14T23:30:00-03:00" },
      "2026-09-14T00:00:00.000Z",
    ],
    [
      "marco com hora: dia do PRAZO (fim), não do início (prazo − 15 min)",
      { papel: "marco", dia_inteiro: false, inicio: "2026-09-17T23:50:00-03:00", fim: "2026-09-18T00:05:00-03:00" },
      "2026-09-18T00:00:00.000Z",
    ],
    [
      "marco de dia inteiro: a própria data (fim exclusivo ignorado)",
      { papel: "marco", dia_inteiro: true, inicio: "2026-09-18", fim: "2026-09-19" },
      "2026-09-18T00:00:00.000Z",
    ],
  ];
  for (const [nome, evento, esperado] of casos) {
    it(nome, () => {
      assert.equal(dueDaTarefa(evento, FUSO), esperado);
    });
  }
});

describe("escopoConcedido", () => {
  const DOIS =
    "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks";
  const casos: Array<[string, string | null | undefined, string, boolean]> = [
    ["string com os dois: tasks", DOIS, "https://www.googleapis.com/auth/tasks", true],
    ["string com os dois: calendar", DOIS, "https://www.googleapis.com/auth/calendar.events", true],
    ["só calendar: tasks não", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/tasks", false],
    ["tasks.readonly não conta como tasks", "https://www.googleapis.com/auth/tasks.readonly", "https://www.googleapis.com/auth/tasks", false],
    ["espaços extras", `  ${DOIS}  `, "https://www.googleapis.com/auth/tasks", true],
    ["vazio", "", "https://www.googleapis.com/auth/tasks", false],
    ["undefined", undefined, "https://www.googleapis.com/auth/tasks", false],
    ["null", null, "https://www.googleapis.com/auth/tasks", false],
  ];
  for (const [nome, scope, escopo, esperado] of casos) {
    it(nome, () => {
      assert.equal(escopoConcedido(scope, escopo), esperado);
    });
  }
});

describe("tarefa avulsa: título, data e notas", () => {
  it("título colapsa espaços, recusa não-string e corta com reticências", () => {
    assert.equal(normalizarTituloDaTarefa("  Comprar   leite \n"), "Comprar leite");
    assert.equal(normalizarTituloDaTarefa(42), "");
    assert.equal(normalizarTituloDaTarefa("   "), "");
    const longo = normalizarTituloDaTarefa("x".repeat(MAX_TITULO_TAREFA + 10));
    assert.equal(longo.length, MAX_TITULO_TAREFA);
    assert.ok(longo.endsWith("…"));
  });

  const casos: [unknown, string | null, boolean][] = [
    [undefined, null, false],
    ["", null, false],
    ["  ", null, false],
    ["2026-09-30", "2026-09-30T00:00:00.000Z", false],
    // Com hora e offset local: vale o dia escrito, não o dia em UTC (22h em SP já é o dia seguinte em UTC).
    ["2026-09-30T22:00:00-03:00", "2026-09-30T00:00:00.000Z", false],
    ["2026-02-31", null, true],
    ["30/09/2026", null, true],
    ["sexta", null, true],
    [20260930, null, true],
  ];
  for (const [entrada, due, invalida] of casos) {
    it(`dueDaData(${JSON.stringify(entrada)})`, () => {
      assert.deepEqual(dueDaData(entrada), { due, invalida });
    });
  }

  it("notas: texto primeiro, assinatura no fim; sem texto, só a assinatura", () => {
    assert.equal(notasDaTarefaAvulsa("2 litros", "Ana (Geral)"), "2 litros\n\nSquadOne · Ana (Geral)");
    assert.equal(notasDaTarefaAvulsa("  ", "Ana (Geral)"), "SquadOne · Ana (Geral)");
    assert.equal(notasDaTarefaAvulsa(undefined, "Ana (Geral)"), "SquadOne · Ana (Geral)");
    const longa = notasDaTarefaAvulsa("y".repeat(MAX_NOTAS_TAREFA * 2), "Ana (Geral)");
    assert.equal(longa.length, MAX_NOTAS_TAREFA);
    assert.ok(longa.endsWith("SquadOne · Ana (Geral)"));
  });
});
