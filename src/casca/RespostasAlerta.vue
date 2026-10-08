<script setup lang="ts">
// "Responderam e esperam você" na Hoje (RULES 13, 08/10/2026): os leads do grupo
// "Respostas para responder" do CRM. O link abre o CRM em Hoje, onde cada linha
// tem a conversa e, para quem quer ver, a segunda mensagem pronta. A Hoje não
// manda nada: responder é gesto no WhatsApp (RULES 10).
import { computed } from 'vue'
import { dataHora } from '../operations/crm-formato'
import { textoDaPendenciaDeRespostas, type PendenciaDeRespostas } from './hoje'

const props = defineProps<{ pendencia: PendenciaDeRespostas }>()

const texto = computed(() => textoDaPendenciaDeRespostas(props.pendencia))
</script>

<template>
  <article class="cartao respostas-alerta" :aria-label="`Funil: ${texto.titulo}`">
    <div class="selos">
      <span class="selo selo--atencao">Funil · resposta</span>
    </div>
    <h3>{{ texto.titulo }}</h3>
    <p v-if="texto.detalhe">{{ texto.detalhe }}</p>
    <p v-if="pendencia.primeiro.respondeuEm" class="texto-2 texto-pequeno">
      {{ pendencia.quantos === 1 ? 'Respondeu' : 'A mais antiga respondeu' }} em {{ dataHora(pendencia.primeiro.respondeuEm) }}.
    </p>
    <div class="acoes">
      <a class="botao botao--leve" href="/crm">Responder pelo CRM<span class="so-leitor">: {{ texto.titulo }}</span></a>
    </div>
  </article>
</template>

<style>
.respostas-alerta { border-left-width: 8px; border-left-color: var(--acento); }
</style>
