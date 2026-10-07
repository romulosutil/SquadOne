import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { centavosDoValor, conferir, dataNoAnoDaFatura, faturaDoPdf, lerFaturaSantander, transacoesDoPdf } from "./fatura-santander.ts";
import { fatura } from "./teste-apoio.ts";

// Texto no formato da fatura do Santander, com valores e lojas inventados.
const LINHAS = [
  "Fatura do Cartão",
  "Vencimento 10/10/2026",
  "Total a Pagar R$ 1.300,40",
  "FULANO DE TAL - 5502 XXXX XXXX 2214",
  "Pagamento e Demais Créditos",
  "15/09 PAGAMENTO DE FATURA 1.000,00",
  "Parcelamentos",
  "Compra Data Descrição Parcela R$ US$",
  "20/05 LOJA DE MOVEIS 05/10 250,00",
  // Duas colunas na mesma linha de texto.
  "02/11 CURSO ONLINE 12/12 50,00 22/09 RESTAURANTE BOM 120,40",
  "Despesas",
  "25/09 NETFLIX.COM 39,90 7,50",
  "26/09 ESTORNO LOJA -9,90",
  "FULANO DE TAL - 4220 XXXX XXXX 0140",
  "Despesas",
  "28/09 UBER TRIP 850,00",
  "Resumo da Fatura",
  "Saldo Anterior 1.000,00",
  "(-) Pagamentos/Créditos 1.009,90",
  "(+) Despesas/Débitos 1.310,30",
  "Total a Pagar 1.300,40",
];

describe("lerFaturaSantander", () => {
  const pdf = lerFaturaSantander(LINHAS);

  it("lê vencimento, total, saldo anterior e cartões", () => {
    assert.equal(pdf.vencimento, "2026-10-10");
    assert.equal(pdf.totalAPagar, 130040);
    assert.equal(pdf.saldoAnterior, 100000);
    assert.deepEqual(pdf.cartoes, ["2214", "0140"]);
  });

  it("acha todos os lançamentos, inclusive dois na mesma linha, e ignora o resumo", () => {
    assert.deepEqual(
      pdf.lancamentos.map((l) => [l.diaMes, l.descricao, l.centavos, l.parcelaN, l.parcelaTotal, l.cartaoFinal]),
      [
        ["15/09", "PAGAMENTO DE FATURA", 100000, null, null, "2214"],
        ["20/05", "LOJA DE MOVEIS", -25000, 5, 10, "2214"],
        ["02/11", "CURSO ONLINE", -5000, 12, 12, "2214"],
        ["22/09", "RESTAURANTE BOM", -12040, null, null, "2214"],
        ["25/09", "NETFLIX.COM", -3990, null, null, "2214"],
        ["26/09", "ESTORNO LOJA", 990, null, null, "2214"],
        ["28/09", "UBER TRIP", -85000, null, null, "0140"],
      ],
    );
  });

  it("confere contra o total da Pluggy: bate no centavo", () => {
    const c = conferir(pdf, fatura("f", "cartao", "2026-10-10", 130040));
    assert.equal(c.debitosCentavos, 131030);
    assert.equal(c.creditosCentavos, 100990);
    assert.equal(c.esperadoCentavos, 130040);
    assert.equal(c.bate, true);
  });

  it("uma linha perdida aparece como diferença, não some", () => {
    const semUma = lerFaturaSantander(LINHAS.filter((l) => !l.includes("UBER")));
    const c = conferir(semUma, fatura("f", "cartao", "2026-10-10", 130040));
    assert.equal(c.bate, false);
    assert.equal(c.diferencaCentavos, -85000);
  });

  it("sem saldo anterior não dá para conferir", () => {
    const c = conferir(lerFaturaSantander(LINHAS.filter((l) => !l.startsWith("Saldo"))), fatura("f", "cartao", "2026-10-10", 130040));
    assert.equal(c.esperadoCentavos, null);
    assert.equal(c.bate, false);
  });
});

describe("transacoesDoPdf", () => {
  it("liga à fatura e ao cartão, põe o ano certo e é idempotente", () => {
    const pdf = lerFaturaSantander(LINHAS);
    const f = fatura("pluggy:b", "pluggy:cartao", "2026-10-10", 130040, { fechamento: "2026-10-03" });
    const a = transacoesDoPdf(pdf, f);
    const b = transacoesDoPdf(pdf, f);
    assert.deepEqual(a.map((t) => t.chaveDedupe), b.map((t) => t.chaveDedupe));
    assert.equal(new Set(a.map((t) => t.chaveDedupe)).size, a.length);
    const curso = a.find((t) => t.descricao === "CURSO ONLINE")!;
    assert.equal(curso.dataCompra, "2025-11-02");
    assert.equal(curso.dataLancamento, "2026-10-03");
    assert.equal(a.every((t) => t.faturaId === "pluggy:b" && t.faturaFonte === "pluggy:b" && t.contaId === "pluggy:cartao" && t.fonte === "pdf"), true);
  });

  it("duas linhas idênticas viram dois lançamentos", () => {
    const pdf = lerFaturaSantander(["Despesas", "01/10 CAFE 5,00", "01/10 CAFE 5,00"]);
    const ts = transacoesDoPdf(pdf, fatura("f", "c", "2026-10-10", 1000));
    assert.equal(new Set(ts.map((t) => t.chaveDedupe)).size, 2);
  });
});

describe("faturaDoPdf", () => {
  const faturas = [fatura("a", "c", "2026-09-10", 100), fatura("b", "c", "2026-10-10", 130040)];
  it("pelo vencimento", () => assert.equal(faturaDoPdf({ vencimento: "2026-10-10", totalAPagar: null, saldoAnterior: null, lancamentos: [], cartoes: [] }, faturas)?.id, "b"));
  it("pelo total quando não há vencimento", () => assert.equal(faturaDoPdf({ vencimento: null, totalAPagar: 100, saldoAnterior: null, lancamentos: [], cartoes: [] }, faturas)?.id, "a"));
  it("nada casa", () => assert.equal(faturaDoPdf({ vencimento: "2026-01-10", totalAPagar: 5, saldoAnterior: null, lancamentos: [], cartoes: [] }, faturas), null));
});

describe("auxiliares", () => {
  it("centavosDoValor", () => {
    assert.equal(centavosDoValor("1.234,56"), 123456);
    assert.equal(centavosDoValor("- 9,90"), -990);
  });
  it("dataNoAnoDaFatura", () => {
    assert.equal(dataNoAnoDaFatura("25/09", "2026-10-10"), "2026-09-25");
    assert.equal(dataNoAnoDaFatura("20/12", "2026-01-10"), "2025-12-20");
  });
});
