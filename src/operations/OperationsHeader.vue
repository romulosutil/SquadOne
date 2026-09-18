<script setup lang="ts">
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

</script>

<template>
  <header class="ops-header">
    <a class="ops-brand" href="#main-content" aria-label="SquadOne, ir para o conteúdo da Central">
      <span class="ops-brand__mark" aria-hidden="true"><i /></span>
      <span><strong>SquadOne</strong><small>Operações</small></span>
    </a>

    <nav class="ops-main-nav" aria-label="Navegação principal">
      <a href="/" :aria-current="currentPath === '/' ? 'page' : undefined">Hoje</a>
      <a href="/projetos" :aria-current="currentPath.startsWith('/projetos') ? 'page' : undefined">Projetos</a>
      <a href="/leituras" :aria-current="currentPath === '/leituras' ? 'page' : undefined">Leituras</a>
    </nav>

    <div class="ops-welcome" aria-live="polite">
      <span v-if="displayName">Olá, {{ displayName }}</span>
      <strong>{{ new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()) }}</strong>
      <span class="ops-welcome__time">{{ new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date()) }}</span>
    </div>

    <div class="ops-header__actions">
      <div class="ops-connection" role="status">
        <span class="ops-status-dot" :class="{ 'is-pending': loading }" aria-hidden="true" />
        <span>Central local</span>
        <small>{{ loading ? 'verificando' : 'via túnel SSH' }}</small>
      </div>

      <button class="ops-refresh" type="button" :disabled="loading" aria-label="Atualizar estado da Central" @click="$emit('refresh')"><span aria-hidden="true">↻</span></button>

      <a v-if="squadOneUrl" class="ops-enter" :href="squadOneUrl" target="_blank" rel="noopener" aria-label="Abrir SquadOne em nova aba">SquadOne <span aria-hidden="true">↗</span></a>
    </div>
  </header>
</template>
