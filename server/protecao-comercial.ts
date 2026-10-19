import type { CrmLead } from './crm.ts'
import { aprendizadoDoLead, contatoPausado } from '../src/operations/aprendizado-comercial.ts'

const instante = (s?: string) => Date.parse(s ?? '') || 0
const FINAIS = new Set(['recusou', 'sem_contato', 'dispensado'])
const DESFECHOS = new Set([...FINAIS, 'recusou_desfeito', 'sem_contato_desfeito', 'dispensado_desfeito'])

/** Um encerramento humano anterior à conversa nova não autoriza limpar a demo. */
export function encerramentoAtual(lead: CrmLead): boolean {
  const ultimo = lead.eventos.filter(e => e.origem === 'manual' && DESFECHOS.has(e.tipo))
    .sort((a, b) => instante(b.em) - instante(a.em))[0]
  const aprendizado = aprendizadoDoLead(lead)
  const contexto = Math.max(instante(lead.conversa?.ultimaEntrada), instante(lead.marcos.respondeu), instante(lead.resposta?.em), instante(lead.proposta?.em),
    instante(lead.proximoPasso?.registradoEm), aprendizado?.pausarAteResposta ? instante(aprendizado.em) : 0)
  return Boolean(ultimo && FINAIS.has(ultimo.tipo) && instante(ultimo.em) > 0 && instante(ultimo.em) >= contexto)
}

export function revisaoComercialDoLead(lead: CrmLead, agora: number): string | undefined {
  if (lead.etapa === 'ganho' || encerramentoAtual(lead)) return undefined
  if (lead.etapa === 'perdido' && lead.estadoNaPlanilha === 'recusado' && lead.resposta && !['negativa', 'exclusao'].includes(lead.resposta.tipo)) {
    return 'A planilha mantém Recusado, mas a resposta atual não é uma recusa. Confira o histórico e use Revisar classificação nesta ficha antes de encerrar ou retomar.'
  }
  const humana = Math.max(instante(lead.conversa?.ultimaEntrada), lead.resposta?.tipo === 'bot' ? 0 : instante(lead.marcos.respondeu))
  if (['negativa', 'exclusao'].includes(lead.resposta?.tipo ?? '') && humana > instante(lead.resposta?.em)) {
    return 'A conversa continuou depois da classificação de recusa. Confira o contexto e revise a classificação antes de encerrar ou retomar.'
  }
  if (lead.etapa === 'contato' && !lead.proximoPasso && !lead.proposta && humana && agora - humana >= 7 * 86400000) {
    return 'Conversa sem retorno há pelo menos 7 dias. Confira o último combinado e registre espera, próximo passo ou encerramento; não envie outra cobrança automaticamente.'
  }
  return undefined
}

export function protecaoDaDemo(lead: CrmLead): string | undefined {
  if (lead.produto !== 'site' || lead.etapa === 'ganho') return undefined
  if (encerramentoAtual(lead)) return undefined
  if (lead.proximoPasso?.texto) return 'Há um próximo passo salvo. Resolva-o antes de encerrar a demo.'
  if (lead.revisaoComercial) return lead.revisaoComercial
  if (contatoPausado(lead)) return 'O contato está em espera por decisão humana.'
  if (lead.proposta) return 'Há proposta sem encerramento manual posterior.'
  if ((lead.resposta && ['negativa', 'exclusao'].includes(lead.resposta.tipo)) || lead.motivoPerda === 'recusou' || lead.motivoPerda === 'sem-interesse') return 'A recusa foi classificada automaticamente; confirme o encerramento antes da limpeza.'
  if (lead.conversa?.ultimaEntrada || (lead.marcos.respondeu && lead.resposta?.tipo !== 'bot')) {
    return 'Há conversa humana. A demo só pode expirar depois de um encerramento manual atual.'
  }
  if (!lead.conversa?.mensagens) return 'Sem histórico disponível não se comprova ausência de conversa. Confira antes de expirar a demo.'
  return undefined
}
