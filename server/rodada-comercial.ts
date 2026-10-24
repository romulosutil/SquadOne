import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { CrmLead } from '../src/operations/types.ts'
import { chaveDoNumero } from './conversa-do-lead.ts'

interface Reserva { leadId: string; em: number }
interface Rodada { versao: 1; inicio: string; limite: number; reservas: Record<string, Reserva>; revisoes: { em: string; motivo: string; inicioAnterior: string | null; pendentes: number }[] }
const valido = (v: unknown): v is Rodada => {
  if (!v || typeof v !== 'object') return false
  const r = v as Rodada
  return r.versao === 1 && Number.isFinite(Date.parse(r.inicio)) && r.limite === 10 && !!r.reservas && typeof r.reservas === 'object' && !Array.isArray(r.reservas)
    && Object.entries(r.reservas).every(([k,p]) => /^[a-f0-9]{64}$/.test(k) && p && typeof p.leadId === 'string' && Number.isFinite(p.em)) && Array.isArray(r.revisoes)
}
const chave = (l: CrmLead) => {
  // O mesmo número nas diferentes ofertas ocupa uma vaga; não expor telefone no arquivo de controle.
  let destino = l.id
  try { const u = new URL(l.links.whatsapp ?? ''); if (u.hostname === 'wa.me') destino = chaveDoNumero(u.pathname.slice(1)) || destino } catch { /* Sem destino válido: conserva a identidade do CRM. */ }
  return createHash('sha256').update(destino).digest('hex')
}
function respostaHumana(l: CrmLead, depois: number, agora: number) {
  const candidatos = [l.conversa?.ultimaEntrada,
    l.classificacaoResposta?.houveRespostaHumana ? l.classificacaoResposta.evidencia?.em : undefined,
    l.resposta && l.resposta.tipo !== 'bot' ? l.resposta.em : undefined]
  return candidatos.some(v => { const em = Date.parse(v ?? ''); return em >= depois && em <= agora })
}
/** Junta reservas conservadoras e envios observados. Nem silêncio, prazo, perda automática ou robô liberam vaga. */
function pendentes(r: Rodada, leads: readonly CrmLead[], agora: number) {
  const contatos = new Map(Object.entries(r.reservas))
  const porDestino = new Map<string, CrmLead[]>()
  const inicio = Date.parse(r.inicio)
  for (const l of leads) {
    const k = chave(l)
    porDestino.set(k,[...(porDestino.get(k) ?? []),l])
    const em = Date.parse(l.marcos.enviado ?? '')
    if (em >= inicio && em <= agora && !contatos.has(k)) contatos.set(k, { leadId:l.id, em })
  }
  return [...contatos].filter(([k,p]) => !(porDestino.get(k) ?? []).some(l => respostaHumana(l,p.em,agora)))
}
export function criarRodadaComercial(arquivo: string, agora = Date.now) {
  let fila: Promise<unknown> = Promise.resolve()
  const serie = <T>(f: () => Promise<T>) => { const p = fila.then(f,f); fila = p.catch(() => undefined); return p }
  async function ler(): Promise<Rodada | null> {
    try { const r: unknown = JSON.parse(await fs.readFile(arquivo,'utf8')); if (!valido(r)) throw new Error('Controle da rodada inválido; exige revisão.'); return r }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  }
  async function gravar(r: Rodada) {
    await fs.mkdir(path.dirname(arquivo), { recursive:true })
    const tmp = `${arquivo}.${randomUUID()}.tmp`
    await fs.writeFile(tmp,JSON.stringify(r),{ mode:0o600 }); await fs.rename(tmp,arquivo)
  }
  function resumo(r: Rodada | null, leads: readonly CrmLead[]) {
    const itens = r ? pendentes(r,leads,agora()) : []
    return { inicio:r?.inicio ?? null, limite:10, pendentes:itens.length, bloqueado:!r || itens.length >= 10,
      motivo:!r ? 'Inicie a rodada após revisão humana.' : itens.length >= 10 ? 'Dez contatos aguardando resposta humana. Revise a rodada antes de novos contatos.' : 'Vagas disponíveis; expediente e ritmo continuam valendo.',
      clientes:itens.map(([,p]) => ({ leadId:p.leadId, reservadoEm:new Date(p.em).toISOString() })), revisoes:r?.revisoes ?? [] }
  }
  return {
    status: (leads: readonly CrmLead[]) => serie(async () => resumo(await ler(),leads)),
    revisar: (motivo: string, inicioAnterior: string | null, leads: readonly CrmLead[]) => serie(async () => {
      if (!motivo.trim() || motivo.trim().length > 400) throw new Error('Registre o motivo da revisão (até 400 caracteres).')
      const anterior = await ler()
      if ((anterior?.inicio ?? null) !== inicioAnterior) throw new Error('A rodada mudou. Atualize antes de revisar.')
      const em = new Date(agora()).toISOString()
      const r: Rodada = { versao:1, inicio:em, limite:10, reservas:{}, revisoes:[...(anterior?.revisoes ?? []),{ em, motivo:motivo.trim(), inicioAnterior, pendentes:anterior ? pendentes(anterior,leads,agora()).length : 0 }] }
      await gravar(r); return resumo(r,leads)
    }),
    reservar: <R extends { ok: boolean }>(lead: CrmLead, leads: readonly CrmLead[], executar: () => Promise<R>) => serie(async (): Promise<R | { ok:false; motivo:'sem-resposta' | 'rodada-nao-iniciada' | 'ja-reservado'; ate:null }> => {
      const r = await ler()
      if (!r) return { ok:false, motivo:'rodada-nao-iniciada', ate:null }
      const k = chave(lead)
      if (r.reservas[k]) return { ok:false, motivo:'ja-reservado', ate:null }
      if (pendentes(r,leads,agora()).length >= r.limite) return { ok:false, motivo:'sem-resposta', ate:null }
      // Persistir antes de qualquer envio/reserva diária. Exceção retém a vaga para conferência.
      r.reservas[k] = { leadId:lead.id, em:agora() }; await gravar(r)
      const resultado = await executar()
      if (!resultado.ok) { delete r.reservas[k]; await gravar(r) }
      return resultado
    }),
  }
}
export type RodadaComercial = ReturnType<typeof criarRodadaComercial>
