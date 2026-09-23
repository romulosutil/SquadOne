<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AccessPanel from './AccessPanel.vue'
import AgendaPanel from './AgendaPanel.vue'
import AutoProductionPanel from './AutoProductionPanel.vue'
import DellStatusPanel from './DellStatusPanel.vue'
import OperationsHeader from './OperationsHeader.vue'
import PendingPanel from './PendingPanel.vue'
import type { OperationsOverview } from './types'
import './operations.css'

// Uma página responde quatro perguntas: está tudo bem no Dell, o que está
// esperando por mim, o que tem na agenda hoje e onde abro cada ferramenta. Quem corrige é Claude/Codex pelo
// SSH; a Central só mostra (RULES 8 e 10).
const overview = ref<OperationsOverview | null>(null)
const loading = ref(true)
const error = ref('')
const currentPath = window.location.pathname.replace(/\/$/, '') || '/'
const isHome = currentPath === '/'
const isAuto = currentPath === '/projetos/producao-auto'
let refreshTimer = 0

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch('/api/operations/overview')
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    overview.value = body
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally { loading.value = false }
}

const falhas = computed(() => overview.value?.dell.verificacoes.filter(c => c.estado === 'falha').length ?? 0)

onMounted(async () => {
  await load()
  refreshTimer = window.setInterval(load, 30_000)
})
onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <a class="ops-skip-link" href="#main-content">Pular para o conteúdo</a>
  <div class="ops-shell">
    <OperationsHeader :display-name="overview?.displayName ?? ''" :falhas="falhas" :sem-leitura="!overview?.dell.geradoEm" :checked-at="overview?.checkedAt ?? ''" :loading="loading" :current-path="currentPath" @refresh="load" />

    <main id="main-content" class="ops-workspace" :class="{ 'ops-workspace--page': !isHome }" tabindex="-1">
      <template v-if="isHome">
        <DellStatusPanel :status="overview?.dell ?? null" :loading="loading" :error="error" />
        <PendingPanel :checks="overview?.dell.verificacoes ?? []" />
        <div class="ops-home-grid">
          <AgendaPanel :agenda="overview?.agenda ?? null" :loading="loading" />
          <AccessPanel :tools="overview?.tools ?? []" />
        </div>
      </template>
      <AutoProductionPanel v-else-if="isAuto" />
      <section v-else class="ops-empty ops-not-found"><span aria-hidden="true">404</span><h2>Página não encontrada</h2><p>Este endereço não existe na Central local.</p><a class="ops-button ops-button--primary" href="/">Voltar para Hoje</a></section>
    </main>
  </div>
</template>
