import type { CrmLead } from './types'

/** Um evento é evidência do que ocorreu, nunca da conclusão de uma tarefa arbitrária. */
export function acompanhamentoObservado(lead: CrmLead, saidaAoAbrir?: string | null): { titulo: string; detalhe: string; tom: 'ok' | 'atencao' | 'neutro' } {
  const c = lead.conversa
  const ultimaSaida = c?.ultimaSaida ?? (c?.ultima.direcao === 'saida' ? c.ultima.em : undefined)
  if (saidaAoAbrir !== undefined && (!ultimaSaida || saidaAoAbrir !== null && Date.parse(ultimaSaida) <= Date.parse(saidaAoAbrir))) return { titulo: 'Aguardando sincronização do envio', detalhe: 'O WhatsApp foi aberto. Quando uma nova mensagem enviada chegar pela integração, ela aparecerá aqui. Você não precisa confirmar nem copiar o texto.', tom: 'neutro' }
  if (!c && lead.etapa === 'novo' && lead.produto !== 'plus') return { titulo: 'Primeiro contato com o time', detalhe: 'O time avalia a empresa e prepara a abordagem. O envio aparece aqui quando for confirmado pela integração.', tom: 'neutro' }
  if (!c) return { titulo: 'Aguardando leitura da integração', detalhe: 'O histórico deste contato ainda não chegou. O time não considera a tarefa concluída sem evidência.', tom: 'atencao' }
  if (c.ultima.direcao === 'entrada' && c.ultima.papel !== 'robo') return { titulo: 'Resposta recebida', detalhe: 'A integração já registrou esta resposta. Use a conversa para continuar; não é preciso registrá-la de novo.', tom: 'ok' }
  if (c.ultima.direcao === 'saida') return { titulo: 'Mensagem observada', detalhe: 'O envio apareceu na integração. O time acompanha a próxima resposta, sem você precisar marcar como feito.', tom: 'ok' }
  return { titulo: 'Time acompanhando', detalhe: 'Há uma resposta automática no histórico. O time aguarda uma resposta humana.', tom: 'neutro' }
}
