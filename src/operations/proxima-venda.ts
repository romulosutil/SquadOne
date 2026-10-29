import { compararPlanosComerciais, planoPedeConferenciaInterna, planoComercialDoLead, temContextoPrioridadeComercial } from './prioridade-comercial'
import { acaoInternaComercial } from './acao-interna-comercial'
/**
 * PURO: a próxima venda (16/10/2026). Uma fila só, na ordem de quem está mais perto de comprar, com
 * a mensagem já escrita para o Rômulo só revisar e mandar. Usada pelas "Conversas para você"
 * (conversas-para-conduzir.ts, os passos que não são primeiro contato), pela Ficha e pela missão da
 * Central, e pelo vendedor do servidor (server/vendedor.ts), que avisa no Telegram "Envie para X".
 * O cartão "Próxima venda" da Hoje (ProximaVenda.vue) saiu em 19/10/2026: o primeiro contato é do time
 * comercial e do "Envie para X" do Telegram, e as conversas têm a lista própria.
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
 *  4. Follow-up do 3º ao 6º dia de quem não respondeu, tenha lido ou não (curto, uma pergunta de sim ou não).
 *  5. Primeiro contato, por último, e só quando a trava de ritmo (trava-de-ritmo.ts) e o expediente
 *     de venda deixam: um por vez. O reenvio do só-robô também é primeiro contato. Quem o oferece é o
 *     vendedor do Telegram e a Ficha; a lista da tela de Vendas não (ele é da aba Primeiros contatos).
 * "Revisar prospects" fica fora: é triagem, não mensagem.
 *
 * Nada aqui envia: a fila só monta o texto e o link do WhatsApp; quem toca em enviar é o Rômulo
 * (decisão de 16/10/2026: semi-automático; a API não oficial ficou de fora pelo risco de banimento
 * do número que é também o do Hermes).
 */
import { objecoesNoTexto } from './colinha'
import { cicloDoLead } from './ciclo-comercial'
import { temQualificacaoComercial, qualificacaoComercialAtual, proximaPerguntaQualificacao, devePassarAoRomulo } from './qualificacao-comercial'
import { diaEmSP } from './retomadas'
import { ultimaRespostaDeGente } from './resultados'
import { proximoDaJornada } from './jornada'
import { gostouDepoisDoLink, indicouInteresseDepoisDoLink, propostaDeUmToque } from './mandar-proposta'
import { lacunasDoSpiced, qualificadoParaProposta } from './spiced'
import { TOQUES_DA_PROPOSTA, cadenciaDoLead, textoDoRegistroCadencia, validadeDaProposta, type DegrauDaProposta } from './cadencia'
import { ROTULO_DO_MOTIVO_DE_PERDA } from './motivos-de-perda'
import { indicacaoPendente, textoDoRegistroAarr } from './aarr'
import { fatoDoFollowup, metadataDoFollowup, textoDoFollowup, textoDoRegistroFollowup } from './followup-experimento'
import { contatoPausado } from './aprendizado-comercial'
import { comHistoricoConferido } from './historico-comercial'
import { pedeMaterial, textoParaATela } from './marcadores-da-conversa'
import { podeMandarPrimeiroContato } from './trava-de-horario'
import type { EstadoDoRitmo } from './trava-de-ritmo'
import type { CrmGrupoHoje, CrmGrupoHojeId, CrmItemHoje, CrmLead, CrmProduto, CrmVisao } from './types'
import { ehOfertaPropria, porOferta } from '../../server/ofertas.ts'
import { SIGLA_DO_PRODUTO } from './crm-formato'

export type TipoDeVenda = 'responder' | 'mandar-proposta' | 'combinado' | 'depois-do-link' | 'proposta' | 'followup' | 'desfecho' | 'primeiro'

/** Os envios que o servidor sabe anotar na aba CRM (server/crm.ts): a 2ª mensagem, o follow-up e o primeiro envio do Plus. */
export type TipoDeEnvioAnotado = 'segunda_enviada' | 'followup_enviado' | 'plus_enviado'

/** O que o "Enviei" grava na aba CRM: um envio, a proposta (o servidor põe a data de hoje) ou a recusa. */
export type AnotacaoDeVenda = TipoDeEnvioAnotado | 'proposta' | 'recusou' | 'cadencia_enviada' | 'indicacao_pedida'

