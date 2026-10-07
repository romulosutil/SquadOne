import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarBotDoTelegram, TEXTO_FINANCAS_FORA, TEXTO_GASTO_FALHOU, type DepsDoBot } from "./telegram-bot.ts";
import { interpretarUpdate } from "./telegram-entrada.ts";
import type { TurnoResult } from "./orchestrator.ts";

// "gastei 30 no mercado" pelo Telegram (07/10/2026): vai às finanças, nunca ao
// turno (nada de finanças vai ao modelo), e a resposta não traz o valor nem o
// "onde" (RULES 24). Valores inventados.

const AGORA = new Date("2026-10-07T15:00:00Z");
const AGORA_S = AGORA.getTime() / 1000;
const TURNO_VAZIO: TurnoResult = { eventos_criados: [], tarefas_criadas: [], sugestoes: [], avisos: [], erros: [] };
const texto = (id: number, t: string, idadeS = 5) => ({
  update_id: id,
  message: { message_id: id * 10, chat: { id: 111, type: "private" }, text: t, date: AGORA_S - idadeS },
});

function montar(x: Partial<DepsDoBot> = {}) {
  const enviadas: string[] = [];
  const rodadas: string[] = [];
  const anotados: { centavos: number; onde: string; origem: string; quando: string }[] = [];
  const deps: DepsDoBot = {
    segredo: null,
    chatsPermitidos: new Set([111]),
    rodar: async (demanda) => {
      rodadas.push(demanda);
      return TURNO_VAZIO;
    },
    enviar: async (_chat, t) => {
      enviadas.push(t);
    },
    digitando: async () => {},
    transcrever: async () => "gastei 42,50 na farmácia",
    contratar: async () => "",
    responderBotao: async () => {},
    editar: async () => {},
    fmt: { locale: "pt-BR", timeZone: "America/Sao_Paulo" },
    agora: () => AGORA,
    anotarGasto: async (g, origem, quando) => {
      anotados.push({ ...g, origem, quando: quando.toISOString() });
      return /farm/i.test(g.onde) ? "Farmácia" : "Mercado";
    },
    ...x,
  };
  return { bot: criarBotDoTelegram(deps), enviadas, rodadas, anotados };
}

const esperar = async () => {
  for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok));
};

describe("interpretarUpdate: gasto falado", () => {
  it("vira gasto com a hora da mensagem, sem passar pela guarda de atraso", () => {
    const e = interpretarUpdate(texto(1, "gastei 30 no mercado", 3600), new Set([111]), AGORA);
    assert.equal(e.tipo, "gasto");
    if (e.tipo !== "gasto") return;
    assert.deepEqual(e.gasto, { centavos: 3000, onde: "mercado" });
    assert.equal(e.quando.toISOString(), new Date((AGORA_S - 3600) * 1000).toISOString());
  });

  it("comando e frase sem valor continuam demanda", () => {
    assert.equal(interpretarUpdate(texto(2, "/foco gastei 30 no mercado"), new Set([111]), AGORA).tipo, "demanda");
    const prumo = interpretarUpdate(texto(9, "/p gastei 30 no mercado"), new Set([111]), AGORA);
    assert.deepEqual([prumo.tipo, (prumo as { squadId?: string }).squadId], ["demanda", "prumo"]);
    assert.equal(interpretarUpdate(texto(3, "gastei a tarde no mercado"), new Set([111]), AGORA).tipo, "demanda");
  });

  it("chat fora da lista não anota nada", () => {
    assert.equal(interpretarUpdate(texto(4, "gastei 30 no mercado"), new Set([999]), AGORA).tipo, "naoAutorizado");
  });
});

describe("bot: gasto falado", () => {
  it("anota, responde só a categoria e não roda turno", async () => {
    const { bot, enviadas, rodadas, anotados } = montar();
    bot.receber(texto(5, "gastei 30 no mercado"));
    await esperar();
    assert.deepEqual(enviadas, ["Anotado: Mercado"]);
    assert.equal(rodadas.length, 0);
    assert.equal(anotados[0].origem, "tg:111:50");
    assert.ok(!/30/.test(enviadas[0]), "o valor não volta ao chat");
  });

  it("sem finanças no processo: avisa e NÃO manda a frase ao modelo", async () => {
    const { bot, enviadas, rodadas } = montar({ anotarGasto: undefined });
    bot.receber(texto(6, "gastei 30 no mercado"));
    await esperar();
    assert.deepEqual(enviadas, [TEXTO_FINANCAS_FORA]);
    assert.equal(rodadas.length, 0);
  });

  it("falha ao gravar: mensagem genérica, sem o valor", async () => {
    const { bot, enviadas } = montar({
      anotarGasto: async () => {
        throw new Error("disco cheio 30 mercado");
      },
    });
    bot.receber(texto(7, "gastei 30 no mercado"));
    await esperar();
    assert.deepEqual(enviadas, [TEXTO_GASTO_FALHOU]);
  });

  it("áudio que diz um gasto: anota sem ecoar a transcrição", async () => {
    const { bot, enviadas, rodadas, anotados } = montar();
    bot.receber({
      update_id: 8,
      message: { message_id: 80, chat: { id: 111, type: "private" }, voice: { file_id: "F", duration: 4, mime_type: "audio/ogg" }, date: AGORA_S - 5 },
    });
    await bot.ocioso();
    await esperar();
    assert.equal(rodadas.length, 0);
    assert.equal(anotados[0].centavos, 4250);
    assert.deepEqual(enviadas, ["🎙️ Anotado: Farmácia"]);
  });

  it("áudio com /p na legenda é demanda da squad, não gasto", async () => {
    const { bot, rodadas, anotados } = montar();
    bot.receber({
      update_id: 10,
      message: { message_id: 100, chat: { id: 111, type: "private" }, voice: { file_id: "F", duration: 4, mime_type: "audio/ogg" }, caption: "/p", date: AGORA_S - 5 },
    });
    await bot.ocioso();
    await esperar();
    assert.equal(anotados.length, 0);
    assert.deepEqual(rodadas, ["gastei 42,50 na farmácia"]);
  });
});
