import { createHash } from "node:crypto";

/**
 * Blocos dos agentes na descrição de um evento do Google Calendar. PURO de
 * propósito: a mescla decide o que o usuário vê no Google e só uma função pura
 * dá para verificar com tabela de casos. Sem fetch, relógio nem env.
 *
 * Forma: texto do usuário (intocado) + cabeçalho + um bloco por agente,
 *   [[squadone:<pessoa_id>]] Papel · Nome · dd/mm hh:mm
 *   • ponto
 *   [[/squadone:<pessoa_id>]]
 * O hash do conteúdo de cada bloco vai em extendedProperties.private: hash que
 * não bate = o usuário editou o bloco, e o agente não sobrescreve.
 */

/** O Google não documenta o teto de description; ~8192 é o relatado. 8000 dá folga à reescrita em HTML. */
export const LIMITE_DESCRICAO = 8000;
/** Um bloco é leitura de relance no Calendar, não relatório. */
export const LIMITE_CORPO = 1200;
/** Abaixo disso um bloco cortado não diz nada útil. */
export const MIN_CORPO = 200;
/** Cabeçalho + marcadores e rótulo + MIN_CORPO: o mínimo para caber um agente. */
export const RESERVA_MINIMA = 400;
export const MARCA_CABECALHO = "[[squadone]]";
export const CABECALHO = `${MARCA_CABECALHO} Notas dos agentes do SquadOne. O texto fora dos blocos é seu e nunca é alterado.`;
export const PREFIXO_HASH = "squadone_h_";
/**
 * Formato de id que um marcador aceita (ids de pessoa são slug). Id fora dele
 * não forma marcador legível: o bloco nunca seria reencontrado e cada pedido
 * acrescentaria uma cópia nova.
 */
export const ID_DE_MARCADOR = /^[a-z0-9-]+$/;

export interface BlocoLido {
  pessoaId: string;
  abre: number;
  conteudoInicio: number;
  conteudoFim: number;
  fecha: number;
  conteudo: string;
}

export interface DescricaoAnalisada {
  html: boolean;
  blocos: Map<string, BlocoLido>;
  /** Ids com abertura sem fechamento ou aberturas repetidas: ninguém sabe de quem é o texto. */
  malformados: Set<string>;
  cabecalho: { inicio: number; fim: number } | null;
  tamanhoDoUsuario: number;
}

export type EstadoDoBloco = "ausente" | "nosso" | "editado";

export interface ContribuicaoParaGravar {
  pessoaId: string;
  papel: string;
  nome: string;
  pontos: string[];
}

export interface EntradaDaMescla {
  descricao: string;
  privado: Record<string, string>;
  contribuicoes: ContribuicaoParaGravar[];
  /** "dd/mm hh:mm" já formatado: o módulo não lê relógio. */
  quando: string;
}

