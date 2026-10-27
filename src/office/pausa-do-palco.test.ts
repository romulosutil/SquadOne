import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { useOffice } from './useOffice'
import type { OfficeDominio } from './modelo'
import type { QuadroDoAtor, RenderizadorDoEscritorio } from './renderizador'

// Exercita o loop real com relógio e porta de renderização controlados, sem navegador ou CRM.
it('painel suspende o percurso e retoma do mesmo ponto, com uma conclusão e sem outro loop', async () => {
  const originais = Object.fromEntries(['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const quadros = new Map<number, FrameRequestCallback>()
  const ouvintes = new Set<string>()
  let sequencia = 0, agora = performance.now(), concluiu = 0, destruido = 0
  let ultimo: QuadroDoAtor | undefined
  const definir = (k: string, value: unknown) => Object.defineProperty(globalThis, k, { configurable: true, writable: true, value })
  definir('document', { hidden: false, addEventListener: (k: string) => ouvintes.add(k), removeEventListener: (k: string) => ouvintes.delete(k) })
  definir('window', { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  definir('requestAnimationFrame', (fn: FrameRequestCallback) => { quadros.set(++sequencia, fn); return sequencia })
  definir('cancelAnimationFrame', (id: number) => quadros.delete(id))
  definir('fetch', async () => { throw new Error('Sem rede neste teste') })
  function avancar(ms = 50) {
    agora += ms
    const atuais = [...quadros.values()]; quadros.clear()
    atuais.forEach(fn => fn(agora))
  }
  const porta: RenderizadorDoEscritorio = {
    ligarMundo() {}, ligarAtor() {}, atualizarSprites() {}, pintarCamera() {},
    pintarAtor(q) { ultimo = q }, destruir() { destruido++ },
  }
  const renderer = createRenderer<any, any>({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const suspenso = ref(false)
  const dominios = ref<OfficeDominio[]>([{ id: 'sala', nome: 'Sala', slot: [0, 0], room: 'ROOM_EMPTY', pessoas: [{ id: 'carla', nome: 'Carla', papel: 'Atendimento', sprite: '' }] }])
  let office!: ReturnType<typeof useOffice>
  const app = renderer.createApp({ setup() {
    office = useOffice(dominios, ref(true), undefined, ref(false), () => porta, suspenso)
    office.setViewportEl({ clientWidth: 320, clientHeight: 200 })
    return () => null
  } })
  try {
    app.mount({})
    avancar()
    const posto = office.postoDaPessoa('carla')!
    assert.equal(office.percorrer('carla', [[posto[0] + 96, posto[1]]], ok => { assert.equal(ok, true); concluiu++ }), true)
    avancar()
    const posicao = ultimo!.esquerda
    suspenso.value = true
    assert.equal(office.pausado.value, true)
    assert.equal(quadros.size, 0)
    avancar(10_000)
    assert.equal(ultimo!.esquerda, posicao)
    assert.equal(concluiu, 0)
    suspenso.value = false
    assert.equal(office.pausado.value, false)
    assert.equal(quadros.size, 1)
    avancar()
    assert.ok(Math.abs(ultimo!.esquerda - posicao) <= 5, 'retoma sem recuperar dez segundos de movimento')
    for (let i = 0; i < 30; i++) avancar()
    assert.equal(concluiu, 1)
    assert.equal(quadros.size, 0)
    await nextTick()
  } finally {
    app.unmount()
    assert.equal(destruido, 1)
    assert.equal(quadros.size, 0)
    assert.equal(ouvintes.size, 0)
    for (const [k, original] of Object.entries(originais)) {
      if (original) Object.defineProperty(globalThis, k, original)
      else Reflect.deleteProperty(globalThis, k)
    }
  }
})
