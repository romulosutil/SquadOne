import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerJustificativaComercial } from './operations/justificativa-comercial.ts'

test('justificativa comercial antiga ou incompleta não vira evidência fabricada', () => {
  for (const v of [null, undefined, [], {}, { porQueComprar: 'Tem site' }, { porQueComprar: true }]) {
    assert.equal(lerJustificativaComercial(v), null)
  }
})

test('justificativa limita texto e não expõe campos extras do estado privado', () => {
  const j = { porQueComprar: 'Achado a validar', porQueOferta: 'Benefício demonstrável', porQueAgora: 'Sem urgência comprovada', viabilidade: 'Margem ainda não medida' }
  assert.deepEqual(lerJustificativaComercial({ ...j, segredo: 'não retornar' }), j)
  assert.equal(lerJustificativaComercial({ ...j, porQueAgora: '' }), null)
  assert.equal(lerJustificativaComercial({ ...j, viabilidade: 'x'.repeat(1001) }), null)
})
