/**
 * PURO (17/10/2026): o gate de pré-envio das mensagens de venda. Ideia do Harvey (ethanplusai/harvey,
 * MIT): antes de a mensagem sair, uma conferência SEM modelo recusa a que está quebrada. Aqui nada é
 * enviado pelo sistema (o Rômulo toca em "Abrir no WhatsApp"), então o gate decide se a mensagem
 * ainda vale ser oferecida (Copiar, botão do Telegram) e o que o aviso diz.
 *
 * O que ele confere, sempre no texto já pronto:
 *  - marca de modelo que ninguém preencheu ({{x}}, {x}, [NOME], %s, undefined, null, NaN, [object Object]);
 *  - frase proibida: os "tells" de texto de IA e de agência (o guia no topo das VARIACOES de
 *    deploy/dell/claude-ops/site-mensagem.js e o TOM_DE_VOZ de src/operations/copiloto.ts), e emoji;
 *  - tamanho e número de links por tipo de mensagem;
 *  - o nome da empresa vazio, com lixo ou repetido;
 *  - o número do wa.me contra o do registro do lead (DDD + 8 últimos dígitos, como a conversa);
 *  - "R$" fora dos preços permitidos (a regra do copiloto, reaproveitada: precosProibidos).
 *
 * O gate NUNCA reescreve o texto e NUNCA envia nada. `modo` diz o que o chamador faz com o
 * problema: "bloquear" (saída do modelo: não oferece a mensagem) ou "avisar" (modelo estático: só
 * mostra o aviso, o botão continua). Uma exceção de propósito: mandar para o número errado não é
 * questão de estilo, então `destinatario_diferente` bloqueia em qualquer modo.
 *
 * Sem relógio, env, fetch ou arquivo: só os helpers puros que o resto do CRM já usa.
 *
 * Fonte única desde 19/10/2026: a cópia em JS que o Balcão do n8n rodava em modo "avisar" só
 * escrevia uma coluna que ninguém lia e saiu. A 1ª mensagem é conferida aqui, quando a Central ou o
 * vendedor do Telegram a oferecem (frente-comercial.ts, vendedor.ts).
 */
import { PRECOS_DO_CARDAPIO, normalizar } from "../src/operations/colinha.ts";
import { precosProibidos } from "../src/operations/copiloto.ts";
import { chaveDoNumero } from "./conversa-do-lead.ts";

export type ModoDoGate = "bloquear" | "avisar";

/**
 * O tipo manda no tamanho, nos links e em "conforme conversamos":
 *  primeiro (1º contato, sem link), segunda (o link depois do "pode mandar"), followup, reenvio
 *  (o pedido ao responsável, depois do só-robô), conversa (a resposta do copiloto/da fila a uma
 *  conversa aberta) e proposta (itens e preços do cardápio).
 */
export type TipoDeMensagem = "primeiro" | "segunda" | "followup" | "reenvio" | "conversa" | "proposta";

export type CodigoDoProblema =
  | "vazio"
  | "marca_nao_renderizada"
  | "frase_proibida"
  | "emoji"
  | "longa_demais"
  | "links_demais"
  | "nome_invalido"
  | "destinatario_diferente"
  | "preco_fora_do_cardapio";

export interface ProblemaDoGate {
  codigo: CodigoDoProblema;
  /** O pedaço do texto que causou o problema, quando há um. */
  trecho?: string;
  /** Curto, em pt-BR, para o aviso. */
  motivo: string;
}

export interface ContextoDoGate {
  modo: ModoDoGate;
  tipo: TipoDeMensagem;
  /** O nome da empresa como o lead está no registro: quando vem, é conferido (vazio, lixo, repetido). */
  nome?: string;
  /** O wa.me da mensagem (`link`) e o WhatsApp do registro do lead (`registro`); só compara se os dois têm número. */
  destino?: { link?: string; registro?: string };
  /** Já houve conversa? Sem ela, "conforme conversamos" é mentira. Padrão pelo tipo (TIPOS_SEM_CONVERSA). */
  houveConversa?: boolean;
  /**
   * Texto que a Ficha mostra para o Rômulo completar à mão (a colinha, o texto base da proposta):
   * os [colchetes] ficam, as outras marcas não.
   */
  colchetesParaCompletar?: boolean;
  /** Os "R$" que podem aparecer. Padrão: os preços abertos do cardápio (a proposta usa todos os do cardápio). */
  precosPermitidos?: readonly string[];
  maxCaracteres?: number;
  maxLinks?: number;
}

