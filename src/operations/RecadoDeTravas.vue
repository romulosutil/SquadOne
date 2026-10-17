<script setup lang="ts">
/**
 * O recado único das travas do primeiro contato (17/10/2026, recado-de-travas.ts), o mesmo na Próxima
 * venda, na Triagem e na Ficha. Eram dois avisos empilhados (horário e ritmo) que diziam o problema e
 * não o próximo passo. Uma frase em negrito com o quando, o que continua livre e, só quando é o
 * horário que segura, o "Liberar" como link (a decisão continua sendo do Rômulo, mas é uma, não uma
 * por linha).
 */
import type { RecadoDeTravas } from './recado-de-travas'

defineProps<{
  recado: RecadoDeTravas
  /** O rótulo do "Liberar" (rotuloDoLiberar); sem ele, o link não aparece. */
  rotuloDoLiberar?: string
  /** Uma frase antes do porquê (ex.: "165 primeiros contatos esperando · até 10 hoje"). */
  contagem?: string
  /** Esconde o porquê longo (a Ficha já tem a taxa noutro lugar). */
  semDetalhe?: boolean
}>()
const emit = defineEmits<{ liberar: [] }>()
</script>

<template>
  <p class="recado recado-de-travas" :class="{ 'recado--atencao': !recado.pode }" role="status">
    <strong>{{ recado.titulo }}.</strong>
    <template v-if="recado.continua"> {{ recado.continua }}</template>
    <span v-if="contagem || (!semDetalhe && recado.detalhe)" class="recado-de-travas__porque">
      {{ [contagem, semDetalhe ? '' : recado.detalhe].filter(Boolean).join(' ') }}
    </span>
    <button v-if="recado.podeLiberar && rotuloDoLiberar" type="button" class="recado-de-travas__liberar" @click="emit('liberar')">{{ rotuloDoLiberar }}</button>
  </p>
</template>

<style>
.recado-de-travas { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--esp-1) var(--esp-2); overflow-wrap: anywhere; }
.recado-de-travas__porque { flex-basis: 100%; color: var(--texto-2); font-weight: var(--peso-texto); }
/* Link, não botão: liberar é a exceção (o expediente existe por um motivo medido), não o caminho. */
.recado-de-travas__liberar { min-height: var(--toque); padding: 0; border: 0; background: none; color: var(--texto); font: inherit; font-weight: var(--peso-forte); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.recado-de-travas__liberar:hover { text-decoration-thickness: 2px; }
</style>
