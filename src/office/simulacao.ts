import type { Actor } from './modelo'
import { SPEED } from './configuracao'
import { toScreen } from './rooms'

/** Integra uma rota no mundo ortogonal. Não conhece câmera, Vue, tempo real ou renderizador. */
export function advance(a: Actor, dt: number): void {
  let budget = SPEED * dt
  while (budget > 0 && a.route.length) {
    const [tx, ty] = a.route[0]
    const dx = tx - a.x
    const dy = ty - a.y
    const d = Math.hypot(dx, dy)
    if (d < 0.001) {
      a.route.shift()
      continue
    }
    // billboard: o que importa é o sentido na tela, não no mundo
    const screenDx = toScreen(dx, dy)[0]
    if (Math.abs(screenDx) > 0.01) a.facing = screenDx < 0 ? -1 : 1
    if (d <= budget) {
      a.x = tx
      a.y = ty
      a.dist += d
      budget -= d
      a.route.shift()
    } else {
      a.x += (dx / d) * budget
      a.y += (dy / d) * budget
      a.dist += budget
      budget = 0
    }
  }
  if (!a.route.length && a.walking) {
    a.walking = false
    a.dist = 0
  }
}
