import type { CrmLead } from './types'

/** O rótulo não presume que um plano escrito em linguagem livre autoriza contato. */
export function intencaoDoPasso(texto: string): 'espera' | 'interna' | 'conferir' {
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/sem (?:nova )?(?:cobranca|contato)|nao (?:cobrar|contatar)|nao (?:mandar|enviar) (?:nova )?mensage|aguardar|esperar|so com resposta|retomar so/.test(t)) return 'espera'
  if (/intern[ao]/.test(t)) return 'interna'
  return 'conferir'
}
export function rotuloDoPasso(texto: string, amanha = false): string {
  const intencao = intencaoDoPasso(texto)
  if (intencao === 'espera') return 'Conferir combinado de espera'
  if (intencao === 'interna') return amanha ? 'Revisar tarefa interna de amanhã' : 'Revisar tarefa interna'
  return amanha ? 'Revisar próximo passo de amanhã' : 'Conferir próximo passo'
}

export function diaEmSP(agora: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}
function passoAtivo(lead: CrmLead) {
  const p = lead.proximoPasso
  if (!p?.texto.trim() || lead.etapa === 'ganho' || lead.etapa === 'perdido') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data) || !Number.isFinite(Date.parse(`${p.data}T12:00:00Z`)) || new Date(`${p.data}T12:00:00Z`).toISOString().slice(0, 10) !== p.data) return null
  return p
}
function conferirPlano(lead: CrmLead, registradoEm: string) {
  const posteriores = [lead.resposta?.em, lead.conversa?.ultimaEntrada, lead.conversa?.ultimaSaida, ...lead.eventos.filter(e => e.origem === 'manual' && /^\[(Envio confirmado|Retorno informado) pelo operador/.test(e.texto ?? '')).map(e => e.em)]
  return !Number.isFinite(Date.parse(registradoEm)) || posteriores.some(em => !!em && Date.parse(em) > Date.parse(registradoEm))
}
export function passosFuturosDaSala(leads: readonly CrmLead[], agora = new Date()) {
  const hoje = diaEmSP(agora)
  const amanha = new Date(Date.parse(`${hoje}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10)
  return leads.flatMap(lead => {
    const p = passoAtivo(lead)
    return p && p.data > hoje ? [{ lead, data: p.data, texto: p.texto, conferir: conferirPlano(lead, p.registradoEm), quando: p.data === amanha ? 'amanha' as const : 'depois' as const }] : []
  }).sort((a, b) => a.data.localeCompare(b.data) || a.lead.empresa.localeCompare(b.lead.empresa))
}
export function retomadaDoLead(lead: CrmLead, agora = new Date()) {
  const p = passoAtivo(lead)
  const hoje = diaEmSP(agora)
  if (!p || p.data > hoje) return null
  const conferir = conferirPlano(lead, p.registradoEm)
  return { lead, data: p.data, texto: p.texto, quando: p.data === hoje ? 'hoje' as const : 'atrasado' as const, conferir }
}
export function retomadasDaSala(leads: readonly CrmLead[], agora = new Date()) {
  return leads.flatMap(l => { const r = retomadaDoLead(l, agora); return r ? [r] : [] }).sort((a, b) => Number(b.quando === 'hoje') - Number(a.quando === 'hoje') || a.data.localeCompare(b.data) || a.lead.empresa.localeCompare(b.lead.empresa))
}
export const PEDIDO_DE_RETOMADA = 'Confira o próximo passo datado deste lead e prepare uma retomada para eu revisar. Confronte o combinado com retornos e envios posteriores; prazo vencido e silêncio não autorizam novo contato. Explique em uma frase o compromisso e o avanço esperado. Quando couber retomar, proponha uma mensagem curta com uma pergunta útil e um cartão de revisão do próximo passo, preservando o que continua válido. Se o contexto indicar espera, recusa ou combinado já resolvido, explique e proponha só a revisão adequada, sem insistir. Não invente data ou interesse. Se a mensagem exigir entregar o Raio-X, use somente o marcador [link do Raio-X]; o operador insere o material registrado e confere antes de abrir. Não envie mensagens, não registre envio e não altere o plano; eu confirmo cada ação.'

export const PEDIDO_DE_PREPARO_AMANHA = 'Prepare apenas um rascunho da retomada prevista para amanhã deste lead, para eu revisar e guardar sem contato antecipado. Use o próximo passo datado e o contexto mais recente, incluindo retornos, quem decide e compromissos. Informe o que preciso conferir antes de usar o texto. Respeite espera, recusa e decisão pendente: uma revisão interna não autoriza mensagem ao cliente; se não houver motivo para contato, explique em até três frases o que devo aguardar e conferir, em vez de inventar uma mensagem. Quando couber, proponha um cartão de mensagem curto e contextual, sem expressões relativas como hoje ou amanhã que fiquem erradas quando eu usar. Preserve o plano e a data existentes; não proponha mudança só porque estamos preparando. Não invente interesse ou fatos. Para Raio-X use somente [link do Raio-X], para eu inserir o material registrado. Nada de enviar, registrar envio ou executar ações.'
