/**
 * Cliente do Assistente da Central (RULES 28, 17/10/2026): o painel de conversa que, no perfil
 * `operations` com `assistente` no /api/runtime, toma o lugar do Pedir. O contrato da API é fixo
 * e mora em operations/assistente-contrato.ts; o servidor é escrito contra o mesmo arquivo.
 *
 * Três partes, nesta ordem:
 *  1. PURO: endereço -> contexto, atalhos, junção das mensagens, textos da etapa e das falhas.
 *     Sem `window` nem `document`: é o que assistente.test.ts fixa em tabela.
 *  2. Transporte: os fetch das rotas e o acompanhamento (polling de 1,5 s enquanto há resposta
 *     pendente). O acompanhamento recebe relógio e visibilidade injetados para o teste.
 *  3. A conversa da aba (`useAssistente`): um estado só, fora do componente, para a conversa
 *     sobreviver a fechar o painel (no celular ele é uma folha montada com v-if).
 *
 * O Assistente propõe; o Rômulo faz (RULES 28 e 10): nada aqui escreve em domínio. Quem escreve é
 * o toque num cartão, pelas rotas que já existem (AssistenteCartao.vue).
 */
import { ref } from 'vue'
import type {
  CartaoDoAssistente,
  CerebroDaResposta,
  ContextoDaPagina,
  ConversaDoAssistente,
  EstadoDoAssistente,
  EtapaPendente,
  MensagemDoAssistente,
  PedidoDeMensagem,
  RecebidoDoAssistente,
  TipoDeFalhaDoAssistente,
} from '../operations/assistente-contrato'
import type { Modo } from '../types'
import { SIGLA_DO_PRODUTO } from '../operations/crm-formato'
import type { CrmProduto } from '../operations/types'
import { lerGastoFalado, type GastoFalado } from '../../server/financas/gasto-falado.ts'
import { normalizarCaminho } from './destinos'

export const ROTA_DO_ASSISTENTE = '/api/operations/assistente'
/** O teto do campo, o mesmo do contrato (PedidoDeMensagem.texto). */
export const LIMITE_DO_TEXTO = 2000
export const INTERVALO_DO_ACOMPANHAMENTO = 1500
/** ~5 min de espera (200 × 1,5 s): o Hermes leva ~20 s; muito além disso a resposta se perdeu. */
export const MAXIMO_DE_RODADAS = 200

// ================================================================ 1. PURO

/**
 * Onde o Rômulo está, num id curto e estável: vai ao servidor como `pagina` e escolhe os atalhos.
 * Em Vendas a aba conta (o Funil pergunta outra coisa que o A fazer) e a Ficha aberta vira `ficha`.
 */
export type PaginaDoAssistente =
  | 'hoje'
  | 'agenda'
  | 'vendas'
  | 'triagem'
  | 'funil'
  | 'numeros'
  | 'ficha'
  | 'financas'
  | 'escritorio'
  | 'mais'
  | 'design-system'
  | 'outra'

/** O lead pelo id do endereço (`?lead=site:abc`): o produto é o prefixo, como o servidor monta o id. */
export function leadDoId(id: string | null | undefined): { produto: string; id: string } | null {
  const limpo = (id ?? '').trim()
  const i = limpo.indexOf(':')
  if (i <= 0 || i === limpo.length - 1) return null
  return { produto: limpo.slice(0, i), id: limpo }
}

/**
 * O contexto implícito de cada mensagem, lido do endereço. Só a página e, com a Ficha aberta,
 * `{ produto, id }` do lead, como o CrmPanel o identifica (`?lead=` com o id inteiro): nome,
 * telefone e conversa o servidor busca na visão de Vendas, já mascarados.
 */
export function contextoDoEndereco(caminhoCru: string, busca: string): ContextoDaPagina & { pagina: PaginaDoAssistente } {
  const caminho = normalizarCaminho(caminhoCru)
  const q = new URLSearchParams(busca)
  if (caminho === '/crm') {
    const lead = leadDoId(q.get('lead'))
    if (lead) return { pagina: 'ficha', lead }
    const ver = q.get('ver')
    if (ver === 'funil' || ver === 'jornada') return { pagina: 'funil' }
    if (ver === 'triagem') return { pagina: 'triagem' }
    if (ver === 'numeros' || ver === 'resultados') return { pagina: 'numeros' }
    return { pagina: 'vendas' }
  }
  if (caminho === '/') return { pagina: 'hoje' }
  if (caminho === '/agenda') return { pagina: 'agenda' }
  if (caminho === '/financas' || caminho.startsWith('/financas/')) return { pagina: 'financas' }
  if (caminho === '/squadone' || caminho.startsWith('/squadone/')) return { pagina: 'escritorio' }
  if (caminho === '/mais') return { pagina: 'mais' }
  if (caminho === '/design-system') return { pagina: 'design-system' }
  return { pagina: 'outra' }
}

