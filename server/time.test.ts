/**
 * Time vivo: a regra pura que agrupa as quests lidas por squad. O leitor com
 * cache entra só pelo que é regra (credencial recusada em tudo, falha parcial),
 * com `listar` dublê: nada aqui toca o Google.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrecisaConectar } from "./auth-store.ts";
import { ErroCalendario, type QuestCalendario } from "./calendar.ts";
import type { Roster } from "./squad.ts";
import { agruparTimePorSquad, criarLeitorDoTime, JANELA_DO_TIME } from "./time.ts";

const t = (iso: string) => new Date(iso).getTime();
/** Quarta-feira, 12:00 em São Paulo. */
const AGORA = t("2026-10-07T12:00:00-03:00");

function quest(eventId: string, p: Partial<QuestCalendario> = {}): QuestCalendario {
  return {
    eventId,
    titulo: eventId,
    inicio: "2026-10-07T15:00:00-03:00",
    fim: "2026-10-07T16:00:00-03:00",
    diaInteiro: false,
    tipo: "time_blocking",
    dominio: "geral",
    membro: "ana",
    squad: "pessoal",
    prazoRef: "",
    ...p,
  };
}

const pessoa = (id: string) => ({ id, nome: id, papel: "PO", escopo: "", sprite: "x", hiredAt: "2026-09-01" });
function dominio(id: string, arquivado = false) {
  return { id, nome: id, escopo: "", slot: [1, 1] as [number, number], room: "r", criadoEm: "2026-09-01", po: pessoa(`po-${id}`), integrantes: [], ...(arquivado ? { arquivado: true } : {}) };
}
const ROSTER: Roster = {
  version: 3,
  idsAposentados: { pessoas: [], dominios: [] },
  squads: [
    { id: "pessoal", nome: "Pessoal", escopo: "", calendarId: "primary", unlockOrder: [[1, 1]], dominios: [dominio("geral"), dominio("velho", true)] },
    { id: "p4f", nome: "Pay4Fun", escopo: "", calendarId: "primary", unlockOrder: [[1, 1]], dominios: [dominio("p4f--dev")] },
    { id: "prumo", nome: "PRUMO", escopo: "", calendarId: "prumo@group", unlockOrder: [[1, 1]], dominios: [dominio("prumo--geral")] },
    { id: "morta", nome: "Morta", escopo: "", calendarId: "primary", unlockOrder: [[1, 1]], dominios: [dominio("morta--x")], arquivado: true },
  ],
};

const porId = (r: ReturnType<typeof agruparTimePorSquad>) => Object.fromEntries(r.map((s) => [s.id, s]));

