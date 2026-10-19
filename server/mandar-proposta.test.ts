import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PastaDoLead } from "./auto-production.ts";
import { montarCrm, validarRetrato, type CrmVisao } from "./crm.ts";
import { filaDeVenda } from "../src/operations/proxima-venda.ts";
import { CARDAPIO, PRECOS_DO_CARDAPIO, precosNoTexto } from "../src/operations/colinha.ts";
import {
  cabeProposta, gostouDepoisDoLink, propostaDeUmToque, rascunhoDaProposta, soPrecosDoCardapio, type LeadDaProposta,
} from "../src/operations/mandar-proposta.ts";

// "Mandar a proposta" em um toque (16/10/2026): 7 "quero ver", 3 receberam o link, 0 propostas. O
// toque abre o WhatsApp com a proposta e anota `proposta`; a fila põe o passo logo depois do
// "responder". Tudo fixture: nenhuma planilha, n8n, copiloto ou WhatsApp real é tocado.

import { spicedVazio, textoDoRegistroSpiced } from "../src/operations/spiced.ts";

const QUALIFICADO = { ...spicedVazio(), dor: "site não apresenta o serviço", impacto: "clientes não encontram a empresa", decisao: { decisor_confirmado: "sim" as const, quem: "dono", como_paga: "a combinar" } };
const AGORA = new Date("2026-10-14T13:00:00Z"); // quarta, 10:00 em São Paulo
const WEBHOOK = "https://dell.exemplo.ts.net/webhook";
const horas = (n: number) => new Date(AGORA.getTime() - n * 3600_000).toISOString();
const dias = (n: number) => horas(n * 24);
const COLUNAS = ["row_number", "place_id", "nome", "vertical", "cidade", "status", "site_url", "criado_em", "enviado_em",
  "visto_em", "respondeu_em", "followup_em", "recusado_em", "fechado_em", "acoes_link", "wa_link", "wa_me",
  "resposta_tipo", "resposta_trecho", "resposta_em", "mensagem_variante"];

function visaoCom(site: Record<string, string>, registros: Array<Record<string, string>> = []): CrmVisao {
  const linha = { ...Object.fromEntries(COLUNAS.map((c) => [c, ""])), row_number: "3", place_id: "L", nome: "Studio L",
    vertical: "pilates", cidade: "Vitória", criado_em: dias(10), site_url: "https://demo-studio-l.vercel.app/",
    wa_me: "https://wa.me/5527999990000?text=oi", mensagem_variante: "A", ...site };
  const retrato = validarRetrato({
    versao: 1,
    geradoEm: new Date(AGORA.getTime() - 60_000).toISOString(),
    links: { webhook: WEBHOOK },
    fontes: {
      site: { planilha: "Leads", aba: "Leads", colunas: COLUNAS, linhas: [linha] },
      registros: { aba: "CRM", colunas: ["em", "produto", "id", "tipo", "texto", "data"], linhas: [...registros, { em: "2026-10-13T13:00:00Z", produto: "site", id: "L", tipo: "spiced", texto: textoDoRegistroSpiced(QUALIFICADO), data: "" }] },
    },
  });
  const pasta: PastaDoLead = {
    slug: "studio-l", lugar: "", placeId: "L",
    artefatos: { conteudo: true, fotos: 0, capa: false, gerado: true, publicado: true, falha: false },
    alteradaEm: dias(2), publicadoEm: dias(3), siteUrl: "https://demo-studio-l.vercel.app/",
  };
  return montarCrm(retrato, { agora: AGORA, pastas: [pasta] }) as unknown as CrmVisao;
}

// O link (2ª mensagem) saiu há 26 h; a resposta vem antes ou depois dele, conforme o caso.
const LINK = { em: horas(26), produto: "site", id: "L", tipo: "segunda_enviada", texto: "", data: "" };
const respondeu = (tipo: string, trecho: string, haHoras: number) => ({
  status: "enviado", enviado_em: dias(3), respondeu_em: horas(haHoras), resposta_tipo: tipo, resposta_trecho: trecho, resposta_em: horas(haHoras),
});

