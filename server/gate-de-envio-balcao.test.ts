import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { CONVERSA_QUE_NAO_HOUVE, EMOJI, FRASES_PROIBIDAS, LIMITES, LINK, MARCAS, conferirMensagem } from "./gate-de-envio.ts";
import { PRECOS_ABERTOS } from "../src/operations/copiloto.ts";

// O gate de pré-envio da 1ª mensagem do Balcão (18/10/2026): a cópia em JS (deploy/dell/claude-ops/gate-de-envio.js)
// do gate em TypeScript, e a sua ligação no cruzamento (balcao-cruzar.js, modos desligado | avisar | bloquear).
// Três coisas ficam fixadas aqui: (1) as duas cópias não divergem (regex, limites, preços e o resultado sobre os
// mesmos textos); (2) todas as VARIACOES atuais, com leads inventados, passam sem problema, e cada código de problema
// reprova; (3) o cruzamento só avisa ou barra, nunca muda o texto da mensagem nem o sorteio das letras.
// Telefones são sequências inventadas; nada de dado real nem de data/.

const PASTA = path.join(import.meta.dirname, "..", "deploy", "dell", "claude-ops");
const ler = (arquivo: string) => fs.readFileSync(path.join(PASTA, arquivo), "utf8");

interface Problema { codigo: string; trecho?: string; motivo: string }
interface ExpressaoDaCopia { source: string; flags: string }
interface GateJs {
  GATE_LIMITE_PRIMEIRO: { caracteres: number; links: number };
  GATE_PRECOS_ABERTOS: string[];
  GATE_MARCAS: Array<{ regex: ExpressaoDaCopia; colchete?: true }>;
  GATE_FRASES_PROIBIDAS: Array<{ regex: ExpressaoDaCopia; motivo: string }>;
  GATE_CONVERSA_QUE_NAO_HOUVE: ExpressaoDaCopia;
  GATE_EMOJI: ExpressaoDaCopia;
  GATE_LINK: ExpressaoDaCopia;
  conferirPrimeiraMensagem: (texto: string, nome?: string) => Problema[];
  resumoDoGate: (problemas: Problema[]) => string;
}
interface SiteMensagemJs {
  VARIACOES: string[];
  VARIACAO_EN: string;
  moldeDaLetra: (letra: string, lead: Record<string, unknown>) => string;
  preencher: (molde: string, nome: string, url: string, detalhe: string) => string;
  detalheDoBriefing: (briefing: string) => string;
}

const siteMensagem = ler("site-mensagem.js");
const gateJs = ler("gate-de-envio.js");
// O arquivo do n8n é um corpo de nó, sem módulo: o teste lê as definições pelo escopo (como o n8n as vê).
const gate = vm.runInNewContext(
  `${gateJs}\n;({ GATE_LIMITE_PRIMEIRO, GATE_PRECOS_ABERTOS, GATE_MARCAS, GATE_FRASES_PROIBIDAS, GATE_CONVERSA_QUE_NAO_HOUVE, GATE_EMOJI, GATE_LINK, conferirPrimeiraMensagem, resumoDoGate })`,
  {},
) as GateJs;
const site = vm.runInNewContext(
  `${siteMensagem}\n;({ VARIACOES, VARIACAO_EN, moldeDaLetra, preencher, detalheDoBriefing })`,
  {},
) as SiteMensagemJs;

/** Atravessa a fronteira dos contextos do vm (objetos de outro realm) e tira as chaves `undefined`. */
const plano = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const jsConfere = (texto: string, nome?: string): Problema[] => plano(gate.conferirPrimeiraMensagem(texto, nome));
const tsConfere = (texto: string, nome?: string): Problema[] =>
  plano(conferirMensagem(texto, { modo: "avisar", tipo: "primeiro", ...(nome === undefined ? {} : { nome }) }).problemas);
const codigos = (problemas: Problema[]) => [...new Set(problemas.map((p) => p.codigo))].sort();
const forma = (r: ExpressaoDaCopia | RegExp) => ({ source: r.source, flags: r.flags });

