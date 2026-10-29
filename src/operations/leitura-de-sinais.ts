/**
 * PURO (17/10/2026): "Ler os sinais deste lote" na Triagem. Os sinais do site (anúncio, agência,
 * agendamento, blog; server/sinais-do-site.ts) só eram lidos quando a Ficha de um lead abria, então a
 * Prioridade da Triagem só melhorava para quem já tinha sido aberto (desde 29/10/2026 eles não pesam na
 * pontuação, só no filtro por motivo e na Ficha). Aqui fica a regra do botão que lê
 * os do LOTE ATUAL de 10 (nunca a fila de ~1.400), um de cada vez, quando a pessoa toca:
 *
 *  - quem entra: o prospect com site próprio e sem leitura guardada (`lead.sinais` ausente). Quem já
 *    tem leitura, quem não tem site e o perfil de rede social ficam de fora antes de pedir qualquer coisa;
 *  - em série, com pausa curta ENTRE leituras que foram ao site (cada uma faz até 3 requisições ao
 *    servidor dele): a que veio do cache do servidor não pesa em ninguém e não espera;
 *  - a falha de um lead nunca derruba os outros; o que não é erro da operação (sem site para ler, endereço
 *    que a Central não lê, site fora do ar) é só contado e a série segue;
 *  - parar (ou sair da tela) interrompe a série; o que já foi lido fica guardado no servidor.
 *
 * Reusa POST /api/operations/crm/sinais, que é por lead, em vez de um endpoint de lote: o servidor já
 * tem o single-flight, o cache de 7 dias e o SSRF no leitor, e um pedido de lote precisaria de um
 * segundo laço com outro teto e outro jeito de abortar. A cola de rede (CrmHoje.vue) só faz o `fetch`
 * e entrega a resposta a `desfechoDaResposta`; o laço é `lerEmSerie`, que aqui se testa com dublês.
 *
 * Nada disto decide, convida ou envia: só traz informação para a pessoa decidir.
 */
import { ehSiteProprio } from '../../server/sinais-do-site.ts'
import type { CrmLead, CrmProduto } from './types'

/** Entre uma leitura que foi ao site e a seguinte: educado com o servidor dos outros, sem arrastar o lote. */
export const PAUSA_ENTRE_LEITURAS_MS = 1500

/** Só o que o laço precisa saber do lead (e o corpo do pedido: o id é a chave da planilha, não o do CRM). */
export interface AlvoDaLeitura {
  id: string
  chave: string
  produto: CrmProduto
  empresa: string
}

export type DesfechoDaLeitura = 'lido' | 'inacessivel' | 'semSite' | 'bloqueado' | 'falhou' | 'desligado'

/** O que o `fetch` entrega ao laço: o desfecho e se o servidor foi ao site ou respondeu do cache. */
export interface ResultadoDoPedido {
  desfecho: DesfechoDaLeitura
  /** `site`: o servidor foi à rede (vale a pausa); `cache`/ausente: não pediu nada a ninguém. */
  origem?: 'site' | 'cache'
}

type LeadDaLeitura = Pick<CrmLead, 'id' | 'chave' | 'produto' | 'empresa' | 'links' | 'sinais'>

/**
 * Há o que ler? Site próprio (não o demo do Site antes da venda, nem perfil de rede social) e nenhuma
 * leitura guardada. Quem não tem site já nasce com `sinais` (o servidor os marca "sem fonte"), então
 * também cai fora aqui sem regra à parte.
 */
export function podeLerSinais(lead: Pick<LeadDaLeitura, 'produto' | 'links' | 'sinais'>): boolean {
  return lead.produto !== 'site' && !lead.sinais && Boolean(lead.links.site) && ehSiteProprio(lead.links.site ?? '')
}

/**
 * Os do lote, na ordem dele, que valem uma leitura. `jaTentados` são os que esta tela já tentou e não
 * ganharam leitura guardada (site fora do ar, endereço bloqueado) e os que acabaram de ser lidos e esperam
 * a visão nova: sem isto o botão ofereceria os mesmos de novo, e o servidor só responderia do cache.
 */
export function alvosDoLote(
  ids: readonly string[], leads: ReadonlyMap<string, LeadDaLeitura>, jaTentados: ReadonlySet<string> = new Set(),
): AlvoDaLeitura[] {
  const vistos = new Set<string>()
  const alvos: AlvoDaLeitura[] = []
  for (const id of ids) {
    const lead = leads.get(id)
    if (!lead || vistos.has(id) || jaTentados.has(id) || !podeLerSinais(lead)) continue
    vistos.add(id)
    alvos.push({ id: lead.id, chave: lead.chave, produto: lead.produto, empresa: lead.empresa })
  }
  return alvos
}

/** O corpo do POST /api/operations/crm/sinais. */
export const corpoDaLeitura = (alvo: Pick<AlvoDaLeitura, 'produto' | 'chave'>) => ({ produto: alvo.produto, id: alvo.chave })

/**
 * Traduz a resposta do servidor. 409 (sem site próprio) e 422 (endereço que a Central não lê) não são
 * erro da operação. 503 é "leitura desligada nesta Central": vale para todos, então a série para.
 */
