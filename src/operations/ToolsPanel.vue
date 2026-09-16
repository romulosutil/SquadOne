<script setup lang="ts">
import type { OperationTool, OperationalState } from './types'

defineProps<{ tools: OperationTool[]; loading: boolean }>()

const labels: Record<OperationalState, string> = {
  healthy: 'Disponível',
  syncing: 'Sincronizando',
  unavailable: 'Indisponível',
  unknown: 'Não verificado'
}
</script>

<template>
  <section class="ops-panel ops-tools" aria-labelledby="tools-title">
    <div class="ops-section-heading">
      <div><h2 id="tools-title">Ferramentas locais</h2></div>
      <span v-if="loading" class="ops-loading" role="status">Verificando…</span>
    </div>
    <div class="ops-tool-grid">
      <article v-for="item in tools" :key="item.id" class="ops-tool-card">
        <span class="ops-tool-card__glyph" aria-hidden="true">
          {{ item.id === 'ide' ? '</>' : item.id === 'remote' ? '↗' : item.label.charAt(0) }}
        </span>
        <div>
          <h3>{{ item.label }}</h3>
          <p>{{ item.description }}</p>
        </div>
        <span class="ops-state" :class="`is-${item.state}`">
          <i aria-hidden="true" /> {{ labels[item.state] }}
        </span>
        <a :href="item.launchUrl" target="_blank" rel="noopener">
          {{ item.state === 'unavailable' ? 'Tentar abrir' : 'Abrir' }}
          <span aria-hidden="true">↗</span>
        </a>
      </article>
    </div>
  </section>
</template>