// ------------------------------------------------------------------ as duas cópias não divergem

describe("gate do Balcão: a cópia em JS é a mesma regra do gate em TypeScript", () => {
  it("as regex de marca, frase, conversa, emoji e link são idênticas", () => {
    assert.deepEqual(plano(gate.GATE_MARCAS.map((m) => ({ ...forma(m.regex), colchete: m.colchete }))), plano(MARCAS.map((m) => ({ ...forma(m.regex), colchete: m.colchete }))));
    assert.deepEqual(plano(gate.GATE_FRASES_PROIBIDAS.map((f) => ({ ...forma(f.regex), motivo: f.motivo }))), plano(FRASES_PROIBIDAS.map((f) => ({ ...forma(f.regex), motivo: f.motivo }))));
    assert.deepEqual(plano(forma(gate.GATE_CONVERSA_QUE_NAO_HOUVE)), forma(CONVERSA_QUE_NAO_HOUVE));
    assert.deepEqual(plano(forma(gate.GATE_EMOJI)), forma(EMOJI));
    assert.deepEqual(plano(forma(gate.GATE_LINK)), forma(LINK));
  });

  it("o limite da 1ª mensagem e os preços abertos são os mesmos", () => {
    assert.deepEqual(plano(gate.GATE_LIMITE_PRIMEIRO), LIMITES.primeiro);
    assert.deepEqual(plano([...gate.GATE_PRECOS_ABERTOS].sort()), [...PRECOS_ABERTOS].sort());
  });

  const TEXTOS: string[] = [
    "Oi, tudo bem? Aqui é o Rômulo. Posso te mandar o link para dar uma olhada? É sem compromisso.",
    "", "   ", "Oi {{nome}}, tudo bem?", "Aqui está a demonstração de site da {NOME}.", "Oi, [NOME], tudo bem?", "Oi ${nome}!",
    "Oi, aqui é o Rômulo, da %s.", "Oi <NOME>, tudo bem?", "Aqui está o raio-x da undefined.", "Oi, tudo bem com a null?", "Nota NaN em 12 avaliações.",
    "Oi [object Object], tudo bem?", "Oi NOME_CONTATO, tudo bem?", "Subiu 50% em 3 meses, e 100% do que está no ar é de vocês.",
    "Olá! Espero que esteja bem. Posso te mandar o link?", "Gostaria de entrar em contato sobre o site de vocês.", "Venho por meio desta apresentar o PRUMO.",
    "Oi! Passando para ver se você viu o link.", "Prezado Carlos, tudo bem?", "Atenciosamente, Rômulo", "É só 1 minuto, vagas com número limitado.",
    "Leva só 2 minutos para ver.", "Hoje tudo depende do dono, e isso custa cliente.", "Aqui está a mensagem: Oi, tudo bem?",
    "Oi, conforme conversamos, segue o link.", "Como combinamos, o link está pronto.", "Oi, tudo bem? 😀 Posso te mandar o link?", "■ Encontrado → no ar em dias",
    `Oi, tudo bem? ${"Texto de enchimento. ".repeat(40)}`, "Oi, tudo bem? Veja https://demo-x.vercel.app", "wa.me/5511988880001 e www.exemplo.com.br",
    "São R$ 690 uma vez e R$ 39 por mês.", "O Respondido sai por R$ 2.400 e R$ 290 por mês.", "Fica em 2 mil reais.", "Sai por 1.500 reais.", "São R$ 777.",
    "Oi, Clínica Alfa e Clínica Alfa e Clínica Alfa.", "ESPERO QUE ESTEJA BEM", "Espero que você esteja bem, Prezada Ana! 🙂 {x} R$ 2.400 https://a.co",
  ];
  const NOMES: Array<string | undefined> = [undefined, "Clínica Alfa", "", "  ", "https://x.com/y", "--- 12", "Clínica Clínica Sorriso", "Studio 21", "Pão & Cia", "Café <Bom>", "null", "Pizzaria @luigi"];

  it("o resultado é idêntico em todos os textos e nomes da tabela (código, trecho e motivo, na mesma ordem)", () => {
    for (const texto of TEXTOS) {
      for (const nome of NOMES) assert.deepEqual(jsConfere(texto, nome), tsConfere(texto, nome), `${JSON.stringify(texto.slice(0, 60))} / ${JSON.stringify(nome)}`);
    }
  });

  it("o resumo para a coluna junta os motivos e corta em 300 caracteres", () => {
    const r = jsConfere("Oi {NOME}, passando para ver. https://a.com", "Clínica Alfa");
    assert.equal(gate.resumoDoGate(r), r.map((p) => p.motivo).join("; "));
    const enorme = Array.from({ length: 40 }, (_, i) => ({ codigo: "marca_nao_renderizada", motivo: `marca sem preencher: {M${i}}` }));
    assert.equal(gate.resumoDoGate(enorme).length, 300);
    assert.ok(gate.resumoDoGate(enorme).endsWith("..."));
  });
});

