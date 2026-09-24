/**
 * Horizonte da busca: os 60 dias de agenda contam do INÍCIO da busca, não de
 * agora. "Depois da primeira quinzena de janeiro de 2027", pedido em setembro
 * de 2026, virava "Nenhum horário livre ... entre 2027-01-16 e 2027-01-16":
 * o teto `agora + 60 dias` caía antes do começo da busca.
 *
 * Roda com `npm test` (node:test via tsx). Nada aqui toca o Google: `fetch` é
 * substituído.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { alocar, horizonteDaBusca, HORIZONTE_DIAS, lerJanela, type Intervalo } from "./alocador.ts";
import { AgendaDoTurno } from "./agenda.ts";
import { agendarCompromisso } from "./agendamento.ts";

const JANELA = lerJanela({});
/** Quinta, 24/09/2026, 11:39 em São Paulo: a hora do pedido que falhou. */
const AGORA = new Date("2026-09-24T11:39:00-03:00");
const t = (iso: string) => new Date(iso).getTime();
const DIA_MS = 24 * 3600_000;
/** 16/01/2027 é sábado: o primeiro dia de trabalho é a segunda, 18. */
const A_PARTIR_DE = t("2027-01-16T00:00:00-03:00");

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

interface Chamada {
  metodo: string;
  url: URL;
  corpo?: any;
}

/** `fetch` falso: GET devolve os eventos que caem no trecho pedido; POST devolve um id. */
function googleFalso(eventos: { inicio: string; fim: string }[] = []): Chamada[] {
  const chamadas: Chamada[] = [];
  globalThis.fetch = (async (url: string, init: any = {}) => {
    const metodo = init.method ?? "GET";
    const u = new URL(url);
    chamadas.push({ metodo, url: u, corpo: init.body ? JSON.parse(init.body) : undefined });
    if (metodo === "POST") {
      return { ok: true, status: 200, json: async () => ({ id: `ev${chamadas.length}` }) };
    }
    const de = Date.parse(u.searchParams.get("timeMin")!);
    const ate = Date.parse(u.searchParams.get("timeMax")!);
    const items = eventos
      .filter((e) => t(e.inicio) < ate && t(e.fim) > de)
      .map((e) => ({ start: { dateTime: e.inicio }, end: { dateTime: e.fim } }));
    return { ok: true, status: 200, json: async () => ({ items }) };
  }) as unknown as typeof fetch;
  return chamadas;
}

const leituras = (chamadas: Chamada[]) => chamadas.filter((c) => c.metodo === "GET");

function agendaReal() {
  return new AgendaDoTurno({ token: "token-de-teste", janela: JANELA, agora: AGORA });
}

function pedido(args: Record<string, any>, agenda: AgendaDoTurno) {
  return {
    args,
    tipoForcado: null,
    baixaPrioridade: false,
    squadId: "pj",
    calendarId: "primary",
    dominio: { id: "geral", nome: "Geral" },
    pessoa: { id: "po", nome: "Ana", papel: "PO" },
    colorId: "9",
    agenda,
  };
}

describe("alocar além dos 60 dias de agora", () => {
  it("foco a partir de 16/01/2027 acha a segunda, 18, às 09:00", () => {
    const { slots } = alocar([], JANELA, { tipo: "foco", duracaoMin: 30, aPartirDe: A_PARTIR_DE }, AGORA.getTime());
    assert.deepEqual(slots, [{ inicio: t("2027-01-18T09:00:00-03:00"), fim: t("2027-01-18T09:30:00-03:00") }]);
  });

  it("blocos de um prazo distante caem entre o início e o prazo", () => {
    const { slots, faltouMin } = alocar(
      [],
      JANELA,
      { tipo: "blocos", esforcoMin: 120, aPartirDe: A_PARTIR_DE, limite: t("2027-01-29T19:00:00-03:00") },
      AGORA.getTime(),
    );
    assert.equal(faltouMin, 0);
    assert.equal(slots[0].inicio, t("2027-01-18T09:00:00-03:00"));
  });
});

describe("horizonteDaBusca", () => {
  it("foco: 14 dias a partir do início da busca", () => {
    const h = horizonteDaBusca({ tipo: "foco", duracaoMin: 30, aPartirDe: A_PARTIR_DE }, AGORA.getTime());
    assert.deepEqual(h, { inicio: A_PARTIR_DE, fim: A_PARTIR_DE + 14 * DIA_MS });
  });

  it("blocos: até o prazo, no máximo 60 dias depois do início", () => {
    const longe = t("2027-12-31T19:00:00-03:00");
    const h = horizonteDaBusca(
      { tipo: "blocos", esforcoMin: 60, aPartirDe: A_PARTIR_DE, limite: longe },
      AGORA.getTime(),
    );
    assert.deepEqual(h, { inicio: A_PARTIR_DE, fim: A_PARTIR_DE + HORIZONTE_DIAS * DIA_MS });
  });

  it("sem a_partir_de começa em agora (na grade de 15 min)", () => {
    const h = horizonteDaBusca({ tipo: "foco", duracaoMin: 30 }, AGORA.getTime());
    assert.equal(h.inicio, t("2026-09-24T11:45:00-03:00"));
  });
});

