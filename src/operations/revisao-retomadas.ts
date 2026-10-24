import type { CrmLead } from './types'

export const PREFIXO_REVISAO_RETOMADA = '[revisao-retomada-v1] '
export const GRUPOS_DE_RETOMADA = {
  retomar: 'Preparar retomada para revisão',
  encaminhamento: 'Conferir encaminhamento',
  aguardar: 'Aguardar resposta ou combinado',
  conferir: 'Recuperar contexto antes de contato',
  'nao-priorizar': 'Não priorizar retomada',
} as const
export interface RevisaoRetomada {
  grupo: keyof typeof GRUPOS_DE_RETOMADA
  fato: string
  proximo: string
  condicao: string
  rascunho?: string
  base: string
}

/** Recência comercial. As próprias notas de revisão não invalidam a revisão. Não autoriza envios. */
export function baseDaRevisaoRetomada(lead: CrmLead): string {
  const r = lead.respostaFonte ?? lead.resposta
  const ultimo = lead.eventos.filter(e => !e.texto?.startsWith(PREFIXO_REVISAO_RETOMADA) && Number.isFinite(Date.parse(e.em ?? '')))
    .sort((a,b) => Date.parse(b.em!) - Date.parse(a.em!))[0]
  return JSON.stringify([lead.etapa, lead.estadoNaPlanilha, r?.tipo ?? null, r?.em ?? null, r?.trecho ?? null,
    lead.conversa?.mensagens ?? 0, lead.conversa?.ultimaEntrada ?? null, lead.conversa?.ultimaSaida ?? null,
    ultimo?.em ?? null, lead.proximoPasso?.registradoEm ?? null])
}

function validar(v: unknown): v is RevisaoRetomada {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r.grupo === 'string' && Object.hasOwn(GRUPOS_DE_RETOMADA,r.grupo)
    && ['fato','proximo','condicao','base'].every(k => typeof r[k] === 'string' && (r[k] as string).trim().length > 0)
    && (r.rascunho === undefined || typeof r.rascunho === 'string')
}

export function notaDaRevisaoRetomada(revisao: RevisaoRetomada): string {
  if (!validar(revisao)) throw new Error('Revisão de retomada inválida.')
  const texto = PREFIXO_REVISAO_RETOMADA + JSON.stringify(revisao)
  if (texto.length > 1000) throw new Error('Encurte a revisão para caber na nota de 1000 caracteres.')
  return texto
}

/** Última revisão analítica, identificada como tal; nunca altera classificação, etapa ou pausa. */
export function revisaoRetomadaDoLead(lead: CrmLead, agora = Date.now()) {
  const notas = lead.eventos.filter(e => e.tipo === 'nota' && e.origem === 'manual'
    && e.texto?.startsWith(PREFIXO_REVISAO_RETOMADA) && Number.isFinite(Date.parse(e.em ?? '')) && Date.parse(e.em!) <= agora)
    .sort((a,b) => Date.parse(b.em!) - Date.parse(a.em!))
  for (const e of notas) {
    try {
      const r: unknown = JSON.parse(e.texto!.slice(PREFIXO_REVISAO_RETOMADA.length))
      if (validar(r)) return { ...r, em:e.em!, atual:r.base === baseDaRevisaoRetomada(lead) }
    } catch { /* nota incompleta não substitui uma revisão válida */ }
  }
  return null
}
