/**
 * PURO: o que a Hoje mostra e em que ordem (RULES 13). Sem Vue, sem relógio e
 * sem `fetch`: o componente injeta `agora` e os dados lidos.
 *
 * Regra que atravessa o arquivo: estado de agente só com fonte. Quem não tem
 * pedido em andamento nem agenda lida está `sem_sinal`, por extenso — nunca
 * "ocioso" ou "trabalhando" inventado pela tela.
 */
import type { AlertasDaHome } from '../operations/alertas'
import type { CrmContagem, CrmEtapa, DellCheck } from '../operations/types'
import type { QuestCalendario } from '../types'
import { questTerminou } from '../mochila'

/** Mais de 3 cartões numa tela de celular vira lista que ninguém lê (RULES 13). */
export const MAX_NA_HOJE = 3

export type Pendencia =
  | { chave: string; tipo: 'dell'; check: DellCheck }
  | { chave: string; tipo: 'troca'; id: string }
  | { chave: string; tipo: 'ajuste'; id: string }
  | { chave: string; tipo: 'crescimento'; id: string }

export interface CartoesDosAgentes {
  trocas: string[]
  ajustes: string[]
  crescimentos: string[]
}

/**
 * Tudo o que espera o Rômulo, do mais grave ao menos: falha do Dell (quebrado
 * agora), a demanda que nenhuma squad quis (não foi atendida), o ajuste e a
 * contratação propostos, a fila de trabalho do CRM e o "vale olhar". Quem
 * mostra corta em MAX_NA_HOJE; o resto fica atrás de "ver todos".
 */
export function pendenciasDaHoje(alertas: AlertasDaHome | null, cartoes: CartoesDosAgentes): Pendencia[] {
  const dell = (lista: DellCheck[] | undefined): Pendencia[] =>
    (lista ?? []).map((check) => ({ chave: `dell:${check.id}`, tipo: 'dell', check }))
  return [
    ...dell(alertas?.falhas),
    ...cartoes.trocas.map<Pendencia>((id) => ({ chave: `troca:${id}`, tipo: 'troca', id })),
    ...cartoes.ajustes.map<Pendencia>((id) => ({ chave: `ajuste:${id}`, tipo: 'ajuste', id })),
    ...cartoes.crescimentos.map<Pendencia>((id) => ({ chave: `crescimento:${id}`, tipo: 'crescimento', id })),
    ...dell(alertas?.fila),
    ...dell(alertas?.olhar),
  ]
}

/** Instante que ordena uma quest: o prazo de um marco, o início do resto. */
export function referenciaDaQuest(q: QuestCalendario): number {
  return Date.parse(q.tipo === 'deadline' ? q.fim : q.inicio)
}

/** As próximas `n` quests que ainda não terminaram, a mais próxima primeiro. */
export function proximasQuests(quests: QuestCalendario[], agora: number, n: number): QuestCalendario[] {
  return quests
    .filter((q) => !questTerminou(q, agora))
    .sort((a, b) => referenciaDaQuest(a) - referenciaDaQuest(b) || a.titulo.localeCompare(b.titulo, 'pt-BR'))
    .slice(0, Math.max(0, n))
}

// ---------------------------------------------------------------- time

export type EstadoDaSquad = 'atendendo' | 'com_agenda' | 'livre' | 'sem_sinal'

export const ROTULO_DO_ESTADO_DA_SQUAD: Record<EstadoDaSquad, string> = {
  atendendo: 'Atendendo',
  com_agenda: 'Com agenda',
  livre: 'Agenda livre',
  sem_sinal: 'Sem sinal',
}

export interface ContextoDoTime {
  /** Squad do turno em andamento nesta aba; null sem turno. */
  turnoSquadId: string | null
  /** Squad cuja Mochila foi lida com sucesso (só a ativa é lida); null sem leitura. */
  mochilaDe: string | null
  /** A quest mais próxima da squad lida. */
  proxima: QuestCalendario | null
}

