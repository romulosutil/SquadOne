/**
 * PURO (16/10/2026, item 8 da auditoria de design de 15/10): a Lista do Funil no desktop.
 *
 * O quadro de colunas funciona com poucos leads por etapa; com o Plus (310) e um Em contato
 * de 100+, cada coluna vira uma rolagem própria de cartões de 6 a 8 linhas e comparar dois
 * leads é rolar colunas diferentes. A Lista é uma tabela, uma linha por lead, e por isso
 * mostra **um** sinal só: o mais forte, por esta ordem (Resposta nova > Follow-up hoje >
 * Perdido amanhã > Divergência > o resto). Os outros continuam no cartão e na Ficha.
 *
 * O storage entra por parâmetro (o mesmo padrão de office/vista.ts): a escolha Quadro ou
 * Lista é conveniência da aba e pode não sobreviver (modo privado, storage bloqueado).
 */
import { ROTULO_DA_RESPOSTA, diaEscolhido, textoDoPrazo } from './crm-formato'
import { PASSOS, passoAtual, type IdDoPasso, type LeadDaJornada } from './jornada'
import { chaveDoNicho, type AcaoDeVenda } from './proxima-venda'
import type { CrmEtapa, CrmLead } from './types'

export type VistaDoFunil = 'quadro' | 'lista'
export const CHAVE_DA_VISTA_DO_FUNIL = 'squadone:funil:vista'

export interface Guardador {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
}

export function lerVistaDoFunil(storage: Guardador | null | undefined): VistaDoFunil {
  try {
    return storage?.getItem(CHAVE_DA_VISTA_DO_FUNIL) === 'lista' ? 'lista' : 'quadro'
  } catch {
    return 'quadro'
  }
}

export function gravarVistaDoFunil(storage: Guardador | null | undefined, vista: VistaDoFunil): void {
  try {
    storage?.setItem(CHAVE_DA_VISTA_DO_FUNIL, vista)
  } catch {
    // Sem storage: a escolha vale até o próximo reload.
  }
}

/** Quais etapas a Lista mostra: as abertas (o trabalho de agora) ou uma só. */
export type FiltroDeEtapa = 'abertas' | CrmEtapa
export const ETAPAS_ABERTAS: readonly CrmEtapa[] = ['novo', 'contato', 'proposta']
export const naEtapa = (filtro: FiltroDeEtapa, etapa: CrmEtapa) => (filtro === 'abertas' ? ETAPAS_ABERTAS.includes(etapa) : filtro === etapa)

/**
 * "Abertas" numa lista só, na ordem da ação. Concatenadas etapa a etapa, os ~1900 prospects do Novo
 * (Revisar, Prioridade 100) vinham antes de quem respondeu e do follow-up do dia, que estão em Em
 * contato: a Lista abria com nada para fazer (visto na Central em 16/10/2026). Aqui o `peso` (o mesmo
 * do quadro: resposta nova, follow-up, próximo passo...) vale entre etapas; no empate, Proposta, Em
 * contato e Novo, nessa ordem; dentro da etapa fica a ordem que o quadro já deu (o sort é estável).
 */
export const ORDEM_DAS_ABERTAS: readonly CrmEtapa[] = ['proposta', 'contato', 'novo']
export function juntarAbertas(porEtapa: Readonly<Record<CrmEtapa, readonly CrmLead[]>>, peso: (lead: CrmLead) => number): CrmLead[] {
  return ORDEM_DAS_ABERTAS.flatMap((e) => porEtapa[e]).sort((a, b) => peso(a) - peso(b))
}

/**
 * O número de uma etapa, o MESMO no Quadro, nas abas do celular e no filtro da Lista (AC-03, 17/10/2026).
 * O Quadro contava o Perdido inteiro (1535) e a Lista só o que mostrava (245), sem dizer que tirou os
 * 1.290 descartados antes do contato. Agora as duas contam o que mostram, pela mesma escolha de
 * "Mostrar descartados", e `foraDescartados` diz quantos ficaram de fora para a tela avisar.
 */
export interface ContagemDaEtapa { mostrados: number; foraDescartados: number }
export function contagemDaEtapa(daEtapa: readonly Pick<CrmLead, 'motivoPerda'>[], etapa: CrmEtapa, mostrarDescartados: boolean): ContagemDaEtapa {
  const descartados = etapa === 'perdido' ? daEtapa.filter((l) => l.motivoPerda === 'descartado').length : 0
  const foraDescartados = mostrarDescartados ? 0 : descartados
  return { mostrados: daEtapa.length - foraDescartados, foraDescartados }
}