/**
 * As perguntas prontas da conversa vazia, pela página. Finanças não tem nenhuma: finanças não vão
 * ao Assistente (RULES 28), e um atalho ali convidaria a perguntar o que ele vai recusar.
 */
export function atalhosDoContexto(pagina: string, lead?: { empresa?: string } | null): string[] {
  switch (pagina) {
    case 'hoje':
      return ['O que faço agora?', 'Quem espera resposta?', 'Como está o Dell?']
    case 'ficha': {
      const empresa = lead?.empresa?.trim()
      return [empresa ? `O que respondo para ${empresa}?` : 'O que respondo para este lead?', 'Em que pé está?', 'Anotar o próximo passo']
    }
    case 'vendas':
      return ['O que faço agora?', 'Quem espera resposta?']
    case 'agenda':
      return ['O que tenho hoje?']
    case 'funil':
      return ['Onde está travando?']
    default:
      return []
  }
}

/** O maior `n` já visto (o `?desde=` do próximo pedido); `anterior` quando a lista está vazia. */
export function maiorN(mensagens: readonly MensagemDoAssistente[], anterior?: number): number | undefined {
  return mensagens.reduce<number | undefined>((m, x) => (m === undefined || x.n > m ? x.n : m), anterior)
}

/**
 * Junta as mensagens novas às que a tela já tem, sem duplicar pelo `n` (o `?desde=` pode repetir a
 * última, e duas rodadas podem trazer a mesma). A versão nova vence: é a que o servidor tem agora.
 */
export function juntarMensagens(atuais: readonly MensagemDoAssistente[], novas: readonly MensagemDoAssistente[]): MensagemDoAssistente[] {
  const porN = new Map<number, MensagemDoAssistente>()
  for (const m of atuais) porN.set(m.n, m)
  for (const m of novas) porN.set(m.n, m)
  return [...porN.values()].sort((a, b) => a.n - b.n)
}

const TEXTO_DA_ETAPA: Record<EtapaPendente, string> = {
  pensando: 'Pensando…',
  lendo: 'Lendo Vendas…',
  hermes: 'Consultando o Hermes, ~20 s (pode fechar)',
}

/** A etapa da resposta em preparo, para a região `aria-live` do painel. */
export function textoDaEtapa(etapa: EtapaPendente | string): string {
  return TEXTO_DA_ETAPA[etapa as EtapaPendente] ?? 'Pensando…'
}

/**
 * Só do painel: `rede`, o pedido nem chegou ao servidor (ou a resposta não chegou de volta);
 * `pendente`, o POST voltou 400 com `pendente: true` (a conversa já tem resposta em preparo, que
 * outra aba pediu): o painel retoma o acompanhamento em vez de só mostrar o erro.
 */
export type TipoDeFalhaDoPainel = TipoDeFalhaDoAssistente | 'rede' | 'pendente'

/**
 * Cada falha por tipo, com o que fazer (BP-RECADO: diz o que fazer, não só o que houve). Os nomes
 * são os da tela (glossário): Vendas, não o nome antigo.
 */
const FALHAS: Record<TipoDeFalhaDoPainel, { titulo: string; oQueFazer: string }> = {
  modeloOcupado: { titulo: 'O Gemini está ocupado agora.', oQueFazer: 'Passa sozinho: pergunte de novo em um minuto.' },
  teto: { titulo: 'O Assistente chegou ao teto de hoje.', oQueFazer: 'Volta amanhã. Até lá, as telas de Hoje e Vendas têm o mesmo dado.' },
  hermes: { titulo: 'O Hermes não respondeu.', oQueFazer: 'Pergunte de novo mais tarde se precisar da opinião dele; o resto segue sem ele.' },
  semCrm: { titulo: 'Não consegui ler Vendas agora.', oQueFazer: 'Abra Vendas e veja se o retrato está em dia; depois pergunte de novo.' },
  desligado: { titulo: 'O Assistente está desligado nesta Central.', oQueFazer: 'Ele liga com SQUADONE_ASSISTENTE=true no operations.env do Dell.' },
  outro: { titulo: 'Algo falhou na resposta.', oQueFazer: 'Pergunte de novo; se repetir, veja o Dell em Manutenção (a engrenagem no topo).' },
  rede: { titulo: 'A Central não respondeu.', oQueFazer: 'Confira a conexão com o Dell (Tailscale) e tente de novo.' },
  pendente: { titulo: 'A resposta anterior ainda está chegando.', oQueFazer: 'Espere ela aparecer aqui e mande de novo.' },
}

