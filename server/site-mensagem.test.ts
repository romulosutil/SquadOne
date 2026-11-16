import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { ROTULO_DO_FOLLOWUP, ROTULO_DO_REENVIO, artigoDe, followupDe, reenvioDoRoboDe, segundaDe, type LeadDaMensagem } from "./site-mensagem.ts";

// A fonte é o JS que o n8n usa: roda ele aqui, numa caixa sem nada, e compara.
// Mudou um texto ou a lista de femininos lá, este teste falha até o espelho mudar junto.
const codigo = fs.readFileSync(path.join(import.meta.dirname, "..", "deploy", "dell", "claude-ops", "site-mensagem.js"), "utf8");
const doN8n = vm.runInNewContext(`${codigo}\n;({ followupDe, segundaDe, artigoDe, varianteDe, preencher, preencherPrimeira })`, {}) as {
  followupDe: (l: Record<string, string>) => { numero: string; texto: string; link: string };
  segundaDe: (l: Record<string, string>) => { numero: string; texto: string; link: string };
  artigoDe: (nome: string) => string;
  varianteDe: (placeId: string, eua: boolean, lead?: Record<string, unknown>) => { letra: string; molde: string };
  preencher: (molde: string, nome: string, url: string, detalhe: string) => string;
  preencherPrimeira: (molde: string, nome: string, url: string, detalhe: string) => string;
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
    assert.equal(followupDe(CASOS[0][1]).texto, "Oi, é o Rômulo de novo. A demonstração de site da Dedetizadora Alfa está pronta, " +
      "com as fotos e as avaliações de vocês. Posso te mandar o link para dar uma olhada? É sem compromisso.");
    assert.match(followupDe(CASOS[2][1]).texto, /Deu para ver a demonstração de site da Pousada do Mar\?\nhttps:\/\/demo-mar\.vercel\.app\n\n/);
    assert.match(followupDe(CASOS[3][1]).texto, /^Hi, it's Rômulo again\. The demo website for Latin Dental is ready/);
    assert.equal(followupDe(CASOS[4][1]).link, "");
  });

  it("a segunda leva o preço e o pagar depois de ver; em inglês, sem preço", () => {
    const br = segundaDe(CASOS[0][1]).texto;
    assert.equal(br, "Aqui está a demonstração de site da Dedetizadora Alfa:\nhttps://demo-alfa.vercel.app\n\n" +
      "Fiz com as fotos e as avaliações que vocês já têm no Google.\n\n" +
      "Se gostarem, coloco no ar com o endereço de vocês. São R$ 690 uma vez e R$ 39 por mês, com domínio, hospedagem e um ajuste por mês " +
      "incluídos. Vocês só pagam depois de ver o site funcionando.\n\nSe não for o momento, é só dizer que eu apago.\n\nO que acharam?");
    // O wa.me leva o texto codificado: o "$" vira %24 no link, e o WhatsApp o decodifica.
    assert.ok(segundaDe(CASOS[0][1]).link.includes("R%24%20690"));
    const en = segundaDe(CASOS[3][1]).texto;
    assert.match(en, /only pay after you see it working/);
    assert.doesNotMatch(en, /R\$|US\$|\$/);
  });

  it("quem recebeu a C ganha o raio-x e o site na segunda, e o follow-up lembra o raio-x", () => {
    const c = CASOS.find(([n]) => n === "variação C com o Raio-X")![1];
    const segunda = segundaDe(c).texto;
    assert.match(segunda, /^Aqui está o raio-x da Clínica Sorriso:\nhttps:\/\/demo-sorriso\.vercel\.app\/raio-x\n\n/);
    assert.match(segunda, /que vocês já têm:\nhttps:\/\/demo-sorriso\.vercel\.app\n\n/);
    assert.match(segunda, /R\$ 690 uma vez e R\$ 39 por mês/);
    assert.match(followupDe(c).texto, /^Oi, é o Rômulo de novo\. O raio-x de como a Clínica Sorriso aparece no Google está pronto/);
    // Sem o link do Raio-X na linha, a segunda é a do site; o follow-up continua o do raio-x.
    const semUrl = CASOS.find(([n]) => n === "variação C sem o raio_x_url na linha")![1];
    assert.match(segundaDe(semUrl).texto, /^Aqui está a demonstração de site do Escritório Lima:\nhttps:\/\/demo-lima\.vercel\.app\n\n/);
    assert.match(followupDe(semUrl).texto, /raio-x de como o Escritório Lima/);
    // B com raio_x_url: a segunda é a do site.
    assert.match(segundaDe(CASOS.find(([n]) => n.startsWith("variação B"))![1]).texto, /^Aqui está a demonstração de site da Oficina Boa:\nhttps:\/\/demo-boa/);
  });
});

