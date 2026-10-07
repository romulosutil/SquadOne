import { diasEntre } from "./comum.ts";
import type { Natureza, TipoDeConta, Transacao } from "./tipos.ts";

/**
 * Pareamento entre contas PRÓPRIAS. PURO.
 *
 * Um Pix do Santander para o Nubank aparece duas vezes: saída numa conta,
 * entrada na outra. Sem o par, o "gastei" contaria a saída como despesa e o
 * "recebi" a entrada como receita — dinheiro que só mudou de bolso. A Pluggy
 * não liga os dois lados; ligamos por valor igual, sinais opostos, contas
 * diferentes e datas a até `DIAS_DO_PAR` (compensação de TED, fim de semana).
 *
 * Quando um dos lados é cartão, o par é o PAGAMENTO DA FATURA (débito na conta
 * + crédito no cartão): os dois viram `pagamento_fatura`, e a regra do
 * `natureza.ts` (pagamento nunca é despesa) vale mesmo com a descrição muda.
 *
 * Só entram no pareamento linhas que podem ser movimento interno: despesa,
 * receita, transferência ou pagamento ainda sem par. Encargo, estorno e
 * rendimento nunca são transferência. Cada linha casa com uma só, a de data
 * mais próxima; empate fica com a que veio primeiro (ordem estável).
 */

export const DIAS_DO_PAR = 2;

const PODE_PAREAR: ReadonlySet<Natureza> = new Set(["despesa", "receita", "transferencia", "pagamento_fatura"]);

export interface Par {
  saidaId: string;
  entradaId: string;
  natureza: "transferencia" | "pagamento_fatura";
}

export function parearTransferencias(
  transacoes: Transacao[],
  tipoDaConta: (contaId: string) => TipoDeConta | undefined,
): Par[] {
  const livres = transacoes.filter(
    (t) => PODE_PAREAR.has(t.natureza) && t.status === "lancada" && tipoDaConta(t.contaId) !== undefined,
  );
  const saidas = livres.filter((t) => t.centavos < 0);
  const entradas = livres.filter((t) => t.centavos > 0);
  const usadas = new Set<string>();
  const pares: Par[] = [];

  for (const saida of saidas) {
    const tipoSaida = tipoDaConta(saida.contaId)!;
    // Saída no cartão é compra; o cartão só aparece no par pelo lado da entrada (o pagamento recebido).
    if (tipoSaida === "cartao") continue;
    let melhor: Transacao | null = null;
    let melhorDist = Infinity;
    for (const entrada of entradas) {
      if (usadas.has(entrada.id) || entrada.contaId === saida.contaId || entrada.centavos !== -saida.centavos) continue;
      const tipoEntrada = tipoDaConta(entrada.contaId)!;
      // No cartão, só o crédito que já parece pagamento: um estorno de mesmo valor não é par.
      if (tipoEntrada === "cartao" && entrada.natureza !== "pagamento_fatura") continue;
      // Pagamento de fatura já reconhecido só casa com o cartão: virar transferência o tiraria da regra.
      if (saida.natureza === "pagamento_fatura" && tipoEntrada !== "cartao") continue;
      const dist = Math.abs(diasEntre(saida.dataLancamento, entrada.dataLancamento));
      if (dist <= DIAS_DO_PAR && dist < melhorDist) {
        melhor = entrada;
        melhorDist = dist;
      }
    }
    if (!melhor) continue;
    usadas.add(melhor.id);
    pares.push({
      saidaId: saida.id,
      entradaId: melhor.id,
      natureza: tipoDaConta(melhor.contaId) === "cartao" ? "pagamento_fatura" : "transferencia",
    });
  }
  return pares;
}
