/**
 * PURO: a próxima venda (16/10/2026). Uma fila só, na ordem de quem está mais perto de comprar, com
 * a mensagem já escrita para o Rômulo só revisar e mandar. Usada pela Hoje (o cartão "Próxima
 * venda") e pelo vendedor do servidor (server/vendedor.ts), que avisa no Telegram "Envie para X".
 *
 * Por que esta ordem (o que se sabe de venda por mensagem, não opinião de tela):
 *  1. Responder quem respondeu. A chance de qualificar cai muito depois da primeira hora
 *     (speed-to-lead); um "sim, quero ver" parado dois dias é a venda que mais se perde. Em
 *     16/10/2026 havia dois "pode sim" de 14/10 sem o link: é o porquê de não vender.
 *  1b. Mandar a proposta (mandar-proposta.ts) a quem gostou depois do link ("gostei", "quanto
 *     fica"). Substitui o "responder" desse lead: a resposta certa ao "gostei" é a proposta, e o
 *     toque abre o WhatsApp com ela e já anota `proposta` (eram 0 propostas para 3 "quero ver").
 *  2. Cumprir o combinado na data: confiança é o que fecha serviço.
 *  2b. "O que achou?" um dia depois do link (o demo ou o Raio-X), quando ele não escreveu mais. A
 *     simulação de 16/10/2026 achou o furo: depois da 2ª mensagem nenhum passo pedia nada, e o
 *     funil dos 30 dias tinha 0 propostas para 3 "quero ver" atendidos. É ali que a venda acontece.
 *  3. Proposta sem retorno: quem recebeu preço e sumiu tem uma dúvida que não falou. Perguntar
 *     qual é, e oferecer 10 min de ligação, fecha mais que mandar a proposta de novo.
 *  4. Follow-up de quem leu e não respondeu (curto, uma pergunta de sim ou não).
 *  5. Primeiro contato, por último, e só quando a trava de ritmo (trava-de-ritmo.ts) e o expediente
 *     de venda deixam: um por vez. O reenvio do só-robô também é primeiro contato.
 * "Revisar prospects" fica fora: é triagem, não mensagem.
 *
 * Nada aqui envia: a fila só monta o texto e o link do WhatsApp; quem toca em enviar é o Rômulo
 * (decisão de 16/10/2026: semi-automático; a API não oficial ficou de fora pelo risco de banimento
 * do número que é também o do Hermes).
 */
import type { TipoDeEnvioAnotado } from './anotacao-de-envio'
import { gostouDepoisDoLink, propostaDeUmToque } from './mandar-proposta'
import { podeMandarPrimeiroContato } from './trava-de-horario'
import type { CrmGrupoHoje, CrmGrupoHojeId, CrmItemHoje, CrmLead, CrmProduto, CrmVisao } from './types'

export type TipoDeVenda = 'responder' | 'mandar-proposta' | 'combinado' | 'depois-do-link' | 'proposta' | 'followup' | 'primeiro'

/** O que o toque em "Enviei" grava na aba CRM: um envio, ou a proposta (o servidor põe a data de hoje). */
export type AnotacaoDeVenda = TipoDeEnvioAnotado | 'proposta'

export interface AcaoDeVenda {
  /** `leadId|tipo`: o mesmo lead pode ter um combinado e uma resposta; cada um é um aviso. */
  chave: string
  leadId: string
  empresa: string
  produto: CrmProduto
  tipo: TipoDeVenda
  /** "Responda a Kulniski Advocacia". */
  titulo: string
  /** "Site · advocacia · Ribeirão Preto". */
  contexto: string
  /** O que o servidor já sabe do momento (o `detalhe` da Hoje do CRM). */
  porque: string
  /** Como vender neste momento, em uma frase. */
  tatica: string
  /** A mensagem como vai sair no WhatsApp; ausente quando o passo é escrever à mão. */
  rascunho?: string
  /** O link que abre o WhatsApp (com o texto, quando há). */
  link?: { rotulo: string; url: string }
  /** O envio que o toque em "Enviei" anota; ausente quando o próprio link já marca (o do n8n). */
  anota?: AnotacaoDeVenda
  /** Primeiro contato: conta na trava de ritmo. */
  primeiroContato: boolean
  /** Disse que quer ver, ou combinado atrasado: a tela destaca. */
  quente: boolean
  /**
   * O que a conversa guardada mostra (16/10/2026): "Última mensagem: ele, há 2 h: “…”", ou o aviso de
   * que a Central não tem a conversa e é preciso conferir no WhatsApp antes de mandar.
   */
  conversa?: string
  /** A mensagem é a do copiloto, que leu a conversa; `padrao` guarda o texto pronto da esteira. */
  copiloto?: { porque: string, quando: string, padrao?: string, momento?: MomentoDaVenda }
}

