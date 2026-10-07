import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categorizar } from "./categoria.ts";
import { naturezaDaLinha, pagamentosDeFaturaPeloValor } from "./natureza.ts";
import { conta, fatura, tx } from "./teste-apoio.ts";
import type { Natureza, TipoDeConta } from "./tipos.ts";

describe("naturezaDaLinha", () => {
  const casos: [string, TipoDeConta, number, string, Natureza, string?][] = [
    // Conta corrente: o pagamento da fatura NUNCA é despesa.
    ["pagamento de fatura por descrição", "corrente", -150000, "PAGAMENTO DE FATURA CARTAO", "pagamento_fatura"],
    ["débito automático da fatura", "corrente", -150000, "DEB AUTOMATICO FATURA CARTAO SANTANDER", "pagamento_fatura"],
    ["fatura do Nubank paga por Pix", "corrente", -150000, "Pagamento de fatura - Nu Pagamentos", "pagamento_fatura"],
    ["pela categoria da Pluggy, descrição muda", "corrente", -150000, "PIX ENVIADO", "pagamento_fatura", "Credit card payment"],
    ["Pix a terceiro é despesa", "corrente", -5000, "PIX ENVIADO FULANO", "despesa", "Transfer - PIX"],
    ["aplicação é movimento interno", "corrente", -100000, "APLICACAO CDB", "transferencia"],
    ["resgate é movimento interno", "corrente", 100000, "RESGATE CDB", "transferencia"],
    ["mesma titularidade pela Pluggy", "corrente", -20000, "PIX ENVIADO", "transferencia", "Same person transfer - PIX"],
    ["salário é receita", "corrente", 800000, "SALARIO EMPRESA", "receita", "Salary"],
    ["rendimento da conta", "poupanca", 1234, "REMUNERACAO BASICA", "rendimento"],
    ["juros do cheque especial", "corrente", -900, "JUROS CHEQUE ESPECIAL", "encargo"],
    ["estorno na conta", "corrente", 5000, "ESTORNO COMPRA", "estorno"],
    // Cartão.
    ["compra no cartão", "cartao", -4590, "RESTAURANTE BOM", "despesa"],
    ["pagamento recebido no cartão", "cartao", 150000, "PAGAMENTO RECEBIDO", "pagamento_fatura"],
    ["crédito sem cara de pagamento é estorno", "cartao", 4590, "LOJA X", "estorno"],
    ["estorno de pagamento continua estorno", "cartao", 4590, "ESTORNO LOJA", "estorno"],
    ["IOF no cartão", "cartao", -321, "IOF COMPRA INTERNACIONAL", "encargo"],
    ["anuidade no cartão", "cartao", -4500, "ANUIDADE DIFERENCIADA", "encargo"],
    ["tarifa pela pista da fonte", "cartao", -1000, "AVALIACAO EMERGENCIAL", "encargo", "credit card fees"],
  ];
  for (const [nome, tipo, centavos, descricao, esperada, categoriaFonte] of casos) {
    it(nome, () => {
      assert.equal(naturezaDaLinha({ descricao, centavos }, tipo, { categoriaFonte }), esperada);
    });
  }
});

describe("pagamentosDeFaturaPeloValor", () => {
  const contas = [conta("cc", "corrente"), conta("cartao", "cartao")];
  const tipo = (id: string) => contas.find((c) => c.id === id)?.tipo;

  it("casa o débito mudo com o pagamento registrado na fatura (±3 dias)", () => {
    const pix = tx("cc", "2026-09-11", -150000, "PIX ENVIADO NU PAGAMENTOS", { id: "pix" });
    const f = fatura("f", "cartao", "2026-09-10", 150000, { pagamentos: [{ data: "2026-09-10", centavos: 150000 }] });
    assert.deepEqual([...pagamentosDeFaturaPeloValor([pix], [f], tipo)], ["pix"]);
  });

  it("sem pagamento registrado, casa com o total perto do vencimento; longe, não", () => {
    const perto = tx("cc", "2026-09-05", -150000, "PIX", { id: "perto" });
    const longe = tx("cc", "2026-08-01", -150000, "PIX", { id: "longe" });
    const f = fatura("f", "cartao", "2026-09-10", 150000);
    assert.deepEqual([...pagamentosDeFaturaPeloValor([longe, perto], [f], tipo)], ["perto"]);
  });

  it("dois débitos iguais: só o mais próximo vira pagamento", () => {
    const a = tx("cc", "2026-09-09", -150000, "PIX", { id: "a" });
    const b = tx("cc", "2026-09-10", -150000, "PIX", { id: "b" });
    const f = fatura("f", "cartao", "2026-09-10", 150000, { pagamentos: [{ data: "2026-09-10", centavos: 150000 }] });
    assert.deepEqual([...pagamentosDeFaturaPeloValor([a, b], [f], tipo)], ["b"]);
  });

  it("valor diferente não casa", () => {
    const pix = tx("cc", "2026-09-10", -149999, "PIX", { id: "x" });
    const f = fatura("f", "cartao", "2026-09-10", 150000);
    assert.equal(pagamentosDeFaturaPeloValor([pix], [f], tipo).size, 0);
  });
});

describe("categorizar", () => {
  it("a natureza vence a Pluggy: o Pix que pagou a fatura não vira 'Pix e transferências'", () => {
    assert.equal(categorizar({ natureza: "pagamento_fatura", descricao: "PIX", categoriaFonte: "Transfer - PIX" }).categoria, "Pagamento de fatura");
  });
  it("traduz a categoria da Pluggy", () => {
    assert.deepEqual(categorizar({ natureza: "despesa", descricao: "X", categoriaFonte: "Groceries" }), { categoria: "Mercado", origemCategoria: "pluggy" });
  });
  it("sem categoria da fonte, a descrição decide", () => {
    assert.deepEqual(categorizar({ natureza: "despesa", descricao: "IFOOD *RESTAURANTE", categoriaFonte: "" }), { categoria: "Delivery", origemCategoria: "regra" });
  });
  it("a do usuário nunca muda", () => {
    assert.equal(categorizar({ natureza: "despesa", descricao: "IFOOD", categoriaFonte: "Groceries", categoria: "Viagem", origemCategoria: "usuario" }).categoria, "Viagem");
  });
  it("nada casa: Outros, sem origem", () => {
    assert.deepEqual(categorizar({ natureza: "despesa", descricao: "ZZZ", categoriaFonte: "" }), { categoria: "Outros", origemCategoria: "nenhuma" });
  });
});
