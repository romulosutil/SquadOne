import { chaveDedupe } from "./dedupe.ts";
import type { Transacao } from "./tipos.ts";

/**
 * Importador de RESERVA: o extrato OFX ou CSV baixado do app do banco, para
 * quando uma conexão da Pluggy parar (LOGIN_ERROR, consentimento vencido). PURO.
 *
 * - **Sinal:** o do arquivo, do ponto de vista do titular (negativo = saiu),
 *   que é o nosso. O CSV de cartão costuma trazer a compra POSITIVA (Nubank):
 *   `inverter` vira o sinal, e a rota sugere quando a maioria vem positiva.
 * - **Idempotente:** o OFX traz `FITID` (`ofx:<conta>:<FITID>`); o CSV, um
 *   identificador quando tem, senão o conteúdo da linha + a ordem entre linhas
 *   idênticas. Reimportar o mesmo arquivo não duplica.
 * - **Contra a Pluggy:** `parearEntreFontes` (`dedupe.ts`), um a um. A linha do extrato que
 *   já está na Pluggy (ou em outro extrato) não entra; e quando a conexão
 *   voltar, a Pluggy vence e a linha do extrato sai (`dedupe.ts`, caso 3).
 */

export type FormatoDoExtrato = "ofx" | "csv";

export interface LinhaDoExtrato {
  data: string;
  descricao: string;
  centavos: number;
  /** FITID do OFX ou o identificador do CSV; vazio quando o arquivo não tem. */
  idOrigem: string;
}

export interface ExtratoLido {
  formato: FormatoDoExtrato;
  linhas: LinhaDoExtrato[];
  /** Linhas que tinham cara de lançamento e não deu para ler (data ou valor). */
  ignoradas: number;
}

export class ExtratoIlegivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ExtratoIlegivel";
  }
}

const MAX_DESCRICAO = 200;

export function formatoDoTexto(texto: string): FormatoDoExtrato {
  return /OFXHEADER|<OFX>/i.test(texto.slice(0, 2000)) ? "ofx" : "csv";
}

/** Valor em texto, nos dois jeitos: "1.234,56", "-1234.56", "(12,30)", "R$ 30". Ilegível = null. */
export function centavosDoValor(texto: string): number | null {
  let v = texto.replace(/R\$|\s| /gi, "").trim();
  if (!v) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(v)) {
    negativo = true;
    v = v.slice(1, -1);
  }
  if (v.endsWith("-")) {
    negativo = true;
    v = v.slice(0, -1);
  }
  if (v.startsWith("-")) {
    negativo = !negativo;
    v = v.slice(1);
  } else if (v.startsWith("+")) v = v.slice(1);
  if (!/^[\d.,]+$/.test(v)) return null;
  const virgula = v.lastIndexOf(",");
  const ponto = v.lastIndexOf(".");
  let normal: string;
  if (virgula >= 0 && ponto >= 0) normal = virgula > ponto ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  else if (virgula >= 0) normal = v.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(v)) normal = v.replace(/\./g, "");
  else normal = v;
  const n = Number(normal);
  if (!Number.isFinite(n)) return null;
  const centavos = Math.round(n * 100);
  return negativo ? -centavos : centavos;
}

/** "07/10/2026", "07/10/26", "2026-10-07", "07-10-2026", "20261007..." → "2026-10-07". */
export function dataDoExtrato(texto: string): string | null {
  const t = texto.trim();
  let a: string, m: string, d: string;
  let x: RegExpExecArray | null;
  if ((x = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) [, a, m, d] = x;
  else if ((x = /^(\d{4})(\d{2})(\d{2})/.exec(t))) [, a, m, d] = x;
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t))) {
    [, d, m, a] = x;
    if (a.length === 2) a = `20${a}`;
  } else return null;
  const data = `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(`${data}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== data ? null : data;
}

const limparDescricao = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DESCRICAO);

// --- OFX ----------------------------------------------------------------

/** Campo de um bloco OFX, no SGML (sem fechamento) ou no XML. */
function campoOfx(bloco: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(bloco);
  return m ? m[1].trim() : "";
}

export function lerOfx(texto: string): ExtratoLido {
  const blocos = texto.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) ?? [];
  if (blocos.length === 0 && !/<BANKTRANLIST>/i.test(texto)) throw new ExtratoIlegivel("Não achei lançamentos neste OFX.");
  const linhas: LinhaDoExtrato[] = [];
  let ignoradas = 0;
  for (const b of blocos) {
    const data = dataDoExtrato(campoOfx(b, "DTPOSTED"));
    const centavos = centavosDoValor(campoOfx(b, "TRNAMT"));
    const nome = campoOfx(b, "NAME");
    const memo = campoOfx(b, "MEMO");
    // O banco põe a descrição em NAME, em MEMO ou nos dois (o MEMO detalha o NAME).
    const descricao = limparDescricao(nome && memo && !memo.includes(nome) && !nome.includes(memo) ? `${nome} ${memo}` : memo.length > nome.length ? memo : nome);
    if (!data || centavos === null || centavos === 0) {
      ignoradas++;
      continue;
    }
    linhas.push({ data, descricao: descricao || "Lançamento", centavos, idOrigem: campoOfx(b, "FITID") });
  }
  return { formato: "ofx", linhas, ignoradas };
}

// --- CSV ----------------------------------------------------------------

/** Uma linha CSV com aspas ("a;b";"c""d"). */
function celulas(linha: string, separador: string): string[] {
  const saida: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === separador) {
      saida.push(atual);
      atual = "";
    } else atual += c;
  }
  saida.push(atual);
  return saida.map((s) => s.trim());
}

