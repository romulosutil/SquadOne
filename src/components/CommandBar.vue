<script setup lang="ts">
import { ref } from 'vue'
import type { Modo } from '../types'

const emit = defineEmits(['delegate'])

const demanda = ref('')
// Auto por padrao: o modelo escolhe o tipo de cada compromisso. Foco e Prazo
// sao o usuario sobrepondo essa escolha para a demanda inteira — o servidor
// impoe o tipo mesmo que o modelo divirja.
const modo = ref<Modo>('auto')

const MODOS: { valor: Modo; rotulo: string; dica: string }[] = [
  { valor: 'auto', rotulo: 'Auto', dica: 'O squad decide entre bloco de foco e prazo' },
  { valor: 'foco', rotulo: 'Focar Agora', dica: 'Todo compromisso vira bloco de foco' },
  { valor: 'prazo', rotulo: 'Prazo Final', dica: 'Todo compromisso vira deadline' }
]

const onSubmit = () => {
  if (!demanda.value.trim()) return

  emit('delegate', {
    demanda: demanda.value,
    modo: modo.value
  })

  demanda.value = ''
  // Forcar tipo vale para UMA demanda: um Prazo esquecido ligado forcaria a
  // proxima, que o usuario pensou em modo livre.
  modo.value = 'auto'
}
</script>

<template>
  <div class="h-24 border-t-4 border-black bg-[#bbf7d0] px-6 py-4 flex items-center justify-between gap-6 shrink-0 z-20 shadow-[0px_-6px_0px_0px_rgba(0,0,0,1)] relative">

    <div class="flex-1">
      <input
        v-model="demanda"
        @keyup.enter="onSubmit"
        type="text"
        placeholder="Descreva a demanda da Quest..."
        class="w-full h-14 border-4 border-black px-4 font-bold text-lg shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:translate-x-[4px] focus:translate-y-[4px] transition-all bg-white"
      />
    </div>

    <!-- Toggle Neo-Brutalista: tres estados, um segmento por modo -->
    <div
      role="group"
      aria-label="Tipo de agendamento"
      class="flex items-center border-4 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden h-14 select-none font-bold"
    >
      <button
        v-for="(m, i) in MODOS"
        :key="m.valor"
        type="button"
        :title="m.dica"
        :aria-pressed="modo === m.valor"
        class="px-4 h-full flex items-center transition-colors"
        :class="[
          modo === m.valor ? 'bg-[#ffdb58] text-black' : 'text-gray-500 bg-transparent hover:bg-gray-100',
          i < MODOS.length - 1 ? 'border-r-4 border-black' : ''
        ]"
        @click="modo = m.valor"
      >
        {{ m.rotulo }}
      </button>
    </div>

    <button
      @click="onSubmit"
      class="h-14 px-8 border-4 border-black bg-[#3b82f6] text-white font-black text-xl uppercase shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[4px] hover:translate-y-[4px] active:shadow-none active:translate-x-[6px] active:translate-y-[6px] transition-all"
    >
      Delegar Quest
    </button>
  </div>
</template>