export interface AcaoDeVenda {
  prioridadeComercial?: number
  evidenciaEm?: string | null
  interna?: boolean
  conferirHistorico?: boolean
  /**
   * É uma revisão comercial (a do lead com `revisaoComercial` e a "conversa sem retorno há 7 dias"), não
   * um passo comum cujo histórico falta (esse ganha `conferirHistorico` na tela e mantém a sua ordem).
   */
  revisao?: boolean
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
  /** O que o "Enviei" anota (POST /crm/venda/anotar); ausente quando não há nada a anotar (a conversa, o "o que achou?"). */
  anota?: AnotacaoDeVenda
  /** Metadados do texto efetivamente enviado; só são registrados na confirmação humana. */
  textoDoRegistro?: string
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
  /**
   * Só as ações deste lead (a Ficha, AC-12). Sem isto a Ficha via a fila inteira, onde só entra um
   * primeiro contato: o segundo lead "pronto" ficava sem ação na Ficha, embora tivesse uma.
   */
  soDoLead?: string
  /**
   * Os leads cujo primeiro contato é do time comercial (19/10/2026, `primeirosDoTime` de
   * primeiro-contato.ts): a fila não oferece o primeiro contato deles, nem na tela nem no Telegram.
   */
  primeirosDoTime?: ReadonlySet<string>
}

/** Os passos em que a mensagem do copiloto (que leu a conversa) vale mais que o texto pronto da esteira. */
const COM_COPILOTO: ReadonlySet<TipoDeVenda> = new Set(['responder'])

/** A ação ganharia com a mensagem do copiloto e ainda está com o texto pronto da esteira. */
export function esperaOCopiloto(acao: AcaoDeVenda): boolean {
  return !acao.conferirHistorico && !acao.primeiroContato && !acao.copiloto && COM_COPILOTO.has(acao.tipo)
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
  site: (e) => `Oi! Aqui é o Rômulo, do PRUMO. Sobre o site da ${e}: faz sentido colocar no ar agora ou prefere deixar para outro momento?`,
  prumo: (e) => `Oi! Aqui é o Rômulo, do PRUMO. Sobre o Raio-X da ${e}: faz sentido conversarmos por 20 minutos para escolher um ponto que vocês queiram resolver?`,
  // Ofertas próprias: sem 2ª mensagem aprovada, a pergunta é a mesma para todas.
  ...porOferta(() => () => 'Oi! Conseguiu dar uma olhada no que te mandei? O que achou?'),
  plus: () => 'Meu Ir.\'., conseguiu dar uma olhada no que te mandei? O que achou?',
}

