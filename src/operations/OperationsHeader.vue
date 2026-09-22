<script setup lang="ts">
import { computed } from 'vue'
import type { OperationTool } from './types'

const props = defineProps<{
  displayName: string
  tools: OperationTool[]
  squadOneUrl: string
  checkedAt: string
  loading: boolean
  currentPath: string
}>()

defineEmits<{ refresh: [] }>()

const unavailableCount = computed(() => props.tools.filter(tool => tool.state === 'unavailable').length)
const connectionLabel = computed(() => {
  if (props.loading) return 'Verificando fontes'
  if (unavailableCount.value) return `${unavailableCount.value} em atenção`
  return `${props.tools.length} fontes consultadas`
})
const checkedLabel = computed(() => props.checkedAt
  ? `Atualizado às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(props.checkedAt))}`
  : 'Aguardando leitura')
</script>

<template>
  <aside class="ops-command-rail" aria-label="Navegação da Central">
    <a class="ops-brand" href="/" aria-label="SquadOne, abrir a visão Hoje">
      <span class="ops-brand__mark" aria-hidden="true">S1</span>
      <span><strong>SquadOne</strong><small>Operações</small></span>
    </a>

    <nav class="ops-main-nav" aria-label="Navegação principal">
      <a href="/" :aria-current="currentPath === '/' ? 'page' : undefined">Hoje</a>
      <a href="/projetos" :aria-current="currentPath.startsWith('/projetos') ? 'page' : undefined">Projetos</a>
      <a href="/leituras" :aria-current="currentPath === '/leituras' ? 'page' : undefined">Leituras</a>
    </nav>

    <div class="ops-rail-sources" aria-label="Conectividade">
      <p>Conectividade</p>
      <span><i class="ops-status-dot" :class="{ 'is-pending': loading }" aria-hidden="true" /> Central local</span>
      <span><i class="ops-status-dot" :class="{ 'is-alert': unavailableCount }" aria-hidden="true" /> {{ connectionLabel }}</span>
    </div>

    <a v-if="squadOneUrl" class="ops-enter ops-enter--rail" :href="squadOneUrl" target="_blank" rel="noopener" aria-label="Abrir SquadOne em nova aba"><span>Agendador pessoal</span><strong>Abrir SquadOne ↗</strong></a>
  </aside>

  <header class="ops-command-topbar">
    <div class="ops-welcome" aria-live="polite">
      <span>{{ displayName ? `Olá, ${displayName}` : 'Central de Operações' }}</span>
      <strong>{{ new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()) }}</strong>
    </div>

    <div class="ops-header__actions">
      <div class="ops-connection" role="status">
        <span class="ops-status-dot" :class="{ 'is-pending': loading }" aria-hidden="true" />
        <span>{{ connectionLabel }}</span>
        <small>{{ checkedLabel }}</small>
      </div>

      <button class="ops-refresh" type="button" :disabled="loading" aria-label="Atualizar estado da Central" @click="$emit('refresh')"><span aria-hidden="true">↻</span></button>
    </div>
  </header>
</template>