export function textoDaFalha(tipo: TipoDeFalhaDoPainel | string): { titulo: string; oQueFazer: string } {
  return FALHAS[tipo as TipoDeFalhaDoPainel] ?? FALHAS.outro
}

/**
 * Uma resposta de erro do servidor vira falha classificada (o contrato: 429 com `teto`, 503 com
 * `desligado`, 400 com `error`, e com `pendente` quando a conversa já espera resposta). 404
 * (conversa, resposta ou cartão que o servidor não tem) e 409 (cartão já decidido) caem em
 * `outro` com o `status` no erro: quem chama decide por ele. O texto do servidor vale quando há;
 * senão, o título do tipo.
 */
export function falhaDaResposta(status: number, corpo: unknown): { tipo: TipoDeFalhaDoPainel; texto: string } {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as { error?: unknown; teto?: unknown; desligado?: unknown; modeloOcupado?: unknown; pendente?: unknown }
  const texto = typeof c.error === 'string' && c.error.trim() ? c.error.trim() : ''
  const tipo: TipoDeFalhaDoPainel =
    c.teto === true || status === 429 ? 'teto'
      : c.desligado === true ? 'desligado'
        : c.modeloOcupado === true ? 'modeloOcupado'
          : c.pendente === true ? 'pendente'
            : 'outro'
  return { tipo, texto: texto || (status ? `${textoDaFalha(tipo).titulo} (HTTP ${status})` : textoDaFalha(tipo).titulo) }
}

const ROTULO_DO_CEREBRO: Record<CerebroDaResposta, string> = { regra: 'regra fixa', gemini: 'Gemini', hermes: 'Hermes' }
export function rotuloDoCerebro(c: CerebroDaResposta | undefined): string {
  return c ? ROTULO_DO_CEREBRO[c] ?? '' : ''
}