// ------------------------------------------------------------------ os textos de hoje passam; cada código reprova

/** Leads inventados: masculino, feminino, com acento, "&", maiúsculas, número no nome, apóstrofo e nome longo. */
const NOMES_DE_EXEMPLO = [
  "Dedetizadora Alfa", "Escritório Silva & Prado", "Pousada do Mar", "Latin Dental", "Clínica Sorriso", "Oficina Boa", "Studio 21 Pilates",
  "AMANDA CAMILO ADVOCACIA", "Advogada Camila Brito", "Dra. Helena Prado - Odontologia", "Sorveteria D'Ouro", "Padaria e Confeitaria Pão Quente do Bairro Jardim Primavera",
];
const BRIEFINGS = ["", "**Elogiam:** o atendimento atencioso, a pontualidade, o resultado dos tratamentos (nota 5), além do preço justo. Reclamam: demora."];
const LEAD_COM_TUDO = { nota: "4.8", avaliacoes: "1234", raio_x_url: "https://demo-x.vercel.app/raio-x", raio_x_pontos: 2 };

describe("gate do Balcão: as mensagens de hoje passam sem problema", () => {
  it("A, B, C e EN com todos os leads de exemplo, com e sem o detalhe dos elogios", () => {
    let conferidas = 0;
    for (const [i, letra] of ["A", "B", "C"].entries()) {
      assert.ok(site.VARIACOES[i], `a variação ${letra} tem texto`);
      const molde = site.moldeDaLetra(letra, LEAD_COM_TUDO);
      for (const nome of NOMES_DE_EXEMPLO) {
        for (const briefing of BRIEFINGS) {
          const texto = site.preencher(molde, nome, "https://demo-alfa.vercel.app", site.detalheDoBriefing(briefing));
          assert.deepEqual(jsConfere(texto, nome), [], `${letra} / ${nome}:\n${texto}`);
          conferidas++;
        }
      }
    }
    for (const nome of NOMES_DE_EXEMPLO) {
      const texto = site.preencher(site.VARIACAO_EN, nome, "", "");
      assert.deepEqual(jsConfere(texto, nome), [], `EN / ${nome}:\n${texto}`);
      conferidas++;
    }
    assert.equal(conferidas, 3 * NOMES_DE_EXEMPLO.length * 2 + NOMES_DE_EXEMPLO.length);
  });

  it("os moldes crus (com as marcas {NOME}, {ARTIGO}...) reprovam: a conferência é sobre o texto já montado", () => {
    for (const molde of site.VARIACOES) assert.ok(codigos(jsConfere(molde, "Clínica Alfa")).includes("marca_nao_renderizada"));
  });
});

