import { chaveDedupe } from "./dedupe.ts";
import type { Fatura, Transacao } from "./tipos.ts";

/**
 * Leitor da fatura em PDF do Santander. PURO: recebe as LINHAS de texto já
 * extraídas do PDF (`pdf-texto.ts`) e devolve os lançamentos e a conferência.
 *
 * Existe porque o cartão Santander Unique chega da Pluggy com as 12 faturas
 * (total, vencimento, pagamentos, encargos) mas 0 lançamentos, e sem os
 * cartões digitais (06/10/2026). O "devo" funciona com as faturas; o "em quê
 * gastei" precisa disto.
 *
 * Layout esperado (fixo no Santander): blocos por cartão ("NOME - 5502 XXXX
 * XXXX 2214"), com as seções "Pagamento e Demais Créditos", "Parcelamentos"
 * (com n/total) e "Despesas"; no fim, o "Resumo da Fatura" com o saldo
 * anterior e o total a pagar. Cada lançamento é "DD/MM DESCRIÇÃO [nn/tt]
 * VALOR [VALOR US$]"; crédito vem com sinal de menos. Como a página do
 * detalhamento tem duas colunas, uma linha de texto pode trazer dois
 * lançamentos: o leitor procura TODOS os lançamentos de cada linha.
 *
 * A trava é a CONFERÊNCIA, não o leitor: saldo anterior + débitos − créditos
 * tem de dar o `totalAmount` da fatura que a Pluggy trouxe do banco, no
 * centavo. Não bateu = a tela mostra a diferença e só importa se o Rômulo
 * aceitar; um layout que mudou não vira gasto inventado calado (RULES 2).
 */

export type SecaoDaFatura = "credito" | "parcelamento" | "despesa" | "resumo" | null;

export interface LancamentoDoPdf {
  /** DD/MM como impresso. */
  diaMes: string;
  descricao: string;
  /** Negativo = débito (compra, encargo); positivo = crédito (pagamento, estorno). */
  centavos: number;
  parcelaN: number | null;
  parcelaTotal: number | null;
  cartaoFinal: string | null;
  secao: SecaoDaFatura;
}

export interface FaturaDoPdf {
  vencimento: string | null;
  totalAPagar: number | null;
  saldoAnterior: number | null;
  lancamentos: LancamentoDoPdf[];
  cartoes: string[];
}

const VALOR = String.raw`-?\s?\d{1,3}(?:\.\d{3})*,\d{2}`;
/** Um lançamento dentro de uma linha: data, descrição (preguiçosa), parcela opcional, valor em R$. */
const LANCAMENTO = new RegExp(
  String.raw`(?<![\d/])(\d{2})/(\d{2})\s+(.+?)\s+(?:(\d{1,2})/(\d{1,2})\s+)?(${VALOR})(?=\s*$|\s+${VALOR}(?:\s|$)|\s+\d{2}/\d{2}\s)`,
  "g",
);

export function centavosDoValor(texto: string): number {
  const limpo = texto.replace(/\s/g, "");
  const negativo = limpo.startsWith("-");
  const n = Number(limpo.replace("-", "").replace(/\./g, "").replace(",", "."));
  const c = Math.round(n * 100);
  return negativo ? -c : c;
}

function secaoDaLinha(linha: string): SecaoDaFatura | undefined {
  const l = linha.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (/^pagamentos? e demais creditos/.test(l)) return "credito";
  if (/^parcelamentos?\b/.test(l)) return "parcelamento";
  if (/^despesas\b/.test(l)) return "despesa";
  if (/^resumo da fatura/.test(l)) return "resumo";
  return undefined;
}

function cartaoDaLinha(linha: string): string | null {
  const m = linha.match(/\b\d{4}\s*[X*]{4}\s*[X*]{4}\s*(\d{4})\b/i) ?? linha.match(/\bfinal\s+(\d{4})\b/i);
  return m ? m[1] : null;
}

const SALDO_ANTERIOR = new RegExp(String.raw`saldo\s+(?:anterior|da\s+fatura\s+anterior)\s+(?:R\$\s*)?(${VALOR})`, "i");
const TOTAL_A_PAGAR = new RegExp(String.raw`total\s+(?:a\s+pagar|desta\s+fatura)\s+(?:R\$\s*)?(${VALOR})`, "i");
const VENCIMENTO = /vencimento\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i;

