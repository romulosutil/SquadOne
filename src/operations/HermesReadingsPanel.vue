<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { HermesReading } from './types'

const props = withDefaults(defineProps<{ compact?: boolean; projectId?: string; title?: string }>(), {
  compact: false,
  projectId: '',
  title: 'Leituras do Hermes',
})

const readings = ref<HermesReading[]>([])
const loading = ref(true)
const error = ref('')
const visible = computed(() => props.compact ? readings.value.slice(0, 3) : readings.value)

const formatDateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
}).format(new Date(value))

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const query = props.projectId ? `?projectId=${encodeURIComponent(props.projectId)}` : ''
    const response = await fetch(`/api/operations/readings${query}`, { cache: 'no-store' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    readings.value = body.readings ?? []
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="ops-readings" :class="{ 'is-compact': compact }" aria-labelledby="hermes-readings-title">
    <header class="ops-page-heading">
      <div><span>Hermes agent</span><h2 id="hermes-readings-title">{{ title }}</h2><p>Observações locais com origem e evidência explícitas.</p></div>
      <a v-if="compact" href="/leituras">Ver todas <span aria-hidden="true">→</span></a>
      <button v-else type="button" class="ops-button ops-button--outline" :disabled="loading" @click="load">{{ loading ? 'Lendo…' : 'Atualizar' }}</button>
    </header>

    <p v-if="error" class="ops-global-error" role="alert"><strong>Leituras indisponíveis.</strong> {{ error }}</p>
    <p v-else-if="loading" class="ops-loading" role="status">Consultando a caixa local do Hermes…</p>
    <div v-else-if="!visible.length" class="ops-empty ops-empty--reading">
      <span aria-hidden="true">H</span><h3>Nenhuma leitura registrada</h3>
      <p>Quando o Hermes gravar uma leitura com evidência, ela aparecerá aqui. A Central não cria dados demonstrativos.</p>
    </div>
    <ol v-else class="ops-reading-list">
      <li v-for="reading in visible" :key="reading.id" :class="`is-${reading.severity}`">
        <span class="ops-reading-list__signal" aria-hidden="true" />
        <div class="ops-reading-list__body">
          <div><span>{{ reading.projectName }}</span><time :datetime="reading.occurredAt">{{ formatDateTime(reading.occurredAt) }}</time></div>
          <h3>{{ reading.title }}</h3><p>{{ reading.summary }}</p>
          <small><strong>Origem:</strong> {{ reading.source }} · <strong>Evidência:</strong> {{ reading.evidence }}</small>
        </div>
      </li>
    </ol>
  </section>
</template>
