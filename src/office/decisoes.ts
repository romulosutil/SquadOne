import type { CrmLead } from '../operations/types'
import { prioridadeDaAcao, PRIORIDADE_DA_FILA, type AcaoDeVenda } from '../operations/proxima-venda'
import { conversasParaConduzir, type ConversaParaVoce } from '../operations/conversas-para-conduzir'
import { contatoPausado } from '../operations/aprendizado-comercial'
import { planoFuturoEmEspera, procedimentoDaDecisao } from './procedimento-da-decisao'
import { ultimoRetornoRegistrado } from '../operations/retorno-da-venda'

export type EstadoDaDecisao = 'agora' | 'acompanhando' | 'encerrada'
export interface Decisao {
  lead: CrmLead
  estado: EstadoDaDecisao
  motivo: string
  acao: AcaoDeVenda | null
}
export const nomesDasOfertas = { site: 'Site', prumo: 'PRUMO', iris: 'Iris', plus: 'Plus', estampa: 'Estamparia' } as const

const instante = (em?: string) => Date.parse(em ?? '') || 0

function ultimaEntrada(lead: CrmLead): number {
  const c = lead.conversa
  return Math.max(instante(c?.ultimaEntrada), c?.ultima.direcao === 'entrada' ? instante(c.ultima.em) : 0, instante(ultimoRetornoRegistrado(lead)?.registradoEm))
}

function ultimaSaida(lead: CrmLead): number {
  const c = lead.conversa
  return Math.max(instante(c?.ultimaSaida), c?.ultima.direcao === 'saida' ? instante(c.ultima.em) : 0)
}

function ultimoEnvioConfirmado(lead: CrmLead): number {
  return Math.max(0, ...lead.eventos.filter(e => e.origem === 'manual' && /^\[Envio confirmado pelo operador · \d{4}-\d{2}-\d{2}\]\r?\n\S/.test(e.texto ?? '')).map(e => instante(e.em)))
}

/** Leitores que já fornecem a interpretação podem complementar o contrato; a fonte legada continua suficiente. */
function materialSolicitadoPendente(lead: CrmLead & { classificacaoResposta?: { materialSolicitado: boolean } }): boolean {
  const solicitado = lead.classificacaoResposta?.materialSolicitado
    ?? (lead.resposta?.tipo === 'licenca' || lead.resposta?.tipo === 'interesse' && !!lead.links.segunda)
  return solicitado && !instante(lead.marcos.segundaEnviada) && !instante(lead.conversa?.linkEm)
}

/** Uma saída responde à entrada anterior, mas não comprova a entrega de material nem conclui um próximo passo. */
export function respostaJaAtendida(lead: CrmLead): boolean {
  const saida = Math.max(ultimaSaida(lead), ultimoEnvioConfirmado(lead))
  return !materialSolicitadoPendente(lead) && saida > ultimaEntrada(lead) && saida > 0
}

export function proximaDecisaoPorPrioridade(decisoes: readonly Decisao[], atualId?: string): Decisao | null {
  return decisoes.find(d => d.estado === 'agora' && d.lead.id !== atualId) ?? null
}

/** Avança apenas com evidência de entrega e sem compromisso ativo; texto enviado sozinho não comprova conclusão. */
export function novaRespostaEnviada(antes: CrmLead | undefined, depois: CrmLead | undefined): boolean {
  if (!antes || !depois || antes.id !== depois.id || antes.produto !== depois.produto) return false
  if (depois.proximoPasso?.texto.trim() || !respostaJaAtendida(depois)) return false
  const anterior = ultimaSaida(antes), atual = ultimaSaida(depois)
  const entrega = Math.max(instante(depois.conversa?.linkEm), instante(depois.marcos.segundaEnviada))
  return atual > anterior && entrega > Math.max(anterior, ultimaEntrada(depois)) && entrega <= atual
}

/** Uma linha por cliente. A ordem de Vendas e as proteções de contato continuam valendo. */
export function decisoesDoEscritorio(leads: readonly CrmLead[], acoes: readonly AcaoDeVenda[], agora: number, conversasLidas?: readonly (Pick<ConversaParaVoce, 'lead' | 'rotulo'> & Partial<Pick<ConversaParaVoce, 'prioridade' | 'em'>>)[]): Decisao[] {
  const observadas = new Map(conversasParaConduzir(leads, agora).map(c => [c.lead.id, c]))
  const conversas = conversasLidas ?? [...observadas.values()]
  const porConversa = new Map(conversas.map(c => [c.lead.id, c]))
  const porAcao = new Map<string, AcaoDeVenda>()
  for (const acao of acoes) if (!acao.primeiroContato && !porAcao.has(acao.leadId)) porAcao.set(acao.leadId, acao)
  const ordem = new Map([...new Set([...porAcao.keys(), ...conversas.map(c => c.lead.id)])].map((id, i) => [id, i]))
  const prioridade = (d: Decisao) => porConversa.get(d.lead.id)?.prioridade ?? observadas.get(d.lead.id)?.prioridade ?? (d.acao ? prioridadeDaAcao(d.acao) : undefined) ?? PRIORIDADE_DA_FILA.combinado
  return leads.flatMap((lead): Decisao[] => {
    const atendida = respostaJaAtendida(lead)
    const candidata = porAcao.get(lead.id) ?? null
    const materialPendente = materialSolicitadoPendente(lead)
    const acao = atendida && candidata?.tipo === 'responder' ? null : candidata
    const conversa = atendida && porConversa.get(lead.id)?.rotulo === 'Resposta recebida' ? undefined : porConversa.get(lead.id)
    if (lead.etapa === 'ganho' || lead.etapa === 'perdido') return [{ lead, estado: 'encerrada', motivo: lead.etapa === 'ganho' ? 'Venda ganha' : 'Conversa encerrada', acao: null }]
    const esperaPlanejada = planoFuturoEmEspera(lead, new Date(agora))
    const protegido = contatoPausado(lead) || esperaPlanejada || lead.resposta?.tipo === 'negativa' || lead.resposta?.tipo === 'exclusao'
    if ((!protegido || acao?.tipo === 'desfecho') && (acao || conversa || materialPendente)) return [{ lead, estado: 'agora', motivo: materialPendente ? 'Material solicitado ainda não enviado' : conversa?.rotulo ?? acao!.titulo, acao }]
    const temConversa = lead.etapa === 'contato' || lead.etapa === 'proposta' || !!lead.conversa || !!lead.proximoPasso
    if (!temConversa) return []
    return [{ lead, estado: 'acompanhando', motivo: protegido ? 'Contato em espera' : procedimentoDaDecisao(lead, new Date(agora)).tipo === 'robo' ? 'Só o robô respondeu · conferir atendimento humano' : lead.proximoPasso?.texto ? 'Próximo passo definido' : 'Aguardando retorno', acao: null }]
  }).sort((a, b) => {
    const estados = { agora: 0, acompanhando: 1, encerrada: 2 }
    return estados[a.estado] - estados[b.estado] || (a.estado === 'agora' ? prioridade(a) - prioridade(b)
      || (prioridade(a) === PRIORIDADE_DA_FILA.responder ? Number(!!observadas.get(b.lead.id)?.resposta) - Number(!!observadas.get(a.lead.id)?.resposta)
        || (observadas.get(b.lead.id)?.em ?? 0) - (observadas.get(a.lead.id)?.em ?? 0) : 0)
      || (ordem.get(a.lead.id) ?? Infinity) - (ordem.get(b.lead.id) ?? Infinity) : 0) || a.lead.empresa.localeCompare(b.lead.empresa, 'pt-BR')
  })
}
