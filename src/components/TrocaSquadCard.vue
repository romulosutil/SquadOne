<script setup lang="ts">
/**
 * O modelo achou que a demanda é de outra squad. Ele só propõe: nada troca e
 * nada é reenviado sem um destes cliques.
 */
import type { PropType } from 'vue'
import type { PropostaTrocaSquad } from '../types'

defineProps({
  sugestao: { type: Object as PropType<PropostaTrocaSquad & { id: string }>, required: true },
  desabilitado: { type: Boolean, default: false }
})

const emit = defineEmits<{ trocar: []; reenviar: []; descartar: [] }>()
</script>

<template>
  <div class="border-4 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] shrink-0">
    <span class="bg-black text-white px-2 py-0.5 text-xs uppercase font-bold">🔀 Outra squad</span>
    <h3 class="font-bold text-lg leading-tight mt-2">Levar para a squad {{ sugestao.destino_nome }}?</h3>
    <p class="font-bold text-sm mt-2">{{ sugestao.justificativa }}</p>
    <p class="text-xs font-bold mt-1 opacity-70">Demanda: {{ sugestao.demanda }}</p>
    <div class="flex items-stretch gap-2 mt-3">
      <button type="button" :disabled="desabilitado" @click="emit('trocar')"
        class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50">
        Trocar
      </button>
      <button type="button" :disabled="desabilitado" @click="emit('reenviar')"
        class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50">
        Trocar e reenviar
      </button>
      <button type="button" :disabled="desabilitado" title="Descartar a proposta" @click="emit('descartar')"
        class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase disabled:opacity-50">
        ✕
      </button>
    </div>
  </div>
</template>
