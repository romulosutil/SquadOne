import type { CrmVisao } from '../operations/types'
import { filaDaTela, type Resolvidas, type SugestaoDeVenda } from '../operations/proxima-venda'
import { conversasParaVoce } from '../operations/conversas-para-conduzir'
import { decisoesDoEscritorio } from './decisoes'

export interface ResumoCrmEscritorio {
  estado: CrmVisao['estado']; geradoEm?: string
  decisoes: number; conversas: number; primeiraEmpresa?: string
}
/** Mesmo critério dos painéis, sem transferir dossiês e históricos para o escritório fechado. */
export function resumirCrmEscritorio(visao: CrmVisao, agora: number, resolvidas: Resolvidas = {}, sugestoes?: ReadonlyMap<string, SugestaoDeVenda>): ResumoCrmEscritorio {
  const conversas = conversasParaVoce(visao, agora, resolvidas)
  const acoes = filaDaTela(visao, { agora, sugestoes }, resolvidas).filter(a => !a.primeiroContato)
  const decisoes = decisoesDoEscritorio(visao.leads, visao.estado === 'ok' ? acoes : [], agora, conversas).filter(d => d.estado === 'agora')
  return { estado: visao.estado, geradoEm: visao.geradoEm, decisoes: decisoes.length, conversas: conversas.length,
    ...(decisoes[0] ? { primeiraEmpresa: decisoes[0].lead.empresa } : {}) }
}
