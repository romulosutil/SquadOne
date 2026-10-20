import type { CrmLead } from './types'
import { lerAberturaPrumo, type AberturaPrumo } from './abertura-prumo'

export const PREFIXO_CLASSIFICACAO = '[Classificação revisada pelo operador]\n'
export const PREFIXO_CONVITE = '[Convite enviado confirmado pelo operador]\n'
export const PREFIXO_CONVITE_TIME = '[Convite enviado confirmado pela integração do time]\n'
export type RevisaoClassificacao = { base: string; decisao: 'reabrir' | 'manter'; motivo: string }
export type ConviteConfirmado = { enviadoEm: string; mensagem: string; abertura?: Pick<AberturaPrumo, 'mensagem_variante' | 'ab_elegiveis'> }

/** Só anota o braço quando o conteúdo realmente enviado é idêntico ao rascunho conferido. */
export function aberturaConfirmadaDoLead(lead: Pick<CrmLead, 'produto' | 'abordagem' | 'links'>, mensagem: string): ConviteConfirmado['abertura'] | undefined {
  if (lead.produto !== 'prumo') return undefined
  const meta = lerAberturaPrumo({ mensagem_variante: lead.abordagem?.mensagem, ab_elegiveis: lead.abordagem?.elegiveis })
  if (!meta) return undefined
  try { return new URL(lead.links.convite ?? '').searchParams.get('text')?.trim() === mensagem.trim() ? meta : undefined } catch { return undefined }
}

/** A revisão vale para a classificação conferida, nunca para um desfecho posterior. */
export function baseDaClassificacao(lead: Pick<CrmLead, 'estadoNaPlanilha' | 'perdaManual' | 'ganhoManual' | 'eventos'>): string {
  return JSON.stringify([lead.estadoNaPlanilha, lead.perdaManual ?? null, !!lead.ganhoManual,
    lead.eventos.filter(e => e.origem === 'manual' && /^(ganhou|recusou|sem_contato|dispensado)/.test(e.tipo)).slice(-1).map(e => [e.tipo, e.em])])
}
export function lerDecisao<T>(texto: string | undefined, prefixo: string): T | null {
  if (!texto?.startsWith(prefixo)) return null
  try { return JSON.parse(texto.slice(prefixo.length)) as T } catch { return null }
}
export function revisaoDaClassificacao(lead: CrmLead) {
  for (const evento of [...lead.eventos].reverse()) {
    if (evento.origem !== 'manual' || evento.tipo !== 'nota') continue
    const r = lerDecisao<RevisaoClassificacao>(evento.texto, PREFIXO_CLASSIFICACAO)
    if (!r || !['reabrir', 'manter'].includes(r.decisao) || typeof r.motivo !== 'string' || !r.motivo.trim()) continue
    if (r.base !== baseDaClassificacao(lead)) return null
    // Uma interação posterior pede nova conferência; uma nota comum não desfaz a revisão.
    if (lead.eventos.some(e => e.origem !== 'manual' && Date.parse(e.em) > Date.parse(evento.em))) return null
    return { ...r, em: evento.em }
  }
  return null
}

export function ultimoConviteConfirmado(eventos: CrmLead['eventos']): ConviteConfirmado | null {
  let ultimo: ConviteConfirmado | null = null
  for (const evento of eventos) {
    if (evento.origem !== 'manual' || evento.tipo !== 'nota') continue
    const r = lerDecisao<ConviteConfirmado>(evento.texto, PREFIXO_CONVITE)
      ?? lerDecisao<ConviteConfirmado>(evento.texto, PREFIXO_CONVITE_TIME)
    if (!r || typeof r.mensagem !== 'string' || !r.mensagem.trim() || !Number.isFinite(Date.parse(r.enviadoEm))) continue
    const abertura = lerAberturaPrumo(r.abertura)
    if (!ultimo || Date.parse(r.enviadoEm) > Date.parse(ultimo.enviadoEm)) ultimo = { enviadoEm: r.enviadoEm, mensagem: r.mensagem, ...(abertura ? { abertura } : {}) }
  }
  return ultimo
}
