import { test } from 'node:test'
import assert from 'node:assert/strict'
import { textoDoAtendimento, guardarTextoDoAtendimento } from './rascunho-atendimento'

test('o texto acompanha a navegação somente para o mesmo cliente, oferta e contexto',()=>{
  const lead={id:'cliente-rascunho',produto:'site' as const}
  guardarTextoDoAtendimento(lead,'contexto-atual','Texto revisado pelo operador')
  assert.equal(textoDoAtendimento(lead,'contexto-atual'),'Texto revisado pelo operador')
  assert.equal(textoDoAtendimento(lead,'contexto-novo'),undefined)
  assert.equal(textoDoAtendimento({...lead,produto:'iris'},'contexto-atual'),undefined)
  assert.equal(textoDoAtendimento({...lead,id:'outro-cliente'},'contexto-atual'),undefined)
  guardarTextoDoAtendimento(lead,'contexto-atual','')
  assert.equal(textoDoAtendimento(lead,'contexto-atual'),'')
})
test('a memória mantém somente os dezesseis clientes consultados por último',()=>{
  for(let i=0;i<17;i++) guardarTextoDoAtendimento({id:`memoria-${i}`,produto:'site'},'ctx',String(i))
  assert.equal(textoDoAtendimento({id:'memoria-0',produto:'site'},'ctx'),undefined)
  assert.equal(textoDoAtendimento({id:'memoria-16',produto:'site'},'ctx'),'16')
})
