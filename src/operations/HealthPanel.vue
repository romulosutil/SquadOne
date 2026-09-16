<script setup lang="ts">
import type { OperationTool, OperationalState } from './types'

defineProps<{ tools: OperationTool[]; checkedAt: string }>()

const labels: Record<OperationalState, string> = {
  healthy: 'Saudável',
  syncing: 'Sincronizando',
  unavailable: 'Indisponível',
  unknown: 'Não verificado'
}
</script>

<template>
  <section id="health" class="ops-panel ops-health" aria-labelledby="health-title">
    <div class="ops-section-heading">
      <div><span>Somente leitura</span><h2 id="health-title">Saúde operacional</h2></div>
      <time v-if="checkedAt" :datetime="checkedAt">
        verificado às {{ new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(checkedAt)) }}
      </time>
    </div>
    <div class="ops-health-list" role="list" aria-label="Estado dos serviços">
      <div v-for="item in tools" :key="item.id" role="listitem">
        <span class="ops-state" :class="`is-${item.state}`"><i aria-hidden="true" />{{ labels[item.state] }}</span>
        <strong>{{ item.label }}</strong>
        <small>{{ item.detail }}</small>
      </div>
    </div>
    <p class="ops-health__note">A Central apenas consulta estes serviços. Parar, reiniciar ou alterar infraestrutura continua fora desta interface.</p>
  </section>
</template>