/** Hora curta de uma mensagem, no fuso do Rômulo (o Dell e o navegador podem divergir). */
export function horaCurta(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

/** "12 de 60 hoje": o teto à vista antes de bater nele. */
export function usoDeHoje(e: Pick<EstadoDoAssistente, 'usadosHoje' | 'tetoDia'> | null): string {
  if (!e || !Number.isFinite(e.tetoDia) || e.tetoDia <= 0) return ''
  return `${e.usadosHoje} de ${e.tetoDia} perguntas hoje`
}

/** O modo do cartão (contrato: 'baixa') no modo do turno (/api/orquestrar: 'baixa_prioridade'). */
export function modoDoTurno(m: 'auto' | 'foco' | 'baixa'): Modo {
  return m === 'baixa' ? 'baixa_prioridade' : m
}

/**
 * O `id` que a rota de registro de Vendas espera é a chave (CrmFicha manda `lead.chave`), sem o
 * prefixo do produto. O cartão pode trazer um ou outro: tirar o prefixo serve aos dois.
 */
export function chaveParaRegistro(produto: string, id: string): string {
  const prefixo = `${produto}:`
  return id.startsWith(prefixo) ? id.slice(prefixo.length) : id
}

/**
 * PURO. Quem é o lead de um cartão, como a tela diz: "Empresa · Oferta" (a mesma empresa pode estar
 * em duas ofertas, e a anotação vai para uma só) e se ele é outro que não o da Ficha aberta. O
 * Assistente pode propor para qualquer lead de Vendas; com a Ficha de um lead aberta, anotar no
 * outro sem perceber seria o erro mais fácil desta tela (revisão de 17/10/2026).
 */
export function leadDoCartao(
  dados: { produto: string; id: string; empresa: string },
  leadAberto?: { produto: string; id: string } | null,
): { rotulo: string; outroLead: boolean } {
  const oferta = SIGLA_DO_PRODUTO[dados.produto as CrmProduto] ?? dados.produto
  const rotulo = [dados.empresa.trim(), oferta].filter(Boolean).join(' · ')
  if (!leadAberto) return { rotulo, outroLead: false }
  const mesmo = leadAberto.produto === dados.produto
    && chaveParaRegistro(leadAberto.produto, leadAberto.id) === chaveParaRegistro(dados.produto, dados.id)
  return { rotulo, outroLead: !mesmo }
}

/** O estado que a tela mostra num cartão: o toque desta aba vence o que o servidor guardou. */
export function estadoDoCartao(c: CartaoDoAssistente, local?: 'confirmado' | 'descartado'): CartaoDoAssistente['estado'] {
  return local ?? c.estado
}

// ---------------------------------------------------------------- o gasto falado (fase 2)

/**
 * "gastei 30 no mercado" no painel (fase 2 da RULES 28, 17/10/2026): vira cartão AQUI, pela regra fixa
 * do Telegram (lerGastoFalado), sem ir ao servidor do Assistente: nem o texto nem o valor chegam a modelo
 * nenhum nem ao JSONL dele (RULES 24). O cartão vive só nesta aba e só grava no toque, pelo
 * POST /api/financas/gasto. O valor aparece na tela, que é o lugar dele (RULES 24: R$ só no app).
 */
export interface GastoNaTela {
  /** Também é a origem do lançamento (`painel:<id>`): o mesmo cartão tocado de novo não duplica. */
  id: string
  /** A frase como o Rômulo escreveu: o servidor lê de novo, pela mesma regra. */
  texto: string
  gasto: GastoFalado
  /** Fica depois desta mensagem da conversa (o maior `n` quando foi escrito; 0 = antes de todas). */
  depoisDe: number
  estado: 'proposto' | 'anotando' | 'confirmado' | 'descartado'
  /** "Anotado: Mercado", a resposta do servidor (sem o valor, como no Telegram). */
  resultado?: string
  erro?: string
}

/** PURO. O gasto da frase, ou null quando ela não é um gasto (vai ao Assistente como sempre). */
export function gastoDoTexto(texto: string): GastoFalado | null {
  return lerGastoFalado(texto ?? '')
}

/** PURO. "R$ 1.200,50": o valor na tela do cartão, e só nela. */
export function textoDoValor(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export type ItemDaConversa =
  | { tipo: 'mensagem'; chave: string; mensagem: MensagemDoAssistente }
  | { tipo: 'gasto'; chave: string; gasto: GastoNaTela }

/**
 * PURO. As mensagens do servidor e os gastos desta aba numa ordem só: cada gasto logo depois da
 * mensagem que já estava na tela quando ele foi escrito, na ordem em que foram escritos.
 */
export function linhaDoTempo(mensagens: readonly MensagemDoAssistente[], gastos: readonly GastoNaTela[]): ItemDaConversa[] {
  const ordenadas = [...mensagens].sort((a, b) => a.n - b.n)
  const saida: ItemDaConversa[] = []
  const restantes = [...gastos]
  const despejar = (ate: number) => {
    for (let i = 0; i < restantes.length;) {
      if (restantes[i].depoisDe <= ate) saida.push({ tipo: 'gasto', chave: `g:${restantes[i].id}`, gasto: restantes.splice(i, 1)[0] })
      else i++
    }
  }
  despejar(0)
  for (const m of ordenadas) {
    saida.push({ tipo: 'mensagem', chave: `m:${m.n}`, mensagem: m })
    despejar(m.n)
  }
  despejar(Number.POSITIVE_INFINITY)
  return saida
}

/** Um id para a origem do gasto: o do navegador quando há (https, localhost), senão um aleatório longo. */
function novoIdDeGasto(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // sem crypto: o aleatório abaixo
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Enter manda; Shift+Enter (e a composição de acento do IME) quebra a linha. */
export function enterEnvia(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.isComposing
}

// ================================================================ 2. transporte

export class ErroDoAssistente extends Error {
  constructor(
    readonly tipo: TipoDeFalhaDoPainel,
    mensagem: string,
    readonly status: number | null = null
  ) {
    super(mensagem)
    this.name = 'ErroDoAssistente'
  }
}

type Buscar = (url: string, init?: RequestInit) => Promise<Response>
// Embrulhado: `fetch` chamado como método de outro objeto dá "Illegal invocation" no navegador.
const buscarPadrao: Buscar = (url, init) => fetch(url, init)

async function pedir<T>(url: string, init: RequestInit | undefined, buscar: Buscar, vazio = false): Promise<T> {
  let r: Response
  try {
    r = await buscar(url, init)
  } catch {
    throw new ErroDoAssistente('rede', textoDaFalha('rede').titulo)
  }
  if (!r.ok) {
    const corpo = await r.json().catch(() => ({}))
    const f = falhaDaResposta(r.status, corpo)
    throw new ErroDoAssistente(f.tipo, f.texto, r.status)
  }
  if (vazio) return undefined as T
  try {
    return (await r.json()) as T
  } catch {
    throw new ErroDoAssistente('outro', 'A resposta da Central veio ilegível.', r.status)
  }
}

const postJson = (corpo: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(corpo),
})

export function lerEstado(buscar: Buscar = buscarPadrao): Promise<EstadoDoAssistente> {
  return pedir(ROTA_DO_ASSISTENTE, { cache: 'no-store' }, buscar)
}

export function enviar(pedido: PedidoDeMensagem, buscar: Buscar = buscarPadrao): Promise<RecebidoDoAssistente> {
  return pedir(`${ROTA_DO_ASSISTENTE}/mensagens`, postJson({ ...pedido, texto: pedido.texto.slice(0, LIMITE_DO_TEXTO) }), buscar)
}

/** Sem `desde` vem a conversa inteira (é a primeira leitura, ou a de uma conversa guardada). */
export function lerConversa(conversaId: string, desde?: number, buscar: Buscar = buscarPadrao): Promise<ConversaDoAssistente> {
  const q = desde === undefined ? '' : `?desde=${encodeURIComponent(String(desde))}`
  return pedir(`${ROTA_DO_ASSISTENTE}/conversas/${encodeURIComponent(conversaId)}${q}`, { cache: 'no-store' }, buscar)
}

export function avaliar(respostaId: string, nota: 1 | -1, motivo?: string, buscar: Buscar = buscarPadrao): Promise<void> {
  return pedir(`${ROTA_DO_ASSISTENTE}/avaliacao`, postJson({ respostaId, nota, ...(motivo ? { motivo } : {}) }), buscar, true)
}

/** Só mede (contrato): quem escreve é a rota de sempre, chamada antes, pelo toque no cartão. */
export function registrarDesfecho(cartaoId: string, desfecho: 'confirmado' | 'descartado', buscar: Buscar = buscarPadrao): Promise<void> {
  return pedir(`${ROTA_DO_ASSISTENTE}/cartoes/${encodeURIComponent(cartaoId)}`, postJson({ desfecho }), buscar, true)
}

/**
 * O toque no cartão de gasto: a rota das finanças, não a do Assistente. Manda a frase (o servidor relê
 * pela regra fixa) e o id do cartão como origem. Erro vem com o texto do servidor quando há.
 */
export async function gravarGasto(texto: string, origem: string, buscar: Buscar = buscarPadrao): Promise<{ categoria: string; novo: boolean; texto: string }> {
  let r: Response
  try {
    r = await buscar('/api/financas/gasto', postJson({ texto, origem }))
  } catch {
    throw new Error('A Central não respondeu. Confira a conexão e toque de novo.')
  }
  const corpo = (await r.json().catch(() => ({}))) as { error?: unknown; categoria?: unknown; novo?: unknown; texto?: unknown }
  if (!r.ok) throw new Error(typeof corpo.error === 'string' && corpo.error ? corpo.error : `HTTP ${r.status}`)
  const categoria = typeof corpo.categoria === 'string' ? corpo.categoria : ''
  return { categoria, novo: corpo.novo === true, texto: typeof corpo.texto === 'string' && corpo.texto ? corpo.texto : `Anotado: ${categoria}` }
}

export interface OpcoesDoAcompanhamento {
  intervaloMs?: number
  maximoDeRodadas?: number
  buscar?: (conversaId: string, desde: number | undefined) => Promise<ConversaDoAssistente>
  /** Agenda a próxima rodada e devolve como cancelá-la (o teste passa um relógio falso). */
  agendar?: (fn: () => void, ms: number) => () => void
  visivel?: () => boolean
  /** Escuta a aba voltar a aparecer; devolve como parar de escutar. */
  ouvirVisibilidade?: (fn: () => void) => () => void
  aoFalhar?: (e: ErroDoAssistente) => void
  /** Acabou: a resposta chegou, falhou de vez ou alguém chamou `parar()`. */
  aoTerminar?: () => void
}

const agendarPadrao = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms)
  return () => clearTimeout(t)
}
const visivelPadrao = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
const ouvirPadrao = (fn: () => void) => {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', fn)
  return () => document.removeEventListener('visibilitychange', fn)
}

