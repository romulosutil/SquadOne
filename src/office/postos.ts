/**
 * Onde cada pessoa de uma sala fica parada — puro, sem Vue nem DOM, para dar
 * para fixar em teste.
 *
 * Uma sala é um DOMÍNIO inteiro (§3.1) e o template só tem ~2 cadeiras. O
 * excedente antes caía numa lista fixa de tiles vizinhos no miolo: em
 * isométrico dois tiles vizinhos ficam a ~36px de tela e o sprite tem ~48px
 * de largura, então a partir de 4 pessoas os bonecos se sobrepunham.
 *
 * Agora o excedente é espalhado com distância medida em px de TELA (é a tela
 * que sobrepõe sprites, não o mundo), sobre uma grade de meio tile:
 *  - cadeiras do template primeiro, na ordem da árvore;
 *  - até PESSOAS_PLANEJADAS, um PLANO: busca exata do maior espaçamento em que
 *    cabem todas, depois ordenado do mais longe para o mais perto. Guloso puro
 *    gastava o miolo cedo e a 8ª pessoa caía a 32px de alguém;
 *  - dali em diante, guloso: o candidato mais longe de todos, com desempate por
 *    quantos lugares confortáveis sobram e pelo centro. O espaçamento encolhe
 *    aos poucos em vez de empilhar gente no mesmo pixel.
 *
 * Lista em PREFIXO de propósito: o posto de i só depende da sala e de i.
 * Contratar alguém nunca reassenta os outros (o reassento em useOffice é
 * teleporte, e seria visível a cada contratação).
 */

import {
  DOOR_EAST,
  DOOR_SOUTH,
  ROOM_H,
  ROOM_W,
  TILE,
  parseRoom,
  toScreen,
  type RoomId,
  type Vec2,
} from './rooms'

/** Interior útil da sala, em tiles locais (inclusive). */
const X_MIN = 1
const X_MAX = ROOM_W - 2
const Y_MIN = 1
const Y_MAX = ROOM_H - 2

/**
 * Tiles de passagem. As portas próprias ficam na parede (fora do interior),
 * mas o tile logo dentro delas é waypoint de `buildRoute`: quem parar ali
 * fica no caminho de todo mundo que atravessa. As portas dos vizinhos a oeste
 * e ao norte caem nas paredes x=0 / y=0 desta sala, espelhando as nossas.
 */
const TILES_DE_PASSAGEM: Vec2[] = [
  DOOR_EAST,
  DOOR_SOUTH,
  [DOOR_EAST[0] - 1, DOOR_EAST[1]],
  [DOOR_SOUTH[0], DOOR_SOUTH[1] - 1],
  [0, DOOR_EAST[1]],
  [1, DOOR_EAST[1]],
  [DOOR_SOUTH[0], 0],
  [DOOR_SOUTH[0], 1],
]

/**
 * Distância de tela a partir da qual dois bonecos só se cobrem de raspão
 * (sprite ~48px de largura). Acima dos ~36px de dois tiles vizinhos, que é
 * onde o miolo antigo empilhava. Usada pelo guloso depois do plano.
 */
export const DISTANCIA_CONFORTAVEL = 44

const CENTRO: Vec2 = [(X_MIN + X_MAX) / 2, (Y_MIN + Y_MAX) / 2]

function chave(x: number, y: number): string {
  return `${x},${y}`
}

function bloqueados(room: RoomId): Set<string> {
  const set = new Set<string>()
  for (const p of parseRoom(room).props) set.add(chave(p.local[0], p.local[1]))
  for (const [x, y] of TILES_DE_PASSAGEM) set.add(chave(x, y))
  return set
}

const livresCache = new Map<RoomId, Vec2[]>()

/**
 * Tiles inteiros do interior onde alguém pode parar: sem prop, sem porta, sem
 * o tile de passagem das portas. O perambular escolhe destinos daqui.
 */
export function tilesLivres(room: RoomId): Vec2[] {
  const cached = livresCache.get(room)
  if (cached) return cached
  const bl = bloqueados(room)
  const out: Vec2[] = []
  for (let y = Y_MIN; y <= Y_MAX; y++) {
    for (let x = X_MIN; x <= X_MAX; x++) if (!bl.has(chave(x, y))) out.push([x, y])
  }
  livresCache.set(room, out)
  return out
}

const candidatosCache = new Map<RoomId, Vec2[]>()

