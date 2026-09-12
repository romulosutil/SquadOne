/**
 * Loop e câmera do escritório — spec §4.1 / §4.2, em projeção isométrica.
 *
 * Um único requestAnimationFrame para todos os atores + a câmera. O loop para
 * sozinho quando ninguém anda (`raf = busy ? rAF(tick) : 0`). Idle/working é
 * CSS puro, sem gastar rAF.
 *
 * Três requisitos não-cosméticos de §4.2, mantidos na versão isométrica:
 *  1. Math.round() nas coordenadas — agora nas de TELA, que são as que viram px.
 *  2. Escrita DIRETA em el.style.transform (ref() = 60 re-renders/s).
 *  3. Frame do ciclo de caminhada derivado da DISTÂNCIA, não do relógio.
 *
 * O ator anda no mundo ortogonal; `toScreen` projeta só na hora de pintar, e o
 * sprite é um billboard (sempre de frente, espelhado quando anda para a
 * esquerda da tela) porque a arte do CraftPix só tem a vista frontal.
 *
 * A unidade de SALA é o DOMÍNIO, não a pessoa (§3.1): o slot pertence ao
 * domínio e todas as pessoas dele — PO e integrantes — dividem a mesma sala,
 * cada uma numa cadeira do template.
 */

import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import {
  INNER_H,
  INNER_OFFSET,
  INNER_W,
  NORTH_TILES,
  PROP_EMOJI,
  ROOM_H,
  ROOM_W,
  EXTRA_STATIONS,
  PROP_SIZE,
  TILE,
  WALL_H,
  WEST_TILES,
  isoBounds,
  localCenterPx,
  mapSizeTiles,
  parseRoom,
  roomOriginPx,
  slotKey,
  toScreen,
  type PropKind,
  type RoomId,
  type Vec2,
} from './rooms'
import { bfsSlots, buildRoute } from './path'

/** Uma pessoa do squad: o PO de um domínio ou um integrante dele. */
export interface OfficePessoa {
  id: string
  nome: string
  papel: string
  /** chave no craftpix.manifest.json */
  sprite: string
  /** graus de hue-rotate, para diferenciar papéis que reusam o mesmo sprite */
  hue?: number
  /** fallback quando o sheet não carrega */
  emoji: string
}

/** Um domínio = uma sala. O slot é dele, não de quem trabalha dentro. */
export interface OfficeDominio {
  id: string
  nome: string
  slot: Vec2
  room: RoomId
  /** PO na posição 0, integrantes na sequência — a ordem define a cadeira. */
  pessoas: OfficePessoa[]
}

/** px-fonte por segundo, no mundo ortogonal. */
const SPEED = 96
/** distância andada entre trocas de frame do ciclo de caminhada. */
const STEP_PX = 6
const CAM_LAMBDA = 8

const MANIFEST_URL = '/sprites/craftpix.manifest.json'

interface CharAnim {
  file: string
  frames: number
}

export interface CharSheet {
  frameW: number
  frameH: number
  anims: Record<string, CharAnim>
}

interface Actor {
  id: string
  /** domínio a que a pessoa pertence: define a sala em que ela está. */
  dominioId: string
  x: number
  y: number
  slot: Vec2
  route: Vec2[]
  dist: number
  /** direção na TELA: 1 = direita, -1 = esquerda (espelha o billboard) */
  facing: number
  walking: boolean
}

export interface RoomPropView {
  kind: PropKind
  emoji: string
  left: number
  top: number
  width: number
  height: number
  z: number
}

export interface WallView {
  key: string
  axis: 'x' | 'y'
  left: number
  top: number
  len: number
  z: number
}

export interface RoomView {
  key: string
  slot: Vec2
  /** retângulos em coordenadas de MUNDO (a camada .ground é que projeta) */
  base: { left: number; top: number; width: number; height: number }
  floor: { left: number; top: number; width: number; height: number }
  /** posição de tela da placa da sala */
  label: { text: string; left: number; top: number }
  isNew: boolean
  walls: WallView[]
  props: RoomPropView[]
}

