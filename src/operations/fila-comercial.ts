import type { CrmLead } from './types'
import { planoDoLead } from './bi-operacao'
import { cicloDoLead } from './ciclo-comercial'
import { contatoPausado } from './aprendizado-comercial'
import { projetarResponsavelConversa } from './responsavel-conversa'
import { trabalhosRegistrados } from '../office/trabalho-registrado'
export type AreaComercial = 'voce' | 'time' | 'cliente' | 'conferencia'
export function itemDaFilaComercial(lead: CrmLead, leads: readonly CrmLead[], agora = Date.now()) {
  const plano = planoDoLead(lead,agora), ciclo = cicloDoLead(lead,agora), autoridade = projetarResponsavelConversa(lead,leads,agora), dono = autoridade.registro, trabalho = trabalhosRegistrados(lead,agora).at(-1)
  if (plano.tipo === 'encerrado') return null
  const base = {lead,acao:plano.acao,evidencia:plano.evidencia,resultado:plano.resultado,responsavel:dono?.responsavel === 'romulo' ? 'Rômulo' : plano.responsavel,condicao:plano.condicao || 'Conferir contexto atual antes de agir',prazo:plano.prazo,prioridade:plano.prioridade,emEspera:false}
  // Pausa não perde validade porque houve resposta enviada ou trabalho interno novo.
  if (contatoPausado(lead)) return {...base,area:'cliente' as AreaComercial}
  if (autoridade.estado === 'bloqueado') return {...base,area:'conferencia' as AreaComercial,emEspera:true,acao:autoridade.motivo}
  if (trabalho) return {...base,area:trabalho.fila!,acao:trabalho.tarefa!,responsavel:trabalho.responsavel!,resultado:trabalho.resultado!,condicao:trabalho.condicao!,prazo:trabalho.vencimento || 'Até a condição registrada'}
  const atendimento = lead.atendimentoComercial
  if (atendimento) {
    const humano = atendimento.alvo !== 'time' || atendimento.tipo === 'handoff'
    const espera = !humano && ['enviada','aguardando-cliente'].includes(atendimento.estado)
    const incerto = !humano && ['incerta','reservada'].includes(atendimento.estado)
    return {...base, area: (humano ? 'voce' : incerto ? 'conferencia' : espera ? 'cliente' : 'time') as AreaComercial,
      emEspera: !humano && (['aguardar','restrito'].includes(atendimento.estado) || espera || incerto),
      acao: atendimento.texto || atendimento.motivo || atendimento.titulo,
      responsavel: humano ? 'Rômulo' : espera ? 'Cliente' : 'Carla · atendimento',
      condicao: atendimento.motivo, prazo: humano ? 'Conferir o atendimento' : espera ? 'Até nova resposta' : 'Conforme o executor do atendimento'}
  }
  if (ciclo.cobrancas.some(c => c.saldo > 0)) return {...base,area:'voce' as AreaComercial,acao:'Conferir o recebimento e o saldo da cobrança com as condições aceitas',responsavel:'Rômulo',resultado:'Recebimento real confirmado ou condição de espera registrada.',condicao:'A confirmação de pagamento é humana; vencimento não autoriza cobrança automática.'}
  if (plano.tipo === 'aguardar') return {...base,area:'cliente' as AreaComercial}
  if (lead.classificacaoResposta?.classe === 'robo' || lead.sinal === 'sem-contato') return {...base,area:'conferencia' as AreaComercial}
  // Sem evento explícito de início, o time não é apresentado como já executando.
  return {...base,area:'voce' as AreaComercial}
}