/**
 * Uma linha por squad, com o que se sabe dela e de onde vem. Só a squad ativa
 * tem a agenda lida; as outras ficam `sem_sinal` fora de um pedido.
 */
export function estadoDaSquad(squadId: string, ctx: ContextoDoTime): { estado: EstadoDaSquad; detalhe: string } {
  if (ctx.turnoSquadId === squadId) return { estado: 'atendendo', detalhe: 'Um pedido seu está rodando nesta squad agora.' }
  if (ctx.mochilaDe === squadId) {
    return ctx.proxima
      ? { estado: 'com_agenda', detalhe: `Próximo na agenda: ${ctx.proxima.titulo}` }
      : { estado: 'livre', detalhe: 'Nada marcado pela frente na agenda.' }
  }
  return { estado: 'sem_sinal', detalhe: 'Sem pedido em andamento e sem agenda lida: não dá para saber o que faz agora.' }
}

export type EstadoDaPessoa = 'em_bloco' | 'proximo' | 'responsavel' | 'sem_sinal'

export const ROTULO_DO_ESTADO_DA_PESSOA: Record<EstadoDaPessoa, string> = {
  em_bloco: 'Em bloco agora',
  proximo: 'Tem compromisso',
  responsavel: 'Último pedido',
  sem_sinal: 'Sem sinal',
}

export interface ContextoDaPessoa {
  /** Quests da squad desta pessoa, só quando a Mochila dela foi lida; [] senão. */
  quests: QuestCalendario[]
  /** Responsável pelo último pedido atendido nesta aba ('Idle' ou '' sem pedido). */
  responsavelId: string
  agora: number
}

/**
 * Estado de uma pessoa, só com fonte: a agenda lida (bloco em curso ou o
 * próximo dela) ou o último pedido desta aba. O resto é `sem_sinal`.
 */
export function estadoDaPessoa(pessoaId: string, ctx: ContextoDaPessoa): { estado: EstadoDaPessoa; texto: string } {
  const dela = ctx.quests.filter((q) => q.membro === pessoaId && !questTerminou(q, ctx.agora))
  const agoraNoBloco = dela.find(
    (q) => q.tipo !== 'deadline' && !q.diaInteiro && Date.parse(q.inicio) <= ctx.agora && ctx.agora < Date.parse(q.fim)
  )
  if (agoraNoBloco) return { estado: 'em_bloco', texto: `Em bloco agora: ${agoraNoBloco.titulo}` }
  if (ctx.responsavelId && ctx.responsavelId === pessoaId) return { estado: 'responsavel', texto: 'Responsável pelo último pedido' }
  const proxima = proximasQuests(dela, ctx.agora, 1)[0]
  if (proxima) return { estado: 'proximo', texto: `Próximo: ${proxima.titulo}` }
  return { estado: 'sem_sinal', texto: 'Sem sinal' }
}

// ---------------------------------------------------------------- funil

const ABERTAS: Array<[CrmEtapa, string, string]> = [
  ['novo', 'novo', 'novos'],
  ['contatado', 'contatado', 'contatados'],
  ['conversando', 'conversando', 'conversando'],
  ['proposta', 'em proposta', 'em proposta'],
]

/** "3 novos · 5 contatados · 2 conversando · 1 em proposta": só as etapas abertas, com número. */
export function resumoDoFunil(contagens: Partial<Record<CrmEtapa, CrmContagem>> | null | undefined): string {
  if (!contagens) return ''
  const partes = ABERTAS.map(([etapa, um, varios]) => {
    const n = contagens[etapa]?.total ?? 0
    return `${n} ${n === 1 ? um : varios}`
  })
  const abertos = ABERTAS.reduce((soma, [etapa]) => soma + (contagens[etapa]?.total ?? 0), 0)
  return abertos ? partes.join(' · ') : 'Nenhum lead em aberto'
}
