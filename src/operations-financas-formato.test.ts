import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hojeEmSaoPaulo, mesesDoFiltro, nomesDasConexoes, separarFuturas } from './operations/financas/formato.ts'

// Finanças, Lançamentos e saúde (AC-26, 17/10/2026): regras puras de apresentação. Nenhum valor
// em R$ passa por aqui.

describe('hojeEmSaoPaulo', () => {
  it('o dia é o de São Paulo, não o UTC', () => {
    // 02:00 UTC de 18/10 ainda é 23:00 de 17/10 em São Paulo (UTC−3).
    assert.equal(hojeEmSaoPaulo(new Date('2026-10-18T02:00:00Z')), '2026-10-17')
    assert.equal(hojeEmSaoPaulo(new Date('2026-10-17T12:00:00Z')), '2026-10-17')
  })
})

describe('separarFuturas: até hoje primeiro, as parcelas futuras à parte', () => {
  const l = (id: string, data: string) => ({ id, data })
  it('hoje conta como até hoje; depois de hoje é futura', () => {
    const { ateHoje, futuras } = separarFuturas([l('a', '2027-01-10'), l('b', '2026-11-10'), l('c', '2026-10-17'), l('d', '2026-10-16')], '2026-10-17')
    assert.deepEqual(ateHoje.map((x) => x.id), ['c', 'd'])
    // A próxima a vencer primeiro.
    assert.deepEqual(futuras.map((x) => x.id), ['b', 'a'])
  })
  it('no mesmo dia as futuras mantêm a ordem que veio', () => {
    const { futuras } = separarFuturas([l('x', '2026-12-01'), l('y', '2026-12-01')], '2026-10-17')
    assert.deepEqual(futuras.map((f) => f.id), ['x', 'y'])
  })
  it('data com hora não confunde o corte', () => {
    const { ateHoje, futuras } = separarFuturas([l('h', '2026-10-17T23:59:00')], '2026-10-17')
    assert.deepEqual([ateHoje.length, futuras.length], [1, 0])
  })
})

describe('mesesDoFiltro: o select no lugar do input de mês', () => {
  it('"Todos os meses" primeiro, depois este mês, os anteriores e os à frente', () => {
    const o = mesesDoFiltro('2026-10', '')
    assert.deepEqual(o[0], { valor: '', rotulo: 'Todos os meses', futuro: false })
    assert.deepEqual(o[1], { valor: '2026-10', rotulo: 'outubro de 2026 (este mês)', futuro: false })
    assert.equal(o[2].valor, '2026-09')
    assert.equal(o.filter((x) => !x.futuro && x.valor).length, 25)
    assert.deepEqual(o.filter((x) => x.futuro).map((x) => x.valor).slice(0, 2), ['2026-11', '2026-12'])
    assert.equal(o.filter((x) => x.futuro).length, 12)
  })
  it('um mês do endereço fora da faixa entra, para o select mostrar o filtro de verdade', () => {
    const o = mesesDoFiltro('2026-10', '2020-01')
    assert.ok(o.some((x) => x.valor === '2020-01' && !x.futuro))
  })
  it('mês ilegível no endereço não vira opção', () => {
    assert.ok(!mesesDoFiltro('2026-10', 'xx').some((x) => x.valor === 'xx'))
  })
})

describe('nomesDasConexoes: cada selo diz de qual conexão é', () => {
  it('nomes repetidos sem contas ganham "conexão i de N"', () => {
    assert.deepEqual(nomesDasConexoes([{ nome: 'MeuPluggy' }, { nome: 'MeuPluggy' }, { nome: 'Nubank' }]), [
      'MeuPluggy (conexão 1 de 2)', 'MeuPluggy (conexão 2 de 2)', 'Nubank',
    ])
  })
  it('com as contas da conexão, o selo as nomeia', () => {
    assert.deepEqual(nomesDasConexoes([{ nome: 'MeuPluggy', contas: ['Itaú Corrente', ' Cartão Itaú '] }, { nome: 'MeuPluggy', contas: [] }]), [
      'MeuPluggy: Itaú Corrente, Cartão Itaú', 'MeuPluggy',
    ])
  })
  it('nome único fica como está', () => {
    assert.deepEqual(nomesDasConexoes([{ nome: 'Santander' }]), ['Santander'])
  })
})
