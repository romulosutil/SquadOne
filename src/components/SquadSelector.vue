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
  rotulo: { type: String, default: 'Squad' }
})

// "Arquivar a squad" saiu daqui (AC-25, 17/10/2026): rara e de efeito grande, ficava lado a
// lado com Editar. Agora está no fim da folha de editar a squad, com segundo toque.
const emit = defineEmits<{ trocar: [id: string]; nova: []; editar: [] }>()
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
      <button type="button" class="botao botao--leve" :disabled="desabilitado" @click="emit('nova')">Nova squad</button>
    </div>
    <p v-if="desabilitado" class="texto-2 texto-pequeno" role="status">Espere o pedido em andamento terminar para trocar de squad.</p>
  </div>
</template>

<style>
.seletor-squad { display: grid; gap: var(--esp-2); }
.seletor-squad__campo { max-width: 24rem; }
</style>
