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
import type { Guardador } from './fila-de-envio'
import { proximoDaJornada } from './jornada'
import { gostouDepoisDoLink, propostaDeUmToque } from './mandar-proposta'
import { pedeMaterial, textoParaATela } from './marcadores-da-conversa'
import { podeMandarPrimeiroContato } from './trava-de-horario'
import type { EstadoDoRitmo } from './trava-de-ritmo'
import type { CrmGrupoHoje, CrmGrupoHojeId, CrmItemHoje, CrmLead, CrmProduto, CrmVisao } from './types'

export type TipoDeVenda = 'responder' | 'mandar-proposta' | 'combinado' | 'depois-do-link' | 'proposta' | 'followup' | 'desfecho' | 'primeiro'

/** O que o toque em "Enviei" grava na aba CRM: um envio, ou a proposta (o servidor põe a data de hoje). */
export type AnotacaoDeVenda = TipoDeEnvioAnotado | 'proposta' | 'recusou'

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
  /** Primeiro contato só deste nicho (o filtro que era da folha "Enviar um por um", OT-01); compara por chaveDoNicho. */
  nichoDoPrimeiro?: string
  /** Relógio (ms) para o "o que achou?"; ausente, esse passo não entra. */
  agora?: number
  /** leadId -> a sugestão do copiloto, quando há uma para a conversa de agora. */
  sugestoes?: ReadonlyMap<string, SugestaoDeVenda>
  /**
   * Só as ações deste lead (a Ficha, AC-12). Sem isto a Ficha via a fila inteira, onde só entra um
   * primeiro contato: o segundo lead "pronto" ficava sem ação na Ficha, embora tivesse uma.
   */
  soDoLead?: string
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
  const quem = c.ultima.direcao === 'saida' ? 'você'
    : c.ultima.papel === 'robo' ? 'a resposta automática' : c.ultima.papel === 'recepcao' ? 'a recepção' : 'ele'
  const quando = agora === undefined ? '' : `, ${haQuanto(agora - Date.parse(c.ultima.em))}`
  // O áudio que ninguém ouviu é dito assim, e não como "[áudio]" entre aspas, que parecia lido (17/10/2026).
  const texto = c.ultima.trecho ? `: “${textoParaATela(c.ultima.trecho)}”` : ' (texto não guardado)'
  return `Última mensagem: ${quem}${quando}${texto}`
}

/** A última mensagem da conversa guardada é nossa: o cartão não pode falar do "sim" dele como se fosse a vez dele. */
const jaRespondeu = (lead: Pick<CrmLead, 'conversa'>) => lead.conversa?.ultima.direcao === 'saida'

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
    titulo: fraseDaAcao('depois-do-link', lead),
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
    titulo: fraseDaAcao('mandar-proposta', lead),
    contexto: [ROTULO_CURTO[lead.produto], lead.nicho, lead.cidade].filter(Boolean).join(' · '),
    porque: lead.resposta?.trecho ? `Depois do link ele escreveu: "${textoParaATela(lead.resposta.trecho)}".` : 'Ele gostou depois do link.',
    tatica: tatica('mandar-proposta', lead),
    rascunho: proposta.texto,
    link: { rotulo: 'Mandar a proposta', url: proposta.url },
    anota: 'proposta',
    primeiroContato: false,
    quente: true,
  }
}

/**
 * Ele disse não (16/10/2026, OT-06): a resposta classificada como negativa ou exclusão, num lead
 * ainda aberto e sem a recusa marcada. A ação é registrar o desfecho em um toque (o registro
 * `recusou` da aba CRM), para o lead sair do funil e não receber follow-up. Na negativa, um
 * agradecimento curto é opcional; na exclusão, nada se escreve: ele pediu para não receber mais.
 */
function acaoDeDesfecho(lead: CrmLead): AcaoDeVenda | null {
  const tipoDaResposta = lead.resposta?.tipo
  if ((tipoDaResposta !== 'negativa' && tipoDaResposta !== 'exclusao') || lead.perdaManual) return null
  if (lead.etapa === 'ganho' || lead.etapa === 'perdido' || lead.etapa === 'novo') return null
  const agradecer = tipoDaResposta === 'negativa' && lead.links.whatsapp
    ? `Obrigado pelo retorno! Se mudar de ideia, é só me chamar por aqui.` : undefined
  const url = agradecer && lead.links.whatsapp
    ? `${lead.links.whatsapp}${lead.links.whatsapp.includes('?') ? '&' : '?'}text=${encodeURIComponent(agradecer)}` : undefined
  return {
    chave: `${lead.id}|desfecho`,
    leadId: lead.id,
    empresa: lead.empresa,
    produto: lead.produto,
    tipo: 'desfecho',
    titulo: fraseDaAcao('desfecho', lead),
    contexto: [ROTULO_CURTO[lead.produto], lead.nicho, lead.cidade].filter(Boolean).join(' · '),
    porque: lead.resposta?.trecho ? `Ele escreveu: "${textoParaATela(lead.resposta.trecho)}".` : 'A resposta dele foi classificada como recusa.',
    tatica: tatica('desfecho', lead),
    ...(agradecer ? { rascunho: agradecer } : {}),
    ...(url ? { link: { rotulo: 'Agradecer no WhatsApp', url } } : {}),
    anota: 'recusou',
    primeiroContato: false,
    quente: false,
  }
}

