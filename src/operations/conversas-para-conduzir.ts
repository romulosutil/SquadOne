/**
 * PURO: a lista "Conversas para você" (18/10/2026; passos da fila de venda desde 19/10/2026).
 *
 * Duas fontes, um lead por linha:
 *  - a conversa guardada e o combinado salvo (`conversasParaConduzir`): quem escreveu por último e o
 *    compromisso de hoje ou atrasado. Só enxerga lead que tem arquivo de conversa ou próximo passo;
 *  - a fila de venda (proxima-venda.ts, a mesma da Ficha e do "Envie para X" do Telegram), para os
 *    passos que não são primeiro contato: o follow-up do 3º dia, o "o que achou?" depois do link, a
 *    proposta sem retorno, a recusa a marcar, a proposta a mandar e o lead que respondeu só pela
 *    planilha. Sem isto, depois que ProximaVenda.vue saiu esses passos não apareciam em tela nenhuma
 *    (só no Telegram), e a Central dizia "você está em dia" com um follow-up vencido.
 *
 * Primeiro contato não entra: é do time comercial (aba Primeiros contatos) e do Telegram. A lista é a
 * mesma na carteira (CrmPanel).
 */
import { diaEmSP, rotuloDoPasso } from './retomadas'
import { entradaDeGenteDaVez } from './resultados'
import { PRIORIDADE_DA_FILA, filaDaTela, prioridadeDaAcao, type AcaoDeVenda, type Resolvidas, type TipoDeVenda } from './proxima-venda'
import type { CrmLead, CrmVisao } from './types'

export interface ConversaParaVoce {
  lead: CrmLead
  /** A prioridade da fila de venda (PRIORIDADE_DA_FILA): 0 = a vez é dele; 1 = proposta a mandar; 2 = combinado; depois, os passos na ordem dela; 10+ = pulado hoje. */
  prioridade: number
  /** Para ordenar dentro da prioridade: quando foi (resposta/combinado) ou a posição na fila. */
  em: number
  rotulo: string
  /** A última mensagem recebida é de gente e recente: o botão é "Responder". */
  resposta: boolean
  /** O passo da fila de venda para este lead (o mesmo da Ficha), quando há: a frase, a mensagem pronta e o link. */
  acao?: AcaoDeVenda
}

const JANELA_DA_RESPOSTA_MS = 14 * 86_400_000
/** Quem foi "Pulado" hoje vai para o fim da lista, sem sumir. */
const PULADO = 10

/** O rótulo de cada passo da fila de venda que a lista mostra; a prioridade é a da fila (PRIORIDADE_DA_FILA). */
const ROTULO_DO_PASSO: Partial<Record<TipoDeVenda, string>> = {
  responder: 'Resposta recebida',
  'mandar-proposta': 'Proposta para mandar',
  combinado: 'Combinado pendente',
  'depois-do-link': 'O que achou?',
  proposta: 'Proposta sem retorno',
  desfecho: 'Recusa para marcar',
  followup: 'Follow-up',
}

/** Prioridade do operador vem de conversa e compromisso, não de uma lacuna de cadastro. */
export function conversasParaConduzir(leads: readonly CrmLead[], agora = Date.now()): ConversaParaVoce[] {
  const hoje = diaEmSP(new Date(agora))
  return leads.flatMap((lead): ConversaParaVoce[] => {
    if (lead.etapa === 'ganho' || lead.etapa === 'perdido' || lead.resposta?.tipo === 'negativa' || lead.resposta?.tipo === 'exclusao') return []
    const em = entradaDeGenteDaVez(lead) ?? NaN
    const resposta = Number.isFinite(em) && em <= agora && agora - em <= JANELA_DA_RESPOSTA_MS
    // A captura pode chegar antes da classificação humana na planilha.
    // Mostrar para conferência, sem chamar isso de interesse ou responder automaticamente.
    const captura = lead.atendimentoComercial
    const capturadaEm = Date.parse(captura?.ocorridoEm ?? '')
    const ultimaSaida = Math.max(Date.parse(lead.conversa?.ultimaSaida ?? '') || 0,
      lead.conversa?.ultima.direcao === 'saida' ? Date.parse(lead.conversa.ultima.em) || 0 : 0)
    if (!resposta && captura?.tipo === 'handoff' && captura.alvo === 'operador' && Number.isFinite(capturadaEm)
      && capturadaEm <= agora && capturadaEm >= ultimaSaida) {
      return [{ lead, prioridade: PRIORIDADE_DA_FILA.responder, em: capturadaEm, rotulo: lead.resposta?.tipo === 'bot' ? 'Recepção automática — conferir' : 'Conferir resposta recebida', resposta: false }]
    }
    const p = lead.proximoPasso
    const dataValida = !!p && /^\d{4}-\d{2}-\d{2}$/.test(p.data) && Number.isFinite(Date.parse(`${p.data}T12:00:00Z`)) && new Date(`${p.data}T12:00:00Z`).toISOString().slice(0, 10) === p.data
    const combinado = !!p?.texto.trim() && dataValida && p!.data <= hoje
    const espera = !!p && rotuloDoPasso(p.texto) === 'Conferir combinado de espera'
    if (!resposta && (!combinado || espera)) return []
    return [{ lead, prioridade: resposta ? PRIORIDADE_DA_FILA.responder : PRIORIDADE_DA_FILA.combinado, em: resposta ? em : Date.parse(`${p!.data}T00:00:00-03:00`), rotulo: resposta ? 'Resposta recebida' : p!.data === hoje ? 'Combinado para hoje' : 'Combinado pendente', resposta }]
  }).sort((a, b) => a.prioridade - b.prioridade || (a.prioridade === 0 ? b.em - a.em : a.em - b.em) || a.lead.id.localeCompare(b.lead.id))
}

