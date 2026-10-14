import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { ROTULO_DO_FOLLOWUP, ROTULO_DO_REENVIO, artigoDe, followupDe, reenvioDoRoboDe, segundaDe, type LeadDaMensagem } from "./site-mensagem.ts";

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

const linhaDoN8n = (l: LeadDaMensagem) => ({ nome: l.nome, site_url: l.siteUrl, wa_me: l.waMe,
  mensagem_variante: l.variante ?? "", raio_x_url: l.raioXUrl ?? "" });
// Objeto de outro contexto do vm tem outro Object.prototype: compara pelo conteúdo.
const simples = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const CASOS: Array<[string, LeadDaMensagem]> = [
  ["feminino, primeira mensagem sem link (desde 05/10)", { nome: "Dedetizadora Alfa", siteUrl: "https://demo-alfa.vercel.app", waMe: "https://wa.me/5527999990001?text=Oi%2C%20tudo%20bem%3F" }],
  ["masculino com acento no nome", { nome: "Escritório Silva & Prado", siteUrl: "https://demo-silva.vercel.app", waMe: "https://wa.me/5527999990002?text=oi" }],
  ["primeira mensagem já com o link (antes de 05/10)", { nome: "Pousada do Mar", siteUrl: "https://demo-mar.vercel.app",
    waMe: `https://wa.me/5512999990003?text=${encodeURIComponent("Oi! Montei https://demo-mar.vercel.app para vocês")}` }],
  ["número dos EUA", { nome: "Latin Dental", siteUrl: "https://demo-latin.vercel.app", waMe: "https://wa.me/13055550100?text=hi" }],
  ["sem número no wa_me", { nome: "Sem Número", siteUrl: "https://demo-x.vercel.app", waMe: "" }],
  ["variação C com o Raio-X", { nome: "Clínica Sorriso", siteUrl: "https://demo-sorriso.vercel.app", waMe: "https://wa.me/5527999990005?text=oi",
    variante: "C", raioXUrl: "https://demo-sorriso.vercel.app/raio-x" }],
  ["variação C sem o raio_x_url na linha", { nome: "Escritório Lima", siteUrl: "https://demo-lima.vercel.app", waMe: "https://wa.me/5527999990006?text=oi",
    variante: "C", raioXUrl: "" }],
  ["variação B (a segunda é a de sempre)", { nome: "Oficina Boa", siteUrl: "https://demo-boa.vercel.app", waMe: "https://wa.me/5527999990007?text=oi",
    variante: "B", raioXUrl: "https://demo-boa.vercel.app/raio-x" }],
  // Demo sob pedido (14/10/2026): o Raio-X avulso, antes e depois do botão "Gerar demo".
  ["C com o Raio-X avulso, sem demo", { nome: "Clínica Nova", siteUrl: "", waMe: "https://wa.me/5527999990008?text=oi",
    variante: "C", raioXUrl: "https://raio-x-prumo.vercel.app/clinica-nova" }],
  ["C com o Raio-X avulso e o demo pedido depois", { nome: "Clínica Nova", siteUrl: "https://demo-nova.vercel.app",
    waMe: "https://wa.me/5527999990008?text=oi", variante: "C", raioXUrl: "https://raio-x-prumo.vercel.app/clinica-nova" }],
  ["sem demo e sem raio-x", { nome: "Ninguém", siteUrl: "", waMe: "https://wa.me/5527999990009?text=oi", variante: "A", raioXUrl: "" }],
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

  // Casos reais da rodada de 08/10/2026 que saíram com o artigo errado.
  it("artigo: nome de pessoa e título feminino, como no JS", () => {
    const casos: Array<[string, string]> = [
      ["Advogada Camila Brito", "da"], ["AMANDA CAMILO ADVOCACIA", "da"], ["Dra. Juliana Suziele", "da"],
      ["Izabella Crepaldi Advocacia", "da"], ["Karolinne Brito", "da"], ["Priscila Krieger Advogada", "da"],
      ["Advogado Rafael Gustavo Goemann", "do"], ["Escritório W", "do"], ["Sistema Ar", "do"], ["Silva Advocacia", "do"],
      ["Wandenson Desentupidora", "do"], ["Clínica Bem", "da"], ["", "do"],
    ];
    for (const [nome, esperado] of casos) {
      assert.equal(artigoDe(nome), esperado, nome);
      assert.equal(doN8n.artigoDe(nome), esperado, `n8n: ${nome}`);
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
    assert.match(br, /R\$ 690 e R\$ 39 por mês/);
    assert.match(br, /só pagam depois de ver funcionando/);
    // O wa.me leva o texto codificado: o "$" vira %24 no link, e o WhatsApp o decodifica.
    assert.ok(segundaDe(CASOS[0][1]).link.includes("R%24%20690"));
    const en = segundaDe(CASOS[3][1]).texto;
    assert.match(en, /only pay after you see it working/);
    assert.doesNotMatch(en, /R\$|US\$|\$/);
  });

  it("quem recebeu a C ganha o raio-x e o site na segunda, e o follow-up lembra o raio-x", () => {
    const c = CASOS.find(([n]) => n === "variação C com o Raio-X")![1];
    const segunda = segundaDe(c).texto;
    assert.match(segunda, /^Aqui está o raio-x: https:\/\/demo-sorriso\.vercel\.app\/raio-x\n\n/);
    assert.match(segunda, /está aqui:\nhttps:\/\/demo-sorriso\.vercel\.app\n\n/);
    assert.match(segunda, /R\$ 690 e R\$ 39 por mês/);
    assert.match(followupDe(c).texto, /^Oi, aqui é o Rômulo de novo, do PRUMO\. O raio-x de como a Clínica Sorriso aparece no Google ficou pronto/);
    // Sem o link do Raio-X na linha, a segunda é a do site; o follow-up continua o do raio-x.
    const semUrl = CASOS.find(([n]) => n === "variação C sem o raio_x_url na linha")![1];
    assert.match(segundaDe(semUrl).texto, /^Aqui está: https:\/\/demo-lima\.vercel\.app\n\n/);
    assert.match(followupDe(semUrl).texto, /raio-x de como o Escritório Lima/);
    // B com raio_x_url: a segunda é a do site.
    assert.match(segundaDe(CASOS.find(([n]) => n.startsWith("variação B"))![1]).texto, /^Aqui está: https:\/\/demo-boa/);
  });
});

