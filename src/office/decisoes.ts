import { compararPlanosComerciais, planoPedeConferenciaInterna, planoComercialDoLead, temContextoPrioridadeComercial } from '../operations/prioridade-comercial'
import type { CrmLead, CrmProduto } from '../operations/types'
import { PRODUTOS, SIGLA_DO_PRODUTO } from '../operations/crm-formato'
import { prioridadeDaAcao, PRIORIDADE_DA_FILA, type AcaoDeVenda } from '../operations/proxima-venda'
import { conversasParaConduzir, type ConversaParaVoce } from '../operations/conversas-para-conduzir'
import { contatoPausado } from '../operations/aprendizado-comercial'
import { planoFuturoEmEspera, procedimentoDaDecisao } from './procedimento-da-decisao'
import { ultimoRetornoRegistrado } from '../operations/retorno-da-venda'
import { retomadaDoLead } from '../operations/retomadas'

export type EstadoDaDecisao = 'agora' | 'acompanhando' | 'encerrada'
export interface Decisao {
  lead: CrmLead
  estado: EstadoDaDecisao
  motivo: string
  acao: AcaoDeVenda | null
}
// A sigla única (AC-19), na ordem dos filtros de Vendas; era uma cópia à mão.
export const nomesDasOfertas: Readonly<Record<CrmProduto, string>> = Object.fromEntries(PRODUTOS.map((p) => [p, SIGLA_DO_PRODUTO[p]])) as Record<CrmProduto, string>

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

/** A classificação complementar só vale para a entrada que ela realmente leu, nunca para um retorno posterior. */
function roboConfirmadoAtual(lead: CrmLead & { classificacaoResposta?: {
  classe?: string; evidencia?: { em?: string }; revisar?: boolean; houveRespostaHumana?: boolean
} }, agora: number): boolean {
  const conversa = lead.conversa
  const entrada = conversa?.ultima.direcao === 'entrada' ? conversa.ultima : conversa?.recentes?.filter(m => m.direcao === 'entrada').at(-1)
  const em = instante(entrada?.em)
  const papel: unknown = entrada?.papel
  if (papel === 'gente' || papel === 'recepcao') return false
  if (!em || em > agora || ultimaEntrada(lead) > em || instante(lead.resposta?.em) > em) return false
  if (procedimentoDaDecisao(lead, new Date(agora)).tipo === 'robo') return true
  const leitura = lead.classificacaoResposta
  return leitura?.classe === 'robo' && leitura.revisar === false && leitura.houveRespostaHumana === false && instante(leitura.evidencia?.em) === em
}