const cabecalho = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const COLUNAS = {
  data: /^(data|date|dt)( |$)|data (lancamento|movimento|compra)/,
  descricao: /descricao|historico|description|title|titulo|estabelecimento|lancamento|memo|detalhe/,
  valor: /^(valor|amount|value|quantia|montante)( |$)|valor (r|rs|brl)/,
  debito: /^(debito|saida|debit)( |$)/,
  credito: /^(credito|entrada|credit)( |$)/,
  id: /^(identificador|id|fitid|codigo)( |$)/,
};

function acharColuna(cabecalhos: string[], re: RegExp, menos: number[] = []): number {
  return cabecalhos.findIndex((c, i) => !menos.includes(i) && re.test(c));
}

export function lerCsv(texto: string): ExtratoLido {
  const linhasDoArquivo = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (linhasDoArquivo.length < 2) throw new ExtratoIlegivel("O CSV não tem lançamentos.");
  // O cabeçalho pode vir depois de umas linhas de título do banco: a primeira linha com data e valor.
  let inicio = -1;
  let separador = ";";
  let cols = { data: -1, descricao: -1, valor: -1, debito: -1, credito: -1, id: -1 };
  for (let i = 0; i < Math.min(15, linhasDoArquivo.length) && inicio < 0; i++) {
    const l = linhasDoArquivo[i];
    const sep = [";", ",", "\t"].sort((a, b) => l.split(b).length - l.split(a).length)[0];
    const cab = celulas(l, sep).map(cabecalho);
    const data = acharColuna(cab, COLUNAS.data);
    const valor = acharColuna(cab, COLUNAS.valor);
    const debito = acharColuna(cab, COLUNAS.debito);
    if (data >= 0 && (valor >= 0 || debito >= 0)) {
      inicio = i;
      separador = sep;
      const id = acharColuna(cab, COLUNAS.id);
      cols = {
        data,
        descricao: acharColuna(cab, COLUNAS.descricao, [data, valor, id]),
        valor,
        debito,
        credito: acharColuna(cab, COLUNAS.credito),
        id,
      };
    }
  }
  if (inicio < 0) throw new ExtratoIlegivel("Não reconheci as colunas do CSV: preciso de uma de data e uma de valor (ou débito/crédito).");
  const linhas: LinhaDoExtrato[] = [];
  let ignoradas = 0;
  for (const l of linhasDoArquivo.slice(inicio + 1)) {
    const c = celulas(l, separador);
    const data = dataDoExtrato(c[cols.data] ?? "");
    let centavos: number | null;
    if (cols.valor >= 0) centavos = centavosDoValor(c[cols.valor] ?? "");
    else {
      const debito = centavosDoValor(c[cols.debito] ?? "");
      const credito = cols.credito >= 0 ? centavosDoValor(c[cols.credito] ?? "") : null;
      centavos = debito ? -Math.abs(debito) : credito ? Math.abs(credito) : null;
    }
    if (!data || centavos === null || centavos === 0) {
      ignoradas++;
      continue;
    }
    linhas.push({
      data,
      descricao: limparDescricao(cols.descricao >= 0 ? c[cols.descricao] ?? "" : "") || "Lançamento",
      centavos,
      idOrigem: cols.id >= 0 ? (c[cols.id] ?? "").slice(0, 100) : "",
    });
  }
  return { formato: "csv", linhas, ignoradas };
}

export function lerExtrato(texto: string, formato: FormatoDoExtrato = formatoDoTexto(texto)): ExtratoLido {
  return formato === "ofx" ? lerOfx(texto) : lerCsv(texto);
}

/** A maioria das linhas positiva: num cartão, é o arquivo que traz a compra com sinal de entrada. */
export function sugereInverter(linhas: readonly LinhaDoExtrato[]): boolean {
  return linhas.length > 0 && linhas.filter((l) => l.centavos > 0).length > linhas.length / 2;
}

/** Linhas → lançamentos da conta, com a chave de dedupe de cada um. */
export function transacoesDoExtrato(extrato: ExtratoLido, contaId: string, inverter: boolean): Transacao[] {
  const ocorrencias = new Map<string, number>();
  return extrato.linhas.map((l): Transacao => {
    const centavos = inverter ? -l.centavos : l.centavos;
    const conteudo = { contaId, dataCompra: l.data, centavos, descricao: l.descricao };
    let chave: string;
    if (l.idOrigem && extrato.formato === "ofx") chave = chaveDedupe("ofx", { ...conteudo, idOrigem: l.idOrigem });
    else if (l.idOrigem) chave = `csv:${contaId}:id:${l.idOrigem}`;
    else {
      // Sem id: o conteúdo + a ordem entre linhas idênticas do mesmo arquivo (dois cafés iguais no mesmo dia).
      const semOrdem = chaveDedupe(extrato.formato, conteudo);
      const n = ocorrencias.get(semOrdem) ?? 0;
      ocorrencias.set(semOrdem, n + 1);
      chave = chaveDedupe(extrato.formato, conteudo, n);
    }
    return {
      id: chave,
      contaId,
      fonte: extrato.formato,
      idOrigem: l.idOrigem,
      chaveDedupe: chave,
      dataCompra: l.data,
      dataLancamento: l.data,
      descricao: l.descricao,
      centavos,
      natureza: centavos < 0 ? "despesa" : "receita",
      categoria: "",
      origemCategoria: "nenhuma",
      categoriaFonte: "",
      faturaId: null,
      mesFaturaFonte: null,
      parcelaN: null,
      parcelaTotal: null,
      grupoParcela: null,
      parId: null,
      status: "lancada",
      cartaoFinal: null,
    };
  });
}
