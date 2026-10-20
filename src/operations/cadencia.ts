/** Cadência comercial (19/10/2026). Dias úteis = seg–sex, como o expediente existente, sem calendário de feriados. */
import { contatoPausado } from './aprendizado-comercial'
import type { CrmLead } from './types'

const DIA = 86_400_000
const instante = (v: string | undefined) => Date.parse(v ?? '')
export const diaDaCadencia = (ms: number) => Math.floor((ms - 3 * 3600_000) / DIA)
export function diasUteisDaCadencia(inicio: number, agora: number): number {
  let n = 0
  for (let d = diaDaCadencia(inicio) + 1; d <= diaDaCadencia(agora); d++) {
    const semana = new Date(d * DIA).getUTCDay()
    if (semana !== 0 && semana !== 6) n++
  }
  return n
}

export interface RegistroDeCadencia {
  versao: 1
  tipo: 'proposta' | 'conversa'
  origem: string
  degrau: 'dia-1' | 'dia-3' | 'dia-2'
  /** Conversa: a saída original, preservada mesmo depois de enviar o toque. */
  base?: string
}
export function lerRegistroCadencia(texto: unknown): RegistroDeCadencia | null {
  if (typeof texto !== 'string' || texto.length > 1000) return null
  try {
    const v = JSON.parse(texto)
    if (!v || Array.isArray(v) || v.versao !== 1 || !['proposta', 'conversa'].includes(v.tipo)
      || typeof v.origem !== 'string' || !Number.isFinite(instante(v.origem))
      || (v.tipo === 'proposta' ? !['dia-1', 'dia-3'].includes(v.degrau) : v.degrau !== 'dia-2' || typeof v.base !== 'string' || !Number.isFinite(instante(v.base)))
      || Object.keys(v).some(k => !['versao','tipo','origem','degrau','base'].includes(k))) return null
    return { versao: 1, tipo: v.tipo, origem: v.origem, degrau: v.degrau, ...(v.tipo === 'conversa' ? { base: v.base } : {}) }
  } catch { return null }
}
export function textoDoRegistroCadencia(v: RegistroDeCadencia): string {
  const texto = JSON.stringify(v)
  if (!lerRegistroCadencia(texto)) throw new Error('Confirmação de cadência inválida.')
  return texto
}

export interface CadenciaDoLead {
  estado: 'aguardar' | 'preservar' | 'tocar' | 'revisar' | 'expirar'
  tipo: 'proposta' | 'conversa'
  origem: string
  base: number
  registro?: RegistroDeCadencia
  chave?: string
}
type LeadDaCadencia = Pick<CrmLead, 'id' | 'etapa' | 'proposta' | 'eventos' | 'conversa' | 'resposta' | 'marcos' | 'proximoPasso' | 'perdaManual'>
export function cadenciaDoLead(lead: LeadDaCadencia, agora: number): CadenciaDoLead | null {
  // Uma recusa ainda sem marca humana é desfecho, nunca uma nova cobrança.
  if (lead.perdaManual || ['negativa', 'exclusao'].includes(lead.resposta?.tipo ?? '')
    || !['contato', 'proposta'].includes(lead.etapa)) return null
  const humana = Math.max(instante(lead.conversa?.ultimaEntrada) || 0,
    lead.resposta?.tipo !== 'bot' ? instante(lead.resposta?.em) || 0 : 0, instante(lead.marcos.respondeu) || 0)
  const futuro = lead.proximoPasso?.data && instante(`${lead.proximoPasso.data}T12:00:00-03:00`)
  const preservar = contatoPausado(lead) || Boolean(futuro && diaDaCadencia(futuro) > diaDaCadencia(agora))
  const registros = (lead.eventos ?? []).filter(e => e.tipo === 'cadencia_enviada' && e.origem === 'manual' && instante(e.em) <= agora)
    .map(e => lerRegistroCadencia(e.registroTexto ?? e.texto)).filter((v): v is RegistroDeCadencia => !!v)
  if (lead.etapa === 'proposta' && lead.proposta) {
    const origem = lead.proposta.em
    const base = lead.proposta.data ? instante(`${lead.proposta.data}T12:00:00-03:00`) : instante(origem)
    if (!Number.isFinite(base)) return null
    const r: CadenciaDoLead = { tipo: 'proposta', origem, base, estado: 'aguardar' }
    const anotado = instante(origem)
    const corteDaResposta = diaDaCadencia(anotado) === diaDaCadencia(base) ? anotado : diaDaCadencia(base) * DIA + 3 * 3600_000
    if (preservar || humana > corteDaResposta) return { ...r, estado: 'preservar' }
    if (diaDaCadencia(agora) - diaDaCadencia(base) >= 10) return { ...r, estado: 'expirar' }
    const uteis = diasUteisDaCadencia(base, agora)
    const degrau = uteis >= 3 ? 'dia-3' : uteis >= 1 ? 'dia-1' : null
    if (!degrau || registros.some(v => v.tipo === 'proposta' && v.origem === origem && v.degrau === degrau)) return r
    const registro: RegistroDeCadencia = { versao: 1, tipo: 'proposta', origem, degrau }
    return { ...r, estado: 'tocar', registro, chave: `${lead.id}|cadencia|proposta|${origem}|${degrau}` }
  }
  if (lead.etapa !== 'contato' || !humana) return null
  const origem = new Date(humana).toISOString()
  const ja = registros.find(v => v.tipo === 'conversa' && v.origem === origem)
  const saida = instante(lead.conversa?.ultimaSaida)
  const base = ja ? instante(ja.base) : saida
  if (!Number.isFinite(base) || base < humana) return null // Resposta nova é a vez da conversa, nunca cobrança.
  const r: CadenciaDoLead = { tipo: 'conversa', origem, base, estado: 'aguardar' }
  if (preservar) return { ...r, estado: 'preservar' }
  if (diaDaCadencia(agora) - diaDaCadencia(base) >= 7) return { ...r, estado: 'revisar' }
  if (ja || diasUteisDaCadencia(base, agora) < 2) return r
  const registro: RegistroDeCadencia = { versao: 1, tipo: 'conversa', origem, degrau: 'dia-2', base: new Date(base).toISOString() }
  return { ...r, estado: 'tocar', registro, chave: `${lead.id}|cadencia|conversa|${origem}|dia-2` }
}

export function cadenciaJaConfirmada(lead: Pick<CrmLead, 'eventos'>, registro: RegistroDeCadencia): boolean {
  return (lead.eventos ?? []).some(e => {
    const r = e.tipo === 'cadencia_enviada' && e.origem === 'manual' ? lerRegistroCadencia(e.registroTexto ?? e.texto) : null
    return r?.tipo === registro.tipo && r.origem === registro.origem && r.degrau === registro.degrau
  })
}
