<script setup lang="ts">
import { computed } from 'vue'
import type { DellCheck } from './types'

// Fila de trabalho humano, não saúde: o que as esteiras deixaram esperando o
// Rômulo. Vem das contagens que os fluxos do n8n gravam a cada rodada.
const props = defineProps<{ checks: DellCheck[] }>()

const esperando = computed(() => props.checks.filter(c => c.grupo === 'pendencias' && c.estado !== 'ok'))
</script>

<template>
  <section class="ops-panel pending" aria-labelledby="pending-title">
    <h2 id="pending-title">Esperando você</h2>
    <p v-if="!esperando.length" class="pending__vazio">Nada parado em você agora.</p>
    <ul v-else>
      <li v-for="c in esperando" :key="c.id">
        <strong>{{ c.nome }}</strong>
        <small>{{ c.detalhe }}</small>
        <a v-if="c.link" :href="c.link" target="_blank" rel="noopener">Abrir <span class="ops-visually-hidden">{{ c.nome }}</span>↗</a>
      </li>
    </ul>
  </section>
</template>