describe("gate do Balcão: um caso por código de problema", () => {
  const BOA = "Oi, tudo bem? Aqui é o Rômulo. Posso te mandar o link para dar uma olhada? É sem compromisso.";
  const casos: Array<{ nome: string; texto: string; empresa?: string; esperado: string[] }> = [
    { nome: "mensagem boa", texto: BOA, empresa: "Clínica Alfa", esperado: [] },
    { nome: "vazia", texto: "  ", esperado: ["vazio"] },
    { nome: "marca {NOME} sem preencher", texto: "Vi a {NOME} no Google.", esperado: ["marca_nao_renderizada"] },
    { nome: "marca [nota] da colinha", texto: "Nota [nota] em [avaliações] avaliações.", esperado: ["marca_nao_renderizada"] },
    { nome: "marca undefined (campo vazio da planilha)", texto: "Vi a undefined no Google.", esperado: ["marca_nao_renderizada"] },
    { nome: "frase de IA", texto: "Espero que esteja bem. Posso te mandar o link?", esperado: ["frase_proibida"] },
    { nome: "conforme conversamos, sem conversa", texto: "Oi, conforme conversamos, aqui está.", esperado: ["frase_proibida"] },
    { nome: "emoji", texto: `${BOA} 🙂`, esperado: ["emoji"] },
    { nome: "longa demais", texto: `${BOA} ${"Mais um pouco de texto. ".repeat(30)}`, esperado: ["longa_demais"] },
    { nome: "link na 1ª mensagem", texto: `${BOA} https://demo-x.vercel.app`, esperado: ["links_demais"] },
    { nome: "nome vazio", texto: BOA, empresa: " ", esperado: ["nome_invalido"] },
    { nome: "nome com lixo (URL)", texto: BOA, empresa: "www.padariaboa.com.br", esperado: ["nome_invalido"] },
    { nome: "nome com palavra repetida", texto: BOA, empresa: "Clínica Clínica Sorriso", esperado: ["nome_invalido"] },
    { nome: "R$ fora do cardápio", texto: `${BOA} Sai por R$ 2.400.`, esperado: ["preco_fora_do_cardapio"] },
    { nome: "R$ aberto do cardápio passa", texto: `${BOA} São R$ 690 uma vez e R$ 39 por mês.`, esperado: [] },
  ];
  for (const c of casos) it(c.nome, () => assert.deepEqual(codigos(jsConfere(c.texto, c.empresa)), [...c.esperado].sort()));

  it("cada problema traz um motivo curto em português", () => {
    for (const p of jsConfere("Oi {NOME} 😀 passando para ver https://a.com R$ 2.400", "")) assert.ok(p.motivo.length > 0 && p.motivo.length <= 120, p.motivo);
  });
});

// ------------------------------------------------------------------ a ligação no cruzamento (balcao-cruzar.js)

type Modo = "desligado" | "avisar" | "bloquear";
interface LinhaDeTeste {
  place_id: string; nome: string; telefone: string; status: string; vertical: string; nota: string; avaliacoes: string;
  [chave: string]: string;
}
type Saida = Record<string, Record<string, string>>;

function lead(i: number, extra: Partial<LinhaDeTeste> = {}): LinhaDeTeste {
  const n = String(i).padStart(2, "0");
  return {
    place_id: `pid-${n}`, nome: NOMES_DE_EXEMPLO[i % NOMES_DE_EXEMPLO.length], telefone: `+55 27 9999-00${n}`, status: "novo",
    vertical: i % 2 ? "advocacia" : "odontologia", nota: i % 3 ? "4.8" : "3.9", avaliacoes: "120", site_url: "", wa_me: "", wa_link: "",
    briefing: BRIEFINGS[i % 2], site_versao: "", mensagem_variante: "", ab_elegiveis: "", ...extra,
  };
}

