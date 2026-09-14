import type { EventoAjustado, RespostaDeAjuste } from './types'

/** Sem Vue para ser verificável com tsx. */

/** Mesmo formato do servidor (`server/agendamento.ts`). */
export function formatarMinutos(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** Toast depois de aprovar: o que mudou no Google, mais os avisos do servidor. */
export function resumoDoAjuste(r: RespostaDeAjuste): string {
  const partes: string[] = []
  const hora = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (r.alvo === 'duracao' && r.eventos[0]) {
    const e = r.eventos[0]
    partes.push(
      e.acao === 'movido'
        ? `Bloco movido para ${new Date(e.inicio).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
        : `Bloco ${e.acao} até ${hora(e.fim)}`
    )
  }
  if (r.alvo === 'esforco') {
    const conta = (acao: EventoAjustado['acao']) => r.eventos.filter((e) => e.acao === acao).length
    if (conta('criado')) partes.push(`${conta('criado')} bloco(s) criado(s)`)
    if (conta('encurtado')) partes.push(`${conta('encurtado')} bloco(s) encurtado(s)`)
  }
  partes.push(...r.avisos)
  return partes.join(' · ') || 'Nada mudou'
}
