import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { artigoDe, followupDe, segundaDe, type LeadDaMensagem } from "./site-mensagem.ts";

// A fonte é o JS que o n8n usa: roda ele aqui, numa caixa sem nada, e compara.
// Mudou um texto ou a lista de femininos lá, este teste falha até o espelho mudar junto.
const codigo = fs.readFileSync(path.join(import.meta.dirname, "..", "deploy", "dell", "claude-ops", "site-mensagem.js"), "utf8");
const doN8n = vm.runInNewContext(`${codigo}\n;({ followupDe, segundaDe, artigoDe })`, {}) as {
  followupDe: (l: Record<string, string>) => { numero: string; texto: string; link: string };
  segundaDe: (l: Record<string, string>) => { numero: string; texto: string; link: string };
  artigoDe: (nome: string) => string;
};

const linhaDoN8n = (l: LeadDaMensagem) => ({ nome: l.nome, site_url: l.siteUrl, wa_me: l.waMe });
// Objeto de outro contexto do vm tem outro Object.prototype: compara pelo conteúdo.
const simples = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const CASOS: Array<[string, LeadDaMensagem]> = [
  ["feminino, primeira mensagem sem link (desde 05/10)", { nome: "Dedetizadora Alfa", siteUrl: "https://demo-alfa.vercel.app", waMe: "https://wa.me/5527999990001?text=Oi%2C%20tudo%20bem%3F" }],
  ["masculino com acento no nome", { nome: "Escritório Silva & Prado", siteUrl: "https://demo-silva.vercel.app", waMe: "https://wa.me/5527999990002?text=oi" }],
  ["primeira mensagem já com o link (antes de 05/10)", { nome: "Pousada do Mar", siteUrl: "https://demo-mar.vercel.app",
    waMe: `https://wa.me/5512999990003?text=${encodeURIComponent("Oi! Montei https://demo-mar.vercel.app para vocês")}` }],
  ["número dos EUA", { nome: "Latin Dental", siteUrl: "https://demo-latin.vercel.app", waMe: "https://wa.me/13055550100?text=hi" }],
  ["sem número no wa_me", { nome: "Sem Número", siteUrl: "https://demo-x.vercel.app", waMe: "" }],
];

describe("site-mensagem: espelho do JS do n8n", () => {
  for (const [nome, lead] of CASOS) {
    it(`follow-up e segunda iguais aos do n8n: ${nome}`, () => {
      assert.deepEqual(followupDe(lead), simples(doN8n.followupDe(linhaDoN8n(lead))));
      assert.deepEqual(segundaDe(lead), simples(doN8n.segundaDe(linhaDoN8n(lead))));
    });
  }

  it("artigo: a mesma lista de femininos do JS", () => {
    for (const nome of ["Clínica Bem", "Academia X", "Locação Y", "Advocacia Z", "Escritório W", "Buffet Q", "Pousada P", ""]) {
      assert.equal(artigoDe(nome), doN8n.artigoDe(nome), nome);
    }
  });

  it("o follow-up de quem não recebeu o link pede licença; o de quem recebeu lembra o link", () => {
    assert.match(followupDe(CASOS[0][1]).texto, /^Oi, tudo bem\? Aqui é o Rômulo de novo\. Montei uma demonstração de site da Dedetizadora Alfa/);
    assert.match(followupDe(CASOS[2][1]).texto, /Deu tempo de ver a demonstração de site da Pousada do Mar\?\nhttps:\/\/demo-mar\.vercel\.app/);
    assert.match(followupDe(CASOS[3][1]).texto, /^Hi! It's Rômulo again\./);
    assert.equal(followupDe(CASOS[4][1]).link, "");
  });
});