describe("site-mensagem: reenvio do só-robô (só do CRM, 14/10/2026)", () => {
  const texto = (l: LeadDaMensagem) => reenvioDoRoboDe(l)?.texto ?? "";

  it("pede a pessoa certa, com o artigo e o nome certos", () => {
    assert.equal(texto(CASOS[0][1]), "Oi, tudo bem? Aqui é o Rômulo. Mandei uma mensagem por aqui sobre uma demonstração de site que montei " +
      "para a Dedetizadora Alfa, mas acho que só chegou a resposta automática. Quem cuida do site ou do marketing de vocês? " +
      "Posso mandar o link direto para essa pessoa. É sem compromisso.");
    assert.match(texto(CASOS[1][1]), /montei para o Escritório Silva & Prado, mas/);
    const r = reenvioDoRoboDe(CASOS[0][1])!;
    assert.equal(r.numero, "5527999990001");
    assert.equal(r.link, `https://wa.me/5527999990001?text=${encodeURIComponent(r.texto)}`);
  });

  it("quem recebeu a C ouve do raio-x, não do site", () => {
    const c = CASOS.find(([n]) => n === "variação C com o Raio-X")![1];
    assert.match(texto(c), /sobre um raio-x de como a Clínica Sorriso aparece no Google, mas acho que só chegou a resposta automática\./);
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
    assert.ok(!codigo.includes("só chegou a resposta automática"));
    assert.equal(ROTULO_DO_REENVIO, "Pedir o responsável");
    assert.equal(ROTULO_DO_FOLLOWUP, "Mandar o follow-up");
  });
});

describe("site-mensagem: variação da primeira mensagem (Balcão)", () => {
  const pids = Array.from({ length: 200 }, (_, i) => `ChIJ${String(i).padStart(4, "0")}x`);
  const letras = (lead?: Record<string, unknown>) => pids.map((p) => doN8n.varianteDe(p, false, lead).letra);

  it("a abertura usa o nome sem o complemento do Google, preservando hífens do nome", () => {
    const molde = doN8n.varianteDe("locforte", false, { sem_demo: true }).molde;
    for (const separador of [" - ", " – ", " — ", " | "]) {
      const texto = doN8n.preencherPrimeira(molde, `Locforte Escoras e Equipamentos${separador}Uberlândia`, "", "");
      assert.match(texto, /Encontrei o Locforte Escoras e Equipamentos no Google\./);
      assert.doesNotMatch(texto, /Uberlândia/);
    }
    for (const nome of ["Auto-Escola São João", "Clínica de Uberlândia", "Clínica Maria e João", "Locforte Escoras e Equipamentos"]) {
      assert.ok(doN8n.preencherPrimeira(molde, nome, "", "").includes(`${nome} no Google.`));
    }
    assert.match(doN8n.preencherPrimeira(molde, "Clínica Alfa - Uberlândia", "", ""), /Encontrei a Clínica Alfa no Google\./);
  });

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
      "Oi! Sou o Rômulo, do Prumo, e trabalho com criação de sites. Vi a Clínica Bem Estar no Google: nota 5,0 em 1.234 avaliações. Preparei uma demonstração independente de site com as fotos e avaliações públicas de vocês e acesso ao WhatsApp.\n\n" +
      "Posso te mostrar como ficou?");
    const b2 = doN8n.varianteDe(pidB, false, { nota: "4.8", avaliacoes: "40" });
    assert.match(doN8n.preencher(b2.molde, "Escritório Silva", "https://x", ""), /Vi o Escritório Silva no Google: nota 4,8 em 40 avaliações\./);
    const pidA = pids.find((p) => doN8n.varianteDe(p, false, { nota: 5, avaliacoes: 40 }).letra === "A")!;
    assert.match(doN8n.preencher(doN8n.varianteDe(pidA, false, { nota: 5, avaliacoes: 40 }).molde, "Clínica X", "https://x", ""),
      /^Oi! Sou o Rômulo, do Prumo, e trabalho com criação de sites\. Encontrei a Clínica X no Google/);
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
      "Oi! Sou o Rômulo, do Prumo, e trabalho com sites para empresas. Analisei como a Clínica Bem Estar aparece no Google e encontrei 1 ponto que pode dificultar o contato de novos clientes.\n\n" +
      "Posso te enviar essa análise gratuita de uma página?");
    const dois = doN8n.preencher(doN8n.varianteDe(pidC, false, lead(2)).molde, "Escritório Lima", "https://demo-x.vercel.app", "");
    assert.match(dois, /como o Escritório Lima aparece .* e encontrei 2 pontos que podem dificultar o contato de novos clientes\./);
    assert.doesNotMatch(dois, /https?:|\{/);
  });

  it("EUA continua na EN, com ou sem nota e Raio-X", () => {
    assert.equal(doN8n.varianteDe("ChIJ0001x", true, { nota: 5, avaliacoes: 100, raio_x_url: "https://x.vercel.app/raio-x", raio_x_pontos: 2 }).letra, "EN");
  });
});

