/**
 * Squad ativa desta aba. Conveniência do browser, não estado do servidor: as
 * rotas recebem `squadId` a cada chamada. `localStorage` pode lançar (modo
 * privado, storage bloqueado) — sem ele a escolha só não sobrevive ao reload.
 */
const CHAVE = 'squadone:squadAtiva'

export function lerSquadAtiva(): string | null {
  try {
    return localStorage.getItem(CHAVE)
  } catch {
    return null
  }
}

export function gravarSquadAtiva(id: string): void {
  try {
    localStorage.setItem(CHAVE, id)
  } catch {
    // Sem storage: a escolha vale até o próximo reload.
  }
}
