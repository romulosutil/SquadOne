import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import {
  CODIGOS_QUE_BLOQUEIAM_SEMPRE, LIMITES, PRECOS_DA_PROPOSTA, conferirMensagem, numeroDoLink, resumoDosProblemas,
  type CodigoDoProblema, type ContextoDoGate, type TipoDeMensagem,
} from "./gate-de-envio.ts";
import { followupDe, reenvioDoRoboDe, segundaDe, type LeadDaMensagem } from "./site-mensagem.ts";
import { FOLLOWUP_PRUMO, REENVIO_ROBO_PRUMO, SEGUNDA_PRUMO, preencherPrumo, reenvioDoPrumo, segundaDoPrumo } from "./prumo-mensagem.ts";
import { OFERTAS_DO_PLUS } from "./plus-catalogo.ts";
import { followupDoPlus, primeiraDoPlus } from "./plus-mensagem.ts";
import { CDL, OBJECOES, ROTEIRO, preencher, type Momento } from "../src/operations/colinha.ts";
import { rascunhoDaProposta } from "../src/operations/mandar-proposta.ts";
import { textoDaProposta, type SugestaoDoCopiloto } from "../src/operations/copiloto.ts";

// O gate de pré-envio (17/10/2026): PURO, sem modelo. Primeiro uma tabela por código de problema; depois
// o gate roda sobre TODOS os textos que o sistema monta hoje (n8n, Site, PRUMO, Plus, colinha, proposta)
// com leads inventados e exige zero problema: se um texto reprovar, o falso-positivo é do gate.
// Telefones aqui são sequências inventadas; nada de dado real nem de data/.

const ctx = (tipo: TipoDeMensagem, extra: Partial<ContextoDoGate> = {}): ContextoDoGate => ({ modo: "bloquear", tipo, ...extra });
const codigos = (texto: string, c: ContextoDoGate) => [...new Set(conferirMensagem(texto, c).problemas.map((p) => p.codigo))];

