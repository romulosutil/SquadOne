import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  contraste, corDoToken, corpoDoBloco, cssDoArquivo, desviosDaEscala, grupoDoToken, lerRgb, lerTokens, nivelWcag, pedidoDeMudanca,
  PARES_DE_CONTRASTE, SELETOR_ESCURO, SELETOR_ESCURO_DO_SISTEMA, valoresDoTema, variaveisDefinidas, variaveisUsadas, type Desvio,
} from './tokens'
import { CATALOGO, PRINCIPIOS, REGRAS_DE_COMPOSICAO } from './catalogo'

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
      ['--cor-amarelo', '--esp-3', '--tam-nome', '--peso-forte', '--linha-fina', '--toque', '--camada-folha', '--etapa-ganho', '--fonte', '--hover', '--respiro-bloco', '--raio-bloco', '--realce'].map(grupoDoToken),
      ['paleta', 'espaco', 'tamanho', 'peso', 'forma', 'toque', 'layout', 'etapas', 'fonte', 'semanticos', 'respiro', 'forma', 'semanticos'],
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
  it('as combinações reais das etiquetas de operação passam nos dois temas', () => {
    const css = readFileSync(join(RAIZ, 'estilos', 'operacao.css'), 'utf8')
    for (const tom of ['ok', 'atencao', 'erro']) {
      const regra = css.match(new RegExp(`\\.etiqueta\\[data-tom="${tom}"\\]\\s*\\{([^}]+)\\}`))?.[1]
      assert.ok(regra, tom)
      const texto = regra.match(/(?:^|;)\s*color:\s*var\((--[\w-]+)\)/)?.[1]
      const fundo = regra.match(/background:\s*var\((--[\w-]+)\)/)?.[1]
      assert.ok(texto && fundo, tom)
      for (const tema of ['claro', 'escuro'] as const) {
        const valores = valoresDoTema(TOKENS, tema)
        const razao = contraste(corDoToken(valores, texto)!, corDoToken(valores, fundo)!)
        assert.ok(razao >= 4.5, `${tom} em ${tema}: ${razao}`)
      }
    }
  })
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

  // Até 17/10/2026 o contraste só era medido ao vivo no /design-system, e o vinho do erro no escuro
  // passou sem ninguém olhar. Agora cada par é calculado aqui, nos dois temas, do tokens.css cru.
  for (const tema of ['claro', 'escuro'] as const) {
    it(`todo par passa do mínimo no tema ${tema} (calculado do tokens.css)`, () => {
      const valores = valoresDoTema(TOKENS, tema)
      const abaixo = PARES_DE_CONTRASTE.flatMap((p) => {
        const a = corDoToken(valores, p.texto)
        const b = corDoToken(valores, p.fundo)
        assert.ok(a && b, `${p.texto} sobre ${p.fundo}: cor não resolvida no tema ${tema}`)
        const razao = contraste(a, b)
        return razao >= p.minimo ? [] : [`${p.texto} sobre ${p.fundo}: ${razao} < ${p.minimo} (${p.uso})`]
      })
      assert.deepEqual(abaixo, [])
    })
  }

  it('o texto de erro sobre o fundo de erro é par medido nos dois temas', () => {
    assert.ok(PARES_DE_CONTRASTE.some((p) => p.texto === '--negativo' && p.fundo === '--erro-fundo'))
  })

  it('resolve var() em cadeia e o escuro sobrepõe o claro', () => {
    const css = ':root { --cor-x: #102030; --a: var(--cor-x); --b: color-mix(in srgb, red 50%, blue); }\n:root[data-theme="dark"] { --cor-x: #ffffff; }'
    assert.deepEqual(corDoToken(valoresDoTema(css, 'claro'), '--a'), [16, 32, 48])
    assert.deepEqual(corDoToken(valoresDoTema(css, 'escuro'), '--a'), [255, 255, 255])
    assert.equal(corDoToken(valoresDoTema(css, 'claro'), '--b'), null)
    assert.equal(corDoToken(valoresDoTema(css, 'claro'), '--nao-existe'), null)
  })

  it('o escuro do sistema (media query) e o escuro forçado têm os mesmos tokens', () => {
    const corpo = (sel: string) => [...corpoDoBloco(TOKENS, sel).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .map((m) => `${m[1]}: ${m[2].replace(/\s+/g, ' ').trim()}`)
    const forcado = corpo(SELETOR_ESCURO)
    assert.ok(forcado.length > 10)
    assert.deepEqual(corpo(SELETOR_ESCURO_DO_SISTEMA), forcado)
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
  it('os códigos (peças, princípios e regras) são únicos e no formato BP-XXX', () => {
    const ids = [...CATALOGO, ...PRINCIPIOS, ...REGRAS_DE_COMPOSICAO].map((c) => c.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(ids.every((id) => /^BP-[A-Z0-9-]+$/.test(id)), ids.join(' '))
  })
})

// Regras que mantêm o app homogêneo (16/10/2026). Uma exceção só entra aqui com o motivo.
const EXCECOES: Record<string, string> = {
  // Mapa isométrico: tamanhos em px casam com os sprites e a grade de tiles, não com o texto.
  'components/GameMap.vue': 'geometria do mapa',
}
// Exceção de uma regra só, num arquivo, também com o motivo.
const EXCECOES_DE_REGRA: Record<string, Partial<Record<Desvio['regra'], string>>> = {
  // Aviso do runtime: aparece antes (ou no lugar) da casca, com cores fixas de propósito.
  'RootApp.vue': { sombra: 'aviso do runtime fora da casca' },
  // "Como funciona": a sombra coral marca o passo em destaque do fluxo. Sai quando Mais
  // passar pela regra de 16/10/2026 (um primário por tela).
  'operations/mais.css': { sombra: 'passo em destaque do Como funciona' },
}

describe('homogeneidade dos estilos', () => {
  const arquivos = estilos().filter((a) => !a.arquivo.endsWith('estilos/tokens.css'))

  it('nenhum rem/px solto em espaço, tamanho de fonte, peso, raio ou sombra fora dos tokens', () => {
    const desvios = arquivos
      .filter((a) => !EXCECOES[a.arquivo])
      .flatMap((a) => desviosDaEscala(a.css)
        .filter((d) => !EXCECOES_DE_REGRA[a.arquivo]?.[d.regra])
        .map((d) => `${a.arquivo}: [${d.regra}] ${d.declaracao}`))
    assert.deepEqual(desvios, [])
  })

  it('o detector de raio e sombra deixa passar token, %, inset e none', () => {
    const css = '.a { border-radius: 8px; box-shadow: 3px 3px 0 #000 } .b { border-radius: var(--raio-bloco); border-top-left-radius: 50%; box-shadow: var(--sombra) } '
      + '.c { box-shadow: inset var(--faixa) 0 0 var(--acento), none; border-radius: 0 } .d { border-bottom-right-radius: 0.5rem; box-shadow: var(--sombra), 0 0 0 2px red }'
    assert.deepEqual(desviosDaEscala(css).map((d) => d.regra), ['raio', 'raio', 'sombra', 'sombra'])
  })

  it('a sombra dura deslocada só existe nos dois tokens, e o raio nos quatro', () => {
    const tokens = lerTokens(TOKENS)
    assert.deepEqual(tokens.filter((t) => t.nome.startsWith('--sombra')).map((t) => t.nome), ['--sombra', '--sombra-pequena'])
    assert.deepEqual(tokens.filter((t) => t.nome.startsWith('--raio')).map((t) => t.nome), ['--raio-bloco', '--raio-controle', '--raio-selo', '--raio-pilula'])
    // Por dentro menor que por fora: o canto do controle acompanha o do bloco.
    const px = (n: string) => Number.parseFloat(tokens.find((t) => t.nome === n)!.valor)
    assert.ok(px('--raio-bloco') > px('--raio-controle') && px('--raio-controle') > px('--raio-selo'))
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
