<script setup lang="ts">
import { computed } from 'vue'
import type { CrmLead } from '../operations/types'
import { acompanhamentoObservado } from '../operations/acompanhamento-observado'
const props = defineProps<{ lead: CrmLead }>()
const estado = computed(() => acompanhamentoObservado(props.lead))
</script>
<template>
  <aside class="acompanhamento-observado" aria-label="Acompanhamento pelo time">
    <span class="etiqueta" :data-tom="estado.tom">{{ estado.titulo }}</span>
    <p>{{ estado.detalhe }}</p>
    <small v-if="lead.conversa">Último registro · {{ new Date(lead.conversa.ultima.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) }}</small>
  </aside>
</template>
<style scoped>
.acompanhamento-observado { display: grid; gap: var(--esp-2); padding: var(--esp-3); background: var(--superficie-2); border-radius: var(--raio-controle); }
.acompanhamento-observado p { margin: 0; max-width: var(--leitura-max); }
.acompanhamento-observado small { color: var(--texto-2); }
</style>
