import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { abrirBanco, ARQUIVO_DA_COPIA, ARQUIVO_DO_BANCO, MIGRACOES, type BancoDeFinancas } from "./banco.ts";
import type { ClienteDaPluggy } from "./pluggy.ts";
import { resumir } from "./resumo.ts";
import { prepararFinancas } from "./rotas.ts";
import { conta, fatura, tx } from "./teste-apoio.ts";
import { criarSincronizador, leituraDiariaDevida, reprocessar } from "./sync.ts";

// Banco num diretório temporário, nunca em data/. A Pluggy é um dublê: valores inventados.
let dir: string;
let banco: BancoDeFinancas;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "financas-"));
  banco = await abrirBanco(dir);
});
after(() => {
  banco.fechar();
  fs.rmSync(dir, { recursive: true, force: true });
});

function pluggyFalsa(transacoesDoCartao: object[], falharItem?: string): ClienteDaPluggy {
  return {
    item: async (id: string) => {
      if (id === falharItem) throw Object.assign(new Error("Pluggy respondeu 500 em /items"), { name: "ErroPluggy" });
      return { id, status: "UPDATED", executionStatus: "SUCCESS", lastUpdatedAt: "2026-10-06T09:00:00Z", connector: { name: "Banco Teste" } };
    },
    contas: async () => [
      { id: "cc", itemId: "item-a", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta", balance: 1000 },
      { id: "cartao", itemId: "item-a", type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão", number: "1234", balance: 100, creditData: {} },
    ],
    faturas: async () => [
      { id: "b-set", dueDate: "2026-09-10", billClosingDate: "2026-09-03", totalAmount: 100, payments: [{ paymentDate: "2026-09-10", amount: 100 }] },
    ],
    investimentos: async () => [{ id: "inv", itemId: "item-a", name: "CDB", balance: 500, status: "ACTIVE" }],
    transacoes: async (accountId: string) =>
      accountId === "cartao"
        ? transacoesDoCartao
        : [{ id: "pix", description: "PIX ENVIADO", amount: -100, type: "DEBIT", date: "2026-09-10", status: "POSTED" }],
  } as unknown as ClienteDaPluggy;
}

describe("sincronização com o banco SQLite", () => {
  it("lê, grava, deriva a natureza e faz a cópia; o pagamento da fatura não vira gasto", async () => {
    const s = criarSincronizador({
      banco,
      cliente: pluggyFalsa([
        { id: "pend", description: "LOJA X", amount: 100, type: "DEBIT", date: "2026-08-20", status: "PENDING" },
      ]),
      itemIds: ["item-a"],
      agora: () => new Date("2026-10-07T12:00:00Z"),
    });
    const r = await s.sincronizar("botao");
    assert.equal(r.ok, true);
    assert.equal(fs.existsSync(path.join(dir, ARQUIVO_DA_COPIA)), true);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.join(dir, ARQUIVO_DO_BANCO)).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.join(dir, ARQUIVO_DA_COPIA)).mode & 0o777, 0o600);
    }
    assert.equal(banco.transacoes().find((t) => t.id === "pluggy:pix")?.natureza, "pagamento_fatura");
    assert.deepEqual(banco.contas().map((c) => c.tipo).sort(), ["cartao", "corrente", "investimento"]);
  });

  it("na leitura seguinte o LANÇADO substitui o PENDENTE (outro id), e o gasto conta uma vez", async () => {
    const s = criarSincronizador({
      banco,
      cliente: pluggyFalsa([{ id: "post", description: "LOJA X LTDA", amount: 100, type: "DEBIT", date: "2026-08-21", status: "POSTED" }]),
      itemIds: ["item-a"],
      agora: () => new Date("2026-10-08T12:00:00Z"),
    });
    await s.sincronizar("diaria");
    const ids = banco.transacoes().map((t) => t.id).sort();
    assert.deepEqual(ids, ["pluggy:pix", "pluggy:post"]);
    for (const visao of ["competencia", "caixa"] as const) {
      const resumo = resumir({ contas: banco.contas(), faturas: banco.faturas(), transacoes: banco.transacoes(), conexoes: banco.conexoes() }, "2026-10-08", "2026-09", visao);
      assert.equal(resumo.gastei.totalCentavos, 10000, visao);
    }
  });

  it("conexão que falha grava a falha e não cala as outras", async () => {
    const s = criarSincronizador({ banco, cliente: pluggyFalsa([], "item-b"), itemIds: ["item-b", "item-a"] });
    const r = await s.sincronizar("botao");
    assert.equal(r.ok, false);
    assert.deepEqual(r.conexoes.map((c) => c.erro === null), [false, true]);
    assert.match(banco.conexoes().find((c) => c.itemId === "item-b")!.erroLeitura!, /falha interna|500/);
  });

  it("dois cliques esperam a mesma leitura", async () => {
    const s = criarSincronizador({ banco, cliente: pluggyFalsa([]), itemIds: ["item-a"] });
    const [a, b] = [s.sincronizar("botao"), s.sincronizar("botao")];
    assert.equal(a, b);
    await a;
  });
});

