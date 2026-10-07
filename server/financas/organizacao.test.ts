import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categorizar } from "./categoria.ts";
import {
  categoriasExistentes,
  faixaDe,
  fimDoMes,
  nomeDeCategoria,
  NomeDeCategoriaInvalido,
  orcamentoDoMes,
  porcentagem,
  recorrentesAte,
  renomesDepois,
} from "./organizacao.ts";
import { processar } from "./processar.ts";
import { conta, tx } from "./teste-apoio.ts";
import type { Transacao } from "./tipos.ts";

// Valores e estabelecimentos inventados.

describe("nomes de categoria", () => {
  it("limpa espaço e quebra de linha; vazio ou longo demais é recusado", () => {
    assert.equal(nomeDeCategoria("  Pet\n shop "), "Pet shop");
    assert.throws(() => nomeDeCategoria("   "), NomeDeCategoriaInvalido);
    assert.throws(() => nomeDeCategoria("x".repeat(41)), NomeDeCategoriaInvalido);
    assert.throws(() => nomeDeCategoria(3), NomeDeCategoriaInvalido);
  });

  it("a lista junta padrão (pelo nome novo), criadas e em uso, sem duplicar maiúscula, com Outros no fim", () => {
    const lista = categoriasExistentes({
      renomes: new Map([["Mercado", "Supermercado"]]),
      criadas: ["Pet"],
      emUso: ["pet", "Supermercado"],
      regras: new Map([["LOJA", "Presentes"]]),
      orcamentos: new Map([["Viagem", 100]]),
    });
    assert.ok(lista.includes("Supermercado") && !lista.includes("Mercado"));
    assert.ok(lista.includes("Pet") && !lista.includes("pet"));
    assert.ok(lista.includes("Presentes"));
    assert.equal(lista.at(-1), "Outros");
  });
});

describe("renomesDepois", () => {
  it("encadeia: A→B e depois B→C deixa A→C e B→C", () => {
    const r = renomesDepois(new Map([["A", "B"]]), "B", "C");
    assert.deepEqual([...r].sort(), [["A", "C"], ["B", "C"]]);
  });
  it("desfaz o ciclo: A→B e depois B→A não deixa A→A", () => {
    assert.deepEqual([...renomesDepois(new Map([["A", "B"]]), "B", "A")], [["B", "A"]]);
  });
});

describe("regra do Rômulo e renome no passe", () => {
  const contas = [conta("cc", "corrente")];
  it("a regra do estabelecimento vence a Pluggy e a descrição; a natureza e a escolha à mão vencem a regra", () => {
    const regras = new Map([["PADARIA DO BAIRRO", "Café da manhã"]]);
    const [porRegra, aMao, pagamento] = processar(
      contas,
      [],
      [
        tx("cc", "2026-10-01", -1500, "PADARIA DO BAIRRO", { categoriaFonte: "Eating out" }),
        tx("cc", "2026-10-02", -1500, "PADARIA DO BAIRRO", { categoria: "Presentes", origemCategoria: "usuario" }),
        tx("cc", "2026-10-03", -9000, "PAGAMENTO DE FATURA"),
      ],
      { regras: new Map([...regras, ["PAGAMENTO DE FATURA", "Café da manhã"]]), renomes: new Map() },
    );
    assert.deepEqual([porRegra.categoria, porRegra.origemCategoria], ["Café da manhã", "regra_usuario"]);
    assert.equal(aMao.categoria, "Presentes");
    assert.equal(pagamento.categoria, "Pagamento de fatura");
  });

  it("renome segue valendo quando a regra embutida produz o nome antigo", () => {
    const [t] = processar(contas, [], [tx("cc", "2026-10-01", -2000, "SUPERMERCADO X")], { regras: new Map(), renomes: new Map([["Mercado", "Supermercado"]]) });
    assert.equal(t.categoria, "Supermercado");
  });

  it("categorizar sem regras continua igual ao de antes", () => {
    assert.equal(categorizar({ natureza: "despesa", descricao: "IFOOD *X", categoriaFonte: "" }).categoria, "Delivery");
  });
});

