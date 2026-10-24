import { lerEventoCiclo, PREFIXO_CICLO, validarTransicaoCiclo, type EventoCiclo, type LeadCiclo } from '../src/operations/ciclo-comercial'
export { PREFIXO_CICLO }

/** Fronteira pura para notas da aba CRM; autenticação e serialização pertencem ao CrmStore. */
export function validarNotaDoCicloComercial(texto: string, agora: Date = new Date()): EventoCiclo {
  const evento = lerEventoCiclo(texto, agora.getTime())
  if (!evento) throw new Error('Registro do ciclo comercial inválido: confira campos, datas e limite de 1000 caracteres.')
  return evento
}
/** Executar com a fonte atual, dentro da serialização de CrmStore.gravar; replay não cria outro fato. */
export function validarTransicaoDoCicloComercial(lead: LeadCiclo, evento: EventoCiclo, agora: Date = new Date()): 'novo' | 'duplicado' {
  return validarTransicaoCiclo(lead, evento, agora.getTime())
}
