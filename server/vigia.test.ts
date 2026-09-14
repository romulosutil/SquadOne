/**
 * Vigia dos lembretes: deduplicação em memória, retentativa, aviso de
 * desconexão e isolamento de falhas. Dependências são dublês — nada toca o
 * Google nem o ntfy.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { lerJanela } from "./alocador.ts";
import { PrecisaConectar } from "./auth-store.ts";
import { listarQuestsDaJanela, type QuestCalendario } from "./calendar.ts";
import type { MensagemDePush } from "./push.ts";
import type { Roster } from "./squad.ts";
import { AVISO_DESCONECTADO, criarVigia, type DependenciasDaVigia } from "./vigia.ts";

const JANELA = lerJanela({});
const AGORA = new Date("2026-09-14T12:00:00-03:00");

const pessoa = { id: "po", nome: "Ana", papel: "PO", escopo: "", sprite: "x", hiredAt: "2026-09-01" };
const ROSTER: Roster = {
  version: 3,
  idsAposentados: { pessoas: [], dominios: [] },
  squads: [
    {
      id: "pessoal", nome: "Pessoal", escopo: "", calendarId: "primary", unlockOrder: [[1, 1]],
      dominios: [{ id: "geral", nome: "Geral", escopo: "", slot: [1, 1], room: "r", criadoEm: "2026-09-01", po: pessoa, integrantes: [] }],
    },
  ],
};

function quest(p: Partial<QuestCalendario> = {}): QuestCalendario {
  return {
    eventId: "ev1", titulo: "[PO] Revisar contrato",
    inicio: "2026-09-14T12:10:00-03:00", fim: "2026-09-14T13:10:00-03:00",
    diaInteiro: false, tipo: "time_blocking", dominio: "geral", membro: "po", squad: "pessoal", prazoRef: "",
    ...p,
  };
}

function montar(sobre: Partial<DependenciasDaVigia> = {}) {
  const enviadas: MensagemDePush[] = [];
  const dep: DependenciasDaVigia = {
    lerJanela: () => JANELA,
    lerRoster: async () => ROSTER,
    obterToken: async () => "tk",
    listar: async () => [quest()],
    enviar: async (m) => {
      enviadas.push(m);
    },
    log: { log() {}, error() {} },
    ...sobre,
  };
  return { vigia: criarVigia(dep), enviadas };
}

const REAL = { enviar: true, registrar: true };

describe("vigia", () => {
  it("avisa uma vez só em varreduras seguidas", async () => {
    const { vigia, enviadas } = montar();
    await vigia.varrer(AGORA, REAL);
    await vigia.varrer(new Date(AGORA.getTime() + 60_000), REAL);
    assert.equal(enviadas.length, 1);
    assert.equal(enviadas[0].titulo, "Em 10 min: [PO] Revisar contrato");
  });

  it("push que falhou não entra na deduplicação e é tentado de novo", async () => {
    let falhar = true;
    const enviadas: MensagemDePush[] = [];
    const { vigia } = montar({
      enviar: async (m) => {
        if (falhar) throw new Error("ntfy fora");
        enviadas.push(m);
      },
    });
    const r1 = await vigia.varrer(AGORA, REAL);
    assert.equal(r1.erros.length, 1);
    assert.equal(r1.mensagens[0].enviada, false);
    falhar = false;
    await vigia.varrer(new Date(AGORA.getTime() + 60_000), REAL);
    assert.equal(enviadas.length, 1);
  });

  it("enviar=false só monta a mensagem", async () => {
    const { vigia, enviadas } = montar();
    const r = await vigia.varrer(AGORA, { enviar: false, registrar: false });
    assert.equal(enviadas.length, 0);
    assert.equal(r.mensagens.length, 1);
    assert.equal(r.mensagens[0].enviada, false);
    assert.equal(r.mensagens[0].eventId, "ev1");
  });

  it("varredura de teste (registrar=false) não suprime o aviso real", async () => {
    const { vigia, enviadas } = montar();
    await vigia.varrer(AGORA, { enviar: true, registrar: false });
    await vigia.varrer(AGORA, REAL);
    assert.equal(enviadas.length, 2);
  });

  it("evento movido depois do aviso: avisa de novo", async () => {
    let atual = quest();
    const { vigia, enviadas } = montar({ listar: async () => [atual] });
    await vigia.varrer(AGORA, REAL);
    atual = quest({ inicio: "2026-09-14T12:08:00-03:00", fim: "2026-09-14T13:08:00-03:00" });
    await vigia.varrer(AGORA, REAL);
    assert.equal(enviadas.length, 2);
  });

  it("sem credencial: um aviso de desconexão por perda, não por minuto", async () => {
    let conectado = false;
    const { vigia, enviadas } = montar({
      obterToken: async () => {
        if (!conectado) throw new PrecisaConectar("sem credencial");
        return "tk";
      },
      listar: async () => [],
    });
    const r = await vigia.varrer(AGORA, REAL);
    assert.equal(r.semCredencial, true);
    await vigia.varrer(AGORA, REAL);
    assert.deepEqual(enviadas, [AVISO_DESCONECTADO]);

    conectado = true;
    await vigia.varrer(AGORA, REAL);
    conectado = false;
    await vigia.varrer(AGORA, REAL);
    assert.equal(enviadas.length, 2);
  });

  it("varredura de teste sem credencial não manda aviso de desconexão", async () => {
    const { vigia, enviadas } = montar({
      obterToken: async () => {
        throw new PrecisaConectar("sem credencial");
      },
    });
    const r = await vigia.varrer(AGORA, { enviar: true, registrar: false });
    assert.equal(r.semCredencial, true);
    assert.equal(enviadas.length, 0);
  });

  it("falha na leitura de um calendário vira erro, não exceção", async () => {
    const { vigia } = montar({
      listar: async () => {
        throw new Error("Google Calendar respondeu 503");
      },
    });
    const r = await vigia.varrer(AGORA, REAL);
    assert.equal(r.mensagens.length, 0);
    assert.match(r.erros[0], /primary/);
  });

  it("pede ao Google a janela agora → agora + antecedência + 2 varreduras", async () => {
    let pedido: { de: Date; ate: Date } | null = null;
    const { vigia } = montar({
      listar: async (_t, _c, de, ate) => {
        pedido = { de, ate };
        return [];
      },
    });
    await vigia.varrer(AGORA, REAL);
    assert.equal(pedido!.de.getTime(), AGORA.getTime());
    assert.equal(pedido!.ate.getTime(), AGORA.getTime() + 12 * 60_000);
  });
});

describe("listarQuestsDaJanela", () => {
  const fetchOriginal = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("uma leitura sem filtro de marca; só volta evento do SquadOne não cancelado", async () => {
    const urls: string[] = [];
    const marcas = { squadone_dominio: "geral", squadone_membro: "po", squadone_tipo: "time_blocking", squadone_squad: "pessoal" };
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { id: "a1", summary: "do app", start: { dateTime: "2026-09-14T12:10:00-03:00" }, end: { dateTime: "2026-09-14T13:10:00-03:00" }, extendedProperties: { private: marcas } },
            { id: "b2", summary: "reunião de fora", start: { dateTime: "2026-09-14T12:10:00-03:00" }, end: { dateTime: "2026-09-14T13:00:00-03:00" } },
            { id: "c3", status: "cancelled", summary: "apagado", start: { dateTime: "2026-09-14T12:10:00-03:00" }, end: { dateTime: "2026-09-14T13:00:00-03:00" }, extendedProperties: { private: marcas } },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const quests = await listarQuestsDaJanela("tk", "primary", AGORA, new Date(AGORA.getTime() + 12 * 60_000));

    assert.deepEqual(quests.map((q) => q.eventId), ["a1"]);
    assert.equal(urls.length, 1);
    const busca = new URL(urls[0]).searchParams;
    assert.equal(busca.get("timeMin"), AGORA.toISOString());
    assert.equal(busca.get("singleEvents"), "true");
    assert.equal(busca.has("privateExtendedProperty"), false);
  });
});
