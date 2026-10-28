/**
 * PURO (o storage entra por parâmetro): o "cohort como consulta" da Triagem (17/10/2026).
 *
 * A Triagem trabalha em lotes de 10 (triagem.ts, AC-10), mas com ~1.400 prospects parados a ordem do
 * caçador não diz QUEM convidar primeiro. A ideia vem do Harvey (github.com/ethanplusai/harvey, MIT):
 * em vez de uma nota por lead, quem decide escreve o que o lead DEVE ter e o que o DESQUALIFICA, e a
 * tela conta os que batem, ao vivo ("roda Google Ads E não tem agendamento online → 23"). Cada lead
 * da lista leva o motivo à vista.
 *
 * O cohort só FILTRA quais leads entram nos lotes. Não envia, não dispensa, não pula trava: o
 * Convidar segue com as travas de horário e de ritmo, o Dispensar com o Desfazer de 8 s.
 *
 * Honestidade (estado só com fonte, nunca inventado): cada critério vale `true`, `false` ou `null`
 * (sem leitura). Lead sem leitura de um critério NÃO bate nem é desqualificado por ele: se nada mais
 * o tira, vai para `semLeitura`, à parte, e a tela diz "N sem leitura". Os sinais do site
 * (`lead.sinais`) são opcionais: sem nenhum lead com leitura, a tela nem oferece o critério.
 *
 * `localStorage` pode lançar (modo privado, storage bloqueado): sem ele o filtro só não sobrevive
 * ao reload.
 */
import { SIGLA_DO_PRODUTO } from './crm-formato'
import type { Guardador } from './guardador'
import { PASSOS, passoAtual, type IdDoPasso, type LeadDaJornada } from './jornada'
import type { CrmLead, CrmProduto } from './types'
import { ehProduto } from '../../server/ofertas.ts'

// ------------------------------------------------------------------ o contrato dos sinais

/**
 * CONTRATO COMPARTILHADO com o servidor (trabalhador W1, server/sinais-do-site*.ts e server/crm.ts):
 * `lead.sinais` é opcional e cada chave é `true`, `false` ou `null`/ausente (= sem leitura).
 * O sentido é o do nome: `semSchema: true` quer dizer que o site NÃO tem dados estruturados.
 * Quem acrescentar a chave no servidor acrescenta aqui e em SINAIS (uma frase por chave).
 */
export type ChaveDeSinal = 'temAgencia' | 'rodandoGoogleAds' | 'rodandoMetaAds' | 'semAgendamentoOnline' | 'semSchema' | 'blogParado' | 'semSite'
export type SinaisDoLead = Partial<Record<ChaveDeSinal, boolean | null>>

/** Dois textos por sinal: o que a leitura `true` diz e o que a `false` diz (nunca "não X" montado por regra). */
export const SINAIS: Record<ChaveDeSinal, { verdadeiro: string; falso: string }> = {
  temAgencia: { verdadeiro: 'tem agência', falso: 'não tem agência' },
  rodandoGoogleAds: { verdadeiro: 'roda Google Ads', falso: 'não roda Google Ads' },
  rodandoMetaAds: { verdadeiro: 'roda anúncios no Meta', falso: 'não roda anúncios no Meta' },
  semAgendamentoOnline: { verdadeiro: 'não tem agendamento online', falso: 'tem agendamento online' },
  semSchema: { verdadeiro: 'não tem dados estruturados (schema)', falso: 'tem dados estruturados (schema)' },
  blogParado: { verdadeiro: 'tem blog parado', falso: 'não tem blog parado' },
  semSite: { verdadeiro: 'não tem site (leitura do site)', falso: 'tem site (leitura do site)' },
}
export const CHAVES_DE_SINAL = Object.keys(SINAIS) as ChaveDeSinal[]

