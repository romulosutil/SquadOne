/**
 * A conversa de um lead no WhatsApp (16/10/2026). O observador (deploy/dell/whatsapp-observador/)
 * grava cada mensagem de lead em `<WHATSAPP_CONVERSAS_DIR>/<chave>.jsonl` (0600), uma por linha:
 * `{em, direcao: "entrada" | "saida", texto, origem, id?}`. Antes disso o CRM só tinha a
 * classificação e um trecho de 200 caracteres, e quem lia a ficha (ou o Hermes, ou o Jev) tinha
 * de adivinhar em que ponto da conversa o lead estava.
 *
 * `lerLinhasDaConversa` é PURO (texto -> mensagens): linha ilegível é pulada, nunca derruba a
 * leitura. A Central só lê; quem escreve é o observador.
 *
 * Contrato de 17/10/2026 (o caso Baobá): a linha de entrada pode trazer `papel: "recepcao" | "robo"`;
 * ausente, o texto decide (papelDaMensagem) e, sem sinal nenhum, é gente. O áudio vem como
 * "[áudio 27s]" ou "[áudio 27s] transcrição" (o antigo "[áudio]" continua valendo); a mídia que nós
 * mandamos, como "[vídeo]", "[documento]" ou "[imagem]" (src/operations/marcadores-da-conversa.ts).
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { levouMaterial, papelDaMensagem, type PapelDaMensagem } from "../src/operations/marcadores-da-conversa.ts";

export interface MensagemDaConversa {
  em: string;
  direcao: "entrada" | "saida";
  texto: string;
  /** Só em entrada: quem escreveu não é o lead falando por si (recepção ou robô). Ausente = gente. */
  papel?: PapelDaMensagem;
}

export const MAX_MENSAGENS_NA_FICHA = 60;
const MAX_TEXTO = 2000;

export function pastaDasConversas(env: Record<string, string | undefined> = process.env, home = os.homedir()): string {
  return (env.WHATSAPP_CONVERSAS_DIR ?? "").trim() || path.join(home, ".local", "share", "whatsapp-conversas");
}

/** A chave do arquivo: a mesma que o observador usa (só [A-Za-z0-9_:.-], até 200). */
export function nomeDoArquivo(chave: string): string | null {
  const limpa = chave.replace(/[^A-Za-z0-9_:.-]/g, "").slice(0, 200);
  return limpa && !limpa.startsWith(".") ? `${limpa}.jsonl` : null;
}

export function lerLinhasDaConversa(conteudo: string, max = MAX_MENSAGENS_NA_FICHA): MensagemDaConversa[] {
  const vistas = new Set<string>();
  const mensagens: Array<MensagemDaConversa & { id?: string; transcrita: boolean }> = [];
  for (const linha of conteudo.split("\n")) {
    if (!linha.trim()) continue;
    let m: any;
    try {
      m = JSON.parse(linha);
    } catch {
      continue;
    }
    if ((m?.direcao !== "entrada" && m?.direcao !== "saida") || !Number.isFinite(Date.parse(m?.em))) continue;
    const id = typeof m.id === "string" ? m.id : "";
    if (id && vistas.has(id)) continue;
    if (id) vistas.add(id);
    const texto = m.texto === '[áudio não transcrito]' ? '[áudio]' : typeof m.texto === "string" ? m.texto.slice(0, MAX_TEXTO) : "";
    const papel = m.direcao === "entrada" ? papelDaMensagem(texto, m.papel) : undefined;
    mensagens.push({ em: new Date(m.em).toISOString(), direcao: m.direcao, texto, ...(papel ? { papel } : {}), ...(id ? { id } : {}), transcrita: String(m.origem ?? '').startsWith('print-') });
  }
  mensagens.sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  // Prints antigos traziam horas aproximadas. O original recuperado prevalece, sem apagar a evidência.
  return mensagens.filter((m) => !m.transcrita || !mensagens.some((real) => real.id && !real.transcrita
    && real.direcao === m.direcao && real.texto.trim() === m.texto.trim()
    && Math.abs(Date.parse(real.em) - Date.parse(m.em)) < 60_000))
    .slice(-max).map(({ id: _id, transcrita: _t, ...m }) => m);
}

/**
 * A chave do arquivo é a do NÚMERO, não a da planilha: DDD + últimos 8 dígitos (a regra do
 * observador, `chave_do_numero`; o WhatsApp guarda celular antigo sem o 9, a planilha às vezes com).
 * Até 16/10/2026 a Central procurava o arquivo pelo place_id/ID do lead e nunca achava nada: a Ficha,
 * o copiloto e a Próxima venda trabalhavam sem a conversa. '' = número ilegível.
 */
export function chaveDoNumero(bruto: string | undefined): string {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return "";
  return d.slice(0, 2) + d.slice(-8);
}

