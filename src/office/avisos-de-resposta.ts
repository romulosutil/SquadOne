import type { CrmLead } from '../operations/types'
import { entradaDeGenteDaVez } from '../operations/resultados'
import type { Decisao } from './decisoes'

export interface RespostaParaAviso { id: string; em: number }
export interface LeituraDasRespostas { inicio: number; vistas: ReadonlyMap<string, number> }

/** A primeira leitura é referência; histórico, repetição e mensagem automática não geram avisos. */
export function lerNovasRespostas(leads: readonly CrmLead[], anterior: LeituraDasRespostas | null, agora: number) {
  const inicio = anterior?.inicio ?? agora
  const vistas = new Map(anterior?.vistas)
  const novas: RespostaParaAviso[] = []
  for (const lead of leads) {
    const em = entradaDeGenteDaVez(lead)
    if (em === null || em > agora) continue
    const conhecida = vistas.get(lead.id) ?? 0
    if (anterior && em > Math.max(conhecida, inicio)) novas.push({ id: lead.id, em })
    vistas.set(lead.id, Math.max(conhecida, em))
  }
  return { leitura: { inicio, vistas }, novas }
}

/** Nome e posição vêm da fila atual, independente dos filtros e do cliente que está aberto. */
export function avisosPorPrioridade(avisos: readonly RespostaParaAviso[], decisoes: readonly Decisao[]) {
  const pendentes = decisoes.filter(d => d.estado === 'agora')
  const porId = new Map(avisos.map(a => [a.id, a]))
  return pendentes.flatMap((d, i) => {
    const aviso = porId.get(d.lead.id)
    return aviso && entradaDeGenteDaVez(d.lead) === aviso.em
      ? [{ ...aviso, empresa: d.lead.empresa, posicao: i + 1, total: pendentes.length }]
      : []
  })
}
