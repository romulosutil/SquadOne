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
 * cada uma num posto da sala (src/office/postos.ts).
 *
 * Dois tipos de movimento, com marcador explícito no ator em vez de heurística:
 *  - COMANDO (`moveTo`, entrada de contratado): vence sempre, cancela o passeio
 *    e é o único que a câmera segue.
 *  - PASSEIO ambiente: quem está parado, visível e fora de obra sai de tempos em
 *    tempos para um tile livre da própria sala (às vezes da vizinha), pausa e
 *    volta. A espera e a pausa são setTimeout — o rAF continua dormindo quando
 *    ninguém anda. Desligado com prefers-reduced-motion.
 */

import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import {
  DOOR_SOUTH,
  INNER_H,
  INNER_OFFSET,
  INNER_W,
  NORTH_TILES,
  PROP_EMOJI,
  ROOM_H,
  ROOM_W,
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
import { bfsSlots, buildRoute, doorCenterPx, slotDoPontoPx } from './path'
import { postoLocal, tilesLivres } from './postos'
import { planejarSalas } from './salas'

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

/**
 * Crescimento do escritório (§4.4), na ordem em que o usuário enxerga:
 * a câmera pana até o slot vazio, a sala materializa, e só então o personagem
 * entra pela porta e anda até a mesa. Contratar um integrante pula os dois
 * primeiros passos: a sala dele já está lá.
 */
const ROOM_PAN_MS = 700
/** Casado com `room-build` em src/index.css. */
const ROOM_BUILD_MS = 450

/**
 * Perambular (faixas [min, max] sorteadas uniformemente). A espera longa e
 * aleatória é o que escalona: sem ela o escritório inteiro levantaria junto.
 */
const PASSEIO_ESPERA_MS: Vec2 = [6000, 16000]
const PASSEIO_PAUSA_MS: Vec2 = [2000, 5000]
/** Teto de gente passeando cheio: tenta de novo mais cedo, sem esperar um ciclo inteiro. */
const PASSEIO_REPIQUE_MS: Vec2 = [2000, 6000]
/** Chance de o passeio ser até a sala vizinha em vez de dentro da própria. */
const PASSEIO_VIZINHO = 0.2
/** No máximo esta fração dos atores fora do posto por passeio ao mesmo tempo. */
const PASSEIO_FRACAO_MAX = 1 / 3
/**
 * Folga de tela entre o destino do passeio e qualquer outro ator (parado ou
 * indo para algum lugar): passear até o colo de alguém recria a aglomeração.
 */
const PASSEIO_FOLGA_PX = 40

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
  /** ator de uma sala que ainda está nascendo: existe, mas não se pinta. */
  hidden: boolean
  /**
   * Movimento mandado de fora (moveTo, entrada). Enquanto true o ator não
   * passeia, e é só nesse estado que a câmera o segue.
   */
  comando: boolean
  /**
   * O comando termina ao chegar (voltar à própria cadeira). Visita a outra sala
   * segura o ator lá até o próximo comando: o GameMap é quem manda voltar.
   */
  comandoAcabaAoChegar: boolean
  /** Passeio ambiente em curso. null = no posto (ou sob comando). */
  passeio: 'indo' | 'pausa' | 'voltando' | null
  /** Espera até o próximo passeio ou pausa no destino. Um por ator, para cancelar. */
  timerPasseio: ReturnType<typeof setTimeout> | null
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
  /**
   * null = sala assentada. 'pending' = slot já reservado, mas a sala espera a
   * câmera chegar. 'building' = tocando `room-build`. 'closing' = domínio
   * arquivado: a sala toca `room-build` ao contrário e some.
   */
  phase: RoomPhase
  walls: WallView[]
  props: RoomPropView[]
}

