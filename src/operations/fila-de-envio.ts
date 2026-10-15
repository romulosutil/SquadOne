/**
 * PURO (o storage entra por parâmetro): a fila de envio do CRM (08/10/2026).
 *
 * O toque no `wa_link` marca o lead como enviado no n8n e abre o WhatsApp, mas o
 * retrato da planilha só muda no próximo ciclo do `08 · CRM` (até 10 min). Até
 * lá o lead seguia em "Primeiro contato para enviar" como se nada tivesse
 * acontecido: com 35 prontos, quem enviava em sequência perdia onde estava e
 * podia mandar duas vezes para o mesmo número. Por isso a tela lembra o toque,
 * só neste navegador e por pouco tempo: é conveniência de quem envia, nunca
 * estado do funil (a planilha continua sendo a verdade, RULES 11).
 *
 * `localStorage` pode lançar (modo privado, storage bloqueado), daí o try/catch:
 * sem ele a marca só não sobrevive ao reload.
 */
import type { CrmItemHoje, CrmLead } from './types'

export const CHAVE_DOS_ENVIOS = 'squadone:crm:envios-abertos'
/** Passado isto, o toque é esquecido: se a planilha ainda diz `pronto`, o lead volta à fila. */
export const VALIDADE_DO_ENVIO_MS = 30 * 60_000
/** O n8n relê a planilha a cada 10 min; sem confirmação depois disto, vale conferir se saiu. */
export const CONFIRMACAO_ESPERADA_MS = 15 * 60_000

/** leadId -> instante (ms) do toque no link de envio. */
export type EnviosAbertos = Record<string, number>

/** Só o necessário de `Storage`: os testes passam um objeto qualquer. */
export interface Guardador {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
}

function validos(envios: EnviosAbertos, agora: number): EnviosAbertos {
  return Object.fromEntries(Object.entries(envios).filter(([id, t]) =>
    typeof id === 'string' && id && Number.isFinite(t) && t <= agora + 60_000 && agora - t < VALIDADE_DO_ENVIO_MS))
}

function lerMarcas(storage: Guardador | null | undefined, chave: string, agora: number): EnviosAbertos {
  try {
    const bruto = JSON.parse(storage?.getItem(chave) ?? '{}')
    return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? validos(bruto as EnviosAbertos, agora) : {}
  } catch {
    return {}
  }
}

function gravarMarcas(storage: Guardador | null | undefined, chave: string, marcas: EnviosAbertos): void {
  try {
    storage?.setItem(chave, JSON.stringify(marcas))
  } catch {
    // Sem storage: a marca vale até o próximo reload.
  }
}

export const lerEnvios = (storage: Guardador | null | undefined, agora: number) => lerMarcas(storage, CHAVE_DOS_ENVIOS, agora)
export const gravarEnvios = (storage: Guardador | null | undefined, envios: EnviosAbertos) => gravarMarcas(storage, CHAVE_DOS_ENVIOS, envios)

// ---------------------------------------------------------------- A/B do vídeo (11/10/2026, ab-video.ts)
// O `wa.me?text=` não anexa mídia: no braço com vídeo, o vídeo sai à mão logo depois da
// mensagem. "Vídeo enviado" é lembrado como o toque da fila (mesma validade de 30 min, só neste
// navegador): serve para quem envia não esquecer nem mandar duas vezes, nunca vai à planilha.

export const CHAVE_DOS_VIDEOS = 'squadone:crm:videos-enviados'
export const lerVideos = (storage: Guardador | null | undefined, agora: number) => lerMarcas(storage, CHAVE_DOS_VIDEOS, agora)
export const gravarVideos = (storage: Guardador | null | undefined, videos: EnviosAbertos) => gravarMarcas(storage, CHAVE_DOS_VIDEOS, videos)
/** Mesma regra do toque: repetir não renova, o que vale é a primeira marca. */
export const marcarVideo = marcarEnvio

/** O passo extra do braço com vídeo; null fora dele (coluna `braco_video` vazia ou outro braço). */
export function passoDoVideo(lead: CrmLead): string | null {
  if (lead.abordagem?.video !== 'video') return null
  return `Logo depois da mensagem, mande à mão o vídeo de 15 s do demo de ${lead.empresa}: o link do WhatsApp leva só o texto.`
}