export function desfechoDaResposta(status: number, corpo: unknown): ResultadoDoPedido {
  if (status === 409) return { desfecho: 'semSite' }
  if (status === 422) return { desfecho: 'bloqueado' }
  if (status === 503) return { desfecho: 'desligado' }
  if (status < 200 || status >= 300) return { desfecho: 'falhou' }
  const o = corpo && typeof corpo === 'object' ? corpo as { estado?: unknown; origem?: unknown } : {}
  const origem = o.origem === 'cache' ? 'cache' : o.origem === 'site' ? 'site' : undefined
  if (o.estado === 'ok') return { desfecho: 'lido', ...(origem ? { origem } : {}) }
  if (o.estado === 'inacessivel') return { desfecho: 'inacessivel', ...(origem ? { origem } : {}) }
  if (o.estado === 'bloqueado') return { desfecho: 'bloqueado', ...(origem ? { origem } : {}) }
  return { desfecho: 'falhou' }
}

// ------------------------------------------------------------------ o laço

export interface Andamento {
  feitos: number
  total: number
  /** Quem está sendo lido agora (para o leitor de tela e para a linha de status). */
  empresa: string
}

export interface ResumoDaLeitura {
  total: number
  /** Quantos foram até o fim (lidos, ou com desfecho); os que a parada deixou de fora não entram. */
  feitos: number
  lidos: number
  inacessiveis: number
  semSite: number
  bloqueados: number
  falhas: number
  /** A pessoa parou (ou saiu da tela) antes do fim. */
  parou: boolean
  /** O servidor disse que a leitura está desligada: a série parou por isso. */
  desligado: boolean
  /**
   * Os que tiveram resposta definitiva (lidos, sem site, bloqueados, fora do ar): a tela não os oferece
   * de novo nesta sessão. Os lidos saem sozinhos quando a visão relida traz a leitura; os outros nunca
   * a trazem, e sem isto o botão os repetiria. Quem deu erro (rede, servidor) fica de fora: pode tentar.
   */
  resolvidos: string[]
}

export interface DependenciasDoLaco {
  /** Uma leitura. Se lançar, vira `falhou` e a série segue. */
  ler(alvo: AlvoDaLeitura): Promise<ResultadoDoPedido>
  /** Espera `ms`; deve voltar logo se `parou()` virar verdadeiro. */
  esperar(ms: number): Promise<void>
  parou(): boolean
  aoAndar?(andamento: Andamento): void
}

export const resumoVazio = (total: number): ResumoDaLeitura => ({
  total, feitos: 0, lidos: 0, inacessiveis: 0, semSite: 0, bloqueados: 0, falhas: 0, parou: false, desligado: false, resolvidos: [],
})

/** Em série. Nunca lança: o que der errado num lead vira contagem. */
export async function lerEmSerie(alvos: readonly AlvoDaLeitura[], deps: DependenciasDoLaco, pausa = PAUSA_ENTRE_LEITURAS_MS): Promise<ResumoDaLeitura> {
  const r = resumoVazio(alvos.length)
  let pausaPendente = false
  for (const alvo of alvos) {
    if (deps.parou()) { r.parou = true; break }
    // A pausa vem antes da leitura seguinte, não depois da última: acabou, a pessoa não espera à toa.
    if (pausaPendente) {
      await deps.esperar(pausa)
      pausaPendente = false
      if (deps.parou()) { r.parou = true; break }
    }
    deps.aoAndar?.({ feitos: r.feitos, total: r.total, empresa: alvo.empresa })
    let resultado: ResultadoDoPedido
    try {
      resultado = await deps.ler(alvo)
    } catch {
      resultado = { desfecho: 'falhou' }
    }
    // Parou no meio do pedido: o desfecho dele não vale (pode ser o próprio cancelamento).
    if (deps.parou()) { r.parou = true; break }
    if (resultado.desfecho === 'desligado') { r.desligado = true; break }
    r.feitos += 1
    switch (resultado.desfecho) {
      case 'lido': r.lidos += 1; break
      case 'inacessivel': r.inacessiveis += 1; break
      case 'semSite': r.semSite += 1; break
      case 'bloqueado': r.bloqueados += 1; break
      default: r.falhas += 1; break
    }
    if (resultado.desfecho !== 'falhou') r.resolvidos.push(alvo.id)
    pausaPendente = resultado.origem === 'site'
  }
  deps.aoAndar?.({ feitos: r.feitos, total: r.total, empresa: '' })
  return r
}

// ------------------------------------------------------------------ texto

export const textoDoAndamento = (a: Pick<Andamento, 'feitos' | 'total'>) => `${a.feitos} de ${a.total}`

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * A frase final, sem jargão: quantos ganharam leitura e o que ficou sem ela e por quê. `falhas` (rede,
 * servidor) diz que dá para tentar de novo; "não pôde ler" é o site que não respondeu ou que a Central não lê.
 */
export function textoDoResumo(r: ResumoDaLeitura): string {
  if (r.desligado) return 'A leitura dos sinais do site está desligada nesta Central.'
  const partes: string[] = []
  if (r.lidos) partes.push(plural(r.lidos, 'site lido', 'sites lidos'))
  const naoPode = r.inacessiveis + r.bloqueados
  if (r.semSite) partes.push(`${r.semSite} sem site para ler`)
  if (naoPode) partes.push(`${naoPode} não pôde ler`)
  if (r.falhas) partes.push(`${plural(r.falhas, 'deu erro', 'deram erro')} (tente de novo)`)
  if (r.parou) return `Parado em ${r.feitos} de ${r.total}${partes.length ? `: ${partes.join(' · ')}` : ''}.`
  return `${partes.length ? partes.join(' · ') : 'Nenhum site lido'}.`
}
