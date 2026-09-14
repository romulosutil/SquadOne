/**
 * Props do escritório em pixel art isométrica, gerados como SVG inline.
 *
 * Por que gerar em vez de desenhar à mão: o isométrico 2:1 só fica coerente se
 * todo prop usar a MESMA projeção de `toScreen` (x = u - v, y = (u + v) / 2).
 * Escrevendo caixas em coordenadas de mundo e projetando aqui, mesa, planta e
 * estante batem com o losango do chão sem ajuste de olho, e a luz fica igual à
 * das paredes: face voltada para +y clara, para +x escura, topo mais claro.
 *
 * Por que data URI e não arquivo em public/: são poucos KB, nascem uma vez no
 * import e não custam request nem cache a invalidar.
 *
 * Âncora: o SVG tem PROP_SIZE[kind] de largura e altura + PE_DO_PROP. O ponto
 * (w/2, h) é o centro do tile no chão — o mesmo ponto em que useOffice ancora o
 * `.prop` (top = sy - h). O pé a mais existe porque a metade da frente do
 * losango fica ABAIXO do centro; sem ele a base do móvel seria cortada.
 */
import { PROP_SIZE, TILE_H, WALL_H, type PropKind } from './rooms'

/** Metade da altura do losango: o quanto o desenho desce abaixo da âncora. */
export const PE_DO_PROP = TILE_H / 2

type Cores = readonly [topo: string, esquerda: string, direita: string]
type Ponto3 = readonly [u: number, v: number, z: number]

const CONTORNO = '#14161f'

// Paleta curta, a mesma da UI neo-brutalista: creme, coral, amarelo, verde-água.
const CREME: Cores = ['#fbf8f0', '#e6dfcf', '#b9b09c']
const MADEIRA: Cores = ['#d49a5f', '#b27a43', '#8a5a2e']
const MADEIRA_ESCURA: Cores = ['#b98450', '#9a6a3a', '#6f4726']
const GRAFITE: Cores = ['#454a60', '#2d3142', '#1d2030']
const CORAL: Cores = ['#ff8a6a', '#ff6b4a', '#c24a30']
const AMARELO: Cores = ['#ffe27a', '#ffd23f', '#c99d1c']
const VERDE_AGUA: Cores = ['#7fdcd3', '#3fb8af', '#2a8a83']
const TERRACOTA: Cores = ['#e8845a', '#c4623a', '#933f25']
const FOLHA: Cores = ['#8ee06f', '#5fbf4a', '#3f8f37']
const AGUA: Cores = ['#d5f2fc', '#9fdcf5', '#62b3d9']

class Desenho {
  private partes: string[] = []
  constructor(
    readonly w: number,
    readonly h: number
  ) {}

  /** Mundo -> SVG, arredondado: coordenada fracionária borraria a borda. */
  private xy([u, v, z]: Ponto3): string {
    return `${Math.round(this.w / 2 + u - v)},${Math.round(this.h + (u + v) / 2 - z)}`
  }

  poligono(pts: Ponto3[], cor: string, contorno = true) {
    const traco = contorno ? '' : ' stroke="none"'
    this.partes.push(`<polygon points="${pts.map((p) => this.xy(p)).join(' ')}" fill="${cor}"${traco}/>`)
  }

  /**
   * Caixa alinhada aos eixos. Só as três faces visíveis da câmera: topo, a
   * voltada para +v (esquerda na tela) e a voltada para +u (direita na tela).
   * Ordem de pintura entre caixas é de quem chama — de trás para a frente.
   */
  caixa(u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, [topo, esq, dir]: Cores) {
    this.poligono([[u0, v1, z0], [u1, v1, z0], [u1, v1, z1], [u0, v1, z1]], esq)
    this.poligono([[u1, v0, z0], [u1, v1, z0], [u1, v1, z1], [u1, v0, z1]], dir)
    this.poligono([[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]], topo)
  }

  /** Retângulo pintado sobre uma face de v constante (detalhe, sem contorno). */
  naFaceV(v: number, u0: number, u1: number, z0: number, z1: number, cor: string) {
    this.poligono([[u0, v, z0], [u1, v, z0], [u1, v, z1], [u0, v, z1]], cor, false)
  }