/**
 * Grade de meio tile. Local inteiro = centro do tile; x.5 = aresta entre dois
 * tiles; x.5,y.5 = quina de quatro. Regras, na ordem em que custam espaço:
 *  - passagem de porta: nem encostar. Quem para ali fica no caminho de todos;
 *  - prop: encostar vale (em pé junto à mesa), desde que ao menos metade dos
 *    tiles tocados esteja livre — senão o boneco fica no meio da mobília.
 * Exigir tiles tocados todos livres parecia mais seguro, mas com a mobília
 * atual o ROOM_DEV não comporta 8 pessoas a mais de 32px nessa regra.
 */
function candidatos(room: RoomId): Vec2[] {
  const cached = candidatosCache.get(room)
  if (cached) return cached
  const props = new Set(parseRoom(room).props.map((p) => chave(p.local[0], p.local[1])))
  const passagem = new Set(TILES_DE_PASSAGEM.map(([x, y]) => chave(x, y)))
  const out: Vec2[] = []
  for (let y2 = Y_MIN * 2; y2 <= Y_MAX * 2; y2++) {
    for (let x2 = X_MIN * 2; x2 <= X_MAX * 2; x2++) {
      const x = x2 / 2
      const y = y2 / 2
      const tocados: string[] = []
      for (const tx of new Set([Math.floor(x), Math.ceil(x)]))
        for (const ty of new Set([Math.floor(y), Math.ceil(y)])) tocados.push(chave(tx, ty))
      if (tocados.some((t) => passagem.has(t))) continue
      const livres = tocados.filter((t) => !props.has(t)).length
      if (livres * 2 < tocados.length) continue
      out.push([x, y])
    }
  }
  candidatosCache.set(room, out)
  return out
}

/** Distância em px de TELA entre dois pontos locais (em tiles). */
export function distanciaTela(a: Vec2, b: Vec2): number {
  const [sx, sy] = toScreen((a[0] - b[0]) * TILE, (a[1] - b[1]) * TILE)
  return Math.hypot(sx, sy)
}

/** Até quantas pessoas o espaçamento é garantido por busca exata, não pelo guloso. */
export const PESSOAS_PLANEJADAS = 8
/** Espaçamentos tentados, do mais folgado ao mais apertado. */
const LIMIARES_PX = [64, 56, 48, 44, 40, 36]
/** Teto de passos da busca por limiar: template esquisito não trava a tela. */
const ORCAMENTO_BUSCA = 200_000

function distanciaDoCentro(c: Vec2): number {
  return Math.hypot(c[0] - CENTRO[0], c[1] - CENTRO[1])
}

/**
 * `k` candidatos a >= `d` px entre si e das cadeiras, ou null. Backtracking
 * sobre a grade ordenada do centro para fora: o primeiro conjunto achado já
 * puxa para o miolo em vez das quinas. Determinístico (ordem estável + teto
 * de passos contado, não medido em tempo).
 */
function buscarConjunto(fixos: Vec2[], cands: Vec2[], k: number, d: number): Vec2[] | null {
  const ok = cands
    .filter((c) => fixos.every((f) => distanciaTela(c, f) >= d))
    .sort((a, b) => distanciaDoCentro(a) - distanciaDoCentro(b) || a[1] - b[1] || a[0] - b[0])
  let passos = 0
  const escolhidos: Vec2[] = []
  const rec = (inicio: number): boolean => {
    if (escolhidos.length === k) return true
    for (let i = inicio; i < ok.length; i++) {
      if (++passos > ORCAMENTO_BUSCA) return false
      if (ok.length - i < k - escolhidos.length) return false
      if (!escolhidos.every((p) => distanciaTela(p, ok[i]) >= d)) continue
      escolhidos.push(ok[i])
      if (rec(i + 1)) return true
      escolhidos.pop()
    }
    return false
  }
  return rec(0) ? escolhidos : null
}

/**
 * Ordem de entrada de um conjunto já espaçado: cada próximo é o mais longe de
 * quem já está. Assim uma sala com 3 pessoas usa os 3 pontos mais separados
 * do plano de 8, e não os 3 primeiros que a busca achou.
 */
