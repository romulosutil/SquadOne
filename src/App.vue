<script setup>
import { ref } from 'vue'
import GameMap from './components/GameMap.vue'
import CommandBar from './components/CommandBar.vue'
import QuestBackpack from './components/QuestBackpack.vue'

const currentAgent = ref('Idle')
const quests = ref([])
const isLoading = ref(false)

const handleDelegation = async (payload) => {
  if (isLoading.value) return;
  
  isLoading.value = true;
  // Move to center before processing
  currentAgent.value = 'Idle';
  
  try {
    const response = await fetch('/api/orquestrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    
    if (!response.ok) throw new Error('Erro na requisição')
    
    const textResponse = await response.text()
    
    // Attempt to parse response (it might have markdown code blocks if the prompt wasn't followed strictly, but our server uses generateContent with application/json config)
    let data;
    try {
      data = JSON.parse(textResponse);
    } catch (e) {
      console.warn("Resposta não é JSON puro, tentando limpar markdown");
      const cleaned = textResponse.replace(/```json/g, '').replace(/```/g, '');
      data = JSON.parse(cleaned);
    }

    if (data.tarefas && data.tarefas.length > 0) {
      // Add new quests to the beginning
      quests.value.unshift(...data.tarefas)
      // Trigger animation to the responsible agent station
      currentAgent.value = data.tarefas[0].agente_responsavel
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
      <main class="flex-1 p-6 flex flex-col bg-[#e0e7ff]">
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
