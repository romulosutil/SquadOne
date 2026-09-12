<script setup>
import { onMounted, ref } from 'vue'
import GameMap from './components/GameMap.vue'
import CommandBar from './components/CommandBar.vue'
import QuestBackpack from './components/QuestBackpack.vue'
import { conectado, conectando, conectar, desconectar, garantirToken, tokenAtual } from './auth/google'

const currentAgent = ref('Idle')
// A Mochila NAO guarda quest local: a verdade e o Google Calendar. Esta ref e
// so o cache da ultima leitura de GET /api/mochila.
const quests = ref([])
const carregandoMochila = ref(false)
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

  // Silencioso: so pega token se o usuario ja consentiu neste browser. Se o
  // Google recusar, nada abre — o botao Conectar (gesto do usuario) resolve.
  try {
    await conectar(true)
    await carregarMochila()
  } catch {
    // sem consentimento previo: segue desconectado.
  }
})

const carregarMochila = async () => {
  const token = tokenAtual()
  if (!token) return
  carregandoMochila.value = true
  try {
    const response = await fetch('/api/mochila', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) {
      // 401 = o Google recusou o token (expirou ou foi revogado). Derruba o
      // estado de conectado pra UI voltar a oferecer o botao de conectar.
      if (response.status === 401) desconectar()
      const corpo = await response.json().catch(() => ({}))
      throw new Error(corpo.error ?? `HTTP ${response.status}`)
    }
    const dados = await response.json()
    quests.value = dados.quests ?? []
    if (dados.erros?.length) console.warn('Dominios com erro na Mochila:', dados.erros)
  } catch (error) {
    console.error('Falha ao ler a Mochila:', error)
  } finally {
    carregandoMochila.value = false
  }
}

const conectarGoogle = async () => {
  try {
    await garantirToken()
    await carregarMochila()
  } catch (error) {
    console.error('Falha ao conectar no Google:', error)
    alert(`Falha ao conectar no Google Calendar: ${error.message}`)
  }
}

const handleDelegation = async (payload) => {
  if (isLoading.value) return;

  isLoading.value = true;
  currentAgent.value = 'Idle';

  try {
    // Bearer obrigatorio (§3.4): sem token, agendar_evento falha no servidor.
    // Pede antes de gastar uma chamada no Gemini.
    const token = await garantirToken()

    const response = await fetch('/api/orquestrar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ demanda: payload.demanda })
    })

    if (!response.ok) throw new Error('Erro na requisição')

    const turno = await response.json()

    if (turno.eventos_criados?.length) {
      // responsavel_id e uma PESSOA (PO ou integrante); o GameMap resolve em
      // qual DOMINIO ela esta para mandar o PO raiz ate a sala certa.
      currentAgent.value = turno.eventos_criados[0].responsavel_id
    }

    if (turno.sugestoes?.length) {
      sugestoes.value = turno.sugestoes
    }

    if (turno.erros?.length) {
      // try por tarefa: o lote sobrevive, os erros vem nomeados.
      console.warn('Tarefas com erro:', turno.erros)
      alert(turno.erros.map(e => `${e.capacidade}: ${e.erro}`).join('\n'))
    }

    // Rele o calendario em vez de confiar no retorno: o que o Google gravou e
    // o que vale, inclusive edicoes feitas fora do app.
    await carregarMochila()
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
      <div class="flex items-center gap-4">
        <div v-if="isLoading" class="font-bold text-sm uppercase flex items-center gap-2">
          <span class="animate-spin text-xl">⚙️</span>
          Processando...
        </div>
        <!-- Token GIS vive em memoria: some no reload, reconecta em ~1h (§3.4). -->
        <button
          v-if="!conectado"
          @click="conectarGoogle"
          :disabled="conectando"
          class="border-4 border-black bg-white px-4 py-2 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50"
        >
          {{ conectando ? 'Conectando...' : '🔌 Conectar Google Calendar' }}
        </button>
        <span v-else class="font-black text-xs uppercase bg-black text-white px-3 py-2">
          📅 Calendário conectado
        </span>
      </div>
    </header>

    <!-- Main Content -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Sidebar (Backpack) -->
      <QuestBackpack
        :quests="quests"
        :conectado="conectado"
        :carregando="carregandoMochila"
        @conectar="conectarGoogle"
        @recarregar="carregarMochila"
      />

      <!-- Map Area -->
      <main class="flex-1 p-6 flex flex-col gap-4 bg-[#e0e7ff] overflow-y-auto">
        <!-- Crescimento em DOIS niveis (spec 3.2): um dominio novo abre sala,
             um integrante entra na sala do dominio que ja existe. Proposta, nao
             acao: o fluxo de aprovar (POST /api/squad/*) ainda nao existe. -->
        <div
          v-for="(sugestao, index) in sugestoes"
          :key="index"
          class="border-4 border-black bg-[#ffdb58] p-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] shrink-0"
        >
          <template v-if="sugestao.kind === 'dominio'">
            <h3 class="font-black uppercase text-lg">
              Abrir dominio {{ sugestao.dominio }}?
            </h3>
            <p class="text-xs font-bold uppercase mt-1 opacity-70">
              Sala nova + {{ sugestao.papel_po }}
              <span v-if="sugestao.slot">no slot [{{ sugestao.slot[0] }},{{ sugestao.slot[1] }}]</span>
            </p>
          </template>
          <template v-else>
            <h3 class="font-black uppercase text-lg">
              Contratar {{ sugestao.papel }} em {{ sugestao.dominio_nome }}?
            </h3>
            <p class="text-xs font-bold uppercase mt-1 opacity-70">
              Entra na sala do dominio {{ sugestao.dominio_id }}
            </p>
          </template>
          <p class="font-bold text-sm mt-1">{{ sugestao.justificativa }}</p>
          <p class="text-xs font-bold mt-2 opacity-70">Escopo: {{ sugestao.escopo }}</p>
        </div>

        <GameMap :agent="currentAgent" :squad="squad" />
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