/** O pedaço do lead que o cohort lê. Um CrmLead serve; `sinais` só chega quando o servidor o mandar. */
export type LeadDoCohort = LeadDaJornada & Pick<CrmLead, 'nicho' | 'cidade'> & Partial<Pick<CrmLead, 'triagem'>> & { sinais?: SinaisDoLead }

// ------------------------------------------------------------------ critérios

export type Criterio =
  | { tipo: 'oferta'; valor: CrmProduto }
  /** nicho e cidade guardam o texto como a tela o mostrou; o casamento ignora caixa e acento. */
  | { tipo: 'nicho'; valor: string }
  | { tipo: 'cidade'; valor: string }
  | { tipo: 'passo'; valor: IdDoPasso }
  /** Há link de site na planilha. É o que está cadastrado, não a leitura do site (essa é o sinal `semSite`). */
  | { tipo: 'temSite' }
  /** WhatsApp achado no site e confirmado: a origem não começa por "não confirmado" (como server/crm.ts). */
  | { tipo: 'whatsappPublicado' }
  /** Pontuação do caçador (0 a 100) de `minimo` para cima. */
  | { tipo: 'pontuacao'; minimo: number }
  | { tipo: 'sinal'; chave: ChaveDeSinal }

export interface Cohort { deve: Criterio[]; naoPode: Criterio[] }
export type ColunaDoCohort = keyof Cohort

export const cohortVazio = (): Cohort => ({ deve: [], naoPode: [] })
export const semCriterios = (c: Cohort) => c.deve.length === 0 && c.naoPode.length === 0

/** Cada pessoa tem um nicho e uma cidade: dois no "deve" nunca bateriam. */
const UM_SO_NO_DEVE: ReadonlySet<Criterio['tipo']> = new Set(['oferta', 'nicho', 'cidade', 'passo', 'pontuacao'])

/** Sem acento, sem caixa, sem espaço sobrando: "Clínica  Médica" e "clinica medica" são o mesmo nicho. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** A identidade de um critério (para alternar, tirar duplicata e usar de chave na tela). */
export function chaveDoCriterio(c: Criterio): string {
  switch (c.tipo) {
    case 'oferta': case 'passo': return `${c.tipo}:${c.valor}`
    case 'nicho': case 'cidade': return `${c.tipo}:${normalizar(c.valor)}`
    case 'pontuacao': return `pontuacao:${c.minimo}`
    case 'sinal': return `sinal:${c.chave}`
    default: return c.tipo
  }
}

const nomeDoPasso = (id: IdDoPasso) => PASSOS.find((p) => p.id === id)?.nome ?? id

/** O critério como afirmação ("roda Google Ads") e como negação ("não roda Google Ads"). */
export function fraseDoCriterio(c: Criterio, afirmado = true): string {
  switch (c.tipo) {
    case 'oferta': return afirmado ? `oferta ${SIGLA_DO_PRODUTO[c.valor]}` : `fora da oferta ${SIGLA_DO_PRODUTO[c.valor]}`
    case 'nicho': return afirmado ? `nicho ${c.valor}` : `fora do nicho ${c.valor}`
    case 'cidade': return afirmado ? `em ${c.valor}` : `fora de ${c.valor}`
    case 'passo': return afirmado ? `no passo ${nomeDoPasso(c.valor)}` : `fora do passo ${nomeDoPasso(c.valor)}`
    case 'temSite': return afirmado ? 'tem site cadastrado' : 'sem site cadastrado'
    case 'whatsappPublicado': return afirmado ? 'WhatsApp publicado no site' : 'sem WhatsApp publicado'
    case 'pontuacao': return afirmado ? `pontuação ${c.minimo} ou mais` : `pontuação abaixo de ${c.minimo}`
    case 'sinal': return afirmado ? SINAIS[c.chave].verdadeiro : SINAIS[c.chave].falso
  }
}

const maiuscula = (s: string) => (s ? s[0].toLocaleUpperCase('pt-BR') + s.slice(1) : s)

