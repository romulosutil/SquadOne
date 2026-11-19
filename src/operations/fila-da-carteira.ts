import { contatoPausado } from './aprendizado-comercial'
import type { EventoWhatsApp } from './canais-comerciais'
import type { OportunidadeDaCarteira } from './carteira-crm'
import type { ConversaParaVoce } from './conversas-para-conduzir'
import type { ResponsavelConversa } from './responsavel-conversa'
import type { CrmLead } from './types'

export const ESTADO_WHATSAPP: Record<EventoWhatsApp['estado'], string> = {
  enviado: 'Envio confirmado',
  incerto: 'Resultado incerto',
  sem_confirmacao: 'Resultado incerto',
  sem_whatsapp: 'Envio bloqueado',
}

export function resumirFicha(lead: CrmLead, agora: number, registro?: EventoWhatsApp, pendencia?: ConversaParaVoce,
  oportunidade?: OportunidadeDaCarteira, responsavel?: ResponsavelConversa) {
  const atendimento = lead.atendimentoComercial
  const resposta = atendimento?.vinculoUnico && atendimento.fonteConferida ? atendimento.ocorridoEm : undefined
  const respostaComHora = resposta && Date.parse(resposta) <= agora ? resposta : undefined
  const anterior = lead.eventos.filter(e => !e.estimado && e.origem === 'manual' && Date.parse(e.em) <= agora)
    .reduce<{ rotulo: string; em: string } | undefined>((ultimo, e) =>
      !ultimo || Date.parse(e.em) > Date.parse(ultimo.em) ? e : ultimo, undefined)
  const conversada = lead.conversa?.ultima
  const conversa = conversada && Date.parse(conversada.em) <= agora
    ? { rotulo: conversada.direcao === 'entrada' ? 'Entrada no histórico' : 'Saída no histórico', em: conversada.em } : undefined
  const ultimo = [
    respostaComHora ? { rotulo: 'Resposta recebida', em: respostaComHora } : undefined,
    conversa,
    registro?.estado === 'enviado' ? { rotulo: 'Envio confirmado · hora da reserva', em: registro.em } : undefined,
    anterior,
  ].filter(e => e !== undefined).sort((a, b) => Date.parse(b.em) - Date.parse(a.em))[0]
  const incerto = registro?.estado === 'incerto' || registro?.estado === 'sem_confirmacao'
  const pausa = contatoPausado(lead)
  const revisao = !!atendimento && !respostaComHora
  const prioridade = respostaComHora || pendencia?.resposta || revisao ? 0
    : incerto ? 1 : pendencia ? 2 : oportunidade?.situacao === 'revisar' ? 3 : null
  const proximo = incerto ? 'Conferir o recibo e a conversa antes de qualquer ação.'
    : pausa ? 'Aguardar a resposta prevista na pausa manual.'
    : atendimento ? 'Conferir a conversa e o motivo do encaminhamento.'
    : lead.proximoPasso?.texto ?? oportunidade?.proximoPasso?.texto ?? pendencia?.rotulo
      ?? (oportunidade?.situacao === 'revisar' ? 'Revisar as evidências da oportunidade.' : 'A definir')
  const dono = responsavel?.responsavel === 'romulo' ? 'Rômulo · assumiu'
    : atendimento || pendencia ? 'Rômulo · atendimento'
    : responsavel?.responsavel === 'time' ? 'Time' : 'A definir'
  return { ultimo, prioridade, proximo, dono, revisao }
}
