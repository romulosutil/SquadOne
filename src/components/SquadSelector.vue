<script setup lang="ts">
/**
 * Seletor de squad (o "andar" do Escritório). Cada squad é um escritório
 * inteiro; trocar aqui troca o Escritório, a agenda e o Pedir. Desabilitado
 * durante um turno: a resposta do turno é da squad em que ele começou.
 */
import type { PropType } from 'vue'
import type { SquadView } from '../types'

defineProps({
  squads: { type: Array as PropType<SquadView[]>, default: () => [] },
  ativaId: { type: String, default: '' },
  desabilitado: { type: Boolean, default: false },
  // Falso com uma squad ativa só: a última não se arquiva.
  podeArquivar: { type: Boolean, default: false },
  rotulo: { type: String, default: 'Squad' }
})

const emit = defineEmits<{ trocar: [id: string]; nova: []; editar: []; arquivar: [] }>()
</script>

<template>
  <div class="seletor-squad">
    <label class="rotulo seletor-squad__campo">
      {{ rotulo }}
      <select
        class="campo"
        :value="ativaId"
        :disabled="desabilitado"
        @change="emit('trocar', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="s in squads" :key="s.id" :value="s.id">{{ s.nome }}</option>
      </select>
    </label>
    <div class="acoes">
      <button type="button" class="botao botao--leve" :disabled="desabilitado" @click="emit('editar')">Editar a squad</button>
      <button type="button" class="botao botao--leve" :disabled="desabilitado || !podeArquivar" @click="emit('arquivar')">Arquivar a squad</button>
      <button type="button" class="botao botao--leve" :disabled="desabilitado" @click="emit('nova')">Nova squad</button>
    </div>
    <p v-if="desabilitado" class="texto-2 texto-pequeno" role="status">Espere o pedido em andamento terminar para trocar de squad.</p>
    <p v-else-if="!podeArquivar" class="texto-2 texto-pequeno">A última squad ativa não se arquiva.</p>
  </div>
</template>

<style>
.seletor-squad { display: grid; gap: var(--esp-2); }
.seletor-squad__campo { max-width: 24rem; }
</style>
