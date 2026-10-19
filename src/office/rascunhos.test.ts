import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardarRascunhoDaVenda, lerRascunhoDaVenda, apenasPreparar } from './rascunhos.ts'
import { PEDIDO_DE_PREPARO_AMANHA } from '../operations/retomadas.ts'
import { rotearLocal } from '../operations/assistente.ts'
test('rascunho preserva edição, data e contexto por oferta/lead, sem misturar clientes', () => {
  const dados = new Map<string, string>()
  const memoria = { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => { dados.set(k, v) } }
  const lead = { produto: 'prumo' as const, id: 'prumo:qa' }
  const texto = 'Olá, Ana! O horário que combinamos continua bom?'
  guardarRascunhoDaVenda(lead, texto, 'a'.repeat(64), '2026-10-19', memoria)
  assert.equal(lerRascunhoDaVenda(lead, memoria)?.texto, texto)
  assert.equal(lerRascunhoDaVenda(lead, memoria)?.para, '2026-10-19')
  assert.equal(lerRascunhoDaVenda({ ...lead, id: 'prumo:outro' }, memoria), null)
  assert.equal(lerRascunhoDaVenda({ ...lead, produto: 'site' }, memoria), null)
  assert.throws(() => guardarRascunhoDaVenda(lead, 'Oi [link]', 'a'.repeat(64), '2026-10-19', memoria))
  assert.throws(() => guardarRascunhoDaVenda(lead, texto, 'a'.repeat(64), '2026-10-19', { ...memoria, setItem: () => { throw new Error('sem espaço') } }), /não permitiu guardar/)
  assert.equal(rotearLocal(PEDIDO_DE_PREPARO_AMANHA, 'escritorio').regra, null)
})

test('antes da data só prepara; na data exige nova revisão para WhatsApp, respeitando São Paulo', () => {
  assert.equal(apenasPreparar('2026-10-19', new Date('2026-10-19T01:00:00Z')), true)
  assert.equal(apenasPreparar('2026-10-19', new Date('2026-10-19T03:00:00Z')), false)
  assert.equal(apenasPreparar('2026-10-19', new Date('2026-10-20T12:00:00Z')), false)
})
