<script setup lang="ts">
import { computed, useId } from 'vue'
import CrmTrecho from './CrmTrecho.vue'
import { CARDAPIO, type LeadDaColinha, type Objecao } from './colinha'

// Uma objeção da colinha: o que o lead diz, a resposta pronta e para onde ela
// leva a conversa. Igual na ficha (sob o h3 "Colinha") e na página (sob o h2).
const props = defineProps<{
  objecao: Objecao
  lead?: Pick<LeadDaColinha, 'empresa' | 'links'>
  nivel: 3 | 4
}>()

const idTitulo = useId()
const destino = computed(() => CARDAPIO.find((s) => s.id === props.objecao.levaPara))
</script>

<template>
  <section class="crm-colinha__objecao" :aria-labelledby="idTitulo">
    <component :is="`h${nivel}`" :id="idTitulo">Se disser “{{ objecao.fala }}”</component>
    <CrmTrecho :trecho="objecao.resposta" :lead="lead" titulo="Resposta pronta" />
    <p v-if="destino" class="crm-colinha__vende">Leva para <strong>{{ destino.nome }}</strong> · {{ destino.preco }}<template v-if="destino.mensal"> + {{ destino.mensal }}</template></p>
  </section>
</template>
