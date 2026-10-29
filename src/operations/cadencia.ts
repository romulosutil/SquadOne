/**
 * Cadência comercial (19/10/2026; a da proposta refeita em 28/10/2026). PURO. Dias úteis = seg–sex,
 * como o expediente existente, sem calendário de feriados.
 *
 * Proposta (decisão de 28/10/2026, docs/PRUMO-DECISOES-PM-2026-10-28.md, "Proposta"): a validade é de
 * 10 dias corridos, contando o dia do envio (do D+0 ao D+9), e é condição, não promoção. Três toques,
 * cada um com um objetivo: D+1 útil (a dúvida e quem mais decide), D+4 úteis (10 minutos com quem
 * decide junto) e D+8 corridos (a validade e o encerramento honesto). No D+10 corrido, sem resposta
 * de gente, o lead vai para Perdido com o motivo "sumiu" (motivos-de-perda.ts). Antes eram o 1º e o
 * 3º dia útil, e as propostas do ciclo comercial (proposta versionada) ficavam fora da cadência: o
 * lead esperava a decisão sem nenhum toque e sem fim.
 *
 * Conversa: um toque no 2º dia útil depois da nossa resposta e revisão humana no 7º dia corrido.
 */
import { contatoPausado } from './aprendizado-comercial'
import { cicloDoLead, ultimoEnvioDaProposta } from './ciclo-comercial'
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

/** Dias corridos de validade da proposta, contando o dia do envio; no D+10 ela vence e o lead sai. */
export const VALIDADE_DA_PROPOSTA_DIAS = 10
/** Os degraus da proposta, na ordem: D+1 útil, D+4 úteis, D+8 corridos. */
export const DEGRAUS_DA_PROPOSTA = ['dia-1', 'dia-4', 'dia-8'] as const
export type DegrauDaProposta = typeof DEGRAUS_DA_PROPOSTA[number]
/**
 * 'dia-3' é o último toque da cadência antiga (até 28/10/2026). Continua legível, porque a aba CRM
 * guarda o histórico e nunca se reescreve; nunca é pedido de novo, e confirmado vale como o toque do
 * 4º dia útil, para quem o recebeu ontem não receber outro hoje.
 */
type DegrauAntigoDaProposta = 'dia-3'
const DEGRAUS_LEGIVEIS_DA_PROPOSTA: readonly string[] = [...DEGRAUS_DA_PROPOSTA, 'dia-3']

/** O degrau da proposta em que o lead está hoje: só o atual vale; um toque perdido não se acumula. */
export function degrauDaProposta(base: number, agora: number): DegrauDaProposta | 'expirar' | null {
  const corridos = diaDaCadencia(agora) - diaDaCadencia(base)
  if (corridos >= VALIDADE_DA_PROPOSTA_DIAS) return 'expirar'
  if (corridos >= 8) return 'dia-8'
  const uteis = diasUteisDaCadencia(base, agora)
  return uteis >= 4 ? 'dia-4' : uteis >= 1 ? 'dia-1' : null
}