export interface ResultadoDoGate {
  /** Nenhum problema. */
  ok: boolean;
  /** O chamador não deve oferecer/enviar a mensagem: há problema em modo "bloquear", ou um que bloqueia sempre. */
  bloqueia: boolean;
  modo: ModoDoGate;
  problemas: ProblemaDoGate[];
}

/**
 * Os limites vêm dos textos de hoje (maior em 17/10/2026, com a folga de ~50%): 1ª mensagem 343,
 * segunda 555 (a do raio-x com o demo), follow-up 223, reenvio ~300, proposta 533 de modelo (o rascunho
 * do copiloto soma itens, daí 2000). A conversa do copiloto corta em 1500 (MAX_MENSAGEM); 1200 já é
 * texto longo para o WhatsApp.
 */
export const LIMITES: Record<TipoDeMensagem, { caracteres: number; links: number }> = {
  primeiro: { caracteres: 600, links: 0 },
  segunda: { caracteres: 850, links: 2 },
  followup: { caracteres: 500, links: 2 },
  reenvio: { caracteres: 500, links: 0 },
  conversa: { caracteres: 1200, links: 2 },
  proposta: { caracteres: 2000, links: 1 },
};

/** Quem escreve nestes tipos ainda não conversou com o lead (o 1º contato, o follow-up de quem não respondeu, o reenvio ao responsável). */
export const TIPOS_SEM_CONVERSA: ReadonlySet<TipoDeMensagem> = new Set(["primeiro", "followup", "reenvio"]);

/** Todo "R$" que pode estar numa proposta: a tabela inteira (serviço sob proposta leva "a partir de"). */
export const PRECOS_DA_PROPOSTA: readonly string[] = PRECOS_DO_CARDAPIO;

// ------------------------------------------------------------------ marcas de modelo

// Exportadas (18/10/2026): o teste do gate as lê. A cópia em JS do Balcão saiu em 19/10 (o Balcão não barra mais nada).
export const MARCAS: Array<{ regex: RegExp; colchete?: true }> = [
  { regex: /\{\{[^}\n]*\}\}/ },
  { regex: /\$\{[^}\n]*\}/ },
  { regex: /\{[^{}\n]{1,40}\}/ },
  // %s, %d e %(nome)s de formatação; "50%" e "100% dos" não casam (exige letra colada e não dígito antes).
  { regex: /(?<![\w%])%(?:\([A-Za-z_]+\))?[sd]\b/ },
  { regex: /<[A-Za-z_][A-Za-z0-9_ ]{1,30}>/ },
  { regex: /\[object Object\]/ },
  { regex: /\[[^\]\n]{1,60}\]/, colchete: true },
  { regex: /\b(?:undefined|null|NaN)\b/ },
  // NOME_CONTATO, RAIO_X, O_A: o nome de variável que vazou.
  { regex: /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/ },
];

// ------------------------------------------------------------------ frases proibidas

/**
 * Regex sobre o texto `normalizar`ado (minúsculo, sem acento). A lista sai do guia de redação do
 * site-mensagem.js (sem apresentação de agência, sem "do PRUMO" à toa, saída fácil sempre igual), do
 * TOM_DE_VOZ do copiloto (sem trio de vendedor, sem "depende do dono") e do jeito de texto gerado
 * que o guia evita ("espero que esteja bem", "venho por meio desta", "passando para").
 */
