import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import {
  CHAVE_DO_TEMA, TEMA_PADRAO, aplicarTema, atributoDoTema, gravarPreferenciaDeTema, lerPreferenciaDeTema, temaVisto,
  type DocumentoComTema, type GuardadorDeTema, type PreferenciaDeTema,
} from './tema'

function memoria(inicial: Record<string, string> = {}): GuardadorDeTema & { dados: Record<string, string> } {
  const dados = { ...inicial }
  return { dados, getItem: (c) => dados[c] ?? null, setItem: (c, v) => { dados[c] = v } }
}
const quebrado: GuardadorDeTema = {
  getItem: () => { throw new Error('SecurityError') },
  setItem: () => { throw new Error('QuotaExceededError') },
}
const documento = (theme?: string): DocumentoComTema => ({ documentElement: { dataset: theme === undefined ? {} : { theme } } })

describe('preferência de tema', () => {
  it('sem nada guardado, o padrão é claro (não segue o sistema sem pedir)', () => {
    assert.equal(TEMA_PADRAO, 'claro')
    assert.equal(lerPreferenciaDeTema(memoria()), 'claro')
    assert.equal(lerPreferenciaDeTema(null), 'claro')
    assert.equal(lerPreferenciaDeTema(undefined), 'claro')
  })

  it('lê as três escolhas válidas e cai no claro com valor inválido', () => {
    for (const p of ['claro', 'escuro', 'automatico'] as const) assert.equal(lerPreferenciaDeTema(memoria({ [CHAVE_DO_TEMA]: p })), p)
    for (const lixo of ['dark', 'sistema', '', 'ESCURO', '{"x":1}']) assert.equal(lerPreferenciaDeTema(memoria({ [CHAVE_DO_TEMA]: lixo })), 'claro', lixo)
  })

  it('storage que lança não derruba: lê o padrão e grava em silêncio', () => {
    assert.equal(lerPreferenciaDeTema(quebrado), 'claro')
    assert.doesNotThrow(() => gravarPreferenciaDeTema(quebrado, 'escuro'))
  })

  it('grava na chave do tema e relê o mesmo valor', () => {
    const s = memoria()
    gravarPreferenciaDeTema(s, 'automatico')
    assert.equal(s.dados[CHAVE_DO_TEMA], 'automatico')
    assert.equal(lerPreferenciaDeTema(s), 'automatico')
  })
})

describe('aplicarTema', () => {
  it('claro e escuro forçam o data-theme; automático tira o atributo', () => {
    const casos: Array<[PreferenciaDeTema, string | undefined]> = [['claro', 'light'], ['escuro', 'dark'], ['automatico', undefined]]
    for (const [pref, esperado] of casos) {
      for (const antes of [undefined, 'light', 'dark']) {
        const d = documento(antes)
        aplicarTema(pref, d)
        assert.equal(d.documentElement.dataset.theme, esperado, `${pref} a partir de ${antes}`)
        assert.equal('theme' in d.documentElement.dataset, esperado !== undefined)
      }
    }
    assert.deepEqual((['claro', 'escuro', 'automatico'] as const).map(atributoDoTema), ['light', 'dark', null])
  })

  it('o tema visto só depende do sistema no automático', () => {
    assert.equal(temaVisto('claro', true), 'claro')
    assert.equal(temaVisto('escuro', false), 'escuro')
    assert.equal(temaVisto('automatico', true), 'escuro')
    assert.equal(temaVisto('automatico', false), 'claro')
  })
})

// O <script> do index.html repete a regra para o primeiro quadro: tem de dar o mesmo que tema.ts.
describe('script do index.html', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')

  function rodar(storage: GuardadorDeTema): string | undefined {
    const d = documento()
    runInNewContext(script, { localStorage: storage, document: d })
    return d.documentElement.dataset.theme
  }

  it('existe e usa a mesma chave', () => {
    assert.ok(script.includes(`'${CHAVE_DO_TEMA}'`), 'chave do tema no index.html')
  })

  it('dá o mesmo atributo que aplicarTema(lerPreferenciaDeTema(...))', () => {
    for (const guardado of [undefined, 'claro', 'escuro', 'automatico', 'lixo']) {
      const s = memoria(guardado === undefined ? {} : { [CHAVE_DO_TEMA]: guardado })
      const d = documento()
      aplicarTema(lerPreferenciaDeTema(s), d)
      assert.equal(rodar(s), d.documentElement.dataset.theme, String(guardado))
    }
    assert.equal(rodar(quebrado), 'light')
  })
})
