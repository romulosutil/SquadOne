/**
 * Regra pura dos lembretes: quem avisar, quando e com que texto. `agora` é
 * injetado — é assim que se testa o disparo sem esperar o horário real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerJanela } from "./alocador.ts";
import { validarAviso } from "./avisos.ts";
import type { QuestCalendario } from "./calendar.ts";
import {
  alvosDoRoster,
  disparosDevidos,
  mensagemDoDisparo,
  referenciaDoEvento,
} from "./lembretes.ts";
import type { Roster } from "./squad.ts";

const JANELA = lerJanela({}); // 09:00-19:00, seg-sex, America/Sao_Paulo
const t = (iso: string) => new Date(iso).getTime();
/** Segunda-feira, 12:00 em São Paulo. */
const AGORA = t("2026-09-14T12:00:00-03:00");
const ATIVOS = new Set(["geral"]);
const NADA = new Set<string>();

function quest(p: Partial<QuestCalendario> = {}): QuestCalendario {
  return {
    eventId: "ev1",
    titulo: "[PO] Revisar contrato",
    inicio: "2026-09-14T12:10:00-03:00",
    fim: "2026-09-14T13:10:00-03:00",
    diaInteiro: false,
    tipo: "time_blocking",
    dominio: "geral",
    membro: "po",
    squad: "pessoal",
    prazoRef: "",
    htmlLink: "https://calendar.google.com/ev1",
    ...p,
  };
}

const pessoa = { id: "po", nome: "Ana", papel: "PO", escopo: "", sprite: "x", hiredAt: "2026-09-01" };
function dominio(id: string, nome: string, arquivado = false) {
  return { id, nome, escopo: "", slot: [1, 1] as [number, number], room: "r", criadoEm: "2026-09-01", po: pessoa, integrantes: [], ...(arquivado ? { arquivado: true } : {}) };
}

describe("alvosDoRoster", () => {
  it("só squads e domínios ativos; calendários sem repetição", () => {
    const roster: Roster = {
      version: 3,
      idsAposentados: { pessoas: [], dominios: [] },
      squads: [
        { id: "pessoal", nome: "Pessoal", escopo: "", calendarId: "primary", unlockOrder: [[1, 1]], dominios: [dominio("geral", "Geral"), dominio("velho", "Velho", true)] },
        { id: "p4f", nome: "Pay4Fun", escopo: "", calendarId: "primary", unlockOrder: [[1, 1]], dominios: [dominio("p4f--dev", "Dev")] },
        { id: "morta", nome: "Morta", escopo: "", calendarId: "outro", unlockOrder: [[1, 1]], dominios: [dominio("morta--x", "X")], arquivado: true },
      ],
    };
    const alvos = alvosDoRoster(roster);
    assert.deepEqual(alvos.calendarios, ["primary"]);
    assert.deepEqual([...alvos.dominios.entries()], [["geral", "Geral"], ["p4f--dev", "Dev"]]);
  });
});

describe("referenciaDoEvento", () => {
  it("bloco com horário: o início", () => {
    assert.equal(referenciaDoEvento(quest(), JANELA), t("2026-09-14T12:10:00-03:00"));
  });

  it("bloco de dia inteiro: não tem referência", () => {
    assert.equal(referenciaDoEvento(quest({ diaInteiro: true, inicio: "2026-09-14", fim: "2026-09-15" }), JANELA), null);
  });

  it("marco com horário: o FIM (o prazo real; o início é prazo − 15 min)", () => {
    const marco = quest({ tipo: "deadline", inicio: "2026-09-14T17:45:00-03:00", fim: "2026-09-14T18:00:00-03:00" });
    assert.equal(referenciaDoEvento(marco, JANELA), t("2026-09-14T18:00:00-03:00"));
  });

  it("marco de dia inteiro: início da janela de trabalho naquele dia", () => {
    const marco = quest({ tipo: "deadline", diaInteiro: true, inicio: "2026-09-18", fim: "2026-09-19" });
    assert.equal(referenciaDoEvento(marco, JANELA), t("2026-09-18T09:00:00-03:00"));
  });
});

