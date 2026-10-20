import type { CrmLead } from './types'
import { respondeuDeGente, quisVer } from './resultados'

/** A decisão não informa hora: recorte pelo dia 19/10 no calendário de São Paulo. */
export const INICIO_DO_TESTE_PLUS = Date.parse('2026-10-19T00:00:00-03:00')
export const TAMANHO_DO_TESTE_PLUS = 20
export interface LinhaDoTestePlus { enviados: number; respostas: number; queroVer: number; propostas: number }
const envioPlus = (lead: CrmLead) => {
  const primeiro = Math.min(...lead.eventos.filter(e => e.tipo === 'plus_enviado' && e.origem === 'manual').map(e => Date.parse(e.em)).filter(Number.isFinite))
  return primeiro >= INICIO_DO_TESTE_PLUS ? primeiro : Infinity
}
export function leituraDoTestePlus(leads: readonly CrmLead[], agora: number) {
  const lote = leads.filter(l => l.produto === 'plus' && envioPlus(l) <= agora)
    .sort((a, b) => envioPlus(a) - envioPlus(b) || a.id.localeCompare(b.id)).slice(0, TAMANHO_DO_TESTE_PLUS)
  const fim = lote.length === TAMANHO_DO_TESTE_PLUS ? envioPlus(lote[lote.length - 1]) : agora
  const sites = leads.filter(l => l.produto === 'site' && Date.parse(l.marcos.enviado ?? '') >= INICIO_DO_TESTE_PLUS && Date.parse(l.marcos.enviado ?? '') <= fim)
  const contar = (ls: readonly CrmLead[], envioDe: (l: CrmLead) => number): LinhaDoTestePlus => {
    const r = { enviados: ls.length, respostas: 0, queroVer: 0, propostas: 0 }
    for (const l of ls) {
      const envio = envioDe(l)
      const resposta = Math.max(Date.parse(l.marcos.respondeu ?? '') || 0, Date.parse(l.resposta?.em ?? '') || 0, Date.parse(l.conversa?.ultimaEntrada ?? '') || 0)
      if (respondeuDeGente(l) && resposta >= envio && resposta <= agora) {
        r.respostas++
        if (quisVer(l)) r.queroVer++
      }
      const proposta = Date.parse(l.proposta?.em ?? '')
      if (Number.isFinite(proposta) && proposta >= envio && proposta <= agora) r.propostas++
    }
    return r
  }
  return { inicio: INICIO_DO_TESTE_PLUS, fim, observacaoAte: agora, completo: lote.length === TAMANHO_DO_TESTE_PLUS,
    ids: lote.map(l => l.id), plus: contar(lote, envioPlus), site: contar(sites, l => Date.parse(l.marcos.enviado ?? '')) }
}
