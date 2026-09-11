<script setup>
import { onMounted, ref } from 'vue'
import GameMap from './components/GameMap.vue'
import CommandBar from './components/CommandBar.vue'
import QuestBackpack from './components/QuestBackpack.vue'

const currentAgent = ref('Idle')
const quests = ref([])
const sugestoes = ref([])
const squad = ref(null)
const isLoading = ref(false)

// O roster manda: papeis, slots desbloqueados e roteamento saem daqui.
onMounted(async () => {
  try {
    const response = await fetch('/api/squad')
    if (!response.ok) throw new Error('Falha ao carregar o squad')
    squad.value = await response.json()
  } catch (error) {
    console.error('Falha ao carregar o squad:', error)
  }
})

const handleDelegation = async (payload) => {
  if (isLoading.value) return;

  isLoading.value = true;
  currentAgent.value = 'Idle';

  try {
    const response = await fetch('/api/orquestrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // TODO: Authorization: Bearer <access_token> do GIS (§3.4).
      // Sem o header, agendar_evento falha e o erro volta em erros[].
      body: JSON.stringify({ demanda: payload.demanda })
    })

    if (!response.ok) throw new Error('Erro na requisição')

    const turno = await response.json()

    if (turno.eventos_criados?.length) {
      quests.value.unshift(...turno.eventos_criados)
      currentAgent.value = turno.eventos_criados[0].po_id
    }

    if (turno.sugestoes?.length) {
      sugestoes.value = turno.sugestoes
    }

    if (turno.erros?.length) {
      // try por tarefa: o lote sobrevive, os erros vem nomeados.
      console.warn('Tarefas com erro:', turno.erros)
      alert(turno.erros.map(e => `${e.capacidade}: ${e.erro}`).join('\n'))
    }
  } catch (error) {
    console.error('Falha ao orquestrar:', error)
    alert("Houve um erro ao processar a demanda. Tente novamente.");
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="h-screen w-full bg-[#f4f0e6] font-sans overflow-hidden flex flex-col selection:bg-black selection:text-white">
    <!-- Header -->
    <header class="h-16 border-b-4 border-black bg-[#ffdb58] flex items-center justify-between px-6 shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] z-30 shrink-0">
      <div class="flex items-center gap-4">
        <div class="w-8 h-8 bg-black flex items-center justify-center animate-pulse">
          <div class="w-4 h-4 bg-[#ffdb58]"></div>
        </div>
        <h1 class="text-2xl font-black uppercase tracking-wider">Quest Hub <span class="text-xs ml-2 bg-black text-white px-2 py-1 align-middle">MVP</span></h1>
      </div>
      <div v-if="isLoading" class="font-bold text-sm uppercase flex items-center gap-2">
        <span class="animate-spin text-xl">⚙️</span>
        Processando...
      </div>
    </header>

    <!-- Main Content -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Sidebar (Backpack) -->
      <QuestBackpack :quests="quests" />

      <!-- Map Area -->
      <main class="flex-1 p-6 flex flex-col gap-4 bg-[#e0e7ff] overflow-y-auto">
        <!-- Sugestoes de contratacao: proposta, nao acao. O fluxo de
             contratar (POST /api/squad/hire) ainda nao existe. -->
        <div
          v-for="(sugestao, index) in sugestoes"
          :key="index"
          class="border-4 border-black bg-[#ffdb58] p-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] shrink-0"
        >
          <h3 class="font-black uppercase text-lg">Contratar {{ sugestao.papel }}?</h3>
          <p class="font-bold text-sm mt-1">{{ sugestao.justificativa }}</p>
          <p class="text-xs font-bold mt-2 opacity-70">Escopo: {{ sugestao.escopo }}</p>
        </div>

        <GameMap :agent="currentAgent" />
      </main>
    </div>

    <!-- Command Bar -->
    <CommandBar @delegate="handleDelegation" />
  </div>
</template>

<style>
/* Reset and Neo-Brutalist base styles */
:root {
  --font-sans: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
body {
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
