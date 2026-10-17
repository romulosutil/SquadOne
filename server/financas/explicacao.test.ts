import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estabelecimentosDoMes, hashDoPacote, MAX_ESTABELECIMENTOS_POR_CATEGORIA, montarPacote, promptDaExplicacao, type EstabelecimentosDoMes, type OpcoesDoPacote } from "./explicacao.ts";
import { contextoDas } from "./processar.ts";
import type { ResumoFinanceiro } from "./resumo.ts";
import { conta, tx } from "./teste-apoio.ts";

// O texto que vai ao Gemini (RULES 24). Montado de um ResumoFinanceiro FIXO,
// não de transações: a conta do "gastei" é de visoes.ts/resumo.ts e tem os
// testes dela. Valores, nomes e estabelecimentos inventados.

const RESUMO: ResumoFinanceiro = {
  hoje: "2026-10-20",
  mes: "2026-10",
  visao: "competencia",
  tenho: {
    totalCentavos: 1_234_567,
    contas: [
      { id: "cc", nome: "Conta Exemplo", instituicao: "Banco Exemplo", tipo: "corrente", saldoCentavos: 1_000_000 },
      { id: "inv", nome: "Reserva", instituicao: "Corretora Exemplo", tipo: "investimento", saldoCentavos: 234_567 },
    ],
  },
  devo: {
    totalCentavos: 750_000,
    cartoes: [
      {
        id: "cartao",
        nome: "Cartão Exemplo",
        instituicao: "Banco Exemplo",
        final: "1234",
        limiteCentavos: 1_000_000,
        usadoBancoCentavos: 750_000,
        usoPct: 75,
        semaforo: "amarelo",
        fechada: { vencimento: "2026-10-25", centavos: 300_000, pagoCentavos: 0 },
        aberta: { vencimento: "2026-11-25", centavos: 200_000, semLancamentos: false },
        futurasCentavos: 250_000,
        detalhadoCentavos: 750_000,
        semDetalheCentavos: 0,
        totalCentavos: 750_000,
      },
    ],
    porMes: [
      { mes: "2026-10", centavos: 300_000 },
      { mes: "2026-11", centavos: 300_000 },
      { mes: "2026-12", centavos: 150_000 },
    ],
    parcelamentos: [
      { grupo: "g1", contaId: "cartao", descricao: "LOJA DE MOVEIS EXEMPLO", valorParcela: 50_000, total: 10, ultimaVista: 5, restantes: 5, acabaEm: "2027-03", porMes: {}, cartao: "Cartão Exemplo ·1234" },
    ],
    parcelasAcabamEm: "2027-03",
  },
  gastei: {
    totalCentavos: 400_000,
    anteriorCentavos: 320_000,
    categorias: [
      { categoria: "Mercado", centavos: 200_000, anteriorCentavos: 160_000 },
      { categoria: "Saúde", centavos: 150_000, anteriorCentavos: 160_000 },
      { categoria: "Lazer", centavos: 50_000, anteriorCentavos: 0 },
      { categoria: "Viagem", centavos: 0, anteriorCentavos: 40_000 },
    ],
  },
  recebi: { totalCentavos: 900_000, anteriorCentavos: 900_000 },
  orcamento: {
    limiteCentavos: 400_000,
    gastoCentavos: 350_000,
    pct: 87,
    semaforo: "amarelo",
    categorias: [
      { categoria: "Mercado", limiteCentavos: 200_000, gastoCentavos: 200_000, pct: 100, semaforo: "vermelho" },
      { categoria: "Saúde", limiteCentavos: 200_000, gastoCentavos: 150_000, pct: 75, semaforo: "amarelo" },
    ],
  },
  recorrentes: [
    { estabelecimento: "STREAMING EXEMPLO", descricao: "STREAMING EXEMPLO", categoria: "Assinaturas", mediaCentavos: 3_990, vezes: 4, ultimaData: "2026-10-05", origem: "detectado" },
  ],
  recorrentesDesmarcados: [{ estabelecimento: "PADARIA EXEMPLO", descricao: "PADARIA EXEMPLO" }],
  saude: {
    conexoes: [
      { itemId: "item", nome: "Banco Exemplo", status: "UPDATED", executionStatus: "SUCCESS", dadosAte: "2026-10-20T09:00:00Z", consentimentoAte: null, lidoEm: null, erroLeitura: null, saude: "ok", contas: ["Conta Exemplo"] },
    ],
    dadosAte: "2026-10-20T09:00:00Z",
  },
};

