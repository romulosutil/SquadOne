import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CHAVE_DA_VISTA, CHAVE_DA_VISTA_DA_CENTRAL, escalaInteira, gravarVista, lerVistaGuardada, vistaInicial, vistaInicialDaCentral } from './vista.ts'

const memoria = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const quebrado = {
  getItem: () => { throw new Error('SecurityError') },
  setItem: () => { throw new Error('QuotaExceededError') },
}

describe('vista do escritório', () => {
  it('lista no celular, mapa no desktop, e a escolha guardada vence', () => {
    assert.equal(vistaInicial(null, false), 'lista')
    assert.equal(vistaInicial(null, true), 'mapa')
    assert.equal(vistaInicial('lista', true), 'lista')
  })

  it('grava e lê; valor estranho vale como nada guardado', () => {
    const s = memoria()
    gravarVista(s, 'mapa')
    assert.equal(s.m.get(CHAVE_DA_VISTA), 'mapa')
    assert.equal(lerVistaGuardada(s), 'mapa')
    s.m.set(CHAVE_DA_VISTA, 'grade')
    assert.equal(lerVistaGuardada(s), null)
  })

  it('na Central, mapa por padrão em qualquer tela, guardado à parte do Escritório', () => {
    assert.equal(vistaInicialDaCentral(null), 'mapa')
    assert.equal(vistaInicialDaCentral('lista'), 'lista')
    const s = memoria()
    gravarVista(s, 'lista', CHAVE_DA_VISTA_DA_CENTRAL)
    assert.equal(lerVistaGuardada(s, CHAVE_DA_VISTA_DA_CENTRAL), 'lista')
    assert.equal(lerVistaGuardada(s), null)
  })

  it('storage que lança (modo privado) não derruba a tela', () => {
    assert.equal(lerVistaGuardada(quebrado), null)
    assert.doesNotThrow(() => gravarVista(quebrado, 'lista'))
    assert.equal(lerVistaGuardada(null), null)
  })
})

describe('escalaInteira', () => {
  it('maior inteiro que cabe, entre 1 e o teto', () => {
    assert.equal(escalaInteira({ w: 1200, h: 700 }, { w: 500, h: 300 }), 2)
    assert.equal(escalaInteira({ w: 2000, h: 2000 }, { w: 300, h: 200 }), 3)
    assert.equal(escalaInteira({ w: 358, h: 400 }, { w: 900, h: 500 }), 1)
    assert.equal(escalaInteira({ w: 0, h: 0 }, { w: 900, h: 500 }), 1)
  })
})
