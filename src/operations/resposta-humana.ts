import type { CrmLead } from './types'
import { respondeuDeGente } from './resultados'

/** ultimaEntrada é humana no contrato do observador; a entrada automática tem outro campo. */
export function ultimaRespostaHumanaEm(lead: CrmLead, agora = Number.POSITIVE_INFINITY): number {
  const conversa = lead.conversa
  const instantes = [Date.parse(conversa?.ultimaEntrada ?? '')]
  if (conversa?.ultima?.direcao === 'entrada' && ['gente', 'recepcao'].includes(conversa.ultima.papel ?? '')) instantes.push(Date.parse(conversa.ultima.em))
  if (lead.resposta && lead.resposta.tipo !== 'bot' && respondeuDeGente(lead)) instantes.push(Date.parse(lead.resposta.em ?? lead.marcos.respondeu ?? ''))
  return Math.max(0, ...instantes.filter(t => Number.isFinite(t) && t <= agora))
}

/** Não deixa a classificação automática mais recente apagar uma entrada humana preservada. */
export function contextoHumanoPreservado(lead: CrmLead, agora = Number.POSITIVE_INFINITY): CrmLead | null {
  const instante = ultimaRespostaHumanaEm(lead, agora)
  if (!instante) return null
  return { ...lead, marcos: { ...lead.marcos, respondeu: new Date(instante).toISOString() },
    resposta: lead.resposta?.tipo === 'bot' ? undefined : lead.resposta,
    conversa: lead.conversa ? { ...lead.conversa, entradas: { gente: Math.max(1, lead.conversa.entradas?.gente ?? 0), recepcao: lead.conversa.entradas?.recepcao ?? 0, robo: lead.conversa.entradas?.robo ?? 0 } } : undefined }
}
