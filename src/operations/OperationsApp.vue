<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AccessPanel from './AccessPanel.vue'
import AgendaPanel from './AgendaPanel.vue'
import ComoFuncionaPanel from './ComoFuncionaPanel.vue'
import CrmPanel from './CrmPanel.vue'
import DellConferePanel from './DellConferePanel.vue'
import OperationsHeader from './OperationsHeader.vue'
import PrecisaDeVoce from './PrecisaDeVoce.vue'
import type { OperationsOverview } from './types'
import './operations.css'

// A home responde, nesta ordem (RULES 13): o que precisa de mim agora e o que
// fazer com cada alerta, como a operação funciona, o que tem na agenda hoje e
// onde abro cada ferramenta; o detalhe do Dell fica fechado no fim. Quem
// corrige é o Claude; a Central só mostra (RULES 8 e 10).
const overview = ref<OperationsOverview | null>(null)
const loading = ref(true)
const error = ref('')
// A antiga Produção Auto (/projetos/producao-auto) virou o CRM em 30/09/2026.
if (window.location.pathname.replace(/\/$/, '') === '/projetos/producao-auto') window.history.replaceState(null, '', '/crm')
const currentPath = window.location.pathname.replace(/\/$/, '') || '/'
const isHome = currentPath === '/'
const isCrm = currentPath === '/crm'
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
        <PrecisaDeVoce :status="overview?.dell ?? null" :loading="loading" :error="error" />
        <ComoFuncionaPanel :checks="overview?.dell.verificacoes ?? []" />
        <div class="ops-home-grid">
          <AgendaPanel :agenda="overview?.agenda ?? null" :loading="loading" />
          <AccessPanel :tools="overview?.tools ?? []" />
        </div>
        <DellConferePanel :status="overview?.dell ?? null" />
      </template>
      <CrmPanel v-else-if="isCrm" />
      <section v-else class="ops-empty ops-not-found"><span aria-hidden="true">404</span><h2>Página não encontrada</h2><p>Este endereço não existe na Central local.</p><a class="ops-button ops-button--primary" href="/">Voltar para Hoje</a></section>
    </main>
  </div>
</template>