function ordenarDoMaisLonge(fixos: Vec2[], conjunto: Vec2[]): Vec2[] {
  const resto = [...conjunto]
  const dados = [...fixos]
  const out: Vec2[] = []
  while (resto.length) {
    let melhor = 0
    let melhorMenor = -Infinity
    resto.forEach((c, i) => {
      const menor = Math.min(...dados.map((p) => distanciaTela(c, p)))
      if (menor > melhorMenor) {
        melhor = i
        melhorMenor = menor
      }
    })
    const [c] = resto.splice(melhor, 1)
    out.push(c)
    dados.push(c)
  }
  return out
}

/** Cadeiras + o excedente planejado até PESSOAS_PLANEJADAS. */
function plano(room: RoomId): Vec2[] {
  const { stations } = parseRoom(room)
  const k = PESSOAS_PLANEJADAS - stations.length
  if (k <= 0) return [...stations]
  const cands = candidatos(room)
  for (const d of LIMIARES_PX) {
    const conjunto = buscarConjunto(stations, cands, k, d)
    if (conjunto) return [...stations, ...ordenarDoMaisLonge(stations, conjunto)]
  }
  // Nem 36px cabe (sala entupida de mobília): o guloso abaixo assume tudo.
  return [...stations]
}

const postosCache = new Map<RoomId, Vec2[]>()

/**
 * Os `total` primeiros postos da sala, em tiles locais. A lista é prefixo da
 * de qualquer total maior (ver o topo do arquivo), e o cache cresce sob demanda:
 * até PESSOAS_PLANEJADAS vem do plano; dali em diante, do guloso.
 */
export function postosDaSala(room: RoomId, total: number): Vec2[] {
  const n = Math.max(0, Math.floor(total))
  let lista = postosCache.get(room)
  if (!lista) {
    lista = plano(room)
    postosCache.set(room, lista)
  }
  const { stations } = parseRoom(room)
  const cands = candidatos(room)

  while (lista.length < n) {
    const i = lista.length
    // Candidatos que ainda respeitam a distância confortável de TODOS os postos já dados.
    const abertos = cands.filter((o) => lista!.every((p) => distanciaTela(o, p) >= DISTANCIA_CONFORTAVEL))
    let melhor: Vec2 | null = null
    let melhorNota = -Infinity
    let melhorSobra = -1
    let melhorCentro = Infinity
    for (const c of cands) {
      let menor = Infinity
      for (const p of lista) {
        const d = distanciaTela(c, p)
        if (d < menor) menor = d
      }
      const nota = Math.min(menor, DISTANCIA_CONFORTAVEL)
      // Quantos lugares confortáveis sobram se este for o escolhido. Sem isso o
      // guloso gasta o miolo cedo e a 8ª pessoa já não tem onde caber longe.
      let sobra = 0
      if (nota >= DISTANCIA_CONFORTAVEL) {
        for (const o of abertos) if (distanciaTela(o, c) >= DISTANCIA_CONFORTAVEL) sobra++
      }
      const centro = distanciaDoCentro(c)
      // Igualdade exata cai no primeiro candidato da grade: determinístico.
      const ganha =
        nota > melhorNota ||
        (nota === melhorNota && (sobra > melhorSobra || (sobra === melhorSobra && centro < melhorCentro)))
      if (ganha) {
        melhor = c
        melhorNota = nota
        melhorSobra = sobra
        melhorCentro = centro
      }
    }
    if (!melhor || melhorNota < 1e-6) {
      // Sala sem candidato ou todos já ocupados (dezenas de pessoas): um passo
      // pequeno em espiral a partir do centro, para ninguém coincidir.
      const k = i - stations.length
      const ang = k * 2.399963 // ângulo áureo: pontos não se alinham
      const r = 0.15 * Math.sqrt(k + 1)
      melhor = [
        Math.min(X_MAX, Math.max(X_MIN, CENTRO[0] + Math.cos(ang) * r)),
        Math.min(Y_MAX, Math.max(Y_MIN, CENTRO[1] + Math.sin(ang) * r)),
      ]
    }
    lista.push(melhor)
  }
  return lista.slice(0, n)
}

/**
 * Posto local (tiles, pode ser fracionário) da pessoa `idx` numa sala com
 * `total` pessoas. `idx >= total` é tolerado — quem ainda não está na árvore
 * do destino (moveTo) recebe o próximo posto livre.
 */
export function postoLocal(room: RoomId, idx: number, total: number): Vec2 {
  const i = Math.max(0, Math.floor(idx))
  return postosDaSala(room, Math.max(total, i + 1))[i]
}
