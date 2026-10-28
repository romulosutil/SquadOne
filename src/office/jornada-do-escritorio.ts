import type { CrmLead } from '../operations/types'
import { ehOfertaPropria } from '../../server/ofertas.ts'
import { trabalhosRegistrados } from './trabalho-registrado'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import { decisoesHumanasDoEscritorio } from './minha-vez'
import { orientacaoDoAtendimento } from '../operations/atendimento-cliente'

export function pendenciasDaJornada(leads: readonly CrmLead[], acoes: readonly AcaoDeVenda[], agora: number) {
  return decisoesHumanasDoEscritorio(leads, acoes, agora).filter(d => d.estado === 'agora' && orientacaoDoAtendimento(d.lead, leads, agora).estado === 'agora')
}

/** Fases de leitura, não uma nova máquina de estados do serviço. Cada marco exige sua própria evidência. */
export const FASES_DO_ESCRITORIO = [
  { id: 1, nome: 'Preparação' }, { id: 2, nome: 'Primeiro contato' },
  { id: 3, nome: 'Conversa' }, { id: 4, nome: 'Material' },
  { id: 5, nome: 'Proposta' }, { id: 6, nome: 'Resultado' },
] as const
export type FaseDoEscritorio = typeof FASES_DO_ESCRITORIO[number]['id']
const valido = (em: string | undefined, agora: number) => !!em && Number.isFinite(Date.parse(em)) && Date.parse(em) <= agora
function datas(lead: CrmLead, agora: number): (string | undefined)[] {
  const conversa = lead.conversa
  const respostaHumana = lead.classificacaoResposta ? lead.classificacaoResposta.houveRespostaHumana : lead.resposta && lead.resposta.tipo !== 'bot'
  const humano = conversa?.ultimaEntrada || (respostaHumana ? lead.resposta?.em : undefined)
  const desfechos = lead.etapa === 'ganho' ? ['ganhou', 'fechou'] : ['perdeu', 'recusou', 'dispensado']
  return [
    lead.eventos.find(e => e.tipo === 'encontrado' && !e.estimado && valido(e.em, agora))?.em,
    lead.marcos.enviado,
    humano,
    lead.marcos.segundaEnviada || conversa?.linkEm,
    lead.proposta?.em,
    lead.eventos.filter(e => desfechos.includes(e.tipo) && !e.estimado && valido(e.em, agora)).sort((a, b) => Date.parse(b.em) - Date.parse(a.em))[0]?.em,
  ].map(em => valido(em, agora) ? em : undefined)
}
export function faseDoEscritorio(lead: CrmLead, agora = Date.now()): FaseDoEscritorio {
  if (lead.etapa === 'ganho' || lead.etapa === 'perdido') return 6
  if (lead.etapa === 'proposta') return 5
  const em = datas(lead, agora)
  return em[4] ? 5 : em[3] ? 4 : em[2] ? 3 : em[1] || lead.etapa === 'contato' || (lead.conversa?.mensagens ?? 0) > 0 ? 2 : 1
}
export function fasesDoCliente(lead: CrmLead, agora = Date.now()) {
  const atual = faseDoEscritorio(lead, agora), em = datas(lead, agora)
  const semMaterial = ehOfertaPropria(lead.produto) && !em[3]
  return FASES_DO_ESCRITORIO.filter(f => !semMaterial || f.id !== 4).map(f => ({
    ...f, em: em[f.id - 1], estado: f.id === atual ? 'atual' as const : em[f.id - 1] ? 'confirmado' as const : f.id > atual ? 'depois' as const : 'sem-registro' as const,
  }))
}
export interface MovimentoDoEscritorio {
  id: string
  leadId: string
  empresa: string
  em: string
  titulo: string
  setor: string
  fase: FaseDoEscritorio | undefined
  responsavel?: string
}
/** Uma timeline de fatos datados. Fila pronta, clique e tempo decorrido não viram envio ou transferência. */
export function movimentosDoEscritorio(leads: readonly CrmLead[], agora = Date.now()): MovimentoDoEscritorio[] {
  const movimentos: MovimentoDoEscritorio[] = []
  for (const lead of leads) {
    const em = datas(lead, agora)
    const adicionar = (id: string, data: string | undefined, titulo: string, fase: FaseDoEscritorio | undefined, setor: string, responsavel?: string) => {
      if (!valido(data, agora)) return
      // Uma resposta posterior à proposta não faz o cliente "voltar para a fase 3".
      const faseNaData = fase === undefined ? undefined : Math.max(fase, ...em.flatMap((marco, i) => marco && Date.parse(marco) <= Date.parse(data!) ? [i + 1] : [])) as FaseDoEscritorio
      movimentos.push({ id: `${lead.id}:${id}:${data}`, leadId: lead.id, empresa: lead.empresa, em: data!, titulo, fase: faseNaData, setor, responsavel })
    }
    adicionar('encontrado', em[0], 'Lead entrou na preparação', 1, 'Prospecção')
    adicionar('contato', em[1], 'Primeiro contato confirmado', 2, 'Prospecção → Atendimento')
    adicionar('resposta', em[2], 'Resposta humana recebida', 3, 'Atendimento')
    adicionar('robo', lead.conversa?.ultimaEntradaRobo, 'Resposta automática recebida', 2, 'Aguardando uma pessoa')
    adicionar('material', em[3], 'Envio de material registrado', 4, 'Produção → Atendimento')
    adicionar('proposta', em[4], 'Proposta registrada', 5, 'Atendimento → Proposta')
    if (lead.etapa === 'ganho' || lead.etapa === 'perdido') adicionar('resultado', em[5], lead.etapa === 'ganho' ? 'Venda registrada como ganha' : 'Conversa encerrada', 6, 'Resultado')
    adicionar('demo', lead.demoPedidoEm, 'Preparação da demonstração solicitada', 4, 'Produção · pedido registrado')
    for (const trabalho of trabalhosRegistrados(lead, agora)) {
      // Usa a hora de registro, sem inventar uma hora para a data da tarefa.
      adicionar(`trabalho:${trabalho.id}`, trabalho.registradoEm, trabalho.tarefa!, undefined, trabalho.fila === 'time' ? 'Encaminhado ao time' : trabalho.fila === 'cliente' ? 'Aguardando cliente' : 'Sua vez', trabalho.responsavel)
    }
  }
  return [...new Map(movimentos.map(m => [m.id, m])).values()].sort((a, b) => Date.parse(b.em) - Date.parse(a.em) || a.id.localeCompare(b.id))
}
