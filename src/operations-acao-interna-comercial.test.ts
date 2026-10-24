import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acaoInternaComercial } from './operations/acao-interna-comercial'
test('atos comerciais internos são identificados por contrato, sem reclassificar combinados reais', () => {
  for (const sufixo of ['negociacao-humana', 'qualificacao-comercial', 'ciclo-comercial']) {
    assert.equal(acaoInternaComercial({ chave: `site:qa|${sufixo}`, tipo: 'combinado' }), true)
    assert.equal(acaoInternaComercial({ chave: `site:qa|${sufixo}`, tipo: 'responder' }), false)
    assert.equal(acaoInternaComercial({ chave: `site:qa|${sufixo}|outro`, tipo: 'combinado' }), false)
  }
  for (const chave of ['site:qa|proximo-passo|2026-10-23', 'site:qa|indicacao|pagamento', 'site:qa|cadencia', 'site:qa|revisao']) assert.equal(acaoInternaComercial({ chave, tipo: 'combinado' }), false)
  assert.equal(acaoInternaComercial({ chave: 'site:qa|revisao', tipo: 'combinado', conferirHistorico: true }), true)
  assert.equal(acaoInternaComercial({ chave: 'site:qa|revisao', tipo: 'combinado', revisao: true }), true)
  assert.equal(acaoInternaComercial(null), false)
})
test('atendimento comercial exige chave exata, tipo e flag interna explícita', () => {
  const a = { chave: 'site:qa|atendimento-comercial', tipo: 'combinado' }
  assert.equal(acaoInternaComercial(a), false)
  assert.equal(acaoInternaComercial({ ...a, interna: true }), true)
  assert.equal(acaoInternaComercial({ ...a, interna: true, tipo: 'responder' }), false)
  assert.equal(acaoInternaComercial({ ...a, interna: true, chave: a.chave + '|outro' }), false)
})
