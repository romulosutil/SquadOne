/**
 * O agente que mantém o lead quente — SÓ A DECISÃO, em sombra (17/10/2026, decisão do Rômulo: ele
 * segue fazendo o primeiro contato e mandando o primeiro link; um agente cuida do lead DEPOIS que o
 * link saiu e o lead escreve de novo). Nesta fase o agente não envia nada: para cada mensagem nova de
 * lead ele decide `responder`, `escalar` ou `calar`, e a cola (server/lead-quente-sombra.ts) só grava a
 * decisão e avisa o Rômulo no Telegram ("Eu teria respondido…", "Eu teria escalado…"). O que a sombra
 * mede é se, no dia em que houver envio, o gate teria acertado.
 *
 * PURO (sem fetch, relógio, env, disco): o instante vem em `agora`, a conversa em `mensagens`, a
 * sugestão do copiloto (que já validou ids do cardápio, R$ e números do dossiê) em `sugestao`. O texto
 * de uma resposta é SEMPRE o do copiloto, nunca de uma geração nova daqui: o agente não escreve, escolhe.
 *
 * O gate é estrito de propósito. Errar para o lado de calar ou escalar custa um aviso no Telegram;
 * errar para o lado de responder custa um lead falando com um robô no momento em que ele estava quente
 * (e o número é o mesmo do Hermes, que já levou restrição do WhatsApp em 15/10/2026).
 */
import { audioDaMensagem } from "../src/operations/marcadores-da-conversa.ts";
import { precosProibidos, type MomentoDaConversa } from "../src/operations/copiloto.ts";
import type { CrmLead } from "../src/operations/types.ts";
import type { MensagemDaConversa } from "./conversa-do-lead.ts";
import { normalizarParaRegra, omitirValores, temValorEmDinheiro } from "./financas/parece-financas.ts";

// ---------------------------------------------------------------- constantes

/** A mensagem (ou a rajada sem resposta) de um lead que o agente aceita responder: acima disto é conversa, não gesto. */
export const MAX_CARACTERES_DA_MENSAGEM = 160;
/** Quantas mensagens seguidas, sem resposta, ainda contam como "uma" para o agente. */
export const MAX_MENSAGENS_NA_RAJADA = 3;
/** Depois de uma mensagem nossa escrita à mão (depois do link), o agente cala por tanto tempo. */
export const HORAS_DE_CALAR_PADRAO = 6;
/** O copiloto leva de 30 s a 2 min; passado isto sem sugestão, o agente desiste e passa o lead ao Rômulo. */
export const ESPERA_DA_SUGESTAO_MS = 5 * 60_000;
/** Mensagem de lead mais velha que isto não é "nova": o Rômulo já viu, e a sombra não ressuscita o passado. */
export const IDADE_MAXIMA_DA_MENSAGEM_MS = 24 * 3600_000;
/** Respostas do agente seguidas, sem o Rômulo escrever, antes de passar o lead para ele. */
export const MAX_RESPOSTAS_SEGUIDAS = 2;
/** Os follow-ups de quem NÃO responde (fase de envio, ainda não ligada): um depois do link, um depois do 3º dia. */
export const MAX_FOLLOWUP_DEPOIS_DO_LINK = 1;
export const MAX_FOLLOWUP_DO_TERCEIRO_DIA = 1;

// ---------------------------------------------------------------- tipos

export type AcaoDoLeadQuente = "responder" | "escalar" | "calar";

export type MotivoDeEscalar =
  | "preco"
  | "proposta"
  | "fechar"
  | "humano"
  | "objecao"
  | "audio"
  | "irritacao"
  | "sinal-negativo"
  | "recepcao"
  | "licenca"
  | "mensagem-longa"
  | "na-proposta"
  | "preco-na-mensagem"
  | "fora-do-dossie"
  | "sem-sugestao"
  | "teto-de-toques";

