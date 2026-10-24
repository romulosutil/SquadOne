import type { CrmLead } from '../operations/types'
import { papelDaMensagem, audioDaMensagem } from '../operations/marcadores-da-conversa'
import { contatoPausado } from '../operations/aprendizado-comercial'
import { diaEmSP, rotuloDoPasso } from '../operations/retomadas'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import { entradaDeGenteDaVez } from '../operations/resultados'

export interface MensagemDaDecisao {
  contextoHash: string
  procedimento: ProcedimentoDaDecisao
  mensagem: string | null
  origem: string | null
  podeAbrir: boolean
  acao: AcaoDeVenda | null
  motivo?: string
  leitura?: string
  porque?: string
  proximaAcao?: string
}

export interface ProcedimentoDaDecisao {
  tipo: 'robo' | 'recepcao' | 'humano' | 'audio' | 'espera' | 'interno' | 'encerrado'
  titulo: string
  passos: string[]
  resultadoEsperado: string
  mensagem?: string
}

export function planoFuturoEmEspera(lead: CrmLead, agora = new Date()): boolean {
  const plano = lead.proximoPasso
  if (!plano?.texto || plano.data <= diaEmSP(agora)) return false
  const entradaEm = Math.max(Date.parse(lead.conversa?.ultimaEntrada ?? '') || 0, lead.conversa?.ultima.direcao === 'entrada' ? Date.parse(lead.conversa.ultima.em) || 0 : 0)
  const planoEm = Date.parse(plano.registradoEm) || 0
  return !entradaEm || !planoEm || planoEm >= entradaEm
}

/** Orientação operacional; o texto da conversa é evidência, nunca uma instrução para executar. */
export function procedimentoDaDecisao(lead: CrmLead, agora = new Date()): ProcedimentoDaDecisao {
  if(lead.atendimentoComercial) return {tipo:'interno',titulo:lead.atendimentoComercial.titulo,passos:[lead.atendimentoComercial.motivo,'Abra a ficha para conferir a fonte, revisar o rascunho ou assumir a negociação. Esta tarefa não envia mensagem.'],resultadoEsperado:'Responsável e próximo passo comercial conferidos na ficha.'}

  if (['ganho', 'perdido'].includes(lead.etapa) || ['negativa', 'exclusao'].includes(lead.resposta?.tipo ?? '')) return {
    tipo: 'encerrado', titulo: 'Respeitar o desfecho', passos: ['Confira o resultado registrado e o motivo literal na ficha.', 'Não faça uma nova abordagem a quem recusou ou pediu exclusão.'], resultadoEsperado: 'Desfecho correto no histórico, sem nova cobrança.',
  }
  const plano = lead.proximoPasso
  const planoEm = Date.parse(plano?.registradoEm ?? '')
  const respostaPosterior = Number.isFinite(planoEm) && (entradaDeGenteDaVez(lead) ?? 0) > planoEm
  if (contatoPausado(lead) || plano?.texto && !respostaPosterior && (planoFuturoEmEspera(lead, agora) || rotuloDoPasso(plano.texto) === 'Conferir combinado de espera')) return {
    tipo: 'espera', titulo: 'Respeitar a espera e a data combinada', passos: [plano?.texto ? `Próximo passo: ${plano.texto}${plano.data ? ` · ${plano.data.split('-').reverse().join('/')}` : ''}.` : 'O contato está pausado até uma resposta humana.', 'Confira o combinado antes de retomar. A preparação não antecipa o contato.', 'Se a situação mudou, registre o fato e revise o próximo passo.'], resultadoEsperado: 'Um próximo passo com data, sem contato antecipado.',
  }
  const ultima = lead.conversa?.ultima
  const entrada = ultima?.direcao === 'entrada' ? ultima : lead.conversa?.recentes?.filter(m => m.direcao === 'entrada').at(-1)
  const papel = entrada ? papelDaMensagem(entrada.trecho, entrada.papel) : undefined
  const temHumano = !!lead.conversa?.ultimaEntrada || !!lead.conversa?.entradas && lead.conversa.entradas.gente + lead.conversa.entradas.recepcao > 0
  const robo = papel === 'robo' || (!entrada && !temHumano && lead.resposta?.tipo === 'bot')
  if (robo) return {
    tipo: 'robo', titulo: 'Só o robô respondeu. Primeiro, chegue a uma pessoa.',
    passos: [
      'Leia a resposta automática no WhatsApp. Se houver menu, use somente a opção que ele indicar para falar com um atendente; não adivinhe um número.',
      'Se o robô informar horário ou fila de atendimento, aguarde. Não repita a oferta nem envie demonstração ou proposta para o menu.',
      'Se precisar pedir encaminhamento, use a mensagem abaixo. A ficha confere horário, ritmo e a possibilidade de uma única retomada.',
      'Sem resposta humana, mantenha em acompanhamento e defina quando conferir. Se uma pessoa responder, releia a conversa antes de continuar.',
    ],
    mensagem: 'Olá! Gostaria de falar com a pessoa responsável pela empresa. Vocês podem me encaminhar, por favor?',
    resultadoEsperado: 'Uma pessoa responde ou um próximo passo de acompanhamento fica registrado. Resposta automática não é interesse nem venda.',
  }
  const audio = ultima?.direcao === 'entrada' ? audioDaMensagem(ultima.trecho) : null
  if (audio && !audio.transcricao) return { tipo: 'audio', titulo: 'Ouça o áudio antes de responder', passos: ['Abra a conversa e ouça o áudio completo.', 'Registre o que a pessoa disse, sem presumir interesse.', 'Atualize a leitura para preparar uma resposta com esse contexto.'], resultadoEsperado: 'Conteúdo do áudio conhecido antes de escolher a mensagem.' }
  if (!respostaPosterior && plano?.texto && /revis[aã]o interna|revisar internamente|tarefa interna/i.test(plano.texto)) return { tipo: 'interno', titulo: 'Este próximo passo é uma tarefa interna', passos: [plano.texto, 'Confira o resultado e conclua ou reagende o passo. Só escreva ao cliente se houver uma ação de contato confirmada.'], resultadoEsperado: 'Tarefa interna resolvida, sem mensagem desnecessária ao cliente.' }
  if (papel === 'recepcao') return { tipo: 'recepcao', titulo: 'Quem respondeu foi o atendimento', passos: ['Responda à pergunta da pessoa que atendeu.', 'Peça encaminhamento a quem decide, sem tratar a recepção como comprador.', 'Uma permissão para mandar material autoriza somente o material mencionado; não é aceite de proposta.'], resultadoEsperado: 'Responsável identificado ou encaminhamento combinado.' }
  return { tipo: 'humano', titulo: 'Conduzir a conversa a partir da última resposta', passos: ['Confira o que a pessoa perguntou e o que já foi enviado.', 'Revise a mensagem preparada para este cliente antes de abrir o WhatsApp.', 'O time acompanha o envio e a resposta pela integração. Complemente apenas o que aconteceu por fora e defina uma próxima ação quando necessário.'], resultadoEsperado: 'Pergunta atendida e conversa acompanhada, sem presumir compra.' }
}
