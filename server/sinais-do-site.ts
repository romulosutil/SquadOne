/**
 * PURO (17/10/2026): os "sinais do site" de um lead, tirados do HTML que o leitor trouxe, sem modelo.
 * Sem fetch, relógio, env nem I/O: `extrairSinais` recebe as páginas (texto) e a data de hoje.
 *
 * A ideia e a forma vêm do estágio PROFILE do Harvey (https://github.com/ethanplusai/harvey, MIT,
 * harvey/collectors/profile.py): poucas requisições por negócio, expressão regular sobre o HTML que já
 * está na mão, e confiança por regra, só registrando o que passa de 0,75 (agência errada num e-mail é
 * pior que nenhuma). As regras aqui são outras: frases de rodapé, anunciantes e agendadores do Brasil.
 *
 * Cada sinal é tri-estado: `true`, `false` ou `null` = sem fonte (página não lida, site que só monta no
 * navegador, anúncio que pode estar escondido num contêiner de tags). NUNCA se inventa: `null` vale mais
 * que um palpite, e a prioridade e a Ficha só usam o que tem fonte.
 *
 * Os nomes das chaves são o contrato com quem lê (Triagem, Ficha, mensagem): não renomeie.
 */

export type Sinal = boolean | null;

/** Quanto se confia no nome da agência: só ≥ 0,75 é registrado (RECORD_FLOOR do Harvey). */
export const CONFIANCA_MINIMA_DA_AGENCIA = 0.75;
/** Dias sem publicação nos endereços de blog do mapa do site para o blog valer como parado. */
export const DIAS_DO_BLOG_PARADO = 180;

export interface SinaisDoSite {
  /** `true` só com crédito de agência no rodapé (confiança ≥ 0,75). Ausência de crédito NUNCA vira `false`: muita agência não assina. */
  temAgencia: Sinal;
  agencia?: { nome: string; confianca: number };
  /** Tag de conversão ou de remarketing do Google Ads no código da página inicial. */
  rodandoGoogleAds: Sinal;
  /** Pixel do Meta (Facebook/Instagram) na página inicial. */
  rodandoMetaAds: Sinal;
  /** `true` quando a página inicial não leva link de agenda, agendador nem "agende online". */
  semAgendamentoOnline: Sinal;
  /** `true` sem dados estruturados (JSON-LD ou microdados do schema.org) na página inicial. */
  semSchema: Sinal;
  /** `true` quando o mapa do site mostra o blog sem publicação há mais de DIAS_DO_BLOG_PARADO dias. */
  blogParado: Sinal;
  /** `true` quando o cadastro do lead não traz site; `false` com a página inicial lida. */
  semSite: Sinal;
}

export interface PaginasDoSite {
  /**
   * O site do lead: `null` = o cadastro não traz (semSite: true); `undefined` = não se sabe (semSite:
   * null), por exemplo no Site antes da venda, onde o link do cadastro é o demo, não o site dele.
   */
  url: string | null | undefined;
  /** HTML da página inicial; `null`/ausente = não lida (fora do ar, bloqueada, não é HTML). */
  home?: string | null;
  /** Texto do sitemap.xml; `null`/ausente = não lido. */
  sitemap?: string | null;
}

export const SEM_FONTE: SinaisDoSite = {
  temAgencia: null, rodandoGoogleAds: null, rodandoMetaAds: null, semAgendamentoOnline: null,
  semSchema: null, blogParado: null, semSite: null,
};

// ------------------------------------------------------------------ HTML

/** Tira script, style e comentário ANTES de qualquer regra sobre texto (senão JS minificado vira "prosa"). */
function semCodigo(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©" };
function desescapar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteiro, corpo: string) => {
    if (corpo[0] === "#") {
      const codigo = corpo[1].toLowerCase() === "x" ? Number.parseInt(corpo.slice(2), 16) : Number.parseInt(corpo.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 && codigo < 0x110000 ? String.fromCodePoint(codigo) : " ";
    }
    return ENTIDADES[corpo.toLowerCase()] ?? inteiro;
  });
}

