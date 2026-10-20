import type { CrmLead, CrmProduto } from './types'
import { hashDoLead, fisherExato } from './ab-video'
import { respondeuDeGente } from './resultados'

export const VERSAO_DO_FOLLOWUP = 'followup-2026-10-19' as const
/** Ativar só após o Rômulo revisar os textos. A flag não vem de um lead nem do modelo. */
export const FOLLOWUP_NOVO_APROVADO = false
export const MINIMO_POR_BRACO_DO_FOLLOWUP = 30
export interface MetadataDoFollowup { braco: 'A' | 'B'; versao: typeof VERSAO_DO_FOLLOWUP }
export function metadataDoFollowup(produto: string, id: string, ofertaPlus?: string, aprovado = FOLLOWUP_NOVO_APROVADO): MetadataDoFollowup {
  const oferta = produto === 'plus' ? ofertaPlus : produto
  const valido = ['site', 'prumo', 'iris', 'estampa'].includes(oferta ?? '') && Boolean(id.trim())
  return { braco: valido && aprovado && hashDoLead(`${produto}:${id}:${ofertaPlus ?? ''}`, VERSAO_DO_FOLLOWUP) % 2 ? 'B' : 'A', versao: VERSAO_DO_FOLLOWUP }
}
export const FOLLOWUP_NOVO: Record<'site' | 'prumo' | 'iris' | 'estampa', string> = {
  site: 'Oi, é o Rômulo de novo. Hoje, quem procura {EMPRESA} no Google consegue chegar até vocês pelo site? Se esse assunto não for prioridade, é só dizer.',
  prumo: 'Oi, é o Rômulo de novo, do PRUMO. Hoje vocês conseguem acompanhar os contatos até virarem cliente? Se não for prioridade, é só dizer.',
  iris: 'Oi, é o Rômulo de novo, do PRUMO. Hoje, juntar as anotações para a reavaliação toma tempo de quem coordena a clínica? Se não for prioridade, é só dizer.',
  estampa: 'Oi, é o Rômulo de novo, do PRUMO. Hoje, arte, tamanhos e prazo ficam juntos em cada pedido? Se não for prioridade, é só dizer.',
}
/** A preserva exatamente o texto anterior recebido pelo chamador. */
export function textoDoFollowup(produto: CrmProduto, empresa: string, braco: 'A' | 'B', ofertaPlus?: string, controle = ''): string {
  if (braco === 'A') return controle
  const oferta = produto === 'plus' ? ofertaPlus : produto
  const molde = FOLLOWUP_NOVO[oferta as keyof typeof FOLLOWUP_NOVO]
  if (!molde) return controle
  const texto = molde.replace('{EMPRESA}', empresa)
  return produto === 'plus' ? `${texto.replace(/^Oi,/, "Meu Ir.'.,")}\n\nT.F.A.` : texto
}
export function textoDoRegistroFollowup(meta: MetadataDoFollowup): string {
  if (!meta || !['A', 'B'].includes(meta.braco) || meta.versao !== VERSAO_DO_FOLLOWUP) throw new Error('Braço do follow-up inválido.')
  return `[${VERSAO_DO_FOLLOWUP}] ${JSON.stringify({ braco: meta.braco, versao: meta.versao })}`
}
export function lerRegistroFollowup(texto: string): MetadataDoFollowup | null {
  const prefixo = `[${VERSAO_DO_FOLLOWUP}] `
  if (!texto.startsWith(prefixo)) return null
  try { const m = JSON.parse(texto.slice(prefixo.length)); return m && ['A', 'B'].includes(m.braco) && m.versao === VERSAO_DO_FOLLOWUP ? { braco: m.braco, versao: m.versao } : null } catch { return null }
}
/** Só fatos de envio confirmado com versão; o passado não recebe braço por hash retroativo. */
export function leituraDoFollowup(leads: readonly CrmLead[]) {
  const bracos = { A: { enviados: 0, responderam: 0 }, B: { enviados: 0, responderam: 0 } }
  for (const lead of leads) {
    const eventos = lead.eventos.filter(e => e.tipo === 'followup_enviado' && e.origem === 'manual' && lerRegistroFollowup(e.registroTexto ?? e.texto ?? ''))
      .sort((a, b) => a.em.localeCompare(b.em))
    const evento = eventos[0]
    if (!evento) continue
    const meta = lerRegistroFollowup(evento.registroTexto ?? evento.texto ?? '')!
    const envio = Date.parse(evento.em)
    if (!Number.isFinite(envio)) continue
    const b = bracos[meta.braco]; b.enviados++
    // ultimaEntrada é humana no contrato do observador; ultimaEntradaRobo é outro campo.
    const resposta = Math.max(Date.parse(lead.marcos.respondeu ?? '') || 0, lead.resposta?.tipo !== 'bot' ? Date.parse(lead.resposta?.em ?? '') || 0 : 0, Date.parse(lead.conversa?.ultimaEntrada ?? '') || 0)
    const contextoHumano = { ...lead, marcos: { ...lead.marcos, ...(resposta ? { respondeu: new Date(resposta).toISOString() } : {}) },
      resposta: lead.resposta?.tipo === 'bot' && (lead.marcos.respondeu || lead.conversa?.ultimaEntrada) ? undefined : lead.resposta }
    if (resposta > envio && respondeuDeGente(contextoHumano)) b.responderam++
  }
  const lido = bracos.A.enviados >= MINIMO_POR_BRACO_DO_FOLLOWUP && bracos.B.enviados >= MINIMO_POR_BRACO_DO_FOLLOWUP
  return { bracos, lido, ...(lido ? { numeros: { taxaA: bracos.A.responderam / bracos.A.enviados, taxaB: bracos.B.responderam / bracos.B.enviados, p: fisherExato(bracos.A.responderam, bracos.A.enviados - bracos.A.responderam, bracos.B.responderam, bracos.B.enviados - bracos.B.responderam) } } : {}) }
}
