/**
 * PURO (o storage entra por parâmetro): Lista ou Mapa no Escritório, e a
 * escala inteira do mapa.
 *
 * Lista é o padrão no celular: o mapa isométrico de 9 salas não cabe legível
 * em 390 px e custa bateria; no desktop o mapa é o padrão. A escolha do usuário
 * vence e fica no `localStorage` — que pode lançar (modo privado, storage
 * bloqueado), por isso o try/catch: sem ele a escolha só não sobrevive ao reload.
 */

export type VistaDoEscritorio = 'lista' | 'mapa'

export const CHAVE_DA_VISTA = 'squadone:escritorio:vista'

/** Só o necessário de `Storage`: os testes passam um objeto qualquer. */
export interface Guardador {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
}

export function lerVistaGuardada(storage: Guardador | null | undefined): VistaDoEscritorio | null {
  try {
    const v = storage?.getItem(CHAVE_DA_VISTA)
    return v === 'lista' || v === 'mapa' ? v : null
  } catch {
    return null
  }
}

export function gravarVista(storage: Guardador | null | undefined, vista: VistaDoEscritorio): void {
  try {
    storage?.setItem(CHAVE_DA_VISTA, vista)
  } catch {
    // Sem storage: a escolha vale até o próximo reload.
  }
}

/** A guardada vence; sem ela, mapa só em tela larga. */
export function vistaInicial(guardada: VistaDoEscritorio | null, telaLarga: boolean): VistaDoEscritorio {
  return guardada ?? (telaLarga ? 'mapa' : 'lista')
}

export const ESCALA_MAXIMA = 3

/**
 * Maior escala INTEIRA em que o andar inteiro cabe no viewport. Pixel art em
 * escala fracionária borra (cada pixel do sprite cai entre dois da tela); por
 * isso nunca 1,5. Andar maior que o viewport fica em 1 e a câmera recorta.
 */
export function escalaInteira(viewport: { w: number; h: number }, mundo: { w: number; h: number }, max = ESCALA_MAXIMA): number {
  if (!(mundo.w > 0) || !(mundo.h > 0) || !(viewport.w > 0) || !(viewport.h > 0)) return 1
  const cabe = Math.floor(Math.min(viewport.w / mundo.w, viewport.h / mundo.h))
  return Math.max(1, Math.min(max, cabe))
}