/** `pendente`: braço com vídeo e ainda sem a marca de enviado; null fora do braço. */
export function estadoDoVideo(lead: CrmLead, videos: EnviosAbertos): 'pendente' | 'enviado' | null {
  if (lead.abordagem?.video !== 'video') return null
  return lead.id in videos ? 'enviado' : 'pendente'
}

/** Repetir o toque não renova a marca: o que vale é a primeira vez que o WhatsApp abriu. */
export function marcarEnvio(envios: EnviosAbertos, leadId: string, agora: number): EnviosAbertos {
  const atuais = validos(envios, agora)
  return leadId in atuais ? atuais : { ...atuais, [leadId]: agora }
}

/**
 * Tira o que venceu e o que a planilha já confirmou (o lead saiu dos prontos).
 * `prontos` só vale de um retrato legível: sem ele, quem chama não poda.
 */
export function podarEnvios(envios: EnviosAbertos, prontos: ReadonlySet<string>, agora: number): EnviosAbertos {
  return Object.fromEntries(Object.entries(validos(envios, agora)).filter(([id]) => prontos.has(id)))
}

/** `aguardando`: a planilha ainda pode confirmar a qualquer momento; `conferir`: já devia ter confirmado. */
export function estadoDoEnvio(abertoEm: number, agora: number): 'aguardando' | 'conferir' {
  return agora - abertoEm >= CONFIRMACAO_ESPERADA_MS ? 'conferir' : 'aguardando'
}

/** Os itens de "Primeiro contato para enviar" com os já abertos no fim, cada parte na ordem do servidor. */
export function ordenarComEnvios(itens: CrmItemHoje[], envios: EnviosAbertos): CrmItemHoje[] {
  return [...itens.filter(i => !(i.leadId in envios)), ...itens.filter(i => i.leadId in envios)]
}

export interface ItemDaFila {
  item: CrmItemHoje
  lead: CrmLead
  /** O link rastreado do n8n: marca o envio e abre o WhatsApp. */
  enviar: string
}

const nichoDe = (lead: CrmLead) => lead.nicho.trim() || 'Sem nicho'

/**
 * A fila de um por um: quem tem link de envio e ainda não foi aberto nesta tela,
 * na ordem do servidor (o mais antigo primeiro), opcionalmente de um nicho só.
 */
export function filaDeEnvio(itens: CrmItemHoje[], leads: ReadonlyMap<string, CrmLead>, envios: EnviosAbertos, nicho: string | null = null): ItemDaFila[] {
  const fila: ItemDaFila[] = []
  for (const item of itens) {
    const lead = leads.get(item.leadId)
    const enviar = lead?.links.enviar
    if (!lead || !enviar || item.leadId in envios) continue
    if (nicho !== null && nichoDe(lead) !== nicho) continue
    fila.push({ item, lead, enviar })
  }
  return fila
}

/** Os nichos da fila, do que tem mais sites esperando para o que tem menos (empate: alfabética). */
export function nichosDaFila(itens: CrmItemHoje[], leads: ReadonlyMap<string, CrmLead>, envios: EnviosAbertos): Array<{ nicho: string; quantos: number }> {
  const contagem = new Map<string, number>()
  for (const { lead } of filaDeEnvio(itens, leads, envios)) contagem.set(nichoDe(lead), (contagem.get(nichoDe(lead)) ?? 0) + 1)
  return [...contagem].map(([nicho, quantos]) => ({ nicho, quantos }))
    .sort((a, b) => b.quantos - a.quantos || a.nicho.localeCompare(b.nicho, 'pt-BR'))
}

/**
 * A ordem em que a folha mostra a fila: quem não foi pulado primeiro, depois os
 * pulados na ordem em que foram pulados (pular de novo manda para o fim).
 */
export function ordemComPulados(fila: ItemDaFila[], pulados: readonly string[]): ItemDaFila[] {
  const posicao = (id: string) => pulados.indexOf(id)
  return [...fila].sort((a, b) => posicao(a.item.leadId) - posicao(b.item.leadId))
}
