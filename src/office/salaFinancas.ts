/**
 * Sala Finanças no escritório (07/10/2026). Sem Vue.
 *
 * A sala é um DOMÍNIO comum do roster, aberto pelo "+ Abrir sala" com o nome
 * "Finanças" (ou id terminado em `--financas`): o escritório só reconhece e
 * pendura no PO dela o estado que `/api/financas/estado` devolve. O estado não
 * entra no roster nem no prompt (RULES 24: finanças nunca vão ao
 * systemInstruction); só a tela o mostra, e só com % e semáforo, nunca R$:
 * o escritório aparece em print de tela.
 */

export type Semaforo = 'verde' | 'amarelo' | 'laranja' | 'vermelho'

export interface EstadoDasFinancas {
  cartao: { pct: number; semaforo: Semaforo; nome: string } | null
  orcamento: { pct: number; semaforo: Semaforo } | null
}

export interface EstadoDoAgente {
  texto: string
  /** O pior dos dois: é a cor do balão. */
  semaforo: Semaforo
}

const ORDEM: Semaforo[] = ['verde', 'amarelo', 'laranja', 'vermelho']

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export function ehSalaDeFinancas(d: { id: string; nome: string }): boolean {
  return semAcento(d.nome) === 'financas' || d.id === 'financas' || d.id.endsWith('--financas')
}

/** "cartão 72% · orçamento 45%"; null quando não há nem cartão com limite nem orçamento. */
export function estadoDoAgente(e: EstadoDasFinancas | null): EstadoDoAgente | null {
  if (!e || (!e.cartao && !e.orcamento)) return null
  const partes: string[] = []
  const cores: Semaforo[] = []
  if (e.cartao) {
    partes.push(`cartão ${e.cartao.pct}%`)
    cores.push(e.cartao.semaforo)
  }
  if (e.orcamento) {
    partes.push(`orçamento ${e.orcamento.pct}%`)
    cores.push(e.orcamento.semaforo)
  }
  const pior = cores.reduce((a, b) => (ORDEM.indexOf(b) > ORDEM.indexOf(a) ? b : a), 'verde' as Semaforo)
  return { texto: partes.join(' · '), semaforo: pior }
}
