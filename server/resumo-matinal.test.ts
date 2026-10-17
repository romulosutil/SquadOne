/**
 * Resumo matinal: quando sai, o que entra e o texto. PURO; o relógio é injetado.
 * A cola com a vigia (um envio por dia, retentativa, leitura incompleta) está em vigia.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerJanela } from "./alocador.ts";
import { validarAviso } from "./avisos.ts";
import type { QuestCalendario } from "./calendar.ts";
import { limitesDoDia, montarResumo, resumoDevido, resumoMatinalLigado } from "./resumo-matinal.ts";

const JANELA = lerJanela({}); // 09:00-19:00, seg-sex, America/Sao_Paulo
const FUSO = JANELA.fuso;
const t = (iso: string) => new Date(iso).getTime();
/** Segunda-feira, 07:30 em São Paulo. */
const MANHA = t("2026-09-14T07:30:00-03:00");
const DOMINIOS = new Map([["geral", "Geral"], ["p4f--dev", "Dev"]]);

function quest(p: Partial<QuestCalendario> = {}): QuestCalendario {
  return {
    eventId: "ev1",
    titulo: "[PO] Revisar contrato",
    inicio: "2026-09-14T09:00:00-03:00",
    fim: "2026-09-14T10:30:00-03:00",
    diaInteiro: false,
    tipo: "time_blocking",
    dominio: "geral",
    membro: "po",
    squad: "pessoal",
    prazoRef: "",
    ...p,
  };
}

describe("resumoDevido", () => {
  it("só entre 07:30 e 11:00 locais", () => {
    assert.equal(resumoDevido(t("2026-09-14T07:29:00-03:00"), FUSO, null), null);
    assert.equal(resumoDevido(t("2026-09-14T07:30:00-03:00"), FUSO, null), "2026-09-14");
    assert.equal(resumoDevido(t("2026-09-14T10:59:00-03:00"), FUSO, null), "2026-09-14");
    assert.equal(resumoDevido(t("2026-09-14T11:00:00-03:00"), FUSO, null), null);
  });

  it("uma vez por dia: o de hoje bloqueia, o de ontem não", () => {
    assert.equal(resumoDevido(MANHA, FUSO, "2026-09-14"), null);
    assert.equal(resumoDevido(MANHA, FUSO, "2026-09-13"), "2026-09-14");
  });

  it("conta o dia pelo fuso, não pelo UTC (07:30 em SP já é o mesmo dia em UTC, 23:30 do anterior não)", () => {
    // 22:30 de domingo em SP = 01:30 de segunda em UTC: não é hora do resumo e o dia é domingo.
    assert.equal(resumoDevido(t("2026-09-14T01:30:00Z"), FUSO, null), null);
  });
});

describe("limitesDoDia", () => {
  it("do início do dia local à meia-noite seguinte", () => {
    const { de, ate, data } = limitesDoDia(MANHA, FUSO);
    assert.equal(de.toISOString(), "2026-09-14T03:00:00.000Z");
    assert.equal(ate.toISOString(), "2026-09-15T03:00:00.000Z");
    assert.deepEqual(data, { ano: 2026, mes: 9, dia: 14 });
  });
});