// 14/10/2026: o Balcão usa a alocação balanceada por nicho × letras elegíveis. Os casos completos
// estão em site-antes-da-venda.py --testar (rodam o mesmo JS); aqui, o essencial roda no npm test.
describe("site-mensagem: A/B estratificado (alocarRodada)", () => {
  type Resultado = { letra: string; elegiveis: string; congelada: boolean; molde: string };
  type Pedido = { placeId: string; nicho?: string; eua?: boolean; lead?: Record<string, unknown>; salva?: { letra?: string; elegiveis?: string } };
  const js = vm.runInNewContext(`${codigo}\n;({ alocarRodada, normalizarElegiveis, elegiveisDe, varianteDe })`, {}) as {
    alocarRodada: (linhas: Array<Record<string, unknown>>, pedidos: Pedido[]) => Record<string, Resultado>;
    normalizarElegiveis: (v: unknown) => string;
    elegiveisDe: (lead: Record<string, unknown>) => string;
    varianteDe: (placeId: string, eua: boolean, lead?: Record<string, unknown>) => { letra: string } | null;
  };
  const ABC = { nota: "4.9", avaliacoes: "34", raio_x_url: "https://demo-x.vercel.app/raio-x", raio_x_pontos: 2 };
  const AB = { nota: "4.9", avaliacoes: "34" };
  const conta = (r: Record<string, Resultado>) => ["A", "B", "C"].map((x) => Object.values(r).filter((v) => v.letra === x).length);

  it("o conjunto elegível e a coluna normalizada", () => {
    assert.equal(js.elegiveisDe({}), "A");
    assert.equal(js.elegiveisDe(AB), "AB");
    assert.equal(js.elegiveisDe({ raio_x_url: ABC.raio_x_url, raio_x_pontos: 1 }), "AC");
    assert.equal(js.elegiveisDe(ABC), "ABC");
    for (const [v, esperado] of [["ab", "AB"], [" B A ", "AB"], ["CBA", "ABC"], ["AXB", ""], ["", ""], [null, ""], ["manual", ""]] as const) {
      assert.equal(js.normalizarElegiveis(v), esperado, String(v));
    }
  });

  it("30 leads num nicho: as três letras com diferença de no máximo 1", () => {
    const r = js.alocarRodada([], Array.from({ length: 30 }, (_, i) => ({ placeId: `p${i}`, nicho: "advocacia", lead: ABC })));
    assert.deepEqual(conta(r), [10, 10, 10]);
  });

  it("a contagem vem da planilha (enviados contam; manual, EN e letra fora do conjunto não)", () => {
    const linhas = [
      { place_id: "e1", vertical: "Advocacia", mensagem_variante: "A", ab_elegiveis: "AB", status: "enviado" },
      { place_id: "m", vertical: "advocacia", mensagem_variante: "manual", ab_elegiveis: "AB" },
      { place_id: "en", vertical: "advocacia", mensagem_variante: "EN", ab_elegiveis: "AB" },
      { place_id: "fora", vertical: "advocacia", mensagem_variante: "C", ab_elegiveis: "AB" },
    ];
    assert.equal(js.alocarRodada(linhas, [{ placeId: "novo", nicho: "advocacia ", lead: AB }]).novo.letra, "B");
    // Outro nicho não sente a contagem de advocacia: estrato vazio = o hash de sempre.
    assert.equal(js.alocarRodada(linhas, [{ placeId: "novo", nicho: "contabilidade", lead: AB }]).novo.letra, js.varianteDe("novo", false, AB)?.letra);
  });

  it("congela com o mesmo conjunto; sorteia de novo se o conjunto mudou ou não existe", () => {
    const linhas = Array.from({ length: 4 }, (_, i) => ({ place_id: `b${i}`, vertical: "x", mensagem_variante: "B", ab_elegiveis: "AB" }));
    const fica = js.alocarRodada(linhas, [{ placeId: "l", nicho: "x", lead: AB, salva: { letra: "B", elegiveis: "AB" } }]).l;
    assert.deepEqual([fica.letra, fica.congelada], ["B", true]);
    const antigo = js.alocarRodada(linhas, [{ placeId: "l", nicho: "x", lead: AB, salva: { letra: "B", elegiveis: "" } }]).l;
    assert.deepEqual([antigo.letra, antigo.congelada], ["A", false]);
    const perdeu = js.alocarRodada([], [{ placeId: "l", nicho: "x", lead: AB, salva: { letra: "C", elegiveis: "ABC" } }]).l;
    assert.equal(perdeu.elegiveis, "AB");
    assert.notEqual(perdeu.letra, "C");
  });

  // 15/10/2026 (decisão do Rômulo): a A vale sem demo; a B, não. Nos EUA, sem demo, nada (fila do gerador).
  it("sem demo: A ou C (a C só com raio-x), nunca B; nos EUA, nenhuma mensagem (null)", () => {
    const r = js.alocarRodada([], [
      { placeId: "c", nicho: "x", lead: { ...ABC, sem_demo: true } },
      { placeId: "so-a", nicho: "x", lead: { ...AB, sem_demo: true } },
      { placeId: "us", eua: true, lead: { ...ABC, sem_demo: true } },
    ]);
    assert.deepEqual([r.c?.elegiveis, r.c?.congelada], ["AC", false]);
    assert.ok(["A", "C"].includes(r.c!.letra));
    assert.deepEqual([r["so-a"]?.letra, r["so-a"]?.elegiveis], ["A", "A"]);
    assert.match(r["so-a"]!.molde, /Posso preparar uma demonstração/);
    assert.doesNotMatch(r["so-a"]!.molde, /preparei|montei|está pronta/);
    assert.equal(r.us as Resultado | null, null);
    assert.equal(js.elegiveisDe({ ...ABC, sem_demo: true }), "AC");
    assert.equal(js.elegiveisDe({ ...AB, sem_demo: true }), "A");
    assert.equal(js.elegiveisDe({ sem_demo: true }), "A");
    assert.equal(js.varianteDe("so-a", false, { ...AB, sem_demo: true })?.letra, "A");
  });

  it("EUA fica em EN sem conjunto; só A não sorteia; nicho vazio é um estrato só", () => {
    const r = js.alocarRodada([{ place_id: "v", vertical: "", mensagem_variante: "A", ab_elegiveis: "AB" }], [
      { placeId: "us", eua: true, lead: ABC }, { placeId: "so-a", nicho: "x", lead: {} }, { placeId: "sem", lead: AB },
    ]);
    assert.deepEqual([r.us.letra, r.us.elegiveis], ["EN", ""]);
    assert.deepEqual([r["so-a"].letra, r["so-a"].elegiveis], ["A", "A"]);
    assert.equal(r.sem.letra, "B");
  });
});
