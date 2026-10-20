import { eventoCriticoDe, EVENTO_CRITICO_APROVADO } from '../../server/site-mensagem.ts'
import { primeiraComEventoCriticoDoPrumo } from '../../server/prumo-mensagem.ts'
import { hashDoLead } from './ab-video'

export interface EntradaDaAberturaPrumo {
  id: string; empresa: string; nicho: string; enviado: boolean; controle: string
  raio_x_url?: unknown; raio_x_achados?: unknown
  /** Só metadata de uma confirmação real; não preencher para envios históricos sem registro. */
  salva?: { mensagem_variante: string; ab_elegiveis: string; mensagem?: string }
}
export interface AberturaPrumo { mensagem_variante: 'A' | 'D'; ab_elegiveis: 'A' | 'AD'; mensagem: string }
const estrato = (n: string, e: string) => `${n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()}|${e}`
const valida = (m: EntradaDaAberturaPrumo['salva']): m is AberturaPrumo => Boolean(m && (m.ab_elegiveis === 'A' || m.ab_elegiveis === 'AD') && ['A', 'D'].includes(m.mensagem_variante) && m.ab_elegiveis.includes(m.mensagem_variante))
/** A/D separado do Site. Leitura pura: as colunas só se tornam fatos ao confirmar o envio. */
export function alocarAberturasPrumo(leads: readonly EntradaDaAberturaPrumo[], aprovado = EVENTO_CRITICO_APROVADO): Map<string, AberturaPrumo> {
  const contagens = new Map<string, { A: number; D: number }>()
  const resultado = new Map<string, AberturaPrumo>()
  for (const l of leads.filter(l => l.enviado && valida(l.salva))) {
    const s = l.salva as AberturaPrumo
    const chave = estrato(l.nicho, s.ab_elegiveis)
    const n = contagens.get(chave) ?? { A: 0, D: 0 }; n[s.mensagem_variante]++; contagens.set(chave, n)
    resultado.set(l.id, { ...s, mensagem: s.mensagem ?? l.controle })
  }
  for (const l of [...leads].filter(l => !l.enviado).sort((a, b) => a.id.localeCompare(b.id))) {
    const elegiveis = aprovado && eventoCriticoDe(l) ? 'AD' : 'A'
    const chave = estrato(l.nicho, elegiveis)
    const n = contagens.get(chave) ?? { A: 0, D: 0 }
    const letra = elegiveis === 'A' ? 'A' : n.A === n.D ? (hashDoLead(l.id, 'prumo-abertura-2026-10-19') % 2 ? 'D' : 'A') : n.A < n.D ? 'A' : 'D'
    resultado.set(l.id, { mensagem_variante: letra, ab_elegiveis: elegiveis, mensagem: letra === 'D' ? primeiraComEventoCriticoDoPrumo(l.empresa, l, aprovado) : l.controle })
    n[letra]++; contagens.set(chave, n)
  }
  return resultado
}
export function lerAberturaPrumo(bruto: unknown): Pick<AberturaPrumo, 'mensagem_variante' | 'ab_elegiveis'> | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const m = bruto as EntradaDaAberturaPrumo['salva']
  return valida(m) ? { mensagem_variante: m.mensagem_variante, ab_elegiveis: m.ab_elegiveis } : null
}
