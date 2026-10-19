import type { CrmLead } from './types'
import { rotuloDoPasso } from './retomadas'
const diaSP = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
/** Prioridade do operador vem de conversa e compromisso, não de uma lacuna de cadastro. */
export function conversasParaConduzir(leads: readonly CrmLead[], agora = Date.now()) {
  const hoje = diaSP(agora)
  return leads.flatMap(lead => {
    if (lead.etapa === 'ganho' || lead.etapa === 'perdido' || lead.resposta?.tipo === 'negativa' || lead.resposta?.tipo === 'exclusao') return []
    const c = lead.conversa
    const em = c ? Date.parse(c.ultima.em) : NaN
    const resposta = !!c && c.ultima.direcao === 'entrada' && c.ultima.papel !== 'robo' && lead.resposta?.tipo !== 'bot' && Number.isFinite(em) && em <= agora && agora - em <= 14 * 86_400_000
    const p = lead.proximoPasso
    const dataValida = !!p && /^\d{4}-\d{2}-\d{2}$/.test(p.data) && Number.isFinite(Date.parse(`${p.data}T12:00:00Z`)) && new Date(`${p.data}T12:00:00Z`).toISOString().slice(0, 10) === p.data
    const combinado = !!p?.texto.trim() && dataValida && p!.data <= hoje
    const espera = !!p && rotuloDoPasso(p.texto) === 'Conferir combinado de espera'
    if (!resposta && (!combinado || espera)) return []
    return [{ lead, prioridade: resposta ? 0 : 1, em: resposta ? em : Date.parse(`${p!.data}T00:00:00-03:00`), rotulo: resposta ? 'Resposta recebida' : p!.data === hoje ? 'Combinado para hoje' : 'Combinado pendente', resposta }]
  }).sort((a,b) => a.prioridade - b.prioridade || (a.prioridade === 0 ? b.em - a.em : a.em - b.em) || a.lead.id.localeCompare(b.lead.id))
}