/** null = sem arquivo (o observador ainda não viu mensagem deste lead desde que passou a guardar). */
export async function lerConversa(chave: string, pasta = pastaDasConversas()): Promise<MensagemDaConversa[] | null> {
  const nome = nomeDoArquivo(chave);
  if (!nome) return null;
  try {
    return lerLinhasDaConversa(await fs.readFile(path.join(pasta, nome), "utf8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

/** A conversa do lead pelo link/número do WhatsApp dele (`https://wa.me/55...`); null = sem número ou sem arquivo. */
export async function lerConversaDoNumero(whatsapp: string | undefined, pasta = pastaDasConversas()): Promise<MensagemDaConversa[] | null> {
  const chave = chaveDoNumero(whatsapp);
  return chave ? lerConversa(chave, pasta) : null;
}

const MAX_CONVERSAS = 3000;

/**
 * Todas as conversas guardadas, pela chave do número: a visão do CRM cruza com cada lead. São poucos
 * arquivos pequenos (só leads, podados pelo observador). Pasta ausente = mapa vazio; arquivo ilegível
 * é pulado.
 */
export async function lerConversas(pasta = pastaDasConversas()): Promise<Map<string, MensagemDaConversa[]>> {
  const mapa = new Map<string, MensagemDaConversa[]>();
  let nomes: string[];
  try {
    nomes = (await fs.readdir(pasta)).filter((n) => n.endsWith(".jsonl") && !n.startsWith("."));
  } catch (err: any) {
    if (err?.code === "ENOENT") return mapa;
    throw err;
  }
  await Promise.all(nomes.slice(0, MAX_CONVERSAS).map(async (nome) => {
    try {
      const mensagens = lerLinhasDaConversa(await fs.readFile(path.join(pasta, nome), "utf8"));
      if (mensagens.length) mapa.set(nome.slice(0, -".jsonl".length), mensagens);
    } catch {
      // um arquivo torto não derruba a visão
    }
  }));
  return mapa;
}

// ---------------------------------------------------------------- o resumo (PURO)

export interface ResumoDaConversa {
  /** A primeira mensagem guardada: antes dela a Central não sabe o que foi dito. */
  desde: string;
  mensagens: number;
  ultima: { direcao: "entrada" | "saida"; em: string; trecho: string; papel?: PapelDaMensagem };
  /**
   * A última mensagem de GENTE (o lead ou a recepção): o robô não conta (17/10/2026). É ela que
   * recomeça o prazo de Perdido e que diz "ele escreveu de novo"; a saudação automática não diz nada.
   */
  ultimaEntrada?: string;
  /** A última mensagem do robô, só para quem lê a ficha saber que ele falou. */
  ultimaEntradaRobo?: string;
  /** Quantas entradas de cada um: gente (sem papel), recepção e robô. Ausente em resumos antigos. */
  entradas?: { gente: number; recepcao: number; robo: number };
  ultimaSaida?: string;
  /**
   * A última mensagem nossa que levou o link do lead (demo, site ou Raio-X) ou um material ("[vídeo]",
   * "[documento]", "[imagem]", 17/10/2026): a 2ª mensagem de verdade.
   */
  linkEm?: string;
}

/** O papel da entrada: o gravado pela leitura do arquivo ou, em quem montou a mensagem à mão, o do texto. */
const papelDe = (m: MensagemDaConversa): PapelDaMensagem | undefined =>
  m.direcao === "entrada" ? m.papel ?? papelDaMensagem(m.texto) : undefined;

const MAX_TRECHO = 280;

/** "https://demo-x.vercel.app/" -> "demo-x.vercel.app"; o caminho fica quando há ("raio-x-prumo.vercel.app/roda-mais"). */
function alvoDoLink(url: string): string | null {
  try {
    const u = new URL(url);
    const caminho = u.pathname.replace(/\/+$/, "");
    return `${u.hostname}${caminho}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * PURO. O que a conversa diz do momento: quem falou por último, o quê, e se o link já saiu.
 * `links`: as URLs que contam como "mandou o link" (o demo, o site, o Raio-X do lead). Uma linha de
 * saída sem texto (bridge antiga) conta como mensagem nossa, nunca como link.
 */
export function resumirConversa(mensagens: readonly MensagemDaConversa[] | null | undefined, links: ReadonlyArray<string | undefined> = []): ResumoDaConversa | null {
  if (!mensagens?.length) return null;
  let ultimaEntrada: string | undefined;
  let ultimaEntradaRobo: string | undefined;
  let ultimaSaida: string | undefined;
  let linkEm: string | undefined;
  const entradas = { gente: 0, recepcao: 0, robo: 0 };
  const saidas = saidasDaConversa(mensagens, links);
  for (const m of mensagens) {
    if (m.direcao !== "entrada") continue;
    const papel = papelDe(m);
    entradas[papel ?? "gente"]++;
    if (papel === "robo") ultimaEntradaRobo = m.em;
    else ultimaEntrada = m.em;
  }
  for (const s of saidas) {
    ultimaSaida = new Date(s.em).toISOString();
    if (s.link === true) linkEm = ultimaSaida;
  }
  const ultima = mensagens[mensagens.length - 1];
  const papelDaUltima = papelDe(ultima);
  const trecho = ultima.texto.replace(/\s+/g, " ").trim();
  return {
    desde: mensagens[0].em,
    mensagens: mensagens.length,
    ultima: { direcao: ultima.direcao, em: ultima.em, trecho: trecho.length > MAX_TRECHO ? `${trecho.slice(0, MAX_TRECHO - 1)}…` : trecho,
      ...(papelDaUltima ? { papel: papelDaUltima } : {}) },
    ...(ultimaEntrada ? { ultimaEntrada } : {}),
    ...(ultimaEntradaRobo ? { ultimaEntradaRobo } : {}),
    entradas,
    ...(ultimaSaida ? { ultimaSaida } : {}),
    ...(linkEm ? { linkEm } : {}),
  };
}

/**
 * Uma mensagem nossa: `link` true = levou o link do lead ou um material (vídeo, documento, imagem);
 * false = texto sem ele; null = texto não guardado.
 */
export interface SaidaDaConversa {
  em: number;
  link: boolean | null;
}

/**
 * PURO. As mensagens nossas, na ordem, e se cada uma levou um dos `links` do lead. O material mandado
 * como mídia ("[vídeo]", "[documento]", "[imagem]") conta como o link (17/10/2026, a Baobá): o Iris e as
 * estamparias mandam o vídeo, não uma URL, e sem isto o "quero ver" nunca saía da vez de responder.
 */
export function saidasDaConversa(mensagens: readonly MensagemDaConversa[] | null | undefined, links: ReadonlyArray<string | undefined> = []): SaidaDaConversa[] {
  const alvos = links.map((l) => (l ? alvoDoLink(l) : null)).filter((a): a is string => Boolean(a));
  return (mensagens ?? []).filter((m) => m.direcao === "saida").map((m) => {
    const texto = m.texto.trim().toLowerCase();
    return { em: Date.parse(m.em), link: texto ? levouMaterial(texto) || alvos.some((a) => texto.includes(a)) : null };
  });
}

/** Quanto tempo um toque em "Mandar o link" vale sem a conversa mostrar a mensagem (o observador lê com atraso). */
export const FOLGA_DO_TOQUE_MS = 30 * 60_000;

/**
 * PURO. Os envios anotados (toque no link da Central) contra a conversa guardada. O toque abre o
 * WhatsApp, mas nem sempre vira envio (16/10/2026: o "Mandar o link" da Kulniski abriu o WhatsApp
 * com o link que já tinha saído dois dias antes; o que saiu depois foi um "Boa tarde"). Com a
 * conversa cobrindo o instante do toque, só vale o toque com uma mensagem nossa perto dele que leve o
 * link (ou cujo texto não foi guardado); o link visto na conversa entra como envio. Toque recente
 * (FOLGA_DO_TOQUE_MS) vale como era, e também o toque fora do trecho guardado: antes da primeira
 * mensagem ou depois da última. Nos dois casos a conversa não cobre aquele instante e não dá para
 * provar que não saiu (19/10/2026, a Jéssica: o histórico dela vai só até 15/10 19:31 e o observador
 * só passou a gravar texto em 16/10 17:10; a 2ª mensagem com o preço saiu pelo toque em 16/10 13:37,
 * e sem isto a Central dizia que o material ainda não tinha ido). Uma mensagem nossa guardada depois
 * do toque, sem o link, segue derrubando o toque (o "Boa tarde" da Kulniski).
 */
export function enviosComAConversa(anotados: readonly number[], conversa: ResumoDaConversa | null, saidas: readonly SaidaDaConversa[], agora: number): number[] {
  if (!conversa) return [...anotados];
  const desde = Date.parse(conversa.desde);
  const ate = Date.parse(conversa.ultima.em);
  const valem = anotados.filter((t) => t < desde || t > ate || agora - t < FOLGA_DO_TOQUE_MS
    || saidas.some((s) => s.link !== false && s.em >= t - 10 * 60_000 && s.em <= t + FOLGA_DO_TOQUE_MS));
  const link = conversa.linkEm ? Date.parse(conversa.linkEm) : NaN;
  if (Number.isFinite(link) && !valem.some((t) => Math.abs(t - link) <= FOLGA_DO_TOQUE_MS)) valem.push(link);
  return valem.sort((a, b) => a - b);
}