  /**
   * Retângulo sobre a face da parede norte, em (t ao longo da parede, z de
   * altura). A parede sai do canto esquerdo do SVG e desce para a direita.
   */
  naParede(t0: number, t1: number, z0: number, z1: number, cor: string, contorno = true) {
    const p = (t: number, z: number) => `${t},${Math.round(this.h + t / 2 - z)}`
    const traco = contorno ? '' : ' stroke="none"'
    this.partes.push(
      `<polygon points="${p(t0, z0)} ${p(t1, z0)} ${p(t1, z1)} ${p(t0, z1)}" fill="${cor}"${traco}/>`
    )
  }

  uri(): string {
    const alto = this.h + PE_DO_PROP
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${alto}" viewBox="0 0 ${this.w} ${alto}" shape-rendering="crispEdges">` +
      `<g stroke="${CONTORNO}" stroke-width="1" stroke-linejoin="miter">${this.partes.join('')}</g></svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
  }
}

function novo(kind: PropKind): Desenho {
  const [w, h] = PROP_SIZE[kind]
  return new Desenho(w, h)
}

/** Mesa com monitor virado para +v, onde fica a cadeira nos templates. */
function mesa(): string {
  const d = novo('desk')
  d.caixa(-15, -12, -12, 12, 0, 14, MADEIRA_ESCURA)
  d.caixa(3, 15, -12, 12, 0, 14, MADEIRA_ESCURA)
  d.naFaceV(12, 6, 12, 9, 11, '#4a3020')
  d.naFaceV(12, 6, 12, 3, 5, '#4a3020')
  d.caixa(-16, 16, -13, 13, 14, 17, MADEIRA)
  d.caixa(-2, 2, -9, -6, 17, 20, GRAFITE)
  d.caixa(-11, 11, -10, -7, 20, 34, GRAFITE)
  d.naFaceV(-7, -9, 9, 22, 32, '#6fe3f0')
  d.naFaceV(-7, -7, 3, 28, 30, '#1f7f96')
  d.naFaceV(-7, -7, 6, 24, 26, '#1f7f96')
  d.caixa(-7, 5, -1, 4, 17, 18, CREME)
  d.caixa(9, 12, -3, 0, 17, 22, CORAL)
  return d.uri()
}

/** Cadeira de escritório; o encosto fica atrás de quem senta (-u). */
function cadeira(): string {
  const d = novo('chair')
  d.caixa(-5, 5, -5, 5, 0, 2, GRAFITE)
  d.caixa(-1, 1, -1, 1, 2, 8, GRAFITE)
  d.caixa(-7, 7, -7, 7, 8, 11, CORAL)
  d.caixa(-7, -4, -7, 7, 11, 24, CORAL)
  return d.uri()
}

function planta(): string {
  const d = novo('plant')
  d.caixa(-7, 7, -7, 7, 0, 11, TERRACOTA)
  d.caixa(-8, 8, -8, 8, 11, 14, TERRACOTA)
  // Folhagem em tufos, de trás para a frente; o topo por último porque é o mais alto.
  d.caixa(-7, 0, -7, 0, 18, 28, FOLHA)
  d.caixa(0, 7, -7, 0, 15, 25, FOLHA)
  d.caixa(-7, 0, 0, 7, 15, 25, FOLHA)
  d.caixa(0, 7, 0, 7, 14, 22, FOLHA)
  d.caixa(-3, 3, -3, 3, 28, 36, FOLHA)
  return d.uri()
}

/**
 * Janela na parede norte. O '=' fica na linha de parede do template, então a
 * janela é pintada NA face da parede (WALL_H de altura), não como caixa no chão.
 */
function vidro(): string {
  const d = novo('glass')
  const alturaMax = WALL_H - 4
  d.naParede(3, 29, 6, 9, '#c9bfa8')
  d.naParede(5, 27, 9, Math.min(34, alturaMax), '#f4f0e6')
  d.naParede(8, 24, 12, 31, '#9fdcf5', false)
  d.naParede(15, 17, 12, 31, '#f4f0e6', false)
  d.naParede(8, 24, 21, 23, '#f4f0e6', false)
  d.naParede(9, 11, 24, 30, '#ffffff', false)
  d.naParede(19, 21, 13, 17, '#ffffff', false)
  return d.uri()
}

/** Estante encostada na parede de trás (-v), aberta para a câmera. */
function estante(): string {
  const d = novo('shelf')
  d.caixa(-14, 14, -14, -4, 0, 44, MADEIRA_ESCURA)
  d.naFaceV(-4, -12, 12, 2, 42, '#3a2618')
  d.naFaceV(-4, -12, 12, 15, 17, MADEIRA_ESCURA[1])
  d.naFaceV(-4, -12, 12, 29, 31, MADEIRA_ESCURA[1])
  const livros: [number, number, number, number, string][] = [
    [-11, -8, 2, 12, CORAL[1]],
    [-8, -5, 2, 11, AMARELO[1]],
    [-5, -2, 2, 13, VERDE_AGUA[1]],
    [1, 4, 2, 10, CREME[0]],
    [6, 11, 2, 5, CORAL[1]],
    [6, 11, 5, 8, AMARELO[1]],
    [-10, -7, 17, 27, VERDE_AGUA[1]],
    [-7, -4, 17, 26, '#8a7cff'],
    [2, 5, 17, 28, CORAL[1]],
    [5, 8, 17, 25, AMARELO[1]],
    [-11, -5, 31, 34, CREME[0]],
    [-11, -5, 34, 37, CORAL[1]],
    [4, 7, 31, 41, AMARELO[1]],
    [7, 10, 31, 40, VERDE_AGUA[1]],
  ]
  for (const [u0, u1, z0, z1, cor] of livros) d.naFaceV(-4, u0, u1, z0, z1, cor)
  return d.uri()
}

function bebedouro(): string {
  const d = novo('cooler')
  d.caixa(-5, 5, -5, 5, 0, 20, CREME)
  d.naFaceV(5, -3, -1, 12, 15, CORAL[1])
  d.naFaceV(5, 1, 3, 12, 15, '#3f8fd8')
  d.caixa(-4, 4, -4, 4, 20, 34, AGUA)
  d.naFaceV(4, -3, -2, 22, 32, '#ffffff')
  d.caixa(-2, 2, -2, 2, 34, 36, ['#6fb0f0', '#3f8fd8', '#2a64a0'])
  return d.uri()
}

/** Sofá de um tile, encosto em -u; os braços cercam os assentos. */
function sofa(): string {
  const d = novo('sofa')
  d.caixa(-12, 12, -14, 14, 0, 9, VERDE_AGUA)
  d.caixa(-12, -6, -14, 14, 9, 24, VERDE_AGUA)
  d.caixa(-6, 12, -14, -10, 9, 17, VERDE_AGUA)
  d.caixa(-6, 12, -10, 0, 9, 12, VERDE_AGUA)
  d.caixa(-6, 12, 0, 10, 9, 12, VERDE_AGUA)
  d.caixa(-6, -3, -8, -1, 12, 20, AMARELO)
  d.caixa(-6, 12, 10, 14, 9, 17, VERDE_AGUA)
  return d.uri()
}

/** Um data URI por tipo, gerado uma vez no import. */
export const PROP_SPRITE: Record<PropKind, string> = {
  desk: mesa(),
  chair: cadeira(),
  plant: planta(),
  glass: vidro(),
  shelf: estante(),
  cooler: bebedouro(),
  sofa: sofa(),
}

/**
 * A janela mora na linha de parede, meio tile ATRÁS da face da parede: pela
 * profundidade calculada em useOffice ela ficaria escondida pela própria
 * parede. O viés a põe na frente da parede e ainda atrás de quem pisa no tile
 * logo abaixo (diferença de 32 na diagonal; 24 sobra folga dos dois lados).
 */
export const VIES_Z: Partial<Record<PropKind, number>> = { glass: 24 }
