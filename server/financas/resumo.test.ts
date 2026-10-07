import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { processar } from "./processar.ts";
import { pagoDasFaturas, resumir, saudeDa } from "./resumo.ts";
import { conta, fatura, tx } from "./teste-apoio.ts";
import type { Conexao } from "./tipos.ts";

const hoje = "2026-10-07";

describe("resumir: tenho", () => {
  it("soma contas e investimentos; cartão fica fora", () => {
    const contas = [
      conta("cc", "corrente", { saldoCentavos: 100000 }),
      conta("poup", "poupanca", { saldoCentavos: 50000 }),
      conta("inv", "investimento", { saldoCentavos: 300000 }),
      conta("cartao", "cartao", { saldoCentavos: 999999 }),
    ];
    const r = resumir({ contas, faturas: [], transacoes: [], conexoes: [] }, hoje, "2026-10", "competencia");
    assert.equal(r.tenho.totalCentavos, 450000);
    assert.deepEqual(r.tenho.contas.map((c) => c.id), ["inv", "cc", "poup"]);
  });
});

describe("resumir: devo", () => {
  const cartao = conta("cartao", "cartao", { final: "1234" });
  // Fatura fechada em 03/10, vence 10/10, ainda não paga.
  const fechada = fatura("f-out", "cartao", "2026-10-10", 50000, { fechamento: "2026-10-03" });
  const compraFechada = tx("cartao", "2026-09-20", -50000, "LOJA A");
  const compraAberta = tx("cartao", "2026-10-05", -7000, "LOJA B");
  // Parcela 2/4 na fatura aberta (vence 10/11): faltam 3/4 e 4/4.
  const parcela = tx("cartao", "2026-10-06", -10000, "LOJA C PARC 02/04", { parcelaN: 2, parcelaTotal: 4 });

  it("fechada + aberta + parcelas futuras, sem sobrepor", () => {
    const transacoes = processar([cartao], [fechada], [compraFechada, compraAberta, parcela]);
    const r = resumir({ contas: [cartao], faturas: [fechada], transacoes, conexoes: [] }, hoje, "2026-10", "competencia");
    const c = r.devo.cartoes[0];
    assert.equal(c.fechada?.centavos, 50000);
    assert.equal(c.aberta.vencimento, "2026-11-10");
    assert.equal(c.aberta.centavos, 17000, "a parcela 2/4 entra na aberta, não na projeção");
    assert.equal(c.futurasCentavos, 20000);
    assert.equal(c.totalCentavos, 87000);
    assert.deepEqual(r.devo.porMes, [
      { mes: "2026-10", centavos: 50000 },
      { mes: "2026-11", centavos: 17000 },
      { mes: "2026-12", centavos: 10000 },
      { mes: "2027-01", centavos: 10000 },
    ]);
    assert.equal(r.devo.parcelasAcabamEm, "2027-01");
    assert.equal(r.devo.parcelamentos[0].cartao, "cartao ·1234");
  });

  it("fatura já paga (depois do fechamento) não é dívida", () => {
    const paga = { ...fechada, pagoCentavos: 50000, pagamentos: [{ data: "2026-10-06", centavos: 50000 }] };
    const r = resumir({ contas: [cartao], faturas: [paga], transacoes: [], conexoes: [] }, hoje, "2026-10", "competencia");
    assert.equal(r.devo.cartoes[0].fechada, null);
  });

  it("Santander: o pago que vem na fatura é o da anterior, e a fatura fechada continua a pagar", () => {
    // O banco põe em cada fatura os pagamentos feitos DENTRO do ciclo dela: a de 12/10 traz o
    // pagamento da de 12/09 (feito em 13 e 14/09), maior que o total da própria fatura.
    const anterior = fatura("s-set", "cartao", "2026-09-12", 80000, { fechamento: "2026-09-04", pagoCentavos: 70000, pagamentos: [{ data: "2026-08-12", centavos: 70000 }] });
    const atual = fatura("s-out", "cartao", "2026-10-12", 60000, {
      fechamento: "2026-10-05",
      pagoCentavos: 80000,
      pagamentos: [
        { data: "2026-09-13", centavos: 50000 },
        { data: "2026-09-14", centavos: 30000 },
      ],
    });
    const r = resumir({ contas: [cartao], faturas: [anterior, atual], transacoes: [], conexoes: [] }, hoje, "2026-10", "competencia");
    const c = r.devo.cartoes[0];
    assert.deepEqual(c.fechada, { vencimento: "2026-10-12", centavos: 60000, pagoCentavos: 0 });
    assert.deepEqual(r.devo.porMes[0], { mes: "2026-10", centavos: 60000 });
  });

  it("o pagamento que só aparece como crédito no cartão já quita a fatura", () => {
    // O Santander só registra o pagamento na fatura seguinte, quando ela fecha; o crédito chega antes.
    const credito = tx("cartao", "2026-10-06", 50000, "PAGAMENTO DE FATURA");
    const transacoes = processar([cartao], [fechada], [credito]);
    const r = resumir({ contas: [cartao], faturas: [fechada], transacoes, conexoes: [] }, hoje, "2026-10", "competencia");
    assert.equal(r.devo.cartoes[0].fechada, null);
  });

  it("pagamento parcial registrado na fatura e no cartão conta uma vez", () => {
    const comPagamento = { ...fechada, pagoCentavos: 20000, pagamentos: [{ data: "2026-10-05", centavos: 20000 }] };
    const credito = tx("cartao", "2026-10-06", 20000, "Pagamento recebido");
    const transacoes = processar([cartao], [comPagamento], [credito]);
    const r = resumir({ contas: [cartao], faturas: [comPagamento], transacoes, conexoes: [] }, hoje, "2026-10", "competencia");
    assert.deepEqual(r.devo.cartoes[0].fechada, { vencimento: "2026-10-10", centavos: 30000, pagoCentavos: 20000 });
  });

  it("com o limite usado do banco, ele é o total, e a diferença aparece como sem detalhe", () => {
    const comLimite = { ...cartao, limiteCentavos: 1000000, limiteDisponivelCentavos: 900000 };
    const transacoes = processar([comLimite], [fechada], [compraFechada]);
    const r = resumir({ contas: [comLimite], faturas: [fechada], transacoes, conexoes: [] }, hoje, "2026-10", "competencia");
    const c = r.devo.cartoes[0];
    assert.equal(c.totalCentavos, 100000);
    assert.equal(c.detalhadoCentavos, 50000);
    assert.equal(c.semDetalheCentavos, 50000);
    assert.equal(c.usoPct, 10);
  });

  it("cartão sem lançamento nenhum (o Santander da Pluggy): aberta desconhecida, não zero", () => {
    const r = resumir({ contas: [cartao], faturas: [fechada], transacoes: [], conexoes: [] }, hoje, "2026-10", "competencia");
    assert.equal(r.devo.cartoes[0].aberta.semLancamentos, true);
  });
});

