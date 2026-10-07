import { centavosDe, dataDoTexto } from "./comum.ts";
import { chaveDedupe } from "./dedupe.ts";
import type { Conexao, Conta, Fatura, TipoDeConta, Transacao } from "./tipos.ts";

/**
 * JSON da Pluggy → nosso modelo. PURO: recebe o objeto como veio da API (sem
 * confiar no formato: campo ausente vira vazio, nunca exceção) e devolve as
 * linhas do banco. A natureza e a categoria finais são do `processar.ts`;
 * aqui só o que a fonte diz.
 *
 * Convenções da Pluggy usadas (OpenAPI de 10/2026):
 * - `type` DEBIT/CREDIT é a direção do ponto de vista do titular; no cartão a
 *   Pluggy normaliza (compra = DEBIT, pagamento = CREDIT). O sinal de `amount`
 *   não é documentado por tipo de conta, então usamos |amount| + `type`.
 * - `creditCardMetadata.billId` liga a compra à fatura; `purchaseDate` é a
 *   data da compra original da parcela; `billPostDate` é quando entrou na
 *   fatura.
 */

type Json = Record<string, any>;

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const numeroOuNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function tipoDaContaPluggy(a: Json): TipoDeConta {
  if (a?.type === "CREDIT") return "cartao";
  if (a?.subtype === "SAVINGS_ACCOUNT") return "poupanca";
  return "corrente";
}

/** Últimos 4 dígitos de um número de cartão/conta mascarado ("**** 2214", "5502********2214"). */
export function finalDe(numero: unknown): string | null {
  const digitos = texto(numero).replace(/\D/g, "");
  return digitos.length >= 4 ? digitos.slice(-4) : null;
}

export function contaDaPluggy(a: Json, instituicao: string, agora: string): Conta {
  const tipo = tipoDaContaPluggy(a);
  const credito = a?.creditData ?? {};
  return {
    id: `pluggy:${texto(a?.id)}`,
    itemId: texto(a?.itemId),
    nome: texto(a?.marketingName) || texto(a?.name) || "Conta",
    instituicao,
    tipo,
    // No cartão a Pluggy chama de balance o que está sendo devido; guardamos positivo (dívida).
    saldoCentavos: tipo === "cartao" ? Math.abs(centavosDe(a?.balance)) : centavosDe(a?.balance),
    limiteCentavos: tipo === "cartao" && numeroOuNull(credito.creditLimit) !== null ? centavosDe(credito.creditLimit) : null,
    limiteDisponivelCentavos:
      tipo === "cartao" && numeroOuNull(credito.availableCreditLimit) !== null ? centavosDe(credito.availableCreditLimit) : null,
    final: finalDe(a?.number),
    atualizadoEm: texto(a?.updatedAt) || agora,
  };
}

export function investimentoDaPluggy(i: Json, instituicao: string, agora: string): Conta {
  return {
    id: `pluggy-inv:${texto(i?.id)}`,
    itemId: texto(i?.itemId),
    nome: texto(i?.name) || "Investimento",
    instituicao,
    tipo: "investimento",
    // `balance` é o saldo líquido atual; `amount` (bruto) é a reserva quando falta.
    saldoCentavos: centavosDe(numeroOuNull(i?.balance) ?? numeroOuNull(i?.amount) ?? 0),
    limiteCentavos: null,
    limiteDisponivelCentavos: null,
    final: null,
    atualizadoEm: texto(i?.updatedAt) || texto(i?.date) || agora,
  };
}

/** Investimento resgatado por inteiro some do "tenho". */
export function investimentoAtivo(i: Json): boolean {
  return i?.status !== "TOTAL_WITHDRAWAL";
}