const ORDEM_DOS_GRUPOS: Array<[CrmGrupoHojeId, TipoDeVenda]> = [
  ['resposta', 'responder'],
  ['proximo', 'combinado'],
  ['proposta', 'proposta'],
  ['followup', 'followup'],
  ['enviar', 'primeiro'],
]

/** O nicho como o filtro mostra: vazio vira "Sem nicho" (o mesmo de fila-de-envio.ts). */
export const nichoDo = (lead: Pick<CrmLead, 'nicho'>) => lead.nicho.trim() || 'Sem nicho'

/**
 * PURO (17/10/2026, AC-16): a chave de comparação do nicho. A planilha traz o mesmo nicho escrito de
 * jeitos diferentes ("Pilates", "pilates ", "Pilátes"), e o filtro mostrava cada grafia como uma opção.
 * Sem caixa, sem acento, espaços colapsados: a mesma palavra é um nicho só.
 */
export function chaveDoNicho(nicho: string): string {
  return nicho.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() || 'sem nicho'
}

export interface NichoDaFila { chave: string; rotulo: string; quantos: number }

/**
 * PURO. Os nichos de quem espera o primeiro contato, um por chave (chaveDoNicho), do que tem mais para
 * o que tem menos. O rótulo é a grafia mais comum (empate: a primeira que apareceu).
 */
export function nichosDoPrimeiro(nichos: readonly string[]): NichoDaFila[] {
  const porChave = new Map<string, { quantos: number; grafias: Map<string, number> }>()
  for (const n of nichos) {
    const chave = chaveDoNicho(n)
    const g = porChave.get(chave) ?? { quantos: 0, grafias: new Map<string, number>() }
    const grafia = n.trim().replace(/\s+/g, ' ') || 'Sem nicho'
    g.quantos++
    g.grafias.set(grafia, (g.grafias.get(grafia) ?? 0) + 1)
    porChave.set(chave, g)
  }
  return [...porChave].map(([chave, g]) => ({
    chave, quantos: g.quantos, rotulo: [...g.grafias].reduce((a, b) => (b[1] > a[1] ? b : a))[0],
  })).sort((a, b) => b.quantos - a.quantos || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

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
      if (lead.resposta?.tipo === 'licenca') {
        return jaRespondeu(lead)
          ? 'Você já respondeu, mas o que ele deixou mandar ainda não saiu. Mande só isso, curto e sem preço; depois do material, pergunte o que achou.'
          : 'Ele deixou mandar, não disse que quer comprar: mande o que ofereceu, curto e sem preço. Depois do material, pergunte o que achou.'
      }
      if (lead.resposta?.tipo === 'interesse' && jaRespondeu(lead)) return 'Você já respondeu, mas o que ele pediu ainda não saiu: mande agora; depois, pergunte o que achou em vez de esperar.'
      if (lead.resposta?.tipo === 'interesse') return 'Ele disse sim: mande agora. Cada hora de espera esfria o "quero ver"; depois do link, pergunte o que achou em vez de esperar.'
      if (lead.resposta?.tipo === 'neutra') return 'Resposta aberta: responda curto, tire a dúvida e devolva uma pergunta de sim ou não que leve ao "quero ver".'
      return 'Responda no mesmo dia, curto, e termine com uma pergunta que ele consiga responder com uma palavra.'
    case 'mandar-proposta':
      return 'Ele gostou: a resposta é a proposta, hoje (em até 24 h do "gostei"). O que entra, quanto custa e quando começa; tocar já anota a proposta.'
    case 'combinado':
      return 'Você combinou: cumprir na data é o que faz confiar. Lembre o que ele disse da última vez e proponha o próximo passo com dia e hora.'
    case 'depois-do-link':
      return 'Depois do link, a venda está na pergunta. Se ele gostou, responda com o preço e o próximo passo com data, e marque a proposta na ficha; se tiver dúvida, ofereça 10 minutos de ligação.'
    case 'proposta':
      return 'Proposta sem retorno: não reenvie o preço. Pergunte qual dúvida ficou e ofereça 10 minutos de ligação ainda esta semana.'
    case 'followup':
      if (lead.reenvioDoRobo) return 'Só o robô respondeu: peça quem cuida disso, sem repetir a oferta.'
      return 'Leu e não respondeu: uma linha só, com uma pergunta de sim ou não. Sem cobrar, sem repetir a mensagem inteira.'
    case 'desfecho':
      if (lead.resposta?.tipo === 'exclusao') return 'Ele pediu para não receber mais: não escreva. Marque a recusa para ele sair do funil e de todo follow-up.'
      return 'Não é não: marque a recusa para ele sair do funil. Agradecer em uma linha é opcional e deixa a porta aberta.'
    case 'primeiro':
      return 'Primeira mensagem sem link e com uma pergunta: o objetivo é só a resposta. Um por vez, para o WhatsApp não ler como disparo.'
  }
}

