<script setup lang="ts">
import { computed } from 'vue'
import type { AgendaEvent, AgendaOverview } from './types'

const props = defineProps<{ agenda: AgendaOverview | null; loading: boolean }>()

const events = computed(() => props.agenda?.state === 'connected' ? props.agenda.events : [])
const time = (event: AgendaEvent) => event.allDay
  ? 'Dia inteiro'
  : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(event.start))
const duration = (event: AgendaEvent) => {
  if (event.allDay) return ''
  const minutes = Math.max(0, Math.round((Date.parse(event.end) - Date.parse(event.start)) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`
}
</script>

<template>
  <section id="agenda" class="ops-panel ops-agenda" aria-labelledby="agenda-title">
    <div class="ops-section-heading">
      <div><span>Hoje</span><h2 id="agenda-title">Agenda</h2></div>
      <strong v-if="agenda?.state === 'connected'">{{ events.length }} compromisso{{ events.length === 1 ? '' : 's' }}</strong>
    </div>

    <p v-if="loading && !agenda" class="ops-loading" role="status">Consultando o Google Calendar…</p>

    <div v-else-if="agenda?.state === 'disconnected'" class="ops-empty ops-empty--warning" role="status">
      <span aria-hidden="true">!</span>
      <h3>Google não conectado</h3>
      <p>Abra o SquadOne e conecte sua conta para carregar a agenda do dia.</p>
      <a href="/squadone">Conectar no SquadOne</a>
    </div>

    <div v-else-if="agenda?.state === 'unavailable'" class="ops-empty ops-empty--warning" role="status">
      <span aria-hidden="true">×</span>
      <h3>Agenda indisponível</h3>
      <p>{{ agenda.message || 'O Google Calendar não respondeu agora.' }}</p>
    </div>

    <div v-else-if="agenda?.state === 'connected' && !events.length" class="ops-empty" role="status">
      <span aria-hidden="true">✓</span>
      <h3>Seu dia está livre</h3>
      <p>Nenhum compromisso foi encontrado no Google Calendar para hoje.</p>
    </div>

    <ol v-else class="ops-timeline" aria-label="Compromissos de hoje">
      <li v-for="event in events" :key="event.id">
        <time :datetime="event.start">{{ time(event) }}</time>
        <span class="ops-timeline__marker" aria-hidden="true" />
        <article>
          <div><strong>{{ event.title }}</strong><span>{{ duration(event) }}</span></div>
          <p>{{ event.location || (event.allDay ? 'Evento de dia inteiro' : 'Google Calendar') }}</p>
          <a v-if="event.htmlLink" :href="event.htmlLink" target="_blank" rel="noopener">Abrir compromisso</a>
        </article>
      </li>
    </ol>
  </section>
</template>
