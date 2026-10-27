import { INNER_H, INNER_OFFSET, INNER_W, NORTH_TILES, PROP_EMOJI, ROOM_H, ROOM_W,
  PROP_SIZE, TILE, WALL_H, WEST_TILES, parseRoom, roomOriginPx, slotKey, toScreen } from './rooms'
import type { OfficeDominio, RoomPhase, RoomView, WallView } from './modelo'

export function depth(wx: number, wy: number): number { return Math.round(wx + wy) }

/** A geometria depende somente do domínio, da fase visual e das portas existentes. */
export function projetarSala(d: OfficeDominio, fase: RoomPhase, unlocked: Set<string>): RoomView {
  const parsed = parseRoom(d.room)
  const [ox, oy] = roomOriginPx(d.slot)
  const key = slotKey(d.slot)
  const x0 = ox + INNER_OFFSET
  const y0 = oy + INNER_OFFSET

  // Só as paredes de trás são desenhadas: as da frente esconderiam a sala.
  // Um tile por div — a profundidade de uma parede longa não cabe num único
  // z-index, e o vão da porta vira simplesmente um tile que não existe.
  const hasNorthDoor = unlocked.has(slotKey([d.slot[0], d.slot[1] - 1]))
  const hasWestDoor = unlocked.has(slotKey([d.slot[0] - 1, d.slot[1]]))
  const walls: WallView[] = []
  for (let i = 0; i < NORTH_TILES; i++) {
    if (hasNorthDoor && i === 2) continue // porta sul do vizinho = local x 3
    const wx = x0 + i * TILE
    const [sx, sy] = toScreen(wx, y0)
    walls.push({
      key: `${key}-n${i}`,
      axis: 'x',
      left: sx,
      top: sy - WALL_H,
      len: TILE,
      z: depth(wx + TILE / 2, y0),
    })
  }
  for (let i = 0; i < WEST_TILES; i++) {
    if (hasWestDoor && i === 1) continue // porta leste do vizinho = local y 2
    const wy = y0 + i * TILE
    const [sx, sy] = toScreen(x0, wy)
    walls.push({
      key: `${key}-w${i}`,
      axis: 'y',
      left: sx,
      top: sy - WALL_H,
      len: TILE,
      z: depth(x0, wy + TILE / 2),
    })
  }

  const [lx, ly] = toScreen(x0, y0)
  return {
    key,
    slot: d.slot,
    // A base cobre a sala inteira, faixa de parede inclusa: é o topo da
    // parede. Sem ela a faixa compartilhada entre salas fica vazada.
    base: { left: ox, top: oy, width: ROOM_W * TILE, height: ROOM_H * TILE },
    floor: { left: x0, top: y0, width: INNER_W, height: INNER_H },
    // A placa da sala é UI, não objeto de mundo: não entra no painter's
    // algorithm, senão o ator da própria sala a cobre.
    // A placa nomeia o DOMÍNIO: a sala inteira é dele, não de uma pessoa.
    // A contagem vem da última forma conhecida: a sala que fecha mantém o formato.
    label: { text: `${d.nome} · ${d.pessoas.length}`, left: lx, top: ly - WALL_H - 16 },
    phase: fase,
    walls,
    props: parsed.props.map((p) => {
      const [w, h] = PROP_SIZE[p.kind]
      // Âncora do prop: centro do tile no chão; o desenho sobe a partir dele.
      const wx = ox + p.local[0] * TILE + TILE / 2
      const wy = oy + p.local[1] * TILE + TILE / 2
      const [sx, sy] = toScreen(wx, wy)
      return {
        kind: p.kind,
        emoji: PROP_EMOJI[p.kind],
        left: Math.round(sx - w / 2),
        top: Math.round(sy - h),
        width: w,
        height: h,
        z: depth(wx, wy),
      }
    }),
  }
}
