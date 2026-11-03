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
 * espelho mudar junto. Exceção: o reenvio do só-robô (REENVIO_ROBO*) é só do CRM.
 */

// 15/10/2026: textos revistos com um guia só (quem fala, "demonstração de site", "raio-x", o link
// sozinho na linha, o preço "uma vez e por mês", a mesma saída fácil); o guia mora no JS, junto das
// VARIACOES. A DEMO_DEPOIS_DO_RAIO_X virou a própria SEGUNDA (os dois textos só diferiam no começo).
// 08/10/2026 (plano PRUMO): a segunda termina com o preço do Encontrado, pago depois de ver no ar
// (em inglês, sem número: o preço em dólar não foi decidido); os follow-ups dizem que o demo
// ficou pronto e oferecem mudar em um dia. A primeira mensagem (variações A/B/C) não mora aqui:
// o CRM nunca a monta, só lê o `wa_me` que o Balcão gravou.
export const SEGUNDA = "Aqui está a demonstração de site {ARTIGO} {NOME}:\n{URL}\n\nFiz com as fotos e as avaliações que vocês já têm no Google.\n\nSe gostarem, coloco no ar com o endereço de vocês. São R$ 690 uma vez e R$ 39 por mês, com domínio, hospedagem e um ajuste por mês incluídos. Vocês só pagam depois de ver o site funcionando.\n\nSe não for o momento, é só dizer que eu apago.\n\nO que acharam?";
export const SEGUNDA_EN = "Here is the demo website for {NOME}:\n{URL}\n\nI built it from the photos and reviews you already have on Google.\n\nIf you like it, I'll put it live under your own address, with domain, hosting and edits included. You only pay after you see it working.\n\nIf now isn't the right time, just let me know and I'll take it down.\n\nWhat do you think?";
export const FOLLOWUP = "Oi, é o Rômulo de novo. A demonstração de site {ARTIGO} {NOME} está pronta, com as fotos e as avaliações de vocês. Posso te mandar o link para dar uma olhada? É sem compromisso.";
export const FOLLOWUP_EN = "Hi, it's Rômulo again. The demo website for {NOME} is ready, with your photos and reviews. Can I send you the link so you can take a look? No strings attached.";
export const FOLLOWUP_COM_LINK = "Oi, é o Rômulo de novo. Deu para ver a demonstração de site {ARTIGO} {NOME}?\n{URL}\n\nSe algo não ficou do jeito de vocês, eu mudo em um dia. Se não for o momento, é só dizer que eu apago.";
export const FOLLOWUP_COM_LINK_EN = "Hi, it's Rômulo again. Did you get a chance to see the demo website for {NOME}?\n{URL}\n\nIf anything isn't quite right, I'll change it within a day. If now isn't the right time, just let me know and I'll take it down.";
// Quem recebeu a variação C (o Raio-X) é lembrado do raio-x e ganha os dois links na segunda.
export const SEGUNDA_RAIO_X = "Aqui está o raio-x {ARTIGO} {NOME}:\n{RAIO_X}\n\nFiz só com o que está público no Google: o que já está bom e o que faz o cliente ir para o concorrente.\n\nTambém montei uma demonstração de site, com as fotos e as avaliações que vocês já têm:\n{URL}\n\nSe gostarem, coloco o site no ar com o endereço de vocês. São R$ 690 uma vez e R$ 39 por mês, com domínio, hospedagem e um ajuste por mês incluídos. Vocês só pagam depois de ver o site funcionando.\n\nSe não for o momento, é só dizer que eu apago.\n\nO que acharam?";
// 14/10/2026 (demo sob pedido): o Raio-X avulso (raio-x-prumo.vercel.app) é de quem ainda não tem demo. A segunda
// leva só o raio-x e oferece a demonstração, sem preço; depois do botão "Gerar demo", vem a do demo, com o preço.
export const RAIO_X_AVULSO = "https://raio-x-prumo.vercel.app/";
export const SEGUNDA_RAIO_X_SEM_DEMO = "Aqui está o raio-x {ARTIGO} {NOME}:\n{RAIO_X}\n\nFiz só com o que está público no Google: o que já está bom e o que faz o cliente ir para o concorrente.\n\nSe quiserem, também monto uma demonstração de site com as fotos e as avaliações que vocês já têm. É sem compromisso.\n\nO que acharam?";
export const DEMO_DEPOIS_DO_RAIO_X = SEGUNDA;
export const FOLLOWUP_RAIO_X = "Oi, é o Rômulo de novo. O raio-x de como {O_A} {NOME} aparece no Google está pronto: o que já está bom e o que faz o cliente ir para o concorrente. Posso te mandar o link para dar uma olhada? É sem compromisso.";

// Reenvio do só-robô (14/10/2026). SÓ DO CRM, sem par no site-mensagem.js: o teste de espelho
// não o cobre de propósito, e o aviso do n8n (05 · Acompanhamento, 3º dia) continua com o
// FOLLOWUP de sempre para este lead (conhecido, fica de fora). Quando só a resposta automática
// do WhatsApp Business respondeu, a 1ª mensagem chegou a um robô e o dono nunca a viu: o
// follow-up que pergunta "quer que eu mande o link?" não leva a nada. Este pede a pessoa certa.
// Sem "bom dia/boa tarde" (a hora varia), sem "ontem" (pode ter sido há dias), sem preço, e
// sem inglês: número dos EUA não recebe o reenvio (reenvioDoRoboDe devolve null).
export const REENVIO_ROBO = "Oi, tudo bem? Aqui é o Rômulo. Mandei uma mensagem por aqui sobre uma demonstração de site que montei para {O_A} {NOME}, mas acho que só chegou a resposta automática. Quem cuida do site ou do marketing de vocês? Posso mandar o link direto para essa pessoa. É sem compromisso.";
// Quem recebeu a C foi convidado para o raio-x, não para o site: o reenvio fala do que ele recebeu.
export const REENVIO_ROBO_RAIO_X = "Oi, tudo bem? Aqui é o Rômulo. Mandei uma mensagem por aqui sobre um raio-x de como {O_A} {NOME} aparece no Google, mas acho que só chegou a resposta automática. Quem cuida do site ou do marketing de vocês? Posso mandar o link direto para essa pessoa. É sem compromisso.";

