<script setup lang="ts">
import { onMounted, ref } from 'vue'
import GameMap from './components/GameMap.vue'
import CommandBar from './components/CommandBar.vue'
import QuestBackpack from './components/QuestBackpack.vue'
import GrowthCard from './components/GrowthCard.vue'
import type { Sugestao } from './types'
import { conectado, conectando, desconectar, irParaConsentimento, lerRetornoDoConsentimento, sincronizarStatus } from './auth/google'

const currentAgent = ref('Idle')
// A Mochila NAO guarda quest local: a verdade e o Google Calendar. Esta ref e
// so o cache da ultima leitura de GET /api/mochila.
const quests = ref([])
const carregandoMochila = ref(false)
const sugestoes = ref<Sugestao[]>([])
const squad = ref(null)
const isLoading = ref(false)
// Contratacao em curso: id da sugestao sendo aprovada (so uma por vez, o
// servidor serializa as escritas no roster de qualquer forma). Id, nao indice:
// um turno novo ou um descarte durante o POST desloca os indices.
const aprovando = ref('')
const erroSugestao = ref<Record<string, string>>({})
const toast = ref('')
let toastTimer = 0

// O roster manda: papeis, slots desbloqueados e roteamento saem daqui.
onMounted(async () => {
  try {
    const response = await fetch('/api/squad')
    if (!response.ok) throw new Error('Falha ao carregar o squad')
    squad.value = await response.json()
  } catch (error) {
    console.error('Falha ao carregar o squad:', error)
  }

  // Volta do consentimento: o callback redireciona para /?auth=ok ou
  // /?auth=<motivo>. Avisar aqui e o unico feedback que o usuario tem de que
  // a autorizacao deu certo, porque o resto do fluxo acontece no servidor.
  const retorno = lerRetornoDoConsentimento()
  if (retorno && retorno !== 'ok') avisar(`Google: ${retorno}`)
  else if (retorno === 'ok') avisar('Calendário conectado')

  // A credencial mora no servidor: basta perguntar. Sem popup, sem gesto — se
  // ja houve consentimento antes, continua valendo depois de reload e deploy.
  if (await sincronizarStatus()) await carregarMochila()
})

