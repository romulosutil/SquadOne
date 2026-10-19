import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { nomeDaEmpresa } from "./prumo-mensagem.ts";

// A limpeza do nome da empresa nos convites do n8n (PRUMO, Iris e estamparia) e a do CRM (nomeDaEmpresa,
// server/prumo-mensagem.ts) são a mesma regra escrita duas vezes. A fonte do n8n é UM arquivo,
// claude-ops/prumo-nome.js, embutido por prumo-simples.py e prumo-ofertas.py: roda ele aqui, numa caixa sem
// nada, e compara com o TS numa tabela. Mudou uma regra: este teste falha até as duas mudarem juntas.
// (Até 19/10/2026 o JS só virava Title Case com 4+ maiúsculas seguidas e o TS também com tudo minúsculo.)
const CLAUDE_OPS = path.join(import.meta.dirname, "..", "deploy", "dell", "claude-ops");
const doN8n = vm.runInNewContext(`${fs.readFileSync(path.join(CLAUDE_OPS, "prumo-nome.js"), "utf8")}\n;nomeDaEmpresa`, {}) as (bruto: unknown) => string;

const CASOS: Array<[string, string]> = [
  ["tudo em maiúsculas, com Ltda", "CACAU PEÇAS PARA MOTORES LTDA"],
  ["tudo em minúsculas", "roda mais distribuidora"],
  ["minúsculas com preposição", "casa das tintas e ferragens"],
  ["já em Title Case", "Roda Mais Distribuidora"],
  ["Title Case com Ltda", "Distribuidora Boa Vista Ltda"],
  ["sigla curta em maiúsculas (menos de 4 letras seguidas)", "ABC"],
  ["maiúsculas com 3 letras e preposição", "JM DE SOUZA"],
  ["mistura que não é caixa alta nem baixa", "iPhone Center"],
  ["ME com ponto e vírgula", "Mercadinho do Zé, ME."],
  ["EPP", "Comercial Alfa EPP"],
  ["EIRELI em minúsculas", "alfa comercio eireli"],
  ["S/A", "Beta Atacado S/A"],
  ["S.A.", "BETA ATACADO S.A."],
  ["dois sufixos seguidos", "Gama Foods Ltda ME"],
  ["traço antes do sufixo", "Delta - Ltda"],
  ["acento e cedilha em maiúsculas", "AÇOUGUE SÃO JOÃO"],
  ["espaços nas pontas", "   Ômega Pneus   "],
  ["só dígitos", "123"],
  ["vazio", ""],
  ["só espaços", "   "],
];

describe("prumo-nome.js (n8n) × nomeDaEmpresa (CRM)", () => {
  for (const [nome, bruto] of CASOS) {
    it(`igual nos dois: ${nome}`, () => {
      assert.equal(doN8n(bruto), nomeDaEmpresa(bruto), JSON.stringify(bruto));
    });
  }

  it("a tabela cobre a diferença que existia (minúsculas e sigla curta)", () => {
    assert.equal(nomeDaEmpresa("roda mais distribuidora"), "Roda Mais Distribuidora");
    assert.equal(doN8n("roda mais distribuidora"), "Roda Mais Distribuidora");
    assert.equal(doN8n("ABC"), "Abc");
  });

  it("undefined e null viram texto vazio no n8n (a linha da planilha pode vir sem Empresa)", () => {
    assert.equal(doN8n(undefined), "");
    assert.equal(doN8n(null), "");
  });

  it("os construtores embutem o arquivo e não guardam cópia da regra", () => {
    for (const arquivo of ["prumo-simples.py", "prumo-ofertas.py"]) {
      const fonte = fs.readFileSync(path.join(CLAUDE_OPS, arquivo), "utf8");
      assert.match(fonte, /prumo-nome\.js/, `${arquivo} deve ler prumo-nome.js`);
      assert.match(fonte, /nomeDaEmpresa\(/, `${arquivo} deve chamar nomeDaEmpresa`);
      assert.doesNotMatch(fonte, /ltda\|me\|epp\|eireli\|s\\\\\./, `${arquivo} guarda uma cópia do regex do sufixo`);
      assert.doesNotMatch(fonte, /toUpperCase\(\) &&/, `${arquivo} guarda uma cópia do teste de caixa alta`);
    }
  });
});
