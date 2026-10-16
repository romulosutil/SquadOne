<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
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
// Variantes do mesmo momento ("Ainda sem link" / "Link já enviado"): uma por vez (16/10/2026).
// Empilhadas, eram dois ou três cartões quase iguais, e o olho tinha de achar a diferença
// sozinho. A escolha só troca o que se vê; nada grava. Volta à primeira quando o passo muda.
const escolhido = ref(0)
watch(() => props.passo, () => { escolhido.value = 0 })
const trechoAtual = computed(() => props.passo.trechos[Math.min(escolhido.value, props.passo.trechos.length - 1)])
</script>

<template>
  <section class="crm-colinha__momento" :aria-labelledby="idTitulo">
    <component :is="`h${nivel}`" :id="idTitulo">{{ passo.titulo }}</component>
    <p v-if="passo.objetivo" class="crm-colinha__objetivo">{{ passo.objetivo }}</p>
    <p v-if="servico" class="crm-colinha__vende">Leva para <strong>{{ servico.nome }}</strong> · {{ servico.preco }}<template v-if="servico.mensal"> + {{ servico.mensal }}</template></p>
    <template v-if="passo.trechos.length > 1">
      <div class="escolhas" role="group" :aria-label="`Qual texto de ${passo.titulo}`">
        <button v-for="(t, i) in passo.trechos" :key="t.id" type="button" :aria-pressed="trechoAtual === t" @click="escolhido = i">{{ t.titulo }}</button>
      </div>
      <CrmTrecho v-if="trechoAtual" :key="trechoAtual.id" :trecho="trechoAtual" :lead="lead" titulo-oculto />
    </template>
    <CrmTrecho v-for="t in passo.trechos" v-else :key="t.id" :trecho="t" :lead="lead" />
    <template v-if="passo.perguntas?.length">
      <p class="crm-colinha__rotulo">Perguntas para a conversa</p>
      <ol class="crm-colinha__perguntas">
        <li v-for="(p, i) in passo.perguntas" :key="i">{{ preencher(p, lead) }}</li>
      </ol>
    </template>
  </section>
</template>
