import { lerGastoFalado } from "./gasto-falado.ts";

// Saiu de server/jev-sombra.ts em 17/10/2026 (RULES 28): o Assistente da Central precisa da MESMA
// regra num módulo puro de src/ (src/operations/assistente.ts), e o jev-sombra lê disco. Uma regra
// só para os dois: duas listas de palavras divergiriam, e a que ficasse para trás vazaria finanças.
//
// Reescrita em 17/10/2026 depois da revisão adversarial do Assistente: passavam plurais ("faturas",
// "boletos"), "quanto devo no cartão", "R $ 500", o cifrão de largura cheia ("R＄500"), "BRL 900",
// "US$ 30", "vou pagar 1.200 do aluguel", "conta de luz venceu", "transferi 300", "nubank", "lucro do
// mês" e o número de proposta sem "R$" ("a proposta foi de 1.500", "fechou 900"). Por isso:
//   1. o texto é normalizado antes (NFKC, sem acento, minúsculas): "＄" vira "$", "１２００" vira "1200",
//      "orçamento" e "orcamento" são a mesma palavra;
//   2. as raízes levam `\w*` (plural, verbo, derivado);
//   3. número com cara de dinheiro conta sozinho (`temValorEmDinheiro`, a MESMA regra que tira valor
//      do que vai ao modelo e que recusa cartão).
// O erro é sempre para o lado de barrar: perder uma medição do Jev ou ouvir "isso fica em Finanças"
// custa nada; mandar "paguei a fatura de 3.200" a um terceiro não tem volta (RULES 24, 27 e 28).