export type MotivoDeCalar =
  /** Nada guardado da conversa, ou a última mensagem é nossa, ou só o robô falou. */
  | "sem-novidade"
  /** Lead novo, ganho ou perdido: não é o trecho do agente. */
  | "etapa"
  /** Já decidida (a mesma chave do vendedor: lead|responder|ultimaEntrada). */
  | "ja-decidida"
  /** O lead escreveu antes do link sair: o passo é do Rômulo (mandar o link). */
  | "antes-do-link"
  /** Ele escreveu à mão depois do link, há pouco: está na conversa. */
  | "romulo-assumiu"
  /** Recusa ou exclusão: o fluxo é o do desfecho, não o de manter quente. */
  | "negativa"
  /** Resposta automática de robô. */
  | "robo"
  /** `neutra` ou sem classificação: não há interesse dito para manter quente. */
  | "sem-interesse";

/** O calar que não é uma decisão (nada mudou): a cola não grava. */
export const CALAR_SEM_REGISTRO: ReadonlySet<MotivoDeCalar> = new Set(["sem-novidade", "etapa", "ja-decidida", "antes-do-link"]);

export type DecisaoDoLeadQuente =
  | { acao: "responder"; chave: string; texto: string; avisos: string[] }
  | { acao: "escalar"; chave: string; motivo: MotivoDeEscalar }
  | { acao: "calar"; chave: string | null; motivo: MotivoDeCalar }
  /** A sugestão do copiloto ainda não saiu: volta na próxima volta. Nunca é gravada. */
  | { acao: "aguardar"; chave: string };

/** A sugestão do copiloto como o agente a lê: já conferida contra o dossiê de agora (copiloto.prontas). */
export interface SugestaoParaOLeadQuente {
  mensagem: string;
  /** Os avisos do copiloto ("confira: 500 não aparece no dossiê", oferta em "não oferecer"...). */
  avisos?: readonly string[];
  /** Itens de proposta que o copiloto montou: se há, a conversa é de proposta, não de manter quente. */
  itensDeProposta?: number;
  momento?: Pick<MomentoDaConversa, "quem">;
}

export type TipoDeToque = "resposta" | "depois-do-link" | "terceiro-dia";

/** Uma resposta do agente (sombra: a que ele teria dado), para o teto de toques. */
export interface ToqueDoAgente {
  em: number;
  tipo: TipoDeToque;
}

export type LeadParaOAgente = Pick<CrmLead, "id" | "etapa" | "conversa"> & Partial<Pick<CrmLead, "resposta" | "perdaManual">>;

export interface EntradaDoLeadQuente {
  lead: LeadParaOAgente;
  /** A conversa guardada, da mais antiga para a mais nova (lerLinhasDaConversa já ordena). */
  mensagens: readonly MensagemDaConversa[] | null | undefined;
  sugestao: SugestaoParaOLeadQuente | null;
  agora: number;
  /** Chaves já decididas (do JSONL): o mesmo dedupe do vendedor. */
  jaDecididas: ReadonlySet<string>;
  /** As respostas que o agente já deu a este lead. */
  toques?: readonly ToqueDoAgente[];
  /** Padrão: HORAS_DE_CALAR_PADRAO. */
  horasDeCalar?: number;
}

// ---------------------------------------------------------------- a mensagem pendente

export interface Pendente {
  /** As mensagens de gente (lead ou recepção) depois da última nossa, da mais antiga para a mais nova. */
  rajada: MensagemDaConversa[];
  /** A mais nova: o instante da chave. */
  ultimaEntrada: string;
}

/**
 * PURO. A mensagem do lead que está sem resposta nossa: as entradas de gente depois da última saída
 * (o robô não conta, como em resumirConversa). null = não há (a última coisa dita foi nossa, ou só o
 * robô falou, ou não há conversa).
 */
export function pendenteDaConversa(mensagens: readonly MensagemDaConversa[] | null | undefined): Pendente | null {
  if (!mensagens?.length) return null;
  let ultimaSaida = -Infinity;
  for (const m of mensagens) if (m.direcao === "saida") ultimaSaida = Math.max(ultimaSaida, Date.parse(m.em));
  const rajada = mensagens.filter((m) => m.direcao === "entrada" && m.papel !== "robo" && Date.parse(m.em) > ultimaSaida);
  if (!rajada.length) return null;
  return { rajada, ultimaEntrada: new Date(rajada[rajada.length - 1].em).toISOString() };
}

/** A chave de dedupe: a MESMA do vendedor e da Próxima venda (src/operations/proxima-venda.ts, acaoDoItem). */
export const chaveDoLeadQuente = (leadId: string, ultimaEntrada: string): string => `${leadId}|responder|${ultimaEntrada}`;

