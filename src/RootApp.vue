<script setup lang="ts">
import { onMounted, ref } from 'vue'
import App from './App.vue'
import type { Perfil } from './casca/destinos'

// Uma casca só para os dois perfis (07/10/2026). O /api/runtime diz o perfil e
// se a agenda (o app dos agentes) mora neste processo; a casca decide o resto.
const perfil = ref<Perfil | null>(null)
const agentes = ref(false)
const failed = ref(false)

// /squadone é o endereço dos agentes em toda a Central. Com a agenda neste
// processo (o Dell depois do cutover, `agenda` no /api/runtime) ele abre o
// Escritório aqui mesmo; antes disso os agentes moram no Easypanel e o link vai
// para lá.
const APP_DOS_AGENTES = 'https://aladdin-squadone-app.jicnzg.easypanel.host/'

onMounted(async () => {
  try {
    const response = await fetch('/api/runtime')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    if (body.mode === 'operations') {
      agentes.value = body.agenda === true
      if (!agentes.value && window.location.pathname.startsWith('/squadone')) {
        window.location.replace(APP_DOS_AGENTES)
        return
      }
      perfil.value = 'operations'
    } else {
      agentes.value = true
      perfil.value = 'app'
    }
  } catch (error) {
    console.error('Falha ao identificar o perfil do SquadOne:', error)
    failed.value = true
    // Falha fechada: nunca materializa a Central sem confirmação do servidor.
    agentes.value = true
    perfil.value = 'app'
  }
})
</script>

<template>
  <div v-if="perfil === null" class="runtime-loading" role="status">Carregando SquadOne…</div>
  <App v-else :perfil="perfil" :agentes="agentes" />
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
  inset: auto 1rem 5rem auto;
  z-index: 100;
  max-width: 32rem;
  border: 3px solid #151914;
  background: #ffcf5c;
  color: #151914;
  padding: 0.75rem 1rem;
  font-weight: 800;
  box-shadow: 4px 4px 0 #151914;
}
</style>
