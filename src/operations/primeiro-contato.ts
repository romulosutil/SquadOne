/**
 * PURO (19/10/2026): quem faz o primeiro contato de um lead, e se o time comercial pode fazê-lo agora.
 *
 * Em 18/10/2026 o time comercial (deploy/dell/frente-comercial.py) foi ligado na Mel e passou a
 * mandar o primeiro contato sozinho pelo número do PRUMO. Ele pulava a Triagem, tinha ritmo próprio
 * (100/dia, 12/h, 5 min) contra o da Central e não anotava nada no CRM; a tela e o vendedor do
 * Telegram continuavam oferecendo os mesmos leads ao Rômulo. Foi parado em 19/10 sem ter enviado.
 * Daqui saem as três regras que faltavam, num lugar só:
 *
 *  - `quemFazOPrimeiroContato`: o lead que está na fila do time (com o time ligado), ou cujo envio o
 *    time já começou (incerto ou enviado, ligado ou não), é do time; todo o resto é do operador
 *    (Próxima venda, Ficha, Telegram). A Próxima venda e o vendedor do Telegram tiram da fila o
 *    primeiro contato dos leads do time; o time, por sua vez, não reserva lead que o operador já
 *    tocou hoje (`primeiros` do venda-do-dia.json, de qualquer superfície).
 *  - `elegivelParaOTime`: só o lead que a Central já liberou para o primeiro contato (`pronto`, com
 *    o link rastreado e a mensagem do Balcão). `revisar` é a Triagem, que é do Rômulo: lá o convite
 *    abre o WhatsApp e quem o envia é ele (o envio só vale quando o observador o vê ou o "Enviei"
 *    explícito o marca), então o time não pega lead da Triagem. Plus fica fora (texto e saudação próprios).
 *    PRUMO, Iris e estamparias não têm `pronto` (o convite só existe em `revisar`): ficam fora até
 *    existir uma decisão "Convidar pelo time" gravada no CRM.
 *  - `reservaDoTime`: a MESMA janela (EXPEDIENTE_DE_VENDA) e o MESMO ritmo (REGRAS_DO_RITMO) da
 *    Central, contando o retrato e os primeiros do dia de todas as superfícies. A rota que usa isto
 *    (server/frente-comercial.ts) decide e grava o primeiro do time num passo só da fila do
 *    venda-do-dia: dois pedidos juntos não passam os dois.
 */
import type { CrmLead } from './types'
import { noExpedienteDeVenda } from './trava-de-horario'
import { instantesDePrimeiroContato, ritmoDoEnvio, REGRAS_DO_RITMO, somarPrimeiros, type MotivoDoRitmo, type RegrasDoRitmo } from './trava-de-ritmo'

export type QuemFazOPrimeiro = 'time' | 'operador'
/** O estado de um lead na fila do time (frente-comercial.json, `fila[].estado`). */
export type EstadoNoTime = 'pronto' | 'incerto' | 'enviado'

export interface FrenteDoPrimeiro {
  /** O time está ligado (frente-comercial-config.json, `ativo: true`). */
  ativo: boolean
  /** leadId -> o estado dele na fila do time. */
  leads: Readonly<Record<string, EstadoNoTime>>
}

const ESTADOS: readonly EstadoNoTime[] = ['pronto', 'incerto', 'enviado']
const objeto = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x)

/**
 * A fila do time como os dois arquivos do Dell a guardam. Tolerante: arquivo ausente ou ilegível
 * é o time desligado e sem fila (o operador faz tudo), nunca um erro.
 */
export function frenteDosArquivos(config: unknown, estado: unknown): FrenteDoPrimeiro {
  const leads: Record<string, EstadoNoTime> = {}
  const fila = objeto(estado) && Array.isArray(estado.fila) ? estado.fila : []
  for (const item of fila) {
    if (!objeto(item) || typeof item.id !== 'string' || !item.id) continue
    if (ESTADOS.includes(item.estado as EstadoNoTime)) leads[item.id] = item.estado as EstadoNoTime
  }
  return { ativo: objeto(config) && config.ativo === true, leads }
}

/**
 * Quem faz o primeiro contato deste lead. Envio já começado pelo time (incerto ou enviado) é dele
 * mesmo com o time pausado: outro primeiro contato ao mesmo lead seria o segundo.
 */
