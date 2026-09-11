/**
 * Loop e câmera do escritório — spec §4.1 / §4.2.
 *
 * Um único requestAnimationFrame para todos os atores + a câmera. O loop para
 * sozinho quando ninguém anda (`raf = busy ? rAF(tick) : 0`). Idle/working é
 * CSS puro com steps(2), sem gastar rAF.
 *
 * Três requisitos não-cosméticos de §4.2:
 *  1. Math.round() nas coordenadas de mundo (senão o sprite cintila a 2x).
 *  2. Escrita DIRETA em el.style.transform (ref() = 60 re-renders/s).
 *  3. Frame do ciclo de caminhada derivado da DISTÂNCIA, não do relógio.
 */

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import {
  PROP_EMOJI,
  PROP_SIZE,
  ROOM_H,
  ROOM_W,
  TILE,
  localCenterPx,
  mapSizeTiles,
  parseRoom,
  roomOriginPx,
  slotKey,
  type PropKind,
  type RoomId,
  type Vec2,
} from './rooms'
import { bfsSlots, buildRoute } from './path'

export interface OfficeMember {
  id: string
  nome: string
  papel: string
  slot: Vec2
  room: RoomId
  /** fallback quando char_po.png dá 404 */
  emoji: string
}

/** px-fonte por segundo. */
const SPEED = 96
/** distância andada entre trocas de frame do ciclo de caminhada. */
const STEP_PX = 16
/** col: 0 parado, 1 passo-esq, 2 passo-dir (§5.1) */
const PINGPONG = [0, 1, 0, 2]
/** row: 0 baixo, 1 esq, 2 dir, 3 cima (§5.1) */
const DIR_DOWN = 0
const DIR_LEFT = 1
const DIR_RIGHT = 2
const DIR_UP = 3
/** pés em y=30 dentro do frame 32x32 (§5.1) */
const FOOT_Y = 30
const CAM_LAMBDA = 8

export const SPRITE_URL = {
  char: '/sprites/char_po.png',
  floor: '/sprites/tile_floor.png',
  wall: '/sprites/tile_wall.png',
  door: '/sprites/tile_door.png',
  desk: '/sprites/prop_desk.png',
  chair: '/sprites/prop_chair.png',
  plant: '/sprites/prop_plant.png',
} as const

export type SpriteKey = keyof typeof SPRITE_URL

interface Actor {
  id: string
  x: number
  y: number
  slot: Vec2
  route: Vec2[]
  dist: number
  dir: number
  walking: boolean
}

export interface RoomPropView {
  kind: PropKind
  emoji: string
  left: number
  top: number
  width: number
  height: number
}

export interface RoomView {
  key: string
  slot: Vec2
  left: number
  top: number
  width: number
  height: number
  label: string
  isNew: boolean
  props: RoomPropView[]
  doors: { left: number; top: number }[]
}

/** Carrega o PNG uma vez; false = 404 e a UI cai pro emoji. */
function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0)
    img.onerror = () => resolve(false)
    img.src = url
  })
}