/**
 * Pergunta pela conversa a cada 1,5 s enquanto houver resposta `pendente`. Para quando ela chega,
 * quando falha de vez (404 na hora; rede ou 5xx depois de três seguidas) e em `parar()` (o painel
 * fechou). Com a aba escondida não pergunta: espera ela voltar e retoma na hora. A primeira rodada
 * sai já, sem esperar o intervalo.
 */
export function acompanhar(
  conversaId: string,
  desdeInicial: number | undefined,
  aoReceber: (c: ConversaDoAssistente) => void,
  o: OpcoesDoAcompanhamento = {}
): { parar: () => void } {
  const intervalo = o.intervaloMs ?? INTERVALO_DO_ACOMPANHAMENTO
  const maximo = o.maximoDeRodadas ?? MAXIMO_DE_RODADAS
  const buscar = o.buscar ?? ((id: string, desde: number | undefined) => lerConversa(id, desde))
  const agendar = o.agendar ?? agendarPadrao
  const visivel = o.visivel ?? visivelPadrao
  let desde = desdeInicial
  let parado = false
  let emVoo = false
  let esperandoAba = false
  let rodadas = 0
  let falhasSeguidas = 0
  let cancelar: (() => void) | null = null

  const pararDeOuvir = (o.ouvirVisibilidade ?? ouvirPadrao)(() => {
    if (!parado && esperandoAba && visivel()) {
      esperandoAba = false
      void rodada()
    }
  })

  function encerrar() {
    if (parado) return
    parado = true
    cancelar?.()
    cancelar = null
    pararDeOuvir()
    o.aoTerminar?.()
  }

  function falhar(e: ErroDoAssistente) {
    encerrar()
    o.aoFalhar?.(e)
  }

  function proxima() {
    if (parado) return
    cancelar = agendar(() => {
      cancelar = null
      void rodada()
    }, intervalo)
  }

  async function rodada() {
    if (parado || emVoo) return
    if (!visivel()) {
      esperandoAba = true
      return
    }
    rodadas += 1
    if (rodadas > maximo) {
      falhar(new ErroDoAssistente('outro', 'A resposta demorou demais e não chegou. Pergunte de novo.'))
      return
    }
    emVoo = true
    let c: ConversaDoAssistente
    try {
      c = await buscar(conversaId, desde)
    } catch (e) {
      emVoo = false
      if (parado) return
      const erro = e instanceof ErroDoAssistente ? e : new ErroDoAssistente('rede', textoDaFalha('rede').titulo)
      falhasSeguidas += 1
      // 404: a conversa não existe mais (podada aos 90 dias, ou de outro Dell); insistir não adianta.
      if (erro.status === 404 || erro.status === 400 || falhasSeguidas >= 3) falhar(erro)
      else proxima()
      return
    }
    emVoo = false
    if (parado) return
    falhasSeguidas = 0
    aoReceber(c)
    desde = maiorN(c.mensagens, desde)
    if (c.pendente) proxima()
    else encerrar()
  }

  void rodada()
  return { parar: encerrar }
}

