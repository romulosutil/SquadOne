import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { corpoDoBloco, variaveisDefinidas, variaveisUsadas } from "../src/blueprint/tokens.ts";

/*
 * A Entrada da Mel (deploy/dell/entrada/pagina.html) é servida por outro processo, com CSP default-src 'none',
 * e não consegue ler o CSS do app: copia os tokens de src/estilos/tokens.css. Sem este teste a cópia envelhece
 * calada e a Entrada volta a ter "outro design system" (queixa de 16/10/2026).
 */
const pagina = readFileSync(new URL("../deploy/dell/entrada/pagina.html", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/estilos/tokens.css", import.meta.url), "utf8");
const estilo = pagina.match(/<style nonce="__NONCE__">([\s\S]*?)<\/style>/)?.[1] ?? "";

const ESCURO = ':root:not([data-theme="light"])';

function declaracoes(corpo: string): Map<string, string> {
  const semComentario = corpo.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Map([...semComentario.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].replace(/\s+/g, " ").trim()]));
}

const appClaro = declaracoes(corpoDoBloco(tokens, ":root"));
const appEscuro = declaracoes(corpoDoBloco(tokens, ESCURO));
const pagClaro = declaracoes(corpoDoBloco(estilo, ":root"));
const pagEscuro = declaracoes(corpoDoBloco(estilo, ESCURO));

test("a página tem os blocos de token claro e escuro", () => {
  assert.ok(pagClaro.size > 20, "bloco :root da página");
  assert.ok(pagEscuro.size > 5, `bloco ${ESCURO} da página`);
});

test("cada token claro da página tem o mesmo valor que em tokens.css", () => {
  for (const [nome, valor] of pagClaro) {
    assert.ok(appClaro.has(nome), `${nome} não existe mais em tokens.css`);
    assert.equal(valor, appClaro.get(nome), `${nome} divergiu de tokens.css`);
  }
});

test("cada token escuro da página bate com tokens.css, e nenhum que muda no escuro ficou de fora", () => {
  for (const [nome, valor] of pagEscuro) {
    assert.ok(appEscuro.has(nome), `${nome} não muda no escuro em tokens.css`);
    assert.equal(valor, appEscuro.get(nome), `${nome} (escuro) divergiu de tokens.css`);
  }
  for (const nome of pagClaro.keys()) {
    if (appEscuro.has(nome)) assert.ok(pagEscuro.has(nome), `${nome} muda no escuro no app e não na página`);
  }
});

test("a página só usa token que ela mesma define", () => {
  const definidas = variaveisDefinidas(estilo);
  for (const nome of variaveisUsadas(estilo)) assert.ok(definidas.has(nome), `var(${nome}) sem definição na página`);
});

test("a fonte é a Inter servida pela própria Entrada (a CSP não deixa outra)", () => {
  assert.match(estilo, /font-family:\s*"Inter"/);
  assert.match(estilo, /src:\s*url\("inter\.woff2"\)/);
});
