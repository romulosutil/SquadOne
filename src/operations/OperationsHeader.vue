<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  displayName: string
  falhas: number
  semLeitura: boolean
  checkedAt: string
  loading: boolean
  currentPath: string
}>()

defineEmits<{ refresh: [] }>()

const checkedLabel = computed(() => props.checkedAt
  ? `Atualizado às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(props.checkedAt))}`
  : 'Aguardando leitura')
</script>

<template>
  <aside class="ops-command-rail" aria-label="Navegação da Central">
    <a class="ops-brand" href="/" aria-label="SquadOne, abrir a visão Hoje">
      <span class="ops-brand__mark" aria-hidden="true">S1</span>
      <span><strong>SquadOne</strong><small>Central do Dell</small></span>
    </a>

    <nav class="ops-main-nav" aria-label="Navegação principal">
      <a href="/" :aria-current="currentPath === '/' ? 'page' : undefined">Hoje</a>
      <a href="/projetos/producao-auto" :aria-current="currentPath.startsWith('/projetos') ? 'page' : undefined">Produção Auto</a>
    </nav>
  </aside>

  <header class="ops-command-topbar">
    <div class="ops-welcome" aria-live="polite">
      <span>{{ displayName ? `Olá, ${displayName}` : 'Central do Dell' }}</span>
      <strong>{{ new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()) }}</strong>
    </div>

    <div class="ops-header__actions">
      <div class="ops-connection" role="status">
        <span class="ops-status-dot" :class="{ 'is-pending': loading, 'is-alert': falhas }" aria-hidden="true" />
        <span>{{ loading ? 'Conferindo' : falhas ? `${falhas} com falha` : semLeitura ? 'Sem leitura' : 'Tudo certo' }}</span>
        <small>{{ checkedLabel }}</small>
      </div>
      <button class="ops-refresh" type="button" :disabled="loading" aria-label="Atualizar agora" @click="$emit('refresh')"><span aria-hidden="true">↻</span></button>
    </div>
  </header>
</template>
