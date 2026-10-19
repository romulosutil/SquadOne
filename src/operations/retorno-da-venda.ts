import type { CrmLead } from './types'

/** Nota humana da fonte existente. Data do fato e data do registro são distintas. */
export function ultimoRetornoRegistrado(lead: Pick<CrmLead, 'eventos'>) {
  for (const evento of [...lead.eventos].reverse().sort((a, b) => Date.parse(b.em) - Date.parse(a.em))) {
    if (evento.origem !== 'manual' || !Number.isFinite(Date.parse(evento.em))) continue
    const registro = evento.texto?.replace(/\r\n?/g, '\n').trim() ?? ''
    const m = /^\[Retorno informado pelo operador · (\d{4}-\d{2}-\d{2})\]\n([\s\S]+)$/.exec(registro)
    if (!m || !m[2].trim() || !Number.isFinite(Date.parse(`${m[1]}T12:00:00Z`)) || new Date(`${m[1]}T12:00:00Z`).toISOString().slice(0, 10) !== m[1]) continue
    return { registradoEm: evento.em, ocorreuEm: m[1], texto: m[2].trim(), registro }
  }
  return null
}

export const PEDIDO_DE_RESPOSTA_AO_RETORNO = 'Use o último retorno informado pelo operador e relido de Vendas para preparar a próxima resposta deste lead e revisar o próximo passo atual. Considere a data em que o cliente falou, sem confundir com a data de registro, e confronte com mensagens posteriores. Mostre em uma frase a evidência usada e a decisão de venda que a resposta busca esclarecer. Entregue um cartão de mensagem curta, com uma pergunta útil, e um cartão de próximo passo para minha confirmação. Preserve combinados existentes que continuam válidos; se faltar confirmação ou data, proponha uma nota com a condição pendente. Não execute ações nem presuma interesse, compromisso ou venda.'
