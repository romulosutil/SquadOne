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

export type Criterio = 'nicho' | 'mensagem' | 'site'

const DIA_MS = 24 * 60 * 60 * 1000

export function enviadoNoPeriodo(lead: CrmLead, periodo: Periodo, agora: number): boolean {
  const t = Date.parse(lead.marcos.enviado ?? '')
  if (!Number.isFinite(t)) return false
  return periodo === 'tudo' || agora - t <= Number(periodo) * DIA_MS
}

/** O rótulo do grupo do lead em cada critério. */
export function chaveDe(lead: CrmLead, criterio: Criterio): string {
  if (criterio === 'nicho') return lead.nicho.trim() || 'Sem nicho'
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
  const linhas = [...grupos].map(([chave, ls]) => contar(chave, ls))
    .sort((a, b) => b.enviados - a.enviados || a.chave.localeCompare(b.chave, 'pt-BR'))
  return { linhas, total: contar('Total', enviados) }
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