describe("pagoDasFaturas: um pagamento quita a última fatura já fechada quando ele foi feito", () => {
  const set = fatura("set", "c", "2026-09-12", 0, { fechamento: "2026-09-04" });
  const out = fatura("out", "c", "2026-10-12", 0, { fechamento: "2026-10-05" });
  const casos: [string, { data: string; centavos: number }[], Record<string, number>][] = [
    ["depois do fechamento, antes do vencimento (Mercado Pago, Nubank)", [{ data: "2026-10-08", centavos: 100 }], { set: 0, out: 100 }],
    ["depois do vencimento, antes do fechamento seguinte (pago com atraso)", [{ data: "2026-10-14", centavos: 100 }], { set: 0, out: 100 }],
    ["dentro do ciclo da fatura de outubro: é da de setembro (Santander)", [{ data: "2026-09-13", centavos: 100 }], { set: 100, out: 0 }],
    ["no dia do fechamento ainda é o ciclo da própria fatura", [{ data: "2026-10-05", centavos: 100 }], { set: 100, out: 0 }],
    ["antes de toda fatura conhecida: de nenhuma", [{ data: "2026-08-20", centavos: 100 }], { set: 0, out: 0 }],
  ];
  for (const [nome, pagamentos, esperado] of casos) {
    it(nome, () => {
      // Onde o banco registrou o pagamento não importa: só a data.
      const faturas = [{ ...set, pagamentos }, out];
      assert.deepEqual(Object.fromEntries(pagoDasFaturas(faturas, [])), esperado);
    });
  }

  it("crédito no cartão e pagamento registrado do mesmo valor a até 3 dias são o mesmo pagamento", () => {
    const faturas = [set, { ...out, pagamentos: [{ data: "2026-10-09", centavos: 100 }] }];
    const credito = { ...tx("c", "2026-10-08", 100, "PAGAMENTO DE FATURA"), natureza: "pagamento_fatura" as const };
    assert.deepEqual(Object.fromEntries(pagoDasFaturas(faturas, [credito])), { set: 0, out: 100 });
  });

  it("dois pagamentos iguais no mesmo dia, um em cada lista, não somem um no outro", () => {
    const faturas = [set, { ...out, pagamentos: [{ data: "2026-10-08", centavos: 100 }, { data: "2026-10-08", centavos: 100 }] }];
    const credito = { ...tx("c", "2026-10-08", 100, "PAGAMENTO DE FATURA"), natureza: "pagamento_fatura" as const };
    assert.deepEqual(Object.fromEntries(pagoDasFaturas(faturas, [credito])), { set: 0, out: 200 });
  });

  it("estorno e crédito pendente não são pagamento", () => {
    const estorno = { ...tx("c", "2026-10-08", 100, "ESTORNO LOJA"), natureza: "estorno" as const };
    const pendente = { ...tx("c", "2026-10-08", 100, "PAGAMENTO DE FATURA", { status: "pendente" }), natureza: "pagamento_fatura" as const };
    assert.deepEqual(Object.fromEntries(pagoDasFaturas([set, out], [estorno, pendente])), { set: 0, out: 0 });
  });
});

