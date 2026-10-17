import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { criarMemoriaDaVenda, resolver, vendaDoDia } from "./venda-do-dia.ts";
import { leituraDoTesteDoRecibo, MINIMO_POR_BRACO_DO_RECIBO } from "../src/operations/ab-recibo.ts";

// OT-01 (16/10/2026): o "Enviei"/"Pular" do dia, um só para a Próxima venda e o Telegram.
describe("memória da venda do dia", () => {
  const AGORA = Date.parse("2026-10-16T15:00:00Z");

  it("vira o dia (São Paulo), zera; lixo é descartado", () => {
    assert.deepEqual(vendaDoDia({ dia: "2026-10-15", resolvidas: { a: { em: 1, pulou: false } } }, AGORA), { dia: "2026-10-16", resolvidas: {} });
    const lido = vendaDoDia({ dia: "2026-10-16", resolvidas: { a: { em: 1, pulou: true }, b: { em: "x", pulou: true }, "": { em: 1, pulou: false } } }, AGORA);
    assert.deepEqual(Object.keys(lido.resolvidas), ["a"]);
    assert.deepEqual(vendaDoDia(null, AGORA).resolvidas, {});
  });

  it("a última decisão vale e a chave longa é recusada", () => {
    const v = resolver(resolver(vendaDoDia(null, AGORA), "a|followup", true, AGORA), "a|followup", false, AGORA + 1);
    assert.deepEqual(v.resolvidas["a|followup"], { em: AGORA + 1, pulou: false });
    assert.throws(() => resolver(v, "x".repeat(301), false, AGORA));
  });

  it("grava e relê do arquivo, em diretório temporário", async () => {
    const dir = await mkdtemp(join(tmpdir(), "squadone-venda-"));
    const memoria = criarMemoriaDaVenda(join(dir, "venda-do-dia.json"), () => AGORA);
    await Promise.all([memoria.resolver("a|responder", false), memoria.resolver("b|primeiro", true)]);
    assert.deepEqual(Object.keys((await memoria.ler()).resolvidas).sort(), ["a|responder", "b|primeiro"]);
    await rm(dir, { recursive: true, force: true });
  });
});

// OT-10 (16/10/2026): a leitura do teste do recibo só conta depois do 3º dia e a resposta depois dele.
describe("leitura do teste do recibo", () => {
  const AGORA = Date.parse("2026-11-10T15:00:00Z");
  const enviado = "2026-10-20T15:00:00.000Z";
  const depois = "2026-10-24T15:00:00.000Z";
  const antes = "2026-10-21T15:00:00.000Z";
  const lead = (braco: "teste" | "controle", respondeu?: string, tipo?: "exclusao" | "interesse") =>
    ({ testeDoRecibo: braco, marcos: { enviado, ...(respondeu ? { respondeu } : {}) }, ...(tipo ? { resposta: { tipo, trecho: "" } } : {}) });

  it("conta por braço, separa a exclusão e só calcula o p com o mínimo dos dois lados", () => {
    const poucos = leituraDoTesteDoRecibo([lead("teste", depois, "interesse"), lead("teste", depois, "exclusao"), lead("teste", antes), lead("controle")], AGORA)!;
    assert.deepEqual(poucos.teste, { n: 3, responderam: 2, pediramParaParar: 1 });
    assert.deepEqual(poucos.controle, { n: 1, responderam: 0, pediramParaParar: 0 });
    assert.equal(poucos.p, null);
    const muitos = [...Array(MINIMO_POR_BRACO_DO_RECIBO)].flatMap((_, i) => [lead("teste", i < 10 ? depois : undefined), lead("controle", i < 3 ? depois : undefined)]);
    const r = leituraDoTesteDoRecibo(muitos, AGORA)!;
    assert.ok(r.p !== null && r.p < 0.1);
  });

  it("sem ninguém no teste, nada a mostrar; antes do 3º dia não entra", () => {
    assert.equal(leituraDoTesteDoRecibo([{ marcos: { enviado } }], AGORA), null);
    assert.equal(leituraDoTesteDoRecibo([lead("teste")], Date.parse("2026-10-22T15:00:00Z")), null);
  });
});
