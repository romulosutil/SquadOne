/**
 * PURO: o que a Hoje mostra e em que ordem (RULES 13). Sem Vue, sem relógio e
 * sem `fetch`: o componente injeta `agora` e os dados lidos.
 *
 * Regra que atravessa o arquivo: estado de agente só com fonte. Quem não tem
 * pedido em andamento nem agenda lida está `sem_sinal`, por extenso — nunca
 * "ocioso" ou "trabalhando" inventado pela tela.
 */
import type { AlertasDaHome } from '../operations/alertas'
import type { CrmContagem, CrmEtapa, CrmProduto, CrmVisao, DellCheck } from '../operations/types'
import type { EstadoDasFinancas, Semaforo } from '../office/salaFinancas'
import type { QuestCalendario } from '../types'
import { questTerminou } from '../mochila'

/** Mais de 3 cartões numa tela de celular vira lista que ninguém lê (RULES 13). */
export const MAX_NA_HOJE = 3

export type PendenciaDeFinancas = {
  chave: 'financas:cartao' | 'financas:orcamento'
  tipo: 'financas'
  pct: number
  semaforo: Semaforo
  /** Só no cartão: o nome do banco, não onde se gastou (RULES 24). */
  nome?: string
  /** "Dados até" da leitura: número sem data é número que mente (design.md, 4). */
  dadosAte?: string | null
}

/**
 * Leads que responderam e esperam o Rômulo (o grupo "Respostas para responder" do CRM).
 * O destaque é o que espera há mais tempo, o primeiro da lista do servidor.
 */
export type PendenciaDeRespostas = {
  chave: 'crm:respostas'
  tipo: 'respostas'
  quantos: number
  /** Quantos disseram que querem ver (resposta classificada como interesse). */
  interesse: number
  primeiro: { empresa: string; produto: CrmProduto; trecho?: string; respondeuEm?: string }
}

export type Pendencia =
  | { chave: string; tipo: 'dell'; check: DellCheck }
  | { chave: string; tipo: 'troca'; id: string }
  | { chave: string; tipo: 'ajuste'; id: string }
  | { chave: string; tipo: 'crescimento'; id: string }
  | PendenciaDeRespostas
  | PendenciaDeFinancas

export interface CartoesDosAgentes {
  trocas: string[]
  ajustes: string[]
  crescimentos: string[]
}

/** O que `/api/financas/estado` devolve: só % e semáforo, nunca R$. */
export type EstadoDasFinancasLido = EstadoDasFinancas & { dadosAte?: string | null }

/**
 * Só laranja (≥ 90 %) e vermelho (≥ 100 %) sobem para a Hoje. O amarelo (70 %)
 * já foi ao WhatsApp e fica na aba Finanças: na Hoje ele ocuparia um dos três
 * lugares por semanas, o mês inteiro acima de 70 %, e empurraria para baixo do
 * corte o que precisa de gesto agora.
 */
const SOBE_PARA_A_HOJE: ReadonlySet<Semaforo> = new Set<Semaforo>(['laranja', 'vermelho'])
const GRAVIDADE: Record<Semaforo, number> = { verde: 0, amarelo: 1, laranja: 2, vermelho: 3 }

export function pendenciasDeFinancas(estado: EstadoDasFinancasLido | null | undefined): PendenciaDeFinancas[] {
  if (!estado) return []
  const dadosAte = estado.dadosAte ?? null
  const saida: PendenciaDeFinancas[] = []
  if (estado.cartao && SOBE_PARA_A_HOJE.has(estado.cartao.semaforo)) {
    const { pct, semaforo, nome } = estado.cartao
    saida.push({ chave: 'financas:cartao', tipo: 'financas', pct, semaforo, ...(nome ? { nome } : {}), dadosAte })
  }
  if (estado.orcamento && SOBE_PARA_A_HOJE.has(estado.orcamento.semaforo)) {
    const { pct, semaforo } = estado.orcamento
    saida.push({ chave: 'financas:orcamento', tipo: 'financas', pct, semaforo, dadosAte })
  }
  // O vermelho na frente; empate fica cartão, orçamento (sort estável).
  return saida.sort((a, b) => GRAVIDADE[b.semaforo] - GRAVIDADE[a.semaforo])
}

/** "Cartão Nubank: 92% do limite" / "Orçamento do mês: 104%". Sem R$ nem estabelecimento. */
export function textoDaPendenciaDeFinancas(p: PendenciaDeFinancas): string {
  if (p.chave === 'financas:cartao') return `Cartão${p.nome ? ` ${p.nome}` : ''}: ${p.pct}% do limite`
  return `Orçamento do mês: ${p.pct}%`
}

