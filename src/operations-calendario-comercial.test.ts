import './testes/politica-historica.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noExpedienteDeVenda, minutosAteFecharOExpediente, proximaAberturaDoExpediente } from './operations/trava-de-horario.ts'

test('Finados impede primeiro contato e o domingo aponta terça, preservando expediente de terça', () => {
  assert.equal(noExpedienteDeVenda(Date.parse('2026-11-02T10:00:00-03:00')), false)
  assert.equal(minutosAteFecharOExpediente(Date.parse('2026-11-02T10:00:00-03:00')), null)
  assert.equal(proximaAberturaDoExpediente(Date.parse('2026-11-01T10:00:00-03:00')), 'terça às 8h')
  assert.equal(proximaAberturaDoExpediente(Date.parse('2026-11-02T07:00:00-03:00')), 'amanhã às 8h')
  assert.equal(noExpedienteDeVenda(Date.parse('2026-11-03T10:00:00-03:00')), true)
})

test('próxima abertura atravessa feriado de sexta e respeita fuso e data inválida', () => {
  assert.equal(proximaAberturaDoExpediente(Date.parse('2026-11-19T18:00:00-03:00')), 'segunda às 8h')
  assert.equal(noExpedienteDeVenda(Date.parse('2026-11-03T10:59:00Z')), false)
  assert.equal(noExpedienteDeVenda(NaN), false)
  assert.equal(proximaAberturaDoExpediente(NaN), 'no próximo expediente')
})
