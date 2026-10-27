import { CAM_LAMBDA } from './configuracao'

export function clampAxis(want: number, min: number, max: number, viewSize: number): number {
  const span = max - min
  // mapa menor que o viewport nesse eixo: centraliza
  if (span <= viewSize) return min - (viewSize - span) / 2
  const hi = max - viewSize
  return want < min ? min : want > hi ? hi : want
}

/** Suavização e tolerância preservadas; o chamador injeta dt e a preferência de movimento. */
export function avancarCamera(cam: { x: number; y: number }, alvo: [number, number], dt: number, reduzido: boolean): boolean {
  const [wx, wy] = alvo
  const k = reduzido ? 1 : 1 - Math.exp(-CAM_LAMBDA * dt)
  cam.x += (wx - cam.x) * k
  cam.y += (wy - cam.y) * k
  if (Math.abs(wx - cam.x) < 0.5 && Math.abs(wy - cam.y) < 0.5) {
    cam.x = wx; cam.y = wy
    return false
  }
  return true
}