/**
 * O cartão "responderam e esperam você" (08/10/2026), do retrato do CRM que a Hoje já lê.
 * Até então a única chamada era o aviso do Hermes na hora da resposta: quem não respondia
 * logo só via o lead de novo abrindo o CRM, e resposta de lead esfria em horas.
 */
export function pendenciaDeRespostas(visao: CrmVisao | null | undefined): PendenciaDeRespostas | null {
  if (!visao || visao.estado !== 'ok') return null
  const porId = new Map(visao.leads.map((l) => [l.id, l]))
  const leads = (visao.hoje.find((g) => g.id === 'resposta')?.itens ?? [])
    .map((i) => porId.get(i.leadId))
    .filter((l): l is NonNullable<typeof l> => Boolean(l))
  const primeiro = leads[0]
  if (!primeiro) return null
  const trecho = primeiro.resposta && primeiro.resposta.tipo !== 'bot' ? primeiro.resposta.trecho : ''
  return {
    chave: 'crm:respostas',
    tipo: 'respostas',
    quantos: leads.length,
    interesse: leads.filter((l) => l.resposta?.tipo === 'interesse').length,
    primeiro: {
      empresa: primeiro.empresa,
      produto: primeiro.produto,
      ...(trecho ? { trecho } : {}),
      ...(primeiro.marcos.respondeu ? { respondeuEm: primeiro.marcos.respondeu } : {}),
    },
  }
}

/** Título e linha do cartão: quem espera e o que disse; sem trecho, só o nome. */
export function textoDaPendenciaDeRespostas(p: PendenciaDeRespostas): { titulo: string; detalhe: string } {
  const titulo = p.quantos === 1 ? `${p.primeiro.empresa} respondeu e espera você` : `${p.quantos} leads responderam e esperam você`
  const quem = p.quantos === 1 ? '' : `${p.primeiro.empresa}${p.primeiro.trecho ? ': ' : ''}`
  const disse = p.primeiro.trecho ? `“${p.primeiro.trecho}”` : ''
  const querem = p.interesse === 0 ? '' : p.interesse === 1 ? '1 quer ver' : `${p.interesse} querem ver`
  return { titulo, detalhe: [`${quem}${disse}`, querem].filter(Boolean).join(' · ') }
}

/**
 * Tudo o que espera o Rômulo, do mais grave ao menos: falha do Dell (quebrado
 * agora), a demanda que nenhuma squad quis (não foi atendida), o ajuste e a
 * contratação propostos, os leads que responderam, o alerta de finanças em
 * semáforo (≥ 90 %), a fila de trabalho do CRM e o "vale olhar". Quem mostra
 * corta em MAX_NA_HOJE; o resto fica atrás de "ver todos".
 *
 * Finanças depois dos cartões dos agentes: o cartão de decisão some se a aba
 * recarregar (vive na memória dela), o semáforo das finanças continua lá. As
 * respostas de lead vêm antes das finanças: esfriam em horas, o semáforo dura o mês.
 */
