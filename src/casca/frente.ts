/**
 * A leitura do time comercial (`GET /api/operations/crm/frente`), uma por aba e compartilhada.
 *
 * A Central lia a frente no laço dela (o "turno do time" do Escritório) e o FrenteComercial, aberto no
 * painel, lia de novo no laço dele: duas leituras por ciclo da mesma coisa (VEN-22, 19/10/2026). Agora os
 * dois chamam `lerFrente`, que junta as chamadas simultâneas numa só e reaproveita a última por alguns
 * segundos; quem lê de novo mais tarde (o laço de 30 s) pede de verdade. O estado vive no módulo, como o
 * overview (casca/overview.ts): o mesmo objeto para quem o importa.
 */
import { ref } from 'vue'
import type { JustificativaComercial } from '../operations/justificativa-comercial'

export interface AvaliacaoDaFrente { agente: string; nota: number; motivo: string }
export interface ContatoDaFrente { id: string; empresa: string; produto: string; setor?: string; nota: number; estado: string; motivo: string; avaliacoes: AvaliacaoDaFrente[]; mensagem: string; justificativaComercial?: JustificativaComercial | null }
export interface SetorDaFrente { setor: string; avaliados: number; selecionados: number; enviados: number }
export interface FunilDaFrente { produto: string; novo: number; contato: number; proposta: number; ganho: number; perdido: number; elegiveis: number; contatosObservados: number; respostasWhatsapp: number; taxaResposta: number | null }
export interface FrenteLida {
  ativo: boolean
  estado: string
  limite: number
  rodada?: { inicio: string | null; pendentes: number; limite: number; motivo: string; bloqueado: boolean } | null
  /** `ativo` mas sem rodada recente dentro do expediente: o timer do Dell está parado (server/frente-comercial.ts). */
  cicloParado?: boolean
  /** A hora da última rodada que o script gravou (ISO); null sem nenhuma. */
  ultimaRodadaEm?: string | null
  enviados?: number
  respondidos?: number | null
  respostasHoje?: { dia: string; enviados: number; humanas: number; robos: number; semResposta: number } | null
  intervaloMinutos?: number
  porHora?: number
  pausaAutomatica?: { motivo: string; desde: string; detalhe: string; revisarApos: string | null } | null
  avaliados?: number
  selecionados?: number
  setores?: SetorDaFrente[]
  funil?: FunilDaFrente[]
  atualizadoEm: string | null
  detalhe?: string
  proximoEnvioEm?: string | null
  fila: ContatoDaFrente[]
}

/** O que vale reaproveitar sem perguntar de novo: dois leitores no mesmo ciclo leem uma vez. */
export const FRESCOR_DA_FRENTE_MS = 5_000

const frente = ref<FrenteLida | null>(null)
const erro = ref('')
let emVoo: Promise<void> | null = null
let lidoEm = 0

/** Os dois estados compartilhados; as telas só leem. */
export const useFrente = () => ({ frente, erro })

/** Lê (ou reaproveita) a frente. Aborto da tela não vira erro; falha de rede vira o aviso de sem leitura recente. */
export function lerFrente(signal?: AbortSignal): Promise<void> {
  if (emVoo) return emVoo
  if (frente.value && Date.now() - lidoEm < FRESCOR_DA_FRENTE_MS) return Promise.resolve()
  emVoo = (async () => {
    try {
      const r = await fetch('/api/operations/crm/frente', { ...(signal ? { signal } : {}), cache: 'no-store' })
      if (!r.ok) throw new Error('Não foi possível consultar o time.')
      frente.value = await r.json()
      erro.value = ''
      lidoEm = Date.now()
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) erro.value = 'O time está sem leitura recente. Os números anteriores podem estar desatualizados.'
    } finally {
      emVoo = null
    }
  })()
  return emVoo
}

/** A tela alterou a configuração: o próximo `lerFrente` pergunta de verdade. */
export function esquecerAFrente(): void {
  lidoEm = 0
}
