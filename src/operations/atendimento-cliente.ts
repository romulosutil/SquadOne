import type { CrmLead } from './types'
import { planoDoLead, type PlanoBi } from './bi-operacao'
import { procedimentoDaDecisao, type ProcedimentoDaDecisao } from '../office/procedimento-da-decisao'
import type { EstadoDaDecisao } from '../office/decisoes'

/** Apresenta o plano comercial vigente; não classifica novamente nem autoriza envio. */
export function orientacaoDoAtendimento(lead: CrmLead, _leads: readonly CrmLead[], agora: number): {
  plano: PlanoBi; procedimento: ProcedimentoDaDecisao; estado: EstadoDaDecisao
} {
  const plano = planoDoLead(lead, agora)
  const procedimento = procedimentoDaDecisao(lead, new Date(agora))
  const estado: EstadoDaDecisao = plano.tipo === 'encerrado' ? 'encerrada' : plano.tipo === 'aguardar' ? 'acompanhando' : 'agora'
  return { plano, procedimento, estado }
}