// ---------------------------------------------------------------- sinais no texto

// Sem acento e em minúsculas (normalizarParaRegra): o lead escreve "preço", "preco" e "PREÇO" de três jeitos.
// Cada lista erra para o lado de escalar: um aviso a mais no Telegram custa um toque; um agente respondendo
// a um pedido de preço ou a um lead irritado custa o lead (e o número).
const SINAIS: ReadonlyArray<[MotivoDeEscalar, RegExp]> = [
  // A irritação vem antes de tudo: "para de me mandar proposta" é irritação, não pedido de proposta.
  ["irritacao", /\b(?:par[ae]r? de (?:me )?(?:mandar|enviar|chamar|incomodar|insistir)|ja chega|chega de|incomod\w+|spam|insist\w+|enche\w*|chat[oa]s?|que saco|absurdo|palhac\w+|ridicul\w+|onde (?:voce )?(?:conseguiu|pegou|achou) (?:o )?meu (?:numero|contato)|como (?:voce )?(?:conseguiu|conseguiram|pegou) (?:o )?meu (?:numero|contato)|denunci\w+|procon|lgpd|porra|caralho|merda|bloque\w+|nao me (?:chame|procure|mande|envie)|me tir[ae] d\w+)\b/],
  ["sinal-negativo", /\b(?:nao (?:quero|tenho interesse|tenho necessidade|me interessa|vou querer|vou contratar|preciso|e pra mim|e para mim)|sem interesse|nao precisa|dispenso|desisti|desistir|cancel\w+|descadastr\w+|remov\w+|sair da lista|nao (?:mande|manda|envie|envia) mais|pode parar|ja disse que nao|obrigad[oa],? mas nao)\b/],
  ["fechar", /\b(?:fechar|fechado|fechamos|fechou|vamos fechar|pode fechar|quero contratar|quero comecar|vamos comecar|pode comecar|aceito|topo|como (?:eu )?pago|forma de pagamento|pagamento|pix|boleto|assinar|vamos nessa|bora fechar)\b/],
  ["humano", /\b(?:ligar|ligacao|me liga|liga pra mim|telefone|chamada|reuniao|videochamada|call|meet|zoom|marcar (?:uma )?(?:conversa|horario|reuniao|visita)|falar com (?:alguem|uma pessoa|voce|um humano|o dono|a dona|o responsavel)|atendente|humano|pessoalmente|visita|visitar)\b/],
  ["preco", /\b(?:quanto|valor(?:es)?|preco\w*|custa\w*|custo\w*|cobr\w+|tabela|investimento|mensalidade|reais|parcel\w*)\b/],
  ["proposta", /\b(?:propost\w*|contrato|orcamento|apresentacao)\b/],
  ["objecao", /\b(?:(?:muito|bem|meio|bastante|achei|esta|ta|e|ficou|fica) caro|salgado|apertado|sem (?:orcamento|verba|grana|dinheiro|tempo)|nao tenho (?:orcamento|verba|tempo|dinheiro)|ja (?:tenho|temos|uso|faco|trabalho com)|vou pensar|preciso pensar|deixa eu (?:ver|pensar)|mais pra frente|mais para frente|talvez|nao sei se|concorrente|outra empresa|outro fornecedor|funciona mesmo|garantia|desconfi\w+|golpe|e confiavel)\b/],
];

const SIMBOLO_DE_REAL = /\br\s*\$/;

/** PURO. O primeiro motivo de escalar que o texto dispara, na ordem de SINAIS; null = nenhum. */
export function sinalNoTexto(texto: string): MotivoDeEscalar | null {
  const t = normalizarParaRegra(texto);
  if (SIMBOLO_DE_REAL.test(t)) return "preco";
  for (const [motivo, re] of SINAIS) if (re.test(t)) return motivo;
  return null;
}

/** PURO. Só a negativa: o que a regra "sem negativa nas últimas mensagens" confere nas 3 últimas de gente. */
export function temSinalNegativo(texto: string): boolean {
  const m = sinalNoTexto(texto);
  return m === "sinal-negativo" || m === "irritacao";
}

// ---------------------------------------------------------------- o teto de toques

