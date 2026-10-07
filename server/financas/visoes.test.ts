import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contextoDas, processar } from "./processar.ts";
import { resumir } from "./resumo.ts";
import { conta, fatura, tx } from "./teste-apoio.ts";
import type { Transacao } from "./tipos.ts";
import { faturaDoLancamento, gastoNaVisao, vencimentoPrevisto, VISOES, type Visao } from "./visoes.ts";

const contas = [conta("cc", "corrente"), conta("nubank", "corrente"), conta("cartao", "cartao")];
const faturaSet = fatura("f-set", "cartao", "2026-09-10", 10000, { fechamento: "2026-09-03", pagamentos: [{ data: "2026-09-10", centavos: 10000 }] });
const faturaOut = fatura("f-out", "cartao", "2026-10-10", 0, { fechamento: "2026-10-03" });
const faturas = [faturaSet, faturaOut];

function gastoTotal(transacoes: Transacao[], visao: Visao, mes: string): number {
  const ctx = contextoDas(contas, faturas);
  return transacoes.reduce((s, t) => {
    const g = gastoNaVisao(t, visao, ctx);
    return g && g.mes === mes ? s + g.centavos : s;
  }, 0);
}

describe("o mesmo gasto nunca conta duas vezes (teste obrigatório)", () => {
  // Uma compra de R$ 100 no cartão em agosto, cobrada na fatura que vence em
  // 10/09 e paga por Pix NA DATA. O Pix chega com três cara possíveis: a
  // descrição diz que é fatura, a descrição é muda, ou o cartão também mostra
  // o pagamento recebido. Em todas, o gasto de setembro é 100, uma vez só.
  const compra = () => tx("cartao", "2026-08-20", -10000, "LOJA X", { id: "compra" });
  const cenarios: [string, Transacao[]][] = [
    ["Pix com descrição de fatura", [compra(), tx("cc", "2026-09-10", -10000, "PAGAMENTO DE FATURA CARTAO", { id: "pix" })]],
    ["Pix mudo, casado pelo pagamento registrado na fatura", [compra(), tx("cc", "2026-09-10", -10000, "PIX ENVIADO NU PAGAMENTOS SA", { id: "pix" })]],
    [
      "Pix mudo + pagamento recebido no cartão",
      [
        compra(),
        tx("cc", "2026-09-10", -10000, "PIX ENVIADO", { id: "pix" }),
        tx("cartao", "2026-09-11", 10000, "PAGAMENTO RECEBIDO", { id: "recebido" }),
      ],
    ],
  ];
  for (const [nome, brutas] of cenarios) {
    it(nome, () => {
      const processadas = processar(contas, faturas, brutas);
      const pix = processadas.find((t) => t.id === "pix")!;
      assert.equal(pix.natureza, "pagamento_fatura", "o pagamento da fatura NUNCA é despesa");
      // Competência: a compra na fatura de setembro; o Pix fora.
      assert.equal(gastoTotal(processadas, "competencia", "2026-09"), 10000);
      assert.equal(gastoTotal(processadas, "competencia", "2026-08"), 0);
      // Caixa: o Pix em setembro; a compra fora.
      assert.equal(gastoTotal(processadas, "caixa", "2026-09"), 10000);
      assert.equal(gastoTotal(processadas, "caixa", "2026-08"), 0);
      // E no resumo da tela, nas duas visões.
      for (const visao of VISOES) {
        const r = resumir({ contas, faturas, transacoes: processadas, conexoes: [] }, "2026-09-15", "2026-09", visao);
        assert.equal(r.gastei.totalCentavos, 10000, visao);
      }
    });
  }

  it("transferência entre contas próprias não é gasto nem receita em nenhuma visão", () => {
    const processadas = processar(contas, faturas, [
      tx("cc", "2026-09-05", -50000, "PIX ENVIADO", { id: "s" }),
      tx("nubank", "2026-09-05", 50000, "PIX RECEBIDO", { id: "e" }),
    ]);
    assert.deepEqual(processadas.map((t) => [t.natureza, t.parId]), [["transferencia", "e"], ["transferencia", "s"]]);
    for (const visao of VISOES) {
      const r = resumir({ contas, faturas, transacoes: processadas, conexoes: [] }, "2026-09-15", "2026-09", visao);
      assert.equal(r.gastei.totalCentavos, 0);
      assert.equal(r.recebi.totalCentavos, 0);
    }
  });

  it("estorno no cartão abate a compra na competência", () => {
    const processadas = processar(contas, faturas, [
      tx("cartao", "2026-08-20", -10000, "LOJA X"),
      tx("cartao", "2026-08-25", 4000, "LOJA X"),
    ]);
    assert.equal(gastoTotal(processadas, "competencia", "2026-09"), 6000);
  });
});

describe("fatura do lançamento", () => {
  it("cai na primeira fatura cujo fechamento é no dia ou depois", () => {
    assert.equal(faturaDoLancamento("2026-08-20", faturas)?.id, "f-set");
    assert.equal(faturaDoLancamento("2026-09-03", faturas)?.id, "f-set");
    assert.equal(faturaDoLancamento("2026-09-04", faturas)?.id, "f-out");
  });
  it("depois do último fechamento é a fatura aberta (null)", () => {
    assert.equal(faturaDoLancamento("2026-10-04", faturas), null);
  });
  it("vencimento previsto empurra o ciclo de mês em mês", () => {
    assert.equal(vencimentoPrevisto("2026-10-04", faturas), "2026-11-10");
    assert.equal(vencimentoPrevisto("2026-11-20", faturas), "2026-12-10");
    assert.equal(vencimentoPrevisto("2026-10-04", []), "2026-10-04");
  });
  it("fatura da fonte (billId) vence o cálculo", () => {
    const [t] = processar(contas, faturas, [tx("cartao", "2026-08-20", -100, "X", { faturaId: "f-out" })]);
    assert.equal(t.faturaId, "f-out");
  });
});
