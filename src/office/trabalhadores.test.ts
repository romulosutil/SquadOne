/**
 * Catálogo dos trabalhadores automáticos: nasce dos passos de "Como funciona"
 * (fluxos.ts), a ligação de cada um à sala é uma decisão (tabela abaixo), e
 * nada do servidor importa nem o catálogo nem os fluxos — é o que garante que
 * ele fica fora do prompt (RULES 26).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FLUXOS, fluxoDoEndereco } from "../operations/fluxos.ts";
import { TRABALHADORES, linkDoComoFunciona, trabalhadoresDaSala, trabalhadoresDosFluxos } from "./trabalhadores.ts";

describe("catálogo dos trabalhadores automáticos", () => {
  it("cada trabalhador na sala decidida (quem trabalha, não a etapa do funil)", () => {
    const salaDe = Object.fromEntries(TRABALHADORES.map((t) => [t.nome, t.sala]));
    assert.deepEqual(salaDe, {
      Caçador: "prumo--prospeccao",
      Gerador: "prumo--site-antes-da-venda",
      Balcão: "prumo--geral",
      "Observador do WhatsApp": "prumo--geral",
      Acompanhamento: "prumo--geral",
      "Funil por nicho": "prumo--prospeccao",
      Diagnóstico: "prumo--organizar",
      "Rascunho do Mapa": "prumo--organizar",
      "Caçador de clínicas": "prumo--iris",
      "Caçador de estamparias": "prumo--estamparias",
      "Retrato das planilhas": "prumo--geral",
    });
  });

  it("deriva dos passos: quando, verificação, fluxo e índice são os do passo", () => {
    for (const t of TRABALHADORES) {
      const passo = FLUXOS.find((f) => f.id === t.fluxo)?.passos[t.passo];
      assert.ok(passo?.trabalhador, `${t.id}: o passo ${t.fluxo}[${t.passo}] não tem trabalhador`);
      assert.equal(passo.trabalhador.id, t.id);
      assert.equal(t.quando, passo.quando);
      assert.equal(t.verificacao, passo.verificacao);
    }
    const sem = trabalhadoresDosFluxos([{ id: "x", grupo: "g", nome: "n", frase: "f", passos: [{ titulo: "t", texto: "t", onde: "voce", quando: "já" }] }]);
    assert.deepEqual(sem, []);
  });

  it("ids únicos e campos preenchidos", () => {
    assert.equal(new Set(TRABALHADORES.map((t) => t.id)).size, TRABALHADORES.length);
    for (const t of TRABALHADORES) {
      for (const campo of ["id", "nome", "sala", "faz", "onde", "quando"] as const) {
        assert.ok(t[campo].trim(), `${t.id}.${campo} vazio`);
      }
    }
  });

  it("todo trabalhador tem verificação viva (perder uma por engano quebra aqui)", () => {
    assert.deepEqual(TRABALHADORES.filter((t) => !t.verificacao).map((t) => t.id), []);
  });

  it("o Plus está em Como funciona, sem trabalhador: não há robô, o catálogo é importado à mão", () => {
    const plus = FLUXOS.find((f) => f.id === "plus");
    assert.ok(plus, "falta o fluxo do Plus");
    assert.ok(plus.passos.every((p) => !p.trabalhador));
  });

  it("trabalhadoresDaSala filtra pelo id; sala sem ninguém ou desconhecida = lista vazia", () => {
    // O Lead Scout saiu em 08/10/2026 (desligado no n8n): fluxo inativo não aparece como trabalhador.
    assert.deepEqual(trabalhadoresDaSala("prumo--prospeccao").map((t) => t.nome), ["Caçador", "Funil por nicho"]);
    assert.deepEqual(trabalhadoresDaSala("prumo--organizar").map((t) => t.nome), ["Diagnóstico", "Rascunho do Mapa"]);
    assert.deepEqual(trabalhadoresDaSala("prumo--iris").map((t) => t.nome), ["Caçador de clínicas"]);
    assert.deepEqual(trabalhadoresDaSala("geral"), []);
    assert.deepEqual(trabalhadoresDaSala("nao-existe"), []);
  });

  it("o link leva ao fluxo e ao passo dele em Como funciona", () => {
    const cacador = TRABALHADORES.find((t) => t.id === "cacador-iris")!;
    assert.equal(linkDoComoFunciona(cacador), `/mais?fluxo=iris&passo=${cacador.passo}#como-title`);
  });

  it("Como funciona lê o fluxo e o passo do endereço (o link do robô)", () => {
    const cacador = TRABALHADORES.find((t) => t.id === "cacador-iris")!;
    const busca = new URL(linkDoComoFunciona(cacador), "https://x.invalid").search;
    assert.deepEqual(fluxoDoEndereco(busca), { fluxo: "iris", passo: cacador.passo });
    assert.deepEqual(fluxoDoEndereco("?fluxo=iris&passo=99"), { fluxo: "iris", passo: null });
    assert.deepEqual(fluxoDoEndereco("?fluxo=iris&passo=-1"), { fluxo: "iris", passo: null });
    assert.deepEqual(fluxoDoEndereco("?fluxo=iris"), { fluxo: "iris", passo: null });
    assert.equal(fluxoDoEndereco("?fluxo=nao-existe&passo=0"), null);
    assert.equal(fluxoDoEndereco(""), null);
  });

  it("fora do prompt: nenhum módulo do servidor importa o catálogo, os fluxos nem a operação das salas", () => {
    const dir = new URL("../../server/", import.meta.url);
    const fontes = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    assert.ok(fontes.includes("orchestrator.ts"), "achou o servidor");
    const arquivos = [...fontes.map((f) => new URL(f.replaceAll("\\", "/"), dir)), new URL("../../server.ts", import.meta.url)];
    for (const arquivo of arquivos) {
      const texto = readFileSync(arquivo, "utf8");
      assert.ok(!/office\/(trabalhadores|operacao)|operations\/fluxos/.test(texto), `${arquivo.pathname} importa o catálogo`);
    }
  });
});