export type RespostaDoTeto = { pode: true } | { pode: false; motivo: string };

/**
 * PURO. O agente pode tocar este lead agora? O teto de 17/10/2026:
 * - "resposta" (reativo, ao que o lead escreveu): até MAX_RESPOSTAS_SEGUIDAS sem o Rômulo escrever à mão
 *   no meio; a terceira passa o lead a ele;
 * - "depois-do-link" e "terceiro-dia" (follow-up de quem não respondeu, FASE DE ENVIO, ainda sem laço que
 *   os dispare): um de cada, e nunca dois toques seguidos do agente sem uma mensagem do lead no meio.
 * `mensagens` dá o que o lead e o Rômulo disseram; o agente (ainda) não escreve nelas.
 */
export function podeTocar(tipo: TipoDeToque, toques: readonly ToqueDoAgente[], mensagens: readonly MensagemDaConversa[] | null | undefined): RespostaDoTeto {
  const msgs = mensagens ?? [];
  const ultima = (direcao: "entrada" | "saida") =>
    msgs.reduce((maior, m) => (m.direcao === direcao && m.papel !== "robo" ? Math.max(maior, Date.parse(m.em)) : maior), -Infinity);
  if (tipo === "resposta") {
    // O Rômulo escreveu à mão por último? Zera a contagem: ele está na conversa.
    const desdeOMolde = ultima("saida");
    const seguidos = toques.filter((t) => t.tipo === "resposta" && t.em > desdeOMolde).length;
    return seguidos >= MAX_RESPOSTAS_SEGUIDAS ? { pode: false, motivo: `${seguidos} respostas seguidas sem o Rômulo` } : { pode: true };
  }
  const semResposta = toques.filter((t) => t.em > ultima("entrada")).length;
  if (semResposta > 0) return { pode: false, motivo: "o último toque ainda não foi respondido" };
  const ja = toques.filter((t) => t.tipo === tipo).length;
  const teto = tipo === "depois-do-link" ? MAX_FOLLOWUP_DEPOIS_DO_LINK : MAX_FOLLOWUP_DO_TERCEIRO_DIA;
  return ja >= teto ? { pode: false, motivo: `já houve ${ja} follow-up ${tipo === "depois-do-link" ? "depois do link" : "do 3º dia"}` } : { pode: true };
}

// ---------------------------------------------------------------- a decisão

/** PURO. A saída do Rômulo escrita à mão depois do link, dentro da janela de calar. */
function romuloAssumiu(mensagens: readonly MensagemDaConversa[], linkEm: number, agora: number, horas: number): boolean {
  return mensagens.some((m) => m.direcao === "saida" && Date.parse(m.em) > linkEm && agora - Date.parse(m.em) < horas * 3600_000);
}

const naoAcha = (motivo: MotivoDeCalar, chave: string | null = null): DecisaoDoLeadQuente => ({ acao: "calar", chave, motivo });

/**
 * PURO. A decisão do agente para um lead. A ordem importa e cada degrau é uma razão de não seguir:
 * 1. nada novo a responder, ou o lead não é do trecho do agente (antes do link, etapa);
 * 2. já decidida; o Rômulo está na conversa; recusa e robô (o fluxo é outro);
 * 3. sinais no texto que pedem um humano (irritação, áudio, preço, proposta, fechar, ligação, objeção);
 * 4. o gate de `responder`: classificado `interesse`, mensagem curta, sem negativa nas 3 últimas, teto de
 *    toques, sugestão do copiloto válida, sem preço no texto, sem aviso do copiloto.
 */
