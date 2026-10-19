import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detalharMensalidadeIris, FAIXAS_PRECIFICACAO_IRIS, mensalidadeIrisCentavos, textoDasFaixasIris, PRECOS_CANONICOS_IRIS } from './operations/precos-iris.ts'
import { precosNoTexto } from './operations/colinha.ts'

describe('Iris: preço por ficha ativa em faixas marginais da fonte existente', () => {
  for (const [quantidade, centavos] of [[0, 0], [1, 3900], [15, 58500], [16, 61700], [20, 74500], [40, 138500], [41, 141000]]) {
    it(`${quantidade} fichas ativas: ${centavos} centavos`, () => assert.equal(mensalidadeIrisCentavos(quantidade), centavos))
  }
  for (const q of [-1, -0.1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    it(`recusa quantidade inválida ${q}`, () => assert.throws(() => mensalidadeIrisCentavos(q), RangeError))
  }
  it('a faixa seguinte só cobra as fichas adicionais e conserva as anteriores', () => {
    assert.deepEqual(detalharMensalidadeIris(20), [
      { quantidade: 15, valorCentavos: 3900, subtotalCentavos: 58500 },
      { quantidade: 5, valorCentavos: 3200, subtotalCentavos: 16000 },
    ])
    for (let q = 1; q <= 60; q++) {
      const faixa = FAIXAS_PRECIFICACAO_IRIS.find(f => f.ateQuantidade === null || q <= f.ateQuantidade)!
      assert.equal(mensalidadeIrisCentavos(q) - mensalidadeIrisCentavos(q - 1), faixa.valorCentavos)
    }
    assert.notEqual(mensalidadeIrisCentavos(20), 20 * 3200, 'não aplica desconto retroativo')
  })
  it('texto determinístico usa apenas valores canônicos e não inventa quantidade/total', () => {
    const texto = textoDasFaixasIris()
    assert.match(texto, /ficha ativa/)
    assert.match(texto, /Quantidade de fichas ativas: \[confirmar\]/)
    assert.match(texto, /Total mensal: \[calcular/)
    for (const p of precosNoTexto(texto)) assert.ok(PRECOS_CANONICOS_IRIS.includes(p), p)
  })
})
