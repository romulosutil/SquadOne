import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contaDaPluggy, cursorDoProximo, faturaDaPluggy, finalDe, investimentoDaPluggy, transacaoDaPluggy } from "./pluggy-mapa.ts";

const agora = "2026-10-07T12:00:00Z";

describe("contaDaPluggy", () => {
  it("cartão: dívida positiva, limite e final", () => {
    const c = contaDaPluggy(
      { id: "a1", itemId: "i", type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão", number: "5502********1234", balance: -1500.1, creditData: { creditLimit: 10000, availableCreditLimit: 7500.5 } },
      "Banco",
      agora,
    );
    assert.equal(c.tipo, "cartao");
    assert.equal(c.saldoCentavos, 150010);
    assert.equal(c.limiteCentavos, 1000000);
    assert.equal(c.limiteDisponivelCentavos, 750050);
    assert.equal(c.final, "1234");
  });
  it("conta corrente e poupança", () => {
    assert.equal(contaDaPluggy({ id: "x", type: "BANK", subtype: "CHECKING_ACCOUNT", balance: 0.1 + 0.2 }, "B", agora).saldoCentavos, 30);
    assert.equal(contaDaPluggy({ id: "y", type: "BANK", subtype: "SAVINGS_ACCOUNT" }, "B", agora).tipo, "poupanca");
  });
});

describe("investimentoDaPluggy", () => {
  it("usa o saldo líquido e cai no bruto quando falta", () => {
    assert.equal(investimentoDaPluggy({ id: "i", balance: 1000.5, amount: 1100 }, "B", agora).saldoCentavos, 100050);
    assert.equal(investimentoDaPluggy({ id: "i", amount: 1100 }, "B", agora).saldoCentavos, 110000);
  });
});

describe("faturaDaPluggy", () => {
  it("total, vencimento, fechamento, pagamentos e encargos", () => {
    const f = faturaDaPluggy(
      {
        id: "b1",
        dueDate: "2026-10-10T00:00:00.000Z",
        billClosingDate: "2026-10-03",
        totalAmount: 1234.56,
        minimumPaymentAmount: 100,
        payments: [{ paymentDate: "2026-10-09T10:00:00Z", amount: 1234.56 }],
        financeCharges: [{ type: "IOF", amount: 1.23 }],
      },
      "pluggy:cartao",
    )!;
    assert.deepEqual(
      { v: f.vencimento, fe: f.fechamento, t: f.totalBanco, p: f.pagoCentavos, e: f.encargosCentavos, pg: f.pagamentos },
      { v: "2026-10-10", fe: "2026-10-03", t: 123456, p: 123456, e: 123, pg: [{ data: "2026-10-09", centavos: 123456 }] },
    );
  });
  it("sem vencimento não entra", () => assert.equal(faturaDaPluggy({ id: "b" }, "c"), null));
});

describe("transacaoDaPluggy", () => {
  it("compra parcelada no cartão: sinal pelo type, datas da compra e da fatura, parcela e fatura", () => {
    const t = transacaoDaPluggy(
      {
        id: "t1",
        description: "LOJA X",
        amount: 100,
        type: "DEBIT",
        date: "2026-09-20T00:00:00Z",
        status: "POSTED",
        category: "Shopping",
        creditCardMetadata: { installmentNumber: 2, totalInstallments: 5, purchaseDate: "2026-08-20", billId: "b1", cardNumber: "6264" },
      },
      "pluggy:cartao",
    )!;
    assert.equal(t.centavos, -10000);
    assert.equal(t.dataCompra, "2026-08-20");
    assert.equal(t.dataLancamento, "2026-09-20");
    assert.deepEqual([t.parcelaN, t.parcelaTotal], [2, 5]);
    assert.equal(t.faturaId, "pluggy:b1");
    assert.equal(t.cartaoFinal, "6264");
    assert.equal(t.chaveDedupe, "pluggy:t1");
  });
  it("crédito positivo mesmo se a fonte mandar amount negativo; pendente", () => {
    const t = transacaoDaPluggy({ id: "t2", description: "PIX", amount: -50, type: "CREDIT", date: "2026-10-01", status: "PENDING" }, "c")!;
    assert.equal(t.centavos, 5000);
    assert.equal(t.status, "pendente");
  });
  it("compra em dólar usa o valor na moeda da conta", () => {
    const t = transacaoDaPluggy({ id: "t3", description: "X", amount: 10, amountInAccountCurrency: 55.3, type: "DEBIT", date: "2026-10-01" }, "c")!;
    assert.equal(t.centavos, -5530);
  });
  it("tarifa sem categoria ganha a pista", () => {
    const t = transacaoDaPluggy({ id: "t4", description: "X", amount: 10, type: "DEBIT", date: "2026-10-01", creditCardMetadata: { feeType: "ANNUAL_FEE" } }, "c")!;
    assert.equal(t.categoriaFonte, "credit card fees");
  });
  it("sem id ou data, fora", () => {
    assert.equal(transacaoDaPluggy({ description: "x", date: "2026-10-01" }, "c"), null);
    assert.equal(transacaoDaPluggy({ id: "x" }, "c"), null);
  });
});

describe("cursorDoProximo", () => {
  const casos: [unknown, string | null][] = [
    ["?after=abc123", "abc123"],
    ["after=abc123&accountId=x", "abc123"],
    ["https://api.pluggy.ai/v2/transactions?accountId=x&after=zz", "zz"],
    [null, null],
    ["", null],
    ["?accountId=x", null],
  ];
  for (const [next, esperado] of casos) it(`${String(next)} → ${esperado}`, () => assert.equal(cursorDoProximo(next), esperado));
});

describe("finalDe", () => {
  it("pega os 4 últimos dígitos", () => {
    assert.equal(finalDe("**** 2214"), "2214");
    assert.equal(finalDe("12"), null);
    assert.equal(finalDe(undefined), null);
  });
});
