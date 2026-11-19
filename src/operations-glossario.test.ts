/**
 * Um nome por coisa (AC-13, 17/10/2026): o glossário (src/operations/glossario.ts) diz o nome certo
 * e os que não podem voltar; aqui ele é aplicado a todo .vue e .ts de src/, lidos crus, como o teste
 * de homogeneidade do design system (src/blueprint/blueprint.test.ts). Comentários, identificadores
 * e chaves ficam de fora: só o texto que chega à tela.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { GLOSSARIO, literaisDoCodigo, nomesProibidos, textosDoTemplate, textosVisiveis } from './operations/glossario.ts'

const RAIZ = import.meta.dirname

function fontes(dir = RAIZ, out: Array<{ arquivo: string; conteudo: string }> = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) fontes(p, out)
    // Os testes montam casos com os nomes antigos de propósito; o glossário é a lista deles.
    else if (/\.(vue|ts)$/.test(nome) && !/\.(test|d)\.ts$/.test(nome) && nome !== 'glossario.ts') {
      out.push({ arquivo: relative(RAIZ, p).replaceAll('\\', '/'), conteudo: readFileSync(p, 'utf8') })
    }
  }
  return out
}

describe('glossário: o que conta como texto visível', () => {
  it('literais do código: aspas, template e o que está dentro do ${}, sem comentário nem regex', () => {
    const fonte = [
      "// Colinha no comentário não conta",
      "/* nem 'Ler de novo' aqui */",
      "const a = 'Atualizar' + \"o CRM\"",
      'const b = `Leu ${dia ? `em ${dia}` : \'hoje\'} e respondeu`',
      "const c = /'Fechou'/.test(x) ? 'ok' : 'não'",
      "const d = 'it\\'s'",
    ].join('\n')
    assert.deepEqual(literaisDoCodigo(fonte), ['Atualizar', 'o CRM', 'Leu ', 'em ', '', 'hoje', ' e respondeu', 'ok', 'não', "it's"])
  })

  it('template: texto, mustache, atributo que se lê e atributo ligado; classe, href e comentário ficam fora', () => {
    const t = '<!-- Colinha antiga --><p class="crm-colinha__dica" title="Dica do Roteiro">Olá {{ x ? \'Lendo…\' : \'Atualizar\' }}</p>'
      + '<button :aria-label="`Abrir ${nome}`" @click="emit(\'colinha\')" href="/crm?ver=colinha" v-if="a > b">Ir</button>'
    assert.deepEqual(textosDoTemplate(t), ['Dica do Roteiro', 'Olá ', 'Lendo…', 'Atualizar', 'Abrir ', 'Ir'])
  })

  it('num .vue, o script entra pelos literais que parecem texto (com espaço ou maiúscula)', () => {
    const vue = "<script setup lang=\"ts\">\nimport x from './colinha'\nconst t = 'Ler de novo'\nconst k = 'segunda_enviada'\n</script>\n\n<template>\n  <p>{{ t }}</p>\n</template>\n"
    assert.deepEqual(textosVisiveis('X.vue', vue).map((s) => s.trim()).filter(Boolean), ['Ler de novo'])
  })
})

describe('glossário: os nomes proibidos e as exceções que são outra coisa', () => {
  const casos: Array<[string, string, string[]]> = [
    ['Vendas, não CRM', 'CRM indisponível.', ['CRM']],
    ['a aba CRM da planilha é outra coisa', 'vão para a aba CRM pelo n8n', []],
    ['o fluxo 08 · CRM do n8n é outra coisa', 'no próximo ciclo do 08 · CRM', []],
    ['o produto CRM de estamparia e o CRM da Silmer', 'O CRM de estamparia é o CRM da Silmer adaptado', []],
    ['Ganho, não Fechou', 'Fechou (marcado na Central)', ['Fechou']],
    ['Ganharam, não fecharam', '1 recusou · 0 fecharam', ['0 fecharam']],
    ['na mensagem ao lead, o verbo é dele', 'quem chamou e quem fechou', []],
    ['a mensagem ao cliente pode dizer "Fechado"', 'Fechado, obrigado pela confiança!', []],
    ['Roteiro, não colinha', 'O texto base da colinha', ['colinha']],
    ['o arquivo colinha.ts e o endereço antigo não são nome de tela', 'em src/operations/colinha.ts, ?ver=colinha, crm-colinha__dica', []],
    ['2ª mensagem', 'Receberam o próximo passo', ['Receberam o próximo passo']],
    ['Leu, não Viu', 'Viu 02/10', ['Viu']],
    ['três recargas, um nome', 'Ler de novo · Atualizar agora', ['Ler de novo', 'Atualizar agora']],
    ['Escritório', 'Agentes do SquadOne', ['Agentes do SquadOne']],
    ['a aba é Conversas para você, não A fazer', 'Vendas › A fazer', ['A fazer']],
    ['Triagem e Números são seções, não caminhos de aba', 'em Vendas › Triagem e Vendas › Números', ['Vendas › Triagem', 'Vendas › Números']],
    ['a sigla da oferta', 'Estampa · Estamparia', ['Estampa']],
    ['a home do Dell é a Central de comando', 'Abrir o Centro de comando · Central de Comando', ['Centro de comando', 'Central de Comando']],
  ]
  for (const [nome, texto, esperado] of casos) it(nome, () => assert.deepEqual(nomesProibidos(texto).map((a) => a.achado), esperado))

  it('cada nome do glossário tem nota e pelo menos um proibido', () => {
    for (const g of GLOSSARIO) assert.ok(g.certo && g.nota && g.proibidos.length, g.certo)
  })
})

describe('glossário: nenhum nome proibido no texto visível de src/', () => {
  const arquivos = fontes()

  it('a varredura acha os arquivos de tela', () => {
    for (const a of ['operations/CrmPanel.vue', 'operations/fluxos.ts', 'operations/jornada.ts', 'rotas/HojeRota.vue']) {
      assert.ok(arquivos.some((f) => f.arquivo === a), a)
    }
  })

  it('e lê o texto deles (uma varredura que não lê nada passaria sempre)', () => {
    const de = (a: string) => textosVisiveis(a, arquivos.find((f) => f.arquivo === a)!.conteudo).map((s) => s.trim())
    assert.ok(de('operations/CrmPanel.vue').includes('Atualização automática'))
    assert.ok(de('operations/fluxos.ts').includes('Vendas'))
    assert.ok(de('rotas/HojeRota.vue').some((s) => s.startsWith('Ver o escritório')))
  })

  it('um nome por coisa', () => {
    const erros: string[] = []
    for (const { arquivo, conteudo } of arquivos) {
      for (const texto of textosVisiveis(arquivo, conteudo)) {
        for (const a of nomesProibidos(texto)) erros.push(`${arquivo}: "${a.achado}" (use ${a.certo}) em "…${a.trecho}…"`)
      }
    }
    assert.deepEqual(erros, [])
  })
})
