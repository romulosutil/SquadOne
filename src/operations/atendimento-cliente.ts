import type { CrmLead } from './types'
import { planoDoLead, type PlanoBi } from './bi-operacao'
import { itemDaFilaComercial } from './fila-comercial'
import type { ResponsavelConversa } from './responsavel-conversa'
import { procedimentoDaDecisao, type ProcedimentoDaDecisao } from '../office/procedimento-da-decisao'
import type { EstadoDaDecisao } from '../office/decisoes'

/** Compõe a mesma tarefa da fila no atendimento; não altera nem autoriza envio. */
export function orientacaoDoAtendimento(lead: CrmLead, leads: readonly CrmLead[], agora: number, responsaveis?: ReadonlyMap<string, ResponsavelConversa>): {
  plano: PlanoBi; procedimento: ProcedimentoDaDecisao; estado: EstadoDaDecisao
} {
  const base = planoDoLead(lead, agora)
  const item = itemDaFilaComercial(lead, leads, agora, responsaveis)
  const trabalhoRegistrado = !!item && item.acao !== base.acao
  const plano: PlanoBi = !item ? base : {
    ...base,
    tipo: item.area === 'time' || item.area === 'cliente' ? 'aguardar'
      : item.area === 'conferencia' || trabalhoRegistrado ? 'conferir' : base.tipo,
    acao: item.acao, prazo: item.prazo, responsavel: item.responsavel,
    resultado: item.resultado, condicao: item.condicao, evidencia: item.evidencia,
  }
  const procedimento: ProcedimentoDaDecisao = trabalhoRegistrado ? {
    tipo: 'interno', titulo: plano.acao,
    passos: [plano.acao, `Confira a condição registrada: ${plano.condicao}`, 'Use a ficha para conferir o fato e registrar o resultado correspondente.'],
    resultadoEsperado: plano.resultado,
  } : procedimentoDaDecisao(lead, new Date(agora))
  const estado: EstadoDaDecisao = plano.tipo === 'encerrado' ? 'encerrada' : plano.tipo === 'aguardar' ? 'acompanhando' : 'agora'
  return { plano, procedimento, estado }
}
