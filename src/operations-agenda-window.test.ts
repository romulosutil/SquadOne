import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { upcomingAgendaEvents } from './operations/agenda-window.ts'
import type { AgendaEvent } from './operations/types.ts'

const event = (hour: number): AgendaEvent => ({
  id: String(hour),
  title: `Evento ${hour}`,
  start: `2026-09-17T${String(hour).padStart(2, '0')}:00:00-03:00`,
  end: `2026-09-17T${String(hour + 1).padStart(2, '0')}:00:00-03:00`,
  allDay: false,
})

describe('janela da agenda operacional', () => {
  it('mantém cinco eventos e avança quando o tempo passa', () => {
    const events = [9, 10, 11, 12, 13, 14, 15].map(event)

    assert.deepEqual(
      upcomingAgendaEvents(events, Date.parse('2026-09-17T09:30:00-03:00')).map(item => item.id),
      ['9', '10', '11', '12', '13'],
    )
    assert.deepEqual(
      upcomingAgendaEvents(events, Date.parse('2026-09-17T12:30:00-03:00')).map(item => item.id),
      ['12', '13', '14', '15'],
    )
  })
})
