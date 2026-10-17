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

export const ROTULO_DO_SEMAFORO = { verde: 'Tranquilo', amarelo: 'Passou de 70%', laranja: 'Passou de 90%', vermelho: 'Chegou a 100%' } as const

/** "1.234,56", "500", "R$ 80,5" → centavos; vazio ou ilegível = null. */
export function centavosDeReais(texto: string): number | null {
  const limpo = texto.replace(/R\$|\s/gi, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(limpo)) return null
  const n = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpo) ? Number(limpo.replace(/\./g, '').replace(',', '.')) : Number(limpo.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

/** Centavos → "1234,56" para preencher um campo de reais. */
export function reaisDoCampo(centavos: number | null): string {
  return centavos === null ? '' : (centavos / 100).toFixed(2).replace('.', ',').replace(/,00$/, '')
}

/** Escrita nas rotas de finanças: JSON, erro com a mensagem do servidor. */
export async function enviarJson<T = Record<string, unknown>>(metodo: 'POST' | 'PUT' | 'PATCH', caminho: string, corpo: unknown): Promise<T> {
  const resposta = await fetch(`/api/financas${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  const dados = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(dados.error ?? `HTTP ${resposta.status}`)
  return dados as T
}

/** "AAAA-MM-DD" de hoje no fuso de São Paulo (o dia das finanças, não o do navegador em viagem). */
export function hojeEmSaoPaulo(agora: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(agora).map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}`
}

/**
 * Lançamentos até hoje primeiro, as parcelas futuras à parte (AC-26, 17/10/2026). A lista vem
 * do servidor da data mais nova para a mais velha, então as parcelas que só vencem em meses à
 * frente (pendentes) abriam a tela e empurravam o que aconteceu de verdade para baixo. Até hoje
 * fica na ordem que veio; as futuras vão da mais próxima à mais distante (a próxima a vencer é a
 * que interessa), e no mesmo dia mantêm a ordem que veio.
 */
export function separarFuturas<T extends { data: string }>(itens: readonly T[], hoje: string): { ateHoje: T[]; futuras: T[] } {
  const ateHoje: T[] = []
  const futuras: T[] = []
  for (const l of itens) (l.data.slice(0, 10) > hoje ? futuras : ateHoje).push(l)
  // sort é estável: o empate (mesmo dia) fica na ordem do servidor.
  futuras.sort((a, b) => a.data.slice(0, 10).localeCompare(b.data.slice(0, 10)))
  return { ateHoje, futuras }
}

/**
 * As opções do filtro de mês (AC-26): o `<input type="month">` vazio mostrava "---------- de ----".
 * "Todos os meses" primeiro; depois o mês atual e os 24 anteriores, do mais novo ao mais velho; os
 * 12 à frente (as parcelas) por último. Um mês do endereço fora da faixa entra também, para o
 * select nunca mostrar uma escolha que não é a do filtro.
 */
export function mesesDoFiltro(mesAtual: string, escolhido: string): { valor: string; rotulo: string; futuro: boolean }[] {
  const passados = Array.from({ length: 25 }, (_, i) => somarMeses(mesAtual, -i))
  const futuros = Array.from({ length: 12 }, (_, i) => somarMeses(mesAtual, i + 1))
  const opcoes = [
    ...passados.map((m) => ({ valor: m, rotulo: m === mesAtual ? `${mesLongo(m)} (este mês)` : mesLongo(m), futuro: false })),
    ...futuros.map((m) => ({ valor: m, rotulo: mesLongo(m), futuro: true })),
  ]
  if (/^\d{4}-\d{2}$/.test(escolhido) && !opcoes.some((o) => o.valor === escolhido)) {
    opcoes.push({ valor: escolhido, rotulo: mesLongo(escolhido), futuro: escolhido > mesAtual })
  }
  return [{ valor: '', rotulo: 'Todos os meses', futuro: false }, ...opcoes]
}

/**
 * O nome de cada conexão no selo de saúde (AC-26). A Pluggy dá o nome do conector, e pelo Meu
 * Pluggy as três conexões se chamam igual ("MeuPluggy"): três selos "Atualizada · MeuPluggy" não
 * dizem qual banco está atrasado. Com as contas da conexão (nomes, nunca valor: RULES 24), o selo
 * diz quais são; sem elas, os nomes repetidos ganham "conexão 1 de 3", que ao menos separa um do outro.
 */
export function nomesDasConexoes(conexoes: readonly { nome: string; contas?: readonly string[] }[]): string[] {
  const contasDe = (c: { contas?: readonly string[] }) => (c.contas ?? []).map((n) => n.trim()).filter(Boolean)
  // Só as que ficam sem contas disputam o nome: as outras já se distinguem pelas contas.
  const vezes = new Map<string, number>()
  for (const c of conexoes) if (!contasDe(c).length) vezes.set(c.nome, (vezes.get(c.nome) ?? 0) + 1)
  const visto = new Map<string, number>()
  return conexoes.map((c) => {
    const contas = contasDe(c)
    if (contas.length) return `${c.nome}: ${contas.join(', ')}`
    const total = vezes.get(c.nome) ?? 1
    if (total < 2) return c.nome
    const n = (visto.get(c.nome) ?? 0) + 1
    visto.set(c.nome, n)
    return `${c.nome} (conexão ${n} de ${total})`
  })
}

/** O que dizer de cada status da Pluggy quando ele pede gesto. */
export function oQueFazer(status: string): string {
  if (status === 'LOGIN_ERROR') return 'Reconecte o banco no app Meu Pluggy.'
  if (status === 'WAITING_USER_ACTION') return 'O banco pede uma confirmação no app Meu Pluggy.'
  if (status === 'OUTDATED') return 'O Meu Pluggy não conseguiu atualizar; abra o app e atualize a conexão.'
  return ''
}
