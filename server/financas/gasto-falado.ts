import { categoriaDaDescricao, CATEGORIAS_FIXAS, SEM_CATEGORIA } from "./categoria.ts";
import { chaveDoNome } from "./organizacao.ts";

/**
 * "gastei 30 no mercado" pelo Telegram: dinheiro vivo e o que o banco não
 * mostra. PURO e DETERMINÍSTICO: nada de finanças vai ao modelo (RULES 24), e
 * uma frase que não casa aqui não é gasto (vira demanda comum do turno).
 *
 * Aceita "gastei", "paguei" e "gasto", o valor ("30", "30,50", "30.50",
 * "1.200", "R$ 30", "30 reais") e onde ("no mercado", "na farmácia", "com
 * uber", ou só "padaria"). A resposta do bot diz a categoria, nunca o valor
 * nem o "onde" (`textoDoGastoAnotado`).
 */

export interface GastoFalado {
  centavos: number;
  /** O "onde" como foi escrito, uma linha: vira a descrição do lançamento (só no banco). */
  onde: string;
}

/** Acima disto é mais provável um erro de digitação que um gasto em dinheiro. */
export const MAX_GASTO_FALADO_CENTAVOS = 10_000_000; // 100 mil reais
export const MAX_ONDE = 80;

const VALOR = String.raw`(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const MOEDA = String.raw`(?:\s*(?:reais|real|conto|contos|pila|pilas))?`;
const PREPOSICAO = String.raw`(?:(?:no|na|nos|nas|num|numa|em|com|de|do|da|pro|pra|para\s+o|para\s+a|para)\s+)?`;
const FRASE = new RegExp(String.raw`^(?:eu\s+)?(?:gastei|paguei|gasto)\s+${VALOR}${MOEDA}\s+${PREPOSICAO}(.+)$`, "i");

/** "1.200,50" → 120050; "30.5" → 3050; "1.200" → 120000. */
function centavosDoTexto(valor: string): number {
  const milhar = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(valor);
  const normalizado = milhar ? valor.replace(/\./g, "").replace(",", ".") : valor.replace(",", ".");
  return Math.round(Number(normalizado) * 100);
}

export function lerGastoFalado(texto: string): GastoFalado | null {
  const linha = texto.replace(/\s+/g, " ").trim();
  const m = FRASE.exec(linha);
  if (!m) return null;
  const centavos = centavosDoTexto(m[1]);
  if (!Number.isInteger(centavos) || centavos <= 0 || centavos > MAX_GASTO_FALADO_CENTAVOS) return null;
  const onde = m[2].replace(/[.!?…]+$/, "").trim();
  // "gastei 30 hoje" não diz onde: não é um gasto que dê para anotar.
  if (!/\p{L}/u.test(onde) || onde.length > MAX_ONDE) return null;
  return { centavos, onde };
}

/** Palavras do dia a dia → categoria padrão, para o que a regra das descrições de banco não pega. */
const DO_DIA_A_DIA: [RegExp, string][] = [
  [/\b(almoco|janta|jantar|lanche|cafe|cafezinho|pizza|hamburguer|sorvete|boteco|cerveja)\b/, "Restaurantes"],
  [/\b(feira|sacolao|acougue|hortifruti|supermercado)\b/, "Mercado"],
  [/\b(gasolina|etanol|alcool|diesel|combustivel|abastecer)\b/, "Combustível"],
  [/\b(remedio|remedios|farmacia|drogaria)\b/, "Farmácia"],
  [/\b(onibus|metro|trem|taxi|estacionamento|pedagio|passagem)\b/, "Transporte"],
  [/\b(medico|consulta|exame|dentista|terapia)\b/, "Saúde e bem-estar"],
  [/\b(cinema|show|ingresso|bar)\b/, "Lazer"],
];

/** Singular aproximado, para "restaurante" achar "Restaurantes". */
const singular = (s: string) => s.replace(/s$/, "");

/**
 * A categoria do "onde": primeiro o nome de uma categoria existente (inclusive
 * as que o Rômulo criou ou renomeou), depois as regras das descrições de banco
 * ("uber", "ifood", "drogaria"), depois as palavras do dia a dia. Nenhuma =
 * "Outros". As fixas (pagamento de fatura, transferência) nunca: um gasto
 * anotado não quita fatura.
 */
export function categoriaDoGasto(onde: string, existentes: readonly string[], renomes: ReadonlyMap<string, string>): string {
  const alvo = chaveDoNome(onde);
  const escolhiveis = existentes.filter((c) => !CATEGORIAS_FIXAS.includes(c));
  const porNome =
    escolhiveis.find((c) => chaveDoNome(c) === alvo) ??
    escolhiveis.find((c) => singular(chaveDoNome(c)) === singular(alvo)) ??
    // "mercado do bairro": a primeira palavra é o nome de uma categoria.
    escolhiveis.find((c) => singular(chaveDoNome(c)) === singular(alvo.split(" ")[0]));
  if (porNome) return porNome;
  const padrao = categoriaDaDescricao(onde) ?? DO_DIA_A_DIA.find(([re]) => re.test(alvo))?.[1] ?? null;
  if (!padrao) return SEM_CATEGORIA;
  return renomes.get(padrao) ?? padrao;
}

/** A resposta no chat: a categoria, nunca o valor nem o "onde" (RULES 24). */
export function textoDoGastoAnotado(categoria: string): string {
  return categoria === SEM_CATEGORIA ? `Anotado: ${SEM_CATEGORIA}. Dá para trocar a categoria no app, em Finanças.` : `Anotado: ${categoria}`;
}
