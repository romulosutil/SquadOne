<script setup lang="ts">
import { useId } from 'vue'
import '../estilos/operacao.css'

withDefaults(defineProps<{ titulo: string; contexto?: string; descricao?: string; tom?: 'neutro' | 'acao' }>(), { tom: 'neutro' })
const tituloId = `painel-${useId()}`
</script>

<template>
  <section class="painel-operacional" :class="{ 'painel-operacional--acao': tom === 'acao' }" :aria-labelledby="tituloId">
    <header class="painel-operacional__cabeca">
      <div>
        <span v-if="contexto" class="painel-operacional__contexto">{{ contexto }}</span>
        <h3 :id="tituloId">{{ titulo }}</h3>
        <p v-if="descricao">{{ descricao }}</p>
      </div>
      <slot name="estado" />
    </header>
    <div class="painel-operacional__corpo"><slot /></div>
    <footer v-if="$slots.acoes" class="painel-operacional__acoes"><slot name="acoes" /></footer>
  </section>
</template>