export interface SaidaDaMescla {
  descricao: string;
  hashes: Record<string, string>;
  gravadas: string[];
  editadas: string[];
  semEspaco: string[];
  truncadas: string[];
  mudou: boolean;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const quebra = (html: boolean) => (html ? "<br>" : "\n");

/** A UI web do Calendar grava HTML ao editar; o bloco precisa seguir o mesmo formato. */
export function ehHtml(d: string): boolean {
  return /<(br|p|div|b|i|u|a|ul|ol|li|span|strong|em)\b[^>]*>/i.test(d);
}

/**
 * Texto do modelo (e papel/nome) nunca forma marcador nem tag: `[[` e `]]`
 * ganham espaço, `<`/`>` viram aspas angulares. `&` só é escapado em HTML,
 * onde o Google o leria como entidade.
 */
export function escaparTexto(t: string, html: boolean): string {
  let s = t.replace(/[\u0000-\u001F\u007F]/g, " ");
  s = s.replace(/\[(?=\[)/g, "[ ").replace(/\](?=\])/g, "] ");
  s = s.replace(/</g, "‹").replace(/>/g, "›");
  if (html) s = s.replace(/&/g, "&amp;");
  return s;
}

function normalizar(s: string, tirarTags: boolean): string {
  let t = s;
  if (tirarTags) {
    t = t
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<[^>]*>/g, "");
  }
  return t
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * O texto que o usuário VÊ. O hash é sobre isto, não sobre bytes: quando o
 * usuário edita outra parte da descrição na UI web, o Google reescreve tudo em
 * HTML e o bloco do agente muda de bytes sem mudar de texto — hash cru travaria
 * o agente para sempre.
 */
export function normalizarTexto(s: string): string {
  return normalizar(s, true);
}

/**
 * Descrição legível para o prompt. Só tira tags quando a descrição É HTML:
 * em texto puro, "Levar <RG>" é o que o usuário escreveu, não uma tag.
 */
export function paraTextoSimples(d: string): string {
  return normalizar(d, ehHtml(d));
}

export function hashDoConteudo(conteudo: string): string {
  return sha256(normalizarTexto(conteudo)).slice(0, 16);
}

/** Chave ≤ 44 (limite do Google, que DESCARTA chave maior em silêncio): 19 caracteres. */
export function chaveDeHash(pessoaId: string): string {
  return PREFIXO_HASH + sha256(pessoaId).slice(0, 8);
}

const ABERTURA = /\[\[squadone:([a-z0-9-]+)\]\]/g;

export function analisarDescricao(d: string): DescricaoAnalisada {
  const blocos = new Map<string, BlocoLido>();
  const malformados = new Set<string>();
  const re = new RegExp(ABERTURA.source, "g");
  let cursor = 0;
  for (;;) {
    re.lastIndex = cursor;
    const m = re.exec(d);
    if (!m) break;
    const id = m[1];
    const conteudoInicio = m.index + m[0].length;
    const fechamento = `[[/squadone:${id}]]`;
    const fim = d.indexOf(fechamento, conteudoInicio);
    if (fim === -1) {
      blocos.delete(id);
      malformados.add(id);
      cursor = conteudoInicio;
      continue;
    }
    if (blocos.has(id) || malformados.has(id)) {
      blocos.delete(id);
      malformados.add(id);
    } else {
      blocos.set(id, {
        pessoaId: id, abre: m.index, conteudoInicio, conteudoFim: fim,
        fecha: fim + fechamento.length, conteudo: d.slice(conteudoInicio, fim),
      });
    }
    // Abertura DENTRO de um bloco é conteúdo dele, não outro bloco.
    cursor = fim + fechamento.length;
  }

  const spans = [...blocos.values()];
  let cabecalho: DescricaoAnalisada["cabecalho"] = null;
  for (let i = d.indexOf(MARCA_CABECALHO); i !== -1; i = d.indexOf(MARCA_CABECALHO, i + 1)) {
    if (spans.some((b) => i >= b.abre && i < b.fecha)) continue;
    let fim = d.length;
    for (const t of ["\n", "<br", "</div>", "</p>", "[[squadone:"]) {
      const j = d.indexOf(t, i + MARCA_CABECALHO.length);
      if (j !== -1 && j < fim) fim = j;
    }
    cabecalho = { inicio: i, fim };
    break;
  }

  const tamanhoDosBlocos = spans.reduce((t, b) => t + (b.fecha - b.abre), 0);
  const tamanhoDoCabecalho = cabecalho ? cabecalho.fim - cabecalho.inicio : 0;
  return {
    html: ehHtml(d),
    blocos,
    malformados,
    cabecalho,
    tamanhoDoUsuario: d.length - tamanhoDosBlocos - tamanhoDoCabecalho,
  };
}

/** Sem hash que bata não há prova de que o texto é do agente: conta como editado. */
export function estadoDoBloco(
  a: DescricaoAnalisada,
  privado: Record<string, string>,
  pessoaId: string,
): EstadoDoBloco {
  if (a.malformados.has(pessoaId)) return "editado";
  const bloco = a.blocos.get(pessoaId);
  if (!bloco) return "ausente";
  return privado[chaveDeHash(pessoaId)] === `${pessoaId}:${hashDoConteudo(bloco.conteudo)}`
    ? "nosso"
    : "editado";
}

export function excedeSoComUsuario(d: string): boolean {
  return analisarDescricao(d).tamanhoDoUsuario > LIMITE_DESCRICAO - RESERVA_MINIMA;
}

/** Corta sem partir `&amp;` nem `<br>` ao meio; o "…" cabe dentro de `max`. */
export function limitarCorpo(s: string, max: number, html: boolean): { texto: string; cortado: boolean } {
  if (s.length <= max) return { texto: s, cortado: false };
  let corte = max - 1;
  if (html) {
    const amp = s.lastIndexOf("&", corte - 1);
    if (amp >= 0) {
      const pv = s.indexOf(";", amp);
      if (pv === -1 || pv >= corte) corte = amp;
    }
    const lt = s.lastIndexOf("<", corte - 1);
    if (lt >= 0) {
      const gt = s.indexOf(">", lt);
      if (gt === -1 || gt >= corte) corte = lt;
    }
  }
  return { texto: s.slice(0, corte).trimEnd() + "…", cortado: true };
}

export function conteudoDoBloco(
  c: { papel: string; nome: string },
  quando: string,
  corpo: string,
  html: boolean,
): string {
  const Q = quebra(html);
  return ` ${escaparTexto(c.papel, html)} · ${escaparTexto(c.nome, html)} · ${quando}${Q}${corpo}${Q}`;
}

interface Item {
  c: ContribuicaoParaGravar;
  corpo: string;
}

function construir(d: string, a: DescricaoAnalisada, itens: Item[], quando: string): string {
  const Q = quebra(a.html);
  let texto = d;
  // De trás para frente: substituir um bloco não desloca os índices dos anteriores.
  const existentes = itens
    .filter((i) => a.blocos.has(i.c.pessoaId))
    .sort((x, y) => a.blocos.get(y.c.pessoaId)!.abre - a.blocos.get(x.c.pessoaId)!.abre);
  for (const i of existentes) {
    const b = a.blocos.get(i.c.pessoaId)!;
    texto = texto.slice(0, b.conteudoInicio) + conteudoDoBloco(i.c, quando, i.corpo, a.html) + texto.slice(b.conteudoFim);
  }
  const aberturas = [...a.blocos.values()].map((b) => b.abre);
  const primeiroAbre = aberturas.length ? Math.min(...aberturas) : null;
  const semCabecalho = a.cabecalho === null;
  // Seguro depois das substituições: todas acontecem depois de `primeiroAbre`.
  if (semCabecalho && primeiroAbre !== null) {
    texto = texto.slice(0, primeiroAbre) + CABECALHO + Q + texto.slice(primeiroAbre);
  }
  itens
    .filter((i) => !a.blocos.has(i.c.pessoaId))
    .forEach((i, n) => {
      const sep = texto === "" ? "" : Q + Q;
      const pre = semCabecalho && primeiroAbre === null && n === 0 ? CABECALHO + Q : "";
      const id = i.c.pessoaId;
      texto += `${sep}${pre}[[squadone:${id}]]${conteudoDoBloco(i.c, quando, i.corpo, a.html)}[[/squadone:${id}]]`;
    });
  return texto;
}

export function mesclarDescricao(e: EntradaDaMescla): SaidaDaMescla {
  const a = analisarDescricao(e.descricao);
  const vistos = new Set<string>();
  const lista = e.contribuicoes.filter((c) => !vistos.has(c.pessoaId) && vistos.add(c.pessoaId));
  for (const c of lista) {
    // Quem chama filtra antes; aqui é bug, não caso de uso.
    if (!ID_DE_MARCADOR.test(c.pessoaId)) throw new Error(`Id '${c.pessoaId}' não forma marcador de bloco.`);
  }
  const editadas = lista
    .filter((c) => estadoDoBloco(a, e.privado, c.pessoaId) === "editado")
    .map((c) => c.pessoaId);
  const aceitas = lista.filter((c) => !editadas.includes(c.pessoaId));
  const semEspaco: string[] = [];

  // Espaço dividido por igual; se não cabe o mínimo, sai a ÚLTIMA pedida.
  // Blocos de agentes não envolvidos nunca encolhem: não são deste pedido.
  let cota = 0;
  while (aceitas.length) {
    const base = construir(e.descricao, a, aceitas.map((c) => ({ c, corpo: "" })), e.quando).length;
    cota = Math.min(LIMITE_CORPO, Math.floor((LIMITE_DESCRICAO - base) / aceitas.length));
    if (cota >= MIN_CORPO) break;
    semEspaco.unshift(aceitas.pop()!.pessoaId);
  }
  if (!aceitas.length) {
    return { descricao: e.descricao, hashes: {}, gravadas: [], editadas, semEspaco, truncadas: [], mudou: false };
  }

  const truncadas: string[] = [];
  const itens: Item[] = aceitas.map((c) => {
    const bruto = c.pontos.map((p) => `• ${escaparTexto(p, a.html)}`).join(quebra(a.html));
    const { texto, cortado } = limitarCorpo(bruto, cota, a.html);
    if (cortado) truncadas.push(c.pessoaId);
    return { c, corpo: texto };
  });
  const descricao = construir(e.descricao, a, itens, e.quando);
  if (descricao.length > LIMITE_DESCRICAO) {
    throw new Error(`Mescla com ${descricao.length} caracteres passou de ${LIMITE_DESCRICAO}: bug na cota.`);
  }
  const hashes: Record<string, string> = {};
  for (const i of itens) {
    hashes[chaveDeHash(i.c.pessoaId)] =
      `${i.c.pessoaId}:${hashDoConteudo(conteudoDoBloco(i.c, e.quando, i.corpo, a.html))}`;
  }
  const mudou =
    descricao !== e.descricao || Object.entries(hashes).some(([k, v]) => e.privado[k] !== v);
  return { descricao, hashes, gravadas: aceitas.map((c) => c.pessoaId), editadas, semEspaco, truncadas, mudou };
}
