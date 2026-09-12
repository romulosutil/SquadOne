/**
 * Geometria do escritório — spec §4.1, projetada em isométrico.
 *
 * Duas malhas de coordenadas, de propósito:
 *
 *   mundo   ortogonal, tile de 32px. Templates, BFS, rotas e colisão vivem aqui.
 *   tela    isométrico 2:1, saída de `toScreen`. Só a pintura usa.
 *
 * Nenhuma lógica de caminho conhece o isométrico: trocar a projeção é trocar
 * `toScreen` e `ISO_MATRIX`. SCALE continua existindo num único lugar: o
 * transform do container `.world` (useOffice).
 */

export type Vec2 = [number, number]

export const TILE = 32

/** Losango isométrico 2:1 — o tile de 32x32 vira 64x32 na tela. */
export const TILE_W = 64
export const TILE_H = 32

/** Altura da parede em px de tela (não existe no mundo ortogonal). */
export const WALL_H = 40

const KX = TILE_W / (2 * TILE)
const KY = TILE_H / (2 * TILE)

/** Projeta um ponto do mundo ortogonal para a tela isométrica. */
export function toScreen(wx: number, wy: number): Vec2 {
  return [(wx - wy) * KX, (wx + wy) * KY]
}

/** A mesma projeção como matriz CSS, para a camada de chão. */
export const ISO_MATRIX = `matrix(${KX}, ${KY}, ${-KX}, ${KY}, 0, 0)`

/** Face de parede alinhada ao eixo X do mundo (parede norte). */
export const WALL_MATRIX_X = `matrix(${KX}, ${KY}, 0, 1, 0, 0)`
/** Face de parede alinhada ao eixo Y do mundo (parede oeste). */
export const WALL_MATRIX_Y = `matrix(${-KX}, ${KY}, 0, 1, 0, 0)`

export interface IsoBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Caixa da tela que envolve o mapa inteiro, com folga para a altura da parede. */
export function isoBounds(mapW: number, mapH: number): IsoBounds {
  return {
    minX: -mapH * KX,
    maxX: mapW * KX,
    minY: -WALL_H,
    maxY: (mapW + mapH) * KY,
  }
}

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
  // Duas estações em pontas opostas, não lado a lado: em isométrico dois tiles
  // vizinhos ficam a 32px de tela e os sprites (64px de largura) se eclipsam —
  // quem chegou por último cobriria o PO em vez de dividir a sala com ele.
  ROOM_DEV: [
    '########',
    '#D....D#',
    '#c....c\u2593',
    '#......#',
    '#P....P#',
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
  /**
   * Tiles locais onde os atores param, um por cadeira do template.
   * São VÁRIOS porque uma sala é um DOMÍNIO inteiro (§3.1): o PO e os
   * integrantes dele dividem o mesmo slot. Se houver mais gente que cadeira,
   * o excedente cai em `EXTRA_STATIONS`.
   */
  stations: Vec2[]
  hasEastDoor: boolean
  hasSouthDoor: boolean
}

/**
 * Posições de sobra quando o domínio tem mais gente que cadeiras no template.
 * Ficam no miolo do retângulo convexo (x 1..6, y 1..4), longe das paredes e
 * dos props — a interpolação reta de §4.3 exige interior limpo.
 */
export const EXTRA_STATIONS: Vec2[] = [
  [3, 3], [4, 3], [2, 3], [5, 3], [3, 2], [4, 2], [2, 2], [5, 2],
]

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
  const stations: Vec2[] = []
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
      if (kind === 'chair') stations.push([x, y])
    }
  }

  const parsed: ParsedRoom = {
    props,
    stations: stations.length ? stations : [[ROOM_W >> 1, ROOM_H >> 1]],
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

/** Retângulo interno (o chão), sem a faixa de parede. */
export const INNER_OFFSET = TILE
export const INNER_W = (PITCH_X - 1) * TILE
export const INNER_H = (PITCH_Y - 1) * TILE
/** Tiles de parede desenhados por sala: só as de trás (norte e oeste). */
export const NORTH_TILES = PITCH_X - 1
export const WEST_TILES = PITCH_Y - 1

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
