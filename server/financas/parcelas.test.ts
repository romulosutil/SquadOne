import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agruparParcelas, dataDaCompra, projetarParcelas, type ParcelaDeEntrada } from "./parcelas.ts";

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

  // Parcela com a data da compra que a fonte deu: a n-ésima é lançada n−1 meses depois.
  const comCompra = (id: string, compra: string, mes: string, n: number, total: number, centavos: number, descricao = "LOJA X PARC"): ParcelaDeEntrada => ({
    ...p(id, mes, n, total, centavos, descricao),
    dataCompra: compra,
    dataLancamento: n === 1 ? compra : `${mes}-05`,
  });

  it("mesma data de compra: as primeiras parcelas uns centavos acima não abrem outra compra", () => {
    // Visto no Santander e no Mercado Pago: 1 e 2 cobradas 5 centavos acima, da 3 em diante o valor certo.
    const g = agruparParcelas([
      comCompra("a", "2026-05-11", "2026-06", 1, 12, -10005),
      comCompra("b", "2026-05-11", "2026-07", 2, 12, -10005),
      comCompra("c", "2026-05-11", "2026-08", 3, 12, -10000),
      comCompra("d", "2026-05-11", "2026-09", 4, 12, -10000),
    ]);
    assert.equal(new Set(g.values()).size, 1);
  });

  it("datas de compra diferentes são compras diferentes, mesmo com o mesmo valor e a origem no mês vizinho", () => {
    // Três compras iguais (11/06, 12/07, 27/07). Pelo mês de origem ±1, a parcela 2 da de 12/07
    // caía no grupo da de 27/07, que tinha sido aberto antes (a ordem entre ids é a da fonte).
    const compraDe: Record<string, string> = { k1: "06-11", k2: "06-11", k3: "06-11", r1: "07-12", a2: "07-12", a1: "07-27", r2: "07-27" };
    const lista = [
      comCompra("k1", "2026-06-11", "2026-07", 1, 12, -10000),
      comCompra("k2", "2026-06-11", "2026-08", 2, 12, -10000),
      comCompra("k3", "2026-06-11", "2026-09", 3, 12, -10000),
      comCompra("r1", "2026-07-12", "2026-08", 1, 12, -10000),
      comCompra("a2", "2026-07-12", "2026-09", 2, 12, -10000),
      comCompra("a1", "2026-07-27", "2026-08", 1, 12, -10000),
      comCompra("r2", "2026-07-27", "2026-09", 2, 12, -10000),
    ];
    const g = agruparParcelas(lista);
    assert.equal(new Set(g.values()).size, 3);
    for (const compra of new Set(Object.values(compraDe))) {
      const ids = Object.keys(compraDe).filter((id) => compraDe[id] === compra).map((id) => g.get(id));
      assert.equal(new Set(ids).size, 1, `as parcelas da compra de ${compra} ficam juntas`);
    }
  });

  it("várias compras iguais no mesmo dia: uma sequência por compra, e o valor diferente fica no seu grupo", () => {
    const lista = [
      ...["a", "b", "c"].flatMap((c) => [comCompra(`${c}1`, "2026-05-12", "2026-06", 1, 3, -2000), comCompra(`${c}2`, "2026-05-12", "2026-07", 2, 3, -2000)]),
      comCompra("d1", "2026-05-12", "2026-06", 1, 3, -3000),
      comCompra("d2", "2026-05-12", "2026-07", 2, 3, -3000),
    ];
    const g = agruparParcelas(lista);
    assert.equal(new Set(g.values()).size, 4);
    assert.equal(g.get("d1"), g.get("d2"));
  });

  it("na mesma data, mais de 1% de diferença no valor é outra compra", () => {
    const g = agruparParcelas([comCompra("a", "2026-05-12", "2026-06", 1, 3, -10000), comCompra("b", "2026-05-12", "2026-07", 2, 3, -10200)]);
    assert.equal(new Set(g.values()).size, 2);
  });

  it("sem a data da compra (a fonte repetiu a do lançamento), vale a regra do mês de origem e de 1 centavo", () => {
    const sem = (id: string, mes: string, n: number, centavos: number): ParcelaDeEntrada => ({ ...p(id, mes, n, 12, centavos), dataCompra: `${mes}-05`, dataLancamento: `${mes}-05` });
    assert.equal(new Set(agruparParcelas([sem("a", "2026-07", 2, -10000), sem("b", "2026-08", 3, -10001)]).values()).size, 1);
    assert.equal(new Set(agruparParcelas([sem("a", "2026-07", 2, -10005), sem("b", "2026-08", 3, -10000)]).values()).size, 2);
  });

  it("à vista (1/1) e sem número não entram", () => {
    assert.equal(agruparParcelas([p("a", "2026-09", 1, 1), { ...p("b", "2026-09", 1, 3), parcelaN: null }]).size, 0);
  });
});

describe("dataDaCompra", () => {
  const casos: [string, Pick<ParcelaDeEntrada, "parcelaN" | "dataCompra" | "dataLancamento">, string | null][] = [
    ["parcela 1: a data da compra", { parcelaN: 1, dataCompra: "2026-05-11", dataLancamento: "2026-05-13" }, "2026-05-11"],
    ["parcela 1 lançada no dia da compra", { parcelaN: 1, dataCompra: "2026-05-11", dataLancamento: "2026-05-11" }, "2026-05-11"],
    ["parcela 4 com a compra da fonte", { parcelaN: 4, dataCompra: "2026-05-11", dataLancamento: "2026-08-05" }, "2026-05-11"],
    ["parcela 4 sem purchaseDate (data repetida)", { parcelaN: 4, dataCompra: "2026-08-05", dataLancamento: "2026-08-05" }, null],
    ["sem datas", { parcelaN: 2 }, null],
  ];
  for (const [nome, entrada, esperado] of casos) it(`${nome} → ${esperado}`, () => assert.equal(dataDaCompra(entrada), esperado));
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