export type RoomPhase = 'pending' | 'building' | 'closing' | null

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

  /** Fase de cada sala em obra, por slotKey. Vazio = escritório em repouso. */
  const roomPhase = reactive(new Map<string, Exclude<RoomPhase, null>>())
  /**
   * Última forma conhecida de cada sala, por slot. Guarda o domínio e não só o
   * slot: um slot pode esvaziar (domínio arquivado) e voltar com outro dono, e
   * a sala que sai precisa da última aparência para fechar na tela.
   */
  const knownRooms = new Map<string, OfficeDominio>()
  /** Salas fora do roster ainda desenhadas, com fase 'closing', até a animação acabar. */
  const fechando = shallowRef<OfficeDominio[]>([])
  /**
   * Geração por slot. Todo timer de obra ou fechamento guarda a geração em que
   * nasceu e não faz nada se ela mudou: arquivar no meio da obra, ou reabrir no
   * meio do fechamento, não deixa fase presa na sala nova do mesmo slot.
   */
  const geracao = new Map<string, number>()
  function novaGeracao(key: string): number {
    const g = (geracao.get(key) ?? 0) + 1
    geracao.set(key, g)
    return g
  }
  /**
   * O primeiro roster que chega não é crescimento: o escritório já existia
   * antes do app abrir. Só depois dele uma sala nova vira animação.
   */
  let primeiraCarga = true
  const timers = new Set<ReturnType<typeof setTimeout>>()

  function agendar(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
    return t
  }

  function desagendar(t: ReturnType<typeof setTimeout>) {
    clearTimeout(t)
    timers.delete(t)
  }

  /**
   * prefers-reduced-motion: reduce desliga só o perambular. Movimento comandado
   * continua — é ele que diz ao usuário quem está atendendo a demanda.
   */
  const mqMovimento =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
  let movimentoReduzido = mqMovimento?.matches ?? false

  /** Ponto de mundo que a câmera persegue enquanto nenhum ator é o foco. */
  const lookPoint = shallowRef<Vec2 | null>(null)

  const unlocked = computed(() => new Set(dominios.value.map((d) => slotKey(d.slot))))

  // A sala que fecha ainda precisa caber no mundo até sumir.
  const mapTiles = computed(() => mapSizeTiles([...dominios.value, ...fechando.value].map((d) => d.slot)))

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
    [
      ...dominios.value.map((d) => ({ d, fase: (roomPhase.get(slotKey(d.slot)) ?? null) as RoomPhase })),
      // Fora do roster, mas ainda na tela até `room--closing` terminar. As
      // portas vêm de `unlocked` (só ativas): a sala que fecha já as perde.
      ...fechando.value.map((d) => ({ d, fase: 'closing' as RoomPhase })),
    ].map(({ d, fase }) => {
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
   * Posto de trabalho da i-ésima pessoa do domínio: cadeiras do template na
   * ordem da árvore (PO primeiro), e o excedente espalhado pela sala por
   * `postoLocal` — que conhece o total para não empilhar ninguém.
   */
  function stationPx(dominio: OfficeDominio, idx: number): Vec2 {
    return localCenterPx(dominio.slot, postoLocal(dominio.room, idx, dominio.pessoas.length))
  }

  function sheetOf(id: string): CharSheet | null {
    const entrada = porPessoa.value.get(id)
    return (entrada && sheets.value?.[entrada.pessoa.sprite]) ?? null
  }

  /** Primeira sala vizinha já desbloqueada — por onde se chega a pé. */
  function vizinhoDesbloqueado(slot: Vec2): Vec2 | null {
    const lados: Vec2[] = [[-1, 0], [0, -1], [1, 0], [0, 1]]
    for (const [dx, dy] of lados) {
      const n: Vec2 = [slot[0] + dx, slot[1] + dy]
      if (n[0] < 0 || n[1] < 0) continue
      // Sala em obra não serve de origem: ninguém sai de uma sala que ainda
      // não terminou de nascer.
      if (unlocked.value.has(slotKey(n)) && !roomPhase.has(slotKey(n))) return n
    }
    return null
  }

  /**
   * Rota de chegada de quem acabou de ser contratado (§4.4): nasce FORA da
   * sala e atravessa a porta. Reusa os mesmos waypoints perpendiculares do
   * pathfinding (§4.3) — a porta é o único ponto côncavo do mundo e entrar
   * em diagonal atravessaria a parede.
   */
  function rotaDeEntrada(dominio: OfficeDominio, idx: number): { spawn: Vec2; route: Vec2[] } {
    const alvo = stationPx(dominio, idx)
    const vizinho = vizinhoDesbloqueado(dominio.slot)
    if (vizinho) {
      const [cx, cy] = doorCenterPx(vizinho, dominio.slot)
      const dirX = Math.sign(dominio.slot[0] - vizinho[0])
      const dirY = Math.sign(dominio.slot[1] - vizinho[1])
      return {
        spawn: [cx - dirX * TILE, cy - dirY * TILE],
        route: [[cx, cy], [cx + dirX * TILE, cy + dirY * TILE], alvo],
      }
    }
    // Sala isolada (o primeiro domínio do squad): entra pela porta sul, que
    // todo template tem, vindo de fora do mapa.
    const porta = localCenterPx(dominio.slot, DOOR_SOUTH)
    const dentro = localCenterPx(dominio.slot, [DOOR_SOUTH[0], DOOR_SOUTH[1] - 1])
    return { spawn: [porta[0], porta[1] + TILE], route: [porta, dentro, alvo] }
  }

  function iniciarEntrada(a: Actor, dominio: OfficeDominio, idx: number) {
    const { spawn, route } = rotaDeEntrada(dominio, idx)
    cancelarPasseio(a)
    a.comando = true
    a.comandoAcabaAoChegar = true
    a.x = spawn[0]
    a.y = spawn[1]
    a.slot = dominio.slot
    a.route = route
    a.dist = 0
    a.walking = true
    a.hidden = false
    // A câmera larga o ponto fixo da sala e passa a seguir quem está entrando.
    lookPoint.value = null
    focused.value = a.id
    ultimoAlvo = [a.x, a.y]
    paint(a)
    kick()
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
          hidden: false,
          comando: false,
          comandoAcabaAoChegar: false,
          passeio: null,
          timerPasseio: null,
        }
        actors.set(pessoa.id, a)
        // Quem já estava no roster quando o app abriu começa sentado. Quem
        // chega depois foi contratado agora: entra pela porta.
        if (!primeiraCarga) {
          if (roomPhase.has(slotKey(dominio.slot))) a.hidden = true
          else iniciarEntrada(a, dominio, idx)
        } else {
          agendarPasseio(a)
        }
      } else if (!a.hidden) {
        a.dominioId = dominio.id
        const [x, y] = stationPx(dominio, idx)
        if (!unlocked.value.has(slotKey(a.slot))) {
          // A sala onde ele estava (ou para onde ia) foi arquivada. O BFS parte
          // de um slot desbloqueado, então não há rota de volta: vai direto à cadeira.
          cancelarPasseio(a)
          a.comando = false
          a.x = x
          a.y = y
          a.slot = dominio.slot
          a.route = []
          a.walking = false
          agendarPasseio(a)
        } else if (a.passeio) {
          // Quem passeia não é teleportado: a volta já leva ao posto. Se o posto
          // mudou (reassento), só troca o fim da rota de volta.
          if (a.passeio === 'voltando' && a.route.length) a.route[a.route.length - 1] = [x, y]
        } else if (!a.walking && slotKey(a.slot) === slotKey(dominio.slot)) {
          // Reassento: substituir PO, arquivar integrante ou promover o template
          // muda a ordem das cadeiras. Parado na própria sala, senta na cadeira nova.
          a.x = x
          a.y = y
        } else if (a.walking && a.comando && a.comandoAcabaAoChegar && a.route.length) {
          // Comandado de volta à cadeira enquanto ela mudou: chega na cadeira nova.
          a.route[a.route.length - 1] = [x, y]
        }
      }
      paint(a)
    }
    for (const [id, a] of [...actors]) {
      if (alive.has(id)) continue
      cancelarPasseio(a)
      actors.delete(id)
    }
  }

  // -------------------------------------------------------------------------
  // Perambular
  // -------------------------------------------------------------------------

  function sortear([min, max]: Vec2): number {
    return min + Math.random() * (max - min)
  }

  function cancelarPasseio(a: Actor) {
    if (a.timerPasseio) desagendar(a.timerPasseio)
    a.timerPasseio = null
    a.passeio = null
  }

  /** Arma a espera até o próximo passeio. Idempotente: quem já tem timer mantém o dele. */
  function agendarPasseio(a: Actor, faixa: Vec2 = PASSEIO_ESPERA_MS) {
    if (movimentoReduzido || a.comando || a.hidden || a.walking || a.passeio || a.timerPasseio) return
    const t = agendar(() => {
      if (a.timerPasseio !== t) return
      a.timerPasseio = null
      dispararPasseio(a)
    }, sortear(faixa))
    a.timerPasseio = t
  }

  /**
   * Tile livre (centro, px-fonte) de uma sala, longe de todo outro ator — de
   * onde ele está e de para onde vai. `miolo` restringe ao centro da sala:
   * visitante não fica encostado na mesa de quem mora lá.
   */
  function destinoLivre(dominio: OfficeDominio, a: Actor, miolo: boolean): Vec2 | null {
    const tiles = tilesLivres(dominio.room)
    const centrais = miolo ? tiles.filter(([x, y]) => x >= 2 && x <= ROOM_W - 3 && y >= 2 && y <= ROOM_H - 3) : tiles
    const ocupados: Vec2[] = []
    for (const o of actors.values()) {
      if (o === a || o.hidden) continue
      ocupados.push([o.x, o.y])
      if (o.route.length) ocupados.push(o.route[o.route.length - 1])
    }
    const longe = (p: Vec2, q: Vec2, px: number) => {
      const [sx, sy] = toScreen(p[0] - q[0], p[1] - q[1])
      return Math.hypot(sx, sy) >= px
    }
    const opcoes = (centrais.length ? centrais : tiles)
      .map((t) => localCenterPx(dominio.slot, t))
      .filter((p) => longe(p, [a.x, a.y], TILE) && ocupados.every((o) => longe(p, o, PASSEIO_FOLGA_PX)))
    return opcoes.length ? opcoes[Math.floor(Math.random() * opcoes.length)] : null
  }

  function dispararPasseio(a: Actor) {
    if (actors.get(a.id) !== a) return
    if (movimentoReduzido || a.comando || a.hidden || a.walking || a.passeio) return
    const casa = porPessoa.value.get(a.id)
    if (!casa) return
    const { dominio } = casa
    const chaveCasa = slotKey(dominio.slot)
    if (roomPhase.has(chaveCasa) || !unlocked.value.has(chaveCasa)) {
      agendarPasseio(a)
      return
    }

    let fora = 0
    for (const o of actors.values()) if (o.passeio) fora++
    if (fora >= Math.max(1, Math.floor(actors.size * PASSEIO_FRACAO_MAX))) {
      agendarPasseio(a, PASSEIO_REPIQUE_MS)
      return
    }

    // Parado fora de casa sem comando (mudou de domínio, comando interrompido):
    // o passeio da vez é só a volta.
    if (slotKey(a.slot) !== chaveCasa) {
      rumoACasa(a)
      return
    }

    let route: Vec2[] | null = null
    let destinoSlot: Vec2 = dominio.slot
    if (Math.random() < PASSEIO_VIZINHO) {
      const vizinhas = dominios.value.filter((d) => {
        const dx = Math.abs(d.slot[0] - dominio.slot[0])
        const dy = Math.abs(d.slot[1] - dominio.slot[1])
        return dx + dy === 1 && !roomPhase.has(slotKey(d.slot))
      })
      const vizinha = vizinhas.length ? vizinhas[Math.floor(Math.random() * vizinhas.length)] : null
      const caminho = vizinha && bfsSlots(a.slot, vizinha.slot, unlocked.value)
      const alvo = vizinha && destinoLivre(vizinha, a, true)
      if (vizinha && caminho && alvo) {
        // buildRoute força a travessia perpendicular pela porta (§4.3).
        route = buildRoute(caminho, alvo)
        destinoSlot = vizinha.slot
      }
    }
    if (!route) {
      // Sala convexa: dentro dela o caminho é a reta até o tile.
      const alvo = destinoLivre(dominio, a, false)
      if (alvo) route = [alvo]
    }
    if (!route) {
      agendarPasseio(a)
      return
    }

    a.route = route
    a.slot = destinoSlot
    a.passeio = 'indo'
    a.walking = true
    a.dist = 0
    paint(a)
    kick()
  }

  /** Rota de volta ao posto, pela porta se estiver noutra sala. */
  function rumoACasa(a: Actor) {
    const casa = porPessoa.value.get(a.id)
    if (!casa) {
      a.passeio = null
      return
    }
    const alvo = stationPx(casa.dominio, casa.idx)
    const caminho = bfsSlots(a.slot, casa.dominio.slot, unlocked.value)
    if (!caminho) {
      // Sem ligação (a sala visitada sumiu entre um passo e outro): senta direto.
      a.x = alvo[0]
      a.y = alvo[1]
      a.slot = casa.dominio.slot
      a.route = []
      a.walking = false
      a.passeio = null
      paint(a)
      agendarPasseio(a)
      return
    }
    a.route = buildRoute(caminho, alvo)
    a.slot = casa.dominio.slot
    a.passeio = 'voltando'
    a.walking = true
    a.dist = 0
    paint(a)
    kick()
  }

  /** Chamado pelo tick no frame em que a rota termina. */
  function chegou(a: Actor) {
    if (a.comando) {
      if (!a.comandoAcabaAoChegar) return // visita: fica até o próximo comando
      a.comando = false
      agendarPasseio(a)
      return
    }
    if (a.passeio === 'indo') {
      a.passeio = 'pausa'
      const t = agendar(() => {
        if (a.timerPasseio !== t) return
        a.timerPasseio = null
        if (actors.get(a.id) !== a || a.comando || a.passeio !== 'pausa') return
        rumoACasa(a)
      }, sortear(PASSEIO_PAUSA_MS))
      a.timerPasseio = t
    } else if (a.passeio === 'voltando') {
      a.passeio = null
      agendarPasseio(a)
    }
  }

  function onPreferenciaDeMovimento(e: MediaQueryListEvent) {
    movimentoReduzido = e.matches
    for (const a of actors.values()) {
      if (!movimentoReduzido) agendarPasseio(a)
      // Só a espera é cancelada: quem já está fora termina a volta ao posto.
      else if (a.timerPasseio && a.passeio !== 'pausa') {
        desagendar(a.timerPasseio)
        a.timerPasseio = null
      }
    }
  }

  /**
   * Sala nova: pan da câmera, materialização, e só então a entrada de quem
   * mora nela. Os três tempos são sequenciais de propósito — a sala não pode
   * nascer fora do enquadramento nem o ator andar dentro de uma sala invisível.
   * Sala que sai: fecha no lugar, e quem morava nela já saiu do roster
   * (syncActors remove). Primeira carga só registra: o escritório já existia
   * antes do app abrir.
   */
  function registrarSalas() {
    const { fechar, trocadas, abrir } = planejarSalas(knownRooms, dominios.value)

    for (const d of fechar) {
      const key = slotKey(d.slot)
      knownRooms.delete(key)
      roomPhase.delete(key)
      const g = novaGeracao(key)
      if (primeiraCarga) continue
      // A câmera não pode ficar presa olhando um slot que ficou vazio.
      lookPoint.value = null
      fechando.value = [...fechando.value.filter((f) => slotKey(f.slot) !== key), d]
      agendar(() => {
        if (geracao.get(key) !== g) return
        fechando.value = fechando.value.filter((f) => slotKey(f.slot) !== key)
      }, ROOM_BUILD_MS)
      kick()
    }

    // Dono novo no mesmo slot: sem fechamento, a entrada abaixo anima a sala nova.
    for (const key of trocadas) {
      knownRooms.delete(key)
      roomPhase.delete(key)
    }

    for (const d of abrir) {
      const key = slotKey(d.slot)
      knownRooms.set(key, d)
      // Duas salas com o mesmo key colidiriam no v-for do template.
      fechando.value = fechando.value.filter((f) => slotKey(f.slot) !== key)
      const g = novaGeracao(key)
      if (primeiraCarga) continue

      roomPhase.set(key, 'pending')
      lookPoint.value = localCenterPx(d.slot, [ROOM_W >> 1, ROOM_H >> 1])
      kick()

      agendar(() => {
        if (geracao.get(key) !== g) return
        roomPhase.set(key, 'building')
        agendar(() => {
          if (geracao.get(key) !== g) return
          roomPhase.delete(key)
          for (const { pessoa, dominio, idx } of porPessoa.value.values()) {
            if (slotKey(dominio.slot) !== key) continue
            const a = actors.get(pessoa.id)
            if (a?.hidden) iniciarEntrada(a, dominio, idx)
          }
        }, ROOM_BUILD_MS)
      }, ROOM_PAN_MS)
    }

    // Salas que ficaram guardam a forma nova (nome, template): se saírem
    // depois, fecham com a aparência atual.
    for (const d of dominios.value) knownRooms.set(slotKey(d.slot), d)
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
    // Contrato com o GameMap: o nome aparece em quem a câmera acompanha andando
    // por COMANDO. Sem `comando`, o PO raiz acenderia o nome a cada passeio.
    entry.root.classList.toggle('actor--focus', focused.value === a.id && a.walking && a.comando)
    // Ator de sala em obra não some do DOM (o :ref precisa dele): fica só
    // invisível até a sala terminar de nascer.
    entry.root.style.visibility = a.hidden ? 'hidden' : ''

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

    // No meio de uma rota `a.slot` já é o destino antigo: replaneja a partir da
    // sala onde o corpo está, senão o primeiro trecho atravessaria parede.
    const aqui = a.walking ? slotDoPontoPx([a.x, a.y]) : a.slot
    const origem = unlocked.value.has(slotKey(aqui)) ? aqui : a.slot
    const slotPath = bfsSlots(origem, slot, unlocked.value)
    if (!slotPath) return false

    // Sem `local`, o ator volta para a PRÓPRIA cadeira: a posição dele na
    // árvore do domínio de destino, nunca a cadeira de outra pessoa.
    const idxNoDestino = dest.pessoas.findIndex((p) => p.id === id)
    const target = local
      ? localCenterPx(slot, local)
      : stationPx(dest, idxNoDestino < 0 ? dest.pessoas.length : idxNoDestino)
    // Comando vence o passeio. Só "voltar à própria cadeira" devolve o ator ao
    // perambular ao chegar; visita o segura no destino até o próximo comando.
    cancelarPasseio(a)
    a.comando = true
    a.comandoAcabaAoChegar = !local && idxNoDestino >= 0
    a.route = buildRoute(slotPath, target)
    a.slot = slot
    a.walking = true
    a.dist = 0
    focused.value = id
    // Âncora já no início: uma rota de um passo (já está na cadeira) termina no
    // mesmo frame em que a câmera leria o ator, e ela ficaria sem alvo.
    ultimoAlvo = [a.x, a.y]
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

  /**
   * Último ponto de mundo seguido por COMANDO. A câmera fica nele quando
   * ninguém comandado anda: seguir quem passeia a faria tremer o tempo todo.
   */
  let ultimoAlvo: Vec2 | null = null

  function camTarget(): Vec2 {
    const b = bounds.value
    // Enquanto uma sala nasce não há ator para seguir: a câmera persegue um
    // ponto de mundo (o miolo do slot novo). Assim que alguém entra, volta a
    // seguir o ator.
    let ponto = lookPoint.value
    if (!ponto) {
      const a = focused.value ? actors.get(focused.value) : undefined
      if (a && a.comando && !a.hidden && (a.walking || a.route.length)) ultimoAlvo = [a.x, a.y]
      ponto = ultimoAlvo
    }
    const [sx, sy] = ponto ? toScreen(ponto[0], ponto[1]) : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]
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
        if (!a.walking) chegou(a)
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
  registrarSalas()
  syncActors()
  if (dominios.value.length) primeiraCarga = false

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
    mqMovimento?.addEventListener('change', onPreferenciaDeMovimento)
    void loadSheets()
  })

  onBeforeUnmount(() => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    for (const t of timers) clearTimeout(t)
    timers.clear()
    for (const a of actors.values()) a.timerPasseio = null
    ro?.disconnect()
    window.removeEventListener('keydown', onKey)
    mqMovimento?.removeEventListener('change', onPreferenciaDeMovimento)
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
      // Ordem importa: `registrarSalas` decide se a sala está em obra, e
      // `syncActors` usa isso para esconder quem ainda não pode entrar.
      registrarSalas()
      syncActors()
      if (dominios.value.length) primeiraCarga = false
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
      // Focar é pedido explícito de olhar: a câmera vai até ele mesmo parado.
      const a = actors.get(id)
      if (a) ultimoAlvo = [a.x, a.y]
      kick()
    },
    focused,
  }
}
