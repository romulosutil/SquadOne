import type { CrmLead } from '../operations/types'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import { conversasParaConduzir } from '../operations/conversas-para-conduzir'
import { contatoPausado } from '../operations/aprendizado-comercial'
import { planoFuturoEmEspera, procedimentoDaDecisao } from './procedimento-da-decisao'
import { ultimoRetornoRegistrado } from '../operations/retorno-da-venda'

export type EstadoDaDecisao = 'agora' | 'acompanhando' | 'encerrada'
export interface Decisao {
  lead: CrmLead
  estado: EstadoDaDecisao
  motivo: string
  acao: AcaoDeVenda | null
}
export const nomesDasOfertas = { site: 'Site', prumo: 'PRUMO', iris: 'Iris', plus: 'Plus', estampa: 'Estamparia' } as const

/** Confirmação real ou saída observada atende a resposta anterior; uma entrada posterior reabre. */
export function respostaJaAtendida(lead: CrmLead): boolean {
  const c = lead.conversa
  const entrada = Math.max(Date.parse(c?.ultimaEntrada ?? '') || 0, c?.ultima.direcao === 'entrada' ? Date.parse(c.ultima.em) || 0 : 0, Date.parse(ultimoRetornoRegistrado(lead)?.registradoEm ?? '') || 0)
  const envios = lead.eventos.filter(e => e.origem === 'manual' && /^\[Envio confirmado pelo operador · \d{4}-\d{2}-\d{2}\]\r?\n\S/.test(e.texto ?? '')).map(e => Date.parse(e.em) || 0)
  const saida = Math.max(c?.ultima.direcao === 'saida' ? Date.parse(c.ultima.em) || 0 : 0, Date.parse(c?.ultimaSaida ?? '') || 0, ...envios)
  return saida > entrada && saida > 0
}

export function proximaDecisaoPorPrioridade(decisoes: readonly Decisao[], atualId?: string): Decisao | null {
  return decisoes.find(d => d.estado === 'agora' && d.lead.id !== atualId) ?? null
}

/** Uma linha por cliente. A ordem de Vendas e as proteções de contato continuam valendo. */
export function decisoesDoEscritorio(leads: readonly CrmLead[], acoes: readonly AcaoDeVenda[], agora: number, conversasLidas?: readonly { lead: CrmLead; rotulo: string }[]): Decisao[] {
  const conversas = conversasLidas ?? conversasParaConduzir(leads, agora)
  const porConversa = new Map(conversas.map(c => [c.lead.id, c]))
  const porAcao = new Map<string, AcaoDeVenda>()
  for (const acao of acoes) if (!acao.primeiroContato && !porAcao.has(acao.leadId)) porAcao.set(acao.leadId, acao)
  const ordem = new Map([...new Set([...porAcao.keys(), ...conversas.map(c => c.lead.id)])].map((id, i) => [id, i]))
  return leads.flatMap((lead): Decisao[] => {
    const atendida = respostaJaAtendida(lead)
    const candidata = porAcao.get(lead.id) ?? null
    const materialPendente = ['interesse', 'licenca'].includes(lead.resposta?.tipo ?? '') && !!lead.links.segunda && !lead.marcos.segundaEnviada && !lead.conversa?.linkEm
    const acao = atendida && !materialPendente && candidata?.tipo === 'responder' ? null : candidata
    const conversa = atendida && porConversa.get(lead.id)?.rotulo === 'Resposta recebida' ? undefined : porConversa.get(lead.id)
    if (lead.etapa === 'ganho' || lead.etapa === 'perdido') return [{ lead, estado: 'encerrada', motivo: lead.etapa === 'ganho' ? 'Venda ganha' : 'Conversa encerrada', acao: null }]
    const esperaPlanejada = planoFuturoEmEspera(lead, new Date(agora))
    const protegido = contatoPausado(lead) || esperaPlanejada || lead.resposta?.tipo === 'negativa' || lead.resposta?.tipo === 'exclusao'
    if ((!protegido || acao?.tipo === 'desfecho') && (acao || conversa)) return [{ lead, estado: 'agora', motivo: conversa?.rotulo ?? acao!.titulo, acao }]
    const temConversa = lead.etapa === 'contato' || lead.etapa === 'proposta' || !!lead.conversa || !!lead.proximoPasso
    if (!temConversa) return []
    return [{ lead, estado: 'acompanhando', motivo: protegido ? 'Contato em espera' : procedimentoDaDecisao(lead, new Date(agora)).tipo === 'robo' ? 'Só o robô respondeu · conferir atendimento humano' : lead.proximoPasso?.texto ? 'Próximo passo definido' : 'Aguardando retorno', acao: null }]
  }).sort((a, b) => {
    const estados = { agora: 0, acompanhando: 1, encerrada: 2 }
    return estados[a.estado] - estados[b.estado] || (a.estado === 'agora' ? (ordem.get(a.lead.id) ?? Infinity) - (ordem.get(b.lead.id) ?? Infinity) : 0) || a.lead.empresa.localeCompare(b.lead.empresa, 'pt-BR')
  })
}
