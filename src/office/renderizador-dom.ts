import type { QuadroDoAtor, RenderizadorDoEscritorio } from './renderizador'

/** Único dono das escritas de transform/classes por frame. Hit areas e rótulos continuam no Vue. */
export function criarRenderizadorDom(): RenderizadorDoEscritorio {
  let mundo: HTMLElement | null = null
  const elementos = new Map<string, { root: HTMLElement; sprite: HTMLElement | null; walk: HTMLElement | null }>()
  function registrar(id: string, root: HTMLElement) {
    elementos.set(id, { root, sprite: root.querySelector('[data-billboard]'), walk: root.querySelector('[data-walk]') })
  }
  return {
    ligarMundo(el) { mundo = el },
    ligarAtor(id, el) { if (el) registrar(id, el); else elementos.delete(id) },
    atualizarSprites() { for (const [id, { root }] of elementos) registrar(id, root) },
    pintarAtor(q: QuadroDoAtor) {
      const entry = elementos.get(q.id)
      if (!entry) return
      entry.root.style.transform = `translate3d(${q.esquerda}px, ${q.topo}px, 0)`
      entry.root.style.zIndex = String(q.profundidade)
      entry.root.classList.toggle('actor--walk', q.andando)
      entry.root.classList.toggle('actor--focus', q.foco)
      entry.root.style.visibility = q.oculto ? 'hidden' : ''
      if (entry.sprite) entry.sprite.style.transform = q.espelhado ? 'scaleX(-1)' : ''
      if (entry.walk && q.sheet && q.andando) entry.walk.style.backgroundPositionX = -q.coluna * q.largura + 'px'
    },
    pintarCamera(q) {
      if (mundo) mundo.style.transform = `translate3d(${-Math.round(q.x * q.escala)}px, ${-Math.round(q.y * q.escala)}px, 0) scale(${q.escala})`
    },
    destruir() { mundo = null; elementos.clear() },
  }
}
