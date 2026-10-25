import type { CrmLead } from '../operations/types'
import type { PlanoBi } from '../operations/bi-operacao'
import { procedimentoDaDecisao } from './procedimento-da-decisao'

/** Apenas composição da orientação. Os gates do servidor continuam obrigatórios. */
export function orientaContato(lead: CrmLead, plano: PlanoBi): boolean {
  return plano.tipo === 'agir' && ['humano', 'recepcao', 'robo'].includes(procedimentoDaDecisao(lead).tipo)
}

/** Data registrada não contém um horário de atendimento presumido. */
export function momentoDaOrientacao(prazo: string): { titulo: string; detalhe: string } {
  const data = /^(\d{4})-(\d{2})-(\d{2})$/.exec(prazo)
  if (data && Number.isFinite(Date.parse(`${prazo}T12:00:00Z`)) && new Date(`${prazo}T12:00:00Z`).toISOString().slice(0, 10) === prazo) {
    return { titulo: `${data[3]}/${data[2]}/${data[1]}`, detalhe: 'Data registrada. O horário ainda precisa ser conferido com o cliente.' }
  }
  return { titulo: prazo || 'Antes de continuar', detalhe: 'Siga o combinado da conversa. Sem horário registrado, a leitura atual não indica uma hora específica para contato.' }
}
