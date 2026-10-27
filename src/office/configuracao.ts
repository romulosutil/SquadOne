import type { Vec2 } from './rooms'

/** px-fonte por segundo, no mundo ortogonal. */
export const SPEED = 96
/** distância andada entre trocas de frame do ciclo de caminhada. */
export const STEP_PX = 6
export const CAM_LAMBDA = 8

/**
 * Crescimento do escritório (§4.4), na ordem em que o usuário enxerga:
 * a câmera pana até o slot vazio, a sala materializa, e só então o personagem
 * entra pela porta e anda até a mesa. Contratar um integrante pula os dois
 * primeiros passos: a sala dele já está lá.
 */
export const ROOM_PAN_MS = 700
/** Casado com `room-build` em src/index.css. */
export const ROOM_BUILD_MS = 450

/**
 * Perambular (faixas [min, max] sorteadas uniformemente). A espera longa e
 * aleatória é o que escalona: sem ela o escritório inteiro levantaria junto.
 */
export const PASSEIO_ESPERA_MS: Vec2 = [6000, 16000]
export const PASSEIO_PAUSA_MS: Vec2 = [2000, 5000]
/** Teto de gente passeando cheio: tenta de novo mais cedo, sem esperar um ciclo inteiro. */
export const PASSEIO_REPIQUE_MS: Vec2 = [2000, 6000]
/** Chance de o passeio ser até a sala vizinha em vez de dentro da própria. */
export const PASSEIO_VIZINHO = 0.2
/** No máximo esta fração dos atores fora do posto por passeio ao mesmo tempo. */
export const PASSEIO_FRACAO_MAX = 1 / 3
/**
 * Folga de tela entre o destino do passeio e qualquer outro ator (parado ou
 * indo para algum lugar): passear até o colo de alguém recria a aglomeração.
 */
export const PASSEIO_FOLGA_PX = 40


/** Enquadramento preservado da ilustração atual; coordenadas em pixels de mundo projetado. */
export const CENA_ILUSTRADA = {
  nativa: { largura: 1743, altura: 902 },
  esquerda: -652, topo: -188, largura: 1260, altura: 652, maximoDeSalas: 6,
} as const
