import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  contraste, cssDoArquivo, desviosDaEscala, grupoDoToken, lerRgb, lerTokens, nivelWcag, pedidoDeMudanca,
  PARES_DE_CONTRASTE, variaveisDefinidas, variaveisUsadas,
} from './tokens'
import { CATALOGO } from './catalogo'

const RAIZ = join(import.meta.dirname, '..')
const TOKENS = readFileSync(join(RAIZ, 'estilos', 'tokens.css'), 'utf8')

function estilos(dir = RAIZ, out: Array<{ arquivo: string; css: string }> = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) estilos(p, out)
    else if (/\.(css|vue)$/.test(nome)) out.push({ arquivo: relative(RAIZ, p).replaceAll('\\', '/'), css: cssDoArquivo(nome, readFileSync(p, 'utf8')) })
  }
  return out
}

describe('lerTokens', () => {
  const tokens = lerTokens(TOKENS)
  const por = new Map(tokens.map((t) => [t.nome, t]))

  it('lê o :root do tokens.css real, na ordem, com o valor escuro quando muda', () => {
    assert.equal(por.get('--cor-tinta')?.valor, '#11130f')
    assert.equal(por.get('--superficie')?.valor, 'var(--cor-papel-forte)')
    assert.equal(por.get('--superficie')?.escuro, '#1b202a')
    // O destaque é o mesmo amarelo nos dois temas: sem `escuro`.
    assert.equal(por.get('--destaque')?.escuro, undefined)
    assert.ok(tokens.findIndex((t) => t.nome === '--cor-tinta') < tokens.findIndex((t) => t.nome === '--fundo'))
  })

  it('a nota é o comentário colado em cima, e um "--x:" dentro de comentário não vira token', () => {
    assert.match(por.get('--divisor')?.nota ?? '', /35%/)
    const css = ':root {\n  /* fala de --falso: nada */\n  --a: 1px;\n\n  /* solta */\n\n  --b: 2px;\n  --c: 3px;\n}'
    assert.deepEqual(lerTokens(css).map((t) => [t.nome, t.nota]), [['--a', 'fala de --falso: nada'], ['--b', undefined], ['--c', undefined]])
  })

  it('agrupa pelo prefixo', () => {
    assert.deepEqual(
      ['--cor-amarelo', '--esp-3', '--tam-nome', '--peso-forte', '--linha-fina', '--toque', '--camada-folha', '--etapa-ganho', '--fonte', '--hover'].map(grupoDoToken),
      ['paleta', 'espaco', 'tamanho', 'peso', 'forma', 'toque', 'layout', 'etapas', 'fonte', 'semanticos'],
    )
  })

  it('a escala de espaço é crescente e em múltiplos de 2 px', () => {
    const esp = tokens.filter((t) => t.grupo === 'espaco').map((t) => Number.parseFloat(t.valor) * 16)
    assert.ok(esp.length >= 8)
    assert.deepEqual([...esp].sort((a, b) => a - b), esp)
    assert.ok(esp.every((px) => px % 2 === 0), esp.join(', '))
  })
})

describe('contraste', () => {
  it('segue a fórmula da WCAG 2.1', () => {
    assert.equal(contraste([0, 0, 0], [255, 255, 255]), 21)
    assert.equal(contraste([255, 255, 255], [255, 255, 255]), 1)
    assert.equal(contraste(lerRgb('#767676')!, lerRgb('#fff')!), 4.54)
  })

  it('lê hex curto, hex longo e o rgb() do getComputedStyle', () => {
    assert.deepEqual(lerRgb('#fff'), [255, 255, 255])
    assert.deepEqual(lerRgb('#11130F'), [17, 19, 15])
    assert.deepEqual(lerRgb('rgb(17, 19, 15)'), [17, 19, 15])
    assert.deepEqual(lerRgb('rgb(17 19 15 / 0.35)'), [17, 19, 15])
    assert.equal(lerRgb('var(--x)'), null)
  })

  it('classifica pelo mínimo de cada nível', () => {
    assert.deepEqual([7, 6.99, 4.5, 4.49, 3, 2.99].map(nivelWcag), ['AAA', 'AA', 'AA', 'AA grande', 'AA grande', 'falha'])
  })

  it('todo par medido é de tokens que existem', () => {
    const nomes = new Set(lerTokens(TOKENS).map((t) => t.nome))
    for (const p of PARES_DE_CONTRASTE) {
      assert.ok(nomes.has(p.texto), p.texto)
      assert.ok(nomes.has(p.fundo), p.fundo)
    }
  })
})

