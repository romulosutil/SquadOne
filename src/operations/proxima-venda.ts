/**
 * PURO: a próxima venda (16/10/2026). Uma fila só, na ordem de quem está mais perto de comprar, com
 * a mensagem já escrita para o Rômulo só revisar e mandar. Usada pela Hoje (o cartão "Próxima
 * venda") e pelo vendedor do servidor (server/vendedor.ts), que avisa no Telegram "Envie para X".
 *
 * Por que esta ordem (o que se sabe de venda por mensagem, não opinião de tela):
 *  1. Responder quem respondeu. A chance de qualificar cai muito depois da primeira hora
 *     (speed-to-lead); um "sim, quero ver" parado dois dias é a venda que mais se perde. Em
 *     16/10/2026 havia dois "pode sim" de 14/10 sem o link: é o porquê de não vender.
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
import type { CrmGrupoHoje, CrmGrupoHojeId, CrmItemHoje, CrmLead, CrmProduto, CrmVisao } from './types'

export type TipoDeVenda = 'responder' | 'combinado' | 'depois-do-link' | 'proposta' | 'followup' | 'primeiro'

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
  anota?: TipoDeEnvioAnotado
  /** Primeiro contato: conta na trava de ritmo. */
  primeiroContato: boolean
  /** Disse que quer ver, ou combinado atrasado: a tela destaca. */
  quente: boolean
}

export interface ContextoDaVenda {
  /** A trava de ritmo e o expediente deixam sair um primeiro contato agora. */
  primeiroLiberado: boolean
  /** Relógio (ms) para o "o que achou?"; ausente, esse passo não entra. */
  agora?: number
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
  const dele = Math.max(Date.parse(lead.marcos.respondeu ?? '') || 0, Date.parse(lead.resposta?.em ?? '') || 0)
  if (dele > segunda) return null
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
  return {
    chave: `${lead.id}|${tipo}`,
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
  for (const [grupo, tipo] of ORDEM_DOS_GRUPOS) {
    if (grupo === 'proposta') {
      for (const a of depoisDoLink) if (!vistas.has(a.chave)) { vistas.add(a.chave); fila.push(a) }
    }
    for (const item of grupos.get(grupo)?.itens ?? []) {
      const lead = porId.get(item.leadId)
      if (!lead) continue
      const acao = acaoDoItem(item, tipo, lead)
      if (vistas.has(acao.chave)) continue
      if (acao.primeiroContato) {
        if (!ctx.primeiroLiberado || primeiros >= 1) continue
        primeiros++
      }
      vistas.add(acao.chave)
      fila.push(acao)
    }
  }
  return [...fila.filter((a) => !pulados.has(a.chave)), ...fila.filter((a) => pulados.has(a.chave))]
}

/** "3 respostas · 2 follow-ups · 1 primeiro contato": o que vem depois da primeira. */
export function resumoDaFila(fila: readonly AcaoDeVenda[]): string {
  const NOMES: Record<TipoDeVenda, [string, string]> = {
    responder: ['resposta', 'respostas'],
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

/**
 * Seg a sex, 08:00 às 17:30 de São Paulo (pedido de 16/10/2026). O aviso do Telegram só sai
 * dentro dele; a Hoje mostra a fila sempre, mas primeiro contato fora dele espera.
 */
export const EXPEDIENTE_DE_VENDA = { dias: [1, 2, 3, 4, 5], inicioMin: 8 * 60, fimMin: 17 * 60 + 30 } as const

/** São Paulo é UTC−3 o ano todo desde 2019 (o mesmo atalho de server/crm.ts). */
function relogioSP(agora: number): { dia: number; minutos: number } {
  const d = new Date(agora - 3 * 3600_000)
  return { dia: d.getUTCDay(), minutos: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

export function noExpedienteDeVenda(agora: number): boolean {
  const { dia, minutos } = relogioSP(agora)
  return (EXPEDIENTE_DE_VENDA.dias as readonly number[]).includes(dia) && minutos >= EXPEDIENTE_DE_VENDA.inicioMin && minutos < EXPEDIENTE_DE_VENDA.fimMin
}