describe("leituraDiariaDevida", () => {
  const agora = new Date("2026-10-07T12:00:00Z");
  const casos: [string, string | null, string | null, number, boolean][] = [
    ["antes das 7h, não", null, null, 6, false],
    ["nunca leu, sim", null, null, 9, true],
    ["leu há 3 h, não", "2026-10-07T09:00:00Z", "2026-10-07T09:00:00Z", 9, false],
    ["leu ontem cedo, sim", "2026-10-06T09:00:00Z", "2026-10-06T09:00:00Z", 9, true],
    ["falhou há 1 h, espera", "2026-10-06T09:00:00Z", "2026-10-07T11:00:00Z", 9, false],
    ["falhou há 3 h, tenta", "2026-10-06T09:00:00Z", "2026-10-07T09:00:00Z", 9, true],
  ];
  for (const [nome, ok, tentativa, hora, esperado] of casos) it(nome, () => assert.equal(leituraDiariaDevida(agora, ok, tentativa, hora), esperado));
});

describe("ao abrir as finanças, o passe puro é refeito sobre o que está gravado", () => {
  it("um grupo de parcela gravado por uma regra antiga é corrigido sem esperar a próxima leitura", async () => {
    const dirProprio = fs.mkdtempSync(path.join(os.tmpdir(), "financas-abrir-"));
    try {
      const primeiro = await abrirBanco(dirProprio);
      const cartao = conta("cartao", "cartao");
      primeiro.gravarLeitura({
        conexao: { itemId: "item", nome: "Banco Teste", status: "UPDATED", executionStatus: "SUCCESS", dadosAte: null, consentimentoAte: null, lidoEm: null, erroLeitura: null },
        contas: [cartao],
        faturas: [],
        transacoes: [],
        removerTransacoes: [],
      });
      // A mesma compra, gravada em dois grupos (como a regra de 1 centavo fazia).
      const parcela = (n: number, data: string, centavos: number, grupo: string) =>
        tx("cartao", data, centavos, "LOJA P", { id: `p${n}`, dataCompra: "2026-05-11", parcelaN: n, parcelaTotal: 6, grupoParcela: grupo });
      primeiro.inserirTransacoes([parcela(1, "2026-05-12", -10005, "velho-a"), parcela(2, "2026-06-05", -10005, "velho-a"), parcela(3, "2026-07-06", -10000, "velho-b")]);
      primeiro.fechar();

      const estado = await prepararFinancas(dirProprio, {});
      const grupos = new Set(estado.banco!.transacoes().map((t) => t.grupoParcela));
      estado.banco!.fechar();
      assert.equal(grupos.size, 1);
      assert.ok(!grupos.has("velho-a") && !grupos.has("velho-b"));
    } finally {
      fs.rmSync(dirProprio, { recursive: true, force: true });
    }
  });
});

describe("a fatura que a fonte deu sobrevive ao passe (migração 3)", () => {
  const conexao = { itemId: "item", nome: "Banco Teste", status: "UPDATED", executionStatus: "SUCCESS", dadosAte: null, consentimentoAte: null, lidoEm: null, erroLeitura: null };

  it("o billId da fatura aberta não se perde ao reabrir as finanças: o dia do fechamento segue na seguinte", async () => {
    const dirProprio = fs.mkdtempSync(path.join(os.tmpdir(), "financas-fonte-"));
    try {
      const primeiro = await abrirBanco(dirProprio);
      primeiro.gravarLeitura({
        conexao,
        contas: [conta("cartao", "cartao")],
        faturas: [fatura("s-out", "cartao", "2026-10-12", 0, { fechamento: "2026-10-05" })],
        // Lançado no dia do fechamento, cobrado na fatura de 12/11, que ainda não está em /bills.
        transacoes: [tx("cartao", "2026-10-05", -1000, "LOJA Y", { id: "y", chaveDedupe: "pluggy:y", faturaId: "s-nov" })],
        removerTransacoes: [],
      });
      reprocessar(primeiro);
      primeiro.fechar();

      // Reabrir refaz o passe sobre o que o anterior gravou (fatura_id já é a derivada).
      const estado = await prepararFinancas(dirProprio, {});
      const [t] = estado.banco!.transacoes();
      estado.banco!.fechar();
      assert.equal(t.faturaFonte, "s-nov");
      assert.equal(t.faturaId, null, "fatura aberta, não a de 12/10");
    } finally {
      fs.rmSync(dirProprio, { recursive: true, force: true });
    }
  });

  it("a migração parte do que já estava gravado (da Pluggy e do PDF), e o que não veio de fonte fica sem", async () => {
    const dirProprio = fs.mkdtempSync(path.join(os.tmpdir(), "financas-migracao-"));
    try {
      const antigo = new Database(path.join(dirProprio, ARQUIVO_DO_BANCO));
      for (const m of MIGRACOES.slice(0, 2)) antigo.exec(m);
      antigo.pragma("user_version = 2");
      const inserir = antigo.prepare(
        `INSERT INTO transacao (id, conta_id, fonte, chave_dedupe, data_compra, data_lancamento, descricao, centavos, natureza, fatura_id, status)
         VALUES (?, 'cartao', ?, ?, '2026-09-20', '2026-09-20', 'LOJA', -100, 'despesa', ?, 'lancada')`,
      );
      inserir.run("p", "pluggy", "k-p", "f-1");
      inserir.run("d", "pdf", "k-d", "f-1");
      inserir.run("o", "ofx", "k-o", "f-1");
      inserir.run("s", "pluggy", "k-s", null);
      antigo.close();

      const b = await abrirBanco(dirProprio);
      const fonte = Object.fromEntries(b.transacoesDasContas(["cartao"]).map((t) => [t.id, t.faturaFonte]));
      b.fechar();
      assert.deepEqual(fonte, { p: "f-1", d: "f-1", o: null, s: null });
    } finally {
      fs.rmSync(dirProprio, { recursive: true, force: true });
    }
  });
});
