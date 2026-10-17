import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BLUEPRINT_URL, FLUXOS, linkDoBlueprint } from './operations/fluxos.ts'
import { PASSOS } from './operations/jornada.ts'

// Um mapa da operação, não três (OT-03, 16/10/2026). Como funciona (fluxos.ts), a jornada do lead
// (jornada.ts) e o service blueprint (docs/blueprint/servico.json) descreviam a mesma esteira à mão
// e divergiram. Os dois primeiros agora citam o código do blueprint; se um código sumir ou mudar
// lá, a tela linkaria o nada e o agente procuraria um cartão que não existe. Este teste trava isso.

const RAIZ = join(import.meta.dirname, '..')
const mapa = JSON.parse(readFileSync(join(RAIZ, 'docs', 'blueprint', 'servico.json'), 'utf8')) as {
  blueprints: Array<{ id: string; passos: Array<{ id: string }>; cartoes: Array<{ id: string }> }>
}
const PASSOS_DO_BLUEPRINT = new Set(mapa.blueprints.flatMap((b) => b.passos.map((p) => p.id)))
const CARTOES = new Set(mapa.blueprints.flatMap((b) => b.cartoes.map((c) => c.id)))

describe('um mapa só: os códigos do blueprint citados existem', () => {
  it('Como funciona cita só cartões (ou passos) do servico.json', () => {
    const citados = FLUXOS.flatMap((f) => f.passos.flatMap((p, i) => (p.blueprint ? [{ onde: `${f.id}[${i}] ${p.titulo}`, codigo: p.blueprint }] : [])))
    assert.ok(citados.length >= 20, `só ${citados.length} passos ligados ao blueprint`)
    const quebrados = citados.filter((c) => !CARTOES.has(c.codigo) && !PASSOS_DO_BLUEPRINT.has(c.codigo))
    assert.deepEqual(quebrados, [])
  })

  it('cada passo da jornada aponta para o blueprint, com códigos que existem', () => {
    for (const p of PASSOS) {
      assert.ok(p.blueprint?.length, `${p.id} sem código do blueprint`)
      for (const c of p.blueprint) {
        assert.ok(PASSOS_DO_BLUEPRINT.has(c) || CARTOES.has(c), `${p.id}: ${c} não existe no servico.json`)
      }
    }
  })

  it('os caçadores, o observador e a jornada citam os cartões que a OT-03 apontou como divergentes', () => {
    const codigos = new Set(FLUXOS.flatMap((f) => f.passos.map((p) => p.blueprint)))
    for (const c of ['SITE-1-B1', 'OFERTAS-1-B1', 'OFERTAS-4-B1']) assert.ok(codigos.has(c), `nenhum passo cita ${c}`)
  })

  it('o link leva ao cartão no Artifact publicado', () => {
    assert.equal(linkDoBlueprint('SITE-1-B1'), `${BLUEPRINT_URL}#SITE-1-B1`)
    assert.match(BLUEPRINT_URL, /^https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+$/)
  })
})

describe('um mapa só: o que o blueprint diz não se contradiz em Como funciona', () => {
  const texto = (id: string) => FLUXOS.find((f) => f.id === id)!.passos.map((p) => `${p.titulo} ${p.texto} ${p.quando} ${p.trabalhador?.onde ?? ''}`).join(' ')

  it('os caçadores de Iris e estamparias estão ligados desde 16/10/2026', () => {
    for (const id of ['iris', 'estampa']) {
      assert.doesNotMatch(texto(id), /nasceu desligado\)|à mão; 9h quando ligado/, id)
      assert.match(texto(id), /ligado em 16\/10\/2026/, id)
    }
  })

  it('o observador lê Clínicas e Estamparias; a revisão é na Triagem, não na Hoje', () => {
    const tudo = FLUXOS.map((f) => texto(f.id)).join(' ')
    assert.doesNotMatch(tudo, /ainda não lê a aba Clínicas/)
    assert.doesNotMatch(tudo, /Hoje › Prospects para revisar/)
    assert.doesNotMatch(tudo, /Hoje › Primeiro contato/)
  })

  it('lembrete e falha do Dell vão pelo Telegram', () => {
    assert.match(texto('agenda'), /Lembrete no Telegram/)
    assert.doesNotMatch(texto('agenda'), /Lembrete no WhatsApp/)
    assert.match(texto('alertas'), /Aviso no Telegram/)
  })
})