describe("site-mensagem: reenvio do só-robô (só do CRM, 14/10/2026)", () => {
  const texto = (l: LeadDaMensagem) => reenvioDoRoboDe(l)?.texto ?? "";

  it("pede a pessoa certa, com o artigo e o nome certos", () => {
    assert.equal(texto(CASOS[0][1]), "Oi, tudo bem? Aqui é o Rômulo, do PRUMO. Mandei uma mensagem por aqui sobre uma demonstração de site que montei " +
      "para a Dedetizadora Alfa, mas acho que só chegou o atendimento automático. Quem cuida do site ou do marketing por aí? " +
      "Posso mandar o link direto para a pessoa, é sem compromisso.");
    assert.match(texto(CASOS[1][1]), /montei para o Escritório Silva & Prado, mas/);
    const r = reenvioDoRoboDe(CASOS[0][1])!;
    assert.equal(r.numero, "5527999990001");
    assert.equal(r.link, `https://wa.me/5527999990001?text=${encodeURIComponent(r.texto)}`);
  });

  it("quem recebeu a C ouve do raio-x, não do site", () => {
    const c = CASOS.find(([n]) => n === "variação C com o Raio-X")![1];
    assert.match(texto(c), /sobre um raio-x de como a Clínica Sorriso aparece no Google, mas acho que só chegou o atendimento automático\./);
    assert.doesNotMatch(texto(c), /demonstração/);
  });

  it("sem preço, sem saudação de hora, sem 'ontem', e sem link nem placeholder", () => {
    for (const [, lead] of CASOS) {
      const t = texto(lead);
      if (!t) continue;
      assert.doesNotMatch(t, /R\$|bom dia|boa tarde|boa noite|ontem|https?:|\{/i, t);
    }
  });

  it("EUA e sem número: sem reenvio (fica o follow-up de sempre, em inglês)", () => {
    assert.equal(reenvioDoRoboDe(CASOS[3][1]), null);
    assert.equal(reenvioDoRoboDe(CASOS[4][1]), null);
    assert.match(followupDe(CASOS[3][1]).texto, /^Hi, it's Rômulo again/);
  });

  it("o JS do n8n não tem o reenvio: o espelho continua só com o que o n8n manda", () => {
    assert.ok(!codigo.includes("atendimento automático"));
    assert.equal(ROTULO_DO_REENVIO, "Pedir o responsável");
    assert.equal(ROTULO_DO_FOLLOWUP, "Mandar o follow-up");
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

  it("com nota 4,3+ e 15+ avaliações divide entre A e B, sem Raio-X a C não sai, e a letra não muda entre rodadas", () => {
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

  it("a C só sai com raio_x_url https e 1 a 3 pontos; com nota boa, A, B e C dividem", () => {
    const RX = "https://demo-x.vercel.app/raio-x";
    for (const ruim of [{ raio_x_url: RX }, { raio_x_url: RX, raio_x_pontos: 0 }, { raio_x_url: RX, raio_x_pontos: 4 },
      { raio_x_url: RX, raio_x_pontos: "1.5" }, { raio_x_url: "http://demo-x.vercel.app/raio-x", raio_x_pontos: 2 }, { raio_x_url: "", raio_x_pontos: 2 }]) {
      assert.deepEqual(new Set(letras(ruim)), new Set(["A"]), JSON.stringify(ruim));
    }
    assert.deepEqual(new Set(letras({ raio_x_url: RX, raio_x_pontos: "2" })), new Set(["A", "C"]));
    const todas = letras({ nota: 4.9, avaliacoes: 34, raio_x_url: RX, raio_x_pontos: 2 });
    assert.deepEqual(new Set(todas), new Set(["A", "B", "C"]));
    for (const x of "ABC") assert.ok(todas.filter((l) => l === x).length > 45, x);
  });

  it("o texto da C diz quantos pontos o Raio-X mostra, sem o link", () => {
    const lead = (n: number) => ({ raio_x_url: "https://demo-x.vercel.app/raio-x", raio_x_pontos: n });
    const pidC = pids.find((p) => doN8n.varianteDe(p, false, lead(1)).letra === "C")!;
    assert.equal(doN8n.preencher(doN8n.varianteDe(pidC, false, lead(1)).molde, "Clínica Bem Estar", "https://demo-x.vercel.app", ""),
      "Oi, tudo bem? Aqui é o Rômulo, do PRUMO. Fiz um raio-x de como a Clínica Bem Estar aparece para quem procura no Google: " +
      "o que já está bom e 1 ponto que faz cliente ir para o concorrente. É uma página só. Posso te mandar?");
    const dois = doN8n.preencher(doN8n.varianteDe(pidC, false, lead(2)).molde, "Escritório Lima", "https://demo-x.vercel.app", "");
    assert.match(dois, /como o Escritório Lima aparece .* e 2 pontos que fazem cliente ir para o concorrente\./);
    assert.doesNotMatch(dois, /https?:|\{/);
  });

  it("EUA continua na EN, com ou sem nota e Raio-X", () => {
    assert.equal(doN8n.varianteDe("ChIJ0001x", true, { nota: 5, avaliacoes: 100, raio_x_url: "https://x.vercel.app/raio-x", raio_x_pontos: 2 }).letra, "EN");
  });
});
