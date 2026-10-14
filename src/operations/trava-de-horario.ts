/**
 * PURO: a trava de horário do envio (14/10/2026).
 *
 * Medido até 14/10/2026: dos envios de Site depois das 18h, 0 de 29 tiveram resposta de gente;
 * dentro do expediente, 28 de 132. Até aqui a fila só AVISAVA (resultados.ts, avisoDeHorario) e
 * o link de envio continuava a um toque, então o aviso perdia para a pressa de esvaziar a fila.
 * Agora, fora do expediente, o link de envio fica atrás de um "Liberar" explícito, por lead: a
 * decisão continua sendo do Rômulo (um sábado à tarde pode valer), mas passa a ser uma decisão.
 *
 * A trava é a presença do aviso: `avisoDeHorario` devolve `null` no horário comercial e o texto
 * (com a taxa medida) fora dele. Um critério só, para o aviso e a trava nunca discordarem.
 * A liberação vive só na tela aberta (memória, nunca localStorage): voltou o expediente ou
 * recarregou a página, o ciclo recomeça.
 *
 * O que trava (linksDePrimeiroContato): só a primeira abordagem — o envio do Site, o convite do
 * PRUMO e, desde 14/10/2026, o reenvio do só-robô, que é uma primeira abordagem de verdade (a
 * mensagem anterior só chegou ao robô). O follow-up de quem viu e não respondeu, a 2ª mensagem e
 * a conversa não travam: são resposta a quem já recebeu algo, não um frio fora de hora.
 */
import type { CrmLead } from './types'

export type EnviosLiberados = ReadonlySet<string>

type LeadDaTrava = Pick<CrmLead, 'links' | 'reenvioDoRobo'>

/** Os links deste lead que a trava segura fora do expediente. */
export function linksDePrimeiroContato(lead: LeadDaTrava): string[] {
  return [lead.links.enviar, lead.links.convite, lead.reenvioDoRobo ? lead.links.followup : undefined]
    .filter((url): url is string => Boolean(url))
}

/** Este link é de primeiro contato (e, portanto, travável)? */
export function ehPrimeiroContato(lead: LeadDaTrava | undefined, url: string): boolean {
  return Boolean(lead && url) && linksDePrimeiroContato(lead!).includes(url)
}

/** O envio deste lead está travado? Só fora do expediente (`aviso` presente) e enquanto não liberado. */
export function envioTravado(aviso: string | null | undefined, liberados: EnviosLiberados, leadId: string): boolean {
  return Boolean(aviso) && !liberados.has(leadId)
}

/** Libera um lead sem mexer no conjunto de entrada (o Vue só reage a um conjunto novo). */
export function liberarEnvio(liberados: EnviosLiberados, leadId: string): Set<string> {
  return new Set([...liberados, leadId])
}

/** O que o botão que destrava diz, e por quê: o número vem do aviso, nunca fixo aqui. */
export const ROTULO_DE_LIBERAR = 'Liberar o envio fora do expediente'