export function faturaDaPluggy(b: Json, cartaoId: string): Fatura | null {
  const vencimento = dataDoTexto(b?.dueDate);
  if (!vencimento || !texto(b?.id)) return null;
  const pagamentos = (Array.isArray(b?.payments) ? b.payments : [])
    .map((p: Json) => ({ data: dataDoTexto(p?.paymentDate), centavos: Math.abs(centavosDe(p?.amount)) }))
    .filter((p: { data: string | null }): p is { data: string; centavos: number } => p.data !== null);
  const encargos = (Array.isArray(b?.financeCharges) ? b.financeCharges : []).reduce(
    (s: number, c: Json) => s + Math.abs(centavosDe(c?.amount)),
    0,
  );
  return {
    id: `pluggy:${texto(b.id)}`,
    cartaoId,
    fechamento: dataDoTexto(b?.billClosingDate),
    vencimento,
    totalBanco: centavosDe(b?.totalAmount),
    pagoCentavos: pagamentos.reduce((s: number, p: { centavos: number }) => s + p.centavos, 0),
    encargosCentavos: encargos,
    minimoCentavos: numeroOuNull(b?.minimumPaymentAmount) !== null ? centavosDe(b.minimumPaymentAmount) : null,
    pagamentos,
  };
}

export function transacaoDaPluggy(t: Json, contaId: string): Transacao | null {
  const id = texto(t?.id);
  const data = dataDoTexto(t?.date);
  if (!id || !data) return null;
  const meta = t?.creditCardMetadata ?? {};
  // Valor na moeda da conta: compra em dólar no cartão em real vem em amountInAccountCurrency.
  const valor = numeroOuNull(t?.amountInAccountCurrency) ?? numeroOuNull(t?.amount) ?? 0;
  const absoluto = Math.abs(centavosDe(valor));
  const centavos = t?.type === "CREDIT" ? absoluto : -absoluto;
  const n = numeroOuNull(meta.installmentNumber);
  const total = numeroOuNull(meta.totalInstallments);
  const descricao = texto(t?.description) || texto(t?.descriptionRaw) || "(sem descrição)";
  // Tarifa ou crédito contratado no cartão sem categoria: dá a pista ao natureza.ts.
  const categoriaFonte = texto(t?.category) || (meta.feeType ? "credit card fees" : meta.otherCreditsType ? "interests charged" : "");
  const parcela = total && total > 1 && n ? { parcelaN: n, parcelaTotal: total } : { parcelaN: null, parcelaTotal: null };
  const base = {
    contaId,
    idOrigem: id,
    dataCompra: dataDoTexto(meta.purchaseDate) ?? data,
    dataLancamento: dataDoTexto(meta.billPostDate) ?? data,
    descricao,
    centavos,
    ...parcela,
  };
  const forecast = texto(meta.billForecastDate);
  return {
    id: `pluggy:${id}`,
    fonte: "pluggy",
    chaveDedupe: chaveDedupe("pluggy", base),
    ...base,
    natureza: centavos < 0 ? "despesa" : "receita",
    categoria: "",
    origemCategoria: "nenhuma",
    categoriaFonte,
    faturaId: texto(meta.billId) ? `pluggy:${texto(meta.billId)}` : null,
    mesFaturaFonte: /^\d{4}-\d{2}$/.test(forecast) ? forecast : null,
    grupoParcela: null,
    parId: null,
    status: t?.status === "PENDING" ? "pendente" : "lancada",
    cartaoFinal: finalDe(meta.cardNumber),
  };
}

export function conexaoDaPluggy(item: Json, lidoEm: string, erroLeitura: string | null = null): Conexao {
  return {
    itemId: texto(item?.id),
    nome: texto(item?.connector?.name) || "Conexão",
    status: texto(item?.status) || "DESCONHECIDO",
    executionStatus: texto(item?.executionStatus),
    dadosAte: texto(item?.lastUpdatedAt) || null,
    consentimentoAte: texto(item?.consentExpiresAt) || null,
    lidoEm,
    erroLeitura,
  };
}

/**
 * Cursor do `/v2/transactions`: o `next` é uma query string pronta ("?after=…")
 * para colar no caminho. Só o `after` é aproveitado, e a URL é sempre montada
 * aqui com o host fixo: um `next` com host não leva a requisição (e a apiKey)
 * para outro lugar.
 */
export function cursorDoProximo(next: unknown): string | null {
  const bruto = texto(next);
  if (!bruto) return null;
  try {
    const params = bruto.startsWith("http") ? new URL(bruto).searchParams : new URLSearchParams(bruto.replace(/^[^?]*\?/, ""));
    return params.get("after") || null;
  } catch {
    return null;
  }
}
