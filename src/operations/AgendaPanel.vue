<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AgendaEvent, AgendaOverview } from './types'
import { upcomingAgendaEvents } from './agenda-window'

const props = defineProps<{ agenda: AgendaOverview | null; loading: boolean }>()

const events = computed(() => props.agenda?.state === 'connected' ? props.agenda.events : [])
const clock = ref(Date.now())
let clockTimer = 0
const upcomingEvents = computed(() => upcomingAgendaEvents(events.value, clock.value, Number.MAX_SAFE_INTEGER))
const visibleEvents = computed(() => upcomingEvents.value.slice(0, 5))
const laterCount = computed(() => Math.max(0, upcomingEvents.value.length - visibleEvents.value.length))
const today = new Date()
const dayLabel = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(today).replace('.', '')
const dayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const reservedMinutes = computed(() => events.value.reduce((total, event) => {
  if (event.allDay) return total
  return total + Math.max(0, Math.round((Date.parse(event.end) - Date.parse(event.start)) / 60_000))
}, 0))
const reservedLabel = computed(() => {
  const hours = Math.floor(reservedMinutes.value / 60)
  const minutes = reservedMinutes.value % 60
  if (!hours) return `${minutes} min reservados`
  return minutes ? `${hours}h${String(minutes).padStart(2, '0')} reservadas` : `${hours}h reservadas`
})
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

onMounted(() => {
  clockTimer = window.setInterval(() => { clock.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => window.clearInterval(clockTimer))
</script>

<template>
  <section id="agenda" class="ops-panel ops-agenda" aria-labelledby="agenda-title">
    <div class="ops-section-heading">
      <div><h2 id="agenda-title">Agenda</h2></div>
      <time class="ops-date-chip" :datetime="dayIso">Hoje · {{ dayLabel }}</time>
    </div>

    <div v-if="agenda?.state === 'connected'" class="ops-agenda-summary">
      <strong>{{ visibleEvents.length }} próximo{{ visibleEvents.length === 1 ? '' : 's' }}<template v-if="laterCount"> · +{{ laterCount }} depois</template></strong>
      <span>{{ reservedLabel }}</span>
    </div>

    <p v-if="loading && !agenda" class="ops-loading" role="status">Consultando o Google Calendar…</p>

    <div v-else-if="agenda?.state === 'disconnected'" class="ops-empty ops-empty--warning" role="status">
      <span aria-hidden="true">!</span>
      <h3>Google não conectado</h3>
      <p>Autorize o Google no app local para carregar a agenda do dia nesta Central.</p>
      <a href="/api/auth/google">Conectar calendário</a>
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

    <div v-else-if="agenda?.state === 'connected' && !visibleEvents.length" class="ops-empty" role="status">
      <span aria-hidden="true">✓</span>
      <h3>Agenda concluída</h3>
      <p>Todos os compromissos de hoje já terminaram.</p>
    </div>

    <ol v-else class="ops-timeline" aria-label="Próximos cinco compromissos" aria-live="polite">
      <li v-for="event in visibleEvents" :key="event.id">
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
