import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// O service blueprint (docs/blueprint/servico.json, 16/10/2026) é lido por pessoas e por agentes:
// um código quebrado ou um arquivo que mudou de lugar faria o agente procurar o que não existe.
// Este teste é o contrato do formato; a página (docs/blueprint/servico.html) confia nele.

const RAIZ = join(import.meta.dirname, '..', '..')
const mapa = JSON.parse(readFileSync(join(RAIZ, 'docs', 'blueprint', 'servico.json'), 'utf8'))
const FAIXAS = new Set<string>(mapa.faixas.map((f: { id: string }) => f.id))
const QUEM = new Set(['cliente', 'você', 'robô', 'terceiro'])
const MARCAS = ['metrica', 'opcao', 'seguranca', 'dor', 'melhorias'] as const

interface Cartao { id: string; passo: string; faixa: string; nome: string; quem: string; resumo: string; arquivos?: string[]; momento?: boolean; [k: string]: unknown }
interface Blueprint { id: string; nome: string; passos: Array<{ id: string; nome: string; tempo?: string }>; cartoes: Cartao[]; ligacoes: Array<[string, string]> }

describe('service blueprint', () => {
  const blueprints: Blueprint[] = mapa.blueprints

  it('tem as cinco faixas e as três linhas da NN/g, na ordem', () => {
    assert.deepEqual([...FAIXAS], ['E', 'C', 'P', 'B', 'A'])
    assert.deepEqual(mapa.linhas.map((l: { depois: string }) => l.depois), ['C', 'P', 'B'])
  })

  it('códigos únicos em todo o arquivo', () => {
    const ids = [
      ...blueprints.map((b) => b.id),
      ...blueprints.flatMap((b) => b.passos.map((p) => p.id)),
      ...blueprints.flatMap((b) => b.cartoes.map((c) => c.id)),
    ]
    const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i)
    assert.deepEqual(repetidos, [])
  })

  for (const b of blueprints) {
    describe(b.id, () => {
      const passos = new Set(b.passos.map((p) => p.id))
      const cartoes = new Map(b.cartoes.map((c) => [c.id, c]))

      it('passo é <BLUEPRINT>-<n> em sequência', () => {
        assert.deepEqual(b.passos.map((p) => p.id), b.passos.map((_, i) => `${b.id}-${i + 1}`))
      })

      it('cartão é <passo>-<faixa><n>, num passo e numa faixa que existem', () => {
        for (const c of b.cartoes) {
          assert.ok(passos.has(c.passo), `${c.id}: passo ${c.passo}`)
          assert.ok(FAIXAS.has(c.faixa), `${c.id}: faixa ${c.faixa}`)
          assert.match(c.id, new RegExp(`^${c.passo}-${c.faixa}\\d+$`), c.id)
          assert.ok(QUEM.has(c.quem), `${c.id}: quem ${c.quem}`)
          assert.ok(c.nome.trim() && c.resumo.trim(), `${c.id}: nome e resumo`)
          for (const m of MARCAS) if (c[m] !== undefined) assert.ok(Array.isArray(c[m]) && (c[m] as unknown[]).length, `${c.id}: ${m} vazia`)
        }
      })

      it('todo passo tem a ação do cliente', () => {
        const comCliente = new Set(b.cartoes.filter((c) => c.faixa === 'C').map((c) => c.passo))
        assert.deepEqual(b.passos.map((p) => p.id).filter((p) => !comCliente.has(p)), [])
      })

      it('ligações apontam para cartões deste blueprint', () => {
        for (const [de, para] of b.ligacoes) {
          assert.ok(cartoes.has(de), `${de} não existe`)
          assert.ok(cartoes.has(para), `${para} não existe`)
          assert.notEqual(de, para)
        }
      })

      it('todo arquivo citado existe no repositório', () => {
        const faltando = b.cartoes.flatMap((c) => (c.arquivos ?? []).filter((a) => !existsSync(join(RAIZ, a))).map((a) => `${c.id}: ${a}`))
        assert.deepEqual(faltando, [])
      })
    })
  }
})
