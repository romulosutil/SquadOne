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
 * A liberação mora no servidor (venda-do-dia.json, até a meia-noite de SP) e a tela a espelha em
 * liberados.ts (AC-21, 17/10/2026): recarregar a página não trava de novo o que já foi liberado.
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
import calendario from '../../config/feriados-nacionais.json'
import politica from '../../config/politica-envios.json'

const FERIADOS_NACIONAIS = new Set(calendario.datas)
const dataSP = (agora: number) => new Date(agora - 3 * 3600_000).toISOString().slice(0, 10)

/**
 * Seg a sex, 08:00 às 18:00 de São Paulo (ampliado por Rômulo em 10/11/2026). O aviso do Telegram só sai
 * dentro dele; fora, o primeiro contato espera o "Liberar" daquele lead, em toda tela.
 */
export const EXPEDIENTE_DE_VENDA = { dias: [1, 2, 3, 4, 5], inicioMin: 8 * 60, fimMin: 18 * 60 } as const

/** Texto do expediente, para o aviso nunca discordar da regra. */
export const TEXTO_DO_EXPEDIENTE = 'de segunda a sexta, das 8h às 18h'

/** São Paulo é UTC−3 o ano todo desde 2019 (o mesmo atalho de server/crm.ts). */
function relogioSP(agora: number): { dia: number; minutos: number } {
  const d = new Date(agora - 3 * 3600_000)
  return { dia: d.getUTCDay(), minutos: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

export function noExpedienteDeVenda(agora: number): boolean {
  if (!Number.isFinite(agora)) return false
  if (!politica.limitesOperacionais) return true
  const { dia, minutos } = relogioSP(agora)
  return !FERIADOS_NACIONAIS.has(dataSP(agora)) && (EXPEDIENTE_DE_VENDA.dias as readonly number[]).includes(dia) && minutos >= EXPEDIENTE_DE_VENDA.inicioMin && minutos < EXPEDIENTE_DE_VENDA.fimMin
}

/** Minutos até fechar o expediente (18h de SP); null fora dele. Para o plano do dia dizer quanto tempo sobra. */
export function minutosAteFecharOExpediente(agora: number): number | null {
  if (!politica.limitesOperacionais) return null
  if (!noExpedienteDeVenda(agora)) return null
  return EXPEDIENTE_DE_VENDA.fimMin - relogioSP(agora).minutos
}

const NOME_DO_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** Quando o expediente abre de novo, para quem olha fora dele: "hoje às 8h", "amanhã às 8h", "segunda às 8h". */
export function proximaAberturaDoExpediente(agora: number): string {
  if (!politica.limitesOperacionais) return 'agora'
  if (!Number.isFinite(agora)) return 'no próximo expediente'
  const { dia, minutos } = relogioSP(agora)
  const dias = EXPEDIENTE_DE_VENDA.dias as readonly number[]
  const abre = `às ${EXPEDIENTE_DE_VENDA.inicioMin / 60}h`
  if (dias.includes(dia) && !FERIADOS_NACIONAIS.has(dataSP(agora)) && minutos < EXPEDIENTE_DE_VENDA.inicioMin) return `hoje ${abre}`
  for (let passo = 1; passo <= 7; passo++) {
    const d = (dia + passo) % 7
    if (dias.includes(d) && !FERIADOS_NACIONAIS.has(dataSP(agora + passo * 86400_000))) return `${passo === 1 ? 'amanhã' : NOME_DO_DIA[d]} ${abre}`
  }
  return `na próxima segunda ${abre}`
}

/**
 * A pergunta de todo botão de primeiro contato: dentro do expediente, ou liberado à mão fora dele,
 * e sempre com o ritmo livre (o ritmo protege o número e não tem "Liberar").
 */
export function podeMandarPrimeiroContato(p: { noExpediente: boolean; liberado: boolean; ritmoLivre: boolean }): boolean {
  if (!politica.limitesOperacionais) return true
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
  if (!politica.limitesOperacionais) return false
  return Boolean(aviso) && !liberados.has(leadId)
}

export function liberarEnvio(liberados: EnviosLiberados, leadId: string): Set<string> {
  return new Set([...liberados, leadId])
}
