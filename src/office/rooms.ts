/**
 * Geometria do escritório — spec §4.1.
 *
 * Toda a matemática deste módulo é em *px-fonte* (tile de 32px, sem escala).
 * SCALE existe num único lugar: o transform do container `.world` (useOffice).
 */

export type Vec2 = [number, number]

export const TILE = 32

/** Salas são sempre 8x6 tiles, com paredes compartilhadas. */
export const ROOM_W = 8
export const ROOM_H = 6

/** pitch = [7,5] — a última coluna/linha de parede é a primeira da sala vizinha. */
export const PITCH_X = 7
export const PITCH_Y = 5

/** Posição canônica das portas no template (parede leste e parede sul). */
export const DOOR_EAST: Vec2 = [7, 2]
export const DOOR_SOUTH: Vec2 = [3, 5]

/** §4.1 — monótona direita/baixo, nada que já está na tela se move. */
export const UNLOCK_ORDER: Vec2[] = [
  [0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1], [0, 2], [1, 2], [2, 2],
]

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// Legenda: '#' parede  '.' chão  'D' mesa  'c' cadeira  'P' planta
//          '\u2593' porta  '=' vidro
//
// 8 colunas x 6 linhas. Interior útil = x 1..6, y 1..4 (retângulo convexo,
// pré-requisito da interpolação reta de §4.3 — não colocar prop no miolo).

export type RoomId = 'ROOM_SOLO' | 'ROOM_DEV' | 'ROOM_STUDIO' | 'ROOM_LOUNGE' | 'ROOM_EMPTY'

export const ROOM_TEMPLATES: Record<RoomId, string[]> = {
  ROOM_SOLO: [
    '########',
    '#D....P#',
    '#c.....\u2593',
    '#......#',
    '#P....D#',
    '###\u2593####',
  ],
  ROOM_DEV: [
    '########',
    '#DD...P#',
    '#cc....\u2593',
    '#......#',
    '#P...DD#',
    '###\u2593####',
  ],
  ROOM_STUDIO: [
    '###==###',
    '#D....P#',
    '#c.....\u2593',
    '#......#',
    '#PP...D#',
    '###\u2593####',
  ],
  ROOM_LOUNGE: [
    '########',
    '#P....P#',
    '#c.....\u2593',
    '#......#',
    '#D....P#',
    '###\u2593####',
  ],
  ROOM_EMPTY: [
    '########',
    '#......#',
    '#......\u2593',
    '#......#',
    '#......#',
    '###\u2593####',
  ],
}

export type PropKind = 'desk' | 'chair' | 'plant' | 'glass'

export interface RoomProp {
  kind: PropKind
  /** tile local dentro da sala */
  local: Vec2
}

export interface ParsedRoom {
  props: RoomProp[]
  /** tile local onde o ator senta (primeira cadeira; fallback = centro). */
  station: Vec2
  hasEastDoor: boolean
  hasSouthDoor: boolean
}

const PROP_BY_CHAR: Record<string, PropKind> = {
  D: 'desk',
  c: 'chair',
  P: 'plant',
  '=': 'glass',
}

const parseCache = new Map<string, ParsedRoom>()

/**
 * Lê o template UMA vez na montagem para extrair props e portas.
 * Não vira matriz global — o resultado é uma lista curta de nós.
 */
export function parseRoom(id: RoomId): ParsedRoom {
  const cached = parseCache.get(id)
  if (cached) return cached

  const rows = ROOM_TEMPLATES[id] ?? ROOM_TEMPLATES.ROOM_EMPTY
  if (rows.length !== ROOM_H) {
    throw new Error(`[rooms] template ${id} tem ${rows.length} linhas, esperado ${ROOM_H}`)
  }

  const props: RoomProp[] = []
  let station: Vec2 | null = null
  let hasEastDoor = false
  let hasSouthDoor = false

  for (let y = 0; y < ROOM_H; y++) {
    const row = rows[y]
    if (row.length !== ROOM_W) {
      throw new Error(`[rooms] template ${id} linha ${y} tem ${row.length} colunas, esperado ${ROOM_W}`)
    }
    for (let x = 0; x < ROOM_W; x++) {
      const ch = row[x]
      if (ch === '\u2593') {
        if (x === DOOR_EAST[0] && y === DOOR_EAST[1]) hasEastDoor = true
        else if (x === DOOR_SOUTH[0] && y === DOOR_SOUTH[1]) hasSouthDoor = true
        continue
      }
      const kind = PROP_BY_CHAR[ch]
      if (!kind) continue
      props.push({ kind, local: [x, y] })
      if (kind === 'chair' && !station) station = [x, y]
    }
  }

  const parsed: ParsedRoom = {
    props,
    station: station ?? [ROOM_W >> 1, ROOM_H >> 1],
    hasEastDoor,
    hasSouthDoor,
  }
  parseCache.set(id, parsed)
  return parsed
}

// ---------------------------------------------------------------------------
// Aritmética de mundo (verificada na spec §4.1)
// ---------------------------------------------------------------------------

/** worldTile(slot, local) = [slot.x*7 + local.x, slot.y*5 + local.y] */
export function worldTile(slot: Vec2, local: Vec2): Vec2 {
  return [slot[0] * PITCH_X + local[0], slot[1] * PITCH_Y + local[1]]
}

/** Canto superior-esquerdo da sala, em px-fonte. */
export function roomOriginPx(slot: Vec2): Vec2 {
  return [slot[0] * PITCH_X * TILE, slot[1] * PITCH_Y * TILE]
}

/** Centro de um tile de mundo, em px-fonte. */
export function tileCenterPx(tile: Vec2): Vec2 {
  return [tile[0] * TILE + TILE / 2, tile[1] * TILE + TILE / 2]
}

/** Centro (px-fonte) de um tile local de uma sala. */
export function localCenterPx(slot: Vec2, local: Vec2): Vec2 {
  return tileCenterPx(worldTile(slot, local))
}

/** mapSize(N,M) = [7N+1, 5M+1] tiles */
export function mapSizeTiles(slots: Vec2[]): Vec2 {
  let n = 1
  let m = 1
  for (const s of slots) {
    if (s[0] + 1 > n) n = s[0] + 1
    if (s[1] + 1 > m) m = s[1] + 1
  }
  return [PITCH_X * n + 1, PITCH_Y * m + 1]
}

export function slotKey(slot: Vec2): string {
  return `${slot[0]},${slot[1]}`
}

// ---------------------------------------------------------------------------
// Fallbacks de emoji (§ usado quando o PNG do sprite dá 404)
// ---------------------------------------------------------------------------

export const PROP_EMOJI: Record<PropKind, string> = {
  desk: '\u{1F5A5}\uFE0F',
  chair: '\u{1FA91}',
  plant: '\u{1FAB4}',
  glass: '\u{1FA9F}',
}

export const PROP_SIZE: Record<PropKind, Vec2> = {
  desk: [64, 48],
  chair: [32, 32],
  plant: [32, 48],
  glass: [32, 32],
}
