/** Contrato estrutural compartilhado pela fila, Telegram e preparo de mensagem. */
export interface AcaoParaConferenciaInterna {
  chave: string
  tipo: string
  conferirHistorico?: boolean
  revisao?: boolean
  interna?: boolean
}
/** Um combinado real continua sendo contato; título e texto livre não decidem o encaminhamento. */
export function acaoInternaComercial(acao: AcaoParaConferenciaInterna | null | undefined): boolean {
  if (!acao || acao.tipo !== 'combinado') return false
  if (['|negociacao-humana', '|qualificacao-comercial', '|ciclo-comercial'].some(s => acao.chave.endsWith(s))) return true
  if (acao.chave.endsWith('|atendimento-comercial')) return acao.interna === true
  return acao.chave.endsWith('|revisao') && (acao.conferirHistorico === true || acao.revisao === true)
}
