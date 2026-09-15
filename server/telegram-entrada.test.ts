import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  criarMemoriaDeUpdates,
  IDADE_MAXIMA_DEMANDA_MIN,
  interpretarUpdate as interpretarComRelogio,
  textoDeDemandaAtrasada,
} from "./telegram-entrada.ts";

const PERMITIDOS = new Set([111]);
/** `message.date` do Telegram é em SEGUNDOS desde a época. */
const AGORA = new Date("2026-09-15T12:00:00Z");
const AGORA_S = AGORA.getTime() / 1000;
const msg = (x: Record<string, unknown>, chat: Record<string, unknown> = { id: 111, type: "private" }) => ({
  update_id: 9,
  message: { message_id: 5, chat, date: AGORA_S - 30, ...x },
});
const interpretarUpdate = (u: unknown, permitidos: ReadonlySet<number>) => interpretarComRelogio(u, permitidos, AGORA);

describe("interpretarUpdate", () => {
  it("texto comum = demanda auto, aparado", () => {
    assert.deepEqual(interpretarUpdate(msg({ text: "  reunião com o João amanhã 15h " }), PERMITIDOS), {
      tipo: "demanda", updateId: 9, chatId: 111, mensagemId: 5, demanda: "reunião com o João amanhã 15h", modo: "auto",
    });
  });

  const comandos: [string, string, string | null][] = [
    ["/foco revisar contrato", "foco", "revisar contrato"],
    ["/baixa trocar lâmpada", "baixa_prioridade", "trocar lâmpada"],
    ["/foco@SquadOneBot revisar contrato", "foco", "revisar contrato"],
    ["/foco\nlinha 1\nlinha 2", "foco", "linha 1\nlinha 2"],
  ];
  for (const [texto, modo, demanda] of comandos) {
    it(`comando de modo: ${JSON.stringify(texto)}`, () => {
      const e = interpretarUpdate(msg({ text: texto }), PERMITIDOS);
      assert.equal(e.tipo, "demanda");
      assert.equal((e as any).modo, modo);
      assert.equal((e as any).demanda, demanda);
    });
  }

  for (const texto of ["/start", "/ajuda", "/help", "/foco", "/baixa   ", "/qualquer coisa"]) {
    it(`ajuda: ${JSON.stringify(texto)}`, () => {
      assert.equal(interpretarUpdate(msg({ text: texto }), PERMITIDOS).tipo, "ajuda");
    });
  }

  it("foto/áudio sem texto = semTexto", () => {
    assert.equal(interpretarUpdate(msg({ photo: [{}] }), PERMITIDOS).tipo, "semTexto");
  });

  it("chat fora da allowlist = naoAutorizado, ANTES de olhar o comando", () => {
    assert.deepEqual(interpretarUpdate(msg({ text: "/start" }, { id: 222, type: "private" }), PERMITIDOS), {
      tipo: "naoAutorizado", updateId: 9, chatId: 222,
    });
  });

  it("grupo é ignorado mesmo com o id na lista", () => {
    const e = interpretarUpdate(msg({ text: "oi" }, { id: 111, type: "group" }), PERMITIDOS);
    assert.equal(e.tipo, "ignorar");
  });

  it("edited_message, channel_post e lixo são ignorados", () => {
    assert.deepEqual(interpretarUpdate({ update_id: 3, edited_message: {} }, PERMITIDOS), { tipo: "ignorar", updateId: 3 });
    assert.deepEqual(interpretarUpdate({ update_id: 4, channel_post: {} }, PERMITIDOS), { tipo: "ignorar", updateId: 4 });
    assert.deepEqual(interpretarUpdate(null, PERMITIDOS), { tipo: "ignorar", updateId: null });
    assert.deepEqual(interpretarUpdate({ message: {} }, PERMITIDOS), { tipo: "ignorar", updateId: null });
  });

  describe("demanda atrasada (backlog reentregue depois de o servidor voltar)", () => {
    const comIdade = (text: string, idadeS: number) => msg({ text, date: AGORA_S - idadeS });
    const limiteS = IDADE_MAXIMA_DEMANDA_MIN * 60;

    it("no limite ainda é demanda; um segundo além vira atrasada, sem a demanda", () => {
      assert.equal(interpretarUpdate(comIdade("/foco revisar", limiteS), PERMITIDOS).tipo, "demanda");
      assert.deepEqual(interpretarUpdate(comIdade("/foco revisar", limiteS + 1), PERMITIDOS), {
        tipo: "atrasada", updateId: 9, chatId: 111, mensagemId: 5, atrasoMin: IDADE_MAXIMA_DEMANDA_MIN,
      });
    });

    it("atraso arredonda para baixo em minutos", () => {
      const e = interpretarUpdate(comIdade("ligar pro banco", 6 * 3600 + 59), PERMITIDOS);
      assert.equal(e.tipo, "atrasada");
      assert.equal((e as any).atrasoMin, 360);
    });

    it("ajuda e sem texto antigos continuam respondendo: não criam compromisso", () => {
      assert.equal(interpretarUpdate(comIdade("/start", 3600), PERMITIDOS).tipo, "ajuda");
      assert.equal(interpretarUpdate(msg({ photo: [{}], date: AGORA_S - 3600 }), PERMITIDOS).tipo, "semTexto");
    });

    it("chat não autorizado antigo continua naoAutorizado", () => {
      const e = interpretarUpdate(msg({ text: "oi", date: AGORA_S - 3600 }, { id: 222, type: "private" }), PERMITIDOS);
      assert.equal(e.tipo, "naoAutorizado");
    });

    it("date no futuro (relógio adiantado) ou ausente não bloqueia", () => {
      assert.equal(interpretarUpdate(comIdade("x", -120), PERMITIDOS).tipo, "demanda");
      assert.equal(interpretarUpdate(msg({ text: "x", date: undefined }), PERMITIDOS).tipo, "demanda");
    });

    it("texto diz o atraso e pede reenvio", () => {
      assert.match(textoDeDemandaAtrasada(42), /42 min de atraso/);
      assert.match(textoDeDemandaAtrasada(42), /Reenvie/);
    });
  });
});

describe("criarMemoriaDeUpdates", () => {
  it("primeira vez false, repetida true", () => {
    const m = criarMemoriaDeUpdates();
    assert.equal(m.jaVisto(1), false);
    assert.equal(m.jaVisto(1), true);
    assert.equal(m.jaVisto(2), false);
  });

  it("esquece o mais antigo acima da capacidade", () => {
    const m = criarMemoriaDeUpdates(2);
    m.jaVisto(1); m.jaVisto(2); m.jaVisto(3);
    assert.equal(m.jaVisto(1), false);
    assert.equal(m.jaVisto(3), true);
  });
});
