<script setup lang="ts">
import type { OperationTool } from './types'

const props = defineProps<{
  displayName: string
  tools: OperationTool[]
  squadOneUrl: string
  checkedAt: string
  loading: boolean
}>()

defineEmits<{ refresh: [] }>()

const tool = (id: OperationTool['id']) => props.tools.find(item => item.id === id)
</script>

<template>
  <header class="ops-header">
    <a class="ops-brand" href="#main-content" aria-label="SquadOne, ir para o conteúdo da Central">
      <span class="ops-brand__mark" aria-hidden="true"><i /></span>
      <span><strong>SquadOne</strong><small>Operações</small></span>
    </a>

    <div class="ops-title">
      <span>Seu ponto de partida</span>
      <h1>Central de Operações</h1>
    </div>

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

      <nav class="ops-quick" aria-label="Acessos rápidos">
        <a href="#producao-auto"><span aria-hidden="true">A</span> Produção Auto</a>
        <a v-if="tool('hermes')" :href="tool('hermes')!.launchUrl" target="_blank" rel="noopener">
          <span aria-hidden="true">H</span> Hermes
        </a>
        <a v-if="tool('ide')" :href="tool('ide')!.launchUrl" target="_blank" rel="noopener">
          <span aria-hidden="true">&lt;/&gt;</span> IDE
        </a>
        <button type="button" :disabled="loading" @click="$emit('refresh')">
          <span aria-hidden="true">↻</span> Atualizar
        </button>
      </nav>

      <a v-if="squadOneUrl" class="ops-enter" :href="squadOneUrl" target="_blank" rel="noopener" aria-label="Abrir SquadOne em nova aba">Abrir SquadOne <span aria-hidden="true">↗</span></a>
    </div>
  </header>
</template>
