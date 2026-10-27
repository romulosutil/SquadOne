import type { FaseDoEscritorio } from './jornada-do-escritorio'
import type { OfficeDominio } from './modelo'
import type { Vec2 } from './rooms'

export const PONTOS_DA_ESTEIRA: Record<FaseDoEscritorio, [number, number]> = {
  // Bordas frontais das seis mesas da ilustração, no mesmo sistema de coordenadas do cenário.
  1: [235, 174], 2: [20, 100], 3: [-330, 220],
  4: [-150, 175], 5: [80, 265], 6: [-95, 350],
}
/** Corredores separados: Contato não atravessa a estação Material antes de Conversa. */
export function trajetoDaEsteira(de: FaseDoEscritorio, para: FaseDoEscritorio, pontos = PONTOS_DA_ESTEIRA): [number, number][] {
  const corredores: Partial<Record<FaseDoEscritorio, [number, number][]>> = pontos === PONTOS_DA_ESTEIRA ? {
    3: [[-120,70],[-250,135],[-340,180]],
    4: [[-260,230],[-180,200]],
  } : {}
  if(de === para) return [pontos[para]]
  if(de > para) return trajetoDaEsteira(para,de,pontos).reverse()
  const caminho: [number, number][] = [pontos[de]]
  for(let i=de+1;i<=para;i++) caminho.push(...(corredores[i as FaseDoEscritorio] ?? []),pontos[i as FaseDoEscritorio])
  return caminho
}
/** Os pontos do cenário são projetados; o movimento dos atores usa o mundo ortogonal. */
export function pontoDaEsteiraNoMundo(fase: FaseDoEscritorio, pontos = PONTOS_DA_ESTEIRA): [number, number] {
  return pontoProjetadoNoMundo(pontos[fase])
}

export function pontoProjetadoNoMundo([x, y]: Vec2): Vec2 { return [y + x / 2, y - x / 2] }

/** A ilustração usa âncoras fixas; a planta dinâmica usa os postos observados no roster. */
export function pontosDasEstacoes(ilustrado: boolean, dominios: readonly OfficeDominio[], posto: (id: string) => Vec2 | null): Record<FaseDoEscritorio, Vec2> {
  if (ilustrado) return PONTOS_DA_ESTEIRA
  const pontos = { ...PONTOS_DA_ESTEIRA }
  for (const fase of [1, 2, 3, 4, 5, 6] as const) {
    const pessoa = dominios[(fase - 1) % Math.max(1, dominios.length)]?.pessoas[0]
    const posicao = pessoa && posto(pessoa.id)
    if (posicao) { const [x, y] = posicao; pontos[fase] = [x - y, (x + y) / 2 + 32] }
  }
  return pontos
}
