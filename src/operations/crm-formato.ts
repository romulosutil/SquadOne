import { ROTULO_DO_FOLLOWUP, ROTULO_DO_REENVIO } from '../../server/site-mensagem.ts'
import type { CrmEtapa, CrmLead, CrmProduto, CrmRegimeDaMensagem, CrmTipoDeResposta } from './types'
import { raioXAvulso } from '../../server/site-mensagem.ts'
import { textoParaATela } from './marcadores-da-conversa'

// Textos do CRM usados pelas três vistas (Hoje, Funil e Ficha).

/**
 * O rótulo do link de follow-up: "Pedir o responsável" quando é o reenvio do só-robô (14/10/2026).
 * O texto vem de server/site-mensagem.ts, o mesmo que a Hoje do servidor usa: um lugar só.
 */
export function rotuloDoFollowup(lead: Pick<CrmLead, 'reenvioDoRobo'>): string {
  return lead.reenvioDoRobo ? ROTULO_DO_REENVIO : ROTULO_DO_FOLLOWUP
}

export const ETAPAS: CrmEtapa[] = ['novo', 'contato', 'proposta', 'ganho', 'perdido']

/** O espelho de DIAS_SEM_RESPOSTA (server/crm.ts): só para os textos; quem decide é o servidor. */
export const DIAS_SEM_RESPOSTA = 7

export const ROTULO_DA_ETAPA: Record<CrmEtapa, string> = {
  novo: 'Novo',
  contato: 'Em contato',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
}

export const DICA_DA_ETAPA: Record<CrmEtapa, string> = {
  novo: 'Site na fila ou pronto; prospect para revisar',
  contato: `Enviado ou respondeu; ${DIAS_SEM_RESPOSTA} dias sem mensagem do lead = Perdido`,
  proposta: 'Proposta enviada (marcada à mão)',
  ganho: 'Ganhou: marcado na Central, na página do lead ou na planilha',
  perdido: 'Recusou, sem resposta, parou de responder ou descartado',
}

/**
 * Um nome por coisa (AC-13, 17/10/2026): na tela o estado é "Ganho" e o verbo é "Ganhou", mas o
 * servidor manda "Fechou (marcado na Central)", "Concluído (Etapa na planilha)" e o evento "Fechou em
 * dd/mm". O mesmo com a leitura: o servidor diz "Viu, sem resposta" e Números diz "Leram". O texto
 * do servidor fica (os testes de server/crm e o histórico da aba CRM dependem dele); a tradução é
 * aqui, no último passo antes da tela.
 */
export function textoDaSubEtapa(sub: string): string {
  return sub.replace(/^Fechou\b/, 'Ganho').replace(/^Concluído \(/, 'Ganho (').replace(/^Viu\b/, 'Leu')
}

/** O rótulo e o texto de um evento da linha do tempo: o desfecho é um fato, então o verbo. */
export function textoDoEvento(texto: string): string {
  // O trecho da resposta pode ser só o marcador de um áudio que ninguém ouviu (17/10/2026).
  return textoParaATela(texto).replace(/^Fechou\b/, 'Ganhou').replace(/^Viu a mensagem\b/, 'Leu a mensagem')
}

export const ROTULO_DA_PERDA: Record<NonNullable<CrmLead['motivoPerda']>, string> = {
  recusou: 'Recusou',
  expirou: 'Sem resposta',
  esfriou: 'Parou de responder',
  'sem-interesse': 'Sem interesse',
  'sem-contato': 'Sem contato',
  descartado: 'Descartado',
}

/** "Perdido em 3 dias" para quem está Em contato; vazio quando um próximo passo segura o lead. */
export function textoDoPrazo(lead: CrmLead): string {
  if (lead.etapa !== 'contato' || lead.diasParaSair === undefined) return ''
  return lead.diasParaSair <= 1 ? 'Perdido amanhã' : `Perdido em ${lead.diasParaSair} dias`
}

// O que o lead respondeu, classificado pelo n8n a partir do texto (05/10/2026).
export const ROTULO_DA_RESPOSTA: Record<CrmTipoDeResposta, string> = {
  negativa: 'Negativa',
  exclusao: 'Pediu para apagar',
  interesse: 'Interesse',
  licenca: 'Deixou mandar',
  neutra: 'Sem sim nem não',
  bot: 'Só robô',
}

// PRUMO como holding (14/10/2026): as quatro ofertas são do PRUMO e dividem o mesmo funil.
export const PRODUTOS: readonly CrmProduto[] = ['site', 'prumo', 'iris', 'estampa', 'plus']
export const ROTULO_DO_PRODUTO: Record<CrmProduto, string> = {
  site: 'Site antes da venda', prumo: 'Serviços PRUMO', iris: 'Iris · Clínicas', estampa: 'CRM de estamparia', plus: 'Plus',
}
/**
 * O rótulo curto de cada oferta, o MESMO no celular e no desktop (AC-19, 17/10/2026): nos chips do
 * filtro, no selo do cartão e na Lista. O celular dizia "Organizar" e "Estampa" e o desktop "Serviços
 * PRUMO" e "CRM de estamparia": pareciam ofertas diferentes. É o rótulo da linha de contexto da
 * Próxima venda (ROTULO_CURTO de proxima-venda.ts); o longo fica para a Ficha.
 */
export const SIGLA_DO_PRODUTO: Record<CrmProduto, string> = { site: 'Site', prumo: 'PRUMO', iris: 'Iris', estampa: 'Estamparia', plus: 'Plus' }
/** Plus (15/10/2026): a oferta que o lead recebe, na ordem em que o filtro a mostra. */
// É o rótulo curto (AC-13): era um terceiro jogo de nomes, com "Serviços PRUMO" entre siglas.
export const ROTULO_DA_OFERTA_DO_PLUS = {
  site: SIGLA_DO_PRODUTO.site, prumo: SIGLA_DO_PRODUTO.prumo, iris: SIGLA_DO_PRODUTO.iris, estampa: SIGLA_DO_PRODUTO.estampa,
} as const
/** O primeiro contato: o Site manda o site pronto, as outras ofertas um convite para conversar. */
export const ehConvite = (produto: CrmProduto) => produto !== 'site' && produto !== 'plus'

const FUSO = 'America/Sao_Paulo'

export function dataCurta(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO }).format(new Date(t))
}

