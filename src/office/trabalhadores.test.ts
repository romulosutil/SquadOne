/**
 * Catálogo dos trabalhadores automáticos: a ligação de cada um à sala é uma
 * decisão (tabela abaixo), cada um aponta para um passo vivo de "Como funciona",
 * e nada do servidor o importa — é o que garante que ele fica fora do prompt.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FLUXOS } from "../operations/fluxos.ts";
import { TRABALHADORES, trabalhadoresDaSala } from "./trabalhadores.ts";

describe("catálogo dos trabalhadores automáticos", () => {
  it("cada trabalhador na sala decidida (quem trabalha, não a etapa do funil)", () => {
    const salaDe = Object.fromEntries(TRABALHADORES.map((t) => [t.nome, t.sala]));
    assert.deepEqual(salaDe, {
      Caçador: "prumo--prospeccao",
      Gerador: "prumo--site-antes-da-venda",
      Balcão: "prumo--geral",
      Diagnóstico: "prumo--organizar",
      "Rascunho do Mapa": "prumo--organizar",
    });
  });

  it("ids únicos e campos preenchidos", () => {
    assert.equal(new Set(TRABALHADORES.map((t) => t.id)).size, TRABALHADORES.length);
    for (const t of TRABALHADORES) {
      for (const campo of ["id", "nome", "sala", "faz", "onde", "quando"] as const) {
        assert.ok(t[campo].trim(), `${t.id}.${campo} vazio`);
      }
      if (t.verificacao !== undefined) assert.ok(t.verificacao.trim(), `${t.id}.verificacao vazia`);
    }
  });

  it("cada verificação existe num passo de fluxos.ts (catálogo e Como funciona não divergem)", () => {
    const vivas = new Set(FLUXOS.flatMap((f) => f.passos.map((p) => p.verificacao)).filter(Boolean));
    for (const t of TRABALHADORES) {
      if (t.verificacao) assert.ok(vivas.has(t.verificacao), `${t.nome}: '${t.verificacao}' não está em fluxos.ts`);
    }
  });

  it("sem verificação viva só quem o monitor do Dell não confere (hoje ninguém; perder uma por engano quebra aqui)", () => {
    assert.deepEqual(TRABALHADORES.filter((t) => !t.verificacao).map((t) => t.id), []);
  });

  it("trabalhadoresDaSala filtra pelo id; sala sem ninguém ou desconhecida = lista vazia", () => {
    // O Lead Scout saiu em 08/10/2026 (desligado no n8n): fluxo inativo não aparece como trabalhador.
    assert.deepEqual(trabalhadoresDaSala("prumo--prospeccao").map((t) => t.nome), ["Caçador"]);
    assert.deepEqual(trabalhadoresDaSala("prumo--organizar").map((t) => t.nome), ["Diagnóstico", "Rascunho do Mapa"]);
    assert.deepEqual(trabalhadoresDaSala("geral"), []);
    assert.deepEqual(trabalhadoresDaSala("nao-existe"), []);
  });

  it("fora do prompt: nenhum módulo do servidor importa o catálogo", () => {
    const dir = new URL("../../server/", import.meta.url);
    const fontes = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    assert.ok(fontes.includes("orchestrator.ts"), "achou o servidor");
    const arquivos = [...fontes.map((f) => new URL(f.replaceAll("\\", "/"), dir)), new URL("../../server.ts", import.meta.url)];
    for (const arquivo of arquivos) {
      assert.ok(!/office\/trabalhadores/.test(readFileSync(arquivo, "utf8")), `${arquivo.pathname} importa o catálogo`);
    }
  });
});