describe("AgendaDoTurno.ocupacao(trecho)", () => {
  it("trecho dentro dos 60 dias de agora reusa UMA leitura", async () => {
    const chamadas = googleFalso();
    const agenda = agendaReal();
    await agenda.ocupacao();
    await agenda.ocupacao({ inicio: AGORA.getTime() + 3 * DIA_MS, fim: AGORA.getTime() + 17 * DIA_MS });
    assert.equal(leituras(chamadas).length, 1);
  });

  it("trecho além lê o próprio trecho e devolve o que há nele", async () => {
    const ocupado = { inicio: "2027-01-18T09:00:00-03:00", fim: "2027-01-18T12:00:00-03:00" };
    const chamadas = googleFalso([ocupado]);
    const agenda = agendaReal();
    const trecho: Intervalo = { inicio: A_PARTIR_DE, fim: A_PARTIR_DE + 14 * DIA_MS };
    const lidos = await agenda.ocupacao(trecho);
    const [leitura] = leituras(chamadas);
    assert.equal(leituras(chamadas).length, 1);
    assert.equal(Date.parse(leitura.url.searchParams.get("timeMin")!), trecho.inicio);
    assert.equal(Date.parse(leitura.url.searchParams.get("timeMax")!), trecho.fim);
    assert.deepEqual(lidos, [{ inicio: t(ocupado.inicio), fim: t(ocupado.fim) }]);
    // Mesmo trecho de novo: não relê.
    await agenda.ocupacao(trecho);
    assert.equal(leituras(chamadas).length, 1);
  });

  it("reservas do turno entram em qualquer trecho", async () => {
    googleFalso();
    const agenda = agendaReal();
    const reserva = { inicio: t("2027-01-18T09:00:00-03:00"), fim: t("2027-01-18T10:00:00-03:00") };
    agenda.reservar(reserva);
    const lidos = await agenda.ocupacao({ inicio: A_PARTIR_DE, fim: A_PARTIR_DE + 14 * DIA_MS });
    assert.deepEqual(lidos, [reserva]);
  });

  it("trecho vazio (prazo antes do início) não chama o Google", async () => {
    const chamadas = googleFalso();
    const agenda = agendaReal();
    await agenda.ocupacao({ inicio: A_PARTIR_DE, fim: A_PARTIR_DE - DIA_MS });
    assert.equal(leituras(chamadas).length, 0);
  });
});

describe("agendarCompromisso com a_partir_de distante", () => {
  it("o caso do Telegram: marca na primeira brecha depois de 16/01/2027", async () => {
    const chamadas = googleFalso([{ inicio: "2027-01-18T09:00:00-03:00", fim: "2027-01-18T12:00:00-03:00" }]);
    const compromisso = await agendarCompromisso(
      pedido(
        { titulo: "Falar com Rodrigo Aquino", tipo: "time_blocking", duracao_min: 30, a_partir_de: "2027-01-16" },
        agendaReal(),
      ),
    );
    assert.equal(compromisso.eventos[0].inicio, new Date(t("2027-01-18T12:00:00-03:00")).toISOString());
    // Só o trecho do pedido foi lido: a agenda de setembro não serve para janeiro.
    assert.deepEqual(
      leituras(chamadas).map((c) => Date.parse(c.url.searchParams.get("timeMin")!)),
      [A_PARTIR_DE],
    );
  });

  it("horário fixo distante tem o conflito verificado", async () => {
    googleFalso([{ inicio: "2027-03-10T13:30:00-03:00", fim: "2027-03-10T14:30:00-03:00" }]);
    const compromisso = await agendarCompromisso(
      pedido(
        { titulo: "Reunião", tipo: "time_blocking", duracao_min: 60, inicio_fixo: "2027-03-10T14:00:00-03:00" },
        agendaReal(),
      ),
    );
    const avisos = compromisso.avisos.map((a) => a.aviso);
    assert.ok(avisos.some((a) => a.includes("conflita com 1 compromisso")), avisos.join(" | "));
    assert.ok(!avisos.some((a) => a.includes("não verificado")), avisos.join(" | "));
  });

  it("prazo distante com a_partir_de: blocos antes do prazo, sem faltar", async () => {
    googleFalso();
    const compromisso = await agendarCompromisso(
      pedido(
        {
          titulo: "Entregar site",
          tipo: "deadline",
          a_partir_de: "2027-01-16",
          prazo_final: "2027-01-29",
          esforco_min: 120,
        },
        agendaReal(),
      ),
    );
    assert.equal(compromisso.faltou_min, 0);
    assert.equal(compromisso.eventos[1].inicio, new Date(t("2027-01-18T09:00:00-03:00")).toISOString());
  });
});