describe("montarResumo", () => {
  const agenda = [
    quest({ eventId: "b1" }),
    quest({ eventId: "b2", titulo: "[Dev] Code review", dominio: "p4f--dev", inicio: "2026-09-14T14:00:00-03:00", fim: "2026-09-14T15:00:00-03:00" }),
    // Marco com horário: o Google grava de prazo − 15 min até o prazo; o resumo mostra o prazo.
    quest({ eventId: "m1", titulo: "⏰ DEADLINE: Entregar relatório", tipo: "deadline", inicio: "2026-09-14T16:45:00-03:00", fim: "2026-09-14T17:00:00-03:00" }),
    quest({ eventId: "m2", titulo: "⏰ DEADLINE: Declarar IR", tipo: "deadline", diaInteiro: true, inicio: "2026-09-14", fim: "2026-09-15" }),
    quest({ eventId: "d1", titulo: "Viagem", diaInteiro: true, inicio: "2026-09-14", fim: "2026-09-15" }),
  ];

  it("agrupa prazos, blocos e dia inteiro, com o foco somado", () => {
    const aviso = montarResumo(agenda, MANHA, JANELA, DOMINIOS)!;
    assert.equal(aviso.titulo, "☀️ Seu dia: 5 compromissos · 2 prazos");
    const linhas = aviso.texto.split("\n");
    assert.match(linhas[0], /^segunda-feira,? 14\/09$/);
    assert.deepEqual(linhas.slice(1), [
      "",
      "Prazos",
      "⏰ vence hoje · Declarar IR · Geral",
      "⏰ até 17:00 · Entregar relatório · Geral",
      "",
      "Blocos (2h30)",
      "09:00–10:30 · [PO] Revisar contrato · Geral",
      "14:00–15:00 · [Dev] Code review · Dev",
      "",
      "O dia todo",
      "📌 Viagem · Geral",
    ]);
  });

  it("é um aviso válido para a fila: chave do dia, P2, vale até a meia-noite local", () => {
    const aviso = montarResumo(agenda, MANHA, JANELA, DOMINIOS)!;
    validarAviso(aviso);
    assert.equal(aviso.chave, "resumo-matinal:2026-09-14");
    assert.equal(aviso.prioridade, 2);
    assert.equal(aviso.expiraEm, "2026-09-15T03:00:00.000Z");
  });

  it("dia sem nada não manda aviso", () => {
    assert.equal(montarResumo([], MANHA, JANELA, DOMINIOS), null);
  });

  it("ignora outro dia, domínio arquivado, evento sem domínio e conta o repetido uma vez", () => {
    const aviso = montarResumo(
      [
        quest({ eventId: "amanha", inicio: "2026-09-15T09:00:00-03:00", fim: "2026-09-15T10:00:00-03:00" }),
        quest({ eventId: "velho", dominio: "arquivado" }),
        quest({ eventId: "solto", dominio: "" }),
        quest({ eventId: "b1" }),
        quest({ eventId: "b1" }),
      ],
      MANHA,
      JANELA,
      DOMINIOS,
    )!;
    assert.equal(aviso.titulo, "☀️ Seu dia: 1 compromisso");
    assert.equal(aviso.texto.split("\n").filter((l) => l.includes("Revisar contrato")).length, 1);
  });

  it("bloco de uma só hora, sem horas redondas: 1h, 45 min e 1h15", () => {
    const um = (min: number) =>
      montarResumo([quest({ fim: new Date(t("2026-09-14T09:00:00-03:00") + min * 60_000).toISOString() })], MANHA, JANELA, DOMINIOS)!;
    assert.match(um(60).texto, /Blocos \(1h\)/);
    assert.match(um(45).texto, /Blocos \(45 min\)/);
    assert.match(um(75).texto, /Blocos \(1h15\)/);
  });

  it("valor em R$ no título vira [valor]: a fila recusaria o aviso inteiro (regra 24)", () => {
    const aviso = montarResumo([quest({ titulo: "Pagar boleto R$ 1.500,00" })], MANHA, JANELA, DOMINIOS)!;
    assert.doesNotMatch(aviso.texto, /R\$/);
    assert.match(aviso.texto, /\[valor\]/);
    validarAviso(aviso);
  });

  it("muita agenda: corta em 30 linhas e diz quanto ficou no Google", () => {
    const muitos = Array.from({ length: 40 }, (_, i) =>
      quest({
        eventId: `e${i}`,
        titulo: `Bloco ${i}`,
        inicio: `2026-09-14T${String(8 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}:00-03:00`,
        fim: `2026-09-14T${String(8 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15 + 10).padStart(2, "0")}:00-03:00`,
      }),
    );
    const aviso = montarResumo(muitos, MANHA, JANELA, DOMINIOS)!;
    assert.equal(aviso.titulo, "☀️ Seu dia: 40 compromissos");
    assert.match(aviso.texto, /…e mais 10 no Google Agenda$/);
    validarAviso(aviso);
  });
});

describe("resumoMatinalLigado", () => {
  it("nasce ligado; só 'false' desliga", () => {
    assert.equal(resumoMatinalLigado({}), true);
    assert.equal(resumoMatinalLigado({ SQUADONE_RESUMO_MATINAL: "true" }), true);
    assert.equal(resumoMatinalLigado({ SQUADONE_RESUMO_MATINAL: " False " }), false);
  });
});
