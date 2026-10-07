import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validarAviso } from "../avisos.ts";
import { alertasDevidos, estadoDaSala } from "./alertas.ts";
import { hashCurto } from "./comum.ts";
import { orcamentoDoMes } from "./organizacao.ts";
import type { CartaoResumido, ResumoFinanceiro } from "./resumo.ts";

// Alertas de 70/90/100% (RULES 24): semáforo e %, nunca R$ nem estabelecimento.
// Valores inventados.

const AGORA = new Date("2026-10-07T12:00:00Z");

function cartao(id: string, usoPct: number | null, extra: Partial<CartaoResumido> = {}): CartaoResumido {
  return {
    id,
    nome: "Cartão Teste",
    instituicao: "Banco",
    final: "1234",
    limiteCentavos: 1_000_000,
    usadoBancoCentavos: usoPct === null ? null : usoPct * 10_000,
    usoPct,
    semaforo: null,
    fechada: null,
    aberta: { vencimento: "2026-11-10", centavos: 543_21, semLancamentos: false },
    futurasCentavos: 0,
    detalhadoCentavos: 0,
    semDetalheCentavos: 0,
    totalCentavos: 0,
    ...extra,
  };
}

function resumo(cartoes: CartaoResumido[], gastos: [string, number, number][] = []): Pick<ResumoFinanceiro, "mes" | "devo" | "orcamento"> {
  return {
    mes: "2026-10",
    devo: { totalCentavos: 0, cartoes, porMes: [], parcelamentos: [], parcelasAcabamEm: null },
    orcamento: orcamentoDoMes(new Map(gastos.map(([c, limite]) => [c, limite])), new Map(gastos.map(([c, , gasto]) => [c, gasto]))),
  };
}

describe("alertasDevidos", () => {
  it("abaixo de 70% não avisa; sem limite não avisa", () => {
    assert.deepEqual(alertasDevidos(resumo([cartao("c1", 69), cartao("c2", null)]), new Set(), AGORA), []);
  });

  it("pulou de 60 para 95%: sai só o de 90, cobrindo o de 70", () => {
    const [a, ...resto] = alertasDevidos(resumo([cartao("c1", 95)]), new Set(), AGORA);
    assert.equal(resto.length, 0);
    assert.equal(a.chave, "cartao:c1:2026-11:90");
    assert.deepEqual(a.marcar, ["cartao:c1:2026-11:70", "cartao:c1:2026-11:90"]);
    assert.equal(a.aviso.titulo, "🟠 Cartão Cartão Teste: 95% do limite");
    assert.equal(a.aviso.prioridade, 1);
  });

  it("faixa já avisada no período não repete; a seguinte sai", () => {
    const ja = new Set(["cartao:c1:2026-11:70", "cartao:c1:2026-11:90"]);
    assert.deepEqual(alertasDevidos(resumo([cartao("c1", 93)]), ja, AGORA), []);
    const [a] = alertasDevidos(resumo([cartao("c1", 100)]), ja, AGORA);
    assert.equal(a.chave, "cartao:c1:2026-11:100");
    assert.match(a.aviso.titulo, /^🔴/);
  });

  it("outro ciclo do cartão (fatura aberta de outro mês) avisa de novo", () => {
    const ja = new Set(["cartao:c1:2026-11:70"]);
    const [a] = alertasDevidos(resumo([cartao("c1", 75, { aberta: { vencimento: "2026-12-10", centavos: 0, semLancamentos: false } })]), ja, AGORA);
    assert.equal(a.chave, "cartao:c1:2026-12:70");
    assert.equal(a.aviso.prioridade, 2);
  });

  it("orçamento por categoria, com a categoria e sem valor", () => {
    const alertas = alertasDevidos(
      resumo(
        [],
        [
          ["Mercado", 100_000, 71_000],
          ["Lazer", 50_000, 10_000],
        ],
      ),
      new Set(),
      AGORA,
    );
    assert.deepEqual(
      alertas.map((a) => [a.chave, a.aviso.titulo]),
      [[`orcamento:${hashCurto("mercado")}:2026-10:70`, "🟡 Orçamento de Mercado: 71%"]],
    );
    assert.ok(!alertas[0].aviso.chave.includes("Mercado"), "a chave vai à fila: sem o nome");
  });

  it("nenhum aviso leva R$, valor em centavos nem o final do cartão, e todos passam no schema da fila", () => {
    const alertas = alertasDevidos(
      resumo([cartao("c1", 100, { nome: "Visa R$ 5.000" })], [["Viagem R$ 300", 30_000, 45_000]]),
      new Set(),
      AGORA,
    );
    assert.equal(alertas.length, 2);
    for (const { aviso } of alertas) {
      validarAviso(aviso);
      const tudo = `${aviso.titulo} ${aviso.texto}`;
      assert.ok(!/R\s*\$/.test(tudo), tudo);
      assert.ok(!/5\.000|300|45000|54321|1234/.test(tudo), tudo);
      assert.notEqual(aviso.prioridade, 0);
      assert.equal(aviso.origem, "squadone:financas");
      assert.ok(Date.parse(aviso.expiraEm) > AGORA.getTime());
    }
  });
});

describe("estadoDaSala", () => {
  it("o cartão mais usado e o orçamento total, só % e semáforo", () => {
    const r = resumo(
      [cartao("c1", 40, { semaforo: "verde" }), cartao("c2", 92, { semaforo: "laranja", nome: "Outro" })],
      [["Mercado", 100_000, 75_000]],
    );
    assert.deepEqual(estadoDaSala(r), {
      cartao: { pct: 92, semaforo: "laranja", nome: "Outro" },
      orcamento: { pct: 75, semaforo: "amarelo" },
    });
  });

  it("sem cartão com limite e sem orçamento: nada", () => {
    assert.deepEqual(estadoDaSala(resumo([cartao("c1", null)])), { cartao: null, orcamento: null });
  });
});
