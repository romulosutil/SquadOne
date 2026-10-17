/**
 * PURO: a velocidade depois do "sim" (16/10/2026, OT-09 do blueprint).
 *
 * O funil dos 30 dias até 16/10 mostrou o dinheiro escapando depois do interesse (7 "quero ver",
 * 3 links, 0 propostas) e a métrica do blueprint "interesse respondido em até 2 h" nunca foi
 * medida. Aqui se mede o que o retrato já tem, sem dado novo:
 *  - do "quero ver" ao link: a resposta de interesse (`resposta.em`) até a 2ª mensagem anotada
 *    (`marcos.segundaEnviada`) ou o link visto numa mensagem nossa (`conversa.linkEm`), o que vier
 *    primeiro depois do interesse;
 *  - do link à proposta: desse link até a proposta anotada (`proposta.em`).
 * Quem ainda espera (sem fim) conta à parte, com há quanto tempo: é a venda parada agora.
 * A mediana, não a média: com amostras de 3 a 10, um caso de 4 dias distorce tudo.
 */
import { pedeMaterial } from './marcadores-da-conversa'
import type { CrmLead } from './types'

export const LIMITE_DA_RESPOSTA_RAPIDA_H = 2
const HORA = 3600_000

export interface Espera { leadId: string; empresa: string; horas: number }

export interface Medida {
  /** Os que chegaram ao fim, com o tempo de cada um (horas). */
  feitos: Espera[]
  /** Os que começaram e ainda não chegaram, com há quanto tempo esperam. */
  esperando: Espera[]
  medianaHoras: number | null
  /** Dos feitos, quantos dentro de `LIMITE_DA_RESPOSTA_RAPIDA_H`. */
  rapidos: number
}

export interface Velocidade { queroVerAoLink: Medida; linkAProposta: Medida; dias: number }

type LeadDaVelocidade = Pick<CrmLead, 'id' | 'empresa' | 'resposta' | 'marcos' | 'conversa' | 'proposta' | 'etapa'>

const ms = (iso: string | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** O primeiro instante da lista que não é antes de `depoisDe`. */
function primeiroDepois(depoisDe: number, ...candidatos: Array<number | null>): number | null {
  const validos = candidatos.filter((t): t is number => t !== null && t >= depoisDe)
  return validos.length ? Math.min(...validos) : null
}

export function mediana(valores: number[]): number | null {
  if (!valores.length) return null
  const v = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(v.length / 2)
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2
}

function medir(pares: Array<{ lead: LeadDaVelocidade; de: number; ate: number | null }>, agora: number): Medida {
  const feitos: Espera[] = []
  const esperando: Espera[] = []
  for (const { lead, de, ate } of pares) {
    const item = { leadId: lead.id, empresa: lead.empresa }
    if (ate !== null) feitos.push({ ...item, horas: (ate - de) / HORA })
    else esperando.push({ ...item, horas: (agora - de) / HORA })
  }
  esperando.sort((a, b) => b.horas - a.horas)
  return {
    feitos,
    esperando,
    medianaHoras: mediana(feitos.map((f) => f.horas)),
    rapidos: feitos.filter((f) => f.horas <= LIMITE_DA_RESPOSTA_RAPIDA_H).length,
  }
}

/**
 * Só entra quem começou dentro dos últimos `dias` (o mesmo recorte do "Por que não está vendendo").
 * Perdido sem fim não espera mais: sai da lista de espera, mas o feito antes de perder conta.
 */
export function velocidadeDaVenda(leads: readonly LeadDaVelocidade[], agora: number, dias = 30): Velocidade {
  const desde = agora - dias * 24 * HORA
  const aoLink: Array<{ lead: LeadDaVelocidade; de: number; ate: number | null }> = []
  const aProposta: Array<{ lead: LeadDaVelocidade; de: number; ate: number | null }> = []
  for (const lead of leads) {
    const encerrado = lead.etapa === 'perdido'
    // A licença ("pode mandar") também começa a espera pelo link: até 17/10 ela era gravada como interesse.
    const interesse = pedeMaterial(lead.resposta) ? ms(lead.resposta?.em) : null
    const link = primeiroDepois(interesse ?? -Infinity, ms(lead.marcos.segundaEnviada), ms(lead.conversa?.linkEm))
    if (interesse !== null && interesse >= desde && (link !== null || !encerrado)) aoLink.push({ lead, de: interesse, ate: link })
    if (link !== null && link >= desde) {
      const proposta = primeiroDepois(link, ms(lead.proposta?.em))
      if (proposta !== null || (!encerrado && lead.etapa !== 'ganho')) aProposta.push({ lead, de: link, ate: proposta })
    }
  }
  return { queroVerAoLink: medir(aoLink, agora), linkAProposta: medir(aProposta, agora), dias }
}

/** "3 h", "1 dia e 4 h", "40 min": a escala que se lê de relance. */
export function duracao(horas: number): string {
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`
  if (horas < 24) return `${Math.round(horas)} h`
  const d = Math.floor(horas / 24)
  const h = Math.round(horas - d * 24)
  return h ? `${d} ${d === 1 ? 'dia' : 'dias'} e ${h} h` : `${d} ${d === 1 ? 'dia' : 'dias'}`
}
