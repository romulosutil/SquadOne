import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ehSalaDeFinancas, estadoDoAgente } from './salaFinancas.ts'

describe('Sala Finanças', () => {
  it('reconhece pelo nome (com ou sem acento) ou pelo id', () => {
    assert.equal(ehSalaDeFinancas({ id: 'pessoal--x', nome: 'Finanças' }), true)
    assert.equal(ehSalaDeFinancas({ id: 'pessoal--x', nome: ' financas ' }), true)
    assert.equal(ehSalaDeFinancas({ id: 'pessoal--financas', nome: 'Dinheiro' }), true)
    assert.equal(ehSalaDeFinancas({ id: 'pessoal--financas-pj', nome: 'Finanças PJ' }), false)
  })

  it('estado do agente: as duas % e a pior cor; nada sem dado', () => {
    assert.deepEqual(
      estadoDoAgente({ cartao: { pct: 72, semaforo: 'amarelo', nome: 'X' }, orcamento: { pct: 95, semaforo: 'laranja' } }),
      { texto: 'cartão 72% · orçamento 95%', semaforo: 'laranja' },
    )
    assert.deepEqual(estadoDoAgente({ cartao: null, orcamento: { pct: 10, semaforo: 'verde' } }), { texto: 'orçamento 10%', semaforo: 'verde' })
    assert.equal(estadoDoAgente({ cartao: null, orcamento: null }), null)
    assert.equal(estadoDoAgente(null), null)
  })

  it('nunca leva R$ nem o nome do cartão', () => {
    const e = estadoDoAgente({ cartao: { pct: 100, semaforo: 'vermelho', nome: 'Visa Gold' }, orcamento: null })!
    assert.ok(!/R\$|Visa/.test(e.texto))
  })
})