describe("agruparTimePorSquad", () => {
  it("uma entrada por squad ativa, na ordem do roster, mesmo sem quest", () => {
    assert.deepEqual(agruparTimePorSquad(ROSTER, [], AGORA), [
      { id: "pessoal", emBlocoAgora: [], proxima: null },
      { id: "p4f", emBlocoAgora: [], proxima: null },
      { id: "prumo", emBlocoAgora: [], proxima: null },
    ]);
  });

  const casos: Array<{ nome: string; quests: QuestCalendario[]; squad: string; emBloco: string[]; proxima: string | null }> = [
    { nome: "domínio arquivado fica fora", quests: [quest("a", { dominio: "velho" })], squad: "pessoal", emBloco: [], proxima: null },
    { nome: "evento sem marca de domínio fica fora", quests: [quest("a", { dominio: "" })], squad: "pessoal", emBloco: [], proxima: null },
    { nome: "domínio de squad arquivada fica fora", quests: [quest("a", { dominio: "morta--x" })], squad: "pessoal", emBloco: [], proxima: null },
    {
      nome: "bloco em curso é 'em bloco', não 'próxima'",
      quests: [quest("agora", { inicio: "2026-10-07T11:00:00-03:00", fim: "2026-10-07T13:00:00-03:00" }), quest("depois")],
      squad: "pessoal",
      emBloco: ["agora"],
      proxima: "depois",
    },
    {
      nome: "o que terminou sai; a próxima é a mais cedo",
      quests: [
        quest("terminou", { inicio: "2026-10-07T09:00:00-03:00", fim: "2026-10-07T10:00:00-03:00" }),
        quest("amanha", { inicio: "2026-10-08T09:00:00-03:00", fim: "2026-10-08T10:00:00-03:00" }),
        quest("hoje", { inicio: "2026-10-07T14:00:00-03:00", fim: "2026-10-07T15:00:00-03:00" }),
      ],
      squad: "pessoal",
      emBloco: [],
      proxima: "hoje",
    },
    {
      nome: "marco conta pelo prazo e nunca está 'em bloco'",
      quests: [
        quest("marco", { tipo: "deadline", inicio: "2026-10-07T11:45:00-03:00", fim: "2026-10-07T12:30:00-03:00" }),
        quest("bloco", { inicio: "2026-10-07T13:00:00-03:00", fim: "2026-10-07T14:00:00-03:00" }),
      ],
      squad: "pessoal",
      emBloco: [],
      proxima: "marco",
    },
    {
      nome: "dia inteiro de hoje não é 'em bloco' e ainda não terminou",
      quests: [quest("dia", { diaInteiro: true, inicio: "2026-10-07", fim: "2026-10-08" })],
      squad: "pessoal",
      emBloco: [],
      proxima: "dia",
    },
    {
      nome: "dia inteiro de ontem já terminou (meia-noite em São Paulo)",
      quests: [quest("ontem", { diaInteiro: true, inicio: "2026-10-06", fim: "2026-10-07" })],
      squad: "pessoal",
      emBloco: [],
      proxima: null,
    },
  ];
  for (const c of casos) {
    it(c.nome, () => {
      const s = porId(agruparTimePorSquad(ROSTER, c.quests, AGORA))[c.squad];
      assert.deepEqual(s.emBlocoAgora.map((b) => b.titulo), c.emBloco);
      assert.equal(s.proxima?.titulo ?? null, c.proxima);
    });
  }

  it("dedupe por eventId: duas squads no mesmo calendário leem o mesmo evento duas vezes", () => {
    const ev = quest("ev", { dominio: "p4f--dev", membro: "bia", inicio: "2026-10-07T11:00:00-03:00", fim: "2026-10-07T13:00:00-03:00" });
    const r = porId(agruparTimePorSquad(ROSTER, [ev, { ...ev }], AGORA));
    assert.deepEqual(r.p4f.emBlocoAgora, [{ pessoaId: "bia", titulo: "ev" }]);
    // O evento é do domínio, não do calendário: a outra squad do "primary" não o recebe.
    assert.deepEqual(r.pessoal.emBlocoAgora, []);
  });

  it("próxima traz o prazo do marco no `inicio` e a pessoa", () => {
    const r = porId(agruparTimePorSquad(ROSTER, [quest("m", { tipo: "deadline", membro: "caio", inicio: "2026-10-09T17:45:00-03:00", fim: "2026-10-09T18:00:00-03:00" })], AGORA));
    assert.deepEqual(r.pessoal.proxima, { titulo: "m", inicio: "2026-10-09T18:00:00-03:00", pessoaId: "caio" });
  });
});

describe("criarLeitorDoTime", () => {
  const base = (listar: (cal: string) => Promise<QuestCalendario[]>) => {
    const chamadas: Array<{ cal: string; de: Date; ate: Date }> = [];
    let agora = AGORA;
    const ler = criarLeitorDoTime({
      lerRoster: async () => ROSTER,
      obterToken: async () => "tok",
      listar: async (_token, cal, de, ate) => {
        chamadas.push({ cal, de, ate });
        return listar(cal);
      },
      relogio: () => new Date(agora),
    });
    return { ler, chamadas, avancar: (ms: number) => (agora += ms) };
  };

  it("um events.list por calendário distinto, na janela [−1 dia, +7 dias], com cache de 60 s", async () => {
    const { ler, chamadas, avancar } = base(async () => []);
    const r = await ler();
    assert.deepEqual(chamadas.map((c) => c.cal), ["primary", "prumo@group"]);
    assert.equal(chamadas[0].de.getTime(), AGORA - JANELA_DO_TIME.antesMs);
    assert.equal(chamadas[0].ate.getTime(), AGORA + JANELA_DO_TIME.depoisMs);
    assert.deepEqual(r.squads.map((s) => s.id), ["pessoal", "p4f", "prumo"]);
    await ler();
    assert.equal(chamadas.length, 2);
    avancar(61_000);
    await ler();
    assert.equal(chamadas.length, 4);
  });

  it("calendário que falha: as squads dele saem de `squads` e voltam em `erros`", async () => {
    const { ler } = base(async (cal) => {
      if (cal === "prumo@group") throw new Error("quota");
      return [];
    });
    const r = await ler();
    assert.deepEqual(r.squads.map((s) => s.id), ["pessoal", "p4f"]);
    assert.deepEqual(r.erros, [{ squadId: "prumo", erro: "quota" }]);
  });

  it("todo calendário recusando a credencial vira PrecisaConectar (401), não squads vazias", async () => {
    const { ler } = base(async () => {
      throw new ErroCalendario(401, "{}");
    });
    await assert.rejects(ler(), PrecisaConectar);
  });
});
