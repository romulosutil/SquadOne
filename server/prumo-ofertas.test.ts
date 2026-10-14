import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { COLUNAS_DO_PRUMO, OFERTA_DE_PROSPECCAO, etapaDoPrumo, normalizarCabecalho } from "./crm.ts";

// Contrato entre deploy/dell/claude-ops/prumo-ofertas.json (o que o n8n grava nas abas Clínicas e
// Estamparias) e server/crm.ts (o que o CRM lê delas). Quebrar um lado sem o outro deixaria a oferta
// muda no funil: a coluna some calada e o lead fica parado em "Novo".
const CONFIG = JSON.parse(fs.readFileSync(new URL("../deploy/dell/claude-ops/prumo-ofertas.json", import.meta.url), "utf8")) as {
  colunas: string[];
  ocultas: string[];
  etapas: string[];
  ofertas: Record<string, { aba: string; convite: string; mensagem: string; nichos: string[]; cidades: string[]; sinais: [string, string][]; segmento: string; fora: string }>;
};

describe("prumo-ofertas.json × CRM", () => {
  it("as ofertas são as do CRM, com a mesma aba e o mesmo caminho do convite", () => {
    assert.deepEqual(Object.keys(CONFIG.ofertas).sort(), ["estampa", "iris"]);
    for (const [id, o] of Object.entries(CONFIG.ofertas)) {
      const doCrm = OFERTA_DE_PROSPECCAO[id as "iris" | "estampa"];
      assert.equal(o.aba, doCrm.aba, id);
      assert.equal(o.convite, doCrm.convite, id);
    }
  });

  it("o cabeçalho das abas tem toda coluna que o CRM usa para etapa, contato e resposta", () => {
    const cabecalho = new Set(CONFIG.colunas.map(normalizarCabecalho));
    const usadas = ["id", "empresa", "nicho", "cidade", "etapa", "site", "whatsapp", "proximaAcao", "encontradoEm", "conviteEm",
      "respondeuEm", "respostaTipo", "respostaTrecho", "respostaEm"] as const;
    for (const campo of usadas) {
      assert.ok(COLUNAS_DO_PRUMO[campo].nomes.some((n) => cabecalho.has(n)), `falta a coluna de ${campo} (${COLUNAS_DO_PRUMO[campo].nomes[0]})`);
    }
    for (const oculta of CONFIG.ocultas) assert.ok(CONFIG.colunas.includes(oculta), oculta);
  });

  it("toda etapa da lista da planilha tem lugar no funil (nenhuma cai em 'sem etapa')", () => {
    const esperado: Record<string, string> = {
      Revisar: "novo/revisar", "Convite enviado": "contato/convite", "Em conversa": "contato/respondeu-prumo",
      "Concluído": "ganho/concluido", "Sem interesse": "perdido/sem-interesse",
    };
    assert.deepEqual(CONFIG.etapas, Object.keys(esperado));
    for (const etapa of CONFIG.etapas) {
      const r = etapaDoPrumo({ etapa });
      assert.equal(`${r.etapa}/${r.sinal}`, esperado[etapa], etapa);
    }
  });

  it("o convite segue as regras do PRUMO: voz da empresa, sem nome, sem preço, sem link, uma pergunta", () => {
    for (const [id, o] of Object.entries(CONFIG.ofertas)) {
      assert.ok(o.mensagem.startsWith("{OLA}! Aqui é do Prumo."), id);
      assert.ok(o.mensagem.includes("{NOME}"), id);
      assert.doesNotMatch(o.mensagem, /R\$|r[oô]mulo|fundador|desconto|gr[aá]tis|https?:|www\./i, id);
      assert.equal((o.mensagem.match(/\?/g) ?? []).length, 1, `${id}: uma pergunta só`);
    }
  });

  it("buscas e padrões são válidos", () => {
    for (const [id, o] of Object.entries(CONFIG.ofertas)) {
      assert.ok(o.nichos.length && o.cidades.length, id);
      for (const fonte of [o.segmento, o.fora, ...o.sinais.map(([, s]) => s)]) assert.doesNotThrow(() => new RegExp(fonte, "i"), `${id}: ${fonte}`);
    }
  });
});