/**
 * O que a Central diz no lugar de "Mandar o follow-up" quando o follow-up é o reenvio do só-robô
 * (server/crm.ts monta a Hoje; a Ficha e o Funil leem daqui por src/operations/crm-formato.ts).
 * Mora aqui porque é o único módulo puro que o servidor e a tela já importam.
 */
export const ROTULO_DO_REENVIO = "Pedir o responsável";
export const ROTULO_DO_FOLLOWUP = "Mandar o follow-up";

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

const recebeuC = (l: LeadDaMensagem) => ['C', 'D'].includes((l.variante ?? "").trim());

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

/**
 * Reenvio do só-robô: o pedido da pessoa certa, em português. `null` sem número no `wa_me` ou com
 * número dos EUA: aí o follow-up de sempre (FOLLOWUP_EN) continua valendo.
 */
export function reenvioDoRoboDe(l: LeadDaMensagem): { numero: string; texto: string; link: string } | null {
  const numero = numeroDe(l.waMe);
  if (!numero || ehEua(numero)) return null;
  const texto = preencher(recebeuC(l) ? REENVIO_ROBO_RAIO_X : REENVIO_ROBO, l.nome.trim(), l.siteUrl.trim());
  return { numero, texto, link: `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` };
}

/** O Raio-X da linha é o avulso (demo sob pedido), e não o `<demo>/raio-x`? */
export const raioXAvulso = (url: string | undefined) => (url ?? "").trim().startsWith(RAIO_X_AVULSO);

/**
 * Segunda mensagem: o link, para quem respondeu à primeira (que pede licença, sem link). Quem recebeu a C ganha o raio-x e o site.
 * Com o Raio-X avulso: sem demo, só o raio-x (oferecendo o demo); com o demo pedido depois, a mensagem do demo. Sem nada: link vazio.
 */
export function segundaDe(l: LeadDaMensagem) {
  const raioX = recebeuC(l) && (l.raioXUrl ?? "").trim().startsWith("https://") ? (l.raioXUrl ?? "").trim() : "";
  const site = l.siteUrl.trim();
  if (raioX && raioXAvulso(raioX)) {
    return site ? abrir(l, DEMO_DEPOIS_DO_RAIO_X, SEGUNDA_EN) : abrir(l, SEGUNDA_RAIO_X_SEM_DEMO.split("{RAIO_X}").join(raioX), SEGUNDA_EN);
  }
  if (!site) return { numero: numeroDe(l.waMe), texto: "", link: "" };
  return abrir(l, raioX ? SEGUNDA_RAIO_X.split("{RAIO_X}").join(raioX) : SEGUNDA, SEGUNDA_EN);
}

// Variante D aprovada pelo Rômulo em 19/10/2026 ("Aprovar os textos para teste"); espelho literal dos fatos e do texto do Balcão.
export const EVENTO_CRITICO_APROVADO = true;
export const PRIMEIRA_EVENTO_CRITICO = 'Oi! Sou o Rômulo, do Prumo, e trabalho com sites para empresas. {FATO}\n\nPreparei uma análise gratuita de uma página com o que encontrei sobre {O_A} {NOME}. Posso te enviar?';
export function eventoCriticoDe(lead: { raio_x_url?: unknown; raio_x_achados?: unknown }): string | null {
  if (!lead || !/^https:\/\//.test(String(lead.raio_x_url || ''))) return null;
  const achados = Array.isArray(lead.raio_x_achados) ? lead.raio_x_achados : [];
  const dominio = (v: unknown) => typeof v === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(v) && v.length <= 180 ? v : '';
  for (const a of achados) {
    if (!a || typeof a !== 'object') continue;
    if (a.id === 'dominio-vencido' && dominio(a.dominio) && /^\d{4}-\d{2}-\d{2}$/.test(a.data || '')) {
      const d = new Date(a.data + 'T12:00:00Z');
      if (Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === a.data) return 'Ao conferir o endereço ' + a.dominio + ', encontrei o registro de vencimento em ' + a.data.split('-').reverse().join('/') + '.';
    }
    if (a.id === 'site-fora-do-ar' && dominio(a.dominio)) return 'Ao conferir o site ' + a.dominio + ', a página não abriu no teste.';
    if (a.id === 'posicao-na-busca' && Number.isInteger(a.posicao) && a.posicao > 3 && a.posicao <= 1000
      && Number.isInteger(a.lidos) && a.lidos >= a.posicao && typeof a.consulta === 'string'
      && a.consulta.trim() && a.consulta.length <= 120 && !/[<>\r\n{}]|https?:/i.test(a.consulta)) {
      return 'Na consulta por ‘' + a.consulta.trim() + '’ que analisei, vocês apareceram em ' + a.posicao + 'º lugar no Google.';
    }
  }
  return null;
}

export function primeiraComEventoCritico(empresa: string, lead: Parameters<typeof eventoCriticoDe>[0], aprovado = EVENTO_CRITICO_APROVADO): string {
  const fato = eventoCriticoDe(lead);
  return aprovado === true && fato ? PRIMEIRA_EVENTO_CRITICO.replace("{FATO}", fato).replace("{O_A}", artigoDe(empresa) === "da" ? "a" : "o").replace("{NOME}", empresa) : "";
}
