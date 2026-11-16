import { lerEventoCiclo, PREFIXO_CICLO, validarTransicaoCiclo, type EventoCiclo, type LeadCiclo } from '../src/operations/ciclo-comercial'
import { lerResponsavelConversa, PREFIXO_RESPONSAVEL, telefoneDaConversa } from '../src/operations/responsavel-conversa'
import type { CrmLead } from '../src/operations/types'
export { PREFIXO_CICLO }
export { PREFIXO_RESPONSAVEL }
export function validarNotaDoResponsavel(texto: string, agora: Date = new Date()) {
  const v = lerResponsavelConversa(texto,agora.getTime())
  if (!v) throw new Error('Responsável de conversa inválido; exige motivo e confirmação humana.')
  return v
}
export function validarConversaDoResponsavel(lead: Pick<CrmLead,'links'>, texto: string, agora: Date = new Date()) {
  const v = validarNotaDoResponsavel(texto,agora)
  if (v.conversa !== telefoneDaConversa(lead)) throw new Error('A conversa informada não corresponde ao contato desta oportunidade.')
  return v
}
/** Chamado na fronteira validarRegistro antes de persistir nota na mesma aba CRM. */
export function validarNotaDoCicloComercial(texto: string, agora: Date = new Date()): EventoCiclo {
  const evento = lerEventoCiclo(texto,agora.getTime())
  if (!evento) throw new Error('Registro do ciclo comercial inválido. Confira campos, datas e limite de 1000 caracteres.')
  return evento
}
/** Chamado com a versão atual da fonte, dentro da serialização de CrmStore.gravar. */
export function validarTransicaoDoCicloComercial(lead: LeadCiclo, evento: EventoCiclo, agora: Date = new Date()): 'novo' | 'duplicado' {
  return validarTransicaoCiclo(lead,evento,agora.getTime())
}
