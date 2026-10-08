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

// 08/10/2026 (plano PRUMO): a segunda termina com o preço do Encontrado, pago depois de ver no ar
// (em inglês, sem número: o preço em dólar não foi decidido); os follow-ups dizem que o demo
// ficou pronto e oferecem mudar em um dia. A primeira mensagem (variações A/B/C) não mora aqui:
// o CRM nunca a monta, só lê o `wa_me` que o Balcão gravou.
export const SEGUNDA = "Aqui está: {URL}\n\nFiz com as fotos e as avaliações que vocês já têm no Google.\n\nSe gostarem, coloco no ar com o endereço de vocês: R$ 990 e R$ 69 por mês, com domínio, hospedagem e ajustes incluídos. Vocês só pagam depois de ver funcionando. Se não for o momento, eu apago, sem problema.\n\nO que acharam?";
export const SEGUNDA_EN = "Here it is: {URL}\n\nI built it from the photos and reviews you already have on Google.\n\nIf you like it, I'll put it live under your own address, with domain, hosting and edits included. You only pay after you see it working. If now isn't the right time, I'll take it down, no problem.\n\nWhat do you think?";
export const FOLLOWUP = "Oi, aqui é o Rômulo de novo, do PRUMO. A demonstração de site {ARTIGO} {NOME} ficou pronta, com as fotos e as avaliações de vocês. Quer que eu mande o link?";
export const FOLLOWUP_EN = "Hi, it's Rômulo again, from PRUMO. The demo website for {NOME} is ready, with your photos and reviews. Would you like me to send the link?";
export const FOLLOWUP_COM_LINK = "Oi, aqui é o Rômulo de novo. Deu para ver o site {ARTIGO} {NOME}?\n{URL}\n\nSe algo não ficou do jeito de vocês, eu mudo em um dia. E se não for o momento, é só me dizer que eu apago.";
export const FOLLOWUP_COM_LINK_EN = "Hi, it's Rômulo again. Did you get a chance to see the website for {NOME}?\n{URL}\n\nIf anything isn't quite right for you, I'll change it within a day. And if now isn't the right time, just let me know and I'll take it down.";
// Quem recebeu a variação C (o Raio-X) é lembrado do raio-x e ganha os dois links na segunda.
export const SEGUNDA_RAIO_X = "Aqui está o raio-x: {RAIO_X}\n\nFiz só com o que está público no Google. A demonstração do site, com as fotos e as avaliações que vocês já têm, está aqui:\n{URL}\n\nSe gostarem, coloco o site no ar com o endereço de vocês: R$ 990 e R$ 69 por mês, com domínio, hospedagem e ajustes incluídos. Vocês só pagam depois de ver funcionando. Se não for o momento, eu apago, sem problema.\n\nO que acharam?";
export const FOLLOWUP_RAIO_X = "Oi, aqui é o Rômulo de novo, do PRUMO. O raio-x de como {O_A} {NOME} aparece no Google ficou pronto: o que já está bom e o que faz cliente ir para o concorrente. Quer que eu mande?";

/** Nomes que pedem artigo feminino (a mesma lista de `FEMININOS` do JS). */
export const FEMININOS = ["clinica", "academia", "casa", "barbearia", "pizzaria", "padaria", "oficina", "loja", "escola", "pousada",
  "sorveteria", "confeitaria", "lavanderia", "farmacia", "marcenaria", "vidracaria", "desentupidora", "dedetizadora", "contabilidade",
  "assessoria", "advocacia", "sociedade", "usinagem", "caldeiraria", "metalurgica", "industria", "fabrica", "empresa", "locadora",
  "locacao", "construtora", "serralheria", "distribuidora", "transportadora"];

const semAcento = (t: string) => String(t || "").normalize("NFD").replace(/[^a-zA-Z0-9 ]/g, "");
const primeiraPalavra = (t: string) => String(t || "").trim().split(" ")[0] || "";
/** Espelho das listas de 08/10/2026 do JS: títulos e nomes femininos; "…a" é feminino salvo estas. */
export const TITULOS_FEMININOS = ["dra", "doutora", "advogada", "arquiteta", "psicologa", "medica", "odontologa", "veterinaria", "professora",
  "corretora", "engenheira"];
export const NOMES_FEMININOS = ["karolinne", "karoline", "caroline", "carolline", "raquel", "isabel", "beatriz", "ines", "ingrid", "alice",
  "aline", "denise", "elaine", "simone", "tatiane", "viviane", "cristiane", "gisele", "michele", "michelle", "daniele", "danielle",
  "jaqueline", "eliane", "luciane", "rosane", "solange", "miriam", "mirian", "ester", "ruth", "lais", "thais", "tais", "yasmin", "evelyn",
  "ellen", "kelly", "sueli", "nathalie", "camille", "nicole", "gabrielle", "joyce", "suelen", "marlene", "irene", "jane", "cleide", "neide",
  "iris", "elis", "deise", "rose", "liz", "lis"];
export const MASCULINOS_EM_A = ["sistema", "clima", "programa", "dia", "mapa", "planeta", "problema", "tema", "cinema", "poema", "alfa",
  "delta", "omega", "gama", "beta", "luca", "joshua", "nikita", "garcia", "costa", "souza", "sousa", "silva", "moura", "rocha", "vieira",
  "pereira", "oliveira", "ferreira", "correa", "lima", "cunha", "mota", "motta", "nogueira", "teixeira", "siqueira", "moreira", "barbosa",
  "cardoso"];
export const artigoDe = (nome: string) => {
  const p = semAcento(primeiraPalavra(nome)).toLowerCase();
  if (FEMININOS.includes(p) || TITULOS_FEMININOS.includes(p) || NOMES_FEMININOS.includes(p)) return "da";
  return p.length > 2 && p.endsWith("a") && !MASCULINOS_EM_A.includes(p) ? "da" : "do";
};
const ehEua = (numero: string) => numero.startsWith("1") && numero.length === 11;

function preencher(molde: string, nome: string, url: string): string {
  return molde.split("{ARTIGO}").join(artigoDe(nome)).split("{O_A}").join(artigoDe(nome) === "da" ? "a" : "o")
    .split("{NOME}").join(nome).split("{URL}").join(url).split("{DETALHE}").join("");
}

/**
 * O que a mensagem precisa do lead: o nome, o demo e o `wa_me` que o Balcão gravou (número e
 * primeira mensagem); `variante` e `raioXUrl` (colunas `mensagem_variante` e `raio_x_url`) dizem
 * se a primeira foi a C, a do Raio-X.
 */
export interface LeadDaMensagem {
  nome: string;
  siteUrl: string;
  waMe: string;
  variante?: string;
  raioXUrl?: string;
}

const recebeuC = (l: LeadDaMensagem) => (l.variante ?? "").trim() === "C";

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
  if (linkJaFoi(l)) return abrir(l, FOLLOWUP_COM_LINK, FOLLOWUP_COM_LINK_EN);
  return abrir(l, recebeuC(l) ? FOLLOWUP_RAIO_X : FOLLOWUP, FOLLOWUP_EN);
}

/** Segunda mensagem: o link, para quem respondeu à primeira (que pede licença, sem link). Quem recebeu a C ganha o raio-x e o site. */
export function segundaDe(l: LeadDaMensagem) {
  const raioX = recebeuC(l) && (l.raioXUrl ?? "").trim().startsWith("https://") ? (l.raioXUrl ?? "").trim() : "";
  return abrir(l, raioX ? SEGUNDA_RAIO_X.split("{RAIO_X}").join(raioX) : SEGUNDA, SEGUNDA_EN);
}
