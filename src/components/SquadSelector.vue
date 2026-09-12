<script setup lang="ts">
/**
 * Seletor de squad no header. Cada squad é um escritório inteiro; trocar aqui
 * troca Mapa e Mochila. Desabilitado durante um turno: a resposta do turno é da
 * squad em que ele começou.
 */
import type { PropType } from 'vue'
import type { SquadView } from '../types'

defineProps({
  squads: { type: Array as PropType<SquadView[]>, default: () => [] },
  ativaId: { type: String, default: '' },
  desabilitado: { type: Boolean, default: false }
})

const emit = defineEmits<{ trocar: [id: string]; nova: [] }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <label for="squad-ativa" class="font-black text-xs uppercase">Squad</label>
    <select
      id="squad-ativa"
      :value="ativaId"
      :disabled="desabilitado"
      class="border-4 border-black bg-white px-2 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
      @change="emit('trocar', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="s in squads" :key="s.id" :value="s.id">{{ s.nome }}</option>
    </select>
    <button
      type="button"
      :disabled="desabilitado"
      class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all disabled:opacity-50"
      @click="emit('nova')"
    >
      + Nova squad
    </button>
  </div>
</template>