export function useOffice(members: Ref<OfficeMember[]>) {
  // Setters em vez de refs expostos: no template um ref é auto-unwrapped, então
  // `:ref="worldRef"` passaria null em vez do objeto ref.
  const viewportRef = shallowRef<HTMLElement | null>(null)
  const worldRef = shallowRef<HTMLElement | null>(null)

  function setViewportEl(el: unknown) {
    viewportRef.value = (el as HTMLElement | null) ?? null
  }

  function setWorldEl(el: unknown) {
    worldRef.value = (el as HTMLElement | null) ?? null
    applyCamera()
  }

  /** SCALE aparece em UM lugar: o transform de .world. Tab alterna 2 <-> 1. */
  const scale = ref(2)

  const assets = reactive<Record<SpriteKey, boolean>>({
    char: false,
    floor: false,
    wall: false,
    door: false,
    desk: false,
    chair: false,
    plant: false,
  })

  const newRooms = reactive(new Set<string>())
  const seenRooms = new Set<string>()

  const unlocked = computed(() => new Set(members.value.map((m) => slotKey(m.slot))))

  const mapTiles = computed(() => mapSizeTiles(members.value.map((m) => m.slot)))
  const mapPx = computed<Vec2>(() => [mapTiles.value[0] * TILE, mapTiles.value[1] * TILE])

  const rooms = computed<RoomView[]>(() =>
    members.value.map((m) => {
      const parsed = parseRoom(m.room)
      const [ox, oy] = roomOriginPx(m.slot)
      const key = slotKey(m.slot)
      const doors: { left: number; top: number }[] = []
      if (parsed.hasEastDoor && unlocked.value.has(slotKey([m.slot[0] + 1, m.slot[1]]))) {
        doors.push({ left: ox + 7 * TILE, top: oy + 2 * TILE })
      }
      if (parsed.hasSouthDoor && unlocked.value.has(slotKey([m.slot[0], m.slot[1] + 1]))) {
        doors.push({ left: ox + 3 * TILE, top: oy + 5 * TILE })
      }
      return {
        key,
        slot: m.slot,
        left: ox,
        top: oy,
        width: ROOM_W * TILE,
        height: ROOM_H * TILE,
        label: m.papel,
        isNew: newRooms.has(key),
        doors,
        props: parsed.props.map((p) => {
          const [w, h] = PROP_SIZE[p.kind]
          return {
            kind: p.kind,
            emoji: PROP_EMOJI[p.kind],
            // props mais altos que o tile estouram pra cima, ancorados no rodapé
            left: ox + p.local[0] * TILE,
            top: oy + p.local[1] * TILE - (h - TILE),
            width: w,
            height: h,
          }
        }),
      }
    })
  )

  // -------------------------------------------------------------------------
  // Atores
  // -------------------------------------------------------------------------

  /** Fora do sistema de reatividade de propósito: o tick escreve no DOM direto. */
  const actors = new Map<string, Actor>()
  /** Nós do DOM, registrados pelo :ref do template (roda antes de onMounted). */
  const els = new Map<string, { root: HTMLElement; sprite: HTMLElement | null }>()
  const focused = ref<string | null>(null)

  function stationPx(m: OfficeMember): Vec2 {
    return localCenterPx(m.slot, parseRoom(m.room).station)
  }

  function syncActors() {
    const alive = new Set<string>()
    for (const m of members.value) {
      alive.add(m.id)
      let a = actors.get(m.id)
      if (!a) {
        const [x, y] = stationPx(m)
        a = {
          id: m.id,
          x,
          y,
          slot: m.slot,
          route: [],
          dist: 0,
          dir: DIR_DOWN,
          walking: false,
        }
        actors.set(m.id, a)
      }
      paint(a)
    }
    for (const id of [...actors.keys()]) if (!alive.has(id)) actors.delete(id)
  }

  function setActorEl(id: string, el: unknown) {
    const node = (el as HTMLElement | null) ?? null
    if (!node) {
      els.delete(id)
      return
    }
    els.set(id, { root: node, sprite: node.querySelector<HTMLElement>('[data-sprite]') })
    const a = actors.get(id)
    if (a) paint(a)
  }

  /** O nó [data-sprite] troca quando o probe do PNG resolve (sprite <-> emoji). */
  function refreshSpriteEls() {
    for (const entry of els.values()) {
      entry.sprite = entry.root.querySelector<HTMLElement>('[data-sprite]')
    }
    for (const a of actors.values()) paint(a)
  }

  function paint(a: Actor) {
    const entry = els.get(a.id)
    if (!entry) return
    // (1) Math.round nas coordenadas de mundo; (2) escrita direta no style.
    entry.root.style.transform =
      'translate3d(' + Math.round(a.x - TILE / 2) + 'px, ' + Math.round(a.y - FOOT_Y) + 'px, 0)'
    entry.root.classList.toggle('actor--walk', a.walking)
    if (!entry.sprite) return
    // (3) frame derivado da distância percorrida, não do relógio.
    const col = a.walking ? PINGPONG[((a.dist / STEP_PX) | 0) % 4] : 0
    entry.sprite.style.backgroundPosition = -col * TILE + 'px ' + -a.dir * TILE + 'px'
  }

  /** Manda o ator até a estação da sala do slot (ou um tile local específico). */
  function moveTo(id: string, slot: Vec2, local?: Vec2): boolean {
    const a = actors.get(id)
    if (!a) return false
    const dest = members.value.find((m) => slotKey(m.slot) === slotKey(slot))
    if (!dest) return false

    const slotPath = bfsSlots(a.slot, slot, unlocked.value)
    if (!slotPath) return false

    const target = local ? localCenterPx(slot, local) : stationPx(dest)
    a.route = buildRoute(slotPath, target)
    a.slot = slot
    a.walking = true
    a.dist = 0
    focused.value = id
    kick()
    return true
  }

  // -------------------------------------------------------------------------
  // Câmera
  // -------------------------------------------------------------------------

  const cam = { x: 0, y: 0 }
  const view = { w: 480, h: 320 }

  function measure() {
    const el = viewportRef.value
    if (!el) return
    view.w = el.clientWidth / scale.value
    view.h = el.clientHeight / scale.value
  }

  function clampAxis(want: number, mapSize: number, viewSize: number): number {
    const max = mapSize - viewSize
    // mapa menor que o viewport nesse eixo: centraliza
    if (max <= 0) return max / 2
    return want < 0 ? 0 : want > max ? max : want
  }

  function camTarget(): Vec2 {
    const a = (focused.value ? actors.get(focused.value) : null) ?? actors.values().next().value
    const cx = a ? a.x : mapPx.value[0] / 2
    const cy = a ? a.y : mapPx.value[1] / 2
    return [
      clampAxis(cx - view.w / 2, mapPx.value[0], view.w),
      clampAxis(cy - view.h / 2, mapPx.value[1], view.h),
    ]
  }

  function applyCamera() {
    const el = worldRef.value
    if (!el) return
    const s = scale.value
    el.style.transform =
      'translate3d(' + -Math.round(cam.x * s) + 'px, ' + -Math.round(cam.y * s) + 'px, 0) scale(' + s + ')'
  }

  function snapCamera() {
    measure()
    const [tx, ty] = camTarget()
    cam.x = tx
    cam.y = ty
    applyCamera()
  }

  // -------------------------------------------------------------------------
  // Loop único
  // -------------------------------------------------------------------------

  let raf = 0
  let last = 0

  function advance(a: Actor, dt: number): void {
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
      a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR_RIGHT : DIR_LEFT) : dy > 0 ? DIR_DOWN : DIR_UP
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
      a.dir = DIR_DOWN
    }
  }

  function tick(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    // Leitura barata: o transform de .world não invalida o layout do viewport,
    // e o loop dorme quando ninguém anda.
    measure()

    let busy = false
    for (const a of actors.values()) {
      if (a.route.length || a.walking) {
        advance(a, dt)
        busy = true
      }
      paint(a)
    }

    const [wx, wy] = camTarget()
    // suavização independente de framerate
    const k = 1 - Math.exp(-CAM_LAMBDA * dt)
    cam.x += (wx - cam.x) * k
    cam.y += (wy - cam.y) * k
    if (Math.abs(wx - cam.x) < 0.5 && Math.abs(wy - cam.y) < 0.5) {
      cam.x = wx
      cam.y = wy
    } else {
      busy = true
    }
    applyCamera()

    // o loop para sozinho quando ninguém anda
    raf = busy ? requestAnimationFrame(tick) : 0
  }

  function kick() {
    if (raf) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  let ro: ResizeObserver | null = null

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Tab') return
    e.preventDefault()
    scale.value = scale.value === 2 ? 1 : 2
  }

  // Atores existem antes do primeiro render: os :ref do template rodam antes
  // de onMounted e precisam achar o registro.
  syncActors()
  for (const m of members.value) seenRooms.add(slotKey(m.slot))

  onMounted(async () => {
    snapCamera()
    // O CSS pode chegar depois do mount (style injetado): o layout só existe no
    // frame seguinte, então re-mede antes de fixar a câmera.
    requestAnimationFrame(snapCamera)

    if (viewportRef.value && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        measure()
        snapCamera()
      })
      ro.observe(viewportRef.value)
    }
    window.addEventListener('keydown', onKey)

    await Promise.all(
      (Object.keys(SPRITE_URL) as SpriteKey[]).map(async (k) => {
        assets[k] = await probe(SPRITE_URL[k])
      })
    )
  })

  watch(
    () => assets.char,
    () => nextTick(refreshSpriteEls)
  )

  onBeforeUnmount(() => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    ro?.disconnect()
    window.removeEventListener('keydown', onKey)
  })

  watch(scale, () => {
    measure()
    kick()
  })

  watch(
    members,
    () => {
      syncActors()
      for (const m of members.value) {
        const key = slotKey(m.slot)
        if (seenRooms.has(key)) continue
        seenRooms.add(key)
        newRooms.add(key)
        setTimeout(() => newRooms.delete(key), 500)
      }
      kick()
    },
    { deep: true }
  )

  return {
    setViewportEl,
    setWorldEl,
    scale,
    assets,
    rooms,
    mapPx,
    setActorEl,
    moveTo,
    focus: (id: string) => {
      focused.value = id
      kick()
    },
    focused,
    SPRITE_URL,
  }
}
