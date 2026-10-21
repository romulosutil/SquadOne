import type { InjectionKey } from 'vue'
import type { CrmLead } from '../operations/types'

export type FatoDaVenda = 'envio' | 'retorno' | 'passo' | 'complemento'
export const acompanharVenda: InjectionKey<(lead: CrmLead, texto: string) => void> = Symbol('acompanharVenda')

export function registroDaSala(lead: Pick<CrmLead, 'produto' | 'id' | 'chave'>, fato: FatoDaVenda, texto: string, data: string, agora = new Date()) {
  if (!['envio', 'retorno', 'passo', 'complemento'].includes(fato)) throw new Error('Escolha o tipo de registro.')
  const conteudo = texto.trim()
  if (!conteudo) throw new Error('Descreva o que aconteceu ou o próximo passo.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(Date.parse(`${data}T12:00:00Z`)) || new Date(`${data}T12:00:00Z`).toISOString().slice(0, 10) !== data) throw new Error('Informe uma data válida.')
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
  if (fato !== 'passo' && data > hoje) throw new Error('Um fato já ocorrido não pode ter data futura.')
  const prefixo = fato === 'envio' ? `[Envio confirmado pelo operador · ${data}]\n` : fato === 'retorno' ? `[Retorno informado pelo operador · ${data}]\n` : fato === 'complemento' ? `[Contexto complementar · ${data}]\n` : ''
  if ((prefixo + conteudo).length > 1000) throw new Error('Reduza o texto para caber no registro (até 1000 caracteres).')
  return { produto: lead.produto, id: lead.chave, tipo: fato === 'passo' ? 'proximo_passo' : 'nota', texto: prefixo + conteudo, data: fato === 'passo' ? data : '' }
}
