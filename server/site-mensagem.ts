/**
 * PURO: as mensagens do Site antes da venda que o CRM monta para o Rômulo
 * mandar com um toque — o follow-up do 3º dia e a segunda mensagem (o link).
 *
 * Espelho de `deploy/dell/claude-ops/site-mensagem.js`, que é a fonte: é de lá
 * que o n8n (Balcão e 05 · Acompanhamento) tira os mesmos textos para o aviso
 * do Hermes. Até 08/10/2026 o CRM só espelhava a segunda mensagem, em
 * português, e o "Follow-up para mandar" abria a conversa VAZIA: o texto só
 * existia no aviso do WhatsApp do 3º dia. `server/site-mensagem.test.ts` roda
 * o JS de verdade e compara: mudou um texto lá, o teste daqui falha até o
 * espelho mudar junto.
 */

export const SEGUNDA = "Aqui está: {URL}\n\nFiz com as fotos e as avaliações de vocês no Google. Se gostarem, coloco no ar com o endereço de vocês; se não, eu apago, sem problema. O que acharam?";
export const SEGUNDA_EN = "Here it is: {URL}\n\nI built it from your photos and Google reviews. If you like it, I can put it live under your own address; if not, I'll take it down, no problem. What do you think?";
export const FOLLOWUP = "Oi, tudo bem? Aqui é o Rômulo de novo. Montei uma demonstração de site {ARTIGO} {NOME} e queria te mostrar. Posso mandar o link?";
export const FOLLOWUP_EN = "Hi! It's Rômulo again. I put together a demo website for {NOME} and would love to show you. Can I send you the link?";
export const FOLLOWUP_COM_LINK = "Oi, tudo bem? Aqui é o Rômulo de novo. Deu tempo de ver a demonstração de site {ARTIGO} {NOME}?\n{URL}\n\nSe quiserem, ajusto o que for preciso. O que acharam?";
export const FOLLOWUP_COM_LINK_EN = "Hi! It's Rômulo again. Did you get a chance to see the demo website I built for {NOME}?\n{URL}\n\nHappy to adjust anything. What do you think?";

/** Nomes que pedem artigo feminino (a mesma lista de `FEMININOS` do JS). */
export const FEMININOS = ["clinica", "academia", "casa", "barbearia", "pizzaria", "padaria", "oficina", "loja", "escola", "pousada",
  "sorveteria", "confeitaria", "lavanderia", "farmacia", "marcenaria", "vidracaria", "desentupidora", "dedetizadora", "contabilidade",
  "assessoria", "advocacia", "sociedade", "usinagem", "caldeiraria", "metalurgica", "industria", "fabrica", "empresa", "locadora",
  "locacao", "construtora", "serralheria", "distribuidora", "transportadora"];

const semAcento = (t: string) => String(t || "").normalize("NFD").replace(/[^a-zA-Z0-9 ]/g, "");
const primeiraPalavra = (t: string) => String(t || "").trim().split(" ")[0] || "";
export const artigoDe = (nome: string) => (FEMININOS.includes(semAcento(primeiraPalavra(nome)).toLowerCase()) ? "da" : "do");
const ehEua = (numero: string) => numero.startsWith("1") && numero.length === 11;

function preencher(molde: string, nome: string, url: string): string {
  return molde.split("{ARTIGO}").join(artigoDe(nome)).split("{NOME}").join(nome).split("{URL}").join(url).split("{DETALHE}").join("");
}

/** O que a mensagem precisa do lead: o nome, o demo e o `wa_me` que o Balcão gravou (número e primeira mensagem). */
export interface LeadDaMensagem {
  nome: string;
  siteUrl: string;
  waMe: string;
}

const numeroDe = (waMe: string) => /wa\.me\/(\d+)/.exec(waMe)?.[1] ?? "";

/** A primeira mensagem guardada em `wa_me` já levava o link? (texto de antes de 05/10/2026) */
function linkJaFoi(l: LeadDaMensagem): boolean {
  const url = l.siteUrl.trim();
  let texto = "";
  try {
    texto = decodeURIComponent(l.waMe.split("?text=")[1] || "");
  } catch {
    texto = l.waMe;
  }
  return Boolean(url) && texto.includes(url);
}

function abrir(l: LeadDaMensagem, moldeBr: string, moldeEn: string): { numero: string; texto: string; link: string } {
  const numero = numeroDe(l.waMe);
  const texto = preencher(numero && ehEua(numero) ? moldeEn : moldeBr, l.nome.trim(), l.siteUrl.trim());
  return { numero, texto, link: numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : "" };
}

/** Follow-up do 3º dia: quem recebeu a primeira mensagem sem link é lembrado do pedido; quem já recebeu o link, do link. */
export function followupDe(l: LeadDaMensagem) {
  return linkJaFoi(l) ? abrir(l, FOLLOWUP_COM_LINK, FOLLOWUP_COM_LINK_EN) : abrir(l, FOLLOWUP, FOLLOWUP_EN);
}

/** Segunda mensagem: o link, para quem respondeu à primeira (que pede licença, sem link). */
export function segundaDe(l: LeadDaMensagem) {
  return abrir(l, SEGUNDA, SEGUNDA_EN);
}
