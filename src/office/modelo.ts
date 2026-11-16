/** Contratos da cena. Sem Vue, DOM, transporte ou escrita na operação. */
import type { Vec2, PropKind, RoomId } from './rooms'

/** Uma pessoa do squad: o PO de um domínio ou um integrante dele. */
export interface OfficePessoa {
  id: string
  nome: string
  papel: string
  /** chave no craftpix.manifest.json */
  sprite: string
  /** graus de hue-rotate, para diferenciar papéis que reusam o mesmo sprite */
  hue?: number
  /** Compatibilidade com vistas antigas; o mapa não renderiza emojis. */
  emoji?: string
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

interface CharAnim {
  file: string
  frames: number
}

export interface CharSheet {
  frameW: number
  frameH: number
  anims: Record<string, CharAnim>
}

export interface Actor {
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
