import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretarStatusDoDell } from "./dell-status.ts";

const agora = new Date("2026-09-23T14:00:00Z");

describe("interpretarStatusDoDell", () => {
  it("sem arquivo vira um aviso de monitor, não uma tela vazia", () => {
    const status = interpretarStatusDoDell(null, agora);
    assert.equal(status.geradoEm, null);
    assert.deepEqual(status.verificacoes.map((v) => [v.id, v.estado]), [["monitor", "atencao"]]);
  });

  it("retrato velho acusa o monitor parado antes de tudo", () => {
    const status = interpretarStatusDoDell({
      geradoEm: "2026-09-23T13:50:00Z",
      verificacoes: [{ id: "n8n", grupo: "servicos", nome: "n8n", estado: "ok", detalhe: "Respondendo" }],
    }, agora);
    assert.equal(status.verificacoes[0].id, "monitor");
    assert.equal(status.verificacoes[0].estado, "falha");
    assert.match(status.verificacoes[0].detalhe, /10 min/);
    assert.equal(status.verificacoes[1].id, "n8n");
  });

  it("descarta item ilegível e link que não é http", () => {
    const status = interpretarStatusDoDell({
      geradoEm: "2026-09-23T13:59:30Z",
      verificacoes: [
        { id: "a", grupo: "fluxos", nome: "A", estado: "quebrado", detalhe: "x" },
        { id: "b", grupo: "fluxos", nome: "B", estado: "falha", detalhe: "y", link: "javascript:alert(1)" },
        { id: "c", grupo: "dados", nome: "C", estado: "ok", detalhe: "z", link: "http://127.0.0.1:5679/workflow/1" },
        "lixo",
      ],
    }, agora);
    assert.deepEqual(status.verificacoes.map((v) => v.id), ["b", "c"]);
    assert.equal(status.verificacoes[0].link, undefined);
    assert.equal(status.verificacoes[1].link, "http://127.0.0.1:5679/workflow/1");
  });
});
