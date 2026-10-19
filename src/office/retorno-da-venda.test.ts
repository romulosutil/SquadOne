import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CrmEvento } from '../operations/types.ts'
import { ultimoRetornoRegistrado, PEDIDO_DE_RESPOSTA_AO_RETORNO } from '../operations/retorno-da-venda.ts'
import { rotearLocal } from '../operations/assistente.ts'
const nota = (em: string, texto: string, origem: CrmEvento['origem'] = 'manual'): CrmEvento => ({ em, tipo: 'nota', rotulo: 'Nota', fonte: 'planilha', origem, texto })
test('escolhe a última anotação humana, distingue a data do fato e ignora rascunhos ou eventos automáticos', () => {
  const antigo = nota('2026-10-17T10:00:00Z', '[Retorno informado pelo operador · 2026-10-17]\nVou ver')
  const novo = nota('2026-10-18T10:00:00Z', '[Retorno informado pelo operador · 2026-10-16]\nRecepção: fale com Ana')
  const eventos = [novo, nota('2026-10-19T10:00:00Z', '[Retorno informado pelo operador · 2026-10-19]\nAutomático', 'automático'), antigo, nota('2026-10-20T10:00:00Z', 'Rascunho: cliente talvez responda')]
  assert.deepEqual(ultimoRetornoRegistrado({ eventos }), { registradoEm: novo.em, ocorreuEm: '2026-10-16', texto: 'Recepção: fale com Ana', registro: novo.texto })
})
test('nota vazia, data impossível ou sem instante de registro não é evidência de retorno', () => {
  for (const evento of [nota('inválido', '[Retorno informado pelo operador · 2026-10-18]\nok'), nota('2026-10-18T10:00:00Z', '[Retorno informado pelo operador · 2026-02-30]\nok'), nota('2026-10-18T10:00:00Z', '[Retorno informado pelo operador · 2026-10-18]\n  ')]) assert.equal(ultimoRetornoRegistrado({ eventos: [evento] }), null)
  assert.equal(ultimoRetornoRegistrado({ eventos: [] }), null)
})
test('atalho de resposta chega ao roteador sem bloquear por finanças e preserva revisão', () => {
  assert.equal(rotearLocal(PEDIDO_DE_RESPOSTA_AO_RETORNO, 'escritorio').regra, null)
  assert.match(PEDIDO_DE_RESPOSTA_AO_RETORNO, /minha confirmação/)
  assert.match(PEDIDO_DE_RESPOSTA_AO_RETORNO, /Preserve combinados/)
})
