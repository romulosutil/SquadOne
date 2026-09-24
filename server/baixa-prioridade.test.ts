/**
 * Modo Baixa Prioridade: força `time_blocking`, procura horário dentro dos 7
 * primeiros dias úteis (respeitando DIAS_TRABALHO) e escolhe por último na
 * série do turno.
 *
 * Roda com `npm test` (node:test via tsx). Nada aqui toca o Google: `fetch` é
 * substituído e a agenda é um dublê com a ocupação dada.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DIAS_UTEIS_BAIXA_PRIORIDADE,
  lerJanela,
  limiteDeDiasUteis,
  SemHorarioLivre,
  type Intervalo,
  type Janela,
} from "./alocador.ts";
import { agendarCompromisso, prioridadeDeAgendamento } from "./agendamento.ts";
import { ehBaixaPrioridade, ehModo, tipoForcado } from "./capabilities.ts";
import type { AgendaDoTurno } from "./agenda.ts";

const JANELA = lerJanela({});
/** Segunda-feira, 12:00 em São Paulo (sem horário de verão no Brasil desde 2019). */
const AGORA = new Date("2026-09-14T12:00:00-03:00");
const t = (iso: string) => new Date(iso).getTime();

/** Dublê da agenda do turno: mesma interface, sem Google e sem relógio. */
function agendaFalsa(ocupacao: Intervalo[], agora = AGORA, janela: Janela = JANELA) {
  const reservas: Intervalo[] = [];
  return {
    token: "token-de-teste",
    janela,
    agora,
    reservas,
    exigirAcesso() {},
    async ocupacao() {
      return [...ocupacao, ...reservas];
    },
    reservar(slot: Intervalo) {
      reservas.push(slot);
    },
  };
}

/** Corpos dos POST que o compromisso mandaria ao Google. */
function capturarPosts(): Record<string, any>[] {
  const posts: Record<string, any>[] = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    posts.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: `ev${posts.length}`, htmlLink: "https://exemplo/ev" }),
    };
  }) as unknown as typeof fetch;
  return posts;
}

function pedido(args: Record<string, any>, agenda: ReturnType<typeof agendaFalsa>, baixa: boolean) {
  return {
    args,
    tipoForcado: "time_blocking" as const,
    baixaPrioridade: baixa,
    squadId: "pessoal",
    calendarId: "primary",
    dominio: { id: "geral", nome: "Geral" },
    pessoa: { id: "po", nome: "Ana", papel: "PO" },
    colorId: "9",
    agenda: agenda as unknown as AgendaDoTurno,
  };
}

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("modo", () => {
  it("baixa_prioridade é modo válido e 'prazo' deixou de ser", () => {
    assert.equal(ehModo("baixa_prioridade"), true);
    assert.equal(ehModo("prazo"), false);
  });

  it("baixa_prioridade força time_blocking, como o foco", () => {
    assert.equal(tipoForcado("baixa_prioridade"), "time_blocking");
    assert.equal(tipoForcado("foco"), "time_blocking");
    assert.equal(tipoForcado("auto"), null);
    assert.equal(ehBaixaPrioridade("baixa_prioridade"), true);
    assert.equal(ehBaixaPrioridade("foco"), false);
  });
});

describe("limiteDeDiasUteis", () => {
  it("conta o resto de hoje como o primeiro dia útil", () => {
    // Seg 14 (12:00 em diante), ter 15, qua 16, qui 17, sex 18, seg 21, ter 22.
    assert.equal(
      limiteDeDiasUteis(AGORA.getTime(), JANELA, DIAS_UTEIS_BAIXA_PRIORIDADE),
      t("2026-09-22T19:00:00-03:00"),
    );
  });

  it("pula o dia que não é de trabalho (DIAS_TRABALHO)", () => {
    // Só segunda e quarta: seg 14, qua 16, seg 21, qua 23, seg 28, qua 30, seg 05/10.
    const seguntaEQuarta = lerJanela({ DIAS_TRABALHO: "1,3" });
    assert.equal(
      limiteDeDiasUteis(AGORA.getTime(), seguntaEQuarta, DIAS_UTEIS_BAIXA_PRIORIDADE),
      t("2026-10-05T19:00:00-03:00"),
    );
  });

  it("dia sem janela sobrando não conta", () => {
    // Sexta 20:00: a janela de sexta já passou, o 1º dia útil é a segunda.
    const sextaTarde = t("2026-09-18T20:00:00-03:00");
    assert.equal(limiteDeDiasUteis(sextaTarde, JANELA, 1), t("2026-09-21T19:00:00-03:00"));
  });
});

