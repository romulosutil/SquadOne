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
 * Uma regra só (16/10/2026, OT-02 do blueprint): até aqui havia duas janelas, a desta trava (seg a
 * sex 8h–18h e sábado até 12h, com "Liberar") e a da Próxima venda e do vendedor do Telegram (seg a
 * sex 8h–17h30, sem "Liberar"), e o mesmo lead podia estar travado numa tela e liberado na outra.
 * Ficou a do vendedor, que é a decisão mais recente do Rômulo (EXPEDIENTE_DE_VENDA), e o "Liberar"
 * vale em toda tela; o ritmo (trava-de-ritmo.ts) nunca se libera. `podeMandarPrimeiroContato` é a
 * pergunta que todo botão de primeiro contato faz.
 *
 * O que trava (linksDePrimeiroContato): só a primeira abordagem — o envio do Site, o convite do
 * PRUMO e, desde 14/10/2026, o reenvio do só-robô, que é uma primeira abordagem de verdade (a
 * mensagem anterior só chegou ao robô). O follow-up de quem viu e não respondeu, a 2ª mensagem e
 * a conversa não travam: são resposta a quem já recebeu algo, não um frio fora de hora.
 */
import type { CrmLead } from './types'

/**
 * Seg a sex, 08:00 às 17:30 de São Paulo (pedido de 16/10/2026). O aviso do Telegram só sai
 * dentro dele; fora, o primeiro contato espera o "Liberar" daquele lead, em toda tela.
 */
export const EXPEDIENTE_DE_VENDA = { dias: [1, 2, 3, 4, 5], inicioMin: 8 * 60, fimMin: 17 * 60 + 30 } as const

/** Texto do expediente, para o aviso nunca discordar da regra. */
export const TEXTO_DO_EXPEDIENTE = 'de segunda a sexta, das 8h às 17h30'

/** São Paulo é UTC−3 o ano todo desde 2019 (o mesmo atalho de server/crm.ts). */
function relogioSP(agora: number): { dia: number; minutos: number } {
  const d = new Date(agora - 3 * 3600_000)
  return { dia: d.getUTCDay(), minutos: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

export function noExpedienteDeVenda(agora: number): boolean {
  if (!Number.isFinite(agora)) return false
  const { dia, minutos } = relogioSP(agora)
  return (EXPEDIENTE_DE_VENDA.dias as readonly number[]).includes(dia) && minutos >= EXPEDIENTE_DE_VENDA.inicioMin && minutos < EXPEDIENTE_DE_VENDA.fimMin
}

/**
 * A pergunta de todo botão de primeiro contato: dentro do expediente, ou liberado à mão fora dele,
 * e sempre com o ritmo livre (o ritmo protege o número e não tem "Liberar").
 */
export function podeMandarPrimeiroContato(p: { noExpediente: boolean; liberado: boolean; ritmoLivre: boolean }): boolean {
  return p.ritmoLivre && (p.noExpediente || p.liberado)
}

export type EnviosLiberados = ReadonlySet<string>

type LeadDaTrava = Pick<CrmLead, 'links'> & Partial<Pick<CrmLead, 'reenvioDoRobo'>>

/** Os links deste lead que a trava segura fora do expediente. */
export function linksDePrimeiroContato(lead: LeadDaTrava): string[] {
  return [lead.links.enviar, lead.links.convite, lead.reenvioDoRobo ? lead.links.followup : undefined]
    .filter((url): url is string => Boolean(url))
}

/**
 * O lead ainda espera a primeira abordagem? Então qualquer texto mandado a ele é primeiro contato,
 * e só sai pelo botão de envio (que passa pelas travas). Usado pelo trecho do Roteiro na Ficha, que
 * abria o WhatsApp sem trava nenhuma (OT-02).
 */
export function aindaSemPrimeiroContato(lead: LeadDaTrava | undefined): boolean {
  return Boolean(lead) && linksDePrimeiroContato(lead!).length > 0
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
