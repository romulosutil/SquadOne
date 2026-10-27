import type { Actor, CharSheet } from './modelo'
import { STEP_PX } from './configuracao'
import { TILE, toScreen } from './rooms'
import { depth } from './geometria-da-cena'

/** Quadro já projetado: nenhum renderizador decide caminho, trabalho ou conclusão. */
export interface QuadroDoAtor {
  id: string
  esquerda: number
  topo: number
  largura: number
  altura: number
  profundidade: number
  espelhado: boolean
  andando: boolean
  foco: boolean
  oculto: boolean
  coluna: number
  hue: number
  sheet: CharSheet | null
}
export interface QuadroDaCamera { x: number; y: number; escala: number }

export interface RenderizadorDoEscritorio {
  /** Só renderizadores que precisam desenhar idle no mesmo loop pedem continuidade. */
  readonly continuo?: boolean
  ligarMundo(el: HTMLElement | null): void
  ligarAtor(id: string, el: HTMLElement | null): void
  atualizarSprites(): void
  pintarAtor(quadro: QuadroDoAtor): void
  pintarCamera(quadro: QuadroDaCamera): void
  terminarQuadro?(agora: number): void
  destruir(): void
}
export type CriarRenderizadorDoEscritorio = () => RenderizadorDoEscritorio

export function quadroDoAtor(a: Actor, sheet: CharSheet | null, foco: string | null, hue = 0): QuadroDoAtor {
  const largura = sheet?.frameW ?? TILE, altura = sheet?.frameH ?? TILE
  const [x, y] = toScreen(a.x, a.y)
  return {
    id: a.id, esquerda: Math.round(x - largura / 2), topo: Math.round(y - altura), largura, altura,
    profundidade: depth(a.x, a.y), espelhado: a.facing < 0, andando: a.walking,
    foco: foco === a.id && a.walking && a.comando, oculto: a.hidden,
    coluna: ((a.dist / STEP_PX) | 0) % (sheet?.anims.walk?.frames ?? 1), hue, sheet,
  }
}
