import { ref, type InjectionKey } from 'vue'
import { diaEmSP } from '../operations/retomadas'
import type { CrmLead } from '../operations/types'
import { impedimentoDaMensagem } from '../operations/revisao-resposta'
export interface RascunhoDaVenda { produto: string; id: string; texto: string; contextoHash: string; para: string; guardadoEm: string }
export const voltarAosPassos: InjectionKey<() => void> = Symbol('voltar-aos-passos')
export function apenasPreparar(para: string, agora = new Date()) { return !!para && para > diaEmSP(agora) }
type Memoria = Pick<Storage, 'getItem' | 'setItem'>
const versao = ref(0)
const chave = (lead: Pick<CrmLead, 'produto' | 'id'>) => `squadone.rascunho-venda.${JSON.stringify([lead.produto, lead.id])}`
export function lerRascunhoDaVenda(lead: Pick<CrmLead, 'produto' | 'id'>, memoria?: Memoria): RascunhoDaVenda | null {
  void versao.value
  try {
    const r = JSON.parse((memoria ?? localStorage).getItem(chave(lead)) ?? 'null')
    return r && r.produto === lead.produto && r.id === lead.id && typeof r.texto === 'string' && !impedimentoDaMensagem(r.texto) && /^[a-f0-9]{64}$/.test(r.contextoHash) && /^\d{4}-\d{2}-\d{2}$/.test(r.para) ? r : null
  } catch { return null }
}
export function guardarRascunhoDaVenda(lead: Pick<CrmLead, 'produto' | 'id'>, texto: string, contextoHash: string, para: string, memoria?: Memoria) {
  if (impedimentoDaMensagem(texto) || !/^[a-f0-9]{64}$/.test(contextoHash) || !/^\d{4}-\d{2}-\d{2}$/.test(para)) throw new Error('Confira o texto, o contexto e a data do rascunho.')
  const r: RascunhoDaVenda = { produto: lead.produto, id: lead.id, texto, contextoHash, para, guardadoEm: new Date().toISOString() }
  try { (memoria ?? localStorage).setItem(chave(lead), JSON.stringify(r)) } catch { throw new Error('Este aparelho não permitiu guardar o rascunho. Mantenha a tela aberta ou copie o texto.') }
  versao.value++
  return r
}
