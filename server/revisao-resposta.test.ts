import assert from 'node:assert/strict'
import { it } from 'node:test'
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { CrmLead, CrmVisao } from '../src/operations/types.ts'
import { montarRevisaoDeResposta } from './revisao-resposta.ts'
import { hashDoContexto } from '../src/operations/revisao-resposta.ts'
import { diaEmSP } from '../src/operations/retomadas.ts'

it('falha de gravação bloqueia repetição automática do mesmo contexto', async () => {
  const lead = { id: 'prumo:abc', chave: 'abc', produto: 'prumo', etapa: 'contato', empresa: 'QA', links: {}, eventos: [], proximoPasso: { texto: 'Ligar', data: diaEmSP(new Date()), registradoEm: '2026-10-18T10:00:00Z' } } as unknown as CrmLead
  let gravacoes = 0
  const app = express(); app.use(express.json())
  montarRevisaoDeResposta(app, { visao: async () => ({ estado: 'ok', leads: [lead] }) as CrmVisao, registrar: async () => { gravacoes++; throw new Error('transporte interrompido') } })
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/crm/proximo-passo/ajustar`
  const corpo = { produto: 'prumo', id: lead.id, acao: 'reagendar', texto: 'Conferir com Ana', data: diaEmSP(new Date(Date.now() + 86400_000)), contextoHash: await hashDoContexto(lead) }
  const enviar = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  try { assert.equal((await enviar()).status, 503); assert.equal((await enviar()).status, 409); assert.equal(gravacoes, 1); assert.equal(lead.proximoPasso?.texto, 'Ligar') }
  finally { await new Promise<void>(r => server.close(() => r())) }
})

it('ajuste exige contexto atual, confirma uma única gravação e preserva oferta, histórico e WhatsApp', async () => {
  const hoje = diaEmSP(new Date())
  const lead = { id: 'prumo:abc', chave: 'abc', produto: 'prumo', etapa: 'contato', empresa: 'Cliente QA', links: { whatsapp: 'https://wa.me/5511999999999' }, eventos: [], proximoPasso: { texto: 'Confirmar decisão', data: hoje, registradoEm: '2026-10-18T10:00:00Z' } } as unknown as CrmLead
  const gravacoes: unknown[] = []
  const app = express(); app.use(express.json())
  montarRevisaoDeResposta(app, { visao: async () => ({ estado: 'ok', leads: [lead] }) as CrmVisao, registrar: async r => { gravacoes.push(r); return { ok: true } } })
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/crm/proximo-passo/ajustar`
  const corpo = { produto: 'prumo', id: lead.id, acao: 'concluir', texto: '', data: hoje, contextoHash: await hashDoContexto(lead) }
  const enviar = (v = corpo) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
  try {
    assert.equal((await enviar({ ...corpo, produto: 'site' })).status, 409)
    lead.eventos.push({ tipo: 'nota', em: new Date().toISOString(), rotulo: 'Retorno novo', origem: 'manual', fonte: 'QA', texto: 'Cliente respondeu' })
    assert.equal((await enviar()).status, 409)
    assert.equal(gravacoes.length, 0)
    corpo.contextoHash = await hashDoContexto(lead)
    const rs = await Promise.all([enviar(), enviar()])
    assert.deepEqual(rs.map(r => r.status).sort(), [201, 409])
    assert.deepEqual(gravacoes, [{ tipo: 'proximo_passo', texto: '', data: hoje, produto: 'prumo', id: 'abc', empresa: 'Cliente QA' }])
    assert.equal(lead.eventos.length, 1); assert.equal(lead.etapa, 'contato'); assert.equal(lead.links.whatsapp, 'https://wa.me/5511999999999')
  } finally { await new Promise<void>(r => server.close(() => r())) }
})

it('conferência de resposta lê somente o lead exato e devolve payload curto, sem dados dos outros leads', async () => {
  const lead = { id: 'prumo:a', produto: 'prumo', links: { whatsapp: 'https://wa.me/5511999999999' }, eventos: [], notas: 0 } as CrmLead
  let disponivel = true
  let leituras = 0
  const app = express()
  montarRevisaoDeResposta(app, { visao: async () => { leituras++; return { estado: disponivel ? 'ok' : 'sem-retrato', leads: [lead, { id: 'site:privado', empresa: 'Outro cliente' }], geradoEm: '2026-10-18T15:00:00Z' } as CrmVisao } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/crm/resposta/contexto`
  try {
    const r = await fetch(`${base}?produto=prumo&id=prumo:a`)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await r.json(), { contextoHash: await hashDoContexto(lead), whatsapp: lead.links.whatsapp, geradoEm: '2026-10-18T15:00:00Z' })
    assert.equal((await fetch(`${base}?produto=site&id=prumo:a`)).status, 404)
    assert.equal((await fetch(`${base}?produto=desconhecido&id=prumo:a`)).status, 400)
    disponivel = false
    assert.equal((await fetch(`${base}?produto=prumo&id=prumo:a`)).status, 503)
    assert.equal((await fetch(base, { method: 'POST' })).status, 404)
    assert.equal(leituras, 3)
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) }
})