/** 12 estabelecimentos em Mercado (passa do teto), 1 em Saúde. */
const ESTABELECIMENTOS: EstabelecimentosDoMes = new Map([
  ["Mercado", Array.from({ length: 12 }, (_, i) => ({ estabelecimento: `MERCADO EXEMPLO ${String.fromCharCode(65 + i)}`, centavos: 20_000 - i * 100 }))],
  ["Saúde", [{ estabelecimento: "FARMACIA EXEMPLO", centavos: 150_000 }]],
]);

const PADRAO: OpcoesDoPacote = { comValores: false, comEstabelecimentos: false };
const COM_VALORES: OpcoesDoPacote = { comValores: true, comEstabelecimentos: false };
const COM_ESTABELECIMENTOS: OpcoesDoPacote = { comValores: false, comEstabelecimentos: true, estabelecimentos: ESTABELECIMENTOS };
const COM_TUDO: OpcoesDoPacote = { comValores: true, comEstabelecimentos: true, estabelecimentos: ESTABELECIMENTOS };

const R$ = /R\s*\$/;
/** Tudo que é estabelecimento ou descrição de lançamento no resumo e na lista à parte. */
const DESCRICOES = ["LOJA DE MOVEIS", "STREAMING", "PADARIA", "MERCADO EXEMPLO", "FARMACIA"];

describe("montarPacote: o padrão é o mínimo", () => {
  const texto = montarPacote(RESUMO, PADRAO);

  it("não tem R$ nem número de dinheiro", () => {
    assert.doesNotMatch(texto, R$);
    assert.doesNotMatch(texto, /\d{1,3}(\.\d{3})*,\d{2}/);
  });

  it("não tem descrição de lançamento nem estabelecimento", () => {
    for (const d of DESCRICOES) assert.ok(!texto.includes(d), `vazou "${d}"`);
  });

  it("tem as seções fixas, as categorias, as % e as contagens", () => {
    for (const secao of ["## Tenho", "## Devo por cartão", "## Gastei por categoria", "## Orçamento", "## Recorrentes", "## Parcelamentos", "## Saúde das conexões"]) {
      assert.ok(texto.includes(secao), secao);
    }
    assert.match(texto, /- Mercado: 50% do total; \+25% contra o mês anterior\./);
    assert.match(texto, /- Saúde: 38% do total; −6% contra o mês anterior\./);
    assert.match(texto, /- Lazer: .*novo/);
    assert.match(texto, /- Viagem: sem gasto este mês; −100%/);
    assert.match(texto, /Total do mês: \+25% contra setembro de 2026\./);
    assert.match(texto, /75% do limite usado \(passou de 70%\)/);
    assert.match(texto, /87% do orçado/);
    assert.match(texto, /- Mercado: 100% \(chegou a 100%\)/);
    assert.match(texto, /2 contas: 1 conta corrente, 1 investimento\./);
    assert.match(texto, /1 gasto se repete todo mês: Assinaturas \(1\)\./);
    assert.match(texto, /1 parcelamento em andamento, 5 parcelas a cobrar; a última acaba em mar\/27\./);
    assert.match(texto, /- Banco Exemplo: atualizada; dados até 20\/10\/2026\./);
  });

  it("um R$ escondido num nome de categoria não fura o padrão", () => {
    const comNome: ResumoFinanceiro = { ...RESUMO, gastei: { ...RESUMO.gastei, categorias: [{ categoria: "Aluguel R$ 2000", centavos: 100, anteriorCentavos: 100 }] } };
    assert.doesNotMatch(montarPacote(comNome, PADRAO), R$);
  });
});

