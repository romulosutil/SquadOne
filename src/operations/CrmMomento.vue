<script setup lang="ts">
import { computed, useId } from 'vue'
import CrmTrecho from './CrmTrecho.vue'
import { CARDAPIO, preencher, type LeadDaColinha, type PassoDoRoteiro } from './colinha'

// Um momento do roteiro da colinha (título, objetivo, os textos e as perguntas
// faladas), igual na ficha e na página. `nivel`: na ficha o momento fica sob o
// h3 "Colinha"; na página, sob o h2 "Roteiro".
const props = defineProps<{
  passo: PassoDoRoteiro
  lead?: Pick<LeadDaColinha, 'empresa' | 'links'>
  nivel: 3 | 4
}>()

const idTitulo = useId()
const servico = computed(() => CARDAPIO.find((s) => s.id === props.passo.servico))
</script>

<template>
  <section class="crm-colinha__momento" :aria-labelledby="idTitulo">
    <component :is="`h${nivel}`" :id="idTitulo">{{ passo.titulo }}</component>
    <p v-if="passo.objetivo" class="crm-colinha__objetivo">{{ passo.objetivo }}</p>
    <p v-if="servico" class="crm-colinha__vende">Leva para: <strong>{{ servico.nome }}</strong> ({{ servico.preco }}<template v-if="servico.mensal"> + {{ servico.mensal }}</template>)</p>
    <CrmTrecho v-for="t in passo.trechos" :key="t.id" :trecho="t" :lead="lead" />
    <template v-if="passo.perguntas?.length">
      <p class="crm-colinha__rotulo">Perguntas para a conversa</p>
      <ol class="crm-colinha__perguntas">
        <li v-for="(p, i) in passo.perguntas" :key="i">{{ preencher(p, lead) }}</li>
      </ol>
    </template>
  </section>
</template>