export function decidirLeadQuente(e: EntradaDoLeadQuente): DecisaoDoLeadQuente {
  const mensagens = e.mensagens ?? [];
  const pendente = pendenteDaConversa(mensagens);
  if (!pendente) return naoAcha("sem-novidade");
  const chave = chaveDoLeadQuente(e.lead.id, pendente.ultimaEntrada);
  const idade = e.agora - Date.parse(pendente.ultimaEntrada);
  if (idade > IDADE_MAXIMA_DA_MENSAGEM_MS || idade < -60_000) return naoAcha("sem-novidade", chave);
  if (e.lead.perdaManual || (e.lead.etapa !== "contato" && e.lead.etapa !== "proposta")) return naoAcha("etapa", chave);
  if (e.jaDecididas.has(chave)) return naoAcha("ja-decidida", chave);

  // O agente começa DEPOIS do link: antes dele o passo é do Rômulo (o vendedor já avisa o "quero ver").
  const linkEm = Date.parse(e.lead.conversa?.linkEm ?? "");
  if (!Number.isFinite(linkEm) || Date.parse(pendente.rajada[0].em) <= linkEm) return naoAcha("antes-do-link", chave);
  if (romuloAssumiu(mensagens, linkEm, e.agora, e.horasDeCalar ?? HORAS_DE_CALAR_PADRAO)) return naoAcha("romulo-assumiu", chave);

  const tipo = e.lead.resposta?.tipo;
  if (tipo === "negativa" || tipo === "exclusao") return naoAcha("negativa", chave);
  if (tipo === "bot") return naoAcha("robo", chave);

  const escalar = (motivo: MotivoDeEscalar): DecisaoDoLeadQuente => ({ acao: "escalar", chave, motivo });

  // Áudio: o conteúdo é desconhecido (ou transcrito por um sistema que o agente não conferiu).
  if (pendente.rajada.some((m) => audioDaMensagem(m.texto))) return escalar("audio");
  // Quem respondeu foi a recepção: chegar a quem decide é trabalho de gente.
  if (pendente.rajada.some((m) => m.papel === "recepcao")) return escalar("recepcao");
  const textoDaRajada = pendente.rajada.map((m) => m.texto).join("\n");
  const sinal = sinalNoTexto(textoDaRajada);
  if (sinal) return escalar(sinal);
  // A negativa vale nas 3 últimas de gente, não só na pendente: "não quero" três mensagens atrás não some com um "ok".
  const ultimasDeGente = mensagens.filter((m) => m.direcao === "entrada" && m.papel !== "robo").slice(-3);
  if (ultimasDeGente.some((m) => temSinalNegativo(m.texto))) return escalar("sinal-negativo");
  if (tipo === "licenca") return escalar("licenca");
  if (e.lead.etapa === "proposta") return escalar("na-proposta");
  // `neutra` ("ok", "obrigado") e sem classificação: não há interesse dito, nada a manter quente.
  if (tipo !== "interesse") return naoAcha("sem-interesse", chave);

  // ---- o gate de responder
  const tamanho = pendente.rajada.reduce((s, m) => s + m.texto.trim().length, 0);
  if (pendente.rajada.length > MAX_MENSAGENS_NA_RAJADA || tamanho > MAX_CARACTERES_DA_MENSAGEM) return escalar("mensagem-longa");
  const toques = e.toques ?? [];
  if (!podeTocar("resposta", toques, mensagens).pode) return escalar("teto-de-toques");

  if (!e.sugestao) {
    return e.agora - Date.parse(pendente.ultimaEntrada) < ESPERA_DA_SUGESTAO_MS ? { acao: "aguardar", chave } : escalar("sem-sugestao");
  }
  const { mensagem, avisos = [], itensDeProposta = 0, momento } = e.sugestao;
  const texto = mensagem.trim();
  if (!texto) return escalar("sem-sugestao");
  if (momento?.quem === "robo") return naoAcha("robo", chave);
  if (momento?.quem === "recepcao") return escalar("recepcao");
  if (momento?.quem === "nao_sei") return escalar("fora-do-dossie");
  if (itensDeProposta > 0) return escalar("proposta");
  // Nenhum valor em dinheiro numa resposta do agente, nem os preços abertos do cardápio: preço é o Rômulo.
  if (temValorEmDinheiro(texto) || precosProibidos(texto).length) return escalar("preco-na-mensagem");
  if (avisos.length) return escalar("fora-do-dossie");
  return { acao: "responder", chave, texto, avisos: [] };
}

// ---------------------------------------------------------------- o aviso do Telegram

