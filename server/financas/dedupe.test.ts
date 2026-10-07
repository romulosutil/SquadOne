import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chaveDedupe, dedupeDaLeitura, descricoesParecidas, jaExisteEmOutraFonte } from "./dedupe.ts";
import { tx } from "./teste-apoio.ts";

const contas = new Set(["cartao"]);

describe("dedupeDaLeitura", () => {
  it("o LANÇADO substitui o PENDENTE gravado, mesmo com outro id", () => {
    const pendente = tx("cartao", "2026-09-10", -4590, "RESTAURANTE BOM", { id: "p1", status: "pendente" });
    const lancado = tx("cartao", "2026-09-12", -4590, "RESTAURANTE BOM LTDA", { id: "l1" });
    const r = dedupeDaLeitura([lancado], [pendente], contas);
    assert.deepEqual(r.remover, ["p1"]);
    assert.deepEqual(r.manter.map((t) => t.id), ["l1"]);
  });

  it("pendente e lançado na MESMA leitura: o pendente sai", () => {
    const pendente = tx("cartao", "2026-09-10", -4590, "RESTAURANTE BOM", { id: "p1", status: "pendente" });
    const lancado = tx("cartao", "2026-09-11", -4590, "RESTAURANTE BOM", { id: "l1" });
    assert.deepEqual(dedupeDaLeitura([pendente, lancado], [], contas).manter.map((t) => t.id), ["l1"]);
  });

  it("pendente que a fonte deixou de listar sai (autorização caiu)", () => {
    const pendente = tx("cartao", "2026-09-10", -4590, "LOJA", { id: "p1", status: "pendente" });
    assert.deepEqual(dedupeDaLeitura([tx("cartao", "2026-09-11", -100, "OUTRA")], [pendente], contas).remover, ["p1"]);
  });

  it("pendente de outro valor fica", () => {
    const pendente = tx("cartao", "2026-09-10", -4590, "LOJA", { id: "p1", status: "pendente" });
    const lancado = tx("cartao", "2026-09-11", -4591, "LOJA", { id: "l1" });
    assert.deepEqual(dedupeDaLeitura([pendente, lancado], [], contas).manter.map((t) => t.id), ["p1", "l1"]);
  });

  it("lançado que sumiu sem gêmeo fica (histórico velho)", () => {
    const antigo = tx("cartao", "2025-09-10", -4590, "LOJA", { id: "a" });
    assert.deepEqual(dedupeDaLeitura([tx("cartao", "2026-09-11", -100, "OUTRA")], [antigo], contas).remover, []);
  });

  it("lançado com id trocado na fonte: sai o antigo", () => {
    const antigo = tx("cartao", "2026-09-10", -4590, "LOJA", { id: "a" });
    const novo = tx("cartao", "2026-09-10", -4590, "LOJA", { id: "b" });
    assert.deepEqual(dedupeDaLeitura([novo], [antigo], contas).remover, ["a"]);
  });

  it("conta que não foi lida não é tocada", () => {
    const pendente = tx("outra", "2026-09-10", -4590, "LOJA", { id: "p1", status: "pendente" });
    assert.deepEqual(dedupeDaLeitura([tx("cartao", "2026-09-11", -100, "X")], [pendente], contas).remover, []);
  });

  it("a Pluggy vence o PDF quando os dois têm o mesmo lançamento", () => {
    const doPdf = tx("cartao", "2026-09-10", -4590, "LOJA", { id: "pdf1", fonte: "pdf", chaveDedupe: "pdf:x" });
    const daPluggy = tx("cartao", "2026-09-11", -4590, "LOJA", { id: "pl1" });
    assert.deepEqual(dedupeDaLeitura([daPluggy], [doPdf], contas).remover, ["pdf1"]);
    assert.equal(jaExisteEmOutraFonte(doPdf, [daPluggy]), true);
  });
});

describe("chaveDedupe", () => {
  it("Pluggy pelo id; PDF pelo conteúdo + ocorrência", () => {
    assert.equal(chaveDedupe("pluggy", { contaId: "c", idOrigem: "abc", dataCompra: "2026-09-10", centavos: -1, descricao: "X" }), "pluggy:abc");
    const base = { contaId: "c", dataCompra: "2026-09-10", centavos: -350, descricao: "Café", faturaId: "f" };
    assert.notEqual(chaveDedupe("pdf", base, 0), chaveDedupe("pdf", base, 1));
    assert.equal(chaveDedupe("pdf", base, 0), chaveDedupe("pdf", { ...base, descricao: "CAFE" }, 0));
  });
});

describe("descricoesParecidas", () => {
  const casos: [string, string, boolean][] = [
    ["RESTAURANTE BOM", "Restaurante Bom Ltda", true],
    ["UBER *TRIP 1234", "UBER TRIP", true],
    ["AMAZON MARKETPLACE", "AMAZON MKTPLACE BR", true],
    ["NETFLIX", "SPOTIFY", false],
  ];
  for (const [a, b, esperado] of casos) it(`${a} ~ ${b}`, () => assert.equal(descricoesParecidas(a, b), esperado));
});