/** O "disse sim" diz o que mandar: "mande o próximo passo" sozinho não dizia o quê (AC-12). */
function oQueMandarNoSim(lead: Pick<CrmLead, 'produto' | 'links' | 'demoApagadoEm'>): string {
  if (lead.produto === 'iris' || lead.produto === 'estampa') return 'combine a demonstração'
  if (lead.produto === 'prumo') return 'mande o Raio-X'
  if (lead.demoApagadoEm) return 'republique o demo e mande o link'
  if (lead.links.segunda) return 'mande o link'
  if (lead.links.gerarDemo) return 'gere o demo e avise que já vai'
  return 'responda com o próximo passo'
}

/**
 * PURO. A frase da ação, uma por tipo (AC-12, 17/10/2026): é o título do cartão da Próxima venda, a
 * linha do Telegram e o "Agora" da Ficha. Eram cinco redações do mesmo passo (a fila, o servidor, a
 * jornada, o prazo da jornada e a colinha), e o Rômulo não sabia se eram cinco coisas a fazer.
 * Com a leitura do copiloto (recepção, robô), quem está do outro lado manda na frase: o passo deixa de
 * ser o da esteira e passa a ser chegar a quem decide.
 */
export function fraseDaAcao(tipo: TipoDeVenda, lead: Pick<CrmLead, 'empresa' | 'produto' | 'links' | 'resposta' | 'reenvioDoRobo' | 'demoApagadoEm'> & Partial<Pick<CrmLead, 'conversa'>>, momento?: Pick<MomentoDaVenda, 'quem'>): string {
  const nome = lead.empresa
  const deQuem = momento && COM_COPILOTO.has(tipo) ? TITULO_DE_QUEM[momento.quem]?.(nome) : undefined
  if (deQuem) return deQuem
  switch (tipo) {
    case 'responder': {
      // 17/10/2026 (a Baobá): com a última mensagem nossa, nunca "disse sim"; e a licença ("pode enviar
      // sim" a "posso mandar o vídeo?") não é sim a comprar: o passo é só mandar o que foi autorizado.
      const tipoDaResposta = lead.resposta?.tipo
      if (jaRespondeu(lead)) {
        if (tipoDaResposta === 'licenca') return `Você já respondeu a ${nome}; falta mandar o que ele autorizou`
        if (tipoDaResposta === 'interesse') return `Você já respondeu a ${nome}; falta: ${oQueMandarNoSim(lead)}`
        return `Você já respondeu a ${nome}: confira a conversa antes de escrever de novo`
      }
      if (tipoDaResposta === 'licenca') return `Mande para ${nome} o que ele autorizou`
      return tipoDaResposta === 'interesse' ? `${nome} disse sim: ${oQueMandarNoSim(lead)}` : `Responda a ${nome}`
    }
    case 'mandar-proposta': return `${nome} gostou: mande a proposta`
    case 'combinado': return `Combinado com ${nome}`
    case 'depois-do-link': return `Pergunte a ${nome} o que achou`
    case 'proposta': return `Pergunte a ${nome} o que faltou na proposta`
    case 'followup': return lead.reenvioDoRobo ? `Peça o responsável na ${nome}` : `Follow-up para ${nome}`
    case 'desfecho': return `${nome} disse não: marque a recusa`
    case 'primeiro': return `Envie a primeira mensagem para ${nome}`
  }
}