describe("resumir: gastei por categoria contra o mês anterior", () => {
  it("compara as categorias e soma o total", () => {
    const contas = [conta("cc", "corrente")];
    const transacoes = processar(contas, [], [
      tx("cc", "2026-10-02", -3000, "SUPERMERCADO BOM"),
      tx("cc", "2026-10-03", -2000, "IFOOD"),
      tx("cc", "2026-09-02", -4000, "SUPERMERCADO BOM"),
      tx("cc", "2026-10-05", 500000, "SALARIO"),
    ]);
    const r = resumir({ contas, faturas: [], transacoes, conexoes: [] }, hoje, "2026-10", "caixa");
    assert.equal(r.gastei.totalCentavos, 5000);
    assert.equal(r.gastei.anteriorCentavos, 4000);
    assert.deepEqual(r.gastei.categorias, [
      { categoria: "Mercado", centavos: 3000, anteriorCentavos: 4000 },
      { categoria: "Delivery", centavos: 2000, anteriorCentavos: 0 },
    ]);
    assert.equal(r.recebi.totalCentavos, 500000);
  });
});

describe("resumir: recorrentes", () => {
  const contas = [conta("cc", "corrente")];
  it("aparece em 3 dos 4 meses com valor estável", () => {
    const transacoes = processar(contas, [], [
      tx("cc", "2026-07-05", -3990, "NETFLIX.COM"),
      tx("cc", "2026-08-05", -3990, "NETFLIX.COM"),
      tx("cc", "2026-10-05", -4490, "NETFLIX.COM"),
      tx("cc", "2026-10-06", -9000, "LOJA UNICA"),
    ]);
    const r = resumir({ contas, faturas: [], transacoes, conexoes: [] }, hoje, "2026-10", "competencia");
    assert.deepEqual(r.recorrentes.map((x) => [x.descricao, x.meses, x.mediaCentavos, x.ultimoMes]), [["NETFLIX.COM", 3, 4157, "2026-10"]]);
  });
  it("valor que varia mais que o dobro não é recorrente", () => {
    const transacoes = processar(contas, [], [
      tx("cc", "2026-08-05", -1000, "MERCADO"),
      tx("cc", "2026-09-05", -5000, "MERCADO"),
      tx("cc", "2026-10-05", -2000, "MERCADO"),
    ]);
    assert.equal(resumir({ contas, faturas: [], transacoes, conexoes: [] }, hoje, "2026-10", "competencia").recorrentes.length, 0);
  });
});

describe("saúde das conexões", () => {
  const casos: [string, string | null, string][] = [
    ["UPDATED", null, "ok"],
    ["UPDATING", null, "atualizando"],
    ["OUTDATED", null, "atencao"],
    ["WAITING_USER_ACTION", null, "atencao"],
    ["LOGIN_ERROR", null, "erro"],
    ["QUALQUER_OUTRO", null, "erro"],
    ["UPDATED", "HTTP 500", "erro"],
  ];
  for (const [status, erroLeitura, esperado] of casos) {
    it(`${status}${erroLeitura ? " + falha de leitura" : ""} → ${esperado}`, () => assert.equal(saudeDa({ status, erroLeitura }), esperado));
  }

  it("'dados até' é a data da conexão mais atrasada", () => {
    const c = (itemId: string, dadosAte: string): Conexao => ({ itemId, nome: itemId, status: "UPDATED", executionStatus: "SUCCESS", dadosAte, consentimentoAte: null, lidoEm: null, erroLeitura: null });
    const r = resumir({ contas: [], faturas: [], transacoes: [], conexoes: [c("a", "2026-10-06T10:00:00Z"), c("b", "2026-10-04T08:00:00Z")] }, hoje, "2026-10", "competencia");
    assert.equal(r.saude.dadosAte, "2026-10-04T08:00:00Z");
  });
});
