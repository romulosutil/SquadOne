import type { CrmLead } from '../operations/types'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import { passoAtual } from '../operations/jornada'
import { JORNADA_DAS_SALAS } from './operacao'

/** A sala é um recorte da fonte existente, nunca uma segunda fila comercial. */
export function leadsDaSala(sala: string, leads: readonly CrmLead[]): CrmLead[] {
  const jornada = JORNADA_DAS_SALAS[sala]
  if (!jornada) return []
  return leads.filter((lead) => jornada.recortes.some((r) =>
    (r.produto === null || r.produto === lead.produto) &&
    (!r.passos || r.passos.includes(passoAtual(lead)))
  ))
}

export function pendenciasDaSala(sala: string, leads: readonly CrmLead[], fila: readonly AcaoDeVenda[]): AcaoDeVenda[] {
  const ids = new Set(leadsDaSala(sala, leads).map((l) => l.id))
  return fila.filter((a) => ids.has(a.leadId))
}

/** Um cartão por lead, mantendo a prioridade e todos os motivos da fila comercial. */
export function agruparPendencias(fila: readonly AcaoDeVenda[]): Array<{ principal: AcaoDeVenda; acoes: AcaoDeVenda[] }> {
  const grupos = new Map<string, { principal: AcaoDeVenda; acoes: AcaoDeVenda[] }>()
  for (const a of fila) {
    const grupo = grupos.get(a.leadId)
    if (grupo) grupo.acoes.push(a)
    else grupos.set(a.leadId, { principal: a, acoes: [a] })
  }
  return [...grupos.values()]
}

export function pedidoDaSala(sala: { id: string; nome: string }, pessoa: { id: string; nome: string; papel: string }, texto: string): string {
  return `Sala ${sala.nome} (${sala.id}). Responsável indicado: ${pessoa.nome} (${pessoa.id}), ${pessoa.papel}.\nPedido: ${texto.trim()}`
}