/** wa.me ou whatsapp.com: abre a conversa, com ou sem texto. */
function abreOWhatsApp(url: string): boolean {
  try {
    return /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * PURO. O link do passo, escolhido pelo tipo e nunca pela posição (AC-05, 17/10/2026). O servidor
 * põe o "Gerar demo" antes da conversa no "quer ver" sem 2ª mensagem, e o `links[0]` de antes fazia
 * o botão "Abrir a conversa no WhatsApp" chamar o webhook gerar_demo do n8n. A ordem: a mensagem
 * pronta (wa.me com texto), o link do n8n que marca o envio (envio, convite, 2ª, follow-up) e a
 * conversa. O "Gerar demo" e o que não abre o WhatsApp (demo, Maps) nunca são o link da fila: a fila
 * só abre o WhatsApp; gerar o demo é o botão da Ficha.
 */
export function linkDoPasso(item: Pick<CrmItemHoje, 'links'>, lead: Pick<CrmLead, 'links'>): { rotulo: string; url: string } | undefined {
  const l = lead.links
  const candidatos = item.links.filter((x) => !(l.gerarDemo && x.url === l.gerarDemo) && !/^gerar\b/i.test(x.rotulo.trim()))
  const doN8n = new Set([l.enviar, l.convite, l.segunda, l.followup].filter((u): u is string => Boolean(u)))
  return candidatos.find((x) => textoDoLink(x.url) !== null)
    ?? candidatos.find((x) => doN8n.has(x.url))
    ?? candidatos.find((x) => x.url === l.whatsapp || abreOWhatsApp(x.url))
}

function anotaDoLink(lead: CrmLead, url: string | undefined): TipoDeEnvioAnotado | undefined {
  if (!url) return undefined
  if (lead.produto === 'plus' && url === lead.links.enviar) return 'plus_enviado'
  if (url === lead.links.segunda) return 'segunda_enviada'
  if (url === lead.links.followup) return 'followup_enviado'
  return undefined
}

function acaoDoItem(item: CrmItemHoje, tipo: TipoDeVenda, lead: CrmLead): AcaoDeVenda {
  const link = linkDoPasso(item, lead)
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
    titulo: fraseDaAcao(tipo, lead),
    contexto: lugar,
    porque: [item.acao, item.detalhe].filter(Boolean).join('. ').replace(/\.\./g, '.'),
    tatica: tatica(tipo, lead),
    ...(rascunho ? { rascunho } : {}),
    ...(link ? { link } : {}),
    ...(anota ? { anota } : {}),
    primeiroContato,
    // A licença nova também é quente (pedeMaterial): fura o aviso aberto do vendedor como o "quero ver".
    quente: (tipo === 'responder' && pedeMaterial(lead.resposta)) || Boolean(item.urgente) || (tipo === 'combinado' && /atraso/.test(item.detalhe)),
  }
}

/**
 * A fila inteira, na ordem de venda. Primeiro contato (e o reenvio do só-robô) só entra com
 * `primeiroLiberado`, e no máximo um: a fila nunca oferece dois de uma vez.
 * `pulados` (chaves): o que o Rômulo deixou para depois hoje vai para o fim, sem sumir.
 */
export function filaDeVenda(visao: Pick<CrmVisao, 'hoje' | 'leads'> | null | undefined, ctx: ContextoDaVenda, pulados: ReadonlySet<string> = new Set()): AcaoDeVenda[] {
  if (!visao) return []
  const leads = ctx.soDoLead ? visao.leads.filter((l) => l.id === ctx.soDoLead) : visao.leads
  const porId = new Map(leads.map((l) => [l.id, l] as [string, CrmLead]))
  const grupos = new Map(visao.hoje.map((g) => [g.id, g] as [CrmGrupoHojeId, CrmGrupoHoje]))
  const fila: AcaoDeVenda[] = []
  const vistas = new Set<string>()
  let primeiros = 0
  const depoisDoLink = leads.flatMap((l) => {
    const a = acaoDepoisDoLink(l, ctx.agora)
    return a ? [a] : []
  })
  const propostas = leads.flatMap((l) => {
    const a = acaoMandarProposta(l)
    return a ? [a] : []
  })
  const comProposta = new Set(propostas.map((a) => a.leadId))
  const desfechos = leads.flatMap((l) => {
    const a = acaoDeDesfecho(l)
    return a ? [a] : []
  })
  const comDesfecho = new Set(desfechos.map((a) => a.leadId))
  for (const [grupo, tipo] of ORDEM_DOS_GRUPOS) {
    if (grupo === 'proximo') {
      for (const a of propostas) if (!vistas.has(a.chave)) { vistas.add(a.chave); fila.push(a) }
    }
    if (grupo === 'proposta') {
      for (const a of depoisDoLink) if (!vistas.has(a.chave)) { vistas.add(a.chave); fila.push(a) }
    }
    // O desfecho vem antes do primeiro contato: limpar o funil de quem disse não protege o número.
    if (grupo === 'enviar') {
      for (const a of desfechos) if (!vistas.has(a.chave)) { vistas.add(a.chave); fila.push(a) }
    }
    for (const item of grupos.get(grupo)?.itens ?? []) {
      const lead = porId.get(item.leadId)
      if (!lead) continue
      // Quem gostou depois do link já tem a proposta na fila: "responder" seria o mesmo toque, sem a marca.
      if (tipo === 'responder' && comProposta.has(lead.id)) continue
      // Quem disse não tem o desfecho na fila: "responder" seria escrever a quem recusou.
      if ((tipo === 'responder' || tipo === 'followup') && comDesfecho.has(lead.id)) continue
      const acao = acaoDoItem(item, tipo, lead)
      if (vistas.has(acao.chave)) continue
      if (acao.primeiroContato && ctx.nichoDoPrimeiro && chaveDoNicho(nichoDo(lead)) !== chaveDoNicho(ctx.nichoDoPrimeiro)) continue
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
  const titulo = m ? fraseDaAcao(acao.tipo, lead, m) : acao.titulo
  const comSugestao: AcaoDeVenda = {
    ...comLinha,
    ...(titulo !== acao.titulo ? { titulo, quente: false } : {}),
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
    desfecho: ['recusa para marcar', 'recusas para marcar'],
    primeiro: ['primeiro contato', 'primeiros contatos'],
  }
  const conta = new Map<TipoDeVenda, number>()
  for (const a of fila) conta.set(a.tipo, (conta.get(a.tipo) ?? 0) + 1)
  return [...conta].map(([t, n]) => `${n} ${NOMES[t][n === 1 ? 0 : 1]}`).join(' · ')
}

// ---------------------------------------------------------------- a fila da tela e a contagem do dia

/** O "Enviei" (pulou: false) ou o "Pular" de uma ação, com o instante; vale até o fim do dia. */
export interface Resolvida { em: number; pulou: boolean }
export type Resolvidas = Record<string, Resolvida>

/** A mesma chave que a Próxima venda sempre usou: trocar perderia o que já foi resolvido hoje. */
export const CHAVE_DAS_RESOLVIDAS = 'squadone:venda:resolvidas'
const diaDeSP = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10)

/**
 * O que esta tela resolveu hoje (reserva do servidor, GET /api/operations/crm/venda). Morava no
 * ProximaVenda.vue; veio para cá para a aba "A fazer" do CrmPanel contar a mesma fila sem o cartão
 * montado (AC-02). Outro dia, ou storage ilegível, é fila sem nada resolvido.
 */
export function lerResolvidas(storage: Guardador | null | undefined, agora: number): Resolvidas {
  try {
    const bruto = JSON.parse(storage?.getItem(CHAVE_DAS_RESOLVIDAS) ?? '{}')
    if (bruto?.dia === diaDeSP(agora) && bruto.itens && typeof bruto.itens === 'object' && !Array.isArray(bruto.itens)) return bruto.itens as Resolvidas
  } catch { /* sem storage: só nesta visita */ }
  return {}
}

export function gravarResolvidas(storage: Guardador | null | undefined, itens: Resolvidas, agora: number): void {
  try { storage?.setItem(CHAVE_DAS_RESOLVIDAS, JSON.stringify({ dia: diaDeSP(agora), itens })) } catch { /* idem */ }
}

/** O que a tela sabe além do retrato: o ritmo, o expediente, o "Liberar", o copiloto e o nicho escolhido. */
export interface EstadoDaTela {
  ritmo: Pick<EstadoDoRitmo, 'motivo'>
  noExpediente: boolean
  agora: number
  liberados?: ReadonlySet<string>
  sugestoes?: ReadonlyMap<string, SugestaoDeVenda>
  /** Primeiro contato só deste nicho; vazio = todos. */
  nicho?: string
}

/**
 * PURO. A fila exatamente como a Próxima venda mostra: sem retrato legível, nada; o que foi
 * "Pulado" hoje vai para o fim; o que foi "Enviei" sai. O cartão e a aba "A fazer" leem daqui,
 * para os dois números nunca mais divergirem (eram 183 na aba e 3 no cartão em 16/10/2026).
 */
export function filaDaTela(visao: Pick<CrmVisao, 'hoje' | 'leads' | 'estado'> | null | undefined, tela: EstadoDaTela, resolvidas: Resolvidas = {}): AcaoDeVenda[] {
  if (!visao || visao.estado !== 'ok') return []
  const ritmoLivre = tela.ritmo.motivo === null
  const pulados = new Set(Object.entries(resolvidas).filter(([, r]) => r?.pulou).map(([k]) => k))
  const feitos = new Set(Object.entries(resolvidas).filter(([, r]) => r && !r.pulou).map(([k]) => k))
  const ctx: ContextoDaVenda = { primeiroLiberado: ritmoLivre && tela.noExpediente, ritmoLivre, agora: tela.agora }
  if (tela.liberados) ctx.liberados = tela.liberados
  if (tela.sugestoes) ctx.sugestoes = tela.sugestoes
  if (tela.nicho) ctx.nichoDoPrimeiro = tela.nicho
  return filaDeVenda(visao, ctx, pulados).filter((a) => !feitos.has(a.chave))
}

/**
 * Os quatro tipos que a tela conta, mais a recusa para marcar (que também é um toque da fila).
 * O combinado é responder a quem espera por nós; o "o que achou?" é o follow-up depois do link;
 * o reenvio do só-robô conta como primeiro contato, como na trava de ritmo.
 */
export type GrupoDaFila = 'responder' | 'proposta' | 'followup' | 'primeiro' | 'desfecho'

const GRUPO_DO_TIPO: Record<TipoDeVenda, GrupoDaFila> = {
  responder: 'responder', combinado: 'responder',
  'mandar-proposta': 'proposta', proposta: 'proposta',
  followup: 'followup', 'depois-do-link': 'followup',
  primeiro: 'primeiro', desfecho: 'desfecho',
}

export interface ResumoDoDia {
  /**
   * Quantas ações a Próxima venda mostra, a atual incluída. É o N da aba "A fazer", do "N na fila"
   * do cartão e do "Ver a fila inteira (N)": o mesmo número nos três lugares.
   */
  total: number
  porGrupo: Record<GrupoDaFila, number>
  /** Primeiros contatos prontos no retrato (o grupo "enviar"), entrem ou não na fila agora. */
  primeirosProntos: number
  /**
   * Quantos primeiros contatos o ritmo ainda deixa sair hoje: o teto do dia menos os enviados, e 0
   * na pausa (que pode durar além de hoje: melhor prometer de menos). Nunca mais que os prontos.
   */
  primeirosAindaHoje: number
}

/** PURO. A contagem da fila do dia, de onde todo rótulo da Próxima venda e da aba lê. */
export function resumoDoDia(
  fila: readonly Pick<AcaoDeVenda, 'tipo' | 'primeiroContato'>[],
  visao: Pick<CrmVisao, 'hoje'> | null | undefined,
  ritmo: Pick<EstadoDoRitmo, 'motivo' | 'enviadosHoje' | 'teto'>,
): ResumoDoDia {
  const porGrupo: Record<GrupoDaFila, number> = { responder: 0, proposta: 0, followup: 0, primeiro: 0, desfecho: 0 }
  for (const a of fila) porGrupo[a.primeiroContato ? 'primeiro' : GRUPO_DO_TIPO[a.tipo]]++
  const primeirosProntos = visao?.hoje.find((g) => g.id === 'enviar')?.itens.length ?? 0
  const restam = ritmo.motivo === 'pausa' ? 0 : Math.max(0, ritmo.teto - ritmo.enviadosHoje)
  return { total: fila.length, porGrupo, primeirosProntos, primeirosAindaHoje: Math.min(restam, primeirosProntos) }
}

/**
 * PURO. "165 primeiros contatos prontos · até 10 hoje": quantos esperam e quantos o ritmo ainda deixa.
 * Sem nenhum que caiba hoje, só a contagem: o motivo (teto, pausa, horário) vem na frase seguinte.
 */
export function textoDosPrimeiros(resumo: Pick<ResumoDoDia, 'primeirosProntos' | 'primeirosAindaHoje'>): string {
  const n = resumo.primeirosProntos
  if (!n) return ''
  const prontos = n === 1 ? '1 primeiro contato pronto' : `${n} primeiros contatos prontos`
  return resumo.primeirosAindaHoje > 0 ? `${prontos} · até ${resumo.primeirosAindaHoje} hoje` : prontos
}

// ---------------------------------------------------------------- a Ficha: o "Agora", o desfecho e o anotar

/**
 * PURO. A ação da fila para um lead só, como a Próxima venda a daria (AC-12): o horário e o ritmo
 * contam como livres (a Ficha diz o que fazer; as travas dizem quando). `sugestao`: a do copiloto
 * para a conversa de agora, a mesma que a Próxima venda usa, para a frase dos dois lugares ser uma.
 */
export function acaoDoLead(
  visao: Pick<CrmVisao, 'hoje' | 'leads'> | null | undefined, leadId: string, agora: number, sugestao?: SugestaoDeVenda,
): AcaoDeVenda | null {
  const ctx: ContextoDaVenda = { primeiroLiberado: true, agora, soDoLead: leadId }
  if (sugestao) ctx.sugestoes = new Map([[leadId, sugestao]])
  return filaDeVenda(visao, ctx)[0] ?? null
}

const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
/** "2026-10-12" → "seg 12/10"; um instante ISO vira o dia dele em São Paulo. */
export function diaCurto(valor?: string): string {
  if (!valor) return ''
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : Number.isFinite(Date.parse(valor)) ? diaDeSP(Date.parse(valor)) : ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia)
  if (!m) return ''
  return `${DIAS_DA_SEMANA[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()]} ${m[3]}/${m[2]}`
}

export interface AgoraDaFicha {
  /** A frase única: a da ação da fila (fraseDaAcao), ou o porquê de não haver nada a fazer. */
  frase: string
  /** Como fazer (a tática da fila); ausente sem ação. */
  como?: string
  /** A frase já diz o próximo passo salvo: a Ficha não o repete embaixo. */
  citaOProximo: boolean
}

const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

/**
 * PURO. O "Agora" da Ficha (AC-12): com ação na fila, a frase dela (a mesma do cartão da Próxima
 * venda); sem ação, dizer claramente que não há nada a fazer e por quê, em vez de inventar um passo.
 * Eram três "agoras" (copiloto, fila e jornada) e uma linha "Na jornada: …" com uma quarta redação.
 */
export function agoraDaFicha(lead: CrmLead, acao: Pick<AcaoDeVenda, 'titulo' | 'tatica'> | null): AgoraDaFicha {
  if (acao) return { frase: acao.titulo, como: acao.tatica, citaOProximo: false }
  if (lead.etapa === 'ganho') return { frase: 'Ganho: nada a vender agora. É entregar e começar a mensalidade.', citaOProximo: false }
  if (lead.etapa === 'perdido') return { frase: 'Fora do funil: nada a mandar, a não ser que ele volte a escrever.', citaOProximo: false }
  const salvo = lead.proximoPasso
  if (salvo?.texto) {
    const quando = diaCurto(salvo.data)
    return { frase: `Nada para fazer com ele agora; o próximo passo salvo é “${salvo.texto}”${quando ? `, para ${quando}` : ''}.`, citaOProximo: true }
  }
  if (lead.etapa === 'contato' || lead.etapa === 'proposta') {
    // A última coisa que saiu daqui: dali conta a espera.
    const nossas = [lead.conversa?.ultimaSaida, lead.marcos.followupEnviado, lead.marcos.segundaEnviada, lead.proposta?.em, lead.marcos.enviado]
      .map((v) => Date.parse(v ?? '')).filter(Number.isFinite)
    if (nossas.length) return { frase: `Esperando a resposta dele desde ${diaCurto(new Date(Math.max(...nossas)).toISOString())}.`, citaOProximo: false }
  }
  // Novo lead: a vez é do robô, ou a primeira mensagem ainda não entrou na Hoje (o Plus passa de 10).
  return { frase: `Nada para fazer com ele agora: ${minuscula(proximoDaJornada(lead).acao)}.`, citaOProximo: false }
}

/** Os registros de desfecho da aba CRM (os de ganho e dispensar são de 17/10/2026, AC-08 e AC-10). */
export type RegistroDeDesfecho =
  | 'ganhou' | 'ganhou_desfeito' | 'recusou' | 'recusou_desfeito' | 'sem_contato' | 'sem_contato_desfeito'
  | 'proposta' | 'proposta_desfeita' | 'dispensado_desfeito'

export interface DesfechoMarcado {
  id: 'ganhou' | 'ganho' | 'recusou' | 'sem-contato' | 'dispensado' | 'perdido' | 'proposta'
  /** O estado, em palavra (RULES 3). */
  texto: string
  /** O desfazer certo; ausente quando o desfecho veio de fora (planilha, página do n8n). */
  desfazer?: { tipo: RegistroDeDesfecho; rotulo: string }
}

export interface DesfechosDoLead {
  marcados: DesfechoMarcado[]
  /** Os três toques da faixa "Desfecho". */
  ganhar: boolean
  perder: boolean
  proposta: boolean
}

/**
 * PURO. O que a faixa "Desfecho" da Ficha mostra (AC-08): o desfecho marcado com o desfazer dele, e os
 * toques que ainda cabem. Vale para todas as ofertas, o Plus inclusive (o ganho e a perda são registros
 * da aba CRM, não colunas de planilha). Perdido pelo prazo (7 dias sem mensagem) não teve desfecho:
 * ainda cabe ganhar e marcar a proposta, que o trazem de volta; perder de novo não faz sentido.
 */
export function desfechosDoLead(lead: Pick<CrmLead, 'etapa' | 'motivoPerda' | 'perdaManual' | 'ganhoManual' | 'proposta'>): DesfechosDoLead {
  const aberto = lead.etapa !== 'ganho' && lead.etapa !== 'perdido'
  const peloPrazo = lead.etapa === 'perdido' && !lead.perdaManual && (lead.motivoPerda === 'expirou' || lead.motivoPerda === 'esfriou')
  const marcados: DesfechoMarcado[] = []
  if (lead.ganhoManual) marcados.push({ id: 'ganhou', texto: 'Ganhou: marcado na Central.', desfazer: { tipo: 'ganhou_desfeito', rotulo: 'Desfazer o ganho' } })
  else if (lead.etapa === 'ganho') marcados.push({ id: 'ganho', texto: 'Ganhou, pela planilha. Para desfazer, use a página do lead no n8n.' })
  if (lead.perdaManual === 'recusou') marcados.push({ id: 'recusou', texto: 'Perdeu: ele disse não.', desfazer: { tipo: 'recusou_desfeito', rotulo: 'Desfazer a recusa' } })
  else if (lead.perdaManual === 'sem-contato') marcados.push({ id: 'sem-contato', texto: 'Perdeu: sem contato fácil.', desfazer: { tipo: 'sem_contato_desfeito', rotulo: 'Desfazer a perda' } })
  else if (lead.perdaManual === 'dispensado') marcados.push({ id: 'dispensado', texto: 'Dispensado na Triagem.', desfazer: { tipo: 'dispensado_desfeito', rotulo: 'Desfazer o dispensar' } })
  else if (lead.etapa === 'perdido' && !peloPrazo) marcados.push({ id: 'perdido', texto: 'Perdido, pela planilha. Para desfazer, use a página do lead no n8n.' })
  if (lead.etapa === 'proposta') {
    const quando = diaCurto(lead.proposta?.data || lead.proposta?.em)
    marcados.push({ id: 'proposta', texto: `Proposta enviada${quando ? ` ${quando}` : ''}.`, desfazer: { tipo: 'proposta_desfeita', rotulo: 'Desfazer a proposta' } })
  }
  return {
    marcados,
    ganhar: aberto || peloPrazo,
    perder: aberto,
    proposta: (aberto && lead.etapa !== 'proposta') || peloPrazo,
  }
}

/**
 * Os sinais de "já falou com a gente" (espelho de SINAIS_DE_CONVERSA em server/crm.ts): o servidor
 * recusa a 2ª mensagem fora deles e o follow-up dentro deles, e um botão que sempre erra é pior que nenhum.
 */
const SINAIS_DE_CONVERSA: ReadonlySet<CrmLead['sinal']> = new Set(['respondeu', 'em-conversa', 'respondeu-prumo', 'diagnostico'])

/**
 * PURO. Os envios que a Ficha deixa anotar à mão em "Anotar" (AC-09): a 2ª mensagem e o follow-up
 * quando o lead está no passo deles, ou quando a anotação do toque falhou (o "anote à mão" aponta para
 * cá). Só os que o servidor aceitaria (conferirEnvio): lead aberto, Em contato, em conversa ou não.
 */
export function anotacoesAMao(
  lead: Pick<CrmLead, 'etapa' | 'sinal' | 'links' | 'marcos' | 'resposta' | 'followupHoje'>, comFalha: boolean,
): Array<'segunda_enviada' | 'followup_enviado'> {
  if (lead.etapa !== 'contato') return []
  const emConversa = SINAIS_DE_CONVERSA.has(lead.sinal)
  if (emConversa) {
    // A licença (17/10/2026) também: o material que ele deixou mandar é a 2ª mensagem.
    const noPasso = !lead.marcos.segundaEnviada && (Boolean(lead.links.segunda) || pedeMaterial(lead.resposta))
    return noPasso || comFalha ? ['segunda_enviada'] : []
  }
  return lead.followupHoje || Boolean(lead.links.followup) || comFalha ? ['followup_enviado'] : []
}

// ---------------------------------------------------------------- expediente de venda

// A regra mora na trava de horário (uma só para toda tela, OT-02); daqui só se reexporta, porque o
// vendedor do servidor e os testes a importam deste módulo.
export { EXPEDIENTE_DE_VENDA, noExpedienteDeVenda } from './trava-de-horario'