describe("agendarCompromisso em baixa prioridade", () => {
  it("grava time_blocking mesmo com o modelo pedindo deadline", async () => {
    const posts = capturarPosts();
    const agenda = agendaFalsa([]);
    const compromisso = await agendarCompromisso(
      pedido(
        { titulo: "Revisar contrato", tipo: "deadline", prazo_final: "2026-09-30", esforco_min: 90 },
        agenda,
        true,
      ),
    );

    assert.equal(compromisso.tipo, "time_blocking");
    assert.equal(compromisso.eventos.length, 1);
    assert.equal(compromisso.eventos[0].papel, "foco");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].extendedProperties.private.squadone_tipo, "time_blocking");
    assert.equal(posts[0].summary, "[PO] Revisar contrato");
    // Sem marco: nada de transparente nem de prefixo de deadline.
    assert.equal(posts[0].transparency, undefined);
  });

  it("não passa do 7º dia útil: agenda cheia até lá vira SemHorarioLivre", async () => {
    capturarPosts();
    const cheiaAte22 = [{ inicio: AGORA.getTime(), fim: t("2026-09-22T19:00:00-03:00") }];
    await assert.rejects(
      agendarCompromisso(
        pedido({ titulo: "Organizar backlog", tipo: "time_blocking", duracao_min: 60 }, agendaFalsa(cheiaAte22), true),
      ),
      SemHorarioLivre,
    );
  });

  it("a MESMA agenda em Focar Agora acha horário depois do 7º dia útil", async () => {
    const posts = capturarPosts();
    const cheiaAte22 = [{ inicio: AGORA.getTime(), fim: t("2026-09-22T19:00:00-03:00") }];
    const compromisso = await agendarCompromisso(
      pedido({ titulo: "Organizar backlog", tipo: "time_blocking", duracao_min: 60 }, agendaFalsa(cheiaAte22), false),
    );
    assert.equal(compromisso.eventos[0].inicio, new Date(t("2026-09-23T09:00:00-03:00")).toISOString());
    assert.equal(posts.length, 1);
  });

  it("dentro da janela, pega o primeiro horário livre como o foco", async () => {
    capturarPosts();
    const agenda = agendaFalsa([{ inicio: AGORA.getTime(), fim: t("2026-09-14T15:00:00-03:00") }]);
    const compromisso = await agendarCompromisso(
      pedido({ titulo: "Ler relatório", tipo: "time_blocking", duracao_min: 45 }, agenda, true),
    );
    assert.equal(compromisso.eventos[0].inicio, new Date(t("2026-09-14T15:00:00-03:00")).toISOString());
  });

  it("prazo_final mais curto que os 7 dias úteis continua valendo", async () => {
    capturarPosts();
    // Livre só depois de quarta 16: com prazo até terça 15, não cabe.
    const cheiaAte16 = [{ inicio: AGORA.getTime(), fim: t("2026-09-16T19:00:00-03:00") }];
    await assert.rejects(
      agendarCompromisso(
        pedido(
          { titulo: "Fechar planilha", tipo: "time_blocking", duracao_min: 60, prazo_final: "2026-09-15" },
          agendaFalsa(cheiaAte16),
          true,
        ),
      ),
      SemHorarioLivre,
    );
  });
});

describe("ordem da série do turno", () => {
  const rank = (args: Record<string, any>, baixa: boolean) =>
    prioridadeDeAgendamento(args, "time_blocking", JANELA, baixa);

  it("baixa prioridade escolhe horário depois de fixo e de foco", () => {
    const fixo = rank({ inicio_fixo: "2026-09-15T14:00:00-03:00", duracao_min: 60 }, false);
    const foco = rank({ duracao_min: 60 }, false);
    const baixa = rank({ duracao_min: 60 }, true);
    assert.ok(fixo[0] < foco[0], "fixo antes de foco");
    assert.ok(foco[0] < baixa[0], "foco antes de baixa prioridade");
  });

  it("prazo do modelo (auto) fica entre o foco e a baixa prioridade", () => {
    const foco = prioridadeDeAgendamento({ duracao_min: 60 }, null, JANELA, false);
    const prazo = prioridadeDeAgendamento({ tipo: "deadline", prazo_final: "2026-09-30" }, null, JANELA, false);
    const baixa = rank({ duracao_min: 60 }, true);
    assert.ok(foco[0] < prazo[0] && prazo[0] < baixa[0]);
  });

  it("hora dita pelo usuário vence a baixa prioridade", () => {
    const fixo = rank({ inicio_fixo: "2026-09-15T14:00:00-03:00", duracao_min: 60 }, true);
    const baixa = rank({ duracao_min: 60 }, true);
    assert.ok(fixo[0] < baixa[0]);
  });
});