/** Uma linha por cliente. A ordem de Vendas e as proteções de contato continuam valendo. */
export function decisoesDoEscritorio(leads: readonly CrmLead[], acoes: readonly AcaoDeVenda[], agora: number, conversasLidas?: readonly (Pick<ConversaParaVoce, 'lead' | 'rotulo'> & Partial<Pick<ConversaParaVoce, 'prioridade' | 'em'>>)[]): Decisao[] {
  const planosComerciais=new Map(leads.map(l=>[l.id,planoComercialDoLead(l,agora)]))
  const prioridadeCompartilhada=leads.some(l=>temContextoPrioridadeComercial(l,agora))
  const observadas = new Map(conversasParaConduzir(leads, agora).map(c => [c.lead.id, c]))
  const conversas = conversasLidas ?? [...observadas.values()]
  const porConversa = new Map(conversas.map(c => [c.lead.id, c]))
  const porAcao = new Map<string, AcaoDeVenda>()
  const comAcaoAlemDaResposta = new Set(acoes.filter(a => !a.primeiroContato && a.tipo !== 'responder').map(a => a.leadId))
  for (const acao of acoes) if (!acao.primeiroContato && !porAcao.has(acao.leadId)) porAcao.set(acao.leadId, acao)
  const ordem = new Map([...new Set([...porAcao.keys(), ...conversas.map(c => c.lead.id)])].map((id, i) => [id, i]))
  const prioridade = (d: Decisao) => d.lead.atendimentoComercial ? planosComerciais.get(d.lead.id)!.ordem/10 : porConversa.get(d.lead.id)?.prioridade ?? observadas.get(d.lead.id)?.prioridade ?? (d.acao ? prioridadeDaAcao(d.acao) : undefined) ?? PRIORIDADE_DA_FILA.combinado
  return leads.flatMap((lead): Decisao[] => {
    if(lead.atendimentoComercial?.alvo==='time') return [{lead,estado:'acompanhando',motivo:lead.atendimentoComercial.motivo,acao:null}]
    if(lead.atendimentoComercial||planoPedeConferenciaInterna(planosComerciais.get(lead.id)!)) return [{lead,estado:'agora',motivo:lead.atendimentoComercial?.titulo??planosComerciais.get(lead.id)!.acao,acao:porAcao.get(lead.id)??null}]
    const atendida = respostaJaAtendida(lead)
    const candidata = porAcao.get(lead.id) ?? null
    const materialPendente = materialSolicitadoPendente(lead)
    const acao = atendida && candidata?.tipo === 'responder' ? null : candidata
    const conversa = atendida && porConversa.get(lead.id)?.rotulo === 'Resposta recebida' ? undefined : porConversa.get(lead.id)
    if (lead.etapa === 'ganho' || lead.etapa === 'perdido') return [{ lead, estado: 'encerrada', motivo: lead.etapa === 'ganho' ? 'Venda ganha' : 'Conversa encerrada', acao: null }]
    const esperaPlanejada = planoFuturoEmEspera(lead, new Date(agora))
    const protegido = contatoPausado(lead) || esperaPlanejada || lead.resposta?.tipo === 'negativa' || lead.resposta?.tipo === 'exclusao'
    if (!protegido && lead.etapa !== 'proposta' && !lead.proposta && !comAcaoAlemDaResposta.has(lead.id) && roboConfirmadoAtual(lead, agora) && !materialPendente && !retomadaDoLead(lead, new Date(agora))) return [{ lead, estado: 'acompanhando', motivo: 'Resposta automática confirmada · conferir atendimento humano', acao: null }]
    if ((!protegido || acao?.tipo === 'desfecho') && (acao || conversa || materialPendente)) return [{ lead, estado: 'agora', motivo: materialPendente ? 'Material solicitado ainda não enviado' : conversa?.rotulo ?? acao!.titulo, acao }]
    const temConversa = lead.etapa === 'contato' || lead.etapa === 'proposta' || !!lead.conversa || !!lead.proximoPasso
    if (!temConversa) return []
    return [{ lead, estado: 'acompanhando', motivo: protegido ? 'Contato em espera' : procedimentoDaDecisao(lead, new Date(agora)).tipo === 'robo' ? 'Só o robô respondeu · conferir atendimento humano' : lead.proximoPasso?.texto ? 'Próximo passo definido' : 'Aguardando retorno', acao: null }]
  }).sort((a, b) => {
    const estados = { agora: 0, acompanhando: 1, encerrada: 2 }
    const pulado=(d:Decisao)=>(porConversa.get(d.lead.id)?.prioridade??0)>=10
    const novaOrdem=prioridadeCompartilhada?compararPlanosComerciais(planosComerciais.get(a.lead.id)!,planosComerciais.get(b.lead.id)!,`${a.lead.produto}:${a.lead.id}`,`${b.lead.produto}:${b.lead.id}`):prioridade(a)-prioridade(b)
      ||(prioridade(a)===PRIORIDADE_DA_FILA.responder?Number(!!observadas.get(b.lead.id)?.resposta)-Number(!!observadas.get(a.lead.id)?.resposta)||(observadas.get(b.lead.id)?.em??0)-(observadas.get(a.lead.id)?.em??0):0)
      ||(ordem.get(a.lead.id)??Infinity)-(ordem.get(b.lead.id)??Infinity)
    return estados[a.estado]-estados[b.estado]||(a.estado==='agora'?Number(pulado(a))-Number(pulado(b))||novaOrdem:0)||a.lead.empresa.localeCompare(b.lead.empresa,'pt-BR')
  })
}
