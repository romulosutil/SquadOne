import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarBotDoTelegram, type DepsDoBot } from "./telegram-bot.ts";
import { ModeloOcupado, type TurnoResult } from "./orchestrator.ts";

const SEGREDO = "s".repeat(40);
const FMT = { locale: "pt-BR", timeZone: "America/Sao_Paulo" };
const TURNO_VAZIO: TurnoResult = { eventos_criados: [], sugestoes: [], avisos: [], erros: [] };

function res() {
  const r: any = { statusCode: 0, finalizado: false };
  r.status = (n: number) => { r.statusCode = n; return r; };
  r.end = () => { r.finalizado = true; return r; };
  r.sendStatus = (n: number) => { r.statusCode = n; r.finalizado = true; return r; };
  return r;
}
const req = (corpo: unknown, segredo: string | null = SEGREDO): any => ({
  body: corpo,
  get: (h: string) => (h.toLowerCase() === "x-telegram-bot-api-secret-token" ? (segredo ?? undefined) : undefined),
});
const update = (id: number, text: string, chat = 111) => ({
  update_id: id, message: { message_id: id * 10, chat: { id: chat, type: "private" }, text },
});

function montar(x: Partial<DepsDoBot> = {}) {
  const enviadas: { chatId: number; texto: string; responderA?: number }[] = [];
  const rodadas: { demanda: string; modo: string }[] = [];
  const deps: DepsDoBot = {
    segredo: SEGREDO,
    chatsPermitidos: new Set([111]),
    rodar: async (demanda, modo) => { rodadas.push({ demanda, modo }); return TURNO_VAZIO; },
    enviar: async (chatId, texto, responderA) => { enviadas.push({ chatId, texto, responderA }); },
    digitando: async () => {},
    fmt: FMT,
    ...x,
  };
  return { bot: criarBotDoTelegram(deps), enviadas, rodadas };
}

describe("portao", () => {
  it("segredo errado ou ausente = 401, next não roda", () => {
    const { bot } = montar();
    for (const s of ["errado", null]) {
      const r = res();
      let seguiu = false;
      bot.portao(req({}, s), r, () => { seguiu = true; });
      assert.equal(r.statusCode, 401);
      assert.equal(seguiu, false);
    }
  });

  it("segredo certo chama next", () => {
    const { bot } = montar();
    let seguiu = false;
    bot.portao(req({}), res(), () => { seguiu = true; });
    assert.equal(seguiu, true);
  });
});

describe("processar", () => {
  it("responde 200 ANTES do turno terminar e depois manda o texto em resposta à mensagem", async () => {
    let liberar!: () => void;
    const { bot, enviadas } = montar({ rodar: () => new Promise((ok) => { liberar = () => ok(TURNO_VAZIO); }) });
    const r = res();
    bot.processar(req(update(1, "reunião amanhã")), r, () => {});
    assert.equal(r.statusCode, 200);
    assert.equal(enviadas.length, 0);
    await new Promise((ok) => setImmediate(ok));
    liberar();
    await bot.ocioso();
    assert.deepEqual(enviadas, [{ chatId: 111, texto: "Nada foi agendado.", responderA: 10 }]);
  });

  it("chat não autorizado: 200, sem turno e sem resposta", async () => {
    const { bot, enviadas, rodadas } = montar();
    const r = res();
    bot.processar(req(update(1, "/start", 999)), r, () => {});
    await bot.ocioso();
    assert.equal(r.statusCode, 200);
    assert.equal(rodadas.length + enviadas.length, 0);
  });

  it("update_id repetido roda uma vez só", async () => {
    const { bot, rodadas } = montar();
    bot.processar(req(update(7, "x")), res(), () => {});
    bot.processar(req(update(7, "x")), res(), () => {});
    await bot.ocioso();
    assert.equal(rodadas.length, 1);
  });

  it("/foco passa o modo; /start responde ajuda sem turno", async () => {
    const { bot, rodadas, enviadas } = montar();
    bot.processar(req(update(1, "/foco revisar contrato")), res(), () => {});
    bot.processar(req(update(2, "/start")), res(), () => {});
    await bot.ocioso();
    assert.deepEqual(rodadas, [{ demanda: "revisar contrato", modo: "foco" }]);
    assert.ok(enviadas.some((e) => e.texto.includes("/foco")));
  });

  it("falha do turno vira texto classificado", async () => {
    const { bot, enviadas } = montar({ rodar: async () => { throw new ModeloOcupado("ocupado"); } });
    bot.processar(req(update(1, "x")), res(), () => {});
    await bot.ocioso();
    assert.match(enviadas.at(-1)!.texto, /Gemini sobrecarregado/);
  });

  it("fila serial: o segundo turno só começa depois do primeiro, e avisa a posição", async () => {
    const ordem: string[] = [];
    let liberar!: () => void;
    const { bot, enviadas } = montar({
      rodar: async (demanda) => {
        ordem.push(`inicio ${demanda}`);
        if (demanda === "a") await new Promise<void>((ok) => { liberar = ok; });
        ordem.push(`fim ${demanda}`);
        return TURNO_VAZIO;
      },
    });
    bot.processar(req(update(1, "a")), res(), () => {});
    bot.processar(req(update(2, "b")), res(), () => {});
    await new Promise((ok) => setImmediate(ok));
    assert.deepEqual(ordem, ["inicio a"]);
    assert.ok(enviadas.some((e) => /Na fila \(1 antes desta\)/.test(e.texto)));
    liberar();
    await bot.ocioso();
    assert.deepEqual(ordem, ["inicio a", "fim a", "inicio b", "fim b"]);
  });

  it("enviar que falha não derruba a fila", async () => {
    let n = 0;
    const { bot, rodadas } = montar({ enviar: async () => { n++; throw new Error("403 blocked"); } });
    bot.processar(req(update(1, "a")), res(), () => {});
    bot.processar(req(update(2, "b")), res(), () => {});
    await bot.ocioso();
    assert.equal(rodadas.length, 2);
    assert.ok(n >= 2);
  });
});
