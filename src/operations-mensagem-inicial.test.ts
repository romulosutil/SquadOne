import {test} from 'node:test'
import assert from 'node:assert/strict'
import mensagem from '../config/mensagem-inicial.json'
import {aberturaPrumo} from './operations/mensagem-inicial.ts'

test('abertura só se aplica à pesquisa nova e nunca substitui contato anterior',()=>{
  const inicio=Date.parse(mensagem.desde)
  assert.equal(aberturaPrumo(inicio,false),mensagem.texto)
  assert.equal(aberturaPrumo(inicio-1,false),undefined)
  assert.equal(aberturaPrumo(inicio,true),undefined)
  assert.equal(aberturaPrumo(undefined,false),undefined)
  assert.equal(aberturaPrumo(NaN,false),undefined)
  assert.ok(!/https?:|R\$|preparei|demonstração/.test(mensagem.texto))
})
