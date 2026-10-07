import { descricaoNormalizada, estabelecimentoDe } from "./comum.ts";
import type { Natureza, OrigemDaCategoria } from "./tipos.ts";

/**
 * Categoria por REGRA DETERMINÍSTICA (RULES 24: nada de finanças vai ao
 * modelo). PURO. Quatro fontes, nesta ordem:
 *
 * 1. a natureza manda quando ela já diz o que é (pagamento de fatura,
 *    transferência entre contas, rendimento, encargo): categoria de despesa
 *    nessas linhas confundiria o "gastei";
 * 2. a regra que o Rômulo criou para o estabelecimento ("aplicar sempre a
 *    este estabelecimento", tabela `regra_categoria`);
 * 3. a categoria da Pluggy (em inglês), traduzida por tabela;
 * 4. palavras da descrição, para o que chega sem categoria (a fatura em PDF do
 *    Santander, a Pluggy quando não classificou).
 *
 * A categoria dada pelo Rômulo no próprio lançamento (`origem: "usuario"`)
 * nunca passa por aqui.
 */

export const SEM_CATEGORIA = "Outros";

const POR_NATUREZA: Partial<Record<Natureza, string>> = {
  pagamento_fatura: "Pagamento de fatura",
  transferencia: "Transferência entre contas",
  rendimento: "Rendimentos",
  encargo: "Juros, IOF e encargos",
};

/**
 * Categorias que a ESTRUTURA dá (natureza) e o "Outros" de reserva: não se
 * renomeiam, não se removem e não se escolhem à mão. Renomear "Pagamento de
 * fatura" não mudaria a natureza, e um gasto marcado com ela pareceria quitar
 * uma fatura.
 */
export const CATEGORIAS_FIXAS: readonly string[] = [...new Set(Object.values(POR_NATUREZA)), SEM_CATEGORIA];

/** Categoria da Pluggy (minúsculas, contém) → nossa. A primeira que casa vence: o específico antes do geral. */
const DA_PLUGGY: [string[], string][] = [
  [["credit card payment"], "Pagamento de fatura"],
  [["same person transfer"], "Transferência entre contas"],
  [["salary"], "Salário"],
  [["proceeds interests", "dividends"], "Rendimentos"],
  [["income", "retirement", "government aid", "entrepreneurial"], "Outras receitas"],
  [["interests charged", "late payment", "credit card fees", "tax on financial operations"], "Juros, IOF e encargos"],
  [["bank fees", "account fees", "wire transfer fees"], "Tarifas bancárias"],
  [["income taxes", "taxes on"], "Impostos"],
  [["investment", "fixed income", "mutual funds", "variable income", "pension", "margin"], "Investimentos"],
  [["groceries"], "Mercado"],
  [["food delivery"], "Delivery"],
  [["eating out", "food and drinks"], "Restaurantes"],
  [["gas stations"], "Combustível"],
  [["taxi", "public transportation", "car rental", "bicycle", "parking", "tolls", "vehicle", "automotive", "transportation"], "Transporte"],
  [["pharmacy"], "Farmácia"],
  [["health", "dentist", "optometry", "hospital", "wellness", "gym", "fitness", "sports practice"], "Saúde e bem-estar"],
  [["insurance"], "Seguros"],
  [["digital services", "video streaming", "music streaming", "gaming"], "Assinaturas"],
  [["telecommunications", "internet", "mobile", "tv"], "Telefone e internet"],
  [["rent", "housing", "utilities", "water", "electricity", "gas", "houseware", "urban land"], "Casa"],
  [["education", "courses", "university", "school", "kindergarten"], "Educação"],
  [["travel", "airport", "accomodation", "accommodation", "mileage", "bus tickets"], "Viagem"],
  [["leisure", "cinema", "museums", "sporting events", "gambling", "lottery", "online bet"], "Lazer"],
  [["shopping", "electronics", "clothing", "pet", "kids", "bookstore", "sports goods", "office supplies"], "Compras"],
  [["taxes"], "Impostos"],
  [["donations"], "Doações"],
  [["loans", "financing"], "Empréstimos e financiamentos"],
  [["transfer"], "Pix e transferências"],
];

