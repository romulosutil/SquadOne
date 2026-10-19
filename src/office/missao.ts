import type { CrmLead } from '../operations/types'

export interface MarcoDaMissao {
  id: 'contato' | 'conversa' | 'material' | 'proposta' | 'venda'
  nome: string
  observado: boolean
  /** De onde veio o avanço, quando não é o registro óbvio (o cartão mostra embaixo do nome). */
  detalhe?: string
}

/**
 * A 2ª mensagem do lead (o `text` do link wa.me) leva preço? No Site a SEGUNDA e a SEGUNDA_RAIO_X já
 * dizem "R$ 690 ... R$ 39 por mês" (server/site-mensagem.ts): mandada, a proposta foi junto. A versão
 * em inglês e a do Raio-X avulso sem demo não têm preço, e então a proposta segue por avançar.
 */
function segundaTemPreco(lead: Pick<CrmLead, 'links'>): boolean {
  const url = lead.links?.segunda
  if (!url) return false
  try {
    return (new URL(url).searchParams.get('text') ?? '').includes('R$')
  } catch {
    return false
  }
}

/** PURO. Avanços registrados; abrir um link ou ter material pronto não comprova envio. */
export function marcosDaMissao(lead: CrmLead): MarcoDaMissao[] {
  const material = !!lead.marcos.segundaEnviada || !!lead.conversa?.linkEm
  const propostaRegistrada = !!lead.proposta?.em || lead.etapa === 'proposta' || lead.etapa === 'ganho'
  const precoNaSegunda = !propostaRegistrada && material && segundaTemPreco(lead)
  return [
    { id: 'contato', nome: 'Contato', observado: !!lead.marcos.enviado || (lead.conversa?.mensagens ?? 0) > 0 },
    { id: 'conversa', nome: 'Conversa', observado: !!lead.conversa?.ultimaEntrada || !!lead.resposta && !['bot'].includes(lead.resposta.tipo) },
    { id: 'material', nome: 'Material', observado: material },
    { id: 'proposta', nome: 'Proposta', observado: propostaRegistrada || precoNaSegunda, ...(precoNaSegunda ? { detalhe: 'Preço na 2ª mensagem' } : {}) },
    { id: 'venda', nome: 'Venda', observado: lead.etapa === 'ganho' },
  ]
}
