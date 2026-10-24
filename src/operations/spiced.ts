import { temQualificacaoComercial, lacunasDaQualificacaoComercial, qualificadoComercialmenteParaProposta, type EntradaQualificacaoComercial } from './qualificacao-comercial'

/** Qualificação confirmada pelo operador. Sugestões do copiloto têm outro contrato e nunca entram aqui. */
export interface Spiced {
  situacao: string
  dor: string
  impacto: string
  evento_critico: { fato: string; data: string }
  decisao: { decisor_confirmado: 'sim' | 'nao' | 'nao-sei'; quem: string; como_paga: string }
}

export const LIMITE_DO_CAMPO_SPICED = 200
export const LIMITE_DO_REGISTRO_SPICED = 1000

export function spicedVazio(): Spiced {
  return { situacao: '', dor: '', impacto: '', evento_critico: { fato: '', data: '' }, decisao: { decisor_confirmado: 'nao-sei', quem: '', como_paga: '' } }
}

const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const chaves = (v: Record<string, unknown>, esperadas: string[]) => Object.keys(v).length === esperadas.length && esperadas.every(k => Object.hasOwn(v, k))
const campo = (v: unknown): v is string => typeof v === 'string' && v.length <= LIMITE_DO_CAMPO_SPICED && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)

/** Não aceita normalização automática de 31/02 pelo Date.parse. Vazio significa ainda não informado. */
export function dataRealDoSpiced(v: unknown): v is string {
  if (v === '') return true
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const ms = Date.parse(`${v}T12:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v
}

/** Valida esquema completo e limites; nunca corta evidência nem transforma sugestão em confirmação. */
export function lerSpiced(v: unknown): Spiced | null {
  if (!objeto(v) || !chaves(v, ['situacao', 'dor', 'impacto', 'evento_critico', 'decisao'])) return null
  const e = v.evento_critico, d = v.decisao
  if (![v.situacao, v.dor, v.impacto].every(campo)
    || !objeto(e) || !chaves(e, ['fato', 'data']) || !campo(e.fato) || !dataRealDoSpiced(e.data)
    || !objeto(d) || !chaves(d, ['decisor_confirmado', 'quem', 'como_paga'])
    || typeof d.decisor_confirmado !== 'string' || !['sim', 'nao', 'nao-sei'].includes(d.decisor_confirmado) || !campo(d.quem) || !campo(d.como_paga)) return null
  const s: Spiced = {
    situacao: (v.situacao as string).trim(), dor: (v.dor as string).trim(), impacto: (v.impacto as string).trim(),
    evento_critico: { fato: e.fato.trim(), data: e.data },
    decisao: { decisor_confirmado: d.decisor_confirmado as Spiced['decisao']['decisor_confirmado'], quem: d.quem.trim(), como_paga: d.como_paga.trim() },
  }
  return JSON.stringify(s).length <= LIMITE_DO_REGISTRO_SPICED ? s : null
}

export function textoDoRegistroSpiced(s: Spiced): string {
  const valido = lerSpiced(s)
  if (!valido) throw new Error('Confira o SPICED: até 200 caracteres por campo, 1000 no registro e datas reais no formato AAAA-MM-DD.')
  return JSON.stringify(valido)
}

export function lerRegistroSpiced(texto: unknown): Spiced | null {
  if (typeof texto !== 'string' || texto.length > LIMITE_DO_REGISTRO_SPICED) return null
  try { return lerSpiced(JSON.parse(texto)) } catch { return null }
}

type LeadQualificado = EntradaQualificacaoComercial & { spiced?: Spiced }

export function lacunasDoSpiced(lead: LeadQualificado, agora = Date.now()): string[] {
  if (temQualificacaoComercial(lead,agora)) return lacunasDaQualificacaoComercial(lead,agora)
  const s = lerSpiced(lead.spiced)
  return [!s?.dor && 'dor', !s?.impacto && 'impacto', s?.decisao.decisor_confirmado !== 'sim' && 'decisor confirmado'].filter((v): v is string => Boolean(v))
}

export function qualificadoParaProposta(lead: LeadQualificado, agora = Date.now()): boolean {
  if (temQualificacaoComercial(lead,agora)) return qualificadoComercialmenteParaProposta(lead,agora)
  return lacunasDoSpiced(lead,agora).length === 0
}
