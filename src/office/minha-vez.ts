import type { CrmLead } from '../operations/types'
import { contatoPausado } from '../operations/aprendizado-comercial'
import { planoDoLead } from '../operations/bi-operacao'
import { trabalhosRegistrados } from './trabalho-registrado'
import { cicloDoLead } from '../operations/ciclo-comercial'
import { planoFuturoEmEspera, procedimentoDaDecisao } from './procedimento-da-decisao'
import { decisoesDoEscritorio, type Decisao } from './decisoes'

const instante = (em?: string) => Date.parse(em ?? '') || 0
const conferenciaTecnica = (titulo: string, motivo: string) => /captura|proje[cç][aã]o|identidade|ordem das entradas|contexto (?:mudou|atualizado|n[aã]o se confirmou)/i.test(`${titulo} ${motivo}`)

/** A fila pessoal exige uma decisão pendente; preparo, captura e silêncio continuam consultáveis. */
export function motivoDaMinhaVez(lead: CrmLead, agora: number): string | null {
  if (['ganho', 'perdido'].includes(lead.etapa) || ['negativa', 'exclusao'].includes(lead.resposta?.tipo ?? '') || ['recusa', 'exclusao'].includes(lead.classificacaoResposta?.classe ?? '')) return null
  if (contatoPausado(lead) || planoFuturoEmEspera(lead, new Date(agora))) return null
  const plano = planoDoLead(lead, agora)
  if (plano.tipo === 'encerrado' || procedimentoDaDecisao(lead, new Date(agora)).tipo === 'espera') return null
  const atendimento = lead.atendimentoComercial
  if (atendimento) {
    if (atendimento.alvo !== 'operador' || atendimento.tipo !== 'handoff' || atendimento.estado !== 'humano' || atendimento.identidade !== 'confirmada') return null
    const em = instante(atendimento.ocorridoEm)
    if (!em || em > agora || conferenciaTecnica(atendimento.titulo, atendimento.motivo)) return null
    return atendimento.motivo
  }
  if (plano.tipo === 'aguardar') return null
  const ciclo = cicloDoLead(lead, agora)
  const trabalho = trabalhosRegistrados(lead, agora).at(-1)
  if (trabalho) return trabalho.fila === 'voce' ? trabalho.tarefa : null
  if (ciclo.propostas.some(p => !ciclo.eventos.some(e => e.tipo === 'proposta_enviada' && e.vinculo === p.id)) || ciclo.cobrancas.some(c => c.saldo > 0)) return plano.acao
  const conversa = lead.conversa
  const entrada = Math.max(instante(conversa?.ultimaEntrada), conversa?.ultima.direcao === 'entrada' ? instante(conversa.ultima.em) : 0)
  const saida = Math.max(instante(conversa?.ultimaSaida), conversa?.ultima.direcao === 'saida' ? instante(conversa.ultima.em) : 0)
  const classificacao = lead.classificacaoResposta
  if (entrada > saida && entrada <= agora && agora - entrada <= 14 * 86_400_000 && classificacao?.houveRespostaHumana && !classificacao.revisar && classificacao.classe !== 'pendente') return plano.acao
  return null
}

/** A mesma seleção no telão, na lista e na próxima decisão, sem gravar no CRM. */
export function decisoesHumanasDoEscritorio(...args: Parameters<typeof decisoesDoEscritorio>): Decisao[] {
  const agora = args[2]
  return decisoesDoEscritorio(...args).map(d => {
    if (['ganho', 'perdido'].includes(d.lead.etapa)) return { ...d, estado: 'encerrada' as const, acao: null }
    if (d.estado !== 'agora') return d
    const motivo = motivoDaMinhaVez(d.lead, agora)
    if (motivo) return { ...d, motivo }
    const a = d.lead.atendimentoComercial
    const acompanhamento = a?.alvo === 'time' ? a.motivo
      : a && a.estado !== 'concluido' && (a.identidade !== 'confirmada' || conferenciaTecnica(a.titulo, a.motivo)) ? 'Conferência técnica pendente · acompanhar com o time'
      : a?.estado === 'concluido' ? 'Atendimento processado · revisão de contexto no acompanhamento'
      : 'Preparação e acompanhamento · sem decisão sua pendente'
    return { ...d, estado: 'acompanhando' as const, motivo: acompanhamento, acao: null }
  }).sort((a, b) => ({ agora: 0, acompanhando: 1, encerrada: 2 }[a.estado] - { agora: 0, acompanhando: 1, encerrada: 2 }[b.estado]))
}
