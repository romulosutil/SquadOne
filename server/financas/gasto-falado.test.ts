import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATEGORIAS_PADRAO } from "./categoria.ts";
import { categoriaDoGasto, lerGastoFalado, textoDoGastoAnotado } from "./gasto-falado.ts";

describe("lerGastoFalado", () => {
  const casos: [string, number | null, string | null][] = [
    ["gastei 30 no mercado", 3000, "mercado"],
    ["Gastei R$ 30,50 na farmácia.", 3050, "farmácia"],
    ["gastei 30.5 com uber", 3050, "uber"],
    ["paguei 1.200 de aluguel", 120000, "aluguel"],
    ["paguei 1.200,90 no dentista", 120090, "dentista"],
    ["eu gastei 12 reais na padaria do zé", 1200, "padaria do zé"],
    ["gasto 8 conto pastel", 800, "pastel"],
    ["gastei 30 no mercado\ncom a família", 3000, "mercado com a família"],
    // Não é gasto: vira demanda comum (e vai ao turno sem valor de finanças nenhum).
    ["gastei a tarde no mercado", null, null],
    ["gastei 30 hoje 2", 3000, "hoje 2"],
    ["gastei 30", null, null],
    ["gastei 0 no mercado", null, null],
    ["gastei 1000001 no carro", null, null],
    ["reunião às 15h para revisar o que gastei 30 no mercado", null, null],
    ["comprei 30 no mercado", null, null],
  ];
  for (const [texto, centavos, onde] of casos) {
    it(JSON.stringify(texto), () => {
      const g = lerGastoFalado(texto);
      assert.deepEqual(g, centavos === null ? null : { centavos, onde });
    });
  }
});

describe("categoriaDoGasto", () => {
  const existentes = [...CATEGORIAS_PADRAO, "Pet"];
  const casos: [string, string][] = [
    ["mercado", "Mercado"],
    ["restaurante", "Restaurantes"],
    ["farmácia", "Farmácia"],
    ["uber", "Transporte"],
    ["padaria do zé", "Restaurantes"],
    ["gasolina", "Combustível"],
    ["pet", "Pet"],
    ["pagamento de fatura", "Outros"],
    ["coisa nenhuma", "Outros"],
  ];
  for (const [onde, categoria] of casos) it(`${onde} → ${categoria}`, () => assert.equal(categoriaDoGasto(onde, existentes, new Map()), categoria));

  it("categoria renomeada: a regra embutida devolve o nome novo", () => {
    assert.equal(categoriaDoGasto("uber", existentes, new Map([["Transporte", "Locomoção"]])), "Locomoção");
  });
});

describe("textoDoGastoAnotado", () => {
  it("só a categoria", () => {
    assert.equal(textoDoGastoAnotado("Mercado"), "Anotado: Mercado");
    assert.match(textoDoGastoAnotado("Outros"), /^Anotado: Outros\./);
  });
});
