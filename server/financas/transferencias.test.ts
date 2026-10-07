import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parearTransferencias } from "./transferencias.ts";
import { conta, tx } from "./teste-apoio.ts";

const contas = [conta("santander", "corrente"), conta("nubank", "corrente"), conta("mp", "corrente"), conta("cartao", "cartao")];
const tipo = (id: string) => contas.find((c) => c.id === id)?.tipo;

describe("parearTransferencias", () => {
  it("mesmo valor, sinais opostos, contas diferentes, até 2 dias", () => {
    const pares = parearTransferencias(
      [tx("santander", "2026-09-10", -50000, "PIX ENVIADO", { id: "s" }), tx("nubank", "2026-09-12", 50000, "PIX RECEBIDO", { id: "e" })],
      tipo,
    );
    assert.deepEqual(pares, [{ saidaId: "s", entradaId: "e", natureza: "transferencia" }]);
  });

  const naoPareiam: [string, Parameters<typeof tx>, Parameters<typeof tx>][] = [
    ["3 dias de distância", ["santander", "2026-09-10", -50000, "PIX"], ["nubank", "2026-09-13", 50000, "PIX"]],
    ["valor diferente", ["santander", "2026-09-10", -50000, "PIX"], ["nubank", "2026-09-10", 50001, "PIX"]],
    ["mesma conta", ["santander", "2026-09-10", -50000, "PIX"], ["santander", "2026-09-10", 50000, "PIX"]],
  ];
  for (const [nome, a, b] of naoPareiam) {
    it(`não pareia: ${nome}`, () => {
      assert.equal(parearTransferencias([tx(...a), tx(...b)], tipo).length, 0);
    });
  }

  it("cada lado casa uma vez só, com a data mais próxima", () => {
    const pares = parearTransferencias(
      [
        tx("santander", "2026-09-10", -50000, "PIX", { id: "s" }),
        tx("nubank", "2026-09-12", 50000, "PIX", { id: "longe" }),
        tx("mp", "2026-09-10", 50000, "PIX", { id: "perto" }),
      ],
      tipo,
    );
    assert.deepEqual(pares.map((p) => p.entradaId), ["perto"]);
  });

  it("débito na conta + pagamento recebido no cartão = pagamento de fatura", () => {
    const pares = parearTransferencias(
      [
        tx("santander", "2026-09-10", -150000, "PIX ENVIADO", { id: "s" }),
        tx("cartao", "2026-09-11", 150000, "PAGAMENTO RECEBIDO", { id: "c", natureza: "pagamento_fatura" }),
      ],
      tipo,
    );
    assert.deepEqual(pares, [{ saidaId: "s", entradaId: "c", natureza: "pagamento_fatura" }]);
  });

  it("estorno no cartão de mesmo valor não é par", () => {
    const pares = parearTransferencias(
      [tx("santander", "2026-09-10", -4590, "PIX", { id: "s" }), tx("cartao", "2026-09-10", 4590, "LOJA", { id: "c", natureza: "estorno" })],
      tipo,
    );
    assert.equal(pares.length, 0);
  });

  it("pagamento de fatura já reconhecido não vira transferência com uma entrada qualquer", () => {
    const pares = parearTransferencias(
      [
        tx("santander", "2026-09-10", -150000, "PAGAMENTO DE FATURA", { id: "s", natureza: "pagamento_fatura" }),
        tx("nubank", "2026-09-10", 150000, "PIX RECEBIDO", { id: "e" }),
      ],
      tipo,
    );
    assert.equal(pares.length, 0);
  });

  it("pendente não pareia", () => {
    const pares = parearTransferencias(
      [tx("santander", "2026-09-10", -50000, "PIX", { status: "pendente" }), tx("nubank", "2026-09-10", 50000, "PIX")],
      tipo,
    );
    assert.equal(pares.length, 0);
  });
});