describe("gate de envio: um caso por código de problema", () => {
  const casos: Array<{ nome: string; texto: string; c: ContextoDoGate; esperado: CodigoDoProblema[] }> = [
    { nome: "mensagem boa, sem problema", texto: "Oi, tudo bem? Aqui é o Rômulo. Posso te mandar o link para dar uma olhada? É sem compromisso.", c: ctx("primeiro"), esperado: [] },
    { nome: "vazia", texto: "   ", c: ctx("conversa"), esperado: ["vazio"] },
    // (a) marcas
    { nome: "marca {{nome}}", texto: "Oi {{nome}}, tudo bem?", c: ctx("primeiro"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca {NOME}", texto: "Aqui está a demonstração de site da {NOME}.", c: ctx("segunda"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca [NOME]", texto: "Oi, [NOME], tudo bem?", c: ctx("primeiro"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca [link do demo] (a colinha sem demo)", texto: "Segue o site:\n[link do demo]", c: ctx("segunda"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca %s", texto: "Oi, aqui é o Rômulo, da %s.", c: ctx("primeiro"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca ${nome}", texto: "Oi ${nome}!", c: ctx("primeiro"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca <NOME>", texto: "Oi <NOME>, tudo bem?", c: ctx("primeiro"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca undefined", texto: "Aqui está o raio-x da undefined.", c: ctx("segunda"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca null", texto: "Oi, tudo bem com a null?", c: ctx("primeiro"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca NaN", texto: "Nota NaN em 12 avaliações.", c: ctx("primeiro"), esperado: ["marca_nao_renderizada"] },
    { nome: "marca [object Object]", texto: "Oi [object Object], tudo bem?", c: ctx("primeiro", { colchetesParaCompletar: true }), esperado: ["marca_nao_renderizada"] },
    { nome: "marca de variável NOME_CONTATO", texto: "Oi NOME_CONTATO, tudo bem?", c: ctx("primeiro"), esperado: ["marca_nao_renderizada"] },
    { nome: "colchete para completar passa quando o contexto permite", texto: "Combinamos [dia] às 10h.", c: ctx("conversa", { colchetesParaCompletar: true }), esperado: [] },
    { nome: "50% e 100% não são marca", texto: "Subiu 50% em 3 meses, e 100% do que está no ar é de vocês.", c: ctx("conversa"), esperado: [] },
    // (b) frases proibidas
    { nome: "espero que esteja bem", texto: "Olá! Espero que esteja bem. Posso te mandar o link?", c: ctx("primeiro"), esperado: ["frase_proibida"] },
    { nome: "gostaria de entrar em contato", texto: "Gostaria de entrar em contato sobre o site de vocês.", c: ctx("primeiro"), esperado: ["frase_proibida"] },
    { nome: "venho por meio desta", texto: "Venho por meio desta apresentar o PRUMO.", c: ctx("primeiro"), esperado: ["frase_proibida"] },
    { nome: "passando para", texto: "Oi! Passando para ver se você viu o link.", c: ctx("followup"), esperado: ["frase_proibida"] },
    { nome: "prezado", texto: "Prezado Carlos, tudo bem?", c: ctx("primeiro"), esperado: ["frase_proibida"] },
    { nome: "trio de vendedor: número limitado", texto: "É só 1 minuto, vagas com número limitado.", c: ctx("conversa"), esperado: ["frase_proibida"] },
    { nome: "trio de vendedor: só 2 minutos", texto: "Leva só 2 minutos para ver.", c: ctx("conversa"), esperado: ["frase_proibida"] },
    { nome: "'sem custo' do Mapa grátis da colinha passa", texto: "Vocês recebem um documento e uma conversa, sem custo.", c: ctx("conversa"), esperado: [] },
    { nome: "o tom do PRUMO: depende do dono", texto: "Hoje tudo depende do dono, e isso custa cliente.", c: ctx("conversa"), esperado: ["frase_proibida"] },
    { nome: "sobra de texto de IA", texto: "Aqui está a mensagem: Oi, tudo bem?", c: ctx("conversa"), esperado: ["frase_proibida"] },
    { nome: "conforme conversamos sem conversa (1º contato)", texto: "Oi, conforme conversamos, segue o link.", c: ctx("primeiro"), esperado: ["frase_proibida"] },
    { nome: "conforme conversamos sem conversa (follow-up)", texto: "Oi, como combinamos, o link está pronto.", c: ctx("followup"), esperado: ["frase_proibida"] },
    { nome: "conforme conversamos com conversa: ok", texto: "Oi, conforme conversamos, segue o link.", c: ctx("conversa"), esperado: [] },
    { nome: "houveConversa=false vale sobre o tipo", texto: "Como conversamos, segue o link.", c: ctx("conversa", { houveConversa: false }), esperado: ["frase_proibida"] },
    { nome: "emoji", texto: "Oi, tudo bem? 😀 Posso te mandar o link?", c: ctx("primeiro"), esperado: ["emoji"] },
    { nome: "→ e ■ não são emoji", texto: "■ Encontrado\n→ no ar em dias", c: ctx("conversa"), esperado: [] },
    // (c) tamanho
    { nome: "longa demais para o tipo", texto: `Oi, tudo bem? ${"Texto de enchimento. ".repeat(40)}`, c: ctx("primeiro"), esperado: ["longa_demais"] },
    { nome: "o máximo do contexto vale sobre o do tipo", texto: "Oi, tudo bem? Aqui é o Rômulo.", c: ctx("primeiro", { maxCaracteres: 10 }), esperado: ["longa_demais"] },
    // (d) links
    { nome: "link na primeira mensagem", texto: "Oi, tudo bem? Veja https://demo-x.vercel.app", c: ctx("primeiro"), esperado: ["links_demais"] },
    { nome: "três links na conversa", texto: "https://a.com https://b.com https://c.com", c: ctx("conversa"), esperado: ["links_demais"] },
    { nome: "dois links na conversa: ok", texto: "Veja https://a.vercel.app/raio-x\n\ne https://a.vercel.app", c: ctx("conversa"), esperado: [] },
    // (e) nome
    { nome: "nome vazio", texto: "Aqui está a demonstração de site da .", c: ctx("segunda", { nome: "  " }), esperado: ["nome_invalido"] },
    { nome: "nome com lixo (URL)", texto: "Aqui está a demonstração de site da empresa.", c: ctx("segunda", { nome: "https://x.com/y" }), esperado: ["nome_invalido"] },
    { nome: "nome com lixo (só símbolo)", texto: "Aqui está a demonstração de site.", c: ctx("segunda", { nome: "--- 12" }), esperado: ["nome_invalido"] },
    { nome: "nome com palavra repetida", texto: "Aqui está a demonstração de site da Clínica Clínica Sorriso.", c: ctx("segunda", { nome: "Clínica Clínica Sorriso" }), esperado: ["nome_invalido"] },
    { nome: "nome repetido na mensagem", texto: "Sorriso Sorrisos? Clínica Alfa e Clínica Alfa e Clínica Alfa.", c: ctx("conversa", { nome: "Clínica Alfa" }), esperado: ["nome_invalido"] },
    { nome: "nome normal", texto: "Aqui está o raio-x da Clínica Alfa.", c: ctx("segunda", { nome: "Clínica Alfa" }), esperado: [] },
    // (f) destinatário
    { nome: "wa.me de outro número", texto: "Oi!", c: ctx("conversa", { destino: { link: "https://wa.me/5511988880001?text=oi", registro: "https://wa.me/5511988880002" } }), esperado: ["destinatario_diferente"] },
    { nome: "mesmo número, com e sem o 9 e o 55", texto: "Oi!", c: ctx("conversa", { destino: { link: "https://wa.me/551188880001?text=oi", registro: "5511988880001" } }), esperado: [] },
    { nome: "link do n8n sem número: não compara", texto: "Oi!", c: ctx("conversa", { destino: { link: "https://n8n.exemplo.dev/webhook/enviar?id=1", registro: "https://wa.me/5511988880001" } }), esperado: [] },
    { nome: "registro sem número: não compara", texto: "Oi!", c: ctx("conversa", { destino: { link: "https://wa.me/5511988880001", registro: "" } }), esperado: [] },
    // (g) R$
    { nome: "R$ de serviço sob proposta", texto: "O Respondido sai por R$ 2.400 e R$ 290 por mês.", c: ctx("conversa"), esperado: ["preco_fora_do_cardapio"] },
    { nome: "valor por extenso", texto: "Fica em 2 mil reais.", c: ctx("conversa"), esperado: ["preco_fora_do_cardapio"] },
    { nome: "R$ do Encontrado (aberto)", texto: "São R$ 690 uma vez e R$ 39 por mês.", c: ctx("segunda"), esperado: [] },
    { nome: "proposta aceita toda a tabela", texto: "→ Investimento: a partir de R$ 2.400 + R$ 290/mês", c: ctx("proposta"), esperado: [] },
    { nome: "proposta recusa R$ inventado", texto: "→ Investimento: R$ 777", c: ctx("proposta"), esperado: ["preco_fora_do_cardapio"] },
    { nome: "precosPermitidos do contexto", texto: "São R$ 100.", c: ctx("conversa", { precosPermitidos: ["R$ 100"] }), esperado: [] },
  ];
  for (const c of casos) {
    it(c.nome, () => assert.deepEqual(codigos(c.texto, c.c).sort(), [...c.esperado].sort()));
  }

  it("cada problema traz motivo curto e o resumo junta todos", () => {
    const r = conferirMensagem("Oi {NOME}, passando para ver. https://a.com", ctx("primeiro"));
    assert.ok(r.problemas.length >= 3);
    for (const p of r.problemas) assert.ok(p.motivo.length > 0 && p.motivo.length <= 120, p.motivo);
    assert.equal(resumoDosProblemas(r.problemas), r.problemas.map((p) => p.motivo).join("; "));
  });

  it("mesmo texto e mesmo contexto, mesmo resultado", () => {
    const c = ctx("conversa", { nome: "Clínica Alfa" });
    assert.deepEqual(conferirMensagem("Oi [NOME] 😀", c), conferirMensagem("Oi [NOME] 😀", c));
  });
});

describe("gate de envio: o modo decide o que bloqueia", () => {
  it("bloquear: qualquer problema bloqueia", () => {
    const r = conferirMensagem("Oi {NOME}", ctx("primeiro"));
    assert.equal(r.ok, false);
    assert.equal(r.bloqueia, true);
  });
  it("avisar: o problema aparece, o botão fica", () => {
    const r = conferirMensagem("Oi {NOME}", ctx("primeiro", { modo: "avisar" }));
    assert.equal(r.ok, false);
    assert.equal(r.bloqueia, false);
    assert.equal(r.problemas[0].codigo, "marca_nao_renderizada");
  });
  it("avisar: o destinatário errado bloqueia mesmo assim", () => {
    const r = conferirMensagem("Oi!", ctx("conversa", { modo: "avisar", destino: { link: "https://wa.me/5511988880001", registro: "5511988880002" } }));
    assert.equal(r.bloqueia, true);
    assert.ok(CODIGOS_QUE_BLOQUEIAM_SEMPRE.has("destinatario_diferente"));
  });
  it("sem problema: ok e não bloqueia", () => {
    const r = conferirMensagem("Oi, tudo bem?", ctx("primeiro"));
    assert.deepEqual({ ok: r.ok, bloqueia: r.bloqueia, problemas: r.problemas }, { ok: true, bloqueia: false, problemas: [] });
  });
  it("o número do link: wa.me e api.whatsapp.com", () => {
    assert.equal(numeroDoLink("https://wa.me/5511988880001?text=oi"), "5511988880001");
    assert.equal(numeroDoLink("https://api.whatsapp.com/send?phone=5511988880001&text=oi"), "5511988880001");
    assert.equal(numeroDoLink("https://n8n.exemplo.dev/x"), "");
    assert.equal(numeroDoLink(undefined), "");
  });
});

// ------------------------------------------------------------------ todos os textos de hoje

/** Leads inventados: nome masculino, feminino, com acento e "&", nome longo, e o número dos EUA. */
const LEADS_DE_EXEMPLO: LeadDaMensagem[] = [
  { nome: "Dedetizadora Alfa", siteUrl: "https://demo-alfa.vercel.app", waMe: "https://wa.me/5527999990001?text=oi" },
  { nome: "Escritório Silva & Prado", siteUrl: "https://demo-silva.vercel.app", waMe: "https://wa.me/5527999990002?text=oi" },
  { nome: "Pousada do Mar", siteUrl: "https://demo-mar.vercel.app", waMe: `https://wa.me/5512999990003?text=${encodeURIComponent("Oi! Montei https://demo-mar.vercel.app para vocês")}` },
  { nome: "Latin Dental", siteUrl: "https://demo-latin.vercel.app", waMe: "https://wa.me/13055550100?text=hi" },
  { nome: "Clínica Sorriso", siteUrl: "https://demo-sorriso.vercel.app", waMe: "https://wa.me/5527999990005?text=oi", variante: "C", raioXUrl: "https://demo-sorriso.vercel.app/raio-x" },
  { nome: "Oficina Boa", siteUrl: "https://demo-boa.vercel.app", waMe: "https://wa.me/5527999990007?text=oi", variante: "B", raioXUrl: "https://demo-boa.vercel.app/raio-x" },
  { nome: "Clínica Nova", siteUrl: "", waMe: "https://wa.me/5527999990008?text=oi", variante: "C", raioXUrl: "https://raio-x-prumo.vercel.app/clinica-nova" },
  { nome: "Clínica Nova", siteUrl: "https://demo-nova.vercel.app", waMe: "https://wa.me/5527999990008?text=oi", variante: "C", raioXUrl: "https://raio-x-prumo.vercel.app/clinica-nova" },
];

const avisando = (tipo: TipoDeMensagem, extra: Partial<ContextoDoGate> = {}) => ctx(tipo, { modo: "avisar", ...extra });

function exigirLimpo(origem: string, texto: string, c: ContextoDoGate) {
  const r = conferirMensagem(texto, c);
  assert.deepEqual(r.problemas, [], `${origem} reprovou o gate (${resumoDosProblemas(r.problemas)}):\n${texto}`);
}

describe("gate de envio: nenhum texto atual do sistema reprova", () => {
  it("Site (espelho do n8n): segunda, follow-up e reenvio do só-robô, com o link e o número do wa.me", () => {
    for (const lead of LEADS_DE_EXEMPLO) {
      const registro = lead.waMe;
      const destino = (link: string) => ({ link, registro });
      const f = followupDe(lead);
      exigirLimpo(`followupDe(${lead.nome})`, f.texto, avisando("followup", { nome: lead.nome, destino: destino(f.link) }));
      const s = segundaDe(lead);
      if (s.texto) exigirLimpo(`segundaDe(${lead.nome})`, s.texto, avisando("segunda", { nome: lead.nome, destino: destino(s.link) }));
      const r = reenvioDoRoboDe(lead);
      if (r) exigirLimpo(`reenvioDoRoboDe(${lead.nome})`, r.texto, avisando("reenvio", { nome: lead.nome, destino: destino(r.link) }));
    }
  });

  it("Site (primeira mensagem A, B, C e EN do JS do n8n)", () => {
    const js = fs.readFileSync(path.join(import.meta.dirname, "..", "deploy", "dell", "claude-ops", "site-mensagem.js"), "utf8");
    const n8n = vm.runInNewContext(`${js}\n;({ VARIACOES, VARIACAO_EN, preencher, elegiveisDe, eventoCriticoDe })`, {}) as {
      VARIACOES: string[]; VARIACAO_EN: string; preencher: (molde: string, nome: string, url: string, detalhe: string) => string;
      elegiveisDe: (lead: unknown, aprovado?: boolean) => string; eventoCriticoDe: (lead: unknown) => string;
    };
    assert.equal(n8n.VARIACOES.length, 4);
    const fato = { empresa: 'Empresa de teste', raio_x_url: 'https://raio-x-prumo.vercel.app/teste', raio_x_achados: [{ id: 'site-fora-do-ar', dominio: 'empresa.com.br' }] };
    assert.ok(n8n.elegiveisDe(fato).includes('D'), 'D aprovado para teste controlado');
    assert.ok(!n8n.elegiveisDe(fato, false).includes('D'), 'rollback explícito retira D');
    assert.ok(n8n.elegiveisDe(fato, true).includes('D'), 'D só entra com aprovação e fato verificável');
    assert.ok(!n8n.elegiveisDe({ ...fato, raio_x_achados: [] }, true).includes('D'), 'aprovação não substitui a evidência');
    const moldeD = n8n.VARIACOES[3].replace('{FATO}', n8n.eventoCriticoDe(fato));
    const moldes = [...n8n.VARIACOES.slice(0, 3), moldeD, n8n.VARIACAO_EN]
      .map((m) => m.split("{NOTA}").join("4,8").split("{AVALIACOES}").join("120").split("{PONTOS}").join("2 pontos que fazem"));
    for (const [i, molde] of moldes.entries()) {
      for (const lead of LEADS_DE_EXEMPLO.slice(0, 6)) {
        // O detalhe da A é uma frase do briefing do Caçador ("que os clientes elogiam…"); vazio e preenchido.
        for (const detalhe of ["", ", onde os clientes elogiam o atendimento"]) {
          exigirLimpo(`primeira mensagem ${i} (${lead.nome})`, n8n.preencher(molde, lead.nome, lead.siteUrl, detalhe), avisando("primeiro", { nome: lead.nome }));
        }
      }
    }
  });

  it("PRUMO: segunda, follow-up e reenvio", () => {
    for (const empresa of ["Roda Mais Distribuidora", "RODA MAIS DISTRIBUIDORA LTDA", "Casa do Construtor", "Agência Boa Vista"]) {
      const raioX = "https://raio-x-prumo.vercel.app/exemplo";
      exigirLimpo(`SEGUNDA_PRUMO(${empresa})`, preencherPrumo(SEGUNDA_PRUMO, empresa, raioX), avisando("segunda", { nome: empresa }));
      exigirLimpo(`FOLLOWUP_PRUMO(${empresa})`, preencherPrumo(FOLLOWUP_PRUMO, empresa, raioX), avisando("followup", { nome: empresa }));
      exigirLimpo(`REENVIO_ROBO_PRUMO(${empresa})`, preencherPrumo(REENVIO_ROBO_PRUMO, empresa, ""), avisando("reenvio", { nome: empresa }));
    }
    // Os links montados: o texto do wa.me é o texto conferido, e o número é o do registro.
    const whatsapp = "5511988880003";
    for (const link of [segundaDoPrumo(whatsapp, "Casa do Construtor", "https://raio-x-prumo.vercel.app/exemplo"), reenvioDoPrumo(whatsapp, "Casa do Construtor")]) {
      const texto = new URL(link).searchParams.get("text") ?? "";
      exigirLimpo("link do PRUMO", texto, avisando("segunda", { nome: "Casa do Construtor", destino: { link, registro: whatsapp } }));
    }
  });

  it("Plus: primeira mensagem e follow-up das quatro ofertas, com nome normal, feminino e genérico", () => {
    for (const oferta of OFERTAS_DO_PLUS) {
      for (const empresa of ["Viaconta", "Padaria Pão Quente", "Advogado - Regularização de Imóveis e Contratos Empresariais", ""]) {
        const lead = { empresa, oferta, whatsapp: "5511988880004" };
        const p = primeiraDoPlus(lead);
        exigirLimpo(`primeiraDoPlus(${oferta}, ${empresa})`, p.texto, avisando("primeiro", { destino: { link: p.link, registro: lead.whatsapp } }));
        const f = followupDoPlus(lead);
        exigirLimpo(`followupDoPlus(${oferta}, ${empresa})`, f.texto, avisando("followup", { destino: { link: f.link, registro: lead.whatsapp } }));
      }
    }
  });

  it("colinha: todos os trechos do roteiro, as respostas às objeções e o CDL (com os [colchetes] da Ficha)", () => {
    const lead = { empresa: "Clínica Sorriso", links: { site: "https://demo-sorriso.vercel.app", raioX: "https://demo-sorriso.vercel.app/raio-x" } };
    const tipoDoMomento = (m: Momento): TipoDeMensagem => (m === "primeiro-contato" ? "primeiro" : m === "pode-mandar" ? "segunda" : m === "followup" ? "followup" : "conversa");
    // A colinha mostra a tabela inteira ao Rômulo, inclusive os serviços sob proposta: só o R$ muda de lista.
    const livre = { colchetesParaCompletar: true, precosPermitidos: PRECOS_DA_PROPOSTA };
    for (const p of ROTEIRO) {
      for (const t of p.trechos) exigirLimpo(`roteiro ${p.momento}/${t.id}`, preencher(t.texto, lead), avisando(tipoDoMomento(p.momento), livre));
    }
    for (const o of OBJECOES) exigirLimpo(`objeção ${o.id}`, preencher(o.resposta.texto, lead), avisando("conversa", livre));
    for (const t of CDL) exigirLimpo(`CDL ${t.id}`, preencher(t.texto, lead), avisando("conversa", livre));
  });

  it("proposta: o rascunho do copiloto (itens do cardápio) e o texto de proposta", () => {
    const sugestao = (ids: string[]): Pick<SugestaoDoCopiloto, "proposta"> => ({ proposta: { itens: ids.map((id) => ({ id: id as never, porque: "" })) } });
    for (const ids of [["encontrado"], ["respondido"], ["encontrado", "respondido", "fonte"], ["anuncios", "redes"]]) {
      const texto = rascunhoDaProposta("Clínica Sorriso", sugestao(ids));
      if (texto) exigirLimpo(`rascunhoDaProposta(${ids})`, texto, avisando("proposta", { nome: "Clínica Sorriso" }));
      const rascunho = textoDaProposta("Clínica Sorriso", sugestao(ids));
      if (rascunho) exigirLimpo(`textoDaProposta(${ids})`, rascunho, avisando("proposta"));
    }
  });

  it("os limites têm folga sobre o maior texto atual", () => {
    // O maior texto atual (17/10/2026): segunda do raio-x com o demo, 555 caracteres.
    assert.ok(LIMITES.segunda.caracteres >= 555 * 1.4);
    assert.ok(LIMITES.primeiro.caracteres >= 343 * 1.4);
    assert.ok(LIMITES.followup.caracteres >= 223 * 1.4);
  });
});
