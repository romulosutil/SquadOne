/**
 * Pathfinding — spec §4.3.
 *
 * Sem A*. BFS sobre o grafo de <=9 slots + interpolação reta dentro da sala.
 * Válido porque toda sala é um retângulo convexo: o segmento entre dois pontos
 * interiores nunca sai. O único ponto côncavo do mundo é o vão da porta,
 * resolvido com 3 waypoints (inner -> center -> outer) que forçam travessia
 * perpendicular.
 *
 * Morre se surgirem obstáculos no meio da sala. Saída barata: mais waypoints
 * autorais no template, não A*.
 */

import { DOOR_EAST, DOOR_SOUTH, TILE, localCenterPx, slotKey, type Vec2 } from './rooms'

const NEIGHBORS: Vec2[] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** Caminho de slots (inclusive origem e destino) ou null se desconexo. */
export function bfsSlots(from: Vec2, to: Vec2, unlocked: Set<string>): Vec2[] | null {
  const start = slotKey(from)
  const goal = slotKey(to)
  if (!unlocked.has(start) || !unlocked.has(goal)) return null
  if (start === goal) return [from]

  const prev = new Map<string, string | null>([[start, null]])
  const coord = new Map<string, Vec2>([[start, from]])
  const queue: Vec2[] = [from]

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    const curKey = slotKey(cur)
    for (const [dx, dy] of NEIGHBORS) {
      const next: Vec2 = [cur[0] + dx, cur[1] + dy]
      const nextKey = slotKey(next)
      if (!unlocked.has(nextKey) || prev.has(nextKey)) continue
      prev.set(nextKey, curKey)
      coord.set(nextKey, next)
      if (nextKey === goal) return rebuild(prev, coord, goal)
      queue.push(next)
    }
  }
  return null
}

function rebuild(prev: Map<string, string | null>, coord: Map<string, Vec2>, goal: string): Vec2[] {
  const out: Vec2[] = []
  let cur: string | null = goal
  while (cur) {
    out.push(coord.get(cur)!)
    cur = prev.get(cur) ?? null
  }
  return out.reverse()
}

/**
 * Centro em px-fonte da porta compartilhada entre dois slots adjacentes.
 * A porta pertence sempre ao slot "de cima/da esquerda" — parede leste ou sul.
 */
export function doorCenterPx(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 1) return localCenterPx(a, DOOR_EAST)
  if (dx === -1) return localCenterPx(b, DOOR_EAST)
  if (dy === 1) return localCenterPx(a, DOOR_SOUTH)
  if (dy === -1) return localCenterPx(b, DOOR_SOUTH)
  throw new Error(`[path] slots não adjacentes: ${slotKey(a)} -> ${slotKey(b)}`)
}

/**
 * Converte o caminho de slots numa lista de waypoints em px-fonte.
 * Cada travessia vira inner -> center -> outer (perpendicular à porta).
 */
export function buildRoute(slotPath: Vec2[], target: Vec2): Vec2[] {
  const route: Vec2[] = []
  for (let i = 0; i + 1 < slotPath.length; i++) {
    const a = slotPath[i]
    const b = slotPath[i + 1]
    const center = doorCenterPx(a, b)
    const dirX = Math.sign(b[0] - a[0])
    const dirY = Math.sign(b[1] - a[1])
    route.push([center[0] - dirX * TILE, center[1] - dirY * TILE]) // inner
    route.push([center[0], center[1]])                             // center
    route.push([center[0] + dirX * TILE, center[1] + dirY * TILE]) // outer
  }
  route.push(target)
  return route
}
