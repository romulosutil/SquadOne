/**
 * Vigia dos lembretes: deduplicação em memória, retentativa, aviso de
 * desconexão e isolamento de falhas. Dependências são dublês — nada toca o
 * Google nem a fila de avisos.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { lerJanela } from "./alocador.ts";
import { validarAviso, type Aviso } from "./avisos.ts";
import { PrecisaConectar } from "./auth-store.ts";
import { listarQuestsDaJanela, type QuestCalendario } from "./calendar.ts";
import { VARREDURA_MS } from "./lembretes.ts";
import type { Roster } from "./squad.ts";
import { avisoDeDesconexao, criarVigia, type DependenciasDaVigia } from "./vigia.ts";

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
  const enviadas: Aviso[] = [];
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
    assert.equal(enviadas[0].titulo, "⏳ Em 10 min: [PO] Revisar contrato");
  });

  it("aviso que falhou não entra na deduplicação e é tentado de novo", async () => {
    let falhar = true;
    const enviadas: Aviso[] = [];
    const { vigia } = montar({
      enviar: async (m) => {
        if (falhar) throw new Error("fila fora");
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
    assert.deepEqual(enviadas, [avisoDeDesconexao(AGORA)]);
    validarAviso(enviadas[0]);

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

  it("mesmo eventId em dois calendários dispara uma vez só na mesma varredura (F3)", async () => {
    const roster2Squads: Roster = {
      version: 3,
      idsAposentados: { pessoas: [], dominios: [] },
      squads: [
        {
          id: "pessoal", nome: "Pessoal", escopo: "", calendarId: "cal-a", unlockOrder: [[1, 1]],
          dominios: [{ id: "geral", nome: "Geral", escopo: "", slot: [1, 1], room: "r", criadoEm: "2026-09-01", po: pessoa, integrantes: [] }],
        },
        {
          id: "outra", nome: "Outra", escopo: "", calendarId: "cal-b", unlockOrder: [[1, 1]],
          dominios: [{ id: "outro", nome: "Outro", escopo: "", slot: [1, 1], room: "r", criadoEm: "2026-09-01", po: pessoa, integrantes: [] }],
        },
      ],
    };
    const { vigia, enviadas } = montar({
      lerRoster: async () => roster2Squads,
      // Mesmo eventId volta para os dois calendários (ex.: as duas squads apontam
      // o mesmo calendarId por engano, ou o Google devolve o mesmo evento).
      listar: async () => [quest()],
    });
    const r = await vigia.varrer(AGORA, REAL);
    assert.equal(enviadas.length, 1);
    assert.equal(r.mensagens.length, 1);
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

  it("iniciar: falha permanente loga uma vez, não a cada tick (F2)", async () => {
    const logs: string[] = [];
    let falhar = true;
    const { vigia } = montar({
      lerJanela: () => {
        if (falhar) throw new Error("JANELA_TRABALHO ilegível");
        return JANELA;
      },
      log: { log() {}, error: (m: unknown) => logs.push(String(m)) },
    });
    const flush = () => new Promise<void>((r) => setImmediate(r));

    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const parar = vigia.iniciar(() => AGORA);
      await flush(); // tick imediato do iniciar()
      mock.timers.tick(VARREDURA_MS);
      await flush(); // mesma falha: não deve logar de novo
      mock.timers.tick(VARREDURA_MS);
      await flush(); // mesma falha de novo
      assert.equal(
        logs.filter((m) => m.startsWith("[vigia] varredura falhou")).length,
        1,
        "logou mais de uma vez a mesma falha",
      );

      falhar = false;
      mock.timers.tick(VARREDURA_MS);
      await flush(); // volta a funcionar: loga uma vez
      assert.equal(
        logs.filter((m) => m === "[vigia] varredura voltou a funcionar").length,
        1,
      );

      mock.timers.tick(VARREDURA_MS);
      await flush(); // continua ok: não loga de novo
      assert.equal(
        logs.filter((m) => m === "[vigia] varredura voltou a funcionar").length,
        1,
      );

      parar();
    } finally {
      mock.timers.reset();
    }
  });
});

describe("vigia: resumo matinal", () => {
  const MANHA = new Date("2026-09-14T07:30:00-03:00");
  const doDia = [quest({ inicio: "2026-09-14T09:00:00-03:00", fim: "2026-09-14T10:00:00-03:00" })];

  function comResumo(sobre: Partial<DependenciasDaVigia> = {}, gravados: string[] = [], lido: string | null = null) {
    return montar({
      listar: async () => doDia,
      resumoMatinal: { ler: async () => lido, gravar: async (d) => void gravados.push(d) },
      ...sobre,
    });
  }

  it("manda uma vez por dia e grava o dia", async () => {
    const gravados: string[] = [];
    const { vigia, enviadas } = comResumo({}, gravados);
    await vigia.varrer(MANHA, REAL);
    await vigia.varrer(new Date(MANHA.getTime() + 60_000), REAL);
    assert.equal(enviadas.length, 1);
    assert.equal(enviadas[0].chave, "resumo-matinal:2026-09-14");
    assert.deepEqual(gravados, ["2026-09-14"]);
  });

  it("redeploy no meio da manhã não repete: o dia gravado manda mais que a memória", async () => {
    const { vigia, enviadas } = comResumo({}, [], "2026-09-14");
    await vigia.varrer(MANHA, REAL);
    assert.equal(enviadas.length, 0);
  });

  it("fora da janela (antes das 7h30 e depois das 11h) não manda", async () => {
    const { vigia, enviadas } = comResumo();
    await vigia.varrer(new Date("2026-09-14T07:00:00-03:00"), REAL);
    await vigia.varrer(new Date("2026-09-14T11:00:00-03:00"), REAL);
    assert.equal(enviadas.length, 0);
  });

  it("sem resumoMatinal na dependência fica desligado", async () => {
    const { vigia, enviadas } = montar({ listar: async () => doDia });
    await vigia.varrer(MANHA, REAL);
    assert.equal(enviadas.length, 0);
  });

  it("envio que falhou volta no minuto seguinte, sem gravar o dia", async () => {
    let falhar = true;
    const gravados: string[] = [];
    const { vigia, enviadas } = comResumo(
      {
        enviar: async (m) => {
          if (falhar) throw new Error("telegram e fila fora");
          enviadas.push(m);
        },
      },
      gravados,
    );
    const primeira = await vigia.varrer(MANHA, REAL);
    assert.match(primeira.erros[0], /resumo matinal não saiu/);
    assert.deepEqual(gravados, []);
    falhar = false;
    await vigia.varrer(new Date(MANHA.getTime() + 60_000), REAL);
    assert.equal(enviadas.length, 1);
    assert.deepEqual(gravados, ["2026-09-14"]);
  });

  it("calendário que falhou não vira 'dia livre': nada é mandado nem gravado", async () => {
    const gravados: string[] = [];
    const { vigia, enviadas } = comResumo({ listar: async () => Promise.reject(new Error("google 503")) }, gravados);
    const r = await vigia.varrer(MANHA, REAL);
    assert.equal(enviadas.length, 0);
    assert.deepEqual(gravados, []);
    assert.match(r.erros.join("\n"), /resumo, calendário 'primary': google 503/);
  });

  it("dia vazio não manda nada e também não repete a leitura até as 11h", async () => {
    let leituras = 0;
    const gravados: string[] = [];
    const { vigia, enviadas } = comResumo(
      {
        listar: async () => {
          leituras++;
          return [];
        },
      },
      gravados,
    );
    await vigia.varrer(MANHA, REAL);
    const depois = leituras;
    await vigia.varrer(new Date(MANHA.getTime() + 60_000), REAL);
    assert.equal(enviadas.length, 0);
    assert.deepEqual(gravados, ["2026-09-14"]);
    assert.equal(leituras - depois, 1, "só a leitura da janela de lembretes, não a do resumo");
  });

  it("simulação (registrar=false) mostra o resumo sem gravar nem consumir o do dia", async () => {
    const gravados: string[] = [];
    const { vigia, enviadas } = comResumo({}, gravados);
    const sim = await vigia.varrer(MANHA, { enviar: false, registrar: false });
    assert.equal(sim.mensagens.find((m) => m.eventId === "resumo-matinal")?.enviada, false);
    assert.equal(enviadas.length, 0);
    assert.deepEqual(gravados, []);
    await vigia.varrer(MANHA, REAL);
    assert.equal(enviadas.length, 1);
  });

  it("falha ao gravar o dia vira erro da varredura mas o resumo já saiu", async () => {
    const { vigia, enviadas } = comResumo({ resumoMatinal: { ler: async () => null, gravar: async () => Promise.reject(new Error("disco cheio")) } });
    const r = await vigia.varrer(MANHA, REAL);
    assert.equal(enviadas.length, 1);
    assert.match(r.erros.join("\n"), /não gravado/);
    await vigia.varrer(new Date(MANHA.getTime() + 60_000), REAL);
    assert.equal(enviadas.length, 1, "a memória do processo evita o segundo");
  });

  it("lembrete e resumo na mesma varredura: os dois saem", async () => {
    const { vigia, enviadas } = comResumo({
      listar: async () => [
        quest({ eventId: "agora", inicio: "2026-09-14T07:40:00-03:00", fim: "2026-09-14T08:40:00-03:00" }),
        ...doDia,
      ],
    });
    await vigia.varrer(MANHA, REAL);
    assert.deepEqual(enviadas.map((m) => m.chave.split(":")[0]), ["lembrete", "resumo-matinal"]);
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