describe("semáforo", () => {
  const casos: [number, number][] = [
    [0, 0],
    [69, 0],
    [70, 70],
    [89, 70],
    [90, 90],
    [99, 90],
    [100, 100],
    [140, 100],
  ];
  for (const [pct, faixa] of casos) it(`${pct}% → faixa ${faixa}`, () => assert.equal(faixaDe(pct), faixa));

  it("a % arredonda para BAIXO: 89,9% não aparece como 90%", () => {
    assert.equal(porcentagem(899, 1000), 89);
    assert.equal(porcentagem(-50, 1000), 0);
    assert.equal(porcentagem(10, 0), 0);
  });
});

describe("orçamento do mês", () => {
  it("por categoria e no total das orçadas; sem orçamento = null", () => {
    assert.equal(orcamentoDoMes(new Map(), new Map([["Mercado", 100]])), null);
    const o = orcamentoDoMes(
      new Map([
        ["Mercado", 100_000],
        ["Lazer", 50_000],
      ]),
      new Map([
        ["Mercado", 95_000],
        ["Delivery", 999_999],
      ]),
    )!;
    assert.deepEqual(
      o.categorias.map((c) => [c.categoria, c.pct, c.semaforo]),
      [
        ["Mercado", 95, "laranja"],
        ["Lazer", 0, "verde"],
      ],
    );
    assert.equal(o.limiteCentavos, 150_000);
    assert.equal(o.gastoCentavos, 95_000);
    assert.equal(o.pct, 63);
  });
});

describe("recorrentes", () => {
  const gasto = (t: Transacao) => (t.centavos < 0 ? -t.centavos : null);
  const despesa = (data: string, centavos: number, descricao: string) => tx("cc", data, centavos, descricao, { natureza: "despesa" });
  const fim = fimDoMes("2026-10");

  it("assinatura a cada ~30 dias é detectada; o mercado da semana não", () => {
    const transacoes = [
      despesa("2026-07-10", -5590, "STREAMING X"),
      despesa("2026-08-09", -5590, "STREAMING X"),
      despesa("2026-09-10", -5590, "STREAMING X"),
      despesa("2026-10-10", -5590, "STREAMING X"),
      ...["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03"].map((d) => despesa(d, -20000, "MERCADO DA ESQUINA")),
    ];
    const r = recorrentesAte(transacoes, fim, new Map(), gasto);
    assert.deepEqual(r.lista.map((x) => [x.descricao, x.vezes, x.mediaCentavos, x.origem]), [["STREAMING X", 4, 5590, "detectado"]]);
  });

  it("assinatura cancelada (última há mais de 45 dias) some", () => {
    const transacoes = ["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"].map((d) => despesa(d, -1000, "APP Y"));
    assert.equal(recorrentesAte(transacoes, fim, new Map(), gasto).lista.length, 0);
  });

  it("marcar inclui o que a regra não viu; desmarcar tira e fica para desfazer", () => {
    const transacoes = [
      despesa("2026-10-02", -12000, "ACADEMIA Z"),
      ...["2026-08-10", "2026-09-10", "2026-10-10"].map((d) => despesa(d, -3000, "STREAMING X")),
    ];
    const r = recorrentesAte(
      transacoes,
      fim,
      new Map([
        ["ACADEMIA Z", true],
        ["STREAMING X", false],
      ]),
      gasto,
    );
    assert.deepEqual(r.lista.map((x) => [x.estabelecimento, x.origem, x.vezes]), [["ACADEMIA Z", "marcado", 1]]);
    assert.deepEqual(r.desmarcados, [{ estabelecimento: "STREAMING X", descricao: "STREAMING X" }]);
  });

  it("parcela e pendente não contam", () => {
    const transacoes = ["2026-08-10", "2026-09-10", "2026-10-10"].map((d, i) =>
      tx("cc", d, -3000, "LOJA PARCELADA", { natureza: "despesa", parcelaN: i + 1, parcelaTotal: 3 }),
    );
    assert.equal(recorrentesAte(transacoes, fim, new Map(), gasto).lista.length, 0);
  });
});