/** Roda o balcao-cruzar.js como o nó do n8n (site-mensagem.js + gate-de-envio.js + balcao-cruzar.js) e devolve a saída por place_id. */
function cruzar(planilha: LinhaDeTeste[], modo: Modo): Saida {
  const trocado = ler("balcao-cruzar.js").replace(/^const GATE_DE_ENVIO = '[a-z]+';/m, `const GATE_DE_ENVIO = '${modo}';`);
  assert.ok(trocado.includes(`const GATE_DE_ENVIO = '${modo}';`), "a constante GATE_DE_ENVIO tem de existir no balcao-cruzar.js");
  const codigo = [siteMensagem, gateJs, trocado].join("\n");
  const recibos = planilha.map((l) => ({ place_id: l.place_id, nome: l.nome, site_url: `https://demo-${l.place_id}.vercel.app`, vercel_project: `demo-${l.place_id}` }));
  const nos: Record<string, unknown[]> = {
    "Ler o JSON do recibo": recibos.map((recibo, item) => ({ json: { recibo }, pairedItem: { item } })),
    "Ler recibos da pasta auto": recibos.map((r) => ({ json: {}, binary: { data: { directory: `/home/node/.n8n-files/auto/${r.vercel_project}` } } })),
    "Ler marcas do modo personalizado": [], "Ler o JSON da marca": [], "Ler dossiês do modo personalizado": [{ json: {} }],
    "Ler descartes do gerador": [], "Ler o texto do descarte": [],
  };
  const dolar = (nome: string) => {
    if (!(nome in nos)) throw new Error(`nó desconhecido: ${nome}`);
    return { all: () => nos[nome], first: () => nos[nome][0] };
  };
  const corpo = vm.runInNewContext(`(function ($, $input) {\n${codigo}\n})`, {}) as (a: unknown, b: unknown) => Array<{ json: Record<string, string> }>;
  const itens = plano(corpo(dolar, { all: () => planilha.map((json) => ({ json })) }));
  const saida: Saida = {};
  for (const { json } of itens) saida[json.place_id] = json;
  return saida;
}

const semColuna = (s: Saida): Saida => Object.fromEntries(Object.entries(s).map(([pid, j]) => [pid, Object.fromEntries(Object.entries(j).filter(([k]) => k !== "gate_de_envio"))]));
const textoDe = (j: Record<string, string>) => decodeURIComponent(j.wa_me.split("?text=")[1] ?? "");

