/**
 * Loop e câmera do escritório — spec §4.1 / §4.2, em projeção isométrica.
 *
 * Um único requestAnimationFrame para todos os atores + a câmera. O loop para
 * sozinho quando ninguém anda (`raf = busy ? rAF(tick) : 0`). Idle/working é
 * CSS puro, sem gastar rAF.
 *
 * Três requisitos não-cosméticos de §4.2, mantidos na versão isométrica:
 *  1. Math.round() nas coordenadas — agora nas de TELA, que são as que viram px.
 *  2. Renderizador DOM escreve transform direto (ref() = 60 re-renders/s).
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
import { carregarCatalogoSprites } from './catalogoSprites'
import type { Actor, CharSheet, OfficeDominio, OfficePessoa, RoomView, RoomPhase } from './modelo'
export type { CharSheet, OfficeDominio, OfficePessoa, RoomView, RoomPhase } from './modelo'
import { ROOM_PAN_MS, ROOM_BUILD_MS, PASSEIO_ESPERA_MS, PASSEIO_PAUSA_MS, PASSEIO_REPIQUE_MS, PASSEIO_VIZINHO, PASSEIO_FRACAO_MAX, PASSEIO_FOLGA_PX } from './configuracao'
import { projetarSala } from './geometria-da-cena'
import { advance } from './simulacao'
import { clampAxis, avancarCamera } from './camera'
import { quadroDoAtor, type CriarRenderizadorDoEscritorio } from './renderizador'
import { criarRenderizadorDom } from './renderizador-dom'

import { DOOR_SOUTH, ROOM_H, ROOM_W, TILE, isoBounds, localCenterPx, mapSizeTiles, slotKey, toScreen, type Vec2 } from './rooms'
import { bfsSlots, buildRoute, doorCenterPx, slotDoPontoPx } from './path'
import { postoLocal, tilesLivres } from './postos'
import { planejarSalas } from './salas'

export function useOffice(dominios: Ref<OfficeDominio[]>, movimento?: Ref<boolean | null>, margemSuperior?: Ref<number>, passeiosPermitidos?: Ref<boolean>, criarRenderizador: CriarRenderizadorDoEscritorio = criarRenderizadorDom) {
  const renderizador = criarRenderizador()
  let desmontado = false
  // Setters em vez de refs expostos: no template um ref é auto-unwrapped, então
  // `:ref="worldRef"` passaria null em vez do objeto ref.
  const viewportRef = shallowRef<HTMLElement | null>(null)

  function setViewportEl(el: unknown) {
    viewportRef.value = (el as HTMLElement | null) ?? null
  }

  function setWorldEl(el: unknown) {
    renderizador.ligarMundo((el as HTMLElement | null) ?? null)
    applyCamera()
  }

  /**
   * SCALE aparece em UM lugar: o transform de .world. Sempre inteiro (pixel art
   * em escala fracionária borra); quem escolhe é o GameMap, pelo encaixe do
   * andar no viewport ou pelos botões. Antes a tecla Tab alternava 1 <-> 2 e
   * roubava o Tab da página inteira: quem navega por teclado ficava preso.
   */
  const scale = ref(1)

  /**
   * Loop pausado: aba em segundo plano (visibilitychange) ou mapa fora da tela
   * (IntersectionObserver). Nem rAF nem passeio rodam: ninguém está vendo, e o
   * celular agradece a bateria. Ao voltar, a câmera encaixa e o loop retoma.
   */
  const pausado = ref(false)
  let abaOculta = typeof document !== 'undefined' ? document.hidden : false
  let foraDaTela = false

  /** Sem manifesto, a UI mantém o lugar do personagem e informa a falha. */
  const sheets = shallowRef<Record<string, CharSheet> | null>(null)
  const erroSprites = ref('')

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
  let movimentoReduzido = movimento?.value != null ? !movimento.value : mqMovimento?.matches ?? false

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
  const bounds = computed(() => {
    const margem = margemSuperior?.value ?? 0
    const b = isoBounds(margem ? Math.max(480, mapPx.value[0]) : mapPx.value[0], margem ? Math.max(512, mapPx.value[1]) : mapPx.value[1])
    return { ...b, minY: b.minY - margem }
  })

  const rooms = computed<RoomView[]>(() => [
    ...dominios.value.map(d => projetarSala(d, roomPhase.get(slotKey(d.slot)) ?? null, unlocked.value)),
    ...fechando.value.map(d => projetarSala(d, 'closing', unlocked.value)),
  ])

  // -------------------------------------------------------------------------
  // Atores
  // -------------------------------------------------------------------------

  /** Fora do sistema de reatividade de propósito: o tick escreve no DOM direto. */
  const actors = new Map<string, Actor>()
  const chegadasDePercurso = new Map<string, (concluiu: boolean) => void>()
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
          agendarPasseio(a, [1200, 5000])
        }
      } else if (!a.hidden) {
        a.dominioId = dominio.id
        const [x, y] = stationPx(dominio, idx)
        if (!unlocked.value.has(slotKey(a.slot))) {
          // A sala onde ele estava (ou para onde ia) foi arquivada. O BFS parte
          // de um slot desbloqueado, então não há rota de volta: vai direto à cadeira.
          cancelarPercurso(a.id)
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
      const finalizar=chegadasDePercurso.get(id)
      chegadasDePercurso.delete(id)
      finalizar?.(false)
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
    if (passeiosPermitidos?.value === false || movimentoReduzido || a.comando || a.hidden || a.walking || a.passeio || a.timerPasseio) return
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
    if (passeiosPermitidos?.value === false || movimentoReduzido || a.comando || a.hidden || a.walking || a.passeio) return
    // Ninguém vendo: não sai do lugar, só tenta de novo mais tarde.
    if (pausado.value) {
      agendarPasseio(a)
      return
    }
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
    const finalizar = chegadasDePercurso.get(a.id)
    if (finalizar) {
      chegadasDePercurso.delete(a.id)
      a.comando = false
      finalizar(true)
      return
    }
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
    aplicarMovimento(movimento?.value != null ? !movimento.value : e.matches)
    kick()
  }
  function aplicarMovimento(reduzido: boolean) {
    movimentoReduzido = reduzido
    for (const a of actors.values()) {
      if (!movimentoReduzido) agendarPasseio(a)
      // Só a espera é cancelada: quem já está fora termina a volta ao posto.
      else if (a.timerPasseio && a.passeio !== 'pausa') {
        desagendar(a.timerPasseio)
        a.timerPasseio = null
      }
    }
  }

  if (movimento) watch(movimento, valor => {
    aplicarMovimento(valor === null ? mqMovimento?.matches ?? false : !valor)
    kick()
  })

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
    renderizador.ligarAtor(id, (el as HTMLElement | null) ?? null)
    const a = actors.get(id)
    if (a) paint(a)
  }

  function refreshSpriteEls() {
    renderizador.atualizarSprites()
    for (const a of actors.values()) paint(a)
  }

  function paint(a: Actor) {
    if (desmontado) return
    renderizador.pintarAtor(quadroDoAtor(a, sheetOf(a.id), focused.value, porPessoa.value.get(a.id)?.pessoa.hue))
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
    const anterior = chegadasDePercurso.get(id)
    chegadasDePercurso.delete(id)
    anterior?.(false)

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

  /** Percurso de uma passagem já registrada. Reusa caminhada e profundidade, sem puxar a câmera. */
  function percorrer(id: string, pontos: Vec2[], aoChegar: (concluiu: boolean) => void): boolean {
    const a = actors.get(id)
    if (!a || a.hidden || a.comando || movimentoReduzido || !pontos.length || pontos.some(p => p.some(v => !Number.isFinite(v)))) return false
    cancelarPasseio(a)
    a.comando = true
    a.comandoAcabaAoChegar = false
    a.route = pontos.map(p => [...p] as Vec2)
    a.walking = true
    a.dist = 0
    chegadasDePercurso.set(id, aoChegar)
    kick()
    return true
  }
  function postoDaPessoa(id: string): Vec2 | null {
    const entrada = porPessoa.value.get(id)
    return entrada ? stationPx(entrada.dominio, entrada.idx) : null
  }
  function cancelarPercurso(id: string) {
    const finalizar = chegadasDePercurso.get(id), a = actors.get(id), posto = postoDaPessoa(id)
    if (!finalizar || !a) return
    chegadasDePercurso.delete(id)
    a.route = []; a.walking = false; a.comando = false
    if (posto) [a.x, a.y] = posto
    paint(a)
    finalizar(false)
    kick()
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

  /**
   * Último ponto de mundo seguido por COMANDO. A câmera fica nele quando
   * ninguém comandado anda: seguir quem passeia a faria tremer o tempo todo.
   */
  let ultimoAlvo: Vec2 | null = null
  let percursoAcompanhado: string | null = null

  function camTarget(): Vec2 {
    const b = bounds.value
    // Enquanto uma sala nasce não há ator para seguir: a câmera persegue um
    // ponto de mundo (o miolo do slot novo). Assim que alguém entra, volta a
    // seguir o ator.
    let ponto = lookPoint.value
    if (!ponto) {
      const id = percursoAcompanhado ?? focused.value
      const a = id ? actors.get(id) : undefined
      if (a && a.comando && (percursoAcompanhado === a.id || !chegadasDePercurso.has(a.id)) && !a.hidden && (a.walking || a.route.length)) ultimoAlvo = [a.x, a.y]
      ponto = ultimoAlvo
    }
    const [sx, sy] = ponto ? toScreen(ponto[0], ponto[1]) : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]
    return [
      clampAxis(sx - view.w / 2, b.minX, b.maxX, view.w),
      clampAxis(sy - view.h / 2, b.minY, b.maxY, view.h),
    ]
  }

  function applyCamera() {
    renderizador.pintarCamera({ ...cam, escala: scale.value })
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

  function tick(now: number) {
    if (desmontado) return
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

    if (avancarCamera(cam, camTarget(), dt, movimentoReduzido)) busy = true
    applyCamera()

    // o loop para sozinho quando ninguém anda
    renderizador.terminarQuadro?.(now)
    raf = busy || renderizador.continuo ? requestAnimationFrame(tick) : 0
  }

  function kick() {
    if (desmontado || raf || pausado.value) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function atualizarPausa() {
    const agora = abaOculta || foraDaTela
    if (agora === pausado.value) return
    pausado.value = agora
    if (agora) {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      return
    }
    // Voltou: o layout pode ter mudado enquanto ninguém olhava.
    snapCamera()
    kick()
  }

  function onVisibilidade() {
    abaOculta = document.hidden
    atualizarPausa()
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  let ro: ResizeObserver | null = null
  let io: IntersectionObserver | null = null

  async function loadSheets() {
    erroSprites.value = ''
    try { sheets.value = await carregarCatalogoSprites() }
    catch { erroSprites.value = 'Os sprites não carregaram. As salas continuam disponíveis pela lista.' }
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
    if (viewportRef.value && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entradas) => {
        foraDaTela = !entradas.some((e) => e.isIntersecting)
        atualizarPausa()
      })
      io.observe(viewportRef.value)
    }
    document.addEventListener('visibilitychange', onVisibilidade)
    mqMovimento?.addEventListener('change', onPreferenciaDeMovimento)
    atualizarPausa()
    void loadSheets()
  })

  onBeforeUnmount(() => {
    desmontado = true
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    renderizador.destruir()
    for (const t of timers) clearTimeout(t)
    timers.clear()
    chegadasDePercurso.clear()
    for (const a of actors.values()) a.timerPasseio = null
    ro?.disconnect()
    io?.disconnect()
    document.removeEventListener('visibilitychange', onVisibilidade)
    mqMovimento?.removeEventListener('change', onPreferenciaDeMovimento)
  })

  watch(sheets, () => {
    // o v-if troca o nó do sprite; repinta depois que o DOM assentar
    requestAnimationFrame(refreshSpriteEls)
  })

  watch(scale, () => {
    measure()
    // Escala nova muda o que cabe: a câmera encaixa já, sem esperar alguém andar.
    snapCamera()
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
    erroSprites,
    carregarSprites: loadSheets,
    pessoas,
    rooms,
    bounds,
    setActorEl,
    moveTo,
    percorrer,
    postoDaPessoa,
    cancelarPercurso,
    olharParaPonto: (ponto: Vec2) => { percursoAcompanhado=null;lookPoint.value=[...ponto];snapCamera();kick() },
    seguirPercurso: (id: string | null) => { percursoAcompanhado=id;if(id)lookPoint.value=null;kick() },
    pausado,
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
