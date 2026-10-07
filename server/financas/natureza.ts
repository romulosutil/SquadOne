import { descricaoNormalizada, diasEntre } from "./comum.ts";
import type { Fatura, Natureza, TipoDeConta, Transacao } from "./tipos.ts";

/**
 * Natureza de um lançamento. PURO.
 *
 * A regra que segura a dupla contagem (ARCHITECTURE "Finanças"): a compra no
 * cartão é a despesa; o pagamento da fatura na conta corrente é SEMPRE
 * `pagamento_fatura`, nunca despesa, porque só quita a dívida que as compras
 * já criaram. Contado como despesa, cada real gasto no cartão apareceria duas
 * vezes no "gastei" — uma na compra, outra no Pix que pagou a fatura.
 *
 * Por isso o pagamento é reconhecido por DOIS caminhos, e basta um:
 * 1. a descrição ("PAGAMENTO DE FATURA", "PAG FATURA NUBANK"...) ou a
 *    categoria da Pluggy ("Credit card payment");
 * 2. o valor: um débito na conta igual a um pagamento que o banco registrou
 *    numa fatura (`Bill.payments`) a até 3 dias, ou ao total de uma fatura
 *    perto do vencimento. É o que pega o Pix de descrição muda ("PIX ENVIADO
 *    NU PAGAMENTOS") que a descrição sozinha deixaria passar como despesa.
 */

const PAGAMENTO_NA_CONTA =
  /\b(PAG(AMENTO|TO|T)?|PGTO|DEB(ITO)?( AUT(OMATICO)?)?)\b.*\b(FATURA|CARTAO DE CREDITO|CART CRED|CARTAO CRED)\b|\bFATURA\b.*\b(CARTAO|NUBANK|NU PAGAMENTOS|MERCADO PAGO|SANTANDER)\b|\bPAGAMENTO DE FATURA\b/;
const PAGAMENTO_NO_CARTAO = /\b(PAGAMENTO|PAGTO|PGTO|PAG FATURA|PAGAMENTO RECEBIDO|CREDITO DE PAGAMENTO)\b/;
const ESTORNO = /\b(ESTORNO|ESTORNADO|REEMBOLSO|DEVOLUCAO|CANCELAMENTO|CHARGEBACK)\b/;
const ENCARGO = /\b(IOF|JUROS|ENCARGOS?|MULTA|MORA|ROTATIVO|ANUIDADE|TARIFA)\b/;
const RENDIMENTO = /\b(RENDIMENTO|RENDIMENTOS|REND PAGO|REMUNERACAO|JUROS SOBRE CAPITAL|DIVIDENDO\w*)\b/;
const ENTRE_CONTAS_PROPRIAS = /\b(APLICACAO|APLIC|RESGATE|RESG|TRANSF\w* ENTRE CONTAS|MESMA TITULARIDADE|GUARDADO NA CAIXINHA|RESGATE DA CAIXINHA|DINHEIRO GUARDADO|DINHEIRO RESGATADO)\b/;

export interface PistasDaFonte {
  /** Categoria da Pluggy, em inglês. */
  categoriaFonte?: string;
  /** `creditCardMetadata.feeType` / `otherCreditsType`: tarifa ou crédito contratado. */
  tarifa?: boolean;
}

/** Natureza só pela linha (descrição, sinal, conta). O contexto (faturas, pares) vem depois. */
export function naturezaDaLinha(
  t: { descricao: string; centavos: number },
  tipo: TipoDeConta,
  pistas: PistasDaFonte = {},
): Natureza {
  const d = descricaoNormalizada(t.descricao);
  const cat = (pistas.categoriaFonte ?? "").toLowerCase();
  const pagamentoPelaCategoria = cat.includes("credit card payment");

  if (tipo === "cartao") {
    if (t.centavos > 0) {
      if (ESTORNO.test(d)) return "estorno";
      if (pagamentoPelaCategoria || PAGAMENTO_NO_CARTAO.test(d)) return "pagamento_fatura";
      // Crédito no cartão que não é pagamento devolve uma compra.
      return "estorno";
    }
    if (pistas.tarifa || ENCARGO.test(d) || cat.includes("interests charged") || cat.includes("credit card fees") || cat.includes("tax on financial")) {
      return "encargo";
    }
    return "despesa";
  }

  if (t.centavos < 0) {
    if (pagamentoPelaCategoria || PAGAMENTO_NA_CONTA.test(d)) return "pagamento_fatura";
    if (cat.includes("same person transfer") || ENTRE_CONTAS_PROPRIAS.test(d)) return "transferencia";
    if (cat.includes("interests charged") || cat.includes("late payment") || /\b(IOF|JUROS|ENCARGOS?)\b/.test(d)) return "encargo";
    return "despesa";
  }
  if (cat.includes("same person transfer") || ENTRE_CONTAS_PROPRIAS.test(d)) return "transferencia";
  if (cat.includes("proceeds interests") || RENDIMENTO.test(d)) return "rendimento";
  if (ESTORNO.test(d)) return "estorno";
  return "receita";
}

/** Folga entre o débito na conta e o pagamento registrado na fatura (compensação, fim de semana). */
export const DIAS_PAGAMENTO_REGISTRADO = 3;
/** Janela do débito contra o TOTAL da fatura: antecipado até 10 dias, atrasado até 5. */
export const DIAS_ANTES_DO_VENCIMENTO = 10;
export const DIAS_DEPOIS_DO_VENCIMENTO = 5;

/**
 * Débitos na conta (não cartão) que pagam fatura pelo VALOR. Devolve os ids a
 * marcar como `pagamento_fatura`. Cada pagamento registrado ou fatura casa com
 * um débito só, o mais próximo da data, para dois Pix iguais no mesmo dia não
 * virarem os dois pagamento.
 */
export function pagamentosDeFaturaPeloValor(
  transacoes: Transacao[],
  faturas: Fatura[],
  tipoDaConta: (contaId: string) => TipoDeConta | undefined,
): Set<string> {
  const candidatos = transacoes.filter(
    (t) => t.centavos < 0 && tipoDaConta(t.contaId) !== "cartao" && tipoDaConta(t.contaId) !== undefined && t.natureza !== "pagamento_fatura",
  );
  const usados = new Set<string>();
  const casar = (centavos: number, dentro: (t: Transacao) => number | null) => {
    let melhor: Transacao | null = null;
    let melhorDist = Infinity;
    for (const t of candidatos) {
      if (usados.has(t.id) || -t.centavos !== centavos) continue;
      const dist = dentro(t);
      if (dist !== null && dist < melhorDist) {
        melhor = t;
        melhorDist = dist;
      }
    }
    if (melhor) usados.add(melhor.id);
    return melhor !== null;
  };

  for (const f of faturas) {
    let algumRegistrado = false;
    for (const p of f.pagamentos) {
      if (p.centavos <= 0) continue;
      const casou = casar(p.centavos, (t) => {
        const dist = Math.abs(diasEntre(p.data, t.dataLancamento));
        return dist <= DIAS_PAGAMENTO_REGISTRADO ? dist : null;
      });
      algumRegistrado ||= casou;
    }
    // Sem pagamento registrado que case, o débito do total perto do vencimento.
    if (!algumRegistrado && f.totalBanco > 0) {
      casar(f.totalBanco, (t) => {
        const delta = diasEntre(f.vencimento, t.dataLancamento);
        return delta >= -DIAS_ANTES_DO_VENCIMENTO && delta <= DIAS_DEPOIS_DO_VENCIMENTO ? Math.abs(delta) : null;
      });
    }
  }
  return usados;
}