/** Quem está do outro lado e o que fazer, na leitura do copiloto (espelha MomentoDaConversa de copiloto.ts). */
export interface MomentoDaVenda {
  quem: 'decisor' | 'recepcao' | 'robo' | 'nao_sei'
  leitura: string
  passo: string
}

/** A sugestão do copiloto para um lead, já conferida contra o dossiê de agora (server/copiloto.ts). */
export interface SugestaoDeVenda {
  mensagem: string
  porque: string
  quando: string
  momento?: MomentoDaVenda
}

const TITULO_DE_QUEM: Partial<Record<MomentoDaVenda['quem'], (empresa: string) => string>> = {
  recepcao: (e) => `${e}: quem respondeu foi a recepção, não quem decide`,
  robo: (e) => `${e}: só o atendimento automático respondeu`,
  nao_sei: (e) => `${e}: descubra com quem está falando`,
}

export interface ContextoDaVenda {
  /** A trava de ritmo e o expediente deixam sair um primeiro contato agora. */
  primeiroLiberado: boolean
  /**
   * Fora do expediente, os leads que o Rômulo liberou à mão (o "Liberar" da trava de horário, a
   * mesma regra das telas do CRM). Só vale com `ritmoLivre`: o ritmo não se libera.
   */
  liberados?: ReadonlySet<string>
  ritmoLivre?: boolean
  /** Relógio (ms) para o "o que achou?"; ausente, esse passo não entra. */
  agora?: number
  /** leadId -> a sugestão do copiloto, quando há uma para a conversa de agora. */
  sugestoes?: ReadonlyMap<string, SugestaoDeVenda>
}

/** Os passos em que a mensagem do copiloto (que leu a conversa) vale mais que o texto pronto da esteira. */
const COM_COPILOTO: ReadonlySet<TipoDeVenda> = new Set(['responder', 'combinado', 'depois-do-link', 'proposta', 'followup'])

/** A ação ganharia com a mensagem do copiloto e ainda está com o texto pronto da esteira. */
export function esperaOCopiloto(acao: AcaoDeVenda): boolean {
  return !acao.primeiroContato && !acao.copiloto && COM_COPILOTO.has(acao.tipo)
}

