<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import App from './App.vue'
import OperationsApp from './operations/OperationsApp.vue'

type RuntimeMode = 'app' | 'operations'

const mode = ref<RuntimeMode | null>(null)
const failed = ref(false)
/** Os agentes (o app) abertos dentro da Central: /squadone no Dell com a agenda. */
const agentesAqui = ref(false)

// /squadone é o endereço dos agentes em toda a Central. Com a agenda neste
// processo (o Dell depois do cutover, `agenda` no /api/runtime) ele abre o app
// aqui mesmo; antes disso os agentes moram no Easypanel e o link vai para lá.
const APP_DOS_AGENTES = 'https://aladdin-squadone-app.jicnzg.easypanel.host/'
const showOperations = computed(() => mode.value === 'operations' && !agentesAqui.value)

onMounted(async () => {
  try {
    const response = await fetch('/api/runtime')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    mode.value = body.mode === 'operations' ? 'operations' : 'app'
    if (mode.value === 'operations' && window.location.pathname.startsWith('/squadone')) {
      if (body.agenda === true) agentesAqui.value = true
      else window.location.replace(APP_DOS_AGENTES)
    }
  } catch (error) {
    console.error('Falha ao identificar o perfil do SquadOne:', error)
    failed.value = true
    // Falha fechada: nunca materializa a Central sem confirmação do servidor.
    mode.value = 'app'
  }
})
</script>

<template>
  <div v-if="mode === null" class="runtime-loading" role="status">Carregando SquadOne…</div>
  <OperationsApp v-else-if="showOperations" />
  <App v-else :operations-mode="mode === 'operations'" />
  <p v-if="failed" class="runtime-warning" role="status">
    O perfil de execução não pôde ser confirmado; o aplicativo foi aberto no modo seguro.
  </p>
</template>

<style>
.runtime-loading {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #f4f0e6;
  color: #151914;
  font: 800 1rem/1.5 system-ui, sans-serif;
}

.runtime-warning {
  position: fixed;
  inset: auto 1rem 1rem auto;
  z-index: 100;
  max-width: 32rem;
  border: 3px solid #151914;
  background: #ffcf5c;
  padding: 0.75rem 1rem;
  font-weight: 800;
  box-shadow: 4px 4px 0 #151914;
}
</style>
