import type { AgendaEvent } from './types'

export function upcomingAgendaEvents(events: AgendaEvent[], now: number, limit = 5): AgendaEvent[] {
  return [...events]
    .filter(event => Date.parse(event.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, Math.max(0, limit))
}
