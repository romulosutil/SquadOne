/**
 * PURO: "Resultados" do CRM (08/10/2026) — o que cada nicho, cada variação da
 * primeira mensagem e cada versão do site rendeu, contado só sobre quem foi
 * ENVIADO no período (pela data de envio). É o placar que o ciclo de
 * aprendizado do funil olha: sem ele, o funil semanal do WhatsApp era o único
 * lugar com o número por nicho, e nada mostrava a variação nem a versão.
 *
 * Honestidade dos números (RULES 2 e 15):
 * - "viu" só conta quem deixa a confirmação de leitura ligada (ou respondeu);
 *   o resto é "não sei", nunca "não viu";
 * - "respondeu" é gente: a saudação automática do WhatsApp Business não marca
 *   `respondeu_em` (regra dos 5 min e classificação "bot");
 * - recusa só conta entre os enviados: o acervo de `_recusados/` de 25/09 não
 *   recebeu mensagem rastreada e distorceria a taxa;
 * - linha com menos de AMOSTRA_MINIMA enviados ganha o aviso de amostra
 *   pequena: 1 de 3 não é 33%.
 */
import type { CrmLead } from './types'

export type Periodo = '14' | '30' | 'tudo'
export const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: '14', rotulo: '14 dias' },
  { id: '30', rotulo: '30 dias' },
  { id: 'tudo', rotulo: 'Tudo' },
]
export const AMOSTRA_MINIMA = 10

export interface LinhaDeResultado {
  chave: string
  enviados: number
  viram: number
  responderam: number
  interesse: number
  recusaram: number
  fecharam: number
}

/**
 * `video` (11/10/2026): o A/B do vídeo no envio (ab-video.ts). Coluna `braco_video` vazia
 * é "Sem vídeo"; a tela só mostra o critério dentro do bloco do A/B, e só com a coluna preenchida.
 */
export type Criterio = 'nicho' | 'mensagem' | 'site' | 'horario' | 'video'

const DIA_MS = 24 * 60 * 60 * 1000
const FUSO = 'America/Sao_Paulo'

// ---------------------------------------------------------------- horário do envio (08/10/2026)
// Medido até 08/10/2026: 26 envios depois das 18h tiveram 0 respostas de gente; das 8h às 18h,
// 15 de 65 (23%). O horário vira critério do placar e um aviso na fila de envio, sempre com os
// números do próprio retrato (nada fixo no código além da definição do expediente).

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Hora (0–23) e dia da semana (0 = domingo) em São Paulo, qualquer que seja o fuso da máquina. */
export function horaEmSP(ms: number): { hora: number; diaDaSemana: number } {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(ms))
  const valor = (tipo: string) => partes.find(p => p.type === tipo)?.value ?? ''
  return { hora: Number(valor('hour')) % 24, diaDaSemana: DIAS.indexOf(valor('weekday')) }
}

/** Expediente de quem recebe: segunda a sexta das 8h às 18h, sábado das 8h às 12h (São Paulo). */
export function noHorarioComercial(ms: number): boolean {
  const { hora, diaDaSemana } = horaEmSP(ms)
  if (diaDaSemana === 0) return false
  return hora >= 8 && hora < (diaDaSemana === 6 ? 12 : 18)
}

export const FAIXAS_DO_HORARIO = ['Manhã (8h–12h)', 'Almoço (12h–14h)', 'Tarde (14h–18h)', 'Noite (18h–21h)', 'Madrugada (21h–8h)'] as const

export function faixaDoHorario(ms: number): (typeof FAIXAS_DO_HORARIO)[number] {
  const { hora } = horaEmSP(ms)
  if (hora >= 8 && hora < 12) return FAIXAS_DO_HORARIO[0]
  if (hora >= 12 && hora < 14) return FAIXAS_DO_HORARIO[1]
  if (hora >= 14 && hora < 18) return FAIXAS_DO_HORARIO[2]
  if (hora >= 18 && hora < 21) return FAIXAS_DO_HORARIO[3]
  return FAIXAS_DO_HORARIO[4]
}

export function enviadoNoPeriodo(lead: CrmLead, periodo: Periodo, agora: number): boolean {
  const t = Date.parse(lead.marcos.enviado ?? '')
  if (!Number.isFinite(t)) return false
  return periodo === 'tudo' || agora - t <= Number(periodo) * DIA_MS
}

/** O rótulo do grupo do lead em cada critério. */
export function chaveDe(lead: CrmLead, criterio: Criterio): string {
  if (criterio === 'nicho') return lead.nicho.trim() || 'Sem nicho'
  if (criterio === 'horario') return faixaDoHorario(Date.parse(lead.marcos.enviado ?? ''))
  if (criterio === 'video') return lead.abordagem?.video === 'video' ? 'Com vídeo' : 'Sem vídeo'
  if (criterio === 'mensagem') {
    const m = lead.abordagem?.mensagem
    if (!m) return 'Sem registro (envios até 07/10)'
    if (m === 'manual') return 'Escrita à mão'
    if (m === 'EN') return 'Em inglês'
    return `Mensagem ${m}`
  }
  return lead.abordagem?.site ? `Site ${lead.abordagem.site}` : 'Sem registro (envios até 07/10)'
}

