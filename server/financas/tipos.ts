/**
 * Modelo de finanças (06/10/2026). Tipos só, sem lógica: os módulos puros
 * desta pasta e o banco (`banco.ts`) falam esta língua.
 *
 * Dinheiro é sempre CENTAVOS INTEIROS. `number` em reais acumula erro de
 * ponto flutuante numa soma de 2.000 lançamentos, e a conferência da fatura
 * contra o banco exige bater no centavo.
 *
 * Sinal de `Transacao.centavos`: do ponto de vista do patrimônio do Rômulo.
 * Negativo = saiu dinheiro ou aumentou a dívida (compra no cartão, débito na
 * conta); positivo = entrou ou diminuiu a dívida (salário, pagamento recebido
 * pelo cartão, estorno). A soma de uma conta é a variação do saldo dela.
 */

export const TIPOS_DE_CONTA = ["corrente", "poupanca", "cartao", "investimento", "dinheiro", "beneficio"] as const;
export type TipoDeConta = (typeof TIPOS_DE_CONTA)[number];

export const NATUREZAS = [
  "despesa",
  "receita",
  "transferencia",
  "pagamento_fatura",
  "estorno",
  "rendimento",
  "encargo",
] as const;
export type Natureza = (typeof NATUREZAS)[number];

/** `pdf`: importador da fatura do Santander, o cartão que a Pluggy traz sem lançamentos. */
export const FONTES = ["pluggy", "ofx", "csv", "manual", "pdf"] as const;
export type Fonte = (typeof FONTES)[number];

/**
 * De onde veio a categoria: da Pluggy, da regra local, de uma regra que o
 * Rômulo criou ("aplicar sempre a este estabelecimento"), ou dele no próprio
 * lançamento (essa nunca é sobrescrita).
 */
export type OrigemDaCategoria = "pluggy" | "regra" | "regra_usuario" | "usuario" | "nenhuma";

export type StatusDaTransacao = "pendente" | "lancada";

export interface Conta {
  id: string;
  /** Item da Pluggy (conexão); vazio para conta manual. */
  itemId: string;
  nome: string;
  instituicao: string;
  tipo: TipoDeConta;
  /** Saldo da conta. No cartão é o valor que a fonte chama de saldo (dívida, positivo). */
  saldoCentavos: number;
  /** Só cartão: limite total e disponível, quando a fonte dá. */
  limiteCentavos: number | null;
  limiteDisponivelCentavos: number | null;
  /** Últimos 4 dígitos, quando a fonte dá (cartão ou conta). */
  final: string | null;
  atualizadoEm: string;
}

export interface Fatura {
  id: string;
  cartaoId: string;
  /** AAAA-MM-DD; a Pluggy dá `billClosingDate`, que pode faltar. */
  fechamento: string | null;
  vencimento: string;
  totalBanco: number;
  pagoCentavos: number;
  encargosCentavos: number;
  minimoCentavos: number | null;
  /** Pagamentos que o banco registrou nesta fatura: casam com o débito na conta corrente. */
  pagamentos: { data: string; centavos: number }[];
}

export interface Transacao {
  id: string;
  contaId: string;
  fonte: Fonte;
  /** Id na fonte (Pluggy) ou vazio. */
  idOrigem: string;
  chaveDedupe: string;
  /** AAAA-MM-DD. Na parcela é a data da compra original quando a fonte dá. */
  dataCompra: string;
  /** AAAA-MM-DD: quando entrou na conta ou na fatura. */
  dataLancamento: string;
  descricao: string;
  centavos: number;
  natureza: Natureza;
  categoria: string;
  origemCategoria: OrigemDaCategoria;
  /** Categoria crua da fonte (Pluggy em inglês), para refazer a regra sem nova leitura. */
  categoriaFonte: string;
  /** Fatura em que o lançamento é cobrado, DERIVADA pelo passe (`processar.ts`); null = a aberta. */
  faturaId: string | null;
  /**
   * Fatura que a FONTE deu (Pluggy `billId`, a do PDF), como veio. O passe a
   * lê e nunca a sobrescreve: `faturaId` é refeita a cada passe, e um `billId`
   * que ainda não está em /bills (a fatura aberta) só se reconhece por ele.
   */
  faturaFonte: string | null;
  /** AAAA-MM previsto pela fonte para a fatura (Pluggy `billForecastDate`). */
  mesFaturaFonte: string | null;
  parcelaN: number | null;
  parcelaTotal: number | null;
  grupoParcela: string | null;
  /** Par numa transferência entre contas próprias ou no pagamento da fatura. */
  parId: string | null;
  status: StatusDaTransacao;
  /** Final do cartão (titular, adicional ou digital), quando a fonte dá. */
  cartaoFinal: string | null;
}

export type SaudeDaConexao = "ok" | "atualizando" | "atencao" | "erro";

export interface Conexao {
  itemId: string;
  nome: string;
  /** Status da Pluggy como veio: UPDATED, UPDATING, LOGIN_ERROR, OUTDATED, WAITING_USER_ACTION. */
  status: string;
  executionStatus: string;
  /** Última sincronização da Pluggy com o banco (`lastUpdatedAt`). */
  dadosAte: string | null;
  consentimentoAte: string | null;
  /** Última leitura nossa desta conexão. */
  lidoEm: string | null;
  /** Falha da nossa leitura (sem valores: só status e código). */
  erroLeitura: string | null;
}