export const FRASES_PROIBIDAS: Array<{ regex: RegExp; motivo: string }> = [
  { regex: /espero que (?:voce |vc |tudo )?(?:esteja|estejam)\b|espero que (?:esta|essa) mensagem|espero que (?:este|esse) (?:e-?mail|contato)/, motivo: "abertura de texto de IA" },
  { regex: /gostaria de (?:entrar em contato|me apresentar|apresentar)/, motivo: "abertura de texto de IA" },
  { regex: /venho (?:por meio|atraves|por esta|por essa)/, motivo: "abertura de ofício" },
  { regex: /\bpassando (?:aqui )?para\b/, motivo: "abertura de vendedor" },
  { regex: /\b(?:prezad[oa]s?|estimad[oa]s?)\b/, motivo: "tratamento de ofício" },
  { regex: /\b(?:atenciosamente|cordialmente)\b/, motivo: "fecho de ofício" },
  { regex: /nao hesite em|fico a disposicao para qualquer|qualquer duvida estou a disposicao/, motivo: "fecho de texto de IA" },
  { regex: /aqui esta a mensagem|segue a mensagem|mensagem sugerida|como (?:uma )?(?:ia|inteligencia artificial|modelo de linguagem|assistente virtual)\b/, motivo: "sobra de texto de IA" },
  // O trio de vendedor que o TOM_DE_VOZ proíbe. "Sem custo" ficou de fora: a colinha (o convite do Mapa,
  // que é grátis) o usa de verdade, então seria falso-positivo.
  { regex: /numero limitado|(?:so|apenas) 2 minutos|oferta imperdivel/, motivo: "gatilho de vendedor" },
  // O que o tom do PRUMO nunca diz (TOM_DE_VOZ).
  { regex: /depende do dono|centralizador|merito seu/, motivo: "fala que o PRUMO evita" },
];

export const CONVERSA_QUE_NAO_HOUVE = /\b(?:conforme|como) (?:conversamos|combinamos|falamos|combinado)\b|conforme nossa conversa/;

export const EMOJI = /\p{Extended_Pictographic}/u;

// ------------------------------------------------------------------ links e nomes

export const LINK = /(?:https?:\/\/|www\.|wa\.me\/)\S+/gi;

/** O número do destino de um wa.me / api.whatsapp.com; '' = o link não leva número. */
export function numeroDoLink(url: string | undefined): string {
  const t = url ?? "";
  return /wa\.me\/(\d+)/.exec(t)?.[1] ?? /[?&]phone=(\d+)/.exec(t)?.[1] ?? "";
}

function problemasDoNome(nome: string, texto: string): ProblemaDoGate[] {
  const n = nome.trim();
  if (!n) return [{ codigo: "nome_invalido", motivo: "o nome da empresa está vazio" }];
  const lixo = /[\u0000-\u001f<>{}[\]\\]|https?:|www\.|@|\b(?:undefined|null|NaN)\b/i.test(n) || !/\p{L}{2}/u.test(n);
  if (lixo) return [{ codigo: "nome_invalido", trecho: n.slice(0, 40), motivo: "o nome da empresa tem lixo" }];
  // Separadores de título são legítimos; conectivos fazem parte da sequência
  // real do nome ("Franco e Franco" não equivale a "Franco Franco").
  const palavras = normalizar(n).split(/[\s,.;:|–—-]+/).filter(Boolean);
  const repetida = palavras.find((p, i) => p.length >= 3 && i > 0 && p === palavras[i - 1]);
  if (repetida) return [{ codigo: "nome_invalido", trecho: n.slice(0, 40), motivo: "o nome da empresa repete a palavra" }];
  const vezes = normalizar(texto).split(normalizar(n)).length - 1;
  if (vezes > 2) return [{ codigo: "nome_invalido", trecho: n.slice(0, 40), motivo: "o nome da empresa aparece demais na mensagem" }];
  return [];
}

// ------------------------------------------------------------------ o gate

/** Códigos que bloqueiam mesmo em "avisar": o erro não é de estilo, é mandar para a pessoa errada. */
export const CODIGOS_QUE_BLOQUEIAM_SEMPRE: ReadonlySet<CodigoDoProblema> = new Set(["destinatario_diferente"]);

/**
 * PURO. Confere a mensagem pronta contra o contexto. Mesmo texto e mesmo contexto, mesmo resultado.
 * Os problemas vêm na ordem do tipo (vazio, marca, frase, emoji, tamanho, links, nome, destino, preço).
 */
