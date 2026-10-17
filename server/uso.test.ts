import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  arquivosParaPodar,
  CHAVE_DE_SOBRA,
  criarContadorDeUso,
  diaEmSaoPaulo,
  MAX_CHAVES_POR_DIA,
  normalizarChamada,
  normalizarTela,
  somar,
  telaDoCorpo,
  ultimosDias,
  usoLido,
} from "./uso.ts";

// AC-28 (17/10/2026): o contador de uso da Central nunca guarda id, telefone, texto nem valor.
describe("uso: tela da SPA", () => {
  const casos: Array<[string, string]> = [
    ["/", "/"],
    ["/?auth=ok", "/"],
    ["/crm", "/crm"],
    ["/crm/", "/crm"],
    ["/crm?ver=funil", "/crm?ver=funil"],
    ["/crm?ver=triagem", "/crm?ver=triagem"],
    ["/crm?ver=numeros", "/crm?ver=numeros"],
    ["/crm?ver=resultados", "/crm?ver=numeros"],
    ["/crm?ver=roteiro", "/crm?ver=roteiro"],
    ["/crm?ver=colinha", "/crm?ver=roteiro"],
    ["/crm?ver=jornada&produto=prumo", "/crm?ver=jornada&produto=prumo"],
    ["/crm?ver=inventada&produto=hackeado", "/crm"],
    // O id do lead (place_id, chave da planilha ou telefone) some: só fica que a ficha estava aberta.
    ["/crm?lead=ChIJN1t_tDeuEmsRUsoyG83frY4", "/crm (ficha)"],
    ["/crm?ver=funil&produto=site&lead=5527999762786", "/crm?ver=funil&produto=site (ficha)"],
    ["/crm?lead=1&telefone=27999762786&q=Silmer", "/crm (ficha)"],
    // Das finanças, só o caminho: mês, visão e busca ficam de fora.
    ["/financas?mes=2026-09&visao=caixa", "/financas"],
    ["/financas/lancamentos?busca=farmacia&valor=123", "/financas/lancamentos"],
    ["/financas/organizar", "/financas/organizar"],
    ["/financas/123", "/financas/(outra)"],
    ["/mais", "/mais"],
    ["/agenda", "/agenda"],
    ["/squadone", "/squadone"],
    ["/squadone/sala/prumo--geral", "/squadone"],
    ["/design-system", "/design-system"],
    ["/leads/27999762786", "(outra)"],
    ["//evil.example/crm", "(outra)"],
  ];
  for (const [rota, esperado] of casos) {
    it(`${rota} -> ${esperado}`, () => assert.equal(normalizarTela(rota), esperado));
  }

  it("o corpo do beacon: texto ou objeto; o resto é recusado", () => {
    assert.equal(telaDoCorpo(JSON.stringify({ rota: "/crm?ver=funil&lead=1" })), "/crm?ver=funil (ficha)");
    assert.equal(telaDoCorpo({ rota: "/mais" }), "/mais");
    assert.equal(telaDoCorpo("não é json"), null);
    assert.equal(telaDoCorpo(JSON.stringify({ rota: "https://outro.example/" })), null);
    assert.equal(telaDoCorpo(JSON.stringify({ rota: 3 })), null);
    assert.equal(telaDoCorpo(JSON.stringify([{ rota: "/" }])), null);
    assert.equal(telaDoCorpo(JSON.stringify({ rota: `/${"a".repeat(400)}` })), null);
    assert.equal(telaDoCorpo("x".repeat(2000)), null);
  });
});

describe("uso: escrita da API", () => {
  const casos: Array<[string, string, string | undefined, string | null]> = [
    ["POST", "/api/operations/crm/registro", undefined, "POST /api/operations/crm/registro"],
    ["POST", "/api/operations/crm/venda?x=1", undefined, "POST /api/operations/crm/venda"],
    ["POST", "/api/operations/crm/copiloto/sugestao", undefined, "POST /api/operations/crm/copiloto/sugestao"],
    ["POST", "/api/orquestrar", undefined, "POST /api/orquestrar"],
    // Com o modelo da rota do Express, o id nem chega aqui.
    ["PATCH", "/api/financas/lancamentos/8f3a-99", "/api/financas/lancamentos/:id", "PATCH /api/financas/lancamentos/:id"],
    // Sem o modelo, a peneira tira ids, números e telefones.
    ["PATCH", "/api/financas/lancamentos/abc", undefined, "PATCH /api/financas/lancamentos/:id"],
    ["POST", "/api/squad/pessoas/romulo/arquivar", undefined, "POST /api/squad/pessoas/:id/arquivar"],
    ["POST", "/api/quests/evt_ABC123/ajustar", undefined, "POST /api/quests/:id/ajustar"],
    ["POST", "/api/turnos/:turnoId/avaliacao", undefined, "POST /api/turnos/:id/avaliacao"],
    ["POST", "/api/coisa/27999762786", undefined, "POST /api/coisa/:id"],
    ["PUT", "/api/financas/orcamento", undefined, "PUT /api/financas/orcamento"],
    ["delete", "/api/operations/projects/x1", undefined, "DELETE /api/operations/projects/:id"],
    ["GET", "/api/operations/crm", undefined, null],
    ["POST", "/entrada/api/enviar", undefined, null],
    ["POST", "/api/operations/uso", undefined, null],
  ];
  for (const [metodo, caminho, modelo, esperado] of casos) {
    it(`${metodo} ${caminho} -> ${esperado}`, () => assert.equal(normalizarChamada(metodo, caminho, modelo), esperado));
  }
});