export function quemFazOPrimeiroContato(leadId: string, frente: FrenteDoPrimeiro): QuemFazOPrimeiro {
  const estado = frente.leads[leadId]
  if (estado === 'incerto' || estado === 'enviado') return 'time'
  return frente.ativo && estado === 'pronto' ? 'time' : 'operador'
}

/** Os leads cujo primeiro contato é do time: a tela e o Telegram não oferecem o primeiro contato deles. */
export function primeirosDoTime(frente: FrenteDoPrimeiro): Set<string> {
  return new Set(Object.keys(frente.leads).filter((id) => quemFazOPrimeiroContato(id, frente) === 'time'))
}

type LeadDoTime = Pick<CrmLead, 'produto' | 'etapa' | 'sinal' | 'links' | 'marcos' | 'empresa'>
  & Partial<Pick<CrmLead, 'conversa' | 'resposta' | 'proximoPasso' | 'mensagemPronta'>>

/** O lead que a Central já liberou para o primeiro contato e que o time pode fazer (o mesmo `elegivel` do .py). */
export function elegivelParaOTime(lead: LeadDoTime | undefined): boolean {
  if (!lead || lead.produto !== 'site' || lead.etapa !== 'novo' || lead.sinal !== 'pronto') return false
  if (!lead.links.enviar || !lead.links.whatsapp || !lead.mensagemPronta?.trim()) return false
  if (lead.conversa || lead.resposta || lead.proximoPasso) return false
  return !Object.values(lead.marcos ?? {}).some(Boolean)
}

export type RecusaDoTime = 'fora-do-expediente' | MotivoDoRitmo | 'nao-elegivel' | 'nao-e-do-time' | 'ja-tocado' | 'mensagem-barrada'

export type ReservaDoTime =
  | { ok: true }
  /** `ate`: quando o ritmo libera (ms); null quando a recusa não tem hora (o lead, ou fora do expediente). */
  | { ok: false; motivo: RecusaDoTime; ate: number | null }

/** As recusas que valem para qualquer lead: o time para a rodada e tenta de novo depois. */
export const RECUSAS_GERAIS: ReadonlySet<RecusaDoTime> = new Set(['fora-do-expediente', 'pausa', 'dia', 'hora', 'intervalo'])

export interface PedidoDoTime {
  leadId: string
  /** O lead no retrato de agora (undefined: sumiu do retrato). */
  lead: LeadDoTime | undefined
  frente: FrenteDoPrimeiro
  /** O retrato inteiro: os `marcos.enviado` de todo produto entram no ritmo. */
  leads: ReadonlyArray<Pick<CrmLead, 'id' | 'sinal' | 'marcos'>>
  /** Os primeiros do dia de todas as superfícies (venda-do-dia.json). */
  primeiros: Readonly<Record<string, { em: number } | number>>
  /** O gate de envio (server/gate-de-envio.ts) aprovou a mensagem do Balcão em modo "bloquear". */
  mensagemAprovada: boolean
  agora: number
  regras?: RegrasDoRitmo
}

/**
 * Pode sair agora o primeiro contato do time a este lead? Primeiro o que vale para todos (expediente,
 * ritmo), para o time parar a rodada; depois o que é do lead.
 */
export function reservaDoTime(p: PedidoDoTime): ReservaDoTime {
  if (!noExpedienteDeVenda(p.agora)) return { ok: false, motivo: 'fora-do-expediente', ate: null }
  const ritmo = ritmoDoEnvio(instantesDePrimeiroContato(p.leads, somarPrimeiros(p.primeiros)), p.agora, p.regras ?? REGRAS_DO_RITMO)
  if (ritmo.motivo) return { ok: false, motivo: ritmo.motivo, ate: ritmo.ate }
  if (!elegivelParaOTime(p.lead)) return { ok: false, motivo: 'nao-elegivel', ate: null }
  if (quemFazOPrimeiroContato(p.leadId, p.frente) !== 'time' || p.frente.leads[p.leadId] !== 'pronto') return { ok: false, motivo: 'nao-e-do-time', ate: null }
  if (p.primeiros[p.leadId] !== undefined) return { ok: false, motivo: 'ja-tocado', ate: null }
  if (!p.mensagemAprovada) return { ok: false, motivo: 'mensagem-barrada', ate: null }
  return { ok: true }
}