export function conferirMensagem(texto: string, contexto: ContextoDoGate): ResultadoDoGate {
  const problemas: ProblemaDoGate[] = [];
  const t = typeof texto === "string" ? texto : "";
  const limpo = t.trim();

  if (!limpo) {
    problemas.push({ codigo: "vazio", motivo: "a mensagem está vazia" });
  } else {
    // (a) marca que ninguém preencheu
    const marcas = new Set<string>();
    for (const { regex, colchete } of MARCAS) {
      if (colchete && contexto.colchetesParaCompletar) continue;
      for (const m of limpo.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`))) marcas.add(m[0]);
    }
    for (const m of marcas) problemas.push({ codigo: "marca_nao_renderizada", trecho: m.slice(0, 40), motivo: `marca sem preencher: ${m.slice(0, 40)}` });

    // (b) frase proibida e emoji
    const norm = normalizar(limpo);
    for (const { regex, motivo } of FRASES_PROIBIDAS) {
      const achou = regex.exec(norm);
      if (achou) problemas.push({ codigo: "frase_proibida", trecho: achou[0].slice(0, 40), motivo: `${motivo}: “${achou[0].slice(0, 40)}”` });
    }
    const semConversa = contexto.houveConversa === undefined ? TIPOS_SEM_CONVERSA.has(contexto.tipo) : !contexto.houveConversa;
    if (semConversa) {
      const achou = CONVERSA_QUE_NAO_HOUVE.exec(norm);
      if (achou) problemas.push({ codigo: "frase_proibida", trecho: achou[0], motivo: `fala de uma conversa que não houve: “${achou[0]}”` });
    }
    const emoji = EMOJI.exec(limpo);
    if (emoji) problemas.push({ codigo: "emoji", trecho: emoji[0], motivo: "emoji (o tom do PRUMO não usa)" });

    // (c) tamanho e (d) links
    const limite = LIMITES[contexto.tipo];
    const maxCaracteres = contexto.maxCaracteres ?? limite.caracteres;
    if (limpo.length > maxCaracteres) problemas.push({ codigo: "longa_demais", motivo: `${limpo.length} caracteres, o máximo é ${maxCaracteres}` });
    const links = limpo.match(LINK) ?? [];
    const maxLinks = contexto.maxLinks ?? limite.links;
    if (links.length > maxLinks) problemas.push({ codigo: "links_demais", trecho: links[maxLinks]?.slice(0, 60), motivo: `${links.length} links, o máximo é ${maxLinks}` });

    // (g) "R$" fora dos permitidos (a regra do copiloto, com a lista do contexto)
    const permitidos = contexto.precosPermitidos ?? (contexto.tipo === "proposta" ? PRECOS_DA_PROPOSTA : undefined);
    const fora = precosProibidos(limpo, permitidos ? [...permitidos] : undefined);
    if (fora.length) problemas.push({ codigo: "preco_fora_do_cardapio", trecho: fora[0], motivo: `valor fora do cardápio: ${fora.join(", ")}` });
  }

  // (e) o nome da empresa
  if (contexto.nome !== undefined) problemas.push(...problemasDoNome(contexto.nome, limpo));

  // (f) o destinatário: só compara com os dois números legíveis (o link do n8n, por exemplo, não leva número)
  const doLink = chaveDoNumero(numeroDoLink(contexto.destino?.link));
  const doRegistro = chaveDoNumero(numeroDoLink(contexto.destino?.registro) || contexto.destino?.registro);
  if (doLink && doRegistro && doLink !== doRegistro) {
    problemas.push({ codigo: "destinatario_diferente", motivo: "o número do link não é o do registro do lead" });
  }

  const bloqueia = problemas.some((p) => contexto.modo === "bloquear" || CODIGOS_QUE_BLOQUEIAM_SEMPRE.has(p.codigo));
  return { ok: problemas.length === 0, bloqueia, modo: contexto.modo, problemas };
}

/** PURO. Os motivos numa frase só, para o aviso ou o log ("marca sem preencher: [nome]; 2 links, o máximo é 0"). */
export function resumoDosProblemas(problemas: readonly ProblemaDoGate[]): string {
  return problemas.map((p) => p.motivo).join("; ");
}