describe("uso: agregado por dia", () => {
  it("vira o dia na meia-noite de São Paulo, não na de UTC", () => {
    assert.equal(diaEmSaoPaulo(Date.parse("2026-10-17T02:59:59Z")), "2026-10-16");
    assert.equal(diaEmSaoPaulo(Date.parse("2026-10-17T03:00:00Z")), "2026-10-17");
    assert.equal(diaEmSaoPaulo(Date.parse("2026-12-31T23:30:00Z")), "2026-12-31");
  });

  it("soma por chave e põe o excedente em (outras)", () => {
    let uso = usoLido(null, "2026-10-17");
    uso = somar(uso, { tipo: "tela", chave: "/crm" });
    uso = somar(uso, { tipo: "tela", chave: "/crm" });
    uso = somar(uso, { tipo: "escrita", chave: "POST /api/orquestrar" });
    assert.deepEqual(uso, { dia: "2026-10-17", telas: { "/crm": 2 }, escritas: { "POST /api/orquestrar": 1 } });
    for (let i = 0; i < MAX_CHAVES_POR_DIA + 5; i++) uso = somar(uso, { tipo: "tela", chave: `/t${i}` });
    assert.equal(Object.keys(uso.telas).length, MAX_CHAVES_POR_DIA + 1);
    assert.equal(uso.telas[CHAVE_DE_SOBRA], 6);
    // Chave que já existe continua somando mesmo com o teto cheio.
    uso = somar(uso, { tipo: "tela", chave: "/crm" });
    assert.equal(uso.telas["/crm"], 3);
  });

  it("lixo do disco vira um dia vazio", () => {
    assert.deepEqual(usoLido({ telas: { "/": 2, x: "3", y: -1 }, escritas: null }, "2026-10-17"), { dia: "2026-10-17", telas: { "/": 2 }, escritas: {} });
  });

  it("poda: fica a janela de 90 dias contando hoje; só arquivos de dia", () => {
    const nomes = ["2026-07-19.json", "2026-07-20.json", "2026-10-17.json", "2026-07-19.json.tmp", "outro.json"];
    assert.deepEqual(arquivosParaPodar(nomes, "2026-10-17"), ["2026-07-19.json"]);
    assert.equal(ultimosDias("2026-10-17", 90).at(-1), "2026-07-20");
    assert.deepEqual(ultimosDias("2026-03-01", 2), ["2026-03-01", "2026-02-28"]);
  });

  it("grava junto (debounce), soma no arquivo e poda ao subir, em diretório temporário", async () => {
    const raiz = await mkdtemp(join(tmpdir(), "squadone-uso-"));
    const dir = join(raiz, "uso");
    let agora = Date.parse("2026-10-17T02:59:00Z");
    const contador = criarContadorDeUso({ dir, agora: () => agora, atrasoMs: 60_000 });
    await contador.iniciar();
    await writeFile(join(dir, "2026-07-01.json"), "{}");
    await contador.iniciar();
    assert.deepEqual(await readdir(dir), []);

    contador.contarTela("/crm");
    agora = Date.parse("2026-10-17T03:01:00Z");
    contador.contarTela("/crm");
    contador.contarEscrita("POST /api/orquestrar");
    // Antes de gravar, a leitura já vê o que está na memória.
    const [hoje, ontem] = await contador.ler(2);
    assert.deepEqual(hoje, { dia: "2026-10-17", telas: { "/crm": 1 }, escritas: { "POST /api/orquestrar": 1 } });
    assert.deepEqual(ontem, { dia: "2026-10-16", telas: { "/crm": 1 }, escritas: {} });

    await contador.gravar();
    contador.contarTela("/crm");
    await contador.gravar();
    const doDisco = JSON.parse(await readFile(join(dir, "2026-10-17.json"), "utf8"));
    assert.deepEqual(doDisco.telas, { "/crm": 2 });
    if (process.platform !== "win32") {
      assert.equal((await stat(join(dir, "2026-10-17.json"))).mode & 0o777, 0o600);
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
    }
    await rm(raiz, { recursive: true, force: true });
  });
});