function textoDe(html: string): string {
  return desescapar(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------ anúncios, agenda, schema

const GOOGLE_ADS = [/googleadservices\.com/i, /gtag\/js\?id=AW-/i, /['"]AW-\d{6,}/, /google_conversion/i, /googleads\.g\.doubleclick\.net/i];
const META_PIXEL = [/connect\.facebook\.net\/[^"'\s]*fbevents\.js/i, /fbq\s*\(\s*['"]init['"]/i];
/** Contêiner de tags: o anúncio pode estar dentro dele, e o HTML não mostra. */
const CONTEINER_DE_TAGS = [/googletagmanager\.com\/gtm\.js/i, /['"]GTM-[A-Z0-9]{4,}['"]/];

/** Agendadores e sistemas de clínica que o Brasil usa. */
const AGENDADORES = /calendly\.com|doctoralia\.|booksy\.|trinks\.com|simplybook\.|acuityscheduling|cal\.com\/|agendor\.|clinicorp|feegow|amplimed|agendamento\.|agenda\.link|appointlet|setmore|schedulicity|squareup\.com\/appointments|app\.cal\./i;
const FRASE_DE_AGENDA = /agend(e|ar|amento)\s+(sua\s+(consulta|visita|hor[aá]rio|avalia[cç][aã]o)\s+)?online|marc(e|ar)\s+(sua\s+)?(consulta|hor[aá]rio)\s+online|reserv(e|ar|a)\s+online|agendamento\s+online/i;
/** Link cujo endereço fala de agenda e que não é conversa nem telefone (o "agende pelo WhatsApp" não é agendamento online). */
const ENDERECO_DE_AGENDA = /agend|booking|reserv|marcar-?consulta/i;
const ENDERECO_DE_CONVERSA = /^(tel:|mailto:|sms:)|wa\.me|api\.whatsapp|web\.whatsapp|whatsapp\.com|t\.me\//i;

function semAgendamento(home: string, limpo: string): boolean {
  if (AGENDADORES.test(home)) return false;
  if (FRASE_DE_AGENDA.test(textoDe(limpo))) return false;
  for (const m of limpo.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = desescapar(m[1]).trim();
    if (!ENDERECO_DE_CONVERSA.test(href) && ENDERECO_DE_AGENDA.test(href)) return false;
  }
  return true;
}

function temDadosEstruturados(home: string): boolean {
  for (const m of home.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/"@type"/.test(m[1])) return true;
  }
  return /itemtype\s*=\s*["']https?:\/\/schema\.org\//i.test(home);
}

// ------------------------------------------------------------------ agência

/**
 * Frase de crédito. Forte (0,9): "Desenvolvido por", "Criado por", "Site por", "Feito por", "Powered by",
 * "Design by"… e as legendas com dois pontos ("Desenvolvimento: X"). "Hospedado por" não entra: é
 * hospedagem, não agência.
 */
const CREDITO_FORTE = /\b(desenvolvid[oa]s?|criad[oa]s?|feit[oa]s?|projetad[oa]s?|produzid[oa]s?|programad[oa]s?|idealizad[oa]s?|site|sites|website|web\s*design|webdesign|design|marketing|powered|developed|designed|built|created|made)\s+(por|by)\b|\b(desenvolvimento|cria[cç][aã]o|programa[cç][aã]o|web\s*design|design|ag[eê]ncia)\s*:/i;
/** Texto do link que descreve o ofício (0,75): o link em si diz que é agência. */
const LINK_DESCRITIVO = /ag[eê]ncia|marketing\s+digital|web\s*design|cria[cç][aã]o\s+de\s+sites?|desenvolvimento\s+(web|de\s+sites?)|ag[eê]ncia\s+digital|\bseo\b/i;
const TEXTO_GENERICO = /^(aqui|clique aqui|saiba mais|site|link|ver|veja|acesse|home|voltar|topo|leia mais)$/i;

/** Quem aparece em rodapé de site e nunca é a agência dele (redes, mapas, pagamento, plataformas, órgãos). */
const HOSPEDES_DE_RODAPE = [
  "facebook.", "instagram.", "twitter.", "x.com", "linkedin.", "youtube.", "youtu.be", "tiktok.", "pinterest.", "threads.",
  "wa.me", "whatsapp.", "t.me", "telegram.", "google.", "goo.gl", "g.page", "maps.", "waze.", "apple.com",
  "ifood.", "reclameaqui", "trustpilot", "doctoralia.", "jusbrasil", "boaconsulta", "tripadvisor",
  "gov.br", "cfm.org", "cfp.org", "oab.org", "crm-", "cro-", "sebrae", "receita.", "procon",
  "mercadopago", "pagseguro", "pagar.me", "stripe.com", "paypal", "cielo.", "stone.", "visa.", "mastercard",
  "wix.com", "wixsite.", "wordpress.", "elementor.", "squarespace.", "shopify.", "webflow.", "hostinger.", "locaweb", "hostgator",
  "registro.br", "cloudflare", "godaddy", "umbler", "kinghost", "uol.", "bol.",
  "w3.org", "schema.org", "creativecommons", "iubenda", "onetrust", "lgpd",
];

interface CandidatoDeAgencia { nome: string; confianca: number }

/** O domínio do lead sem "www.", para não tomar o próprio site por agência. */
function dominioDe(url: string | null | undefined): string {
  try {
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

function hostDoLink(href: string): string {
  try {
    const bruto = href.startsWith("//") ? `https:${href}` : href;
    if (!/^https?:\/\//i.test(bruto)) return "";
    return new URL(bruto).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function nomeDoLink(anchor: string, miolo: string, host: string): string {
  let nome = anchor.replace(CREDITO_FORTE, " ").replace(/^[\s:|·•\-–—©]+|[\s:|·•\-–—©]+$/g, "").replace(/\s+/g, " ").trim();
  if (!nome || TEXTO_GENERICO.test(nome)) {
    // Link só de imagem (logotipo da agência): o alt é o nome; sem alt, o endereço dela.
    const alt = /<img\b[^>]*\balt\s*=\s*["']([^"']+)["']/i.exec(miolo)?.[1];
    nome = alt ? desescapar(alt).trim() : host;
  }
  return nome.slice(0, 80);
}

/** Palavras que, depois de "Desenvolvido por", não são nome de ninguém. */
const NAO_E_NOME = /^(n[oó]s|nossa|nosso|equipe|pr[oó]prio|pr[oó]pria|mim|voc[eê]|todos|todas|a|o|um|uma|dono|dona|empresa|cliente|amor|carinho|paix[aã]o|muito|brasileiros?)\b/i;
const NOME_NO_TEXTO = /^[\s:]*([A-ZÀ-Ý][\p{L}0-9&.\-]*(?:\s+[A-ZÀ-Ý&][\p{L}0-9&.\-]*){0,3})/u;

/**
 * A agência creditada no rodapé. Link com frase de crédito ao lado: 0,9. Link cujo texto descreve o ofício
 * ("Agência X", "Marketing digital"): 0,75. Crédito em texto puro com um nome próprio depois: 0,75. Link
 * solto de domínio estranho, sem rótulo: 0,35 e NÃO se registra (o Harvey faz o mesmo).
 */
export function agenciaDoRodape(html: string, url: string | null | undefined): CandidatoDeAgencia | null {
  const limpo = semCodigo(html);
  // O último <footer> (os de dentro do corpo, como um de artigo, vêm antes); sem rodapé, o fim da página.
  const rodapes = [...limpo.matchAll(/<footer\b[\s\S]*?<\/footer>/gi)];
  const regiao = rodapes.length ? rodapes[rodapes.length - 1][0] : limpo.slice(-12_000);
  const dono = dominioDe(url);
  let melhor: CandidatoDeAgencia | null = null;
  const considerar = (c: CandidatoDeAgencia) => {
    if (c.confianca >= CONFIANCA_MINIMA_DA_AGENCIA && (!melhor || c.confianca > melhor.confianca)) melhor = c;
  };

  for (const m of regiao.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = desescapar(m[1]).trim();
    const host = hostDoLink(href);
    if (!host) continue;
    if (dono && (host === dono || host.endsWith(`.${dono}`) || dono.endsWith(`.${host}`))) continue;
    const alvo = `${host}${href.toLowerCase()}`;
    if (HOSPEDES_DE_RODAPE.some((h) => alvo.includes(h))) continue;
    const anchor = textoDe(m[2]);
    if (anchor.length > 80) continue;
    // O contexto de um crédito são os ~120 caracteres antes do link.
    const antes = textoDe(regiao.slice(Math.max(0, m.index - 300), m.index)).slice(-120);
    const mistura = `${antes} ${anchor}`;
    const confianca = CREDITO_FORTE.test(mistura) ? 0.9 : LINK_DESCRITIVO.test(anchor) ? 0.75 : 0.35;
    if (confianca < CONFIANCA_MINIMA_DA_AGENCIA) continue;
    considerar({ nome: nomeDoLink(anchor, m[2], host), confianca });
  }
  if (melhor) return melhor;

  // Sem link: "Desenvolvido por Fulano Digital". Só o nome próprio logo depois da frase, e só 0,75. Os links
  // já foram julgados acima (o da Wix, descartado, não volta aqui como "texto"): viram um marcador.
  const texto = textoDe(regiao.replace(/<a\b[\s\S]*?<\/a>/gi, " § "));
  for (const m of texto.matchAll(/\b(desenvolvid[oa]|criad[oa]|feit[oa]|projetad[oa]|programad[oa]|powered|developed|designed)\s+(por|by)\b/gi)) {
    const depois = texto.slice(m.index + m[0].length, m.index + m[0].length + 70);
    const nome = NOME_NO_TEXTO.exec(depois)?.[1]?.trim();
    if (!nome || nome.length < 3 || NAO_E_NOME.test(nome)) continue;
    if (dono && nome.toLowerCase().includes(dono.split(".")[0])) continue;
    considerar({ nome: nome.slice(0, 80), confianca: 0.75 });
  }
  return melhor;
}

// ------------------------------------------------------------------ blog

const ENDERECO_DE_BLOG = /\/(blog|noticias|not[ií]cias|artigos|novidades|posts?|dicas|materias|mat[eé]rias)(\/|$)|\/20\d{2}\/\d{2}\//i;

/**
 * `true` = o blog do mapa do site está sem publicar há mais de DIAS_DO_BLOG_PARADO dias; `false` = em dia;
 * `null` = sem mapa, mapa de mapas (sitemapindex), sem blog nele ou sem data. Só olha endereços de blog:
 * a página "Contato" reescrita ontem não faz o blog estar em dia.
 */
export function blogParadoNoMapa(sitemap: string, agora: Date): Sinal {
  if (/<sitemapindex\b/i.test(sitemap)) return null;
  let maisNovo = -Infinity;
  for (const m of sitemap.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(m[1])?.[1];
    const data = /<lastmod>\s*(\d{4}-\d{2}-\d{2})/i.exec(m[1])?.[1];
    if (!loc || !data || !ENDERECO_DE_BLOG.test(loc)) continue;
    const t = Date.parse(`${data}T12:00:00Z`);
    if (Number.isFinite(t) && t > maisNovo) maisNovo = t;
  }
  if (!Number.isFinite(maisNovo)) return null;
  return (agora.getTime() - maisNovo) / 86_400_000 > DIAS_DO_BLOG_PARADO;
}

// ------------------------------------------------------------------ o conjunto

/** Menos que isto de texto na página inicial: o conteúdo é montado no navegador, e o HTML não mostra nada. */
const TEXTO_MINIMO_DA_PAGINA = 150;

/**
 * PURA. Os sinais de um lead pelas páginas lidas. Sem URL: só `semSite` (e `true`). Com URL e sem página
 * inicial lida: tudo `null`, inclusive `semSite` (fora do ar não é "sem site"). Com a página inicial, o
 * que depende do conteúdo vira `null` quando ela é só a casca de um site montado no navegador.
 */
export function extrairSinais(paginas: PaginasDoSite, agora?: Date): SinaisDoSite {
  if (paginas.url === undefined) return { ...SEM_FONTE };
  if (paginas.url === null || paginas.url === "") return { ...SEM_FONTE, semSite: true };
  const sinais: SinaisDoSite = { ...SEM_FONTE };
  if (paginas.sitemap && agora) sinais.blogParado = blogParadoNoMapa(paginas.sitemap, agora);
  const home = paginas.home;
  if (!home) return sinais;
  sinais.semSite = false;
  const limpo = semCodigo(home);
  const vazia = textoDe(limpo).length < TEXTO_MINIMO_DA_PAGINA;
  const ocultaTags = CONTEINER_DE_TAGS.some((r) => r.test(home));

  // Achar a tag prova; não achar só prova quando não há contêiner de tags nem casca vazia.
  const achou = (padroes: RegExp[]): Sinal => (padroes.some((r) => r.test(home)) ? true : ocultaTags || vazia ? null : false);
  sinais.rodandoGoogleAds = achou(GOOGLE_ADS);
  sinais.rodandoMetaAds = achou(META_PIXEL);

  if (!vazia) {
    sinais.semAgendamentoOnline = semAgendamento(home, limpo);
    sinais.semSchema = !temDadosEstruturados(home);
    const agencia = agenciaDoRodape(home, paginas.url);
    if (agencia) {
      sinais.temAgencia = true;
      sinais.agencia = { nome: agencia.nome, confianca: agencia.confianca };
    }
  }
  return sinais;
}

// ------------------------------------------------------------------ prioridade e Ficha

/**
 * PURA. O acréscimo da Prioridade da Triagem pelos sinais, pequeno e explicável (de −4 a +6, contra 0 a 100
 * da conta toda): anúncio no ar +4 (já gasta com cliente: atende e entende o valor), sem agendamento online
 * +2 (a oferta é concreta), agência já creditada −4 (o incumbente faz a venda mais difícil). `semSite` não
 * pesa: `temSite` já dá 10 pontos a quem tem site, porque é onde a revisão confere o perfil, e somar de novo
 * a falta dele contradiria essa conta.
 */
export function ajusteDaPrioridade(sinais?: SinaisDoSite): { pontos: number; motivos: string[] } {
  if (!sinais) return { pontos: 0, motivos: [] };
  const motivos: string[] = [];
  let pontos = 0;
  if (sinais.rodandoGoogleAds === true || sinais.rodandoMetaAds === true) { pontos += 4; motivos.push("anúncios no ar (+4)"); }
  if (sinais.semAgendamentoOnline === true) { pontos += 2; motivos.push("sem agendamento online (+2)"); }
  if (sinais.temAgencia === true) { pontos -= 4; motivos.push("já tem agência (−4)"); }
  return { pontos, motivos };
}

export interface LinhaDeSinal {
  /** `oportunidade` ajuda a venda; `atencao` atrapalha; `neutro` só informa. */
  tom: "oportunidade" | "atencao" | "neutro";
  rotulo: string;
  motivo: string;
}

/**
 * PURA. O que a Ficha mostra: uma linha por sinal COM fonte (`null` não aparece, nem como "desconhecido"),
 * na ordem de peso para a venda.
 */
export function linhasDosSinais(sinais?: SinaisDoSite): LinhaDeSinal[] {
  if (!sinais) return [];
  const linhas: LinhaDeSinal[] = [];
  if (sinais.semSite === true) linhas.push({ tom: "oportunidade", rotulo: "Sem site", motivo: "O cadastro não traz o endereço de um site." });
  if (sinais.temAgencia === true) {
    linhas.push({ tom: "atencao", rotulo: "Já tem agência", motivo: `Crédito no rodapé: ${sinais.agencia?.nome ?? "agência"}.` });
  }
  if (sinais.rodandoGoogleAds === true) linhas.push({ tom: "oportunidade", rotulo: "Anúncios do Google", motivo: "Tag de conversão do Google Ads no site." });
  if (sinais.rodandoMetaAds === true) linhas.push({ tom: "oportunidade", rotulo: "Pixel do Meta", motivo: "Anúncios no Facebook e no Instagram, pelo pixel do site." });
  if (sinais.rodandoGoogleAds === false && sinais.rodandoMetaAds === false) {
    linhas.push({ tom: "neutro", rotulo: "Sem anúncios no site", motivo: "Nenhuma tag de anúncio na página inicial." });
  }
  if (sinais.semAgendamentoOnline === true) linhas.push({ tom: "oportunidade", rotulo: "Sem agendamento online", motivo: "A página inicial não tem link de agenda nem agendador." });
  if (sinais.semAgendamentoOnline === false) linhas.push({ tom: "neutro", rotulo: "Agendamento online", motivo: "A página inicial leva a uma agenda." });
  if (sinais.blogParado === true) linhas.push({ tom: "oportunidade", rotulo: "Blog parado", motivo: `Sem publicar há mais de ${DIAS_DO_BLOG_PARADO} dias, pelo mapa do site.` });
  if (sinais.blogParado === false) linhas.push({ tom: "neutro", rotulo: "Blog em dia", motivo: "Publicou nos últimos meses, pelo mapa do site." });
  if (sinais.semSchema === true) linhas.push({ tom: "neutro", rotulo: "Sem dados estruturados", motivo: "O Google entende menos do site do que poderia." });
  return linhas;
}

// ------------------------------------------------------------------ qual endereço vale como "o site dele"

/** Perfis e atalhos que o cadastro às vezes traz no lugar do site: ler a página da rede social não diz nada do negócio. */
const NAO_SAO_SITE_PROPRIO = /(^|\.)(facebook|fb|instagram|linkedin|youtube|youtu|tiktok|twitter|x|wa|whatsapp|t|telegram|linktr|bio|beacons|google|goo|g|maps|waze|ifood|tripadvisor|doctoralia|jusbrasil|olx|mercadolivre)\.(com|me|ee|gl|page|br|com\.br|net|link|ai)$/i;

/** PURA. O endereço é de um site do negócio (e não de um perfil de rede social, link de conversa ou mapa)? */
export function ehSiteProprio(url: string): boolean {
  const host = dominioDe(url);
  return host !== "" && !NAO_SAO_SITE_PROPRIO.test(host);
}

// ------------------------------------------------------------------ validação do que vem do disco

const CHAVES_DE_SINAL = ["temAgencia", "rodandoGoogleAds", "rodandoMetaAds", "semAgendamentoOnline", "semSchema", "blogParado", "semSite"] as const;

/** PURA. Aceita só o que tem a forma exata de `SinaisDoSite`; qualquer outra coisa é `null` (o cache é descartado). */
export function sinaisValidos(bruto: unknown): SinaisDoSite | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const saida: SinaisDoSite = { ...SEM_FONTE };
  for (const chave of CHAVES_DE_SINAL) {
    const v = o[chave];
    if (v !== true && v !== false && v !== null) return null;
    saida[chave] = v as Sinal;
  }
  const a = o.agencia;
  if (a !== undefined) {
    if (!a || typeof a !== "object") return null;
    const { nome, confianca } = a as Record<string, unknown>;
    if (typeof nome !== "string" || !nome.trim() || nome.length > 120 || typeof confianca !== "number" || !(confianca >= CONFIANCA_MINIMA_DA_AGENCIA && confianca <= 1)) return null;
    saida.agencia = { nome, confianca };
  }
  // Agência registrada e sinal contraditório: dado corrompido.
  if ((saida.temAgencia === true) !== (saida.agencia !== undefined)) return null;
  return saida;
}
