import { lerGastoFalado } from "./gasto-falado.ts";

// Saiu de server/jev-sombra.ts em 17/10/2026 (RULES 28): o Assistente da Central precisa da MESMA
// regra num módulo puro de src/ (src/operations/assistente.ts), e o jev-sombra lê disco. Uma regra
// só para os dois: duas listas de palavras divergiriam, e a que ficasse para trás vazaria finanças.

/**
 * PURO. A demanda parece finanças? Então nem sai do processo (RULES 24, 27 e 28).
 * Conservador de propósito: perder uma medição custa nada; mandar "paguei a
 * fatura de 3.200" a um terceiro não tem volta. O gasto falado já não vira
 * turno no Telegram, mas a folha Pedir aceita qualquer texto.
 */
const PALAVRAS_DE_FINANCAS = /\b(?:r\$|reais|fatura|extrato|saldo|or[cç]amento|cart[aã]o de cr[eé]dito|pluggy|investiment\w*|pix|boleto|empr[eé]stimo|parcela\w*|gastei|paguei|gasto|sal[aá]rio\w*|holerite|contracheque|d[ií]vida\w*|impostos?|darf|irpf|iptu|ipva|inss|fgts|dinheiro|juros|financiamento\w*|rendimento\w*|mensalidade\w*|cdb|tesouro direto|selic)\b/i;
// Ampliada em 15/10/2026 (a auditoria achou "salário", "dívida", "imposto" passando). Só palavras que, no uso do Rômulo,
// quase sempre são dinheiro dele; o erro é sempre para o lado de pular (perde uma medição, não vaza nada). Ficaram
// de fora, de propósito, "conta", "cartão" e "transferência" sozinhos (ambíguos demais) e a sala pessoal--contas:
// se "Contas" conta como finanças para a RULES 27 é decisão dele.

export function pareceFinancas(demanda: string): boolean {
  if (lerGastoFalado(demanda)) return true;
  if (/r\$/i.test(demanda)) return true;
  return PALAVRAS_DE_FINANCAS.test(demanda);
}