describe('pedidoDeMudanca', () => {
  it('sem mudança, nada para copiar', () => {
    assert.equal(pedidoDeMudanca([], 'claro'), '')
  })

  it('dá o bloco de CSS com o valor antigo ao lado e diz o tema e o porquê', () => {
    const texto = pedidoDeMudanca([{ nome: '--destaque', de: '#ffdc59', para: '#ffd23f' }], 'escuro', 'amarelo some no escuro')
    assert.match(texto, /mudar 1 token em src\/estilos\/tokens\.css/)
    assert.match(texto, /visto no tema escuro/)
    assert.match(texto, /Por quê: amarelo some no escuro/)
    assert.match(texto, /:root\[data-theme="dark"\] \{\n {2}--destaque: #ffd23f; \/\* era #ffdc59 \*\/\n\}/)
  })
})

describe('catálogo', () => {
  it('os códigos são únicos e no formato BP-XXX', () => {
    const ids = CATALOGO.map((c) => c.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(ids.every((id) => /^BP-[A-Z0-9-]+$/.test(id)), ids.join(' '))
  })
})

// Regras que mantêm o app homogêneo (16/10/2026). Uma exceção só entra aqui com o motivo.
const EXCECOES: Record<string, string> = {
  // Mapa isométrico: tamanhos em px casam com os sprites e a grade de tiles, não com o texto.
  'components/GameMap.vue': 'geometria do mapa',
}

describe('homogeneidade dos estilos', () => {
  const arquivos = estilos().filter((a) => !a.arquivo.endsWith('estilos/tokens.css'))

  it('nenhum rem/px solto em espaço, tamanho de fonte ou peso fora dos tokens', () => {
    const desvios = arquivos
      .filter((a) => !EXCECOES[a.arquivo])
      .flatMap((a) => desviosDaEscala(a.css).map((d) => `${a.arquivo}: [${d.regra}] ${d.declaracao}`))
    assert.deepEqual(desvios, [])
  })

  it('todo var(--x) usado existe em tokens.css ou no próprio arquivo', () => {
    const globais = variaveisDefinidas(TOKENS)
    // Variáveis locais de um componente (ex.: --crm-cor) valem em qualquer arquivo do mesmo módulo,
    // e as que o script põe no :style (ex.: '--escala' no GameMap) também.
    const locais = new Set(arquivos.flatMap((a) => [...variaveisDefinidas(a.css)]))
    for (const { arquivo } of arquivos.filter((a) => a.arquivo.endsWith('.vue'))) {
      for (const m of readFileSync(join(RAIZ, arquivo), 'utf8').matchAll(/['"`](--[\w-]+)['"`]\s*[\]:]/g)) locais.add(m[1])
    }
    const faltando = arquivos.flatMap((a) =>
      [...variaveisUsadas(a.css)].filter((v) => !globais.has(v) && !locais.has(v)).map((v) => `${a.arquivo}: ${v}`))
    assert.deepEqual(faltando, [])
  })

  it('o detector pega o solto e deixa passar o token', () => {
    const css = '.a { padding: 0.6rem var(--esp-2); gap: 0; margin: 0 auto; font-size: 0.9rem; font-weight: 700 } .b { margin: env(safe-area-inset-top, 0px) 0; font-size: var(--tam-mini); font-weight: var(--peso-forte); padding: 0.5em }'
    assert.deepEqual(desviosDaEscala(css).map((d) => d.regra), ['espaco', 'tamanho', 'peso'])
  })
})
