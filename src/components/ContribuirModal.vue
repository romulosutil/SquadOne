<script setup lang="ts">
/**
 * Escolha de agentes para contribuir numa quest (Fase 4). Não envia nada: só
 * devolve os ids ao App, que põe o pedido na fila da aba. Por isso fecha a
 * qualquer momento — não há resposta atrasada para agir sobre outra tela.
 */
import { computed, ref } from 'vue'
import type { PropType } from 'vue'
import type { PessoaEscolhivel, QuestCalendario } from '../types'
import { MAX_PESSOAS_POR_PEDIDO } from '../contribuicao'
import { useFecharComEsc } from '../modal'

const props = defineProps({
  quest: { type: Object as PropType<QuestCalendario>, required: true },
  // Pessoas ATIVAS da squad ativa: o servidor recusa qualquer outra com 409.
  pessoas: { type: Array as PropType<PessoaEscolhivel[]>, default: () => [] }
})

const emit = defineEmits<{ pedir: [pessoaIds: string[]]; fechar: [] }>()

useFecharComEsc(() => true, () => emit('fechar'))

// Nada vem marcado: cada agente é uma chamada ao Gemini, e quem paga escolhe.
const marcadas = ref<string[]>([])
const cheio = computed(() => marcadas.value.length >= MAX_PESSOAS_POR_PEDIDO)

const alternar = (id: string) => {
  if (marcadas.value.includes(id)) marcadas.value = marcadas.value.filter((x) => x !== id)
  else if (!cheio.value) marcadas.value = [...marcadas.value, id]
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" @click.self="emit('fechar')">
    <div class="w-full max-w-md border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-3">
      <div class="flex items-start justify-between gap-2">
        <h2 class="font-black text-xl uppercase">🤝 Pedir contribuição</h2>
        <button type="button" class="font-black text-lg leading-none" title="Fechar" @click="emit('fechar')">✕</button>
      </div>
      <p class="font-bold leading-tight">{{ props.quest.titulo }}</p>
      <p class="text-xs">
        Cada agente escreve um bloco na descrição do evento no Google. Seu texto fora dos blocos nunca é alterado.
      </p>
      <ul class="flex flex-col gap-1 max-h-72 overflow-y-auto">
        <li v-for="p in props.pessoas" :key="p.id">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              :checked="marcadas.includes(p.id)"
              :disabled="cheio && !marcadas.includes(p.id)"
              @change="alternar(p.id)"
            />
            <span class="font-bold">{{ p.nome }}</span>
            <span class="text-gray-700">· {{ p.papel }} · {{ p.dominioNome }}</span>
            <span v-if="p.id === props.quest.membro" class="text-xs font-bold">(responsável)</span>
          </label>
        </li>
      </ul>
      <p v-if="cheio" class="text-xs font-bold">Até {{ MAX_PESSOAS_POR_PEDIDO }} agentes por pedido.</p>
      <button
        type="button"
        :disabled="!marcadas.length"
        class="border-4 border-black bg-[#ffdb58] px-4 py-2 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
        @click="emit('pedir', [...marcadas])"
      >
        Pedir
      </button>
    </div>
  </div>
</template>