/** Um dia depois da 2ª mensagem (link, demo ou Raio-X) sem resposta dele: perguntar o que achou. */
function acaoDepoisDoLink(lead: CrmLead, agora: number | undefined): AcaoDeVenda | null {
  if (temQualificacaoComercial(lead, agora)) return null
  if (agora === undefined || lead.etapa !== 'contato' || !lead.links.whatsapp) return null
  if (lead.proximoPasso?.data && lead.proximoPasso.data > new Date(agora - 3 * 3600_000).toISOString().slice(0, 10)) return null
  const segunda = Date.parse(lead.marcos.segundaEnviada ?? '')
  if (!Number.isFinite(segunda)) return null
  const desde = agora - segunda
  if (desde < JANELA_DO_DEPOIS_DO_LINK.deMs || desde > JANELA_DO_DEPOIS_DO_LINK.ateMs) return null
  const dele = ultimaRespostaDeGente(lead) ?? 0
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
function acaoMandarProposta(lead: CrmLead, momento?: MomentoDaVenda): AcaoDeVenda | null {
  if (momento?.quem === 'recepcao' || momento?.quem === 'robo') return null
  const qAtual = qualificacaoComercialAtual(lead)
  if (qAtual?.intencao === 'sem-interesse' || qAtual?.adequacao.estado === 'inadequada') return null
  const precoExplicito = !['bot','negativa','exclusao','licenca'].includes(lead.resposta?.tipo ?? '') && !['robo','recusa','exclusao'].includes(lead.classificacaoResposta?.classe ?? '') && objecoesNoTexto(lead.resposta?.trecho).some(o => o.id === 'quanto-custa')
  if (precoExplicito && !['ganho','perdido'].includes(lead.etapa) && !['negativa','exclusao'].includes(lead.resposta?.tipo ?? '')) return {
    chave: `${lead.id}|negociacao-humana`, leadId: lead.id, empresa: lead.empresa, produto: lead.produto, tipo: 'combinado',
    titulo: `Rômulo: responda ao pedido de preço de ${lead.empresa}`, contexto: 'Pedido comercial explícito', porque: 'Pergunta de preço pede condução humana mesmo com lacunas de qualificação.',
    tatica: 'Confira a conversa, confirme a oferta e o próximo passo. Prepare a proposta no caminho comercial com valores aprovados.', primeiroContato: false, quente: false }
  if (temQualificacaoComercial(lead)) {
    if (['ganho','perdido'].includes(lead.etapa) || ['negativa','exclusao'].includes(lead.resposta?.tipo ?? '')) return null
    const pergunta = proximaPerguntaQualificacao(lead)
    if (!pergunta && !qualificadoParaProposta(lead)) return null
    const humana = devePassarAoRomulo(lead) || lead.classificacaoResposta?.classe === 'interesse'
    return { chave: `${lead.id}|qualificacao-comercial`, leadId: lead.id, empresa: lead.empresa, produto: lead.produto,
      tipo: 'combinado', titulo: humana ? `Rômulo: conduza a negociação de ${lead.empresa}` : pergunta ? `Complete a qualificação de ${lead.empresa}` : `Prepare a proposta de ${lead.empresa}`,
      contexto: 'Qualificação comercial', porque: pergunta ? `Falta confirmar: ${pergunta.campo}.` : 'Necessidade, oferta, intenção, decisão e próximo passo conferidos.',
      tatica: pergunta ? pergunta.texto : 'Abra o caminho comercial e prepare os valores e o escopo desta proposta para revisão.', primeiroContato: false, quente: humana }
  }

  if (indicouInteresseDepoisDoLink(lead) && !qualificadoParaProposta(lead)) {
    const lacunas = lacunasDoSpiced(lead)
    const perguntas = [
      lacunas.includes('dor') && 'O que mais atrapalha hoje?',
      lacunas.includes('impacto') && 'Como isso afeta o trabalho e os clientes?',
      lacunas.includes('decisor confirmado') && 'Quem decide essa contratação com você?',
    ].filter(Boolean).join(' ')
    const texto = `Podemos marcar 10 minutos de ligação para entender o que a ${lead.empresa} precisa? Qual dia e horário funcionam para você?`
    return {
      chave: `${lead.id}|qualificar`, leadId: lead.id, empresa: lead.empresa, produto: lead.produto,
      tipo: 'combinado', titulo: `Marque 10 minutos com ${lead.empresa}`,
      contexto: 'Qualificação antes da proposta', porque: `Falta confirmar: ${lacunas.join(', ')}.`,
      tatica: perguntas, rascunho: texto,
      ...(lead.links.whatsapp ? { link: { rotulo: 'Convidar para 10 minutos', url: `${lead.links.whatsapp}${lead.links.whatsapp.includes('?') ? '&' : '?'}text=${encodeURIComponent(texto)}` } } : {}),
      primeiroContato: false, quente: true,
    }
  }
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
 * O toque da cadência (cadencia.ts). Na proposta, cada degrau tem o seu objetivo e o seu texto
 * (TOQUES_DA_PROPOSTA, 28/10/2026): D+1 útil a dúvida e quem decide, D+4 úteis 10 minutos com quem
 * decide, D+8 corridos a validade. Vale também para a proposta do ciclo comercial: cadenciaDoLead
 * acompanha a última versão enviada enquanto espera a decisão.
 * Com qualificação comercial (29/10/2026), só a cadência da PROPOSTA: o servidor vence a proposta
 * enviada desse lead no D+10 (crm.ts aplica cadenciaDoLead a todo lead), e uma proposta nunca vence
 * sem a fila ter oferecido os toques dela. A retomada da conversa continua com o caminho da
 * qualificação, que tem as próprias perguntas.
 */
function acaoDaCadencia(lead: CrmLead, ctx: ContextoDaVenda): AcaoDeVenda | null {
  if (ctx.agora === undefined) return null
  const c = cadenciaDoLead(lead, ctx.agora)
  if (!c || (c.estado !== 'tocar' && c.estado !== 'revisar')) return null
  if (c.tipo !== 'proposta' && temQualificacaoComercial(lead, ctx.agora)) return null
  const proposta = c.tipo === 'proposta'
  if (c.estado === 'revisar') return {
    chave: `${lead.id}|revisao-conversa|${c.origem}`, leadId: lead.id, empresa: lead.empresa, produto: lead.produto,
    tipo: 'combinado', titulo: `Revise o próximo passo de ${lead.empresa}`, contexto: 'Conversa sem retorno há 7 dias',
    porque: 'O silêncio pede revisão humana do combinado.', tatica: 'Confira a conversa antes de decidir retomar, esperar ou encerrar.',
    primeiroContato: false, quente: false, conferirHistorico: true, revisao: true,
  }
  const sugestao = !proposta ? ctx.sugestoes?.get(lead.id) : undefined
  // Na proposta o texto é o do degrau, sem copiloto: cada toque tem um objetivo, e nenhum leva preço nem link novo.
  const toque = proposta ? TOQUES_DA_PROPOSTA[c.registro!.degrau as DegrauDaProposta] : undefined
  const validade = validadeDaProposta(c.base)
  const fallback = toque ? toque.mensagem(validade)
    : 'Oi! Ficou alguma dúvida do que conversamos? Podemos marcar 10 minutos para entender o próximo passo?'
  const texto = sugestao?.mensagem.trim() || fallback
  return {
    chave: c.chave!, leadId: lead.id, empresa: lead.empresa, produto: lead.produto, tipo: proposta ? 'proposta' : 'depois-do-link',
    titulo: toque ? toque.titulo(lead.empresa) : `Retome a conversa com ${lead.empresa}`,
    contexto: toque ? toque.contexto(validade) : 'Conversa sem retorno: 2º dia útil',
    porque: toque ? toque.porque : 'Você respondeu e a conversa ainda não voltou.',
    tatica: toque ? toque.tatica : 'Use a leitura atual do copiloto ou a pergunta curta de descoberta.',
    rascunho: texto, ...(lead.links.whatsapp ? { link: { rotulo: 'Abrir no WhatsApp com a mensagem', url: `${lead.links.whatsapp}${lead.links.whatsapp.includes('?') ? '&' : '?'}text=${encodeURIComponent(texto)}` } } : {}),
    anota: 'cadencia_enviada', textoDoRegistro: textoDoRegistroCadencia(c.registro!), primeiroContato: false, quente: false,
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

/**
 * PURO (17/10/2026, AC-16): a chave de comparação do nicho. A planilha traz o mesmo nicho escrito de
 * jeitos diferentes ("Pilates", "pilates ", "Pilátes"), e o filtro mostrava cada grafia como uma opção.
 * Sem caixa, sem acento, espaços colapsados: a mesma palavra é um nicho só.
 */
export function chaveDoNicho(nicho: string): string {
  return nicho.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() || 'sem nicho'
}

// O rótulo curto é a sigla única (AC-19); era uma terceira cópia dela.
const ROTULO_CURTO: Record<CrmProduto, string> = SIGLA_DO_PRODUTO

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

/** O mesmo link wa.me com outro `?text=` (os demais parâmetros ficam); a URL que não é de WhatsApp volta igual. */
export function trocarTextoDoLink(url: string, texto: string): string {
  try {
    const u = new URL(url)
    if (!/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/.test(u.hostname)) return url
    const outros = [...u.searchParams].filter(([k]) => k !== 'text').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    return `${u.origin}${u.pathname}?${[...outros, `text=${encodeURIComponent(texto)}`].join('&')}`
  } catch {
    return url
  }
}

/** Número dos EUA no wa.me (1 + 10 dígitos, o critério de server/site-mensagem.ts): o texto novo é só em português. */
function linkDosEua(url: string): boolean {
  try {
    const numero = new URL(url).pathname.replace(/\D/g, '')
    return numero.startsWith('1') && numero.length === 11
  } catch {
    return false
  }
}

/**
 * PURO. O follow-up do 3º dia como a fila o mostra e abre (A/B do follow-up, 19/10/2026). O servidor
 * só monta o texto de controle (followupDe); aqui o braço sorteado por hash escolhe o que sai: A é o
 * controle intacto, B é FOLLOWUP_NOVO (com o fato do Raio-X quando há um verificável, 29/10/2026).
 * O texto mostrado, o do wa.me e o braço gravado saem da mesma decisão, para a leitura
 * (leituraDoFollowup) nunca comparar o texto antigo com ele mesmo.
 * Sem versão (`registro` ausente): link que não leva texto, número dos EUA (o novo não tem inglês)
 * ou oferta sem texto novo. Esses seguem com o controle e ficam fora do teste, em vez de entrarem
 * no braço A e sujarem a comparação.
 */
export function followupDoBraco(
  lead: Pick<CrmLead, 'produto' | 'id' | 'empresa' | 'plus'> & Partial<Pick<CrmLead, 'links' | 'achados'>>,
  link: { rotulo: string; url: string },
): {
  link: { rotulo: string; url: string }; rascunho: string; registro?: string
} {
  const controle = textoDoLink(link.url) ?? ''
  const meta = metadataDoFollowup(lead.produto, lead.id, lead.plus?.oferta)
  // Só o B leva o fato: o A é o controle e não pode mudar entre versões.
  const fato = meta.braco === 'B' ? fatoDoFollowup(lead) : null
  const texto = textoDoFollowup(lead.produto, lead.empresa, meta.braco, lead.plus?.oferta, controle, fato)
  if (!controle || linkDosEua(link.url)) return { link, rascunho: controle }
  if (meta.braco === 'A') return { link, rascunho: controle, registro: textoDoRegistroFollowup(meta) }
  // B sem molde para a oferta devolve o controle: mostrado A, então não pode ser gravado como B.
  if (texto === controle) return { link, rascunho: controle }
  return { link: { ...link, url: trocarTextoDoLink(link.url, texto) }, rascunho: texto, registro: textoDoRegistroFollowup({ ...meta, fato: Boolean(fato) }) }
}

/**
 * PURO. O `texto` que o "Enviei" manda a POST /crm/venda/anotar. A proposta leva o resumo do que saiu;
 * a cadência, o follow-up e a indicação levam o registro versionado (`textoDoRegistro`), que o servidor
 * exige (cadência e indicação sem ele são 400) ou usa para a leitura do A/B (follow-up sem ele grava
 * sem versão e fica fora do teste). O resto não anota texto. Antes a tela de conversas só mandava o da proposta.
 */
export function textoDaAnotacaoDeVenda(a: Pick<AcaoDeVenda, 'anota' | 'rascunho' | 'textoDoRegistro'>): string {
  if (a.anota === 'proposta') return a.rascunho?.slice(0, 1000) ?? ''
  if (a.anota === 'cadencia_enviada' || a.anota === 'followup_enviado' || a.anota === 'indicacao_pedida') return a.textoDoRegistro ?? ''
  return ''
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
      return 'Ele gostou: prepare a proposta com o que entra, quanto custa e quando começa. Só confirme o envio depois de enviar; abrir o WhatsApp não comprova envio.'
    case 'combinado':
      return 'Você combinou: cumprir na data é o que faz confiar. Lembre o que ele disse da última vez e proponha o próximo passo com dia e hora.'
    case 'depois-do-link':
      return 'Depois do link, confirme a dor, o impacto e quem decide. Ofereça 10 minutos de ligação para completar o que falta; só prepare a proposta com a qualificação confirmada na Ficha.'
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
  if (ehOfertaPropria(lead.produto)) return 'combine a demonstração'
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
  let link = linkDoPasso(item, lead)
  const primeiroContato = tipo === 'primeiro' || (tipo === 'followup' && Boolean(lead.reenvioDoRobo))
  let rascunho = (link && textoDoLink(link.url)) ?? (tipo === 'primeiro' ? lead.mensagemPronta : undefined)
  // Follow-up de sempre (não o reenvio do só-robô): o braço sorteado decide o texto que sai.
  let registroDoFollowup: string | undefined
  if (tipo === 'followup' && !lead.reenvioDoRobo && link && rascunho) {
    const braco = followupDoBraco(lead, link)
    link = braco.link; rascunho = braco.rascunho; registroDoFollowup = braco.registro
  }
  const anota = tipo === 'followup' && !lead.reenvioDoRobo ? 'followup_enviado' : anotaDoLink(lead, link?.url)
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
    ...(anota === 'followup_enviado' && !lead.reenvioDoRobo && rascunho && registroDoFollowup ? { textoDoRegistro: registroDoFollowup } : {}),
    primeiroContato,
    // A licença nova também é quente (pedeMaterial): fura o aviso aberto do vendedor como o "quero ver".
    quente: (tipo === 'responder' && pedeMaterial(lead.resposta)) || Boolean(item.urgente) || (tipo === 'combinado' && /atraso/.test(item.detalhe)),
  }
}

/**
 * A ordem de venda de cada passo (menor = antes): responder > mandar a proposta > combinado > "o que
 * achou?" > proposta sem retorno > revisão do contexto > follow-up > recusa para marcar > primeiro
 * contato. É a única fonte da ordem: a lista "Conversas para você" (conversas-para-conduzir.ts) lê
 * daqui, para a tela e o Telegram nunca discordarem de qual vem primeiro.
 */
export const PRIORIDADE_DA_FILA: Readonly<Record<TipoDeVenda, number>> = {
  responder: 0, 'mandar-proposta': 1, combinado: 2, 'depois-do-link': 3, proposta: 4, followup: 6, desfecho: 7, primeiro: 8,
}
/** A revisão comercial é `combinado` na fila, mas não é o combinado do lead: vem depois das propostas. */
export const PRIORIDADE_DA_REVISAO = 5
export const prioridadeDaAcao = (a: Pick<AcaoDeVenda, 'tipo' | 'revisao' | 'prioridadeComercial'>): number =>
  a.prioridadeComercial ?? (a.revisao ? PRIORIDADE_DA_REVISAO : PRIORIDADE_DA_FILA[a.tipo])

/**
 * A fila inteira, na ordem de venda. Primeiro contato (e o reenvio do só-robô) só entra com
 * `primeiroLiberado`, e no máximo um: a fila nunca oferece dois de uma vez.
 * `pulados` (chaves): o que o Rômulo deixou para depois hoje vai para o fim, sem sumir.
 */
export function filaDeVenda(visao: Pick<CrmVisao, 'hoje' | 'leads'> | null | undefined, ctx: ContextoDaVenda, pulados: ReadonlySet<string> = new Set()): AcaoDeVenda[] {
  if (!visao) return []
  const escopo = (ctx.soDoLead ? visao.leads.filter((l) => l.id === ctx.soDoLead) : visao.leads).filter(l=>l.atendimentoComercial?.alvo!=='time')
  const elegiveis = escopo.filter((l) => !contatoPausado(l))
  const revisaoDeQualificacao = (l: CrmLead) => { const q = qualificacaoComercialAtual(l, ctx.agora); return q?.intencao === 'sem-interesse' || q?.adequacao.estado === 'inadequada' }
  const agoraDaPrioridade=ctx.agora??Date.now()
  const planosComerciais=new Map(escopo.map(l=>[l.id,planoComercialDoLead(l,agoraDaPrioridade)]))
  const prioridadeCompartilhada=escopo.some(l=>temContextoPrioridadeComercial(l,agoraDaPrioridade))
  const atendimentos = escopo.filter(l=>l.atendimentoComercial||planoPedeConferenciaInterna(planosComerciais.get(l.id)!));
  const internosComerciais=new Set(atendimentos.map(l=>l.id))
  const revisoes = elegiveis.filter((l) => l.revisaoComercial || revisaoDeQualificacao(l))
  const leads = elegiveis.filter((l) => !internosComerciais.has(l.id) && !l.revisaoComercial && !revisaoDeQualificacao(l))
  const porId = new Map(leads.map((l) => [l.id, l] as [string, CrmLead]))
  const grupos = new Map(visao.hoje.map((g) => [g.id, g] as [CrmGrupoHojeId, CrmGrupoHoje]))
  const fila: AcaoDeVenda[] = revisoes.map((l) => ({
    chave: `${l.id}|revisao`, leadId: l.id, empresa: l.empresa, produto: l.produto, tipo: 'combinado',
    titulo: revisaoDeQualificacao(l) ? 'Revisar a qualificação sem retomar contato' : 'Revisar o contexto antes de encerrar ou retomar', porque: l.revisaoComercial ?? 'A revisão humana informa desinteresse ou oferta inadequada. Isso suspende as sugestões antigas de retomada.',
    tatica: revisaoDeQualificacao(l) ? 'Confira a revisão e registre o encaminhamento interno. Não insistir nem enviar outra oferta por este cartão.' : 'Confira o último combinado e salve espera, próximo passo ou encerramento. A revisão não envia mensagem.',
    contexto: 'Revisão comercial', primeiroContato: false, quente: false, conferirHistorico: true, revisao: true,
  }))
  fila.unshift(...atendimentos.map(l=>{
    const plano=planosComerciais.get(l.id)!
    // Mantém a identidade do encaminhamento já reconhecido; o sinal histórico não cria urgência.
    const propostaLegada = !l.atendimentoComercial ? acaoMandarProposta(l, ctx.sugestoes?.get(l.id)?.momento) : null
    const pedidoDePreco = propostaLegada?.chave.endsWith('|negociacao-humana') ? propostaLegada : null
    return {chave:pedidoDePreco?.chave??`${l.id}|${l.atendimentoComercial?.id??`preparo-${plano.evidencia.tipo}-${plano.em}`}|atendimento-comercial`,leadId:l.id,empresa:l.empresa,produto:l.produto,tipo:'combinado' as const,interna:true,
      titulo:l.atendimentoComercial?.titulo??pedidoDePreco?.titulo??plano.acao,contexto:pedidoDePreco?.contexto??'Revisão comercial interna',porque:l.atendimentoComercial?.motivo??pedidoDePreco?.porque??'Sinal comercial recebido; fonte e condições dependem de revisão humana.',
      tatica:`${plano.acao} ${plano.resultado}`,primeiroContato:false,quente:plano.urgente,prioridadeComercial:plano.ordem/10,evidenciaEm:plano.em}
  }))
  const cadencias = leads.flatMap(l => { const a = acaoDaCadencia(l, ctx); return a ? [a] : [] })
  const comCadencia = new Set(cadencias.map(a => a.leadId))
  fila.push(...cadencias)
  if (ctx.agora !== undefined) for (const l of leads) {
    if (l.etapa === 'perdido' || ['negativa', 'exclusao'].includes(l.resposta?.tipo ?? '') || (l.proximoPasso?.data && l.proximoPasso.data > new Date(ctx.agora - 10800_000).toISOString().slice(0, 10))) continue
    const pago = indicacaoPendente(l, ctx.agora)
    if (!pago) continue
    const rascunho = 'Oi! Como está sendo usar o que preparamos? Se conhece outra empresa que precisa dessa ajuda, pode nos apresentar?'
    fila.push({ chave: `${l.id}|indicacao|${pago.chave}`, leadId: l.id, produto: l.produto, empresa: l.empresa, tipo: 'combinado',
      titulo: `Peça uma indicação a ${l.empresa}`, contexto: '30 dias depois do primeiro pagamento confirmado', porque: 'Converse sobre o resultado e peça uma apresentação, se fizer sentido.',
      tatica: 'Confira o atendimento e envie à mão. Só confirme depois de pedir a indicação.', rascunho,
      ...(l.links.whatsapp ? { link: { rotulo: 'Pedir indicação no WhatsApp', url: `${l.links.whatsapp}${l.links.whatsapp.includes('?') ? '&' : '?'}text=${encodeURIComponent(rascunho)}` } } : {}),
      anota: 'indicacao_pedida', textoDoRegistro: textoDoRegistroAarr('indicacao_pedida', { referencia: pago.chave, data: new Date(ctx.agora - 10800_000).toISOString().slice(0, 10) }), primeiroContato: false, quente: false })
  }
  const vistas = new Set<string>()
  let primeiros = 0
  const depoisDoLink = leads.flatMap((l) => {
    const a = acaoDepoisDoLink(l, ctx.agora)
    return a ? [a] : []
  })
  const propostas = leads.flatMap((l) => {
    const ciclo = cicloDoLead(l, ctx.agora)
    if (ciclo.historico.length && !['negativa','exclusao'].includes(l.resposta?.tipo ?? '') && !l.perdaManual) {
      // A validade da proposta encerrou o lead (cadencia.ts): nada a acompanhar. No dia de um toque da
      // cadência, o toque é o passo; o cartão "acompanhe a decisão" repetiria o mesmo lead na fila.
      if (l.motivoPerda === 'proposta-sem-retorno') return []
      if (comCadencia.has(l.id) && ciclo.envios.length && !ciclo.aceites.length) return []
      const pendente = ciclo.cobrancas.find(c => c.saldo > 0)
      const titulo = ciclo.problemas.length ? 'Revise os registros comerciais' : pendente ? 'Confira o recebimento e o saldo da cobrança' : !ciclo.envios.length ? 'Revise a proposta antes de enviar' : !ciclo.aceites.length ? 'Acompanhe a decisão e registre o aceite com documento' : !ciclo.condicoes.length ? 'Defina a condição de cobrança contratada' : !ciclo.cobrancas.length ? 'Confira o gatilho antes de registrar a cobrança' : 'Confira a entrega e a próxima competência'
      return [{ chave: `${l.id}|ciclo-comercial`, leadId: l.id, empresa: l.empresa, produto: l.produto, tipo: 'combinado' as const,
        titulo, contexto: 'Proposta, contrato e pagamento', porque: pendente ? `Saldo: ${(pendente.saldo / 100).toLocaleString('pt-BR', {style:'currency',currency:'BRL'})}.` : 'Os marcos dependem de confirmação humana e fonte registrada.',
        tatica: 'Abra o caminho comercial na ficha. Confira o documento e as condições antes de avançar.', primeiroContato: false, quente: !!pendente }]
    }
    const a = acaoMandarProposta(l, ctx.sugestoes?.get(l.id)?.momento)
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
      if (tipo === 'proposta') continue // Os degraus duráveis substituem a cobrança diária legada.
      // Quem gostou depois do link já tem a proposta na fila: "responder" seria o mesmo toque, sem a marca.
      if (tipo === 'responder' && comProposta.has(lead.id)) continue
      // Quem disse não tem o desfecho na fila: "responder" seria escrever a quem recusou.
      if (comDesfecho.has(lead.id)) continue
      const acao = acaoDoItem(item, tipo, lead)
      if (vistas.has(acao.chave)) continue
      if (acao.primeiroContato && ctx.primeirosDoTime?.has(lead.id)) continue
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
  const conscientes = fila.filter(a => !comDesfecho.has(a.leadId) || a.tipo === 'desfecho')
    .map((a) => comAConversa(a, porId.get(a.leadId), ctx))
  const unicos = conscientes.sort((a, b) => {
    if(a.leadId===b.leadId)return prioridadeDaAcao(a)-prioridadeDaAcao(b)
    const pa=planosComerciais.get(a.leadId),pb=planosComerciais.get(b.leadId)
    return prioridadeCompartilhada&&pa&&pb?compararPlanosComerciais(pa,pb,`${a.produto}:${a.leadId}`,`${b.produto}:${b.leadId}`):prioridadeDaAcao(a)-prioridadeDaAcao(b)
  }).filter((a, i, todos) => todos.findIndex(b => b.leadId === a.leadId) === i)
  return [...unicos.filter((a) => !pulados.has(a.chave)), ...unicos.filter((a) => pulados.has(a.chave))]
}

/**
 * A ação com o que a conversa sabe (16/10/2026, "ainda não está consciente do que está acontecendo"):
 * a linha da última mensagem e, quando o copiloto já leu a conversa de agora, a mensagem dele no
 * lugar do texto pronto da esteira (que fica em `copiloto.padrao`). A mensagem do copiloto não anota
 * envio sozinha: se levar o link, a conversa mostra e o CRM conta.
 */
function comAConversa(acao: AcaoDeVenda, lead: CrmLead | undefined, ctx: ContextoDaVenda): AcaoDeVenda {
  if (acaoInternaComercial(acao)) return acao
  if (!lead || acao.primeiroContato || acao.conferirHistorico) return acao
  const conversa = linhaDaConversa(lead, ctx.agora)
  const sugestao = COM_COPILOTO.has(acao.tipo) ? ctx.sugestoes?.get(lead.id) : undefined
  const comLinha = conversa ? { ...acao, conversa } : acao
  if (acao.chave.endsWith('|qualificar')) return comLinha
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

// ---------------------------------------------------------------- a fila das conversas na tela

/** O "Enviei" (pulou: false) ou o "Pular" de uma ação, com o instante; vale até o fim do dia. */
export interface Resolvida { em: number; pulou: boolean }
export type Resolvidas = Record<string, Resolvida>

/** O que a tela sabe além do retrato: o relógio e as sugestões do copiloto. */
export interface EstadoDaTela {
  agora: number
  sugestoes?: ReadonlyMap<string, SugestaoDeVenda>
}

/**
 * PURO. A fila das conversas como a tela de Vendas a mostra: sem retrato legível, nada; o que foi
 * "Pulado" hoje vai para o fim; o que foi "Enviei" sai. Nunca traz primeiro contato (ele é do time
 * comercial e do "Envie para X" do Telegram): é a fila de quem já respondeu ou já recebeu algo, e por
 * isso não depende de ritmo nem de expediente. Era `ritmo: { motivo: 'dia' }` e `noExpediente: false`
 * passados só para esconder o primeiro contato (VEN-24).
 */
export function filaDaTela(visao: Pick<CrmVisao, 'hoje' | 'leads' | 'estado'> | null | undefined, tela: EstadoDaTela, resolvidas: Resolvidas = {}): AcaoDeVenda[] {
  if (!visao || visao.estado !== 'ok') return []
  const pulados = new Set(Object.entries(resolvidas).filter(([, r]) => r?.pulou).map(([k]) => k))
  const feitos = new Set(Object.entries(resolvidas).filter(([, r]) => r && !r.pulou).map(([k]) => k))
  const ctx: ContextoDaVenda = { primeiroLiberado: false, agora: tela.agora }
  if (tela.sugestoes) ctx.sugestoes = tela.sugestoes
  const porId = new Map(visao.leads.map((l) => [l.id, l]))
  return filaDeVenda(visao, ctx, pulados).filter((a) => !feitos.has(a.chave)).map((a) => comHistoricoConferido(a, porId.get(a.leadId)))
}

// ---------------------------------------------------------------- a Ficha: o "Agora" e o desfecho

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
  const acao = filaDeVenda(visao, ctx)[0]
  return acao ? comHistoricoConferido(acao, visao?.leads.find((l) => l.id === leadId)) : null
}

const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
/** "2026-10-12" → "seg 12/10"; um instante ISO vira o dia dele em São Paulo. */
export function diaCurto(valor?: string): string {
  if (!valor) return ''
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : Number.isFinite(Date.parse(valor)) ? diaEmSP(new Date(valor)) : ''
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
  if (contatoPausado(lead)) return {
    frase: lead.proximoPasso?.texto ? `Contato em espera. ${lead.proximoPasso.texto}` : 'Contato pausado por você. Aguarde uma resposta humana ou libere em “O que este lead ensinou”.', citaOProximo: true,
  }
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
export function desfechosDoLead(lead: Pick<CrmLead, 'etapa' | 'motivoPerda' | 'perdaManual' | 'ganhoManual' | 'proposta'> & Partial<Pick<CrmLead, 'motivoDaPerda'>>): DesfechosDoLead {
  const aberto = lead.etapa !== 'ganho' && lead.etapa !== 'perdido'
  // A proposta vencida (10 dias corridos, cadencia.ts) também saiu pelo prazo: ninguém marcou desfecho.
  const peloPrazo = lead.etapa === 'perdido' && !lead.perdaManual && (lead.motivoPerda === 'expirou' || lead.motivoPerda === 'esfriou' || lead.motivoPerda === 'proposta-sem-retorno')
  // O motivo da lista fechada (motivos-de-perda.ts) diz a perda marcada; sem ele, o texto de antes.
  const motivo = lead.motivoDaPerda ? `Perdeu: ${ROTULO_DO_MOTIVO_DE_PERDA[lead.motivoDaPerda].toLocaleLowerCase('pt-BR')}.` : undefined
  const marcados: DesfechoMarcado[] = []
  if (lead.ganhoManual) marcados.push({ id: 'ganhou', texto: 'Ganhou: marcado na Central.', desfazer: { tipo: 'ganhou_desfeito', rotulo: 'Desfazer o ganho' } })
  else if (lead.etapa === 'ganho') marcados.push({ id: 'ganho', texto: 'Ganho informado pela planilha. Use “Revisar classificação” nesta ficha se precisar corrigir.' })
  if (lead.perdaManual === 'recusou') marcados.push({ id: 'recusou', texto: motivo ?? 'Perdeu: ele disse não.', desfazer: { tipo: 'recusou_desfeito', rotulo: 'Desfazer a recusa' } })
  else if (lead.perdaManual === 'sem-contato') marcados.push({ id: 'sem-contato', texto: motivo ?? 'Perdeu: sem contato fácil.', desfazer: { tipo: 'sem_contato_desfeito', rotulo: 'Desfazer a perda' } })
  else if (lead.perdaManual === 'dispensado') marcados.push({ id: 'dispensado', texto: 'Dispensado na Triagem.', desfazer: { tipo: 'dispensado_desfeito', rotulo: 'Desfazer o dispensar' } })
  else if (lead.etapa === 'perdido' && !peloPrazo) marcados.push({ id: 'perdido', texto: 'Perda informada pela planilha. Use “Revisar classificação” nesta ficha se precisar corrigir.' })
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

// ---------------------------------------------------------------- expediente de venda

// A regra mora na trava de horário (uma só para toda tela, OT-02); daqui só se reexporta, porque o
// vendedor do servidor e os testes a importam deste módulo.
export { EXPEDIENTE_DE_VENDA, noExpedienteDeVenda } from './trava-de-horario'