function haQuanto(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.round(h / 24)} dias`
}

/**
 * PURO. Uma linha sobre a conversa, para quem vai mandar não repetir o que já saiu: a última
 * mensagem (de quem, quando, o quê) ou, sem conversa guardada, o pedido de conferir antes.
 */
export function linhaDaConversa(lead: Pick<CrmLead, 'conversa' | 'etapa'>, agora: number | undefined): string | undefined {
  const c = lead.conversa
  if (!c) {
    return lead.etapa === 'contato' || lead.etapa === 'proposta'
      ? 'A Central não tem esta conversa guardada: confira no WhatsApp o que já saiu antes de mandar.'
      : undefined
  }
  const quem = c.ultima.direcao === 'entrada' ? 'ele' : 'você'
  const quando = agora === undefined ? '' : `, ${haQuanto(agora - Date.parse(c.ultima.em))}`
  const texto = c.ultima.trecho ? `: “${c.ultima.trecho}”` : ' (texto não guardado)'
  return `Última mensagem: ${quem}${quando}${texto}`
}

/** O "o que achou?" vale de 20 h a 72 h depois do link: antes é cobrança, depois esfriou (é follow-up). */
export const JANELA_DO_DEPOIS_DO_LINK = { deMs: 20 * 3600_000, ateMs: 72 * 3600_000 } as const

const PERGUNTA_DEPOIS_DO_LINK: Record<CrmProduto, (empresa: string) => string> = {
  site: (e) => `Oi! Conseguiu ver a demonstração do site da ${e}? O que achou?`,
  prumo: (e) => `Oi! Conseguiu olhar o Raio-X da ${e}? Qual ponto chamou mais a sua atenção?`,
  iris: () => 'Oi! Conseguiu dar uma olhada no que te mandei? O que achou?',
  estampa: () => 'Oi! Conseguiu dar uma olhada no que te mandei? O que achou?',
  plus: () => 'Meu Ir.\'., conseguiu dar uma olhada no que te mandei? O que achou?',
}

/** Um dia depois da 2ª mensagem (link, demo ou Raio-X) sem resposta dele: perguntar o que achou. */
function acaoDepoisDoLink(lead: CrmLead, agora: number | undefined): AcaoDeVenda | null {
  if (agora === undefined || lead.etapa !== 'contato' || !lead.links.whatsapp) return null
  const segunda = Date.parse(lead.marcos.segundaEnviada ?? '')
  if (!Number.isFinite(segunda)) return null
  const desde = agora - segunda
  if (desde < JANELA_DO_DEPOIS_DO_LINK.deMs || desde > JANELA_DO_DEPOIS_DO_LINK.ateMs) return null
  const dele = Math.max(Date.parse(lead.marcos.respondeu ?? '') || 0, Date.parse(lead.resposta?.em ?? '') || 0,
    Date.parse(lead.conversa?.ultimaEntrada ?? '') || 0)
  if (dele > segunda) return null
  // Já escrevemos de novo depois do link (a conversa sabe): a pergunta já foi feita, à mão.
  if ((Date.parse(lead.conversa?.ultimaSaida ?? '') || 0) > segunda + 10 * 60_000) return null
  const texto = PERGUNTA_DEPOIS_DO_LINK[lead.produto](lead.empresa)
  const url = `${lead.links.whatsapp}${lead.links.whatsapp.includes('?') ? '&' : '?'}text=${encodeURIComponent(texto)}`
  const horas = Math.round(desde / 3600_000)
  return {
    chave: `${lead.id}|depois-do-link`,
    leadId: lead.id,
    empresa: lead.empresa,
    produto: lead.produto,
    tipo: 'depois-do-link',
    titulo: titulo('depois-do-link', lead),
    contexto: [ROTULO_CURTO[lead.produto], lead.nicho, lead.cidade].filter(Boolean).join(' · '),
    porque: `O link saiu há ${horas} h e ele não escreveu mais.`,
    tatica: tatica('depois-do-link', lead),
    rascunho: texto,
    link: { rotulo: 'Perguntar o que achou', url },
    primeiroContato: false,
    quente: true,
  }
}

/**
 * Gostou depois do link: a proposta pronta (o texto base da colinha; o do copiloto só na Ficha,
 * que lê a sugestão guardada). Sem WhatsApp ou sem texto, null: o lead segue no "responder".
 */
function acaoMandarProposta(lead: CrmLead): AcaoDeVenda | null {
  if (!gostouDepoisDoLink(lead)) return null
  const proposta = propostaDeUmToque(lead)
  if (!proposta) return null
  return {
    chave: `${lead.id}|mandar-proposta`,
    leadId: lead.id,
    empresa: lead.empresa,
    produto: lead.produto,
    tipo: 'mandar-proposta',
    titulo: titulo('mandar-proposta', lead),
    contexto: [ROTULO_CURTO[lead.produto], lead.nicho, lead.cidade].filter(Boolean).join(' · '),
    porque: lead.resposta?.trecho ? `Depois do link ele escreveu: "${lead.resposta.trecho}".` : 'Ele gostou depois do link.',
    tatica: tatica('mandar-proposta', lead),
    rascunho: proposta.texto,
    link: { rotulo: 'Mandar a proposta', url: proposta.url },
    anota: 'proposta',
    primeiroContato: false,
    quente: true,
  }
}

const ORDEM_DOS_GRUPOS: Array<[CrmGrupoHojeId, TipoDeVenda]> = [
  ['resposta', 'responder'],
  ['proximo', 'combinado'],
  ['proposta', 'proposta'],
  ['followup', 'followup'],
  ['enviar', 'primeiro'],
]

const ROTULO_CURTO: Record<CrmProduto, string> = { site: 'Site', prumo: 'PRUMO', iris: 'Iris', estampa: 'Estamparia', plus: 'Plus' }

/** O texto de um link wa.me (`?text=`); null quando o link não leva texto (o do n8n, a conversa). */
export function textoDoLink(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/.test(u.hostname)) return null
    const texto = u.searchParams.get('text')
    return texto && texto.trim() ? texto : null
  } catch {
    return null
  }
}

function tatica(tipo: TipoDeVenda, lead: CrmLead): string {
  switch (tipo) {
    case 'responder':
      if (lead.resposta?.tipo === 'interesse') return 'Ele disse sim: mande agora. Cada hora de espera esfria o "quero ver"; depois do link, pergunte o que achou em vez de esperar.'
      if (lead.resposta?.tipo === 'neutra') return 'Resposta aberta: responda curto, tire a dúvida e devolva uma pergunta de sim ou não que leve ao "quero ver".'
      return 'Responda no mesmo dia, curto, e termine com uma pergunta que ele consiga responder com uma palavra.'
    case 'mandar-proposta':
      return 'Ele gostou: a resposta é a proposta, hoje (em até 24 h do "gostei"). O que entra, quanto custa e quando começa; tocar já anota a proposta no CRM.'
    case 'combinado':
      return 'Você combinou: cumprir na data é o que faz confiar. Lembre o que ele disse da última vez e proponha o próximo passo com dia e hora.'
    case 'depois-do-link':
      return 'Depois do link, a venda está na pergunta. Se ele gostou, responda com o preço e o próximo passo com data, e marque a proposta na ficha; se tiver dúvida, ofereça 10 minutos de ligação.'
    case 'proposta':
      return 'Proposta sem retorno: não reenvie o preço. Pergunte qual dúvida ficou e ofereça 10 minutos de ligação ainda esta semana.'
    case 'followup':
      if (lead.reenvioDoRobo) return 'Só o robô respondeu: peça quem cuida disso, sem repetir a oferta.'
      return 'Leu e não respondeu: uma linha só, com uma pergunta de sim ou não. Sem cobrar, sem repetir a mensagem inteira.'
    case 'primeiro':
      return 'Primeira mensagem sem link e com uma pergunta: o objetivo é só a resposta. Um por vez, para o WhatsApp não ler como disparo.'
  }
}

function titulo(tipo: TipoDeVenda, lead: CrmLead): string {
  const nome = lead.empresa
  switch (tipo) {
    case 'responder': return lead.resposta?.tipo === 'interesse' ? `${nome} disse sim: mande o próximo passo` : `Responda a ${nome}`
    case 'mandar-proposta': return `${nome} gostou: mande a proposta`
    case 'combinado': return `Combinado com ${nome}`
    case 'depois-do-link': return `Pergunte a ${nome} o que achou`
    case 'proposta': return `Pergunte a ${nome} o que faltou na proposta`
    case 'followup': return lead.reenvioDoRobo ? `Peça o responsável na ${nome}` : `Follow-up para ${nome}`
    case 'primeiro': return `Envie a primeira mensagem para ${nome}`
  }
}

/** O link do passo: o primeiro do item que abre o WhatsApp para o lead (texto pronto ou conversa). */
function linkDoItem(item: CrmItemHoje): { rotulo: string; url: string } | undefined {
  return item.links.find((l) => textoDoLink(l.url) !== null) ?? item.links[0]
}

function anotaDoLink(lead: CrmLead, url: string | undefined): TipoDeEnvioAnotado | undefined {
  if (!url) return undefined
  if (lead.produto === 'plus' && url === lead.links.enviar) return 'plus_enviado'
  if (url === lead.links.segunda) return 'segunda_enviada'
  if (url === lead.links.followup) return 'followup_enviado'
  return undefined
}

function acaoDoItem(item: CrmItemHoje, tipo: TipoDeVenda, lead: CrmLead): AcaoDeVenda {
  const link = linkDoItem(item)
  const primeiroContato = tipo === 'primeiro' || (tipo === 'followup' && Boolean(lead.reenvioDoRobo))
  const rascunho = (link && textoDoLink(link.url)) ?? (tipo === 'primeiro' ? lead.mensagemPronta : undefined)
  const anota = anotaDoLink(lead, link?.url)
  const lugar = [ROTULO_CURTO[lead.produto], lead.nicho, lead.cidade].filter(Boolean).join(' · ')
  // Cada mensagem nova dele é uma vez nova de responder (o vendedor avisa de novo, a tela não a dá por feita).
  const vez = tipo === 'responder' && lead.conversa?.ultimaEntrada ? `|${lead.conversa.ultimaEntrada}` : ''
  return {
    chave: `${lead.id}|${tipo}${vez}`,
    leadId: lead.id,
    empresa: lead.empresa,
    produto: lead.produto,
    tipo,
    titulo: titulo(tipo, lead),
    contexto: lugar,
    porque: [item.acao, item.detalhe].filter(Boolean).join('. ').replace(/\.\./g, '.'),
    tatica: tatica(tipo, lead),
    ...(rascunho ? { rascunho } : {}),
    ...(link ? { link } : {}),
    ...(anota ? { anota } : {}),
    primeiroContato,
    quente: (tipo === 'responder' && lead.resposta?.tipo === 'interesse') || Boolean(item.urgente) || (tipo === 'combinado' && /atraso/.test(item.detalhe)),
  }
}

/**
 * A fila inteira, na ordem de venda. Primeiro contato (e o reenvio do só-robô) só entra com
 * `primeiroLiberado`, e no máximo um: a fila nunca oferece dois de uma vez.
 * `pulados` (chaves): o que o Rômulo deixou para depois hoje vai para o fim, sem sumir.
 */
export function filaDeVenda(visao: Pick<CrmVisao, 'hoje' | 'leads'> | null | undefined, ctx: ContextoDaVenda, pulados: ReadonlySet<string> = new Set()): AcaoDeVenda[] {
  if (!visao) return []
  const porId = new Map(visao.leads.map((l) => [l.id, l] as [string, CrmLead]))
  const grupos = new Map(visao.hoje.map((g) => [g.id, g] as [CrmGrupoHojeId, CrmGrupoHoje]))
  const fila: AcaoDeVenda[] = []
  const vistas = new Set<string>()
  let primeiros = 0
  const depoisDoLink = visao.leads.flatMap((l) => {
    const a = acaoDepoisDoLink(l, ctx.agora)
    return a ? [a] : []
  })
  const propostas = visao.leads.flatMap((l) => {
    const a = acaoMandarProposta(l)
    return a ? [a] : []
  })
  const comProposta = new Set(propostas.map((a) => a.leadId))
  for (const [grupo, tipo] of ORDEM_DOS_GRUPOS) {
    if (grupo === 'proximo') {
      for (const a of propostas) if (!vistas.has(a.chave)) { vistas.add(a.chave); fila.push(a) }
    }
    if (grupo === 'proposta') {
      for (const a of depoisDoLink) if (!vistas.has(a.chave)) { vistas.add(a.chave); fila.push(a) }
    }
    for (const item of grupos.get(grupo)?.itens ?? []) {
      const lead = porId.get(item.leadId)
      if (!lead) continue
      // Quem gostou depois do link já tem a proposta na fila: "responder" seria o mesmo toque, sem a marca.
      if (tipo === 'responder' && comProposta.has(lead.id)) continue
      const acao = acaoDoItem(item, tipo, lead)
      if (vistas.has(acao.chave)) continue
      if (acao.primeiroContato) {
        const pode = ctx.primeiroLiberado
          || podeMandarPrimeiroContato({ noExpediente: false, liberado: Boolean(ctx.liberados?.has(lead.id)), ritmoLivre: Boolean(ctx.ritmoLivre) })
        if (!pode || primeiros >= 1) continue
        primeiros++
      }
      vistas.add(acao.chave)
      fila.push(acao)
    }
  }
  const conscientes = fila.map((a) => comAConversa(a, porId.get(a.leadId), ctx))
  return [...conscientes.filter((a) => !pulados.has(a.chave)), ...conscientes.filter((a) => pulados.has(a.chave))]
}

/**
 * A ação com o que a conversa sabe (16/10/2026, "ainda não está consciente do que está acontecendo"):
 * a linha da última mensagem e, quando o copiloto já leu a conversa de agora, a mensagem dele no
 * lugar do texto pronto da esteira (que fica em `copiloto.padrao`). A mensagem do copiloto não anota
 * envio sozinha: se levar o link, a conversa mostra e o CRM conta.
 */
function comAConversa(acao: AcaoDeVenda, lead: CrmLead | undefined, ctx: ContextoDaVenda): AcaoDeVenda {
  if (!lead || acao.primeiroContato) return acao
  const conversa = linhaDaConversa(lead, ctx.agora)
  const sugestao = COM_COPILOTO.has(acao.tipo) ? ctx.sugestoes?.get(lead.id) : undefined
  const comLinha = conversa ? { ...acao, conversa } : acao
  if (!sugestao?.mensagem.trim() || !lead.links.whatsapp) return comLinha
  const url = `${lead.links.whatsapp}${lead.links.whatsapp.includes('?') ? '&' : '?'}text=${encodeURIComponent(sugestao.mensagem)}`
  // A leitura de quem respondeu manda no título e no "como": com a recepção ou o robô, o passo não é
  // o da jornada (link, proposta), é chegar a quem decide.
  const m = sugestao.momento
  const titulo = m ? TITULO_DE_QUEM[m.quem]?.(lead.empresa) : undefined
  const comSugestao: AcaoDeVenda = {
    ...comLinha,
    ...(titulo ? { titulo, quente: false } : {}),
    ...(m?.passo ? { tatica: m.passo } : {}),
    rascunho: sugestao.mensagem,
    link: { rotulo: 'Abrir no WhatsApp com a mensagem', url },
    copiloto: { porque: sugestao.porque, quando: sugestao.quando, ...(acao.rascunho ? { padrao: acao.rascunho } : {}), ...(m ? { momento: m } : {}) },
  }
  delete comSugestao.anota
  return comSugestao
}

/** "3 respostas · 2 follow-ups · 1 primeiro contato": o que vem depois da primeira. */
export function resumoDaFila(fila: readonly AcaoDeVenda[]): string {
  const NOMES: Record<TipoDeVenda, [string, string]> = {
    responder: ['resposta', 'respostas'],
    'mandar-proposta': ['proposta para mandar', 'propostas para mandar'],
    combinado: ['combinado', 'combinados'],
    'depois-do-link': ['"o que achou?"', '"o que achou?"'],
    proposta: ['proposta sem retorno', 'propostas sem retorno'],
    followup: ['follow-up', 'follow-ups'],
    primeiro: ['primeiro contato', 'primeiros contatos'],
  }
  const conta = new Map<TipoDeVenda, number>()
  for (const a of fila) conta.set(a.tipo, (conta.get(a.tipo) ?? 0) + 1)
  return [...conta].map(([t, n]) => `${n} ${NOMES[t][n === 1 ? 0 : 1]}`).join(' · ')
}

// ---------------------------------------------------------------- expediente de venda

// A regra mora na trava de horário (uma só para toda tela, OT-02); daqui só se reexporta, porque o
// vendedor do servidor e os testes a importam deste módulo.
export { EXPEDIENTE_DE_VENDA, noExpedienteDeVenda } from './trava-de-horario'