export const FRASE_DO_MOTIVO: Record<MotivoDeEscalar, string> = {
  preco: "pediu preço",
  proposta: "pediu proposta",
  fechar: "quer fechar",
  humano: "pediu para falar com uma pessoa",
  objecao: "levantou uma objeção",
  audio: "mandou áudio",
  irritacao: "parece irritado",
  "sinal-negativo": "disse algo que parece recusa",
  recepcao: "foi a recepção quem respondeu",
  licenca: "liberou o material",
  "mensagem-longa": "escreveu bastante",
  "na-proposta": "respondeu depois da proposta",
  "preco-na-mensagem": "a resposta pronta leva valor em dinheiro",
  "fora-do-dossie": "a resposta pronta tem pontos fora do dossiê",
  "sem-sugestao": "o copiloto não preparou resposta",
  "teto-de-toques": "o agente já respondeu duas vezes sem você",
};

export const FRASE_DO_CALAR: Record<MotivoDeCalar, string> = {
  "sem-novidade": "nada novo",
  etapa: "etapa fora do trecho do agente",
  "ja-decidida": "já decidida",
  "antes-do-link": "antes do link",
  "romulo-assumiu": "você escreveu à mão há pouco",
  negativa: "recusa ou exclusão",
  robo: "resposta automática",
  "sem-interesse": "sem interesse dito",
};

/** Um nome de empresa pode trazer qualquer coisa; o aviso leva só o começo e nenhum valor. */
const nomeSeguro = (empresa: string): string => omitirValores(empresa.replace(/\s+/g, " ").trim()).slice(0, 80) || "Lead";

/**
 * PURO. O texto do aviso (texto puro, como todo o bot). `responder` mostra a resposta inteira, que já
 * passou pelo gate (sem valor em dinheiro); `escalar` leva só o motivo, nunca a mensagem do lead.
 */
export function textoDoAvisoLeadQuente(empresa: string, d: Extract<DecisaoDoLeadQuente, { acao: "responder" | "escalar" }>): string {
  const nome = nomeSeguro(empresa);
  if (d.acao === "responder") {
    return [`🤖 Sombra: eu teria respondido a ${nome}:`, "", d.texto, "", "Nada foi enviado. Ele estava mesmo quente?"].join("\n");
  }
  return [`🙋 Sombra: eu teria escalado ${nome} (${FRASE_DO_MOTIVO[d.motivo]}): assuma.`, "", "Nada foi enviado. Escalar fazia sentido?"].join("\n");
}

// ---------------------------------------------------------------- a medida

/** O que a cola grava, uma linha por registro, no JSONL do mês. Sem telefone e sem a mensagem do lead. */
export interface RegistroDeDecisao {
  tipo: "decisao";
  quando: string;
  /** `produto:id`, o id do lead no CRM. */
  lead: string;
  empresa: string;
  chave: string;
  token: string;
  acao: AcaoDoLeadQuente;
  motivo?: string;
  /** A resposta que o agente teria dado (já sem valor em dinheiro, pelo gate). */
  texto?: string;
  /** A classificação da resposta do lead no momento. */
  classificacao?: string;
  ultimaEntrada: string;
  /** O aviso saiu no Telegram? false com `semAviso` dizendo por quê (teto do dia, falha do Telegram). */
  avisado: boolean;
  semAviso?: "teto" | "falhou";
}

export interface RegistroDeVoto {
  tipo: "voto";
  quando: string;
  chave: string;
  concorda: boolean;
}

/** O Rômulo (ou quem for) respondeu: quando, e quanto o lead esperou. */
export interface RegistroDeHumano {
  tipo: "humano";
  quando: string;
  chave: string;
  respondeuEm: string;
  esperaMs: number;
}

export type RegistroDoLeadQuente = RegistroDeDecisao | RegistroDeVoto | RegistroDeHumano;

/** PURO. Quanto o lead esperou pela primeira mensagem nossa depois da dele; null = ainda não houve. */
export function esperaDaRespostaHumana(mensagens: readonly MensagemDaConversa[] | null | undefined, ultimaEntrada: string): { respondeuEm: string; esperaMs: number } | null {
  const desde = Date.parse(ultimaEntrada);
  const resposta = (mensagens ?? []).find((m) => m.direcao === "saida" && Date.parse(m.em) > desde);
  return resposta ? { respondeuEm: new Date(resposta.em).toISOString(), esperaMs: Date.parse(resposta.em) - desde } : null;
}

interface VotosDoTipo {
  concorda: number;
  discorda: number;
  semVoto: number;
}