/**
 * A lista inteira: as conversas e combinados mais os passos da fila de venda, um lead por linha.
 * `resolvidas` é o "Enviei"/"Pular" do dia que o servidor guarda (GET /crm/venda): o passo resolvido sai
 * da lista (e a conversa do mesmo lead sai junto quando todos os passos dele foram resolvidos); o
 * pulado vai para o fim.
 */
export function conversasParaVoce(
  visao: Pick<CrmVisao, 'hoje' | 'leads' | 'estado'> | null | undefined, agora: number, resolvidas: Resolvidas = {},
): ConversaParaVoce[] {
  if (!visao || visao.estado !== 'ok') return []
  const base = conversasParaConduzir(visao.leads, agora)
  const fila = filaDaTela(visao, { agora }, resolvidas)
  // Os leads cujos passos foram todos resolvidos hoje: a conversa deles espera a próxima mensagem.
  const comPasso = new Set(fila.map((a) => a.leadId))
  const resolvidosDoLead = new Map<string, number>()
  if (Object.keys(resolvidas).length) for (const a of filaDaTela(visao, { agora })) {
    const resolucao = resolvidas[a.chave]
    if (resolucao && !resolucao.pulou && !comPasso.has(a.leadId)) resolvidosDoLead.set(a.leadId, Math.max(resolvidosDoLead.get(a.leadId) ?? 0, resolucao.em))
  }
  const pulou = (a: AcaoDeVenda | undefined) => (a && resolvidas[a.chave]?.pulou ? PULADO : 0)

  const acaoDoLead = new Map<string, AcaoDeVenda>()
  for (const a of fila) if (!acaoDoLead.has(a.leadId) && ROTULO_DO_PASSO[a.tipo]) acaoDoLead.set(a.leadId, a)

  const itens: Array<ConversaParaVoce & { daFila: boolean }> = []
  const vistos = new Set<string>()
  for (const c of base) {
    const resolvidoEm = resolvidosDoLead.get(c.lead.id)
    if (resolvidoEm !== undefined && (!c.resposta || c.em <= resolvidoEm)) continue
    const acao = acaoDoLead.get(c.lead.id)
    const respostaPosterior = c.resposta && acao && c.em > (resolvidas[acao.chave]?.em ?? 0)
    itens.push({ ...c, prioridade: c.prioridade + (respostaPosterior ? 0 : pulou(acao)), ...(acao ? { acao } : {}), daFila: false })
    vistos.add(c.lead.id)
  }
  const porId = new Map(visao.leads.map((l) => [l.id, l] as [string, CrmLead]))
  fila.forEach((a, posicao) => {
    const rotulo = ROTULO_DO_PASSO[a.tipo]
    const lead = porId.get(a.leadId)
    if (!rotulo || !lead || a.primeiroContato || vistos.has(a.leadId) || lead.etapa === 'ganho' || lead.etapa === 'perdido') return
    vistos.add(a.leadId)
    itens.push({
      lead, prioridade: prioridadeDaAcao(a) + pulou(a), em: posicao, rotulo: a.conferirHistorico ? 'Revisar o contexto' : rotulo,
      resposta: false, acao: a, daFila: true,
    })
  })
  // Dentro da prioridade, a conversa guardada antes do passo só da fila; a resposta mais nova primeiro.
  return itens.sort((a, b) => a.prioridade - b.prioridade || Number(a.daFila) - Number(b.daFila)
    || (a.prioridade === 0 && !a.daFila ? b.em - a.em : a.em - b.em) || a.lead.id.localeCompare(b.lead.id))
    .map(({ daFila: _, ...item }) => item)
}
