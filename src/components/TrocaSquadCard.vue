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
  <article class="cartao cartao--decisao" :aria-label="`Proposta: levar para a squad ${sugestao.destino_nome}`">
    <div class="selos"><span class="selo selo--forte">Outra squad</span></div>
    <h3>Levar para a squad {{ sugestao.destino_nome }}?</h3>
    <p>{{ sugestao.justificativa }}</p>
    <p class="texto-2 texto-pequeno">Pedido: {{ sugestao.demanda }}</p>
    <p v-if="desabilitado" class="texto-2 texto-pequeno" role="status">Espere o pedido em andamento terminar.</p>
    <div class="acoes">
      <button type="button" class="botao botao--primario" :disabled="desabilitado" @click="emit('reenviar')">Trocar e reenviar</button>
      <button type="button" class="botao" :disabled="desabilitado" @click="emit('trocar')">Só trocar</button>
      <button type="button" class="botao botao--leve" :disabled="desabilitado" @click="emit('descartar')">Descartar</button>
    </div>
  </article>
</template>