describe("gate do Balcão: o cruzamento só avisa ou barra, nunca muda o texto nem o sorteio", () => {
  const BOM = Array.from({ length: 10 }, (_, i) => lead(i));
  // 'Padaria {X}': a marca vai para o texto e o nome reprova; place_id no meio da ordem do sorteio (ordenado por place_id).
  const RUIM = lead(4, { place_id: "pid-04x", nome: "Padaria {X}" });
  const RODADA = [...BOM, RUIM];

  it("desligado: a coluna nem entra na escrita, e o resto é o de sempre", () => {
    const s = cruzar(RODADA, "desligado");
    for (const j of Object.values(s)) assert.ok(!("gate_de_envio" in j));
    assert.equal(Object.keys(s).length, RODADA.length);
    for (const j of Object.values(s)) assert.equal(j.status, "pronto");
  });

  it("avisar: todo mundo segue pronto, o ruim leva o aviso e os bons levam a coluna vazia", () => {
    const s = cruzar(RODADA, "avisar");
    assert.equal(s["pid-04x"].status, "pronto");
    assert.match(s["pid-04x"].gate_de_envio, /^aviso: .*marca sem preencher/);
    for (const l of BOM) assert.deepEqual([s[l.place_id].status, s[l.place_id].gate_de_envio], ["pronto", ""], l.place_id);
  });

  it("avisar não muda o texto nem a letra de ninguém (igual ao desligado, menos a coluna)", () => {
    assert.deepEqual(semColuna(cruzar(RODADA, "avisar")), cruzar(RODADA, "desligado"));
  });

  it("todos os textos de hoje passam: a rodada boa não gera nenhum aviso, nem barrado", () => {
    for (const modo of ["avisar", "bloquear"] as const) {
      const s = cruzar(BOM, modo);
      assert.equal(Object.keys(s).length, BOM.length);
      for (const j of Object.values(s)) assert.deepEqual([j.status, j.gate_de_envio], ["pronto", ""]);
    }
    // E o texto montado é o mesmo do desligado, byte a byte.
    assert.deepEqual(semColuna(cruzar(BOM, "bloquear")), cruzar(BOM, "desligado"));
  });

  it("bloquear: o novo reprovado não vira pronto e só ganha o motivo", () => {
    const j = cruzar(RODADA, "bloquear")["pid-04x"];
    assert.deepEqual(Object.keys(j).sort(), ["gate_de_envio", "place_id"]);
    assert.match(j.gate_de_envio, /^barrado: /);
  });

  it("bloquear: o pronto que passa a reprovar volta a novo, sem link e sem letra", () => {
    const j = cruzar([...BOM, { ...RUIM, status: "pronto", wa_link: "https://x/enviar?place_id=pid-04x", mensagem_variante: "A", ab_elegiveis: "A" }], "bloquear")["pid-04x"];
    assert.deepEqual(
      { status: j.status, wa_me: j.wa_me, wa_link: j.wa_link, mensagem_variante: j.mensagem_variante, ab_elegiveis: j.ab_elegiveis },
      { status: "novo", wa_me: "", wa_link: "", mensagem_variante: "", ab_elegiveis: "" },
    );
    assert.match(j.gate_de_envio, /^barrado: /);
  });

  it("bloquear: o barrado não gasta a vez de ninguém (as letras dos bons são as de uma rodada sem ele)", () => {
    const comBarrado = cruzar(RODADA, "bloquear");
    const semOBarrado = cruzar(BOM, "bloquear");
    const letras = (s: Saida) => Object.fromEntries(BOM.map((l) => [l.place_id, [s[l.place_id].mensagem_variante, s[l.place_id].ab_elegiveis]]));
    assert.deepEqual(letras(comBarrado), letras(semOBarrado));
    // E o texto dos bons também.
    for (const l of BOM) assert.equal(textoDe(comBarrado[l.place_id]), textoDe(semOBarrado[l.place_id]));
    // O teste só prova algo se o barrado mudaria as letras caso entrasse no sorteio (no avisar ele entra).
    const noAvisar = cruzar(RODADA, "avisar");
    assert.notDeepEqual(letras(noAvisar), letras(semOBarrado), "o lead ruim precisa estar no meio do sorteio para o teste valer");
  });

  it("bloquear: a letra que a planilha guardava para o barrado também não conta", () => {
    // Um pronto reprovado com letra B no estrato: se contasse, os vizinhos veriam um B a mais.
    const comLetraGuardada = { ...RUIM, status: "pronto", mensagem_variante: "B", ab_elegiveis: "AB", vertical: BOM[1].vertical };
    const letras = (s: Saida) => Object.fromEntries(BOM.map((l) => [l.place_id, s[l.place_id].mensagem_variante]));
    assert.deepEqual(letras(cruzar([...BOM, comLetraGuardada], "bloquear")), letras(cruzar(BOM, "bloquear")));
  });

  it("enviado não passa pelo gate: a mensagem dele já saiu", () => {
    const enviado = lead(20, { status: "enviado", site_url: "https://demo-x.vercel.app", nome: "Padaria {X}", wa_me: "https://wa.me/5527999990020?text=oi", mensagem_variante: "A" });
    for (const modo of ["avisar", "bloquear"] as const) {
      const s = cruzar([...BOM, enviado], modo);
      assert.ok(!("gate_de_envio" in (s["pid-20"] ?? {})), modo);
    }
  });

  it("uma constante GATE_DE_ENVIO desconhecida cai em avisar (nunca bloqueia por engano)", () => {
    const trocado = ler("balcao-cruzar.js").replace(/^const GATE_DE_ENVIO = '[a-z]+';/m, "const GATE_DE_ENVIO = 'bloqueaar';");
    assert.match(trocado, /'bloqueaar'/);
    const modoEfetivo = vm.runInNewContext(`${trocado.split("\n").filter((l) => /^const (GATE_DE_ENVIO|MODO_DO_GATE) =/.test(l)).join("\n")}\nMODO_DO_GATE`, {});
    assert.equal(modoEfetivo, "avisar");
  });

  it("o padrão do arquivo é avisar", () => {
    assert.match(ler("balcao-cruzar.js"), /^const GATE_DE_ENVIO = 'avisar';$/m);
  });
});
