import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { artigoDe, followupDe, segundaDe, type LeadDaMensagem } from "./site-mensagem.ts";

// A fonte é o JS que o n8n usa: roda ele aqui, numa caixa sem nada, e compara.
// Mudou um texto ou a lista de femininos lá, este teste falha até o espelho mudar junto.
const codigo = fs.readFileSync(path.join(import.meta.dirname, "..", "deploy", "dell", "claude-ops", "site-mensagem.js"), "utf8");
const doN8n = vm.runInNewContext(`${codigo}\n;({ followupDe, segundaDe, artigoDe, varianteDe, preencher })`, {}) as {
  followupDe: (l: Record<string, string>) => { numero: string; texto: string; link: string };
  segundaDe: (l: Record<string, string>) => { numero: string; texto: string; link: string };
  artigoDe: (nome: string) => string;
  varianteDe: (placeId: string, eua: boolean, lead?: Record<string, unknown>) => { letra: string; molde: string };
  preencher: (molde: string, nome: string, url: string, detalhe: string) => string;
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
    assert.match(followupDe(CASOS[0][1]).texto, /^Oi, aqui é o Rômulo de novo, do PRUMO\. A demonstração de site da Dedetizadora Alfa ficou pronta/);
    assert.match(followupDe(CASOS[2][1]).texto, /Deu para ver o site da Pousada do Mar\?\nhttps:\/\/demo-mar\.vercel\.app\n\n/);
    assert.match(followupDe(CASOS[3][1]).texto, /^Hi, it's Rômulo again, from PRUMO\./);
    assert.equal(followupDe(CASOS[4][1]).link, "");
  });

  it("a segunda leva o preço e o pagar depois de ver; em inglês, sem preço", () => {
    const br = segundaDe(CASOS[0][1]).texto;
    assert.match(br, /^Aqui está: https:\/\/demo-alfa\.vercel\.app\n\n/);
    assert.match(br, /R\$ 990 e R\$ 69 por mês/);
    assert.match(br, /só pagam depois de ver funcionando/);
    // O wa.me leva o texto codificado: o "$" vira %24 no link, e o WhatsApp o decodifica.
    assert.ok(segundaDe(CASOS[0][1]).link.includes("R%24%20990"));
    const en = segundaDe(CASOS[3][1]).texto;
    assert.match(en, /only pay after you see it working/);
    assert.doesNotMatch(en, /R\$|US\$|\$/);
  });
});

describe("site-mensagem: variação da primeira mensagem (Balcão)", () => {
  const pids = Array.from({ length: 200 }, (_, i) => `ChIJ${String(i).padStart(4, "0")}x`);
  const letras = (lead?: Record<string, unknown>) => pids.map((p) => doN8n.varianteDe(p, false, lead).letra);

  it("sem nota boa sai sempre a A (o controle)", () => {
    for (const lead of [undefined, {}, { nota: "", avaliacoes: "" }, { nota: "4.2", avaliacoes: "300" }, { nota: 5, avaliacoes: 14 },
      { nota: "4,9", avaliacoes: "" }, { nota: "sem nota", avaliacoes: "40" }, { nota: "4.9", avaliacoes: "12.5" }]) {
      assert.deepEqual(new Set(letras(lead)), new Set(["A"]), JSON.stringify(lead));
    }
  });

  it("com nota 4,3+ e 15+ avaliações divide entre A e B, a C (Raio-X) não sai, e a letra não muda entre rodadas", () => {
    for (const lead of [{ nota: "4.3", avaliacoes: "15" }, { nota: 4.9, avaliacoes: 34 }, { nota: "4,8", avaliacoes: "122" }]) {
      const a = letras(lead);
      assert.deepEqual(new Set(a), new Set(["A", "B"]));
      assert.ok(a.filter((l) => l === "B").length > 70, "~metade em B");
      assert.deepEqual(letras(lead), a);
    }
  });

  it("o texto da B cita a nota com vírgula, as avaliações e o artigo certo; o da A não muda", () => {
    const pidB = pids.find((p) => doN8n.varianteDe(p, false, { nota: 5, avaliacoes: 1234 }).letra === "B")!;
    const b = doN8n.varianteDe(pidB, false, { nota: 5, avaliacoes: 1234 });
    assert.equal(doN8n.preencher(b.molde, "Clínica Bem Estar", "https://x", ""),
      "Oi, tudo bem? Aqui é o Rômulo, do PRUMO. Vi a Clínica Bem Estar no Google: nota 5,0 com 1.234 avaliações, mas quem pesquisa " +
      "não encontra um site de vocês e acaba indo para quem tem. Montei uma demonstração com as fotos e as avaliações que vocês já têm. " +
      "Posso te mandar o link?");
    const b2 = doN8n.varianteDe(pidB, false, { nota: "4.8", avaliacoes: "40" });
    assert.match(doN8n.preencher(b2.molde, "Escritório Silva", "https://x", ""), /Vi o Escritório Silva no Google: nota 4,8 com 40 avaliações/);
    const pidA = pids.find((p) => doN8n.varianteDe(p, false, { nota: 5, avaliacoes: 40 }).letra === "A")!;
    assert.match(doN8n.preencher(doN8n.varianteDe(pidA, false, { nota: 5, avaliacoes: 40 }).molde, "Clínica X", "https://x", ""),
      /^Oi, tudo bem\? Aqui é o Rômulo\. Encontrei vocês no Google/);
  });

  it("EUA continua na EN, com ou sem nota", () => {
    assert.equal(doN8n.varianteDe("ChIJ0001x", true, { nota: 5, avaliacoes: 100 }).letra, "EN");
  });
});