const carregarMochila = async () => {
  if (!conectado.value) return
  carregandoMochila.value = true
  try {
    const response = await fetch('/api/mochila')
    if (!response.ok) {
      // 401 = o servidor nao tem credencial valida (nunca conectou, ou o
      // Google recusou o refresh). Derruba o estado pra UI voltar a oferecer
      // o botao de conectar.
      if (response.status === 401) conectado.value = false
      const corpo = await response.json().catch(() => ({}))
      throw new Error(corpo.error ?? `HTTP ${response.status}`)
    }
    const dados = await response.json()
    quests.value = dados.quests ?? []
    if (dados.erros?.length) console.warn('Dominios com erro na Mochila:', dados.erros)
  } catch (error) {
    // So no console, a Mochila vazia fica indistinguivel de "nao ha quests":
    // o motivo tem que chegar na tela de quem pode agir sobre ele.
    console.error('Falha ao ler a Mochila:', error)
    avisar(`Mochila: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    carregandoMochila.value = false
  }
}

const avisar = (texto) => {
  toast.value = texto
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = '' }, 4000)
}

/**
 * [APROVAR] do card (§4.4). E aqui que a proposta do modelo vira roster: o
 * POST devolve o squad ja atualizado, e trocar `squad.value` e o unico gatilho
 * de que o escritorio precisa — o GameMap ve um dominio (ou uma pessoa) a mais
 * e roda a sequencia de crescimento sozinho.
 */
const aprovarSugestao = async (id, nome) => {
  if (aprovando.value) return
  const sugestao = sugestoes.value.find((s) => s.id === id)
  if (!sugestao) return
  aprovando.value = id
  erroSugestao.value = { ...erroSugestao.value, [id]: '' }
  // Um turno novo pode substituir a lista enquanto o POST corre. Aí o card
  // deste id nao existe mais, e mexer no estado dos cards (remover, gravar
  // erro, liberar `aprovando`) atropelaria os cards do turno novo.
  const aindaNaLista = () => sugestoes.value.some((s) => s.id === id)
  try {
    const response = await fetch('/api/squad/hire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sugestao, nome })
    })
    const dados = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(dados.error ?? `HTTP ${response.status}`)

    // O roster mudou de qualquer jeito: squad e aviso valem mesmo sem o card.
    squad.value = dados.squad
    if (aindaNaLista()) {
      sugestoes.value = sugestoes.value.filter((s) => s.id !== id)
      const { [id]: _, ...outrosErros } = erroSugestao.value
      erroSugestao.value = outrosErros
    }
    avisar(
      dados.kind === 'dominio'
        ? `${dados.pessoa.nome} abriu o dominio ${dados.dominio.nome}`
        : `${dados.pessoa.nome} entrou no squad (${dados.dominio.nome})`
    )
  } catch (error) {
    console.error('Falha ao contratar:', error)
    if (aindaNaLista()) erroSugestao.value = { ...erroSugestao.value, [id]: error.message }
  } finally {
    // So libera se ainda for a aprovacao deste id: depois de um turno novo,
    // `aprovando` pode ja pertencer a um card do turno novo.
    if (aprovando.value === id) aprovando.value = ''
  }
}

const descartarSugestao = (id) => {
  sugestoes.value = sugestoes.value.filter((s) => s.id !== id)
}

// Navega para fora da SPA; o retorno cai no onMounted acima.
const conectarGoogle = () => irParaConsentimento()

const desconectarGoogle = async () => {
  await desconectar()
  quests.value = []
  avisar('Calendário desconectado')
}

const handleDelegation = async (payload) => {
  if (isLoading.value) return;

  isLoading.value = true;
  currentAgent.value = 'Idle';

  try {
    // O token e problema do servidor: ele pega do store e renova sozinho. Um
    // turno que nao toca o calendario roda mesmo sem credencial.
    const response = await fetch('/api/orquestrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demanda: payload.demanda, modo: payload.modo })
    })

    if (!response.ok) {
      // O corpo carrega a classificacao: `modeloOcupado` e transitorio e passa
      // sozinho, por isso o texto manda tentar de novo em vez de sugerir que
      // algo quebrou.
      const corpo = await response.json().catch(() => ({}))
      throw new Error(corpo.error || 'Erro na requisição')
    }

    const turno = await response.json()

    if (turno.eventos_criados?.length) {
      // responsavel_id e uma PESSOA (PO ou integrante); o GameMap resolve em
      // qual DOMINIO ela esta para mandar o PO raiz ate a sala certa.
      currentAgent.value = turno.eventos_criados[0].responsavel_id
    }

    // Cada turno SUBSTITUI as propostas, inclusive por nenhuma: sugestao de
    // uma demanda antiga nao tem mais contexto, e deixar a lista so crescer
    // (ou nunca esvaziar) mostrava cards que ninguem pediu agora.
    sugestoes.value = turno.sugestoes ?? []
    erroSugestao.value = {}
    // Aprovacao em curso era de um card que acabou de sair: sem zerar, os
    // cards novos ficariam bloqueados ate o POST antigo voltar.
    aprovando.value = ''

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
    alert(error?.message || 'Houve um erro ao processar a demanda. Tente novamente.')
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
        <!-- Credencial mora no servidor: sobrevive a reload e a deploy. -->
        <button
          v-if="!conectado"
          @click="conectarGoogle"
          :disabled="conectando"
          class="border-4 border-black bg-white px-4 py-2 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50"
        >
          {{ conectando ? 'Conectando...' : '🔌 Conectar Google Calendar' }}
        </button>
        <button
          v-else
          @click="desconectarGoogle"
          title="Desconectar do Google Calendar"
          class="font-black text-xs uppercase bg-black text-white px-3 py-2 hover:bg-red-700 transition-colors"
        >
          📅 Calendário conectado
        </button>
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
        <!-- Crescimento em DOIS niveis (spec 4.4): um dominio novo abre sala,
             um integrante entra na sala do dominio que ja existe. O modelo so
             propoe; aprovar aqui e o que escreve no roster. -->
        <!-- :key pelo id do servidor: cada card tem seu proprio estado (nome
             digitado); com key por indice, o card seguinte herdava o nome
             depois de um descarte ou aprovacao. -->
        <GrowthCard
          v-for="sugestao in sugestoes"
          :key="sugestao.id"
          :sugestao="sugestao"
          :enviando="aprovando === sugestao.id"
          :erro="erroSugestao[sugestao.id] || ''"
          @aprovar="(nome) => aprovarSugestao(sugestao.id, nome)"
          @descartar="descartarSugestao(sugestao.id)"
        />

        <GameMap :agent="currentAgent" :squad="squad" />
      </main>
    </div>

    <!-- Toast: a contratacao acontece no mapa, longe do card que foi clicado. -->
    <div
      v-if="toast"
      class="fixed bottom-24 right-6 z-50 border-4 border-black bg-[#ffdb58] px-4 py-3 font-black text-sm uppercase shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
    >
      ✨ {{ toast }}
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
