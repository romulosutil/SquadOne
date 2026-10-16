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

// Versão 2 (16/10/2026): o blueprint ficou de uso. Cada passo diz em que etapa comum da venda está (para a
// vista "Lado a lado" alinhar Site, PRUMO e Ofertas), as telas da Central viram inventário com veredito e as
// otimizações (OT-n) apontam para cartões e telas que existem. A decisão sobre cada OT mora no banco do
// Artifact, não aqui: este arquivo é só a proposta.
interface Otimizacao { id: string; tipo: string; titulo: string; porque: string; proposta: string; impacto: string; esforco: string; cartoes?: string[]; telas?: string[] }
interface Tela { id: string; nome: string; rota: string; veredito: string; cartoes?: string[]; otimizacoes?: string[] }

describe('service blueprint de uso (v2)', () => {
  const blueprints: Blueprint[] = mapa.blueprints
  const cartoes = new Set(blueprints.flatMap((b) => b.cartoes.map((c) => c.id)))
  const etapas = new Set<string>(mapa.etapas.map((e: { id: string }) => e.id))
  const tipos = new Set<string>(Object.keys(mapa.tiposDeOtimizacao))
  const otimizacoes: Otimizacao[] = mapa.otimizacoes
  const telas: Tela[] = mapa.telas
  const idsDeTela = new Set(telas.map((t) => t.id))
  const idsDeOt = new Set(otimizacoes.map((o) => o.id))

  it('todo passo das jornadas de venda cai numa etapa comum que existe', () => {
    for (const b of blueprints.filter((b) => b.id !== 'AGENDA')) {
      for (const p of b.passos as Array<{ id: string; etapa?: string }>) assert.ok(p.etapa && etapas.has(p.etapa), `${p.id}: etapa ${p.etapa}`)
    }
  })

  it('otimização é OT-<n> em sequência, com tipo, impacto e esforço conhecidos', () => {
    assert.deepEqual(otimizacoes.map((o) => o.id), otimizacoes.map((_, i) => `OT-${String(i + 1).padStart(2, '0')}`))
    for (const o of otimizacoes) {
      assert.ok(tipos.has(o.tipo), `${o.id}: tipo ${o.tipo}`)
      assert.ok(['alto', 'médio', 'baixo'].includes(o.impacto), `${o.id}: impacto ${o.impacto}`)
      assert.ok(['pequeno', 'médio', 'grande'].includes(o.esforco), `${o.id}: esforço ${o.esforco}`)
      assert.ok(o.titulo.trim() && o.porque.trim() && o.proposta.trim(), `${o.id}: texto`)
      assert.ok((o.cartoes?.length ?? 0) + (o.telas?.length ?? 0) > 0, `${o.id}: aponta para nada`)
      for (const c of o.cartoes ?? []) assert.ok(cartoes.has(c), `${o.id}: cartão ${c}`)
      for (const t of o.telas ?? []) assert.ok(idsDeTela.has(t), `${o.id}: tela ${t}`)
    }
  })

  it('tela é TELA-<n>, com veredito, e o que ela cita existe', () => {
    assert.deepEqual(telas.map((t) => t.id), telas.map((_, i) => `TELA-${String(i + 1).padStart(2, '0')}`))
    for (const t of telas) {
      assert.ok(['manter', 'fundir', 'cortar', 'renomear', 'mover'].includes(t.veredito), `${t.id}: veredito ${t.veredito}`)
      for (const c of t.cartoes ?? []) assert.ok(cartoes.has(c), `${t.id}: cartão ${c}`)
      for (const o of t.otimizacoes ?? []) assert.ok(idsDeOt.has(o), `${t.id}: otimização ${o}`)
    }
  })

  it('números do funil têm data e fonte e caem em etapas que existem', () => {
    assert.ok(mapa.numeros?.retrato && mapa.numeros?.fonte)
    for (const [etapa, degraus] of Object.entries(mapa.numeros.etapas as Record<string, Array<{ n: number; rotulo: string }>>)) {
      assert.ok(etapas.has(etapa), `números: etapa ${etapa}`)
      for (const d of degraus) assert.ok(Number.isInteger(d.n) && d.rotulo, `números de ${etapa}`)
    }
  })
})
