import fs from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { CanalComercial, CanaisComerciais, ContatoLinkedIn, EventoWhatsApp, FonteComercial, PedidoComercial } from '../src/operations/canais-comerciais.ts'
import { telefoneDaConversa } from '../src/operations/responsavel-conversa.ts'
import type { CrmLead } from '../src/operations/types.ts'
import { diaDeSP } from './tempo.ts'

const MINUTO = 60_000
const REGISTRO_ID = /^[\w-]{1,120}$/
const EXECUCAO_ID = /^\d{1,20}$/

export interface FontesDosCanais {
  agenda: string
  operacao: string
  registroWhatsApp: string
}

async function json(arquivo: string): Promise<Record<string, unknown> | null> {
  try {
    const valor: unknown = JSON.parse(await fs.readFile(arquivo, 'utf8'))
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : null
  } catch { return null }
}

function instante(valor: unknown, agora: number): string | undefined {
  if (typeof valor !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(valor)) return
  const em = Date.parse(valor)
  if (Number.isFinite(em) && em <= agora) return new Date(em).toISOString()
}

function fonte(em: string | undefined, agora: number, tolerancia: number): FonteComercial {
  return em ? { em, estado: agora - Date.parse(em) > tolerancia * MINUTO ? 'desatualizada' : 'atual' } : { estado: 'indisponivel' }
}

async function lerPedido(arquivo: string, agora: number): Promise<PedidoComercial | null> {
  const p = await json(arquivo)
  const criadoEm = instante(p?.criadoEm, agora)
  if (p?.versao !== 1 || !criadoEm || typeof p.workflowId !== 'string' || !REGISTRO_ID.test(p.workflowId)
    || typeof p.execucaoId !== 'string' || !EXECUCAO_ID.test(p.execucaoId)) return null
  return { versao: 1, workflowId: p.workflowId, execucaoId: p.execucaoId, criadoEm }
}

async function lerBanco<T>(arquivo: string, ler: (db: DatabaseSync) => T): Promise<T | null> {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(arquivo, { readOnly: true })
    try {
      db.exec('PRAGMA query_only=ON')
      return ler(db)
    } finally { db.close() }
  } catch { return null }
}

type RegistroWhatsApp = { chave: string; id: string; estado: EventoWhatsApp['estado']; em: string; recibo: string }
type Ficha = Pick<CrmLead, 'id' | 'links'>

function projetarWhatsApp(rows: RegistroWhatsApp[], fichas: readonly Ficha[], agora: number, dia: string) {
  const fichasPorId = new Map(fichas.map(f => [f.id, f]))
  const registros = rows.flatMap(r => {
    const em = instante(r.em, agora)
    return em ? [{ ...r, em, recibo: r.recibo?.trim() ?? '' }] : []
  })
  const recibos = new Map<string, number>()
  for (const r of registros) if (r.estado === 'enviado' && r.recibo) recibos.set(r.recibo, (recibos.get(r.recibo) ?? 0) + 1)

  const porFicha: Array<[string, EventoWhatsApp]> = []
  const envios = new Set<string>()
  let incertos = 0
  for (const r of registros) {
    const hora = Date.parse(r.em)
    const hoje = agora - hora < 36 * 60 * MINUTO && diaDeSP(hora) === dia
    const confirmado = r.estado === 'enviado' && !!r.recibo && recibos.get(r.recibo) === 1
    const estado = r.estado === 'enviado' && !confirmado ? 'sem_confirmacao' : r.estado
    if (hoje && confirmado) envios.add(r.recibo)
    if (estado === 'incerto' || (hoje && estado === 'sem_confirmacao')) incertos++
    const ficha = fichasPorId.get(r.id)
    if (ficha && telefoneDaConversa(ficha) === r.chave) {
      porFicha.push([r.id, { estado, em: r.em, ...(confirmado ? { recibo: r.recibo } : {}) }])
    }
  }
  return { envios: envios.size, incertos, porFicha: Object.fromEntries(porFicha), recibosEmConflito: [...recibos.values()].filter(n => n > 1).length }
}

