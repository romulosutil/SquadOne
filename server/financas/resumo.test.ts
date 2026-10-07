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

  it("a mesma compra com as primeiras parcelas uns centavos acima é um parcelamento só, sem contar as futuras duas vezes", () => {
    // Compra de 11/05 em 8x, uma parcela por fatura: 1 e 2 a 100,05, da 3 em diante a 100,00.
    // A 5 está na fatura fechada de 10/10; a 6 é da aberta (nov); faltam a 7 e a 8 (dez e jan).
    const meses = ["06", "07", "08", "09"];
    const faturas = [...meses.map((m) => fatura(`f-${m}`, "cartao", `2026-${m}-10`, 0, { fechamento: `2026-${m}-03` })), fechada];
    const parcela = (n: number, faturaId: string, centavos: number) =>
      tx("cartao", n === 1 ? "2026-05-12" : `2026-0${n + 4}-01`, centavos, `LOJA P PARC 0${n}/08`, { dataCompra: "2026-05-11", parcelaN: n, parcelaTotal: 8, faturaId });
    const transacoes = processar([cartao], faturas, [
      parcela(1, "f-06", -10005),
      parcela(2, "f-07", -10005),
      parcela(3, "f-08", -10000),
      parcela(4, "f-09", -10000),
      parcela(5, "f-out", -10000),
    ]);
    const r = resumir({ contas: [cartao], faturas, transacoes, conexoes: [] }, hoje, "2026-10", "competencia");
    assert.equal(r.devo.parcelamentos.length, 1);
    assert.equal(r.devo.cartoes[0].aberta.centavos, 10000, "a 6, ainda não lançada, é da fatura aberta");
    assert.equal(r.devo.cartoes[0].futurasCentavos, 20000);
    assert.deepEqual(r.devo.porMes.slice(-2), [
      { mes: "2026-12", centavos: 10000 },
      { mes: "2027-01", centavos: 10000 },
    ]);
  });

  it("Santander: a parcela lançada no dia do fechamento é da fatura aberta, e o devo não perde um mês", () => {
    // Compra de 01/07 em 6x. O Santander lança cada parcela no dia do fechamento e a cobra na
    // fatura SEGUINTE: a 3 (04/09) na de 12/10, a 4 (05/10) na de 12/11, que ainda não está em
    // /bills. Faltam a 5 e a 6 (dez e jan). Pela data, a 4 caía na de 12/10, a projeção a via
    // em outubro e acabava em dezembro, e um mês de parcelas virava "sem detalhe".
    const setembro = fatura("s-set", "cartao", "2026-09-12", 0, { fechamento: "2026-09-04" });
    const outubro = fatura("s-out", "cartao", "2026-10-12", 2500, { fechamento: "2026-10-05" });
    const faturas = [setembro, outubro];
    const comLimite = { ...cartao, limiteCentavos: 1000000, limiteDisponivelCentavos: 990000 };
    const parcela = (n: number, data: string, faturaId: string) =>
      tx("cartao", data, -2500, `LOJA Q PARC 0${n}/06`, { dataCompra: "2026-07-01", parcelaN: n, parcelaTotal: 6, faturaId });
    const lidas = [parcela(3, "2026-09-04", "s-out"), parcela(4, "2026-10-05", "s-nov")];
    // Duas vezes: o passe ao abrir as finanças roda sobre o que o anterior gravou.
    const transacoes = processar([comLimite], faturas, processar([comLimite], faturas, lidas));
    const r = resumir({ contas: [comLimite], faturas, transacoes, conexoes: [] }, hoje, "2026-10", "competencia");
    const c = r.devo.cartoes[0];
    assert.deepEqual(c.fechada, { vencimento: "2026-10-12", centavos: 2500, pagoCentavos: 0 });
    assert.deepEqual(c.aberta, { vencimento: "2026-11-12", centavos: 2500, semLancamentos: false });
    assert.equal(c.futurasCentavos, 5000);
    assert.equal(c.semDetalheCentavos, 0);
    assert.equal(r.devo.parcelasAcabamEm, "2027-01");
    assert.deepEqual(r.devo.porMes, [
      { mes: "2026-10", centavos: 2500 },
      { mes: "2026-11", centavos: 2500 },
      { mes: "2026-12", centavos: 2500 },
      { mes: "2027-01", centavos: 2500 },
    ]);
    // A competência de outubro tem só a 3; a 4 é de novembro.
    assert.equal(r.gastei.totalCentavos, 2500);
    assert.equal(resumir({ contas: [comLimite], faturas, transacoes, conexoes: [] }, hoje, "2026-11", "competencia").gastei.totalCentavos, 2500);
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
    ["no dia do fechamento, na dúvida, não quita a fatura que fecha", [{ data: "2026-10-05", centavos: 100 }], { set: 100, out: 0 }],
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
  it("mesmo estabelecimento a ~30 dias (um mês pulado vale), com valor estável", () => {
    const transacoes = processar(contas, [], [
      tx("cc", "2026-07-05", -3990, "NETFLIX.COM"),
      tx("cc", "2026-08-05", -3990, "NETFLIX.COM"),
      tx("cc", "2026-10-05", -4490, "NETFLIX.COM"),
      tx("cc", "2026-10-06", -9000, "LOJA UNICA"),
    ]);
    const r = resumir({ contas, faturas: [], transacoes, conexoes: [] }, hoje, "2026-10", "competencia");
    assert.deepEqual(r.recorrentes.map((x) => [x.descricao, x.vezes, x.mediaCentavos, x.ultimaData, x.origem]), [["NETFLIX.COM", 3, 4157, "2026-10-05", "detectado"]]);
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
