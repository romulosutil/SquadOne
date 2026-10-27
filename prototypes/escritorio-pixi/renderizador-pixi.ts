import { Application, Assets, ColorMatrixFilter, Rectangle, Sprite, Texture } from 'pixi.js'
import type { QuadroDoAtor, RenderizadorDoEscritorio } from '../../src/office/renderizador'
import { criarRenderizadorDom } from '../../src/office/renderizador-dom'
import { CENA_ILUSTRADA } from '../../src/office/configuracao'

export interface OpcoesPixi { pronto(texto: string): void; congelado(): boolean; movimento(): boolean }

/** Spike híbrido: Pixi desenha os corpos; cenário, sombras, texto e botões acessíveis são os mesmos do DOM. */
export function criarRenderizadorPixi(opcoes: OpcoesPixi): RenderizadorDoEscritorio {
  const dom = criarRenderizadorDom()
  const quadros = new Map<string, QuadroDoAtor>()
  const nos = new Map<string, HTMLElement>()
  const sprites = new Map<string, Sprite>()
  const cores = new Map<string, number>()
  const filtros = new Map<string, ColorMatrixFilter>()
  const texturas = new Map<string, Texture[]>()
  const pendentes = new Set<string>()
  const app = new Application()
  let mundo: HTMLElement | null = null
  let iniciado = false, pronto = false, destruido = false, falhou = false
  let origemIdle = 0

  function liberar() {
    for (const frames of texturas.values()) for (const texture of frames) texture.destroy(false)
    for (const filtro of filtros.values()) filtro.destroy()
    texturas.clear(); sprites.clear(); cores.clear(); filtros.clear()
    // As sete URLs dos assets ficam no cache durante a comparação. Fontes não são destruídas
    // por instância: uma troca DOM/Pixi pode estar carregando as mesmas imagens em paralelo.
    app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true, texture: false, textureSource: false })
  }
  function fallback(erro: unknown) {
    falhou = true
    for (const no of nos.values()) no.removeAttribute('data-pixi')
    if (app.renderer) app.canvas.style.visibility = 'hidden'
    opcoes.pronto(`DOM de reserva: ${erro instanceof Error ? erro.message : String(erro)}`)
  }
  async function iniciar() {
    if (iniciado || !mundo || destruido) return
    iniciado = true
    try {
      await app.init({ width: CENA_ILUSTRADA.largura, height: CENA_ILUSTRADA.altura,
        autoStart: false, sharedTicker: false, backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1, antialias: false, preference: 'webgl' })
      if (destruido) { liberar(); return }
      app.stage.sortableChildren = true
      app.canvas.className = 'pixi-corpos'
      app.canvas.setAttribute('aria-hidden', 'true')
      Object.assign(app.canvas.style, { position: 'absolute', pointerEvents: 'none',
        left: `${CENA_ILUSTRADA.esquerda}px`, top: `${CENA_ILUSTRADA.topo}px`,
        width: `${CENA_ILUSTRADA.largura}px`, height: `${CENA_ILUSTRADA.altura}px`, zIndex: '50' })
      mundo!.querySelector('.objects')!.appendChild(app.canvas)
      pronto = true
      opcoes.pronto(`PixiJS 8 · ${app.renderer.name} · corpos no canvas, controles no DOM`)
      for (const q of quadros.values()) preparar(q)
    } catch (erro) { if (!destruido) fallback(erro) }
  }
  function preparar(q: QuadroDoAtor) {
    if (!pronto || falhou || !q.sheet) return
    for (const anim of Object.values(q.sheet.anims)) {
      const chave = `${anim.file}:${q.largura}:${q.altura}:${anim.frames}`
      if (texturas.has(chave) || pendentes.has(chave)) continue
      pendentes.add(chave)
      void Assets.load<Texture>(anim.file).then(sheet => {
        if (destruido || falhou) return
        // Os personagens atuais usam amostragem linear; o cenário mantém seu pixelated original.
        const frames = Array.from({ length: anim.frames }, (_, i) => new Texture({ source: sheet.source,
          frame: new Rectangle(i * q.largura, 0, q.largura, q.altura) }))
        texturas.set(chave, frames)
        desenhar(performance.now())
      }).catch(erro => { if (!destruido) fallback(erro) }).finally(() => pendentes.delete(chave))
    }
  }
  function desenhar(agora: number) {
    if (!pronto || destruido || falhou) return
    if (!origemIdle) origemIdle = agora
    for (const [id, q] of quadros) {
      const anim = q.sheet?.anims[q.andando ? 'walk' : 'idle']
      const frames = anim && texturas.get(`${anim.file}:${q.largura}:${q.altura}:${anim.frames}`)
      if (!frames) continue
      let sprite = sprites.get(id)
      if (!sprite) { sprite = new Sprite(frames[0]); app.stage.addChild(sprite); sprites.set(id, sprite) }
      if (cores.get(id) !== q.hue) {
        filtros.get(id)?.destroy(); filtros.delete(id)
        const filtro = new ColorMatrixFilter(); filtro.hue(q.hue, false)
        sprite.filters = q.hue ? [filtro] : []
        if (q.hue) filtros.set(id, filtro); else filtro.destroy()
        cores.set(id, q.hue)
      }
      const coluna = q.andando ? q.coluna : opcoes.congelado() || !opcoes.movimento() ? 0 : Math.floor((agora - origemIdle) / 1400 * frames.length) % frames.length
      sprite.texture = frames[coluna]
      sprite.position.set(q.esquerda - CENA_ILUSTRADA.esquerda + (q.espelhado ? q.largura : 0), q.topo - CENA_ILUSTRADA.topo)
      sprite.scale.x = q.espelhado ? -1 : 1
      sprite.zIndex = nos.get(id)?.matches(':hover,:focus-within') ? 100001 : q.profundidade
      sprite.visible = !q.oculto
      nos.get(id)?.setAttribute('data-pixi', 'true')
    }
    app.render()
  }
  return {
    get continuo() { return !destruido && !falhou && !opcoes.congelado() && opcoes.movimento() },
    ligarMundo(el) { mundo = el; dom.ligarMundo(el); void iniciar() },
    ligarAtor(id, el) {
      dom.ligarAtor(id, el)
      if (el) nos.set(id, el)
      else {
        nos.delete(id); quadros.delete(id)
        sprites.get(id)?.destroy(); sprites.delete(id); cores.delete(id)
        filtros.get(id)?.destroy(); filtros.delete(id)
      }
    },
    atualizarSprites() { dom.atualizarSprites() },
    pintarAtor(q) { dom.pintarAtor(q); quadros.set(q.id, q); preparar(q) },
    pintarCamera(q) { dom.pintarCamera(q) },
    terminarQuadro: desenhar,
    destruir() {
      destruido = true
      for (const no of nos.values()) no.removeAttribute('data-pixi')
      dom.destruir(); nos.clear(); quadros.clear()
      if (pronto) liberar()
    },
  }
}