/** NFKC (largura cheia, ligaduras), sem acento, minúsculas: a forma em que as palavras são procuradas. */
export function normalizarParaRegra(t: string): string {
  return (t ?? "").normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Palavras e expressões, já sem acento. Ficaram de fora, de propósito:
 *  - "conta" e "cartão" sozinhos: "a conta do Instagram", "o cartão que você propôs" (o cartão do
 *    Assistente é o vocabulário da própria tela);
 *  - "valor" sozinho e "mil" sem número ("mil desculpas");
 *  - "devo" sozinho: "o que devo responder?" é a pergunta mais comum do painel. Só conta com cara de
 *    dívida ("quanto devo", "devo 300", "devo no cartão", "devo pro João");
 *  - "pago" sozinho ("tráfego pago" é assunto do PRUMO) e "gastronomia" (nicho de lead);
 *  - "caixa" e "inter" sozinhos ("caixa de entrada", "interior"): só "caixa econômica", "banco inter".
 */
const PALAVRAS_DE_FINANCAS = new RegExp(
  "\\b(?:" +
    [
      "reais", "fatur\\w*", "extrato\\w*", "saldo\\w*", "orcament\\w*", "cartao de credito", "cartoes de credito", "limite do cartao",
      "pluggy", "investiment\\w*", "pix", "boleto\\w*", "emprestim\\w*", "parcel\\w*",
      "gast(?:o|os|ei|ou|ar|amos|aram|ando|ava|ando)", "despesa\\w*",
      "pag(?:uei|ar|ou|amos|aram|ando|amento\\w*)",
      "salari\\w*", "holerite\\w*", "contracheque\\w*", "divida\\w*", "devend\\w*", "debito\\w*",
      "impostos?", "darf", "irpf", "iptu", "ipva", "inss", "fgts", "dinheiro", "grana", "juros", "financ\\w*", "rendiment\\w*",
      "mensalidade\\w*", "cdb", "tesouro direto", "selic", "aluguel", "alugueis", "condominio\\w*",
      "conta de (?:luz|agua|gas|internet|telefone|celular|energia)", "contas a pagar", "conta corrente", "conta bancaria", "poupanca\\w*",
      "lucr\\w*", "prejuizo\\w*", "transferi", "transferiu", "transferimos", "transferencia\\w*",
      "cobr(?:ei|ar|ou|o|amos|aram|ando|anca\\w*)", "precos?", "valor(?:es)? (?:d[aeo]s?|total|cobrado|pago|final|mensal|cheio)",
      // Bancos e carteiras: o nome já diz onde está o dinheiro dele.
      "nubank", "itau", "santander", "bradesco", "caixa economica", "banco do brasil", "banco inter", "c6", "c6 bank",
      "picpay", "mercado pago", "pagbank", "pagseguro", "sicoob", "sicredi", "btg",
      "quanto (?:eu )?(?:devo|deve|devemos|tenho na|entrou|entraram|vendi|vendemos|faturei|faturou|ganhei|ganhou|lucrei|sobrou|sobra|gastei|paguei|recebi|custa\\w*|custou|cobr\\w*|pag\\w*|fica|ficou|sai|saiu|vale)",
      "dev(?:o|emos|ia) (?:\\d+|no|na|nos|nas|ao|aos|a|as|pr[ao]s?|para [ao]s?)",
    ].join("|") +
    ")\\b",
);
/** Moedas: sem `\b` no fim, porque "$" não é letra e "r$ 500" não tem fronteira de palavra depois dele. */
const SIMBOLOS_DE_MOEDA = /\br\s*\$|\bus\s*\$|\$\s*\d|\d\s*\$|€|\b(?:brl|usd|eur)\b/;

// ------------------------------------------------------------------ número com cara de dinheiro

/**
 * O que vem depois do número e o faz ser contagem, não dinheiro: "por 15 dias", "10k seguidores",
 * "fechou 30 leads". Com acento opcional, porque estas regras rodam no texto como ele é (é o mesmo
 * texto que vai ao modelo, só com o valor trocado).
 */
const NAO_E_DINHEIRO = String.raw`(?!\s*(?:dias?|horas?|h\b|hs\b|min\w*|seg\w*|semanas?|m[eê]s\b|meses|anos?|%|por\s*cento|leads?|seguidor\w*|visualiza\w*|views?|curtidas?|acessos?|visitas?|pessoas|clientes?|mensage\w*|fotos?|posts?|v[ií]deos?|vezes|vendas?|contratos?|sites?|propostas?|avalia\w*|estrelas?|km|metros?|m2|itens?|unidades?|nichos?|cidades?|empresas?|neg[oó]cios?|perguntas?|respostas?|linhas?|p[aá]ginas?|caracteres))`;
const MILHAO = String.raw`milh(?:[õo]es|[aã]o)`;
const POR_EXTENSO = String.raw`(?:um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzent[oa]s|trezent[oa]s|quatrocent[oa]s|quinhent[oa]s|seiscent[oa]s|setecent[oa]s|oitocent[oa]s|novecent[oa]s|mil|${MILHAO})`;
/** Palavras que, logo antes de um número de 2+ dígitos, fazem dele preço: "fica 690", "fechou 900", "proposta de 1500". */
const ANTES_DO_PRECO = String.raw`(?:por|fica\w*|ficou|cust\w*|pre[cç]o\w*|valor\w*|parcela\w*|entrada|sinal|mensalidade\w*|cobr\w*|pag(?:o|ou|uei|ar|amos|amento\w*)|receb\w*|fech\w*|propost\w*|or[cç]ament\w*|invest\w*|ganh\w*|vend\w*|gast(?:o|os|ei|ou|ar)|sobr\w*|lucr\w*|fatur\w*|total|desconto|deve|devo|d[ií]vida)`;

/**
 * As regras de valor, na ordem em que trocam. Todas com a flag `g` (são usadas no `replace`); o
 * `temValorEmDinheiro` cria cópias sem estado. `manter` = quantos grupos do começo ficam (a palavra
 * de "fica 690" fica, o número sai).
 */
const REGRAS_DE_VALOR: Array<{ re: RegExp; manterPrefixo?: boolean }> = [
  // "R$ 1.200,00", "R $ 900", "R$ mil", "US$ 30", "R$1,2 mil"
  { re: new RegExp(String.raw`\b(?:R|US)\s*\$\s*-?\s*(?:\d[\d.,]*(?:\s*(?:mil|k|${MILHAO})\b)?|mil\b)?`, "gi") },
  // "BRL 900", "$ 30", "€40", "900 USD"
  { re: new RegExp(String.raw`(?:\b(?:BRL|USD|EUR)\s*|[$€]\s*)-?\d[\d.,]*(?:\s*(?:mil|k|${MILHAO})\b)?|\d[\d.,]*\s*(?:BRL|USD|EUR)\b`, "gi") },
  // "690 reais", "900 conto", "2 mil", "1,2k" (mas não "10k seguidores")
  { re: new RegExp(String.raw`(?<![\w.,])\d[\d.,]*\s*(?:reais|real\b|contos?\b|pilas?\b|(?:mil|k|${MILHAO})\b${NAO_E_DINHEIRO})`, "gi") },
  // "mil e duzentos reais"
  { re: new RegExp(String.raw`\b(?:${POR_EXTENSO}\b(?:\s+e\s+|\s+|,\s*)?)+(?:reais|real|contos?|pilas?)\b`, "gi") },
  // "12x de 49", "3x 200"
  { re: /\b\d{1,2}\s*x\s*(?:de\s*)?\d{2,}(?:[.,]\d+)*/gi },
  // "39 por mês", "49/mês", "99 mensais"
  { re: /(?<![\w.,:])\d{2,}(?:[.,]\d+)*(?=\s*(?:(?:por|ao|\/)\s*(?:m[eê]s|ano|semana)\b|mensa(?:l|is)\b|anua(?:l|is)\b))/gi },
  // Separador de milhar: "1.200", "1.500,00" (não CPF, CNPJ, hora nem data: nada de dígito, ":", "/" ou "-" colado)
  { re: /(?<![\d.,:\/-])\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?(?![\d:\/-]|[.,]\d)/g },
  // Centavos: "4,50", "1200,00"
  { re: /(?<![\d.,:\/-])\d+,\d{2}(?![\d,:\/-]|\.\d)/g },
  // "fica 690", "fechou 900", "proposta de 1500": a palavra fica, o número sai.
  { re: new RegExp(String.raw`(\b${ANTES_DO_PRECO}\s+(?:(?:de|em|por|uns|umas|um|uma|s[oó]|apenas|mais|menos)\s+)*)\d{2,}(?:[.,]\d+)*\b${NAO_E_DINHEIRO}`, "gi"), manterPrefixo: true },
];

export const ROTULO_DE_VALOR = "[valor omitido]";

/**
 * PURO. Troca todo valor com cara de dinheiro por um rótulo. É o que roda em tudo o que vai a um
 * modelo (o texto do Rômulo já barrado antes; as leituras do CRM, a conversa do lead, a agenda) e no
 * que volta dele. O texto sai em NFKC: "R＄500" e "R$500" são o mesmo valor.
 */
export function omitirValores(t: string, rotulo = ROTULO_DE_VALOR): string {
  let saida = (t ?? "").normalize("NFKC");
  for (const { re, manterPrefixo } of REGRAS_DE_VALOR) {
    saida = saida.replace(re, (...m: unknown[]) => (manterPrefixo ? `${String(m[1] ?? "")}${rotulo}` : rotulo));
  }
  return saida;
}

/** PURO. O texto tem algum número com cara de dinheiro (a mesma régua do `omitirValores`)? */
export function temValorEmDinheiro(t: string): boolean {
  const n = (t ?? "").normalize("NFKC");
  return REGRAS_DE_VALOR.some(({ re }) => new RegExp(re.source, re.flags.replace("g", "")).test(n));
}

/**
 * PURO. A demanda parece finanças? Então nem sai do processo (RULES 24, 27 e 28).
 * Conservador de propósito: ver o comentário do topo. O gasto falado já não vira turno no
 * Telegram, mas a folha Pedir e o painel do Assistente aceitam qualquer texto.
 */
export function pareceFinancas(demanda: string): boolean {
  const t = demanda ?? "";
  if (lerGastoFalado(t)) return true;
  const n = normalizarParaRegra(t);
  if (SIMBOLOS_DE_MOEDA.test(n) || PALAVRAS_DE_FINANCAS.test(n)) return true;
  return temValorEmDinheiro(t);
}
