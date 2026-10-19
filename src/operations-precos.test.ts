import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CARDAPIO, PRECOS_DO_CARDAPIO } from './operations/colinha.ts'

// PRUMO-16 (auditoria dos fluxos, 19/10/2026): deploy/dell/prumo-mapa/precos.json se diz a fonte única
// dos preços (o Raio-X, o Mapa e o pitch leem dele), mas o Roteiro (colinha.ts) tem os seus R$ à mão. Este
// teste lê o arquivo e falha se os dois divergirem: mudou o preço de um lado, o outro precisa mudar.

const RAIZ = join(import.meta.dirname, '..')
interface Tabela {
  _como_usar: string
  servicos: Array<{ preco?: string; mensal?: string }>
  fonte: { preco?: string; opcoes: Array<{ preco?: string }> }
}
const tabela = JSON.parse(readFileSync(join(RAIZ, 'deploy', 'dell', 'prumo-mapa', 'precos.json'), 'utf8')) as Tabela

/** Todo "R$ 1.500" de um texto, no formato do arquivo. */
const valoresEm = (texto: string | undefined) => (texto ?? '').match(/R\$ ?\d[\d.]*/g)?.map((v) => v.replace(/\.$/, '').replace(/^R\$ ?/, 'R$ ')) ?? []

describe('os preços do Roteiro são os de precos.json', () => {
  // Os campos de preço do arquivo, mais a manutenção opcional, que só a nota dele cita.
  const doArquivo = new Set([
    ...tabela.servicos.flatMap((s) => [...valoresEm(s.preco), ...valoresEm(s.mensal)]),
    ...valoresEm(tabela.fonte.preco),
    ...tabela.fonte.opcoes.flatMap((o) => valoresEm(o.preco)),
    ...valoresEm(/Manutenção opcional de (R\$ ?[\d.]+)/.exec(tabela._como_usar)?.[1]),
  ])

  it('a lista de PRECOS_DO_CARDAPIO é exatamente o conjunto do arquivo', () => {
    assert.ok(doArquivo.size >= 8, `só ${doArquivo.size} preços lidos do arquivo`)
    assert.deepEqual([...PRECOS_DO_CARDAPIO].sort(), [...doArquivo].sort())
  })

  it('todo R$ escrito no cardápio do Roteiro existe no arquivo', () => {
    const escritos = CARDAPIO.flatMap((s) => [s.preco, s.mensal, s.condicao].flatMap((t) => valoresEm(t)))
    assert.ok(escritos.length >= 8)
    assert.deepEqual(escritos.filter((v) => !doArquivo.has(v)), [])
  })
})
