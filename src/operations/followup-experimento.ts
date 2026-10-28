import type { CrmLead, CrmProduto } from './types'
import { contextoHumanoPreservado, ultimaRespostaHumanaEm } from './resposta-humana'
import { hashDoLead, fisherExato } from './ab-video'
import { respondeuDeGente } from './resultados'

export const VERSAO_DO_FOLLOWUP = 'followup-2026-10-19' as const
/** Aprovada pelo Rômulo em 19/10/2026 ("Aprovar os textos para teste"); desligar aqui devolve todos ao controle. A flag não vem de um lead nem do modelo. */
export const FOLLOWUP_NOVO_APROVADO = true
export const MINIMO_POR_BRACO_DO_FOLLOWUP = 30
export interface MetadataDoFollowup { braco: 'A' | 'B'; versao: typeof VERSAO_DO_FOLLOWUP }
export function metadataDoFollowup(produto: string, id: string, ofertaPlus?: string, aprovado = FOLLOWUP_NOVO_APROVADO): MetadataDoFollowup {
  const oferta = produto === 'plus' ? ofertaPlus : produto
  // Só quem tem texto aprovado entra no sorteio (era a mesma lista à mão; o Plus vale pela oferta dele).
  const valido = Object.hasOwn(FOLLOWUP_NOVO, oferta ?? '') && Boolean(id.trim())
  return { braco: valido && aprovado && hashDoLead(`${produto}:${id}:${ofertaPlus ?? ''}`, VERSAO_DO_FOLLOWUP) % 2 ? 'B' : 'A', versao: VERSAO_DO_FOLLOWUP }
}
/** Um texto aprovado por oferta: oferta nova no JSON faz o vue-tsc cobrar o dela aqui. */
export const FOLLOWUP_NOVO: Record<Exclude<CrmProduto, 'plus'>, string> = {
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
    const resposta = ultimaRespostaHumanaEm(lead)
    const contextoHumano = contextoHumanoPreservado(lead)
    if (resposta > envio && contextoHumano && respondeuDeGente(contextoHumano)) b.responderam++
  }
  const lido = bracos.A.enviados >= MINIMO_POR_BRACO_DO_FOLLOWUP && bracos.B.enviados >= MINIMO_POR_BRACO_DO_FOLLOWUP
  return { bracos, lido, ...(lido ? { numeros: { taxaA: bracos.A.responderam / bracos.A.enviados, taxaB: bracos.B.responderam / bracos.B.enviados, p: fisherExato(bracos.A.responderam, bracos.A.enviados - bracos.A.responderam, bracos.B.responderam, bracos.B.enviados - bracos.B.responderam) } } : {}) }
}