export function dataHora(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: FUSO })
    .format(new Date(t)).replace(',', '')
}

export function hora(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO }).format(new Date(t))
}

/** "2026-10-02" escolhido num campo de data, mostrado como 02/10. */
export function diaEscolhido(valor?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor ?? '')
  return m ? `${m[3]}/${m[2]}` : valor ?? ''
}

/** Hoje em São Paulo, no formato do campo de data (AAAA-MM-DD). */
export function hojeEmSP(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

export function textoDeDias(n?: number): string {
  if (n === undefined) return ''
  if (n === 0) return 'hoje'
  if (n === 1) return '1 dia'
  return `${n} dias`
}

export function diasNaEtapa(lead: CrmLead): string {
  return lead.diasNaEtapa === undefined ? 'sem data' : lead.diasNaEtapa === 0 ? 'desde hoje' : `há ${textoDeDias(lead.diasNaEtapa)}`
}

export function onde(lead: CrmLead): string {
  return [lead.nicho, lead.cidade].filter(Boolean).join(' · ') || 'Sem nicho e cidade'
}

/**
 * O texto da 1ª mensagem pela data do envio (regimeDaMensagem em server/crm.ts, a regra do
 * funil-aprendizado.py). Até 04/10 o link ia na 1ª; desde 05/10 ela pede licença e o link vai na 2ª.
 */
export const ROTULO_DO_REGIME: Record<CrmRegimeDaMensagem, string> = {
  curta_com_link: 'Com link na 1ª mensagem (curta, até 29/09)',
  prumo_com_link: 'Com link na 1ª mensagem (30/09 a 04/10)',
  duas_mensagens: 'Pedido de licença, sem link',
}

/**
 * O rótulo curto do link da segunda mensagem (Funil). Espelha `oQueASegundaLeva` (server/crm.ts): com o Raio-X
 * avulso (demo sob pedido, 14/10/2026), só o raio-x antes do demo e só o demo depois do botão "Gerar demo".
 */
export function rotuloDaSegunda(lead: Pick<CrmLead, 'produto' | 'abordagem' | 'links'>): string {
  if (lead.produto === 'prumo') return 'Mandar o Raio-X'
  if (lead.abordagem?.mensagem !== 'C' || !lead.links.raioX) return 'Mandar o link'
  if (!raioXAvulso(lead.links.raioX)) return 'Mandar o raio-x e o demo'
  return lead.links.site ? 'Mandar o demo' : 'Mandar o raio-x'
}

/** Leitura dita com honestidade: sem confirmação de leitura, é desconhecida (RULES 2 e 15). */
// O que o lead do Site recebeu (07/10/2026): "Mensagem A · site personalizado-v2".
// Sem a letra (envios até 07/10), o regime pela data diz ao menos se o link ia na 1ª. Só no Site:
// o regime é a regra do texto do Site, e no PRUMO seria palpite sobre o convite.
export function textoDaAbordagem(lead: CrmLead): string {
  const { mensagem, site, video, regime } = lead.abordagem ?? {}
  const msg = !mensagem ? (regime && lead.produto === 'site' ? ROTULO_DO_REGIME[regime].toLowerCase() : '')
    : mensagem === 'manual' ? 'mensagem escrita à mão (sem o link do Balcão)'
    : mensagem === 'EN' ? 'mensagem em inglês' : mensagem === 'C' ? 'mensagem C (oferece o raio-x)' : `mensagem ${mensagem}`
  // A/B do vídeo (ab-video.ts): só quando a coluna `braco_video` diz algo.
  const comVideo = video === 'video' ? 'com vídeo (teste A/B)' : video === 'sem-video' ? 'sem vídeo (teste A/B)' : ''
  const partes = [msg, site ? `site ${site}` : '', comVideo].filter(Boolean)
  return partes.length ? partes.join(' · ').replace(/^./, (c) => c.toUpperCase()) : ''
}

export function textoDaLeitura(lead: CrmLead): string {
  // "Leu", como os "Leram" de Números (AC-13): o marco do cartão dizia "Viu".
  if (lead.leitura === 'viu') return `Leu ${dataCurta(lead.marcos.visto)}`
  if (lead.leitura === 'pela-resposta') return 'Leu (respondeu)'
  if (lead.leitura === 'desconhecida') return 'Leitura desconhecida'
  return ''
}