describe("fila de venda: 'mandar a proposta' depois do 'gostei'", () => {
  const casos: Array<{ caso: string; site: Record<string, string>; registros?: Array<Record<string, string>>; entra: boolean }> = [
    { caso: "'gostei' depois do link", site: respondeu("interesse", "gostei muito, como faz?", 2), registros: [LINK], entra: true },
    { caso: "'quanto fica?' classificado como neutra depois do link", site: respondeu("neutra", "quanto fica?", 2), registros: [LINK], entra: true },
    { caso: "interesse ANTES do link (o 'pode mandar' que levou ao link)", site: respondeu("interesse", "pode mandar", 28), registros: [LINK], entra: false },
    { caso: "neutra sem pergunta de preço depois do link", site: respondeu("neutra", "vou ver com meu sócio", 2), registros: [LINK], entra: false },
    { caso: "negativa depois do link", site: respondeu("negativa", "não tenho interesse", 2), registros: [LINK], entra: false },
    { caso: "interesse sem o link enviado (a vez é do link)", site: respondeu("interesse", "pode mandar", 2), entra: false },
    {
      caso: "proposta já marcada", site: respondeu("interesse", "gostei", 2),
      registros: [LINK, { em: horas(1), produto: "site", id: "L", tipo: "proposta", texto: "", data: "2026-10-14" }], entra: false,
    },
  ];
  for (const c of casos) {
    it(`${c.caso}: ${c.entra ? "entra" : "não entra"}`, () => {
      const v = visaoCom(c.site, c.registros ?? []);
      const fila = filaDeVenda(v, { primeiroLiberado: true, agora: AGORA.getTime() });
      const a = fila.find((x) => x.tipo === "mandar-proposta");
      assert.equal(Boolean(a), c.entra, fila.map((x) => x.tipo).join(","));
      if (!a) return;
      assert.equal(a.anota, "proposta");
      assert.equal(a.quente, true);
      assert.equal(a.primeiroContato, false);
      assert.match(a.link?.url ?? "", /^https:\/\/wa\.me\/5527999990000\?text=/);
      assert.ok(a.rascunho && soPrecosDoCardapio(a.rascunho), a.rascunho);
      assert.match(a.rascunho ?? "", /R\$ 690/);
      // O "gostei" vira a proposta, não um "responder" a mais para o mesmo lead.
      assert.equal(fila.some((x) => x.tipo === "responder" && x.leadId === a.leadId), false);
    });
  }

  it("entra logo depois do 'responder': antes do combinado do mesmo dia", () => {
    const v = visaoCom(respondeu("interesse", "gostei", 2),
      [LINK, { em: horas(3), produto: "site", id: "L", tipo: "proximo_passo", texto: "ligar para fechar", data: "2026-10-14" }]);
    const tipos = filaDeVenda(v, { primeiroLiberado: true, agora: AGORA.getTime() }).map((a) => a.tipo);
    assert.equal(tipos[0], "mandar-proposta", tipos.join(","));
    assert.ok(tipos.includes("combinado"), tipos.join(","));
  });
});

// ---------------------------------------------------------------- o texto, PURO

const BASE: LeadDaProposta = {
  spiced: QUALIFICADO, produto: "site", etapa: "contato", sinal: "enviado", followupHoje: false, empresa: "Studio L",
  marcos: { enviado: dias(3), segundaEnviada: horas(26) },
  links: { whatsapp: "https://wa.me/5527999990000" },
  resposta: { tipo: "interesse", trecho: "gostei", em: horas(2) },
};
const comItens = (...ids: string[]) => ({ proposta: { itens: ids.map((id) => ({ id: id as any, porque: "" })) } });

