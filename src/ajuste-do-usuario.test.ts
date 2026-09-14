/**
 * Spec 2026-09-13 §4 "Duração explícita", as duas metades:
 *
 * A) o toast do turno diz o que foi marcado (título, dia/hora, duração);
 * B) o usuário abre um ajuste pela Mochila, sem agente nenhum ter proposto —
 *    mesma rota `/api/quests/:eventId/ajustar`, mesmo `AjusteCard`, só a
 *    origem da proposta muda.
 *
 * Roda com `npm test` (node:test via tsx). Módulos sem Vue de propósito: é o
 * que dá para fixar em tabela de casos. Locale e fuso são fixados em cada
 * chamada para o texto não depender da máquina.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alvoDeAjuste,
  minutosAtuais,
  normalizarPropostoMin,
  propostaDoUsuario,
  resumoDoEvento,
  resumoDosEventosCriados,
  type FormatoDeData,
} from "./contribuicao.ts";
import { LIMITES_DE_AJUSTE, type EventoCriado, type QuestCalendario } from "./types.ts";

const FMT: FormatoDeData = { locale: "pt-BR", timeZone: "America/Sao_Paulo" };

const evento = (x: Partial<EventoCriado>): EventoCriado => ({
  kind: "evento",
  titulo: "Compromisso",
  responsavel_id: "ana",
  tipo: "time_blocking",
  dominio: "pessoal--vendas",
  inicio: "2026-09-15T14:00:00-03:00",
  fim: "2026-09-15T14:45:00-03:00",
  dia_inteiro: false,
  papel: "foco",
  eventId: "ev1",
  ...x,
});

const quest = (x: Partial<QuestCalendario>): QuestCalendario => ({
  eventId: "ev1",
  titulo: "Compromisso",
  inicio: "2026-09-15T14:00:00-03:00",
  fim: "2026-09-15T15:00:00-03:00",
  diaInteiro: false,
  tipo: "time_blocking",
  dominio: "pessoal--vendas",
  membro: "ana",
  squad: "pessoal",
  prazoRef: "",
  ...x,
});

describe("A) toast do turno: o que foi marcado", () => {
  it("bloco de foco traz título, duração, dia e intervalo de horas", () => {
    const texto = resumoDoEvento(evento({ titulo: "Revisar proposta" }), FMT);
    assert.match(texto, /^Revisar proposta: 45 min, /);
    assert.match(texto, /14:00–14:45$/);
    // 15/09/2026 é uma terça: o dia da semana orienta mais que a data crua.
    assert.match(texto, /ter/i);
  });

  it("duração vem do intervalo, não de campo do modelo", () => {
    const texto = resumoDoEvento(
      evento({ inicio: "2026-09-15T09:00:00-03:00", fim: "2026-09-15T11:30:00-03:00" }),
      FMT,
    );
    assert.match(texto, /: 2h30, /);
  });

  it("marco com hora aparece como prazo, sem duração", () => {
    const texto = resumoDoEvento(
      evento({ titulo: "Entrega", papel: "marco", tipo: "deadline", fim: "2026-09-18T18:00:00-03:00" }),
      FMT,
    );
    assert.equal(texto.includes("min"), false);
    assert.match(texto, /^Entrega: prazo /);
    assert.match(texto, /18:00$/);
  });

  it("marco de dia inteiro usa o ÚLTIMO dia, não o `fim` exclusivo do Google", () => {
    const texto = resumoDoEvento(
      evento({
        titulo: "Entrega",
        papel: "marco",
        tipo: "deadline",
        dia_inteiro: true,
        inicio: "2026-09-18",
        fim: "2026-09-19",
      }),
      FMT,
    );
    assert.match(texto, /^Entrega: prazo em /);
    assert.match(texto, /18\/09/);
    assert.equal(texto.includes("19/09"), false);
  });

  it("prazo dobra os blocos do turno no marco em vez de listar os 20", () => {
    const marco = evento({ titulo: "Entrega", papel: "marco", tipo: "deadline", eventId: "marco1", fim: "2026-09-18T18:00:00-03:00" });
    const blocos = [1, 2, 3].map((i) =>
      evento({
        titulo: "Entrega (bloco)",
        papel: "bloco",
        prazo_ref: "marco1",
        eventId: `b${i}`,
        inicio: `2026-09-1${i + 4}T09:00:00-03:00`,
        fim: `2026-09-1${i + 4}T10:00:00-03:00`,
      }),
    );
    const texto = resumoDosEventosCriados([marco, ...blocos], FMT);
    assert.match(texto, /\(3 bloco\(s\), 3h\)/);
    assert.equal(texto.includes("Entrega (bloco)"), false);
  });

  it("bloco cujo marco não veio neste turno continua aparecendo sozinho", () => {
    const texto = resumoDosEventosCriados(
      [evento({ titulo: "Extra", papel: "bloco", prazo_ref: "marco-antigo", eventId: "b9" })],
      FMT,
    );
    assert.match(texto, /^Extra: bloco de 45 min, /);
  });

  it("vários compromissos avulsos entram no mesmo toast", () => {
    const texto = resumoDosEventosCriados([evento({ titulo: "A" }), evento({ titulo: "B", eventId: "ev2" })], FMT);
    assert.equal(texto.split(" · ").length, 2);
    assert.match(texto, /^A: /);
  });

  it("turno sem evento criado não vira toast", () => {
    assert.equal(resumoDosEventosCriados([], FMT), "");
  });
});

describe("B) ajuste iniciado pelo usuário: alvo", () => {
  it("bloco com horário aceita ajuste de duração", () => {
    assert.equal(alvoDeAjuste(quest({})), "duracao");
  });

  it("marco de prazo aceita ajuste de esforço, mesmo de dia inteiro", () => {
    assert.equal(alvoDeAjuste(quest({ tipo: "deadline" })), "esforco");
    assert.equal(alvoDeAjuste(quest({ tipo: "deadline", diaInteiro: true })), "esforco");
  });

  it("foco de dia inteiro não oferece ajuste: o servidor devolveria alvoIncompativel", () => {
    assert.equal(alvoDeAjuste(quest({ diaInteiro: true })), "");
  });
});

describe("B) ajuste iniciado pelo usuário: tempo atual", () => {
  it("duração do próprio bloco", () => {
    assert.equal(minutosAtuais(quest({}), []), 60);
  });

  it("esforço do marco é a soma dos blocos que apontam para ele", () => {
    const marco = quest({ eventId: "marco1", tipo: "deadline", diaInteiro: true, inicio: "2026-09-18", fim: "2026-09-19" });
    const lista = [
      marco,
      quest({ eventId: "b1", prazoRef: "marco1", inicio: "2026-09-16T09:00:00-03:00", fim: "2026-09-16T10:00:00-03:00" }),
      quest({ eventId: "b2", prazoRef: "marco1", inicio: "2026-09-17T09:00:00-03:00", fim: "2026-09-17T10:30:00-03:00" }),
      // De outro prazo: não entra na conta.
      quest({ eventId: "b3", prazoRef: "outro", inicio: "2026-09-17T14:00:00-03:00", fim: "2026-09-17T16:00:00-03:00" }),
    ];
    assert.equal(minutosAtuais(marco, lista), 150);
  });

  it("marco sem bloco nenhum tem esforço zero", () => {
    const marco = quest({ eventId: "marco1", tipo: "deadline" });
    assert.equal(minutosAtuais(marco, [marco]), 0);
  });
});

describe("B) ajuste iniciado pelo usuário: proposto_min", () => {
  it("entra na grade de 15 min que o servidor exige", () => {
    assert.equal(normalizarPropostoMin("duracao", 47), 45);
    assert.equal(normalizarPropostoMin("duracao", 53), 60);
  });

  it("respeita os limites de cada alvo (espelho de interpretarPedidoDeAjuste)", () => {
    assert.equal(normalizarPropostoMin("duracao", 0), LIMITES_DE_AJUSTE.duracao.min);
    assert.equal(normalizarPropostoMin("duracao", 9999), LIMITES_DE_AJUSTE.duracao.max);
    assert.equal(normalizarPropostoMin("esforco", 10), LIMITES_DE_AJUSTE.esforco.min);
    assert.equal(normalizarPropostoMin("esforco", 9999), LIMITES_DE_AJUSTE.esforco.max);
  });

  it("valor ilegível cai no mínimo em vez de virar NaN no corpo do POST", () => {
    assert.equal(normalizarPropostoMin("duracao", Number.NaN), LIMITES_DE_AJUSTE.duracao.min);
  });

  it("todo valor normalizado seria aceito pelo servidor", () => {
    for (const alvo of ["duracao", "esforco"] as const) {
      for (const bruto of [-10, 1, 7, 47, 100, 719, 2401, 99999]) {
        const v = normalizarPropostoMin(alvo, bruto);
        assert.equal(v % LIMITES_DE_AJUSTE.grade, 0);
        assert.ok(v >= LIMITES_DE_AJUSTE[alvo].min && v <= LIMITES_DE_AJUSTE[alvo].max, `${alvo} ${bruto} -> ${v}`);
      }
    }
  });
});

describe("B) ajuste iniciado pelo usuário: a proposta", () => {
  it("nasce com origem 'usuario' e o alvo da quest", () => {
    const p = propostaDoUsuario(quest({}), [], "pessoal", "Ana");
    assert.ok(p);
    assert.equal(p.origem, "usuario");
    assert.equal(p.kind, "ajuste");
    assert.equal(p.alvo, "duracao");
    assert.equal(p.squad_id, "pessoal");
    assert.equal(p.eventId, "ev1");
    assert.equal(p.pessoa_nome, "Ana");
  });

  it("parte do tempo atual, já normalizado", () => {
    const q = quest({ inicio: "2026-09-15T14:00:00-03:00", fim: "2026-09-15T14:47:00-03:00" });
    const p = propostaDoUsuario(q, [], "pessoal");
    assert.ok(p);
    assert.equal(p.atual_min, 47);
    assert.equal(p.proposto_min, 45);
  });

  it("id deriva do evento: clicar duas vezes não empilha dois cards", () => {
    const a = propostaDoUsuario(quest({}), [], "pessoal");
    const b = propostaDoUsuario(quest({}), [], "pessoal");
    assert.ok(a && b);
    assert.equal(a.id, b.id);
  });

  it("sem nome conhecido, cai no id do membro em vez de ficar vazio", () => {
    const p = propostaDoUsuario(quest({ membro: "ana" }), [], "pessoal");
    assert.ok(p);
    assert.equal(p.pessoa_nome, "ana");
  });

  it("quest que não aceita ajuste não vira card", () => {
    assert.equal(propostaDoUsuario(quest({ diaInteiro: true }), [], "pessoal"), null);
  });

  it("marco vira proposta de esforço com a soma dos blocos", () => {
    const marco = quest({ eventId: "marco1", tipo: "deadline", diaInteiro: true, inicio: "2026-09-18", fim: "2026-09-19" });
    const lista = [
      marco,
      quest({ eventId: "b1", prazoRef: "marco1", inicio: "2026-09-16T09:00:00-03:00", fim: "2026-09-16T11:00:00-03:00" }),
    ];
    const p = propostaDoUsuario(marco, lista, "pessoal");
    assert.ok(p);
    assert.equal(p.alvo, "esforco");
    assert.equal(p.atual_min, 120);
    assert.equal(p.proposto_min, 120);
  });

  it("marco sem blocos parte do mínimo aceito, não de 0 (que o servidor recusaria)", () => {
    const marco = quest({ eventId: "marco1", tipo: "deadline" });
    const p = propostaDoUsuario(marco, [marco], "pessoal");
    assert.ok(p);
    assert.equal(p.proposto_min, LIMITES_DE_AJUSTE.esforco.min);
  });
});
