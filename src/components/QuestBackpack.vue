<script setup lang="ts">
import type { PropType } from 'vue'
import type { QuestCalendario } from '../types'
import { diasDoEventoDiaInteiro, infoDePrazo } from '../mochila'

const props = defineProps({
  // Vem de GET /api/mochila, ou seja, do Google Calendar. Nada aqui e estado
  // local do app: apagar o evento no Google some com o card na proxima leitura.
  quests: { type: Array as PropType<QuestCalendario[]>, default: () => [] },
  conectado: { type: Boolean, default: false },
  carregando: { type: Boolean, default: false },
  // id -> nome dos domínios da squad ativa. Ids novos são `<squad>--<slug>`,
  // feios de ler num badge; sem nome conhecido, cai no id.
  nomesDeDominio: { type: Object as PropType<Record<string, string>>, default: () => ({}) }
})

defineEmits(['conectar', 'recarregar'])

const quando = (quest: QuestCalendario) => {
  if (quest.diaInteiro) {
    // `fim` do Google e exclusivo e "AAAA-MM-DD" puro viraria UTC (dia anterior
    // em -03:00): o helper devolve datas locais. Varios dias mostram o
    // intervalo, nao so o inicio.
    const { primeiro, ultimo } = diasDoEventoDiaInteiro(quest.inicio, quest.fim)
    return ultimo.getTime() === primeiro.getTime()
      ? primeiro.toLocaleDateString()
      : `${primeiro.toLocaleDateString()} – ${ultimo.toLocaleDateString()}`
  }
  return new Date(quest.tipo === 'deadline' ? quest.fim : quest.inicio).toLocaleString()
}

const duracao = (quest: QuestCalendario) =>
  Math.round((new Date(quest.fim).getTime() - new Date(quest.inicio).getTime()) / 60000)

// Bloco e marco se reconhecem pela lista lida, nao por contador gravado:
// apagar um bloco no Google corrige o "2/3" na proxima leitura.
const rotuloDoTipo = (quest: QuestCalendario) => {
  const info = infoDePrazo(quest, props.quests)
  if (info.papel === 'bloco') return `Bloco ${info.posicao}/${info.total}: ${duracao(quest)}m`
  if (quest.tipo === 'deadline') {
    return info.papel === 'marco' ? `Deadline · ${info.blocos} bloco(s) de trabalho` : 'Deadline'
  }
  // Dia inteiro nao tem duracao em minutos que signifique algo: 1440m e ruido.
  return quest.diaInteiro ? 'Foco: dia inteiro' : `Foco: ${duracao(quest)}m`
}

const prazoDoBloco = (quest: QuestCalendario) => {
  const info = infoDePrazo(quest, props.quests)
  if (info.papel !== 'bloco') return ''
  return info.marco ? `Para o prazo de ${quando(info.marco)}` : 'Para um prazo fora da Mochila'
}
</script>

<template>
  <aside class="w-80 border-r-4 border-black bg-[#ff9b71] overflow-y-auto flex flex-col z-10 shadow-[6px_0px_0px_0px_rgba(0,0,0,1)] relative">
    <div class="p-4 border-b-4 border-black bg-[#f4f0e6] sticky top-0 z-20 flex items-center justify-between gap-2">
      <h2 class="font-black text-xl uppercase">🎒 Mochila de Quests</h2>
      <button
        v-if="conectado"
        @click="$emit('recarregar')"
        :disabled="carregando"
        title="Reler do Google Calendar"
        class="border-2 border-black bg-white px-2 py-1 font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
      >
        <span :class="carregando ? 'inline-block animate-spin' : ''">↻</span>
      </button>
    </div>

    <div class="p-4 flex flex-col gap-4">
      <!-- Sem token nao ha o que mostrar: a lista vive no Google, nao aqui. -->
      <div
        v-if="!conectado"
        class="text-center font-bold p-6 border-4 border-black border-dashed bg-[#f4f0e6] opacity-90 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
      >
        Mochila fechada. <br />
        <button
          @click="$emit('conectar')"
          class="mt-3 border-4 border-black bg-white px-3 py-2 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
        >
          Conectar Google Calendar
        </button>
      </div>

      <div
        v-else-if="carregando && quests.length === 0"
        class="text-center font-bold p-6 border-4 border-black border-dashed bg-[#f4f0e6] opacity-90"
      >
        Lendo o calendário...
      </div>

      <div
        v-else-if="quests.length === 0"
        class="text-center font-bold p-6 border-4 border-black border-dashed bg-[#f4f0e6] opacity-90 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
      >
        Nenhuma quest no calendário. <br /> Use a Command Bar!
      </div>

      <a
        v-for="quest in quests"
        :key="quest.eventId"
        :href="quest.htmlLink"
        target="_blank"
        rel="noopener noreferrer"
        class="block border-4 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[4px] hover:translate-y-[4px] transition-all"
      >
        <h3 class="font-bold text-lg leading-tight mb-2">{{ quest.titulo }}</h3>
        <div class="text-sm font-bold flex flex-col gap-1">
          <!-- As duas marcas do evento: dominio (filtro) e membro (responsavel). -->
          <div class="flex items-center gap-1 flex-wrap">
            <span class="bg-black text-white px-2 py-0.5 text-xs uppercase">{{ quest.membro || '?' }}</span>
            <span v-if="quest.dominio" class="border-2 border-black px-2 py-0.5 text-xs uppercase">{{ nomesDeDominio[quest.dominio] ?? quest.dominio }}</span>
          </div>
          <div class="text-gray-800">⏰ {{ rotuloDoTipo(quest) }}</div>
          <div class="text-gray-800 text-xs truncate">📅 {{ quando(quest) }}</div>
          <div v-if="prazoDoBloco(quest)" class="text-gray-800 text-xs truncate">🎯 {{ prazoDoBloco(quest) }}</div>
        </div>
      </a>
    </div>
  </aside>
</template>