/** O rótulo curto do chip, que sempre afirma o critério (a coluna em que ele está diz se é "deve" ou "não pode"). */
export const rotuloDoCriterio = (c: Criterio) => maiuscula(fraseDoCriterio(c))

/**
 * `true` o lead satisfaz o critério, `false` não satisfaz, `null` sem leitura (nunca vira `false`).
 * Só os sinais, a pontuação, o nicho e a cidade podem não ter leitura; o resto sai de campos que o
 * retrato sempre traz.
 */
export function avaliarCriterio(lead: LeadDoCohort, c: Criterio): boolean | null {
  switch (c.tipo) {
    case 'oferta': return lead.produto === c.valor
    case 'nicho': return lead.nicho.trim() ? normalizar(lead.nicho) === normalizar(c.valor) : null
    case 'cidade': return lead.cidade.trim() ? normalizar(lead.cidade) === normalizar(c.valor) : null
    case 'passo': return passoAtual(lead) === c.valor
    case 'temSite': return Boolean(lead.links.site)
    case 'whatsappPublicado': return Boolean(lead.links.whatsapp) && !(lead.triagem?.origemWhatsapp ?? '').startsWith('não confirmado')
    case 'pontuacao': {
      const p = lead.triagem?.prioridade
      return typeof p === 'number' && Number.isFinite(p) ? p >= c.minimo : null
    }
    case 'sinal': {
      const leitura = lead.sinais?.[c.chave]
      return typeof leitura === 'boolean' ? leitura : null
    }
  }
}

// ------------------------------------------------------------------ aplicar

export interface ResultadoDoCohort<T> {
  /** Cumprem todos os "deve", não caem em nenhum "não pode" e têm leitura de tudo o que foi pedido. */
  batem: T[]
  /** Nada os tira, mas falta a leitura de algum critério pedido: talvez batam. Nunca entram em `batem`. */
  semLeitura: T[]
  /** Quantos leads foram avaliados. */
  total: number
}

/** Mesma ordem da entrada. Cohort vazio: todos batem. */
export function aplicarCohort<T extends LeadDoCohort>(leads: readonly T[], cohort: Cohort): ResultadoDoCohort<T> {
  const batem: T[] = []
  const semLeitura: T[] = []
  for (const lead of leads) {
    let fora = false
    let semLeituraDeAlgum = false
    for (const c of cohort.deve) {
      const r = avaliarCriterio(lead, c)
      if (r === false) { fora = true; break }
      if (r === null) semLeituraDeAlgum = true
    }
    if (!fora) {
      for (const c of cohort.naoPode) {
        const r = avaliarCriterio(lead, c)
        if (r === true) { fora = true; break }
        if (r === null) semLeituraDeAlgum = true
      }
    }
    if (fora) continue
    ;(semLeituraDeAlgum ? semLeitura : batem).push(lead)
  }
  return { batem, semLeitura, total: leads.length }
}

/**
 * Por que este lead está na lista, em frases: o que ele tem dos "deve" e o que ele NÃO tem dos "não
 * pode". Só faz sentido para quem bate (ou para quem não tem leitura: aí só entram as frases que
 * têm leitura). Sem critérios, vazio.
 */
export function motivosDoLead(lead: LeadDoCohort, cohort: Cohort): string[] {
  const motivos: string[] = []
  for (const c of cohort.deve) if (avaliarCriterio(lead, c) === true) motivos.push(fraseDoCriterio(c))
  for (const c of cohort.naoPode) if (avaliarCriterio(lead, c) === false) motivos.push(fraseDoCriterio(c, false))
  return motivos
}