export function lerFaturaSantander(linhas: string[]): FaturaDoPdf {
  const saida: FaturaDoPdf = { vencimento: null, totalAPagar: null, saldoAnterior: null, lancamentos: [], cartoes: [] };
  let cartao: string | null = null;
  let secao: SecaoDaFatura = null;

  for (const bruta of linhas) {
    const linha = bruta.replace(/\s+/g, " ").trim();
    if (!linha) continue;

    const v = linha.match(VENCIMENTO);
    if (v && !saida.vencimento) saida.vencimento = `${v[3]}-${v[2]}-${v[1]}`;
    const t = linha.match(TOTAL_A_PAGAR);
    if (t && saida.totalAPagar === null) saida.totalAPagar = centavosDoValor(t[1]);
    const s = linha.match(SALDO_ANTERIOR);
    if (s && saida.saldoAnterior === null) saida.saldoAnterior = centavosDoValor(s[1]);

    const final = cartaoDaLinha(linha);
    if (final) {
      cartao = final;
      if (!saida.cartoes.includes(final)) saida.cartoes.push(final);
      secao = null;
    }
    const novaSecao = secaoDaLinha(linha);
    if (novaSecao !== undefined) {
      secao = novaSecao;
      continue;
    }
    if (secao === "resumo") continue;

    for (const m of linha.matchAll(LANCAMENTO)) {
      const [, dia, mes, descricao, n, total, valor] = m;
      if (Number(dia) < 1 || Number(dia) > 31 || Number(mes) < 1 || Number(mes) > 12) continue;
      let centavos = centavosDoValor(valor);
      // Impresso sem sinal: débito, salvo na seção de créditos.
      centavos = secao === "credito" ? Math.abs(centavos) : centavos > 0 ? -centavos : Math.abs(centavos);
      const parcela = n && total && Number(total) > 1 && Number(n) <= Number(total);
      saida.lancamentos.push({
        diaMes: `${dia}/${mes}`,
        descricao: descricao.trim(),
        centavos,
        parcelaN: parcela ? Number(n) : null,
        parcelaTotal: parcela ? Number(total) : null,
        cartaoFinal: cartao,
        secao,
      });
    }
  }
  return saida;
}

/** DD/MM → AAAA-MM-DD, no ano que deixa a data no vencimento ou antes dele. */
export function dataNoAnoDaFatura(diaMes: string, vencimento: string): string {
  const [dia, mes] = diaMes.split("/");
  let ano = Number(vencimento.slice(0, 4));
  if (`${mes}-${dia}` > vencimento.slice(5)) ano -= 1;
  return `${ano}-${mes}-${dia}`;
}

export interface Conferencia {
  totalPdf: number | null;
  totalBanco: number;
  saldoAnterior: number | null;
  debitosCentavos: number;
  creditosCentavos: number;
  /** saldo anterior + débitos − créditos; null sem o saldo anterior. */
  esperadoCentavos: number | null;
  /** Diferença esperado − banco; null quando não dá para conferir. */
  diferencaCentavos: number | null;
  bate: boolean;
}

export function conferir(pdf: FaturaDoPdf, fatura: Fatura): Conferencia {
  const debitos = pdf.lancamentos.filter((l) => l.centavos < 0).reduce((s, l) => s - l.centavos, 0);
  const creditos = pdf.lancamentos.filter((l) => l.centavos > 0).reduce((s, l) => s + l.centavos, 0);
  const esperado = pdf.saldoAnterior === null ? null : pdf.saldoAnterior + debitos - creditos;
  const diferenca = esperado === null ? null : esperado - fatura.totalBanco;
  return {
    totalPdf: pdf.totalAPagar,
    totalBanco: fatura.totalBanco,
    saldoAnterior: pdf.saldoAnterior,
    debitosCentavos: debitos,
    creditosCentavos: creditos,
    esperadoCentavos: esperado,
    diferencaCentavos: diferenca,
    bate: diferenca === 0 && pdf.totalAPagar === fatura.totalBanco,
  };
}

/**
 * A fatura da Pluggy que este PDF é: mesmo vencimento, ou (sem vencimento
 * legível) o mesmo total a pagar. Ambíguo ou nenhum = null, e a tela pede
 * para escolher.
 */
export function faturaDoPdf(pdf: FaturaDoPdf, faturas: Fatura[]): Fatura | null {
  const porVencimento = pdf.vencimento ? faturas.filter((f) => f.vencimento === pdf.vencimento) : [];
  if (porVencimento.length === 1) return porVencimento[0];
  const porTotal = pdf.totalAPagar !== null ? faturas.filter((f) => f.totalBanco === pdf.totalAPagar) : [];
  return porTotal.length === 1 ? porTotal[0] : null;
}

/** Lançamentos do PDF como linhas do banco, ligados à fatura e ao cartão da Pluggy. */
export function transacoesDoPdf(pdf: FaturaDoPdf, fatura: Fatura): Transacao[] {
  const vistas = new Map<string, number>();
  const dataLancamento = fatura.fechamento ?? fatura.vencimento;
  return pdf.lancamentos.map((l) => {
    const base = {
      contaId: fatura.cartaoId,
      dataCompra: dataNoAnoDaFatura(l.diaMes, fatura.vencimento),
      descricao: l.descricao,
      centavos: l.centavos,
      parcelaN: l.parcelaN,
      parcelaTotal: l.parcelaTotal,
      faturaId: fatura.id,
    };
    // Duas linhas idênticas na mesma fatura (dois cafés iguais no dia) são dois lançamentos.
    const semOcorrencia = chaveDedupe("pdf", base);
    const ocorrencia = vistas.get(semOcorrencia) ?? 0;
    vistas.set(semOcorrencia, ocorrencia + 1);
    const chave = chaveDedupe("pdf", base, ocorrencia);
    return {
      id: chave,
      fonte: "pdf",
      idOrigem: "",
      chaveDedupe: chave,
      ...base,
      // Compra parcelada antiga cai na fatura pela data de fechamento, não pela da compra.
      dataLancamento: l.parcelaN && l.parcelaN > 1 ? dataLancamento : base.dataCompra,
      natureza: l.centavos < 0 ? "despesa" : "estorno",
      categoria: "",
      origemCategoria: "nenhuma",
      categoriaFonte: "",
      mesFaturaFonte: null,
      grupoParcela: null,
      parId: null,
      status: "lancada",
      cartaoFinal: l.cartaoFinal,
    } satisfies Transacao;
  });
}
