// Respostas de /api/financas/* (espelho de server/financas/resumo.ts e rotas.ts).

export type Saude = 'ok' | 'atualizando' | 'atencao' | 'erro'

export interface ConexaoVista {
  itemId: string
  nome: string
  status: string
  dadosAte: string | null
  consentimentoAte: string | null
  lidoEm: string | null
  erroLeitura: string | null
  saude: Saude
  /**
   * Nomes das contas desta conexão (sem valor), quando o servidor os mandar: o nome do conector
   * é o mesmo para todas as conexões do Meu Pluggy (AC-26). Ausente, o selo numera as repetidas.
   */
  contas?: string[]
}

export interface Situacao {
  pluggyConfigurada: boolean
  problema: string | null
  sincronizando: boolean
  ultimaSincronizacao: { inicio: string; fim: string | null; ok: boolean | null; origem: string } | null
  /** "Explicar este mês" ligado no servidor (SQUADONE_FINANCAS_IA). */
  explicacaoIa?: boolean
}

export interface CartaoVisto {
  id: string
  nome: string
  instituicao: string
  final: string | null
  limiteCentavos: number | null
  usadoBancoCentavos: number | null
  usoPct: number | null
  semaforo: Semaforo | null
  fechada: { vencimento: string; centavos: number; pagoCentavos: number } | null
  aberta: { vencimento: string; centavos: number; semLancamentos: boolean }
  futurasCentavos: number
  detalhadoCentavos: number
  semDetalheCentavos: number
  totalCentavos: number
}

export interface Parcelamento {
  grupo: string
  descricao: string
  cartao: string
  valorParcela: number
  total: number
  ultimaVista: number
  restantes: number
  acabaEm: string
}

export type Semaforo = 'verde' | 'amarelo' | 'laranja' | 'vermelho'

export interface OrcamentoDaCategoria {
  categoria: string
  limiteCentavos: number
  gastoCentavos: number
  pct: number
  semaforo: Semaforo
}

export interface Recorrente {
  estabelecimento: string
  descricao: string
  categoria: string
  mediaCentavos: number
  vezes: number
  ultimaData: string
  origem: 'detectado' | 'marcado'
}

export interface VisaoFinanceira extends Situacao {
  hoje: string
  mes: string
  visao: 'competencia' | 'caixa'
  tenho: { totalCentavos: number; contas: { id: string; nome: string; instituicao: string; tipo: string; saldoCentavos: number }[] }
  devo: {
    totalCentavos: number
    cartoes: CartaoVisto[]
    porMes: { mes: string; centavos: number }[]
    parcelamentos: Parcelamento[]
    parcelasAcabamEm: string | null
  }
  gastei: { totalCentavos: number; anteriorCentavos: number; categorias: { categoria: string; centavos: number; anteriorCentavos: number }[] }
  recebi: { totalCentavos: number; anteriorCentavos: number }
  orcamento: { limiteCentavos: number; gastoCentavos: number; pct: number; semaforo: Semaforo; categorias: OrcamentoDaCategoria[] } | null
  recorrentes: Recorrente[]
  recorrentesDesmarcados: { estabelecimento: string; descricao: string }[]
  saude: { conexoes: ConexaoVista[]; dadosAte: string | null }
}

export interface Organizacao extends Situacao {
  categorias: { nome: string; lancamentos: number; orcamentoCentavos: number | null; fixa: boolean }[]
  regras: { estabelecimento: string; categoria: string; lancamentos: number }[]
}

export interface PreviaDoExtrato {
  conta: { id: string; nome: string; tipo: string }
  formato: 'ofx' | 'csv'
  lidos: number
  novos: number
  jaEstavam: number
  ignoradas: number
  invertido: boolean
  sugereInverter: boolean
  periodo: { de: string; ate: string }
  lancamentos: { data: string; descricao: string; centavos: number; novo: boolean }[]
  gravado: boolean
}

export interface Lancamento {
  id: string
  data: string
  dataCompra: string
  descricao: string
  centavos: number
  natureza: string
  categoria: string
  origemCategoria: 'pluggy' | 'regra' | 'regra_usuario' | 'usuario' | 'nenhuma'
  estabelecimento: string
  temRegra: boolean
  recorrente: boolean
  marcaDeRecorrente: boolean | null
  contaId: string
  conta: string
  parcela: string | null
  pendente: boolean
  fonte: string
  cartaoFinal: string | null
}

export interface ListaDeLancamentos extends Situacao {
  total: number
  somaCentavos: number
  offset: number
  lancamentos: Lancamento[]
  contas: { id: string; nome: string; tipo: string }[]
  categorias: string[]
  categoriasEscolhiveis: string[]
}

export interface PreviaDaFatura {
  fatura: { id: string; vencimento: string; totalBanco: number }
  conferencia: {
    totalPdf: number | null
    totalBanco: number
    saldoAnterior: number | null
    debitosCentavos: number
    creditosCentavos: number
    esperadoCentavos: number | null
    diferencaCentavos: number | null
    bate: boolean
  }
  lidos: number
  novos: number
  lancamentos: { dataCompra: string; descricao: string; centavos: number; parcela: string | null; cartaoFinal: string | null; novo: boolean }[]
  gravado: boolean
}
