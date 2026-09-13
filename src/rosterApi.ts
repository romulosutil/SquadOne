/**
 * Escritas no roster da Fase 2. O erro carrega status e corpo porque a UI
 * decide pela CLASSIFICAÇÃO (`modeloOcupado`, `redacaoFalhou`,
 * `squadInexistente`), não pelo texto da mensagem.
 */
import type { HireResponse, PedidoDeRedacao, Redacao, RosterView, SubstituicaoResponse } from './types'

export class ErroDaApi extends Error {
  readonly status: number
  readonly corpo: Record<string, any>
  constructor(status: number, corpo: Record<string, any>) {
    super(corpo.error ?? `HTTP ${status}`)
    this.name = 'ErroDaApi'
    this.status = status
    this.corpo = corpo
  }
}

async function chamar<T>(metodo: 'POST' | 'PATCH', rota: string, corpo?: unknown): Promise<T> {
  const response = await fetch(rota, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  })
  const dados = await response.json().catch(() => ({}))
  if (!response.ok) throw new ErroDaApi(response.status, dados)
  return dados as T
}

/** Segmento do caminho nas rotas de ciclo de vida. */
export type TipoDoRoster = 'pessoas' | 'dominios' | 'squads'

const seg = encodeURIComponent

export const rosterApi = {
  redigir: (pedido: PedidoDeRedacao) => chamar<Redacao>('POST', '/api/squad/redigir', pedido),
  contratar: (sugestao: Record<string, unknown>, nome?: string) =>
    chamar<HireResponse>('POST', '/api/squad/hire', { sugestao, nome }),
  substituirPo: (dominioId: string, corpo: { integranteId: string } | { nome?: string; papel: string; escopo: string }) =>
    chamar<SubstituicaoResponse>('POST', `/api/squad/dominios/${seg(dominioId)}/po`, corpo),
  editar: (tipo: TipoDoRoster, id: string, corpo: Record<string, string>) =>
    chamar<{ roster: RosterView }>('PATCH', `/api/squad/${tipo}/${seg(id)}`, corpo),
  arquivar: (tipo: TipoDoRoster, id: string) =>
    chamar<{ roster: RosterView }>('POST', `/api/squad/${tipo}/${seg(id)}/arquivar`),
  reativar: (tipo: TipoDoRoster, id: string) =>
    chamar<{ roster: RosterView }>('POST', `/api/squad/${tipo}/${seg(id)}/reativar`)
}

/**
 * Mensagem de falha da redação. Toda falha termina oferecendo escrever à mão:
 * redigir é ajuda, nunca pré-requisito para contratar.
 */
export function mensagemDeRedacao(err: unknown): string {
  if (err instanceof ErroDaApi) {
    if (err.corpo.modeloOcupado) return 'Gemini ocupado agora. Tente de novo em alguns segundos ou escreva à mão.'
    if (err.corpo.redacaoFalhou) return `${err.message} Você pode escrever à mão.`
    return err.message
  }
  return 'Sem resposta do servidor. Escreva à mão ou tente de novo.'
}
