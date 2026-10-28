import type { CrmLead } from '../operations/types'
import { OFERTA, ehOfertaPropria } from '../../server/ofertas.ts'
import type { TrabalhoDoTime } from '../operations/proximo-passo-do-time'
import { itemDaFilaComercial } from '../operations/fila-comercial'
import { motivoDaMinhaVez } from './minha-vez'
import { FASES_DO_ESCRITORIO, faseDoEscritorio, fasesDoCliente, movimentosDoEscritorio, type FaseDoEscritorio } from './jornada-do-escritorio'

export interface FichaNaEsteira {
  id: string; empresa: string; responsavel: string; acao: string; condicao?: string
  situacao: 'sua-vez' | 'time' | 'aguardando' | 'conferencia' | 'resultado'
  rotulo: string
}
export interface EstacaoDaProducao {
  id: FaseDoEscritorio; nome: string; setor: string; fichas: FichaNaEsteira[]; comVoce: number
}
export { PONTOS_DA_ESTEIRA, trajetoDaEsteira, pontoDaEsteiraNoMundo } from './caminhos-da-cena'

const SETORES = ['Prospecção', 'Primeiro contato', 'Atendimento', 'Entrega do material', 'Negociação', 'Desfecho']
export function estacoesDaProducao(leads: readonly CrmLead[], pendentes: readonly string[], frente: TrabalhoDoTime | null, agora: number): EstacaoDaProducao[] {
  const prioridade = new Map(pendentes.map((id, i) => [id, i]))
  const estacoes: EstacaoDaProducao[] = FASES_DO_ESCRITORIO.map((f, i) => ({ ...f, setor: SETORES[i], fichas: [], comVoce: 0 }))
  const escolhas = new Map(frente?.fila.map(c => [c.id, c]) ?? [])
  for (const lead of leads) {
    const fase = faseDoEscritorio(lead, agora), fila = fase === 1 && !lead.atendimentoComercial || fase === 6 ? null : itemDaFilaComercial(lead, leads, agora), escolha = escolhas.get(lead.id)
    let ficha: FichaNaEsteira
    if (escolha?.estado === 'incerto') ficha = { id: lead.id, empresa: lead.empresa, responsavel: 'Time comercial', acao: 'Conferir o envio sem confirmação antes de continuar.', situacao: 'conferencia', rotulo: 'Envio em conferência' }
    else if (fase === 6) ficha = { id: lead.id, empresa: lead.empresa, responsavel: 'Resultado registrado', acao: 'Consultar o desfecho na jornada.', situacao: 'resultado', rotulo: lead.etapa === 'ganho' ? 'Ganho registrado' : 'Encerrado' }
    else if (fase === 1 && !lead.atendimentoComercial) {
      const selecionado = frente?.ativo && escolha?.estado === 'pronto' && Number.isFinite(Date.parse(frente.atualizadoEm ?? '')) && Date.parse(frente.atualizadoEm!) <= agora && agora - Date.parse(frente.atualizadoEm!) <= 10*60_000
      ficha = { id: lead.id, empresa: lead.empresa, responsavel: lead.produto === 'plus' ? 'Rômulo' : 'Time comercial', acao: 'Conferir perfil, entrega e abordagem antes do primeiro contato.', situacao: lead.produto === 'plus' ? 'conferencia' : selecionado ? 'time' : 'aguardando', rotulo: selecionado ? 'Na fila do primeiro contato' : 'A preparar · aguarda seleção' }
    }
    else if (fila?.area === 'time') ficha = { id: lead.id, empresa: lead.empresa, responsavel: fila.responsavel, acao: fila.acao, condicao: fila.condicao, situacao: fila.emEspera ? 'aguardando' : 'time', rotulo: fila.emEspera ? 'Aguardando condição' : lead.atendimentoComercial ? 'Na fila do atendimento' : 'Trabalho registrado' }
    else if (fila?.area === 'conferencia') ficha = { id: lead.id, empresa: lead.empresa, responsavel: 'Time · conferência', acao: fila.acao, situacao: 'conferencia', rotulo: 'Conferir contexto' }
    else if (prioridade.has(lead.id) || lead.atendimentoComercial && motivoDaMinhaVez(lead, agora)) ficha = { id: lead.id, empresa: lead.empresa, responsavel: fila?.responsavel || 'Rômulo', acao: fila?.acao || 'Conferir o próximo passo na jornada.', situacao: 'sua-vez', rotulo: 'Sua vez' }
    else if (lead.atendimentoComercial?.alvo === 'operador') ficha = { id: lead.id, empresa: lead.empresa, responsavel: 'Time · conferência', acao: lead.atendimentoComercial.motivo, situacao: 'conferencia', rotulo: 'Conferir contexto' }
    else ficha = { id: lead.id, empresa: lead.empresa, responsavel: fila?.area === 'cliente' ? 'Cliente / condição de espera' : fila?.responsavel || 'Atendimento', acao: fila?.acao || 'Acompanhar a conversa.', situacao: 'aguardando', rotulo: 'Aguardando' }
    ficha.condicao ??= fila?.condicao
    estacoes[fase - 1].fichas.push(ficha)
  }
  for (const estacao of estacoes) {
    const ordem = { 'sua-vez':0, conferencia:1, time:2, aguardando:3, resultado:4 }
    estacao.fichas.sort((a, b) => ordem[a.situacao]-ordem[b.situacao] || (prioridade.get(a.id) ?? Infinity) - (prioridade.get(b.id) ?? Infinity) || a.empresa.localeCompare(b.empresa, 'pt-BR'))
    estacao.comVoce = estacao.fichas.filter(f => f.situacao === 'sua-vez').length
  }
  return estacoes
}
export interface PassagemDaProducao {
  id: string; leadId: string; empresa: string; de: FaseDoEscritorio; para: FaseDoEscritorio
  em: string; motivo: string; salaPortadora: string; responsavel?: string; tipo?: 'trabalho'
}
/** Só uma nova prova de avanço gera transporte. Primeira carga, recuo, fila e reclassificação sem marco não animam. */
export function passagensConfirmadas(antes: readonly CrmLead[] | null, depois: readonly CrmLead[], agora: number): PassagemDaProducao[] {
  if (!antes) return []
  const anteriores = new Map(antes.map(l => [l.id, l]))
  return depois.flatMap((lead): PassagemDaProducao[] => {
    const anterior = anteriores.get(lead.id)
    if (!anterior) return []
    const de = faseDoEscritorio(anterior, agora), para = faseDoEscritorio(lead, agora)
    if (para < de) return []
    if (para === de) {
      const antes = new Set(movimentosDoEscritorio([anterior],agora).map(m => m.id.slice(0,-m.em.length)))
      const trabalho = movimentosDoEscritorio([lead],agora).find(m => m.setor === 'Encaminhado ao time' && !antes.has(m.id.slice(0,-m.em.length)))
      const auto = lead.atendimentoComercial, antigo = anterior.atendimentoComercial
      const novoAutomatico = auto?.alvo === 'time' && ['preparar','qualificar','responder'].includes(auto.estado)
        && Number.isFinite(Date.parse(auto.ocorridoEm ?? '')) && Date.parse(auto.ocorridoEm!) <= agora
        && (auto.estado !== antigo?.estado || auto.ocorridoEm !== antigo?.ocorridoEm)
      const entrada = lead.conversa?.ultimaEntrada, entradaAnterior = anterior.conversa?.ultimaEntrada
      const novaResposta = !!entrada && Number.isFinite(Date.parse(entrada)) && Date.parse(entrada) <= agora && Date.parse(entrada) > (Date.parse(entradaAnterior ?? '') || 0)
      if(!trabalho && !novoAutomatico && novaResposta) return [{id:`${lead.id}:entrada:${entrada}`,leadId:lead.id,empresa:lead.empresa,de,para,em:entrada!,motivo:'Nova resposta recebida · conferir o próximo passo',salaPortadora:'prumo--geral'}]
      if(!trabalho && !novoAutomatico) return []
      return [{id:trabalho?.id ?? `${lead.id}:atendimento:${auto!.ocorridoEm}:${auto!.estado}`,leadId:lead.id,empresa:lead.empresa,de,para,em:trabalho?.em ?? auto!.ocorridoEm!,motivo:`Trabalho na fila: ${trabalho?.titulo ?? auto!.motivo}`,salaPortadora:'prumo--geral',responsavel:trabalho?.responsavel ?? 'Carla',tipo:'trabalho'}]
    }
    const marco = fasesDoCliente(lead, agora).find(f => f.id === para)?.em
    const antigo = fasesDoCliente(anterior, agora).find(f => f.id === para)?.em
    if (!marco || marco === antigo || !Number.isFinite(Date.parse(marco)) || Date.parse(marco) > agora) return []
    const motivos = ['', '', 'Primeiro contato confirmado', 'Resposta humana recebida', 'Envio de material registrado', 'Proposta registrada', 'Desfecho registrado']
    const producao = lead.produto === 'site' ? 'prumo--site-antes-da-venda' : lead.produto === 'prumo' ? 'prumo--organizar' : ehOfertaPropria(lead.produto) ? OFERTA[lead.produto].sala : `prumo--${lead.produto}`
    return [{ id: `${lead.id}:${para}:${marco}`, leadId: lead.id, empresa: lead.empresa, de, para, em: marco, motivo: motivos[para], salaPortadora: para === 2 ? 'prumo--prospeccao' : para === 4 ? producao : 'prumo--geral' }]
  }).sort((a, b) => Date.parse(b.em) - Date.parse(a.em))
}
