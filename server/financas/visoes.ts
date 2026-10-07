import { diasEntre, mesDe, somarDias } from "./comum.ts";
import type { Fatura, Natureza, TipoDeConta, Transacao } from "./tipos.ts";

/**
 * Visões de COMPETÊNCIA e de CAIXA. PURO.
 *
 * - **Competência:** o gasto conta no mês da FATURA em que a compra foi
 *   cobrada (no cartão) ou no mês do lançamento (na conta). Entram as compras
 *   e os encargos; estorno abate. O pagamento da fatura NÃO entra — as compras
 *   que ele quita já estão aqui.
 * - **Caixa:** o que saiu das contas (não cartão), no mês em que saiu. Entram
 *   as despesas da conta e os pagamentos de fatura (como uma linha "Pagamento
 *   de fatura"); as compras no cartão NÃO entram — o dinheiro delas sai no
 *   pagamento.
 *
 * Nas duas, cada real gasto aparece uma vez só: é o teste obrigatório em
 * `visoes.test.ts`. Transferência entre contas próprias e receita nunca são
 * gasto em nenhuma das duas.
 */

export type Visao = "competencia" | "caixa";
export const VISOES: readonly Visao[] = ["competencia", "caixa"];

/** Sem `billClosingDate`, o fechamento estimado: 7 dias antes do vencimento (o comum nos bancos daqui). */
export const DIAS_FECHAMENTO_ANTES_DO_VENCIMENTO = 7;

export function fechamentoDa(f: Fatura): string {
  return f.fechamento ?? somarDias(f.vencimento, -DIAS_FECHAMENTO_ANTES_DO_VENCIMENTO);
}

/**
 * Fatura (fechada) em que um lançamento do cartão caiu: a primeira cujo
 * fechamento é no dia ou depois do lançamento, desde que o lançamento seja
 * depois do fechamento anterior. Depois do último fechamento = fatura aberta
 * (null). Antes do primeiro ciclo conhecido (mais de 40 dias antes) = null.
 */
export function faturaDoLancamento(data: string, faturasDoCartao: Fatura[]): Fatura | null {
  const ordenadas = [...faturasDoCartao].sort((a, b) => fechamentoDa(a).localeCompare(fechamentoDa(b)));
  for (let i = 0; i < ordenadas.length; i++) {
    const fechamento = fechamentoDa(ordenadas[i]);
    if (data > fechamento) continue;
    const anterior = i > 0 ? fechamentoDa(ordenadas[i - 1]) : somarDias(fechamento, -40);
    return data > anterior ? ordenadas[i] : null;
  }
  return null;
}

/**
 * Próximo vencimento de um cartão para um lançamento ainda sem fatura (a
 * aberta): o ciclo da última fatura conhecida empurrado de mês em mês até o
 * fechamento passar do lançamento. Sem fatura nenhuma, o próprio mês do
 * lançamento.
 */
export function vencimentoPrevisto(data: string, faturasDoCartao: Fatura[]): string {
  if (faturasDoCartao.length === 0) return data;
  const ultima = [...faturasDoCartao].sort((a, b) => a.vencimento.localeCompare(b.vencimento)).at(-1)!;
  const fechamento = fechamentoDa(ultima);
  const prazo = diasEntre(fechamento, ultima.vencimento);
  let [ano, mes] = fechamento.split("-").map(Number);
  const dia = Number(fechamento.slice(8, 10));
  for (let i = 0; i < 24; i++) {
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const f = `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
    if (f >= data) return somarDias(f, prazo);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return data;
}

export interface ContextoDasVisoes {
  tipoDaConta: (contaId: string) => TipoDeConta | undefined;
  faturaPorId: (id: string) => Fatura | undefined;
  faturasDoCartao: (contaId: string) => Fatura[];
}

/** Mês da fatura em que um lançamento de cartão é cobrado. */
export function mesDaFatura(t: Transacao, ctx: ContextoDasVisoes): string {
  const fatura = t.faturaId ? ctx.faturaPorId(t.faturaId) : undefined;
  if (fatura) return mesDe(fatura.vencimento);
  return mesDe(vencimentoPrevisto(t.dataLancamento, ctx.faturasDoCartao(t.contaId)));
}

const GASTO_NO_CARTAO: ReadonlySet<Natureza> = new Set(["despesa", "encargo", "estorno"]);
const GASTO_NA_CONTA_COMPETENCIA: ReadonlySet<Natureza> = new Set(["despesa", "encargo", "estorno"]);
const GASTO_NA_CONTA_CAIXA: ReadonlySet<Natureza> = new Set(["despesa", "encargo", "estorno", "pagamento_fatura"]);

/**
 * Onde um lançamento conta como gasto nesta visão: o mês e o valor (positivo
 * = gastou; estorno vem negativo e abate). `null` = não é gasto nesta visão.
 */
export function gastoNaVisao(t: Transacao, visao: Visao, ctx: ContextoDasVisoes): { mes: string; centavos: number } | null {
  if (t.status === "pendente") return null;
  const tipo = ctx.tipoDaConta(t.contaId);
  if (!tipo) return null;
  if (tipo === "cartao") {
    if (visao === "caixa" || !GASTO_NO_CARTAO.has(t.natureza)) return null;
    return { mes: mesDaFatura(t, ctx), centavos: -t.centavos };
  }
  const naturezas = visao === "caixa" ? GASTO_NA_CONTA_CAIXA : GASTO_NA_CONTA_COMPETENCIA;
  if (!naturezas.has(t.natureza)) return null;
  return { mes: mesDe(t.dataLancamento), centavos: -t.centavos };
}

/** Receita do mês (igual nas duas visões): o que entrou nas contas e não é movimento interno. */
export function receitaDoMes(t: Transacao, ctx: ContextoDasVisoes): { mes: string; centavos: number } | null {
  if (t.status === "pendente") return null;
  const tipo = ctx.tipoDaConta(t.contaId);
  if (!tipo || tipo === "cartao") return null;
  if (t.natureza !== "receita" && t.natureza !== "rendimento") return null;
  return { mes: mesDe(t.dataLancamento), centavos: t.centavos };
}
