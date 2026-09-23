import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { motivosObrigatorios, podeEnviarAvaliacao } from './avaliacao'

describe('avaliação de turno', () => {
  it('exige motivo somente para notas de 1 a 3', () => {
    assert.equal(motivosObrigatorios(1), true)
    assert.equal(motivosObrigatorios(3), true)
    assert.equal(motivosObrigatorios(4), false)
    assert.equal(motivosObrigatorios(5), false)
  })

  it('só permite enviar nota baixa quando houver motivo', () => {
    assert.equal(podeEnviarAvaliacao(null, []), false)
    assert.equal(podeEnviarAvaliacao(2, []), false)
    assert.equal(podeEnviarAvaliacao(2, ['agendamento']), true)
    assert.equal(podeEnviarAvaliacao(5, []), true)
  })

  it('espelha o limite de três motivos do servidor', () => {
    assert.equal(podeEnviarAvaliacao(2, ['prompt', 'papel', 'roteamento', 'outro']), false)
    assert.equal(podeEnviarAvaliacao(5, ['prompt', 'papel', 'roteamento', 'outro']), false)
  })
})