function contar(chave: string, leads: CrmLead[]): LinhaDeResultado {
  const linha: LinhaDeResultado = { chave, enviados: 0, viram: 0, responderam: 0, interesse: 0, recusaram: 0, fecharam: 0 }
  for (const l of leads) {
    linha.enviados++
    const respondeu = Boolean(l.marcos.respondeu) && l.resposta?.tipo !== 'bot'
    if (l.marcos.visto || respondeu) linha.viram++
    if (respondeu) linha.responderam++
    if (l.resposta?.tipo === 'interesse' || l.etapa === 'proposta' || l.etapa === 'ganho') linha.interesse++
    if (l.motivoPerda === 'recusou' || l.motivoPerda === 'sem-interesse') linha.recusaram++
    if (l.etapa === 'ganho') linha.fecharam++
  }
  return linha
}

/**
 * Uma linha por grupo, do que tem mais enviados para o que tem menos (empate:
 * alfabética), e o total. Só leads enviados no período entram.
 */
export function resultados(leads: CrmLead[], criterio: Criterio, periodo: Periodo, agora: number): { linhas: LinhaDeResultado[]; total: LinhaDeResultado } {
  const enviados = leads.filter(l => enviadoNoPeriodo(l, periodo, agora))
  const grupos = new Map<string, CrmLead[]>()
  for (const l of enviados) {
    const chave = chaveDe(l, criterio)
    grupos.set(chave, [...(grupos.get(chave) ?? []), l])
  }
  // Horário na ordem do dia; o resto, do grupo com mais enviados para o com menos.
  const ordemDaFaixa = (chave: string) => (FAIXAS_DO_HORARIO as readonly string[]).indexOf(chave)
  const linhas = [...grupos].map(([chave, ls]) => contar(chave, ls))
    .sort((a, b) => (criterio === 'horario' ? ordemDaFaixa(a.chave) - ordemDaFaixa(b.chave) : 0)
      || b.enviados - a.enviados || a.chave.localeCompare(b.chave, 'pt-BR'))
  return { linhas, total: contar('Total', enviados) }
}

/**
 * Aviso da fila de envio fora do expediente, com a taxa de resposta medida dentro e fora dele.
 * `null` no horário comercial. Com pouco envio de um dos lados, o aviso não cita número
 * (1 de 3 não é taxa).
 */
export function avisoDeHorario(leads: CrmLead[], agora: number): string | null {
  if (noHorarioComercial(agora)) return null
  const enviados = leads.filter(l => enviadoNoPeriodo(l, 'tudo', agora))
  const dentro = contar('dentro', enviados.filter(l => noHorarioComercial(Date.parse(l.marcos.enviado ?? ''))))
  const fora = contar('fora', enviados.filter(l => !noHorarioComercial(Date.parse(l.marcos.enviado ?? ''))))
  const expediente = 'segunda a sexta das 8h às 18h, sábado até 12h'
  if (amostraPequena(dentro) || amostraPequena(fora)) {
    return `Agora é fora do expediente de quem recebe (${expediente}): mensagem de número desconhecido nessa hora costuma ficar sem resposta.`
  }
  return `Agora é fora do expediente de quem recebe (${expediente}). Fora dele, ${fora.enviados} envios tiveram `
    + `${fora.responderam === 1 ? '1 resposta' : `${fora.responderam} respostas`} (${porcento(fora.responderam, fora.enviados)}); `
    + `dentro, ${porcento(dentro.responderam, dentro.enviados)} responderam.`
}

/** "25%"; sem enviados não há taxa. Arredonda para inteiro: com amostras deste tamanho, casa decimal é ruído. */
export function porcento(parte: number, total: number): string {
  return total > 0 ? `${Math.round((parte / total) * 100)}%` : '—'
}

export const amostraPequena = (linha: LinhaDeResultado) => linha.enviados < AMOSTRA_MINIMA

const flexao = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "3 responderam (25%) · 2 viram · 1 quis ver · 0 recusaram · 0 fecharam". */
export function resumoDaLinha(l: LinhaDeResultado): string {
  return [
    `${flexao(l.responderam, 'respondeu', 'responderam')} (${porcento(l.responderam, l.enviados)})`,
    flexao(l.viram, 'viu', 'viram'),
    `${flexao(l.interesse, 'quis', 'quiseram')} ver`,
    flexao(l.recusaram, 'recusou', 'recusaram'),
    flexao(l.fecharam, 'fechou', 'fecharam'),
  ].join(' · ')
}
