import type { QuestCalendario } from './types'

/**
 * Primeiro e último dia de um evento de dia inteiro, como datas LOCAIS.
 * `fim` do Google é exclusivo (evento só de 16/09 termina em 17/09), e
 * "AAAA-MM-DD" puro o `new Date` leria como meia-noite UTC — dia anterior
 * em -03:00. Por isso monta pelas partes.
 */
export function diasDoEventoDiaInteiro(inicio: string, fim: string): { primeiro: Date; ultimo: Date } {
  const [a, m, d] = inicio.split('-').map(Number)
  const [a2, m2, d2] = fim.split('-').map(Number)
  const primeiro = new Date(a, m - 1, d)
  const ultimo = new Date(a2, m2 - 1, d2 - 1)
  return { primeiro, ultimo: ultimo > primeiro ? ultimo : primeiro }
}

export type InfoDePrazo =
  | { papel: 'bloco'; posicao: number; total: number; marco: QuestCalendario | null }
  | { papel: 'marco'; blocos: number }
  // String e não null: sem strictNullChecks (tsconfig do projeto) `null` não
  // discrimina a união e o template não conseguiria ler `posicao`.
  | { papel: 'nenhum' }

/**
 * Como uma quest se liga a um prazo, derivado da LISTA atual e não de um
 * contador gravado: bloco apagado no Google some da contagem na próxima leitura.
 * A contagem só enxerga o que a Mochila leu (7 dias para trás, 90 para frente).
 */
export function infoDePrazo(quest: QuestCalendario, quests: QuestCalendario[]): InfoDePrazo {
  if (quest.prazoRef) {
    const irmaos = quests
      .filter((q) => q.prazoRef === quest.prazoRef)
      .sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio))
    return {
      papel: 'bloco',
      posicao: irmaos.findIndex((q) => q.eventId === quest.eventId) + 1,
      total: irmaos.length,
      marco: quests.find((q) => q.eventId === quest.prazoRef) ?? null,
    }
  }
  const blocos = quests.filter((q) => q.prazoRef === quest.eventId).length
  return blocos > 0 ? { papel: 'marco', blocos } : { papel: 'nenhum' }
}
