/**
 * PURO (29/10/2026): desde quando e por que os primeiros contatos do time estão pausados.
 *
 * Em 28/10/2026 às 19:41 a proteção automática viu o WhatsApp do PRUMO desconectado e gravou
 * `ativo: false` na config do time. A Central dizia só "Primeiros contatos pausados", e a config
 * não guardava quem nem por quê: a pausa ficou invisível por uma noite inteira. Agora quem pausa
 * grava `pausadoEm`, `pausadoPor` e `motivoDaPausa` (server/protecao-prospeccao.ts), e a Central
 * diz "Pausado desde <data> por <motivo>". Config antiga, sem esses campos, usa a pausa automática
 * quando há uma e, sem ela, a hora da última gravação, dizendo que o motivo não foi registrado.
 */

export type QuemPausou = 'protecao' | 'central' | 'nao-registrado'

export interface PausaDoTime {
  /** ISO; null quando nem a config diz quando. */
  desde: string | null
  por: QuemPausou
  motivo: string
}

export interface ConfigDoTime {
  ativo?: unknown
  atualizadoEm?: unknown
  pausadoEm?: unknown
  pausadoPor?: unknown
  motivoDaPausa?: unknown
}

export interface PausaAutomaticaLida { motivo: string; desde: string; detalhe: string }

const MOTIVO_CURTO: Record<string, string> = {
  desconectado: 'WhatsApp do PRUMO desconectado',
  restricao: 'restrição da conta do WhatsApp',
  recusa: 'envio recusado pela integração (403 ou 429)',
  'sem-resposta-humana': 'contatos sem resposta humana',
}

const texto = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null

/** null = o time não está pausado (config `ativo: true` e sem pausa automática). */
export function pausaDoTime(config: ConfigDoTime | null, automatica: PausaAutomaticaLida | null): PausaDoTime | null {
  // A pausa automática manda: é ela que barra as reservas, mesmo se a config disser ativo.
  if (automatica) {
    return { desde: iso(automatica.desde), por: 'protecao', motivo: MOTIVO_CURTO[automatica.motivo] ?? texto(automatica.detalhe) ?? 'proteção automática' }
  }
  if (config?.ativo === true) return null
  const por = config?.pausadoPor === 'protecao' || config?.pausadoPor === 'central' ? config.pausadoPor : 'nao-registrado'
  return {
    desde: iso(config?.pausadoEm) ?? iso(config?.atualizadoEm),
    por,
    motivo: texto(config?.motivoDaPausa) ?? (config ? 'motivo não registrado' : 'time nunca ligado nesta Central'),
  }
}

const QUEM: Record<QuemPausou, string> = { protecao: 'proteção automática', central: 'na Central', 'nao-registrado': 'autor não registrado' }

const dataCurta = (desde: string) => new Date(desde).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')

/** "Pausado desde 28/10 19:41 por WhatsApp do PRUMO desconectado (proteção automática)". */
export function textoDaPausa(p: PausaDoTime): string {
  const desde = p.desde ? ` desde ${dataCurta(p.desde)}` : ''
  return `Pausado${desde} por ${p.motivo} (${QUEM[p.por]})`
}