describe("disparosDevidos", () => {
  it("avisa exatamente 10 min antes", () => {
    const [d] = disparosDevidos([quest()], AGORA, JANELA, ATIVOS, NADA);
    assert.equal(d.chave, `ev1@${t("2026-09-14T12:10:00-03:00")}`);
  });

  it("11 min antes ainda não", () => {
    assert.deepEqual(disparosDevidos([quest({ inicio: "2026-09-14T12:11:00-03:00" })], AGORA, JANELA, ATIVOS, NADA), []);
  });

  it("no horário ou depois: não avisa mais", () => {
    assert.deepEqual(disparosDevidos([quest({ inicio: "2026-09-14T12:00:00-03:00" })], AGORA, JANELA, ATIVOS, NADA), []);
    assert.deepEqual(disparosDevidos([quest({ inicio: "2026-09-14T11:55:00-03:00" })], AGORA, JANELA, ATIVOS, NADA), []);
  });

  it("dentro da janela mas atrasado (servidor voltou): ainda avisa", () => {
    assert.equal(disparosDevidos([quest({ inicio: "2026-09-14T12:03:00-03:00" })], AGORA, JANELA, ATIVOS, NADA).length, 1);
  });

  it("já enviado: não repete", () => {
    const enviados = new Set([`ev1@${t("2026-09-14T12:10:00-03:00")}`]);
    assert.deepEqual(disparosDevidos([quest()], AGORA, JANELA, ATIVOS, enviados), []);
  });

  it("evento movido depois do aviso: a chave muda e avisa de novo", () => {
    const enviados = new Set([`ev1@${t("2026-09-14T11:00:00-03:00")}`]);
    assert.equal(disparosDevidos([quest()], AGORA, JANELA, ATIVOS, enviados).length, 1);
  });

  it("domínio inativo ou evento sem domínio: não avisa", () => {
    assert.deepEqual(disparosDevidos([quest({ dominio: "velho" })], AGORA, JANELA, ATIVOS, NADA), []);
    assert.deepEqual(disparosDevidos([quest({ dominio: "" })], AGORA, JANELA, ATIVOS, NADA), []);
  });

  it("marco de dia inteira avisa às 08:50", () => {
    const marco = quest({ tipo: "deadline", diaInteiro: true, inicio: "2026-09-14", fim: "2026-09-15" });
    assert.equal(disparosDevidos([marco], t("2026-09-14T08:50:00-03:00"), JANELA, ATIVOS, NADA).length, 1);
    assert.equal(disparosDevidos([marco], t("2026-09-14T08:49:00-03:00"), JANELA, ATIVOS, NADA).length, 0);
  });

  it("volta em ordem de referência e tira o prefixo do título do marco", () => {
    const marco = quest({ eventId: "m1", tipo: "deadline", titulo: "⏰ DEADLINE: [PO] Entregar", inicio: "2026-09-14T11:50:00-03:00", fim: "2026-09-14T12:05:00-03:00" });
    const ds = disparosDevidos([quest(), marco], AGORA, JANELA, ATIVOS, NADA);
    assert.deepEqual(ds.map((d) => d.eventId), ["m1", "ev1"]);
    assert.equal(ds[0].titulo, "[PO] Entregar");
  });
});

describe("mensagemDoDisparo", () => {
  const fuso = JANELA.fuso;

  it("bloco: minutos que faltam, intervalo e domínio, num Aviso que a fila aceita", () => {
    const [d] = disparosDevidos([quest()], AGORA, JANELA, ATIVOS, NADA);
    const a = mensagemDoDisparo(d, AGORA, fuso, "Geral");
    assert.deepEqual(a, {
      titulo: "⏳ Em 10 min: [PO] Revisar contrato",
      texto: "12:10–13:10 · Geral",
      origem: "squadone:vigia",
      chave: `lembrete:${d.chave}`,
      prioridade: 2,
      // Lembrete que ficou preso na fila depois do horário não serve.
      expiraEm: "2026-09-14T15:10:00.000Z",
      link: "https://calendar.google.com/ev1",
    });
    validarAviso(a);
  });

  it("marco com horário: P1 (não P0) e hora do prazo", () => {
    const marco = quest({ tipo: "deadline", titulo: "⏰ DEADLINE: [PO] Entregar", inicio: "2026-09-14T11:50:00-03:00", fim: "2026-09-14T12:05:00-03:00" });
    const [d] = disparosDevidos([marco], AGORA, JANELA, ATIVOS, NADA);
    const m = mensagemDoDisparo(d, AGORA, fuso, "Geral");
    assert.equal(m.titulo, "⏰ Prazo em 5 min: [PO] Entregar");
    assert.equal(m.texto, "Vence às 12:05 · Geral");
    assert.equal(m.prioridade, 1);
  });

  it("marco de dia inteiro: 'Prazo hoje', vale até o fim do dia", () => {
    const marco = quest({ tipo: "deadline", titulo: "⏰ DEADLINE: [PO] Entregar", diaInteiro: true, inicio: "2026-09-14", fim: "2026-09-15" });
    const agora = t("2026-09-14T08:50:00-03:00");
    const [d] = disparosDevidos([marco], agora, JANELA, ATIVOS, NADA);
    const m = mensagemDoDisparo(d, agora, fuso, "Geral");
    assert.equal(m.titulo, "⏰ Prazo hoje: [PO] Entregar");
    assert.equal(m.texto, "Vence hoje · Geral");
    assert.equal(m.expiraEm, "2026-09-15T00:00:00.000Z");
  });

  it("título com valor em R$, quebra de linha ou longo demais ainda vira aviso válido, sem o valor", () => {
    const [d] = disparosDevidos([quest({ titulo: "Pagar boleto R$ 1.234,56\nda escola " + "x".repeat(200) })], AGORA, JANELA, ATIVOS, NADA);
    const a = mensagemDoDisparo(d, AGORA, fuso, "Geral");
    validarAviso(a);
    assert.equal(a.titulo.includes("R$"), false);
    assert.match(a.titulo, /^⏳ Em 10 min: Pagar boleto \[valor\] da escola x+…$/);
    assert.ok(a.titulo.length <= 120);
  });
});
