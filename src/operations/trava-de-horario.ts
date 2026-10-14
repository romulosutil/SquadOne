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
 */

export type EnviosLiberados = ReadonlySet<string>

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
