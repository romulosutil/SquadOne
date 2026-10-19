import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarRegistro } from '../../server/crm.ts'
import { registroDaSala } from './andamento.ts'
const lead = { produto: 'prumo' as const, id: 'prumo:abc123', chave: 'abc123' }
test('envio confirmado é nota humana, sem marco automático de follow-up', () => {
  assert.deepEqual(registroDaSala(lead, 'envio', 'Olá, quem decide?', '2026-10-18'), { produto: 'prumo', id: 'abc123', tipo: 'nota', texto: '[Envio confirmado pelo operador · 2026-10-18]\nOlá, quem decide?', data: '' })
})
test('retorno preserva palavras e origem humana sem classificar interesse', () => {
  const r = registroDaSala(lead, 'retorno', 'Recepção: vou falar com o responsável', '2026-10-17')
  assert.equal(r.tipo, 'nota'); assert.match(r.texto, /Retorno informado pelo operador/); assert.match(r.texto, /Recepção:/)
})
test('próximo passo usa contrato existente e só a chave do lead correto', () => {
  assert.deepEqual(registroDaSala(lead, 'passo', 'Rômulo: perguntar pelo decisor', '2026-10-20'), { produto: 'prumo', id: 'abc123', tipo: 'proximo_passo', texto: 'Rômulo: perguntar pelo decisor', data: '2026-10-20' })
})
test('não grava texto vazio, sem data, data impossível ou acima do limite', () => {
  for (const [texto, data] of [['', '2026-10-18'], ['retorno', ''], ['retorno', '2026-02-30'], ['x'.repeat(1000), '2026-10-18']]) assert.throws(() => registroDaSala(lead, 'retorno', texto, data))
})

test('contrato de cada ação é aceito pela validação real de Vendas sem outra oferta', () => {
  const agora = new Date('2026-10-18T15:00:00Z')
  for (const fato of ['envio', 'retorno', 'passo'] as const) {
    const entrada = registroDaSala(lead, fato, 'Conferido pelo operador', '2026-10-18', agora)
    assert.deepEqual(validarRegistro(entrada, agora), entrada)
  }
  assert.throws(() => registroDaSala(lead, 'envio', 'teste', '2026-10-19', agora), /futura/)
  assert.throws(() => registroDaSala(lead, 'retorno', 'teste', '2026-10-19', agora), /futura/)
  assert.equal(registroDaSala(lead, 'passo', 'Ação planejada', '2026-10-19', agora).data, '2026-10-19')
})