/** Copia para a área de transferência; sem a API (http sem TLS, navegador velho), por seleção. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error('sem clipboard')
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    const campo = document.createElement('textarea')
    campo.value = texto
    campo.setAttribute('readonly', '')
    campo.style.position = 'fixed'
    campo.style.opacity = '0'
    document.body.appendChild(campo)
    campo.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      campo.remove()
    }
  }
}

// ================================================================ 3. a conversa da aba

const CHAVE_DA_CONVERSA = 'squadone.assistente.conversa'

/** sessionStorage: recarregar a aba volta à mesma conversa; outra aba começa outra. */
function lerConversaGuardada(chave = CHAVE_DA_CONVERSA): string | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(chave)
  } catch {
    return null
  }
}
function guardarConversa(id: string | null, chave = CHAVE_DA_CONVERSA) {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (id) sessionStorage.setItem(chave, id)
    else sessionStorage.removeItem(chave)
  } catch {
    // sem guardar: a conversa vale até recarregar
  }
}

export interface FalhaNaTela {
  tipo: TipoDeFalhaDoPainel
  texto: string
}

function criarAssistente(chave = CHAVE_DA_CONVERSA) {
  const guardar = (id: string | null) => guardarConversa(id, chave)
  /**
   * O Assistente existe nesta Central (a casca diz, pelo /api/runtime): a Ficha só mostra o
   * "Perguntar sobre este lead" com ele. Fora da casca (teste), fica falso.
   */
  const disponivel = ref(false)
  const aberto = ref(false)
  // Uma ficha no escritório não altera a URL. O contexto dura só enquanto ela está montada.
  const contextoDaFicha = ref<(ContextoDaPagina & { pagina: 'ficha' }) | null>(null)
  /** Sobe quando o ＋ é tocado com o painel já aberto (desktop): o painel leva o foco ao campo. */
  const focar = ref(0)
  const estado = ref<EstadoDoAssistente | null>(null)
  const erroDoEstado = ref<FalhaNaTela | null>(null)
  const conversaId = ref<string | null>(lerConversaGuardada(chave))
  const mensagens = ref<MensagemDoAssistente[]>([])
  const pendente = ref<ConversaDoAssistente['pendente']>(null)
  /** A mensagem do Rômulo entre o toque em Enviar e ela aparecer na conversa do servidor. */
  const enviando = ref<{ id: string | null; texto: string } | null>(null)
  /** Falha do envio ou do acompanhamento (a de uma resposta vem dentro da mensagem). */
  const falha = ref<FalhaNaTela | null>(null)
  const avaliacoes = ref<Record<string, 1 | -1>>({})
  const erroDaAvaliacao = ref<Record<string, string>>({})
  /** O toque de cada cartão nesta aba (o servidor só mede; a tela não espera ele confirmar). */
  const desfechos = ref<Record<string, 'confirmado' | 'descartado'>>({})
  /** O cartão que mandou o último pedido ao time: só ele mostra o resultado do turno. */
  const pedidoDoCartao = ref<string | null>(null)
  /** Os cartões de gasto falado desta aba (nunca vão ao servidor do Assistente). */
  const gastos = ref<GastoNaTela[]>([])

  let acompanhamento: { parar: () => void } | null = null
  /** Sobe a cada "Nova conversa": resposta de um envio antigo não cai na conversa nova. */
  let geracao = 0

  async function carregarEstado() {
    try {
      estado.value = await lerEstado()
      erroDoEstado.value = null
    } catch (e) {
      erroDoEstado.value = e instanceof ErroDoAssistente ? { tipo: e.tipo, texto: e.message } : { tipo: 'outro', texto: String(e) }
    }
  }

  function pausar() {
    acompanhamento?.parar()
    acompanhamento = null
  }

  function seguir() {
    const id = conversaId.value
    if (!id || acompanhamento) return
    const minha = geracao
    const atual = acompanhar(id, maiorN(mensagens.value), (c) => {
      if (minha !== geracao) return
      mensagens.value = juntarMensagens(mensagens.value, c.mensagens)
      pendente.value = c.pendente
      // O "ainda está chegando" some quando chega: o texto voltou ao campo, pronto para mandar de novo.
      if (!c.pendente && falha.value?.tipo === 'pendente') falha.value = null
      const e = enviando.value
      if (e?.id && mensagens.value.some((m) => m.id === e.id)) enviando.value = null
    }, {
      aoFalhar: (e) => {
        if (minha !== geracao) return
        // A conversa guardada sumiu do servidor: começa outra, sem alarde.
        if (e.status === 404 && !mensagens.value.length && !enviando.value) {
          novaConversa()
          return
        }
        pendente.value = null
        enviando.value = null
        falha.value = { tipo: e.tipo, texto: e.message }
      },
      aoTerminar: () => {
        if (acompanhamento === atual) acompanhamento = null
      },
    })
    // A primeira rodada sai dentro de `acompanhar`, mas só termina depois do primeiro await:
    // `aoTerminar` sempre encontra `atual` já guardado.
    acompanhamento = atual
  }

  /** O painel abriu (ou a aba voltou com ele aberto): lê o estado e retoma a conversa. */
  function retomar() {
    void carregarEstado()
    if (!conversaId.value) return
    // Sem mensagens é a conversa guardada da aba (recarregou): lê inteira. Com pendente, retoma.
    if (!mensagens.value.length || pendente.value) seguir()
  }

  function novaConversa() {
    geracao += 1
    pausar()
    conversaId.value = null
    guardar(null)
    mensagens.value = []
    pendente.value = null
    enviando.value = null
    falha.value = null
    gastos.value = []
  }

  async function mandar(texto: string, contexto: ContextoDaPagina): Promise<boolean> {
    const t = texto.trim().slice(0, LIMITE_DO_TEXTO)
    if (!t || enviando.value || pendente.value) return false
    // O gasto falado nem sai da aba: cartão por regra fixa, gravado só no toque (RULES 24 e 28).
    const gasto = gastoDoTexto(t)
    if (gasto && chave === CHAVE_DA_CONVERSA) {
      falha.value = null
      gastos.value = [...gastos.value, { id: novoIdDeGasto(), texto: t, gasto, depoisDe: maiorN(mensagens.value) ?? 0, estado: 'proposto' }]
      return true
    }
    const minha = geracao
    falha.value = null
    enviando.value = { id: null, texto: t }
    try {
      const r = await enviar({ ...(conversaId.value ? { conversaId: conversaId.value } : {}), texto: t, contexto })
      if (minha !== geracao) return true
      if (r.conversaId !== conversaId.value) {
        // Mandamos uma conversa que o servidor não tem (podada, ou de antes de trocar de Dell) e ele
        // abriu outra: as mensagens da antiga saem, senão o `n` 1 e 2 da nova cairia por cima delas.
        if (conversaId.value) {
          mensagens.value = []
          // Os gastos da aba ficam, no começo: o `depoisDe` deles era da conversa antiga.
          gastos.value = gastos.value.map((g) => ({ ...g, depoisDe: 0 }))
        }
        conversaId.value = r.conversaId
        guardar(r.conversaId)
      }
      enviando.value = { id: r.mensagemId, texto: t }
      pendente.value = { respostaId: r.respostaId, etapa: 'pensando', desde: new Date().toISOString() }
      pausar()
      seguir()
      void carregarEstado()
      return true
    } catch (e) {
      if (minha !== geracao) return false
      enviando.value = null
      falha.value = e instanceof ErroDoAssistente ? { tipo: e.tipo, texto: e.message } : { tipo: 'outro', texto: String(e) }
      // Outra aba já perguntou nesta conversa: acompanha a resposta dela, que chega aqui também.
      if (e instanceof ErroDoAssistente && e.tipo === 'pendente') seguir()
      return false
    }
  }

  async function avaliarResposta(respostaId: string, nota: 1 | -1) {
    const antes = avaliacoes.value[respostaId]
    if (antes === nota) return
    avaliacoes.value = { ...avaliacoes.value, [respostaId]: nota }
    erroDaAvaliacao.value = { ...erroDaAvaliacao.value, [respostaId]: '' }
    try {
      await avaliar(respostaId, nota)
    } catch {
      const volta = { ...avaliacoes.value }
      if (antes) volta[respostaId] = antes
      else delete volta[respostaId]
      avaliacoes.value = volta
      erroDaAvaliacao.value = { ...erroDaAvaliacao.value, [respostaId]: 'A nota não foi guardada; tente de novo.' }
    }
  }

  /** Depois do toque no cartão: guarda na tela e avisa o servidor, que só conta (falha calada). */
  function marcarDesfecho(cartaoId: string, desfecho: 'confirmado' | 'descartado') {
    desfechos.value = { ...desfechos.value, [cartaoId]: desfecho }
    void registrarDesfecho(cartaoId, desfecho).catch((e) => console.warn('[assistente] desfecho não medido:', e))
  }

  function trocarGasto(id: string, campos: Partial<GastoNaTela>) {
    gastos.value = gastos.value.map((g) => (g.id === id ? { ...g, ...campos } : g))
  }

  /** O toque em "Anotar em Finanças": a única escrita do cartão de gasto. */
  async function anotarGasto(id: string) {
    const g = gastos.value.find((x) => x.id === id)
    if (!g || g.estado === 'anotando' || g.estado === 'confirmado') return
    trocarGasto(id, { estado: 'anotando', erro: undefined })
    try {
      const r = await gravarGasto(g.texto, g.id)
      trocarGasto(id, { estado: 'confirmado', resultado: r.texto })
    } catch (e) {
      trocarGasto(id, { estado: 'proposto', erro: `Não foi anotado: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  function descartarGasto(id: string) {
    const g = gastos.value.find((x) => x.id === id)
    if (g && g.estado === 'proposto') trocarGasto(id, { estado: 'descartado', erro: undefined })
  }

  /** O ＋, a lateral e o Ctrl+K: abre, ou leva o foco ao campo se já está aberto. */
  function abrir() {
    if (aberto.value) focar.value += 1
    else aberto.value = true
  }

  return {
    disponivel,
    contextoDaFicha,
    aberto,
    focar,
    abrir,
    gastos,
    anotarGasto,
    descartarGasto,
    estado,
    erroDoEstado,
    conversaId,
    mensagens,
    pendente,
    enviando,
    falha,
    avaliacoes,
    erroDaAvaliacao,
    desfechos,
    pedidoDoCartao,
    retomar,
    pausar,
    novaConversa,
    mandar,
    avaliarResposta,
    marcarDesfecho,
  }
}

export type ConversaDaAba = ReturnType<typeof criarAssistente>
let unica: ConversaDaAba | null = null

/** A conversa da aba: uma só, criada na primeira chamada (o painel e a casca dividem). */
export function useAssistente(): ConversaDaAba {
  return (unica ??= criarAssistente())
}

/** Uma instância por pessoa; nunca reaproveita o histórico do Assistente geral. */
const porAgente = new Map<string, ConversaDaAba>()
export function useConversaDoAgente(squad: string, sala: string, pessoa: string, lead?: { produto: string; id: string }): ConversaDaAba {
  const chave = `squadone.agente.${JSON.stringify([squad, sala, pessoa, ...(lead ? [[lead.produto, lead.id]] : [])])}`
  if (!porAgente.has(chave)) porAgente.set(chave, criarAssistente(chave))
  return porAgente.get(chave)!
}
