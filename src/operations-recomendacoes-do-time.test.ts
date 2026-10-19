import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { recomendacoesDoTime } from './operations/recomendacoes-do-time.ts'

describe('recomendações do time por métricas observadas', () => {
  it('mostra gargalo de seleção e concentração com as contagens reais', () => {
    const r = recomendacoesDoTime({ avaliados: 151, selecionados: 12, enviados: 7, setores: [
      { setor: 'Serviços de urgência', avaliados: 90, selecionados: 10, enviados: 7 },
      { setor: 'Advocacia', avaliados: 61, selecionados: 2, enviados: 0 },
    ] })
    assert.equal(r.length, 2)
    assert.match(r[0].evidencia, /12 selecionados entre 151 avaliados \(8%\).*Restam até 5/)
    assert.match(r[1].evidencia, /7 de 7.*2 selecionados são de outros setores/)
  })

  it('não inventa recomendação com retrato ausente ou amostra pequena', () => {
    assert.deepEqual(recomendacoesDoTime(null), [])
    assert.deepEqual(recomendacoesDoTime({ avaliados: 10, selecionados: 2, enviados: 1, setores: [
      { setor: 'Advocacia', avaliados: 10, selecionados: 2, enviados: 1 },
    ] }), [])
  })
})
