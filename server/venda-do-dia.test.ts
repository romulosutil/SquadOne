import '../src/testes/politica-historica.ts'
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { anotar, criarMemoriaDaVenda, jaAnotada, liberar, marcarPrimeiroDoDia, resolver, vendaDoDia } from "./venda-do-dia.ts";
import { leituraDoTesteDoRecibo, MINIMO_POR_BRACO_DO_RECIBO } from "../src/operations/ab-recibo.ts";
import { instantesDePrimeiroContato, ritmoDoEnvio, somarPrimeiros } from "../src/operations/trava-de-ritmo.ts";

// OT-01 (16/10/2026): o "Enviei"/"Pular" do dia, um só para a Próxima venda e o Telegram.
// AC-06 (17/10/2026): por onde, a anotação uma vez por ação e os primeiros contatos do dia.
describe("memória da venda do dia", () => {
  const AGORA = Date.parse("2026-10-16T15:00:00Z");

  it("vira o dia (São Paulo), zera; lixo é descartado", () => {
    assert.deepEqual(vendaDoDia({ dia: "2026-10-15", resolvidas: { a: { em: 1, pulou: false } } }, AGORA),
      { dia: "2026-10-16", resolvidas: {}, anotadas: {}, primeiros: {}, liberados: {} });
    const lido = vendaDoDia({ dia: "2026-10-16", resolvidas: { a: { em: 1, pulou: true }, b: { em: "x", pulou: true }, "": { em: 1, pulou: false } } }, AGORA);
    assert.deepEqual(Object.keys(lido.resolvidas), ["a"]);
    assert.deepEqual(vendaDoDia(null, AGORA).resolvidas, {});
  });

  it("lê o arquivo de 16/10 (só em + pulou) que pode estar na Mel hoje", () => {
    const casos: Array<[unknown, object]> = [
      [{ em: 1, pulou: true }, { em: 1, pulou: true, como: "pulada" }],
      [{ em: 2, pulou: false }, { em: 2, pulou: false, como: "enviada" }],
      [{ em: 3, pulou: false, como: "recusa", por: "central" }, { em: 3, pulou: false, como: "recusa", por: "central" }],
      [{ em: 4, como: "pulada", por: "expirou" }, { em: 4, pulou: true, como: "pulada", por: "expirou" }],
      // `por` desconhecido some; o resto vale.
      [{ em: 5, pulou: false, por: "whatsapp" }, { em: 5, pulou: false, como: "enviada" }],
    ];
    for (const [cru, esperado] of casos) {
      assert.deepEqual(vendaDoDia({ dia: "2026-10-16", resolvidas: { k: cru } }, AGORA).resolvidas.k, esperado, JSON.stringify(cru));
    }
    const lido = vendaDoDia({ dia: "2026-10-16", resolvidas: {}, anotadas: { k: [{ tipo: "segunda_enviada", em: 1, por: "central" }, { tipo: "x", em: "y", por: "central" }] },
      primeiros: { "site:L": { em: 9, por: "telegram" }, "site:M": { em: 9, por: "pombo" } } }, AGORA);
    assert.deepEqual(lido.anotadas, { k: [{ tipo: "segunda_enviada", em: 1, por: "central" }] });
    assert.deepEqual(lido.primeiros, { "site:L": { em: 9, por: "telegram" } });
  });

  it("a última decisão vale, guarda por onde, e a chave longa é recusada", () => {
    const v = resolver(resolver(vendaDoDia(null, AGORA), "a|followup", "pulada", "central", AGORA), "a|followup", "enviada", "telegram", AGORA + 1);
    assert.deepEqual(v.resolvidas["a|followup"], { em: AGORA + 1, pulou: false, como: "enviada", por: "telegram" });
    assert.throws(() => resolver(v, "x".repeat(301), "enviada", "central", AGORA));
  });

  it("a anotação é idempotente por chave + tipo, venha de onde vier", () => {
    const v0 = vendaDoDia(null, AGORA);
    const casos: Array<{ passos: Array<[string, string, "central" | "telegram"]>; chave: string; tipo: string; anotada: boolean; total: number }> = [
      { passos: [], chave: "site:L|followup", tipo: "followup_enviado", anotada: false, total: 0 },
      { passos: [["site:L|followup", "followup_enviado", "central"]], chave: "site:L|followup", tipo: "followup_enviado", anotada: true, total: 1 },
      // Central no link e depois o "Enviei" do Telegram: uma só.
      { passos: [["site:L|followup", "followup_enviado", "central"], ["site:L|followup", "followup_enviado", "telegram"]], chave: "site:L|followup", tipo: "followup_enviado", anotada: true, total: 1 },
      // Outro tipo na mesma ação, ou outra ação do mesmo lead, é outra anotação.
      { passos: [["site:L|followup", "followup_enviado", "central"]], chave: "site:L|followup", tipo: "proposta", anotada: false, total: 1 },
      { passos: [["site:L|followup", "followup_enviado", "central"]], chave: "site:L|proposta", tipo: "followup_enviado", anotada: false, total: 1 },
    ];
    for (const c of casos) {
      const v = c.passos.reduce((acc, [chave, tipo, por], i) => anotar(acc, chave, tipo, por, AGORA + i), v0);
      assert.equal(jaAnotada(v, c.chave, c.tipo), c.anotada, JSON.stringify(c));
      assert.equal(Object.values(v.anotadas).flat().length, c.total, JSON.stringify(c));
    }
    const uma = anotar(v0, "k", "proposta", "central", AGORA);
    assert.equal(anotar(uma, "k", "proposta", "telegram", AGORA + 5), uma, "a segunda vez não muda nada");
    assert.equal(uma.anotadas.k[0].por, "central");
  });

  it("primeiro contato: o primeiro toque do lead vale, o segundo não conta de novo", () => {
    const v = marcarPrimeiroDoDia(marcarPrimeiroDoDia(vendaDoDia(null, AGORA), "site:L", "central", AGORA), "site:L", "telegram", AGORA + 60_000);
    assert.deepEqual(v.primeiros, { "site:L": { em: AGORA, por: "central" } });
    assert.throws(() => marcarPrimeiroDoDia(v, "", "central", AGORA));
  });

  // AC-21 (17/10/2026): o "Liberar" fora do expediente, um só para a Central, até a meia-noite de SP.
  it("liberados: lidos do arquivo, dia novo zera, formato antigo sem a chave é vazio, lixo sai", () => {
    const casos: Array<{ nome: string; lido: unknown; esperado: Record<string, number> }> = [
      { nome: "do dia", lido: { dia: "2026-10-16", resolvidas: {}, liberados: { "site:L": 5 } }, esperado: { "site:L": 5 } },
      { nome: "de ontem: zera", lido: { dia: "2026-10-15", resolvidas: {}, liberados: { "site:L": 5 } }, esperado: {} },
      { nome: "formato de 16/10 (sem a chave)", lido: { dia: "2026-10-16", resolvidas: { a: { em: 1, pulou: false } } }, esperado: {} },
      { nome: "formato de AC-06 (com primeiros, sem liberados)", lido: { dia: "2026-10-16", resolvidas: {}, primeiros: { "site:L": { em: 9, por: "central" } } }, esperado: {} },
      { nome: "lixo sai, o resto fica", lido: { dia: "2026-10-16", resolvidas: {}, liberados: { "site:L": 5, "site:M": "x", "": 1, "site:N": Number.NaN } }, esperado: { "site:L": 5 } },
      { nome: "liberados não é objeto", lido: { dia: "2026-10-16", resolvidas: {}, liberados: ["site:L"] }, esperado: {} },
    ];
    for (const c of casos) assert.deepEqual(vendaDoDia(c.lido, AGORA).liberados, c.esperado, c.nome);
  });

  it("liberar: o primeiro toque vale, repetir não muda nada, lead inválido é recusado", () => {
    const v1 = liberar(vendaDoDia(null, AGORA), "site:L", AGORA);
    assert.deepEqual(v1.liberados, { "site:L": AGORA });
    assert.equal(liberar(v1, "site:L", AGORA + 60_000), v1, "a segunda vez devolve o mesmo dia");
    assert.deepEqual(liberar(v1, "prumo:P", AGORA + 1).liberados, { "site:L": AGORA, "prumo:P": AGORA + 1 });
    assert.throws(() => liberar(v1, "", AGORA));
    assert.throws(() => liberar(v1, "x".repeat(301), AGORA));
  });

  it("liberar grava no arquivo e vira o dia sozinho (diretório temporário)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "squadone-liberar-"));
    let agora = AGORA;
    try {
      const memoria = criarMemoriaDaVenda(join(dir, "venda-do-dia.json"), () => agora);
      await Promise.all([memoria.liberar("site:L"), memoria.liberar("site:M"), memoria.liberar("site:L")]);
      assert.deepEqual(Object.keys((await memoria.ler()).liberados).sort(), ["site:L", "site:M"]);
      agora = Date.parse("2026-10-17T03:30:00Z"); // 00:30 de SP do dia seguinte
      assert.deepEqual((await memoria.ler()).liberados, {});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("grava e relê do arquivo, em diretório temporário; a anotação concorrente sai uma vez", async () => {
    const dir = await mkdtemp(join(tmpdir(), "squadone-venda-"));
    try {
      const memoria = criarMemoriaDaVenda(join(dir, "venda-do-dia.json"), () => AGORA);
      await Promise.all([memoria.resolver("a|responder", "enviada", "central"), memoria.resolver("b|primeiro", "pulada", "telegram")]);
      assert.deepEqual(Object.keys((await memoria.ler()).resolvidas).sort(), ["a|responder", "b|primeiro"]);
      let chamadas = 0;
      const registrar = async () => { chamadas++; await new Promise((r) => setTimeout(r, 5)); };
      const [r1, r2] = await Promise.all([
        memoria.anotarUmaVez("site:L|followup", "followup_enviado", "central", registrar),
        memoria.anotarUmaVez("site:L|followup", "followup_enviado", "telegram", registrar),
      ]);
      assert.equal(chamadas, 1, "Central e Telegram juntos anotam uma vez só");
      assert.deepEqual([r1.anotou, r2.anotou], [true, false]);
      // Falhou o registro: nada é marcado, o próximo toque tenta de novo.
      await assert.rejects(memoria.anotarUmaVez("site:M|followup", "followup_enviado", "central", async () => { throw new Error("n8n fora"); }));
      assert.equal(jaAnotada(await memoria.ler(), "site:M|followup", "followup_enviado"), false);
      await memoria.primeiroContato("site:L", "central");
      assert.deepEqual((await memoria.ler()).primeiros, { "site:L": { em: AGORA, por: "central" } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// AC-06 (17/10/2026): a trava de ritmo conta o retrato mais os primeiros das duas superfícies.
describe("ritmo somando a Central e o Telegram", () => {
  const T = Date.parse("2026-10-16T15:00:00Z");
  const min = 60_000;
  const lead = (id: string, enviado?: number) => ({ id, sinal: "enviado" as const, marcos: enviado ? { enviado: new Date(enviado).toISOString() } : {} });

  it("um lead por vez, o toque mais antigo; formatos crus e do servidor", () => {
    const casos: Array<{ fontes: Parameters<typeof somarPrimeiros>; esperado: Record<string, number> }> = [
      { fontes: [null, undefined], esperado: {} },
      { fontes: [{ a: { em: 5 } }, { a: 3 }], esperado: { a: 3 } },
      { fontes: [{ a: { em: 5 } }, { b: 7 }], esperado: { a: 5, b: 7 } },
      { fontes: [{ a: { em: Number.NaN } }, { "": 1 }], esperado: {} },
    ];
    for (const c of casos) assert.deepEqual(somarPrimeiros(...c.fontes), c.esperado, JSON.stringify(c.fontes));
  });

  it("as duas origens somam para o teto, sem contar duas vezes o mesmo lead", () => {
    const casos: Array<{ nome: string; servidor: Record<string, { em: number }>; local: Record<string, number>; leads: ReturnType<typeof lead>[]; enviadosHoje: number }> = [
      { nome: "só a Central", servidor: { "site:A": { em: T - 30 * min } }, local: {}, leads: [], enviadosHoje: 1 },
      { nome: "Central e Telegram, leads diferentes", servidor: { "site:A": { em: T - 30 * min }, "site:B": { em: T - 20 * min } }, local: {}, leads: [], enviadosHoje: 2 },
      { nome: "o mesmo lead no servidor e no reforço local", servidor: { "site:A": { em: T - 30 * min } }, local: { "site:A": T - 29 * min }, leads: [], enviadosHoje: 1 },
      { nome: "o retrato já viu o toque (a menos de 15 min)", servidor: { "site:A": { em: T - 30 * min } }, local: {}, leads: [lead("site:A", T - 25 * min)], enviadosHoje: 1 },
      { nome: "reforço local que o servidor ainda não tem", servidor: { "site:A": { em: T - 30 * min } }, local: { "site:B": T - 10 * min }, leads: [], enviadosHoje: 2 },
    ];
    for (const c of casos) {
      const r = ritmoDoEnvio(instantesDePrimeiroContato(c.leads, somarPrimeiros(c.servidor, c.local)), T);
      assert.equal(r.enviadosHoje, c.enviadosHoje, c.nome);
    }
  });

  it("19 da Central + 1 do Telegram: o teto do dia (20) segura nas duas superfícies", () => {
    const inicio = Date.parse("2026-10-19T08:00:00-03:00");
    const agora = Date.parse("2026-10-19T18:00:00-03:00");
    const daCentral = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`site:${i}`, { em: inicio + i * 30 * min }]));
    // Separadas, as duas superfícies ainda teriam cota; a soma barra o próximo contato.
    assert.equal(ritmoDoEnvio(instantesDePrimeiroContato([], somarPrimeiros(daCentral)), agora).motivo, null);
    assert.equal(ritmoDoEnvio(instantesDePrimeiroContato([], somarPrimeiros(daCentral, { "site:tg": inicio + 19 * 30 * min })), agora).motivo, "dia");
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