describe("montarPacote: o que cada toggle acrescenta", () => {
  const casos: { nome: string; opcoes: OpcoesDoPacote; temReais: boolean; temEstabelecimentos: boolean }[] = [
    { nome: "padrão", opcoes: PADRAO, temReais: false, temEstabelecimentos: false },
    { nome: "com valores", opcoes: COM_VALORES, temReais: true, temEstabelecimentos: false },
    { nome: "com estabelecimentos", opcoes: COM_ESTABELECIMENTOS, temReais: false, temEstabelecimentos: true },
    { nome: "com os dois", opcoes: COM_TUDO, temReais: true, temEstabelecimentos: true },
  ];
  for (const c of casos) {
    it(c.nome, () => {
      const texto = montarPacote(RESUMO, c.opcoes);
      assert.equal(R$.test(texto), c.temReais, "R$");
      assert.equal(texto.includes("FARMACIA EXEMPLO"), c.temEstabelecimentos, "estabelecimento");
      assert.equal(texto.includes("STREAMING EXEMPLO"), c.temEstabelecimentos, "recorrente");
      assert.equal(texto.includes("LOJA DE MOVEIS EXEMPLO"), c.temEstabelecimentos, "parcelamento");
    });
  }

  it("com valores, os R$ são os do resumo", () => {
    const texto = montarPacote(RESUMO, COM_VALORES);
    assert.match(texto, /Total: R\$ 12\.345,67\./);
    assert.match(texto, /- Mercado: 50% do total; \+25% contra o mês anterior; R\$ 2\.000,00, antes R\$ 1\.600,00\./);
  });

  it(`no máximo ${MAX_ESTABELECIMENTOS_POR_CATEGORIA} estabelecimentos por categoria, os de maior gasto`, () => {
    const texto = montarPacote(RESUMO, COM_ESTABELECIMENTOS);
    const linha = texto.split("\n").find((l) => l.includes("MERCADO EXEMPLO"))!;
    assert.equal(linha.match(/MERCADO EXEMPLO [A-Z]/g)!.length, MAX_ESTABELECIMENTOS_POR_CATEGORIA);
    assert.ok(linha.includes("MERCADO EXEMPLO A"));
    assert.ok(!linha.includes("MERCADO EXEMPLO K") && !linha.includes("MERCADO EXEMPLO L"));
  });
});

describe("hashDoPacote", () => {
  it("o mesmo resumo com as mesmas opções dá o mesmo texto e o mesmo hash", () => {
    const a = montarPacote(RESUMO, PADRAO);
    const b = montarPacote(structuredClone(RESUMO), { comValores: false, comEstabelecimentos: false });
    assert.equal(a, b);
    assert.equal(hashDoPacote(a), hashDoPacote(b));
    assert.match(hashDoPacote(a), /^[0-9a-f]{16}$/);
  });

  it("cada combinação de toggles dá um hash diferente", () => {
    const hashes = [PADRAO, COM_VALORES, COM_ESTABELECIMENTOS, COM_TUDO].map((o) => hashDoPacote(montarPacote(RESUMO, o)));
    assert.equal(new Set(hashes).size, 4);
  });

  it("um dado diferente muda o hash", () => {
    const outro: ResumoFinanceiro = { ...RESUMO, orcamento: { ...RESUMO.orcamento!, pct: 88 } };
    assert.notEqual(hashDoPacote(montarPacote(RESUMO, PADRAO)), hashDoPacote(montarPacote(outro, PADRAO)));
  });
});

describe("promptDaExplicacao", () => {
  it("é fixo e pede o que a fase 8d pede", () => {
    const p = promptDaExplicacao();
    assert.equal(p, promptDaExplicacao());
    assert.match(p, /até 15 linhas/);
    assert.match(p, /Não invente números/);
    assert.match(p, /Sem conselho de investimento/);
    assert.match(p, /português/);
  });
});

describe("estabelecimentosDoMes", () => {
  it("soma pelo gasto na visão, só do mês, e corta no teto", () => {
    const contas = [conta("cc", "corrente")];
    const ctx = contextoDas(contas, []);
    const transacoes = [
      ...Array.from({ length: 12 }, (_, i) => tx("cc", "2026-10-03", -(1_000 + i), `LOJA ${String.fromCharCode(65 + i)}`, { categoria: "Compras" })),
      tx("cc", "2026-10-04", -500, "LOJA A", { categoria: "Compras" }),
      tx("cc", "2026-09-30", -99_999, "LOJA DE SETEMBRO", { categoria: "Compras" }),
      tx("cc", "2026-10-05", 50_000, "SALARIO", { categoria: "Salário" }),
    ];
    const r = estabelecimentosDoMes(transacoes, ctx, "2026-10", "competencia");
    const compras = r.get("Compras")!;
    assert.equal(compras.length, MAX_ESTABELECIMENTOS_POR_CATEGORIA);
    assert.deepEqual(compras[0], { estabelecimento: "LOJA A", centavos: 1_500 });
    assert.ok(!compras.some((e) => e.estabelecimento === "LOJA DE SETEMBRO"));
    assert.equal(r.has("Salário"), false);
  });
});