/** "+1.290 descartados antes do contato": o aviso ao lado do número; vazio quando nada ficou de fora. */
export function textoDosDescartados(c: ContagemDaEtapa): string {
  if (!c.foraDescartados) return ''
  return `+${c.foraDescartados.toLocaleString('pt-BR')} descartado${c.foraDescartados === 1 ? '' : 's'} antes do contato`
}

/** A classe é a mesma do cartão (.crm-sinal.is-…, BP-SINAL), para a cor dizer o mesmo nas duas vistas. */
export interface SinalDaLinha { texto: string; classe: string }

/**
 * O sinal mais forte de um lead, ou `null`. `anotado` diz se este envio já foi anotado
 * nesta tela (anotacao-de-envio.ts): follow-up anotado não é mais "Follow-up hoje".
 * O próximo passo tem coluna própria e não entra aqui.
 */
export function sinalMaisForte(lead: CrmLead, anotado: (tipo: 'followup_enviado' | 'segunda_enviada') => boolean = () => false): SinalDaLinha | null {
  if (lead.respostaNova) return { texto: 'Resposta nova', classe: 'is-resposta' }
  if (lead.followupHoje && !anotado('followup_enviado')) return { texto: lead.reenvioDoRobo ? 'Reenvio hoje (só robô)' : 'Follow-up hoje', classe: 'is-followup' }
  const prazo = textoDoPrazo(lead)
  if (prazo && lead.diasParaSair !== undefined && lead.diasParaSair <= 1) return { texto: prazo, classe: 'is-prazo is-amanha' }
  if (lead.divergencias.length) return { texto: 'Divergência', classe: 'is-divergencia' }
  // O resto, na ordem do cartão.
  if (lead.resposta) return { texto: ROTULO_DA_RESPOSTA[lead.resposta.tipo], classe: `is-${lead.resposta.tipo}` }
  if (anotado('followup_enviado')) return { texto: 'Follow-up anotado', classe: '' }
  if (anotado('segunda_enviada')) return { texto: '2ª mensagem anotada', classe: '' }
  if (lead.etapa === 'novo' && lead.triagem?.origemWhatsapp?.startsWith('não confirmado')) return { texto: 'WhatsApp não confirmado', classe: 'is-prazo' }
  if (lead.etapa === 'novo' && lead.triagem?.prioridade !== undefined) return { texto: `Prioridade ${lead.triagem.prioridade}`, classe: '' }
  if (prazo) return { texto: prazo, classe: 'is-prazo' }
  if (lead.acervo && lead.etapa === 'contato') return { texto: 'Acervo, sem follow-up automático', classe: 'is-acervo' }
  return null
}

/** "02/10 · Ligar de manhã": o próximo passo salvo por inteiro (o title da coluna); vazio sem ele. */
export function textoDoProximoPasso(lead: Pick<CrmLead, 'proximoPasso'>): string {
  const p = lead.proximoPasso
  return p ? [diaEscolhido(p.data), p.texto].filter(Boolean).join(' · ') : ''
}

/**
 * A coluna "Próximo passo" da Lista (AC-19, 17/10/2026). Lia só o próximo passo salvo à mão, que
 * quase ninguém tem: a coluna vinha toda "—" com uma fila de venda cheia ao lado. Agora é a frase
 * única da ação (fraseDaAcao, pela acaoDoLead de proxima-venda.ts: a mesma do cartão da Próxima
 * venda e do "Agora" da Ficha); sem ação, a data do passo salvo; sem nenhum dos dois, vazio.
 */
export function textoDaColunaProximo(acao: Pick<AcaoDeVenda, 'titulo'> | null | undefined, lead: Pick<CrmLead, 'proximoPasso'>): string {
  if (acao?.titulo) return acao.titulo
  return lead.proximoPasso?.data ? diaEscolhido(lead.proximoPasso.data) : ''
}

// A chave do nicho é uma só, a da fila de venda (proxima-venda.ts, AC-16): o filtro do Funil (AC-19)
// tinha uma cópia igual, que já divergia no vazio. Reexportada para o CrmFunil e o teste.
export { chaveDoNicho }

export interface OpcaoDeNicho { chave: string; rotulo: string; total: number }

