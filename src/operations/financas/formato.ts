// Formatação das telas de finanças. Sem Vue; locale fixo pt-BR.

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** Centavos → "R$ 1.234,56"; sinal de menos quando negativo. */
export function brl(centavos: number): string {
  return BRL.format(centavos / 100)
}

/** "2026-10" → "out/26". */
export function mesCurto(mes: string): string {
  const [ano, m] = mes.split('-')
  return `${MESES[Number(m) - 1]}/${ano.slice(2)}`
}

/** "2026-10" → "outubro de 2026". */
export function mesLongo(mes: string): string {
  const [ano, m] = mes.split('-')
  return `${MESES_LONGOS[Number(m) - 1]} de ${ano}`
}

export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  const total = a * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** "2026-10-07" ou ISO → "07/10". */
export function diaMes(data: string | null | undefined): string {
  if (!data) return '—'
  const d = data.slice(0, 10)
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`
}

/** ISO → "07/10 às 09:30" no fuso de São Paulo. */
export function diaHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`
}

/** Variação contra o mês anterior em texto: "+12%", "−5%", "novo", "igual". */
export function variacao(atual: number, anterior: number): string {
  if (anterior === 0) return atual === 0 ? 'igual' : 'novo'
  const pct = Math.round(((atual - anterior) / anterior) * 100)
  if (pct === 0) return 'igual'
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`
}

export const ROTULO_DA_SAUDE = { ok: 'Atualizada', atualizando: 'Atualizando', atencao: 'Precisa de você', erro: 'Falhou' } as const

export const ROTULO_DO_TIPO: Record<string, string> = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  cartao: 'Cartão',
  investimento: 'Investimento',
  dinheiro: 'Dinheiro',
  beneficio: 'Benefício',
}

export const ROTULO_DA_NATUREZA: Record<string, string> = {
  despesa: 'Despesa',
  receita: 'Receita',
  transferencia: 'Entre contas',
  pagamento_fatura: 'Pagamento de fatura',
  estorno: 'Estorno',
  rendimento: 'Rendimento',
  encargo: 'Encargo',
}

/** O que dizer de cada status da Pluggy quando ele pede gesto. */
export function oQueFazer(status: string): string {
  if (status === 'LOGIN_ERROR') return 'Reconecte o banco no app Meu Pluggy.'
  if (status === 'WAITING_USER_ACTION') return 'O banco pede uma confirmação no app Meu Pluggy.'
  if (status === 'OUTDATED') return 'O Meu Pluggy não conseguiu atualizar; abra o app e atualize a conexão.'
  return ''
}
