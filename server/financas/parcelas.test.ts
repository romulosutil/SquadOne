import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agruparParcelas, projetarParcelas, type ParcelaDeEntrada } from "./parcelas.ts";

const p = (id: string, mes: string, n: number, total: number, centavos = -10000, descricao = "LOJA X PARC", contaId = "cartao"): ParcelaDeEntrada => ({
  id,
  contaId,
  descricao,
  centavos,
  parcelaN: n,
  parcelaTotal: total,
  mes,
});

describe("agruparParcelas", () => {
  it("parcelas da mesma compra em faturas seguidas viram um grupo", () => {
    const g = agruparParcelas([p("a", "2026-08", 3, 10), p("b", "2026-09", 4, 10), p("c", "2026-10", 5, 10, -10000, "LOJA X PARC 05/10")]);
    assert.equal(new Set(g.values()).size, 1);
    assert.equal(g.size, 3);
  });

  it("aceita 1 centavo de diferença (arredondamento da última) e 1 mês de folga no fechamento", () => {
    const g = agruparParcelas([p("a", "2026-08", 1, 3, -3333), p("b", "2026-10", 2, 3, -3333), p("c", "2026-10", 3, 3, -3334)]);
    assert.equal(new Set(g.values()).size, 1);
  });

  const separados: [string, ParcelaDeEntrada[]][] = [
    ["totais diferentes", [p("a", "2026-08", 3, 10), p("b", "2026-09", 4, 12)]],
    ["valores diferentes", [p("a", "2026-08", 3, 10, -10000), p("b", "2026-09", 4, 10, -12000)]],
    ["cartões diferentes", [p("a", "2026-08", 3, 10), p("b", "2026-09", 4, 10, -10000, "LOJA X PARC", "outro")]],
    ["origens distantes", [p("a", "2026-01", 1, 10), p("b", "2026-09", 2, 10)]],
    ["duas compras iguais no mesmo mês", [p("a", "2026-09", 3, 10), p("b", "2026-09", 3, 10)]],
  ];
  for (const [nome, lista] of separados) {
    it(`separa: ${nome}`, () => assert.equal(new Set(agruparParcelas(lista).values()).size, 2));
  }

  it("à vista (1/1) e sem número não entram", () => {
    assert.equal(agruparParcelas([p("a", "2026-09", 1, 1), { ...p("b", "2026-09", 1, 3), parcelaN: null }]).size, 0);
  });
});

describe("projetarParcelas", () => {
  it("projeta as que faltam depois do mês já contado e diz quando acaba", () => {
    const [proj] = projetarParcelas([{ ...p("a", "2026-10", 4, 6), grupo: "g" }], () => "2026-10");
    assert.deepEqual(proj.porMes, { "2026-11": 10000, "2026-12": 10000 });
    assert.equal(proj.acabaEm, "2026-12");
    assert.equal(proj.restantes, 2);
  });

  it("a parcela do mês já contado (fatura aberta) não soma de novo", () => {
    const [proj] = projetarParcelas([{ ...p("a", "2026-11", 5, 6), grupo: "g" }], () => "2026-11");
    assert.deepEqual(proj.porMes, { "2026-12": 10000 });
  });

  it("parcela futura que a fonte já listou conta pelo lançamento, sem projetar em dobro", () => {
    const lista = [
      { ...p("a", "2026-10", 4, 6), grupo: "g" },
      { ...p("b", "2026-11", 5, 6), grupo: "g" },
    ];
    const [proj] = projetarParcelas(lista, () => "2026-10");
    assert.deepEqual(proj.porMes, { "2026-11": 10000, "2026-12": 10000 });
  });

  it("última parcela já cobrada: nada a projetar", () => {
    const [proj] = projetarParcelas([{ ...p("a", "2026-10", 6, 6), grupo: "g" }], () => "2026-10");
    assert.deepEqual(proj.porMes, {});
    assert.equal(proj.restantes, 0);
  });
});
