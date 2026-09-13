/**
 * Diferença entre as salas que o escritório conhece e as do roster atual
 * (spec Fase 2 §8). Função pura para ser testável fora do Vue: useOffice só
 * aplica o resultado (fases, timers, câmera).
 *
 * Por que comparar DONO e não só slot: com arquivamento um slot esvazia e pode
 * voltar ocupado por outro domínio. Um conjunto de slots que nunca esquece
 * (o `knownRooms` antigo) fazia a sala nova nascer sem obra.
 */

import { slotKey } from './rooms'

export interface MudancaDeSalas<D> {
  /** Saíram do roster (domínio arquivado): fecham com animação. */
  fechar: D[]
  /** Slots cujo dono mudou numa leitura só: não fecham, a sala nova já anima. */
  trocadas: string[]
  /** Entraram (sala nova, reativada ou dono novo): obra. */
  abrir: D[]
}

export function planejarSalas<D extends { id: string; slot: [number, number] }>(
  conhecidas: ReadonlyMap<string, D>,
  atuais: readonly D[]
): MudancaDeSalas<D> {
  const porSlot = new Map(atuais.map((d) => [slotKey(d.slot), d]))
  const fechar: D[] = []
  const trocadas: string[] = []
  for (const [chave, anterior] of conhecidas) {
    const atual = porSlot.get(chave)
    if (!atual) fechar.push(anterior)
    else if (atual.id !== anterior.id) trocadas.push(chave)
  }
  const abrir = atuais.filter((d) => conhecidas.get(slotKey(d.slot))?.id !== d.id)
  return { fechar, trocadas, abrir }
}