function lerContatosLinkedIn(db: DatabaseSync, agora: number, dia: string) {
  const linhas = db.prepare(`
    SELECT c.id, c.perfil, c.nome, c.empresa, c.mensagem, c.estado, c.reservadoEm,
           c.confirmadoEm, c.conversa, c.evidencia,
           (SELECT detalhe FROM eventos WHERE contato=c.id AND tipo='encerrado-sem-reenvio' ORDER BY id DESC LIMIT 1) AS bloqueio
    FROM contatos c ORDER BY c.reservadoEm DESC
  `).all() as unknown as ContatoLinkedIn[]
  const contatos = linhas.flatMap(c => {
    const reservadoEm = instante(c.reservadoEm, agora)
    if (!reservadoEm || !['enviado', 'incerto', 'bloqueado'].includes(c.estado)) return []
    const confirmadoEm = instante(c.confirmadoEm, agora)
    if (c.estado === 'enviado' && (!confirmadoEm || !c.conversa || !c.evidencia?.trim())) {
      return [{ ...c, reservadoEm, estado: 'incerto' as const, confirmadoEm: null, conversa: null, evidencia: null }]
    }
    return [{ ...c, reservadoEm, confirmadoEm: confirmadoEm ?? null }]
  })
  return {
    contatos,
    envios: contatos.filter(c => c.estado === 'enviado' && c.confirmadoEm && diaDeSP(Date.parse(c.confirmadoEm)) === dia).length,
    incertos: contatos.filter(c => c.estado === 'incerto').length,
  }
}

async function lerBuscaSemCandidato(raiz: string, workflow: string | undefined) {
  return lerBanco(path.join(raiz, 'rodadas.sqlite'), db => {
    // O executor grava sem-candidato somente ao terminar a busca com zero novos envios.
    const linha = db.prepare(`
      SELECT execucao AS execucaoId, slot FROM rodadas
      WHERE estado='sem-candidato' AND (? IS NULL OR workflow=?) ORDER BY slot DESC LIMIT 1
    `).get(workflow ?? null, workflow ?? null)
    if (!linha || typeof linha.execucaoId !== 'string' || !EXECUCAO_ID.test(linha.execucaoId)
      || typeof linha.slot !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(linha.slot)) return null
    return { execucaoId: linha.execucaoId, slot: linha.slot, envios: 0 as const }
  })
}

export async function lerCanaisComerciais(config: FontesDosCanais, fichas: readonly Ficha[], agora = Date.now()): Promise<CanaisComerciais> {
  const dia = diaDeSP(agora)
  const linkedin = path.join(config.operacao, 'linkedin')
  const [pedidoWhatsApp, pedidoLinkedIn, frente, executorLinkedIn, wa, li] = await Promise.all([
    lerPedido(path.join(config.agenda, 'whatsapp-prospeccao', 'ultima-entrega.json'), agora),
    lerPedido(path.join(config.agenda, 'linkedin', 'ultima-entrega.json'), agora),
    json(path.join(config.operacao, 'frente-comercial.json')),
    json(path.join(linkedin, 'executor-estado.json')),
    lerBanco(config.registroWhatsApp, db => projetarWhatsApp(db.prepare(`
      SELECT chave, id, estado, em, recibo FROM contatos
      WHERE estado IN ('enviado','incerto','sem_confirmacao','sem_whatsapp')
    `).all() as unknown as RegistroWhatsApp[], fichas, agora, dia)),
    lerBanco(path.join(linkedin, 'linkedin.sqlite'), db => lerContatosLinkedIn(db, agora, dia)),
  ])
  const ultimaBuscaSemCandidato = await lerBuscaSemCandidato(linkedin, pedidoLinkedIn?.workflowId)
  const canal = (pedido: PedidoComercial | null, estado: Record<string, unknown> | null, tolerancia: number): CanalComercial => ({
    pedido, agenda: fonte(pedido?.criadoEm, agora, tolerancia),
    executor: fonte(instante(estado?.atualizadoEm, agora), agora, tolerancia),
    situacao: typeof estado?.detalhe === 'string' ? estado.detalhe : null,
    envios: null, incertos: null,
  })
  return {
    dia,
    whatsapp: { ...canal(pedidoWhatsApp, frente, 10), porFicha: {}, recibosEmConflito: 0, ...wa },
    linkedin: { ...canal(pedidoLinkedIn, executorLinkedIn?.executor === 'dell-n8n' && executorLinkedIn.versao === 1 ? executorLinkedIn : null, 25),
      contatos: [], ...li, ultimaBuscaSemCandidato },
  }
}