describe("propostaDeUmToque: copiloto, colinha ou nada", () => {
  const casos: Array<{ caso: string; lead: LeadDaProposta; sugestao?: ReturnType<typeof comItens>; origem: "copiloto" | "colinha" | null; tem?: RegExp[]; naoTem?: RegExp[] }> = [
    { caso: "Site sem copiloto: o Encontrado da colinha", lead: BASE, origem: "colinha", tem: [/R\$ 690/, /R\$ 39/, /Posso começar\?/] },
    {
      caso: "PRUMO com o copiloto: itens dele, preço do cardápio 'a partir de', sem a nota interna nem o Raio-X grátis",
      lead: { ...BASE, produto: "prumo" }, sugestao: comItens("respondido", "raio-x"), origem: "copiloto",
      tem: [/Respondido e Acompanhado/, /a partir de R\$ 2\.400 \+ R\$ 290\/mês/], naoTem: [/WhatsApp frio/, /■ Raio-X/],
    },
    { caso: "copiloto só com grátis: cai na colinha", lead: BASE, sugestao: comItens("raio-x", "mapa"), origem: "colinha" },
    { caso: "PRUMO depois do Mapa sem copiloto: a Fonte, com colchetes para completar", lead: { ...BASE, produto: "prumo", sinal: "diagnostico" }, origem: "colinha", tem: [/R\$ 1\.500/, /\[/] },
    { caso: "Iris: faixas próprias e quantidade a confirmar, sem preço de outro produto", lead: { ...BASE, produto: "iris" }, origem: "colinha", tem: [/Iris/, /R\$ 39/, /R\$ 32/, /R\$ 25/, /ficha ativa/, /\[confirmar/], naoTem: [/R\$ 690/] },
    { caso: "sem WhatsApp do lead: sem botão", lead: { ...BASE, links: {} }, origem: null },
  ];
  for (const c of casos) {
    it(c.caso, () => {
      const p = propostaDeUmToque(c.lead, c.sugestao ?? null);
      assert.equal(p?.origem ?? null, c.origem);
      if (!p) return;
      assert.ok(soPrecosDoCardapio(p.texto, c.lead.produto === 'plus' ? c.lead.plus?.oferta : c.lead.produto), p.texto);
      assert.equal(new URL(p.url).searchParams.get("text"), p.texto);
      for (const r of c.tem ?? []) assert.match(p.texto, r);
      for (const r of c.naoTem ?? []) assert.doesNotMatch(p.texto, r);
      assert.equal(p.completar, /\[[^\]]+\]/.test(p.texto));
    });
  }

  it("nenhum 'R$' fora do cardápio, item por item", () => {
    for (const s of CARDAPIO) {
      for (const p of precosNoTexto(rascunhoDaProposta("Studio L", comItens(s.id)))) assert.ok(PRECOS_DO_CARDAPIO.includes(p), `${s.id}: ${p}`);
    }
    assert.equal(soPrecosDoCardapio("Fica R$ 999 por mês"), false);
    assert.equal(soPrecosDoCardapio("R$ 690 + R$ 39/mês"), true);
  });
});

describe("quando a Ficha oferece a proposta", () => {
  const casos: Array<{ caso: string; lead: LeadDaProposta; gostou: boolean; cabe: boolean }> = [
    { caso: "gostou depois do link", lead: BASE, gostou: true, cabe: true },
    { caso: "link enviado, sem resposta depois (ao lado)", lead: { ...BASE, resposta: { tipo: "interesse", trecho: "pode", em: horas(30) } }, gostou: false, cabe: true },
    { caso: "ainda sem o link (o passo é mandar o link)", lead: { ...BASE, marcos: { enviado: dias(3) } }, gostou: false, cabe: false },
    { caso: "já em Proposta", lead: { ...BASE, etapa: "proposta", proposta: { em: horas(1), data: "2026-10-14" } }, gostou: false, cabe: false },
    { caso: "PRUMO depois do Mapa respondido", lead: { ...BASE, produto: "prumo", sinal: "diagnostico", marcos: { enviado: dias(3) }, resposta: undefined }, gostou: false, cabe: true },
  ];
  for (const c of casos) {
    it(c.caso, () => {
      assert.equal(gostouDepoisDoLink(c.lead), c.gostou);
      assert.equal(cabeProposta(c.lead), c.cabe);
    });
  }
});