export function useOffice(dominios: Ref<OfficeDominio[]>) {
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

  /** SCALE aparece em UM lugar: o transform de .world. Tab alterna 1 <-> 2. */
  const scale = ref(1)

  /** null enquanto carrega ou se o manifest não existir: a UI cai pro emoji. */
  const sheets = shallowRef<Record<string, CharSheet> | null>(null)

  const newRooms = reactive(new Set<string>())
  const seenRooms = new Set<string>()

  const unlocked = computed(() => new Set(dominios.value.map((d) => slotKey(d.slot))))

  const mapTiles = computed(() => mapSizeTiles(dominios.value.map((d) => d.slot)))

  /**
   * Índice pessoa -> domínio + posição dentro dele. É a tradução da árvore
   * para o que o loop precisa: o ator é a pessoa, mas a geometria é do domínio.
   */
  const porPessoa = computed(() => {
    const mapa = new Map<string, { pessoa: OfficePessoa; dominio: OfficeDominio; idx: number }>()
    for (const dominio of dominios.value) {
      dominio.pessoas.forEach((pessoa, idx) => mapa.set(pessoa.id, { pessoa, dominio, idx }))
    }
    return mapa
  })

  /** Lista achatada, na ordem da árvore — o v-for dos atores no template. */
  const pessoas = computed<OfficePessoa[]>(() => dominios.value.flatMap((d) => d.pessoas))
  const mapPx = computed<Vec2>(() => [mapTiles.value[0] * TILE, mapTiles.value[1] * TILE])
  const bounds = computed(() => isoBounds(mapPx.value[0], mapPx.value[1]))

  /** Profundidade do pintor: a diagonal do mundo ortogonal. */
  function depth(wx: number, wy: number): number {
    return Math.round(wx + wy)
  }

  const rooms = computed<RoomView[]>(() =>
    dominios.value.map((d) => {
      const parsed = parseRoom(d.room)
      const [ox, oy] = roomOriginPx(d.slot)
      const key = slotKey(d.slot)
      const x0 = ox + INNER_OFFSET
      const y0 = oy + INNER_OFFSET

      // Só as paredes de trás são desenhadas: as da frente esconderiam a sala.
      // Um tile por div — a profundidade de uma parede longa não cabe num único
      // z-index, e o vão da porta vira simplesmente um tile que não existe.
      const hasNorthDoor = unlocked.value.has(slotKey([d.slot[0], d.slot[1] - 1]))
      const hasWestDoor = unlocked.value.has(slotKey([d.slot[0] - 1, d.slot[1]]))
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
        label: { text: d.nome, left: lx, top: ly - WALL_H - 16 },
        isNew: newRooms.has(key),
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
    })
  )

  // -------------------------------------------------------------------------
  // Atores
  // -------------------------------------------------------------------------

  /** Fora do sistema de reatividade de propósito: o tick escreve no DOM direto. */
  const actors = new Map<string, Actor>()
  /** Nós do DOM, registrados pelo :ref do template (roda antes de onMounted). */
  const els = new Map<string, { root: HTMLElement; sprite: HTMLElement | null; walk: HTMLElement | null }>()
  const focused = ref<string | null>(null)

  /**
   * Posto de trabalho da i-ésima pessoa do domínio: uma cadeira por pessoa, na
   * ordem da árvore (PO primeiro). Domínio com mais gente que cadeira espalha
   * o excedente pelo miolo da sala em vez de empilhar todo mundo no mesmo pixel.
   */
  function stationPx(dominio: OfficeDominio, idx: number): Vec2 {
    const { stations } = parseRoom(dominio.room)
    const local =
      idx < stations.length
        ? stations[idx]
        : EXTRA_STATIONS[(idx - stations.length) % EXTRA_STATIONS.length]
    return localCenterPx(dominio.slot, local)
  }

  function sheetOf(id: string): CharSheet | null {
    const entrada = porPessoa.value.get(id)
    return (entrada && sheets.value?.[entrada.pessoa.sprite]) ?? null
  }

  function syncActors() {
    const alive = new Set<string>()
    for (const { pessoa, dominio, idx } of porPessoa.value.values()) {
      alive.add(pessoa.id)
      let a = actors.get(pessoa.id)
      if (!a) {
        const [x, y] = stationPx(dominio, idx)
        a = {
          id: pessoa.id,
          dominioId: dominio.id,
          x,
          y,
          slot: dominio.slot,
          route: [],
          dist: 0,
          facing: 1,
          walking: false,
        }
        actors.set(pessoa.id, a)
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
    els.set(id, {
      root: node,
      sprite: node.querySelector<HTMLElement>('[data-billboard]'),
      walk: node.querySelector<HTMLElement>('[data-walk]'),
    })
    const a = actors.get(id)
    if (a) paint(a)
  }

  /** Os nós do sprite trocam quando o manifest resolve (sheet <-> emoji). */
  function refreshSpriteEls() {
    for (const entry of els.values()) {
      entry.sprite = entry.root.querySelector<HTMLElement>('[data-billboard]')
      entry.walk = entry.root.querySelector<HTMLElement>('[data-walk]')
    }
    for (const a of actors.values()) paint(a)
  }

  function paint(a: Actor) {
    const entry = els.get(a.id)
    if (!entry) return
    const sheet = sheetOf(a.id)
    const w = sheet ? sheet.frameW : TILE
    const h = sheet ? sheet.frameH : TILE
    const [sx, sy] = toScreen(a.x, a.y)
    // (1) Math.round nas coordenadas de tela; (2) escrita direta no style.
    entry.root.style.transform =
      'translate3d(' + Math.round(sx - w / 2) + 'px, ' + Math.round(sy - h) + 'px, 0)'
    // Painter's algorithm: quem tem diagonal maior está mais à frente.
    entry.root.style.zIndex = String(depth(a.x, a.y))
    entry.root.classList.toggle('actor--walk', a.walking)

    if (entry.sprite) entry.sprite.style.transform = a.facing < 0 ? 'scaleX(-1)' : ''
    if (!entry.walk || !sheet || !a.walking) return
    // (3) frame derivado da distância percorrida, não do relógio.
    const frames = sheet.anims.walk?.frames ?? 1
    const col = ((a.dist / STEP_PX) | 0) % frames
    entry.walk.style.backgroundPositionX = -col * w + 'px'
  }

  /** Manda o ator até a sala de um slot (ou até um tile local específico). */
  function moveTo(id: string, slot: Vec2, local?: Vec2): boolean {
    const a = actors.get(id)
    if (!a) return false
    const dest = dominios.value.find((d) => slotKey(d.slot) === slotKey(slot))
    if (!dest) return false

    const slotPath = bfsSlots(a.slot, slot, unlocked.value)
    if (!slotPath) return false

    // Sem `local`, o ator volta para a PRÓPRIA cadeira: a posição dele na
    // árvore do domínio de destino, nunca a cadeira de outra pessoa.
    const idxNoDestino = dest.pessoas.findIndex((p) => p.id === id)
    const target = local
      ? localCenterPx(slot, local)
      : stationPx(dest, idxNoDestino < 0 ? dest.pessoas.length : idxNoDestino)
    a.route = buildRoute(slotPath, target)
    a.slot = slot
    a.walking = true
    a.dist = 0
    focused.value = id
    kick()
    return true
  }

  // -------------------------------------------------------------------------
  // Câmera (em coordenadas de tela)
  // -------------------------------------------------------------------------

  const cam = { x: 0, y: 0 }
  const view = { w: 960, h: 640 }

  function measure() {
    const el = viewportRef.value
    if (!el) return
    view.w = el.clientWidth / scale.value
    view.h = el.clientHeight / scale.value
  }

  function clampAxis(want: number, min: number, max: number, viewSize: number): number {
    const span = max - min
    // mapa menor que o viewport nesse eixo: centraliza
    if (span <= viewSize) return min - (viewSize - span) / 2
    const hi = max - viewSize
    return want < min ? min : want > hi ? hi : want
  }

  function camTarget(): Vec2 {
    const a = (focused.value ? actors.get(focused.value) : null) ?? actors.values().next().value
    const b = bounds.value
    const [sx, sy] = a ? toScreen(a.x, a.y) : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]
    return [
      clampAxis(sx - view.w / 2, b.minX, b.maxX, view.w),
      clampAxis(sy - view.h / 2, b.minY, b.maxY, view.h),
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
    scale.value = scale.value === 1 ? 2 : 1
  }

  async function loadSheets() {
    try {
      const res = await fetch(MANIFEST_URL, { headers: { accept: 'application/json' } })
      if (!res.ok) return
      const data = await res.json()
      if (data && typeof data === 'object' && data.chars) sheets.value = data.chars
    } catch {
      // manifest ausente ou inválido: segue no emoji
    }
  }

  // Atores existem antes do primeiro render: os :ref do template rodam antes
  // de onMounted e precisam achar o registro.
  syncActors()
  for (const d of dominios.value) seenRooms.add(slotKey(d.slot))

  onMounted(() => {
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
    void loadSheets()
  })

  onBeforeUnmount(() => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    ro?.disconnect()
    window.removeEventListener('keydown', onKey)
  })

  watch(sheets, () => {
    // o v-if troca o nó do sprite; repinta depois que o DOM assentar
    requestAnimationFrame(refreshSpriteEls)
  })

  watch(scale, () => {
    measure()
    kick()
  })

  watch(
    dominios,
    () => {
      syncActors()
      for (const d of dominios.value) {
        const key = slotKey(d.slot)
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
    sheets,
    pessoas,
    rooms,
    bounds,
    setActorEl,
    moveTo,
    focus: (id: string) => {
      focused.value = id
      kick()
    },
    focused,
  }
}