/** Descrição normalizada (sem acento, maiúscula) → categoria. Para o que chega sem categoria. */
const DA_DESCRICAO: [RegExp, string][] = [
  [/\b(IOF|JUROS|ENCARGO|MULTA|ROTATIVO)\b/, "Juros, IOF e encargos"],
  [/\bANUIDADE|\bTARIFA/, "Tarifas bancárias"],
  [/\b(IFOOD|IFD|RAPPI|ZE DELIVERY|AIQFOME)\b/, "Delivery"],
  [/\b(UBER|99 ?APP|99 ?POP|99 ?TAXI|CABIFY|METRO|SEM PARAR|CONECTCAR|VELOE|ESTACION\w*|PEDAGIO)\b/, "Transporte"],
  [/\b(POSTO|SHELL|IPIRANGA|PETROBRAS|BR DISTRIB\w*|ALE COMBUST\w*)\b/, "Combustível"],
  [/\b(DROGA\w*|FARMA\w*|PAGUE MENOS|RAIA|PANVEL)\b/, "Farmácia"],
  [/\b(SUPERMERC\w*|MERCADO|ATACAD\w*|CARREFOUR|ASSAI|PAO DE ACUCAR|HORTIFRUTI|SACOLAO|EMPORIO)\b/, "Mercado"],
  [/\b(NETFLIX|SPOTIFY|PRIME VIDEO|AMAZON PRIME|DISNEY|HBO|MAX COM|YOUTUBE|APPLE COM|ICLOUD|GOOGLE ONE|CHATGPT|OPENAI|ANTHROPIC|CLAUDE AI|DEEZER|GLOBOPLAY|PARAMOUNT)\b/, "Assinaturas"],
  [/\b(RESTAUR\w*|LANCHON\w*|PADARIA|BAR|CAFE|CAFETERIA|BURGER|PIZZ\w*|MC ?DONALDS|OUTBACK|BK|SUBWAY|STARBUCKS)\b/, "Restaurantes"],
  [/\b(AMAZON|MERCADOLIVRE|MERCADO LIVRE|MELI|SHOPEE|ALIEXPRESS|MAGALU|MAGAZINE LUIZA|SHEIN|AMERICANAS|KABUM)\b/, "Compras"],
  [/\b(AZUL|GOL LINHAS|LATAM|HOTEL\w*|AIRBNB|BOOKING|DECOLAR|123 ?MILHAS)\b/, "Viagem"],
  [/\b(SMART ?FIT|ACADEMIA|GYMPASS|WELLHUB|TOTALPASS|CLINICA|HOSPITAL|LABORATORIO|ODONTO\w*|DENTIST\w*)\b/, "Saúde e bem-estar"],
  [/\b(SEGURO\w*|PORTO SEGURO)\b/, "Seguros"],
  [/\b(VIVO|CLARO|TIM|OI FIBRA|NET SERVICOS)\b/, "Telefone e internet"],
  [/\b(ENEL|CPFL|LIGHT|CEMIG|COPEL|SABESP|COMGAS|CONDOMINIO|ALUGUEL)\b/, "Casa"],
];

export function categoriaDaPluggy(categoriaFonte: string): string | null {
  const c = categoriaFonte.trim().toLowerCase();
  if (!c) return null;
  for (const [chaves, categoria] of DA_PLUGGY) if (chaves.some((k) => c.includes(k))) return categoria;
  return null;
}

export function categoriaDaDescricao(descricao: string): string | null {
  const d = descricaoNormalizada(descricao);
  for (const [regra, categoria] of DA_DESCRICAO) if (regra.test(d)) return categoria;
  return null;
}

/** Todas as categorias que as regras daqui produzem: a lista inicial da tela "Organizar". */
export const CATEGORIAS_PADRAO: readonly string[] = [
  ...new Set([...Object.values(POR_NATUREZA), ...DA_PLUGGY.map(([, c]) => c), ...DA_DESCRICAO.map(([, c]) => c), "Outras receitas", SEM_CATEGORIA]),
];

/**
 * Categoria de um lançamento. A da natureza vence a da Pluggy de propósito: a
 * Pluggy pode chamar de "Transfer - PIX" o Pix que pagou a fatura, e o "gastei"
 * somaria um gasto que já está nas compras do cartão. A regra do Rômulo vem
 * logo depois da natureza: ele a criou corrigindo justamente o que a Pluggy
 * ou a descrição diziam.
 */
export function categorizar(
  t: {
    natureza: Natureza;
    descricao: string;
    categoriaFonte: string;
    categoria?: string;
    origemCategoria?: OrigemDaCategoria;
  },
  regras: ReadonlyMap<string, string> = new Map(),
): { categoria: string; origemCategoria: OrigemDaCategoria } {
  if (t.origemCategoria === "usuario" && t.categoria) return { categoria: t.categoria, origemCategoria: "usuario" };
  const daNatureza = POR_NATUREZA[t.natureza];
  if (daNatureza) return { categoria: daNatureza, origemCategoria: "regra" };
  const daRegra = regras.size ? regras.get(estabelecimentoDe(t.descricao)) : undefined;
  if (daRegra) return { categoria: daRegra, origemCategoria: "regra_usuario" };
  const daPluggy = categoriaDaPluggy(t.categoriaFonte);
  // "Pix e transferências" da Pluggy é genérica demais quando a descrição diz mais.
  if (daPluggy && daPluggy !== "Pix e transferências") return { categoria: daPluggy, origemCategoria: "pluggy" };
  const daDescricao = categoriaDaDescricao(t.descricao);
  if (daDescricao) return { categoria: daDescricao, origemCategoria: "regra" };
  if (daPluggy) return { categoria: daPluggy, origemCategoria: "pluggy" };
  if (t.natureza === "receita") return { categoria: "Outras receitas", origemCategoria: "regra" };
  return { categoria: SEM_CATEGORIA, origemCategoria: "nenhuma" };
}