/** O cohort por extenso, para o resumo do painel e para quem lê só o texto. */
export function descreverCohort(cohort: Cohort): string {
  if (semCriterios(cohort)) return 'Todos os prospects, sem filtro'
  const partes: string[] = []
  if (cohort.deve.length) partes.push(maiuscula(cohort.deve.map((c) => fraseDoCriterio(c)).join(' E ')))
  if (cohort.naoPode.length) partes.push(`${cohort.deve.length ? 'não' : 'Não'} pode: ${cohort.naoPode.map((c) => fraseDoCriterio(c)).join(' ou ')}`)
  return partes.join(' · ')
}

// ------------------------------------------------------------------ o que a tela oferece

export interface OpcaoComContagem<V> { valor: V; quantos: number }

export interface OpcoesDoCohort {
  ofertas: OpcaoComContagem<CrmProduto>[]
  nichos: OpcaoComContagem<string>[]
  cidades: OpcaoComContagem<string>[]
  passos: OpcaoComContagem<IdDoPasso>[]
  /** Os critérios que dividem o grupo (uns têm, outros não). Os que seriam sempre iguais não aparecem. */
  temSite: boolean
  whatsappPublicado: boolean
  /** Os limites de pontuação que separam alguém de alguém. */
  pontuacoes: number[]
  /** Só os sinais que algum lead tem lido: sem leitura em ninguém, a tela não oferece o critério. */
  sinais: ChaveDeSinal[]
}

export const LIMITES_DE_PONTUACAO = [50, 70, 90] as const

function contar<V>(valores: readonly V[], chave: (v: V) => string): OpcaoComContagem<V>[] {
  const mapa = new Map<string, OpcaoComContagem<V>>()
  for (const v of valores) {
    const k = chave(v)
    const atual = mapa.get(k)
    if (atual) atual.quantos++
    else mapa.set(k, { valor: v, quantos: 1 })
  }
  return [...mapa.values()].sort((a, b) => b.quantos - a.quantos || String(a.valor).localeCompare(String(b.valor), 'pt-BR'))
}

/**
 * O que vale a pena oferecer para este grupo de leads. Uma opção que só tem um valor em todo o grupo
 * (todos do mesmo nicho, todos com WhatsApp) não escolhe ninguém, então fica de fora.
 */
export function opcoesDoCohort(leads: readonly LeadDoCohort[]): OpcoesDoCohort {
  const varia = <V>(opcoes: OpcaoComContagem<V>[]) => (opcoes.length > 1 ? opcoes : [])
  const dividem = (f: (l: LeadDoCohort) => boolean) => { const n = leads.filter(f).length; return n > 0 && n < leads.length }
  const pontos = leads.map((l) => l.triagem?.prioridade).filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
  return {
    ofertas: varia(contar(leads.map((l) => l.produto), (p) => p)),
    nichos: varia(contar(leads.map((l) => l.nicho.trim()).filter(Boolean), normalizar)),
    cidades: varia(contar(leads.map((l) => l.cidade.trim()).filter(Boolean), normalizar)),
    passos: varia(contar(leads.map((l) => passoAtual(l)), (p) => p)),
    temSite: dividem((l) => Boolean(l.links.site)),
    whatsappPublicado: dividem((l) => avaliarCriterio(l, { tipo: 'whatsappPublicado' }) === true),
    pontuacoes: LIMITES_DE_PONTUACAO.filter((m) => pontos.some((p) => p >= m) && pontos.some((p) => p < m)),
    sinais: CHAVES_DE_SINAL.filter((k) => leads.some((l) => typeof l.sinais?.[k] === 'boolean')),
  }
}

// ------------------------------------------------------------------ editar

/**
 * Põe o critério na coluna. Ele sai da outra (dizer "deve" e "não pode" do mesmo critério é
 * contradição); no "deve", o que só pode ter um valor (nicho, cidade...) troca o anterior.
 */
