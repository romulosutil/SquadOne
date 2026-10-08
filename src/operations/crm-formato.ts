import type { CrmEtapa, CrmLead, CrmProduto, CrmTipoDeResposta } from './types'

// Textos do CRM usados pelas três vistas (Hoje, Funil e Ficha).

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
  ganho: 'Fechou',
  perdido: 'Recusou, sem resposta, parou de responder ou descartado',
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
  neutra: 'Sem sim nem não',
  bot: 'Só robô',
}

export const ROTULO_DO_PRODUTO: Record<CrmProduto, string> = { site: 'Site antes da venda', prumo: 'PRUMO' }
export const SIGLA_DO_PRODUTO: Record<CrmProduto, string> = { site: 'Site', prumo: 'PRUMO' }

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

/** Leitura dita com honestidade: sem confirmação de leitura, é desconhecida (RULES 2 e 15). */
// O que o lead do Site recebeu (07/10/2026): "Mensagem A · site personalizado-v2".
export function textoDaAbordagem(lead: CrmLead): string {
  const { mensagem, site } = lead.abordagem ?? {}
  const msg = !mensagem ? '' : mensagem === 'manual' ? 'mensagem escrita à mão (sem o link do Balcão)'
    : mensagem === 'EN' ? 'mensagem em inglês' : `mensagem ${mensagem}`
  const partes = [msg, site ? `site ${site}` : ''].filter(Boolean)
  return partes.length ? partes.join(' · ').replace(/^./, (c) => c.toUpperCase()) : ''
}

export function textoDaLeitura(lead: CrmLead): string {
  if (lead.leitura === 'viu') return `Viu ${dataCurta(lead.marcos.visto)}`
  if (lead.leitura === 'pela-resposta') return 'Leu (respondeu)'
  if (lead.leitura === 'desconhecida') return 'Leitura desconhecida'
  return ''
}