const acentos = (t: string) => t.normalize('NFD').replace(/[^̀-ͯ]/g, '').length

/**
 * PURO. Uma opção por chave de nicho, na ordem alfabética. O rótulo é a grafia mais usada; no
 * empate, a com acento (é a forma certa em português) e depois a ordem do dicionário.
 */
export function opcoesDeNicho(nichos: readonly string[]): OpcaoDeNicho[] {
  const grupos = new Map<string, Map<string, number>>()
  for (const bruto of nichos) {
    const grafia = bruto.replace(/\s+/g, ' ').trim()
    // Sem nicho não vira opção (a chave dele é "sem nicho", e o rótulo sairia vazio).
    if (!grafia) continue
    const chave = chaveDoNicho(grafia)
    const g = grupos.get(chave) ?? new Map<string, number>()
    g.set(grafia, (g.get(grafia) ?? 0) + 1)
    grupos.set(chave, g)
  }
  return [...grupos].map(([chave, grafias]) => {
    const [rotulo] = [...grafias].sort(([a, na], [b, nb]) => nb - na || acentos(b) - acentos(a) || a.localeCompare(b, 'pt-BR'))[0]
    return { chave, rotulo, total: [...grafias.values()].reduce((s, n) => s + n, 0) }
  }).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

/**
 * O filtro "Passo" do Funil (AC-19): a vista "Por passo da jornada" (?ver=jornada) virou este
 * select, para o Funil ter uma alternância de vista só (Quadro | Lista). O passo é o de
 * passoAtual (jornada.ts), o mesmo da Ficha e das salas do Escritório.
 */
export type FiltroDePasso = '' | IdDoPasso

/** O `?passo=` do endereço, só se for um passo que existe; o resto é "todos". */
export function lerFiltroDePasso(valor: string | null | undefined): FiltroDePasso {
  return PASSOS.find((p) => p.id === valor)?.id ?? ''
}

export interface OpcaoDePasso { id: IdDoPasso; nome: string; total: number }

/**
 * PURO. Os passos na ordem da jornada, com quantos leads há em cada; só os que têm alguém (um
 * select com doze opções vazias não ajuda), mais o escolhido, mesmo vazio, para o select não
 * perder o valor quando o filtro de oferta muda.
 */
export function opcoesDePasso(leads: readonly LeadDaJornada[], escolhido: FiltroDePasso = ''): OpcaoDePasso[] {
  const conta = new Map<IdDoPasso, number>()
  for (const l of leads) {
    const id = passoAtual(l)
    conta.set(id, (conta.get(id) ?? 0) + 1)
  }
  return PASSOS.filter((p) => conta.has(p.id) || p.id === escolhido).map((p) => ({ id: p.id, nome: p.nome, total: conta.get(p.id) ?? 0 }))
}

/**
 * Ordem da Lista: `acao` é a do quadro (quem a chama já ordenou assim); `ultimo` e `proximo`
 * ordenam pela data, e quem não tem a data vai sempre para o fim, nos dois sentidos.
 * Empate fica na ordem de entrada (o sort é estável): a da ação.
 */
export type OrdemDaLista = 'acao' | 'ultimo' | 'proximo'
export type Sentido = 'asc' | 'desc'

const tempo = (iso?: string) => {
  const t = Date.parse(iso ?? '')
  return Number.isFinite(t) ? t : null
}
const dataDe = (lead: CrmLead, ordem: Exclude<OrdemDaLista, 'acao'>) =>
  ordem === 'ultimo' ? tempo(lead.ultimoEvento) : tempo(lead.proximoPasso?.data ? `${lead.proximoPasso.data}T12:00:00Z` : undefined)

export function ordenarLista(leads: readonly CrmLead[], ordem: OrdemDaLista, sentido: Sentido): CrmLead[] {
  if (ordem === 'acao') return [...leads]
  const sinal = sentido === 'asc' ? 1 : -1
  return [...leads].sort((a, b) => {
    const ta = dataDe(a, ordem)
    const tb = dataDe(b, ordem)
    if (ta === null || tb === null) return ta === tb ? 0 : ta === null ? 1 : -1
    return sinal * (ta - tb)
  })
}

/** O primeiro toque num cabeçalho: último toque do mais recente; próximo passo do mais perto. */
export const SENTIDO_INICIAL: Record<Exclude<OrdemDaLista, 'acao'>, Sentido> = { ultimo: 'desc', proximo: 'asc' }