export function adicionarCriterio(cohort: Cohort, coluna: ColunaDoCohort, criterio: Criterio): Cohort {
  const chave = chaveDoCriterio(criterio)
  const limpar = (lista: Criterio[]) => lista.filter((c) => chaveDoCriterio(c) !== chave)
  const outra: ColunaDoCohort = coluna === 'deve' ? 'naoPode' : 'deve'
  const destino = limpar(cohort[coluna]).filter((c) => !(coluna === 'deve' && UM_SO_NO_DEVE.has(criterio.tipo) && c.tipo === criterio.tipo))
  return { ...cohort, [outra]: limpar(cohort[outra]), [coluna]: [...destino, criterio] }
}

export function removerCriterio(cohort: Cohort, coluna: ColunaDoCohort, criterio: Criterio): Cohort {
  const chave = chaveDoCriterio(criterio)
  return { ...cohort, [coluna]: cohort[coluna].filter((c) => chaveDoCriterio(c) !== chave) }
}

/** O toque no chip: liga se estava desligado nesta coluna, desliga se estava ligado. */
export function alternarCriterio(cohort: Cohort, coluna: ColunaDoCohort, criterio: Criterio): Cohort {
  const chave = chaveDoCriterio(criterio)
  return cohort[coluna].some((c) => chaveDoCriterio(c) === chave) ? removerCriterio(cohort, coluna, criterio) : adicionarCriterio(cohort, coluna, criterio)
}

export const temCriterio = (cohort: Cohort, coluna: ColunaDoCohort, criterio: Criterio) =>
  cohort[coluna].some((c) => chaveDoCriterio(c) === chaveDoCriterio(criterio))

// ------------------------------------------------------------------ guardar

export const CHAVE_DO_COHORT = 'squadone:crm:triagem-cohort'

/** Um critério lido do disco: o que não bate com o formato é descartado, nunca adivinhado. */
function criterioLido(bruto: unknown): Criterio | null {
  if (!bruto || typeof bruto !== 'object') return null
  const c = bruto as Record<string, unknown>
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  switch (c.tipo) {
    case 'oferta': return ehProduto(c.valor) ? { tipo: 'oferta', valor: c.valor } : null
    case 'nicho': case 'cidade': { const v = texto(c.valor); return v ? { tipo: c.tipo, valor: v } : null }
    case 'passo': return PASSOS.some((p) => p.id === c.valor) ? { tipo: 'passo', valor: c.valor as IdDoPasso } : null
    case 'temSite': case 'whatsappPublicado': return { tipo: c.tipo }
    case 'pontuacao': return typeof c.minimo === 'number' && Number.isFinite(c.minimo) ? { tipo: 'pontuacao', minimo: c.minimo } : null
    case 'sinal': return CHAVES_DE_SINAL.includes(c.chave as ChaveDeSinal) ? { tipo: 'sinal', chave: c.chave as ChaveDeSinal } : null
    default: return null
  }
}

export function lerCohort(storage: Guardador | null | undefined): Cohort {
  try {
    const bruto = JSON.parse(storage?.getItem(CHAVE_DO_COHORT) ?? 'null') as { deve?: unknown; naoPode?: unknown } | null
    if (!bruto || typeof bruto !== 'object') return cohortVazio()
    const lista = (v: unknown) => (Array.isArray(v) ? v.map(criterioLido).filter((c): c is Criterio => c !== null) : [])
    // Pelas funções de edição, para a leitura obedecer às mesmas regras (sem repetido, sem contradição).
    let cohort = cohortVazio()
    for (const c of lista(bruto.deve)) cohort = adicionarCriterio(cohort, 'deve', c)
    for (const c of lista(bruto.naoPode)) if (!temCriterio(cohort, 'deve', c)) cohort = adicionarCriterio(cohort, 'naoPode', c)
    return cohort
  } catch {
    return cohortVazio()
  }
}

export function gravarCohort(storage: Guardador | null | undefined, cohort: Cohort): void {
  try {
    storage?.setItem(CHAVE_DO_COHORT, JSON.stringify(cohort))
  } catch {
    // Sem storage: o filtro vale até o próximo reload.
  }
}