/** "24/10": o último dia de validade (D+9), o que o toque do 8º dia diz ao lead. */
export function validadeDaProposta(base: number): string {
  const ultimo = new Date((diaDaCadencia(base) + VALIDADE_DA_PROPOSTA_DIAS - 1) * DIA)
  return `${String(ultimo.getUTCDate()).padStart(2, '0')}/${String(ultimo.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface ToqueDaProposta {
  titulo: (empresa: string) => string
  contexto: (validade: string) => string
  porque: string
  tatica: string
  /** A mensagem pronta: uma pergunta, sem preço, sem "R$" e sem link novo. */
  mensagem: (validade: string) => string
  /** O que a linha do tempo diz depois do "Enviei". */
  confirmado: string
}
/** Os textos de cada toque, pelo objetivo do degrau. Quem monta o passo é proxima-venda.ts. */
export const TOQUES_DA_PROPOSTA: Readonly<Record<DegrauDaProposta, ToqueDaProposta>> = {
  'dia-1': {
    titulo: empresa => `Peça retorno da proposta de ${empresa}`,
    contexto: () => 'Proposta: 1º dia útil',
    porque: 'Um dia útil depois da proposta: a dúvida que ele ainda não falou e quem mais decide.',
    tatica: 'Uma pergunta só: a dúvida e quem decide junto. Sem reenviar preço nem link.',
    mensagem: () => 'Oi! Conseguiu olhar a proposta? Ficou alguma dúvida, ou tem mais alguém que decide junto com você?',
    confirmado: 'Primeiro retorno da proposta confirmado.',
  },
  'dia-4': {
    titulo: empresa => `Convide ${empresa} para 10 minutos com quem decide`,
    contexto: () => 'Proposta: 4º dia útil',
    porque: 'Quatro dias úteis sem decisão: 10 minutos com quem decide junto destravam mais que outra mensagem.',
    tatica: 'Proponha 10 minutos com quem decide junto e peça dia e horário. Sem reenviar preço nem link.',
    mensagem: () => 'Oi! Que tal 10 minutos de conversa, com você e quem decide junto, para tirar as dúvidas da proposta? Me diga um dia e horário que fica bom.',
    confirmado: 'Convite para 10 minutos com quem decide confirmado.',
  },
  'dia-8': {
    titulo: empresa => `Lembre a validade da proposta de ${empresa}`,
    contexto: validade => `Proposta: 8º dia, vale até ${validade}`,
    porque: 'A proposta vale 10 dias corridos. No 8º dia, dizer a validade e oferecer encerrar é o toque honesto.',
    tatica: 'Diga a validade como condição, não como promoção, e ofereça encerrar sem pressão. Sem preço nem link.',
    mensagem: validade => `Oi! Passando para lembrar que a proposta vale até ${validade}. Se não for o momento, tudo bem: me avise e eu encerro por aqui. Se ainda fizer sentido, o que falta para você decidir?`,
    confirmado: 'Aviso da validade da proposta confirmado.',
  },
}

export interface RegistroDeCadencia {
  versao: 1
  tipo: 'proposta' | 'conversa'
  origem: string
  degrau: DegrauDaProposta | DegrauAntigoDaProposta | 'dia-2'
  /** Conversa: a saída original, preservada mesmo depois de enviar o toque. */
  base?: string
}
export function lerRegistroCadencia(texto: unknown): RegistroDeCadencia | null {
  if (typeof texto !== 'string' || texto.length > 1000) return null
  try {
    const v = JSON.parse(texto)
    if (!v || Array.isArray(v) || v.versao !== 1 || !['proposta', 'conversa'].includes(v.tipo)
      || typeof v.origem !== 'string' || !Number.isFinite(instante(v.origem))
      || (v.tipo === 'proposta' ? !DEGRAUS_LEGIVEIS_DA_PROPOSTA.includes(v.degrau) : v.degrau !== 'dia-2' || typeof v.base !== 'string' || !Number.isFinite(instante(v.base)))
      || Object.keys(v).some(k => !['versao','tipo','origem','degrau','base'].includes(k))) return null
    return { versao: 1, tipo: v.tipo, origem: v.origem, degrau: v.degrau, ...(v.tipo === 'conversa' ? { base: v.base } : {}) }
  } catch { return null }
}
export function textoDoRegistroCadencia(v: RegistroDeCadencia): string {
  const texto = JSON.stringify(v)
  if (!lerRegistroCadencia(texto)) throw new Error('Confirmação de cadência inválida.')
  return texto
}
/** A linha do tempo do toque confirmado; o degrau antigo mantém o texto que tinha. */
export function textoDaCadenciaConfirmada(v: RegistroDeCadencia | null): string {
  if (v?.tipo === 'conversa') return 'Retomada da conversa confirmada.'
  if (v?.degrau === 'dia-3') return 'Último retorno da proposta confirmado.'
  const degrau = (DEGRAUS_DA_PROPOSTA as readonly string[]).includes(v?.degrau ?? '') ? v!.degrau as DegrauDaProposta : 'dia-1'
  return TOQUES_DA_PROPOSTA[degrau].confirmado
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

/**
 * A proposta que a cadência acompanha. Com o ciclo comercial (proposta versionada) é a última versão
 * enviada, só enquanto espera a decisão: com aceite ou recebimento a negociação já decidiu, e com
 * histórico incoerente (`problemas`) ninguém cobra antes de o Rômulo revisar. Ciclo sem envio
 * (proposta em rascunho) não tem cadência nenhuma, nem a da conversa: é o caminho comercial que guia.
 * `undefined` = sem ciclo, vale `lead.proposta`; `null` = sem cadência.
 */
function propostaDoCiclo(lead: LeadDaCadencia, agora: number): { em: string; data?: string } | null | undefined {
  const ciclo = cicloDoLead(lead, agora)
  if (!ciclo.historico.length) return undefined
  if (ciclo.problemas.length || ciclo.aceites.length || ciclo.recebido) return null
  return ultimoEnvioDaProposta(lead, agora) ?? null
}

export function cadenciaDoLead(lead: LeadDaCadencia, agora: number): CadenciaDoLead | null {
  // Uma recusa ainda sem marca humana é desfecho, nunca uma nova cobrança.
  if (lead.perdaManual || ['negativa', 'exclusao'].includes(lead.resposta?.tipo ?? '')
    || !['contato', 'proposta'].includes(lead.etapa)) return null
  const doCiclo = propostaDoCiclo(lead, agora)
  if (doCiclo === null) return null
  const proposta = doCiclo ?? lead.proposta
  const humana = Math.max(instante(lead.conversa?.ultimaEntrada) || 0,
    lead.resposta?.tipo !== 'bot' ? instante(lead.resposta?.em) || 0 : 0, instante(lead.marcos.respondeu) || 0)
  const futuro = lead.proximoPasso?.data && instante(`${lead.proximoPasso.data}T12:00:00-03:00`)
  const preservar = contatoPausado(lead) || Boolean(futuro && diaDaCadencia(futuro) > diaDaCadencia(agora))
  const registros = (lead.eventos ?? []).filter(e => e.tipo === 'cadencia_enviada' && e.origem === 'manual' && instante(e.em) <= agora)
    .map(e => lerRegistroCadencia(e.registroTexto ?? e.texto)).filter((v): v is RegistroDeCadencia => !!v)
  if (lead.etapa === 'proposta' && proposta) {
    const origem = proposta.em
    const base = proposta.data ? instante(`${proposta.data}T12:00:00-03:00`) : instante(origem)
    if (!Number.isFinite(base)) return null
    const r: CadenciaDoLead = { tipo: 'proposta', origem, base, estado: 'aguardar' }
    const anotado = instante(origem)
    const corteDaResposta = diaDaCadencia(anotado) === diaDaCadencia(base) ? anotado : diaDaCadencia(base) * DIA + 3 * 3600_000
    if (preservar || humana > corteDaResposta) return { ...r, estado: 'preservar' }
    const degrau = degrauDaProposta(base, agora)
    if (degrau === 'expirar') return { ...r, estado: 'expirar' }
    const feito = (v: RegistroDeCadencia) => v.tipo === 'proposta' && v.origem === origem && (v.degrau === degrau || (degrau === 'dia-4' && v.degrau === 'dia-3'))
    if (!degrau || registros.some(feito)) return r
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
