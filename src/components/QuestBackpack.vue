<script setup lang="ts">
import { computed, onUnmounted, ref, type PropType } from 'vue'
import type { EstadoDeContribuicao, QuestCalendario } from '../types'
import { diasDoEventoDiaInteiro, infoDePrazo, questTerminou } from '../mochila'
import { idsParaRepetir, linhasDeStatus } from '../contribuicao'

const props = defineProps({
  // Vem de GET /api/mochila, ou seja, do Google Calendar. Nada aqui e estado
  // local do app: apagar o evento no Google some com o card na proxima leitura.
  quests: { type: Array as PropType<QuestCalendario[]>, default: () => [] },
  conectado: { type: Boolean, default: false },
  carregando: { type: Boolean, default: false },
  // id -> nome dos domínios da squad ativa. Ids novos são `<squad>--<slug>`,
  // feios de ler num badge; sem nome conhecido, cai no id.
  nomesDeDominio: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
  // id -> nome das pessoas da squad ativa. Quem foi arquivado continua dono das
  // quests do domínio (spec Fase 2 §7.11) e aparece como "Nome (arquivado)".
  nomesDePessoa: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
  // Andamento dos pedidos de contribuição desta aba, por eventId (App). Sobrevive
  // a recarregar a Mochila: a contribuição é do evento no Google, não do card.
  contribuicoes: { type: Object as PropType<Record<string, EstadoDeContribuicao>>, default: () => ({}) }
})

defineEmits(['conectar', 'recarregar', 'contribuir', 'repetir'])

// Quest terminada some do card, mas só da VISTA: `props.quests` segue inteira
// para "Bloco i/N" não renumerar quando um bloco passa. O relógio anda sozinho
// para o card sumir no horário sem esperar a próxima leitura do Google.
const agora = ref(Date.now())
const relogio = setInterval(() => { agora.value = Date.now() }, 30_000)
onUnmounted(() => clearInterval(relogio))
const visiveis = computed(() => props.quests.filter((q) => !questTerminou(q, agora.value)))

// Na fila ou rodando: um segundo pedido juntaria na fila de qualquer jeito, mas
// o botão ativo daria a impressão de que nada aconteceu.
const ocupada = (quest: QuestCalendario) => {
  const e = props.contribuicoes[quest.eventId]
  return e?.estado === 'fila' || e?.estado === 'rodando'
}

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
        v-else-if="carregando && visiveis.length === 0"
        class="text-center font-bold p-6 border-4 border-black border-dashed bg-[#f4f0e6] opacity-90"
      >
        Lendo o calendário...
      </div>

      <div
        v-else-if="visiveis.length === 0"
        class="text-center font-bold p-6 border-4 border-black border-dashed bg-[#f4f0e6] opacity-90 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
      >
        Nenhuma quest no calendário. <br /> Use a Command Bar!
      </div>

      <!-- article com link e rodapé IRMÃOS: botão dentro de <a> é HTML inválido e
           o clique abriria o Google. Sem translação no hover: com rodapé, o card
           andando desalinharia o botão. -->
      <article
        v-for="quest in visiveis"
        :key="quest.eventId"
        class="border-4 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
      >
        <a
          :href="quest.htmlLink"
          target="_blank"
          rel="noopener noreferrer"
          class="block p-3 hover:bg-[#fff7d6] transition-colors"
        >
          <h3 class="font-bold text-lg leading-tight mb-2">{{ quest.titulo }}</h3>
          <div class="text-sm font-bold flex flex-col gap-1">
            <!-- As duas marcas do evento: dominio (filtro) e membro (responsavel). -->
            <div class="flex items-center gap-1 flex-wrap">
              <span class="bg-black text-white px-2 py-0.5 text-xs uppercase">{{ nomesDePessoa[quest.membro] ?? (quest.membro || '?') }}</span>
              <span v-if="quest.dominio" class="border-2 border-black px-2 py-0.5 text-xs uppercase">{{ nomesDeDominio[quest.dominio] ?? quest.dominio }}</span>
            </div>
            <div class="text-gray-800">⏰ {{ rotuloDoTipo(quest) }}</div>
            <div class="text-gray-800 text-xs truncate">📅 {{ quando(quest) }}</div>
            <div v-if="prazoDoBloco(quest)" class="text-gray-800 text-xs truncate">🎯 {{ prazoDoBloco(quest) }}</div>
          </div>
        </a>
        <footer class="border-t-2 border-black px-3 py-2 flex flex-col gap-1 text-xs font-bold">
          <button
            type="button"
            :disabled="ocupada(quest)"
            class="self-start border-2 border-black bg-[#ffdb58] px-2 py-1 font-black uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
            @click="$emit('contribuir', quest)"
          >
            🤝 Pedir contribuição
          </button>
          <template v-if="contribuicoes[quest.eventId]">
            <div
              v-for="(linha, i) in linhasDeStatus(contribuicoes[quest.eventId], nomesDePessoa)"
              :key="i"
              :class="linha.erro ? 'text-red-700' : 'text-gray-800'"
            >
              {{ linha.texto }}
            </div>
            <button
              v-if="idsParaRepetir(contribuicoes[quest.eventId]).length"
              type="button"
              class="self-start underline"
              @click="$emit('repetir', quest.eventId, idsParaRepetir(contribuicoes[quest.eventId]))"
            >
              Tentar de novo
            </button>
          </template>
        </footer>
      </article>
    </div>
  </aside>
</template>
