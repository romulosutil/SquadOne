<script setup lang="ts">
import { computed } from 'vue'
import { ferramentasDoMais } from '../casca/mais'
import type { OperationTool } from './types'

const props = defineProps<{ tools: OperationTool[] }>()

// Só as ferramentas de verdade (AC-24, 17/10/2026): Terminal, n8n, Hermes e a reserva fria.
// A regra (o que entra, a ordem, o ponto neutro da reserva) é PURA em casca/mais.ts.
const ICONE: Record<string, string> = { ide: '>_', n8n: 'n8n', hermes: 'H', remote: '☁' }
const links = computed(() => ferramentasDoMais(props.tools))
</script>

<template>
  <section class="painel access" aria-labelledby="access-title">
    <h2 id="access-title">Ferramentas</h2>
    <ul>
      <li v-for="l in links" :key="l.id">
        <a :href="l.url" target="_blank" rel="noopener">
          <span class="access__icone" aria-hidden="true">{{ ICONE[l.id] ?? '↗' }}</span>
          <span><strong>{{ l.nome }}</strong><small>{{ l.dica }}</small></span>
          <span v-if="l.ponto" class="dell-dot" :class="l.ponto" aria-hidden="true" />
        </a>
      </li>
      <li>
        <a href="http://127.0.0.1:8787/" target="_blank" rel="noopener">
          <span class="access__icone" aria-hidden="true">LP</span>
          <span><strong>Linear Pessoal</strong><small>Issues dos projetos Pessoal e do GitHub · só no Dell</small></span>
        </a>
      </li>
    </ul>
  </section>
</template>
