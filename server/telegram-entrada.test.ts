import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarMemoriaDeUpdates, interpretarUpdate } from "./telegram-entrada.ts";

const PERMITIDOS = new Set([111]);
const msg = (x: Record<string, unknown>, chat: Record<string, unknown> = { id: 111, type: "private" }) => ({
  update_id: 9,
  message: { message_id: 5, chat, date: 0, ...x },
});

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
