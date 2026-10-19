import assert from 'node:assert/strict'
import { it } from 'node:test'
import { movimentoPermitido } from './movimento'

it('movimento segue o sistema por padrão e a escolha explícita do usuário tem precedência', () => {
  assert.equal(movimentoPermitido(null, true), false)
  assert.equal(movimentoPermitido(null, false), true)
  assert.equal(movimentoPermitido(true, true), true)
  assert.equal(movimentoPermitido(false, false), false)
})