export function pendenciasDaHoje(
  alertas: AlertasDaHome | null,
  cartoes: CartoesDosAgentes,
  financas: EstadoDasFinancasLido | null = null,
  respostas: PendenciaDeRespostas | null = null
): Pendencia[] {
  const dell = (lista: DellCheck[] | undefined): Pendencia[] =>
    (lista ?? []).map((check) => ({ chave: `dell:${check.id}`, tipo: 'dell', check }))
  return [
    ...dell(alertas?.falhas),
    ...cartoes.trocas.map<Pendencia>((id) => ({ chave: `troca:${id}`, tipo: 'troca', id })),
    ...cartoes.ajustes.map<Pendencia>((id) => ({ chave: `ajuste:${id}`, tipo: 'ajuste', id })),
    ...cartoes.crescimentos.map<Pendencia>((id) => ({ chave: `crescimento:${id}`, tipo: 'crescimento', id })),
    ...(respostas ? [respostas] : []),
    ...pendenciasDeFinancas(financas),
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

/** Espelho de `RespostaDoTime` (`server/time.ts`), o que `GET /api/time` devolve. */
export interface TimeDaSquadLido {
  id: string
  emBlocoAgora: { pessoaId: string; titulo: string }[]
  /** `inicio` é o prazo num marco. */
  proxima: { titulo: string; inicio: string; pessoaId: string } | null
}
export interface TimeLido {
  /** Só as squads cujo calendário foi lido; as outras estão em `erros`. */
  squads: TimeDaSquadLido[]
  lidoEm: string
  erros: { squadId: string; erro: string }[]
}

export interface ContextoDoTime {
  /** Squad do turno em andamento nesta aba; null sem turno. */
  turnoSquadId: string | null
  /** Squad cuja Mochila foi lida com sucesso (só a ativa é lida); null sem leitura. */
  mochilaDe: string | null
  /** A quest mais próxima da squad lida. */
  proxima: QuestCalendario | null
  /** A última leitura de `/api/time` (todas as squads ativas); null/ausente sem leitura. */
  time?: TimeLido | null
  /** Por que `/api/time` não foi lido ('' ou ausente sem falha): vira o motivo do `sem_sinal`. */
  erroDoTime?: string
  /** Nome de quem está em bloco; sem ele, o id (melhor que nada, e nunca inventado). */
  nomeDaPessoa?: (pessoaId: string) => string
}

export interface EstadoDaSquadNaHoje {
  estado: EstadoDaSquad
  detalhe: string
  /** "Em bloco agora: Ana — Revisar contrato", uma por bloco em curso. */
  emBloco: string[]
  /** Quando o Google foi lido para esta linha (`/api/time`); null sem essa leitura. */
  lidoEm: string | null
}

const SEM_SINAL = 'Sem pedido em andamento e sem agenda lida: não dá para saber o que faz agora.'

/**
 * Uma linha por squad, com o que se sabe dela e de onde vem, nesta ordem:
 * o turno desta aba (`atendendo`) > a agenda lida — a Mochila da ativa ou o
 * `/api/time` de todas — (`com_agenda`/`livre`) > `sem_sinal`, com o motivo
 * da falha quando houve uma. Squad que nenhuma leitura cobriu nunca é "livre":
 * agenda não lida não é agenda vazia (RULES 2).
 */
export function estadoDaSquad(squadId: string, ctx: ContextoDoTime): EstadoDaSquadNaHoje {
  const lida = ctx.time?.squads.find((s) => s.id === squadId) ?? null
  const nome = ctx.nomeDaPessoa ?? ((id: string) => id)
  const emBloco = (lida?.emBlocoAgora ?? []).map((b) => `Em bloco agora: ${nome(b.pessoaId)} — ${b.titulo}`)
  const lidoEm = lida ? ctx.time!.lidoEm : null
  const comFonte = { emBloco, lidoEm }

  if (ctx.turnoSquadId === squadId) {
    return { estado: 'atendendo', detalhe: 'Um pedido seu está rodando nesta squad agora.', ...comFonte }
  }
  // A Mochila da ativa vai 90 dias à frente e o /api/time só 7: para "o
  // próximo", a Mochila manda quando existe.
  const daMochila = ctx.mochilaDe === squadId
  if (daMochila || lida) {
    const proxima = daMochila ? ctx.proxima?.titulo : lida!.proxima?.titulo
    if (proxima) return { estado: 'com_agenda', detalhe: `Próximo na agenda: ${proxima}`, ...comFonte }
    if (emBloco.length) return { estado: 'com_agenda', detalhe: 'Nada marcado depois do bloco em curso.', ...comFonte }
    return { estado: 'livre', detalhe: 'Nada marcado pela frente na agenda.', ...comFonte }
  }
  const falha = ctx.time?.erros.find((e) => e.squadId === squadId)?.erro || ctx.erroDoTime
  return { estado: 'sem_sinal', detalhe: falha ? `Agenda não lida: ${falha}` : SEM_SINAL, ...comFonte }
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
  ['contato', 'em contato', 'em contato'],
  ['proposta', 'em proposta', 'em proposta'],
]

/** "3 novos · 7 em contato · 1 em proposta": só as etapas abertas, com número. */
export function resumoDoFunil(contagens: Partial<Record<CrmEtapa, CrmContagem>> | null | undefined): string {
  if (!contagens) return ''
  const partes = ABERTAS.map(([etapa, um, varios]) => {
    const n = contagens[etapa]?.total ?? 0
    return `${n} ${n === 1 ? um : varios}`
  })
  const abertos = ABERTAS.reduce((soma, [etapa]) => soma + (contagens[etapa]?.total ?? 0), 0)
  return abertos ? partes.join(' · ') : 'Nenhum lead em aberto'
}