export interface ResumoDoLeadQuente {
  dias: number;
  decisoes: number;
  responder: number;
  escalar: number;
  calar: number;
  escalarPorMotivo: Record<string, number>;
  calarPorMotivo: Record<string, number>;
  avisados: number;
  semAvisoPorTeto: number;
  votos: { responder: VotosDoTipo; escalar: VotosDoTipo };
  /**
   * Falsos positivos do classificador de `interesse`: dos `responder` votados, quantos o Rômulo disse que
   * NÃO estavam quentes. `taxa` null sem voto: nenhuma conclusão com 0 votos.
   */
  falsosPositivosDeInteresse: { votados: number; discordam: number; taxa: number | null };
  /** Do que o lead escreveu até a primeira mensagem nossa, nas decisões de responder/escalar. */
  humano: { responderam: number; semResposta: number; medianaMin: number | null; medianaMinNosResponder: number | null };
}

const mediana = (v: number[]): number | null => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

const arredondar1 = (n: number) => Math.round(n * 10) / 10;

/** PURO. O resumo dos últimos `dias`: o que o agente teria feito e o que o Rômulo achou. */
export function resumoDoLeadQuente(registros: readonly RegistroDoLeadQuente[], agora: number, dias = 30): ResumoDoLeadQuente {
  const desde = agora - dias * 86_400_000;
  const dentro = (r: { quando: string }) => {
    const t = Date.parse(r.quando);
    return t >= desde && t <= agora;
  };
  const decisoes = registros.filter((r): r is RegistroDeDecisao => r.tipo === "decisao" && dentro(r));
  const chaves = new Set(decisoes.map((d) => d.chave));
  // O último voto de cada chave vale (mudou de ideia = a última decisão vale, como no vendedor).
  const voto = new Map<string, boolean>();
  for (const r of registros) if (r.tipo === "voto" && chaves.has(r.chave)) voto.set(r.chave, r.concorda);
  const humano = new Map<string, number>();
  for (const r of registros) if (r.tipo === "humano" && chaves.has(r.chave) && !humano.has(r.chave)) humano.set(r.chave, r.esperaMs);

  const contar = (lista: RegistroDeDecisao[], campo: "motivo") => {
    const por: Record<string, number> = {};
    for (const d of lista) por[d[campo] ?? "—"] = (por[d[campo] ?? "—"] ?? 0) + 1;
    return por;
  };
  const de = (a: AcaoDoLeadQuente) => decisoes.filter((d) => d.acao === a);
  const votos = (lista: RegistroDeDecisao[]): VotosDoTipo => {
    const v: VotosDoTipo = { concorda: 0, discorda: 0, semVoto: 0 };
    for (const d of lista) {
      const x = voto.get(d.chave);
      if (x === undefined) v.semVoto++;
      else if (x) v.concorda++;
      else v.discorda++;
    }
    return v;
  };
  const responder = de("responder");
  const escalar = de("escalar");
  const vr = votos(responder);
  const votados = vr.concorda + vr.discorda;
  const agiu = [...responder, ...escalar];
  const esperas = (lista: RegistroDeDecisao[]) => lista.flatMap((d) => (humano.has(d.chave) ? [humano.get(d.chave)! / 60_000] : []));
  const todas = esperas(agiu);
  const noResponder = esperas(responder);
  const medTodas = mediana(todas);
  const medResponder = mediana(noResponder);
  return {
    dias,
    decisoes: decisoes.length,
    responder: responder.length,
    escalar: escalar.length,
    calar: de("calar").length,
    escalarPorMotivo: contar(escalar, "motivo"),
    calarPorMotivo: contar(de("calar"), "motivo"),
    avisados: decisoes.filter((d) => d.avisado).length,
    semAvisoPorTeto: decisoes.filter((d) => d.semAviso === "teto").length,
    votos: { responder: vr, escalar: votos(escalar) },
    falsosPositivosDeInteresse: { votados, discordam: vr.discorda, taxa: votados ? Math.round((vr.discorda / votados) * 1000) / 1000 : null },
    humano: {
      responderam: todas.length,
      semResposta: agiu.length - todas.length,
      medianaMin: medTodas === null ? null : arredondar1(medTodas),
      medianaMinNosResponder: medResponder === null ? null : arredondar1(medResponder),
    },
  };
}
