<script setup lang="ts">
// O alerta de finanças em semáforo na Hoje (RULES 13): só laranja e vermelho
// chegam aqui (`pendenciasDeFinancas`). Só % e o nome do banco — nenhum R$ nem
// estabelecimento (RULES 24): a Hoje é a tela que aparece em print e por cima
// do ombro. Os valores ficam em /financas, que o link abre.
import { computed } from 'vue'
import { ROTULO_DO_SEMAFORO, diaMes } from '../operations/financas/formato'
import { textoDaPendenciaDeFinancas, type PendenciaDeFinancas } from './hoje'

const props = defineProps<{ pendencia: PendenciaDeFinancas }>()

const texto = computed(() => textoDaPendenciaDeFinancas(props.pendencia))
const rotulo = computed(() => ROTULO_DO_SEMAFORO[props.pendencia.semaforo])
</script>

<template>
  <article class="cartao financas-alerta" :data-semaforo="pendencia.semaforo" :aria-label="`Finanças, ${rotulo}: ${texto}`">
    <div class="selos">
      <span class="selo" :class="pendencia.semaforo === 'vermelho' ? 'selo--erro' : 'selo--atencao'">Finanças · {{ rotulo }}</span>
    </div>
    <h3>{{ texto }}</h3>
    <p v-if="pendencia.dadosAte" class="texto-2 texto-pequeno">Dados até {{ diaMes(pendencia.dadosAte) }}.</p>
    <div class="acoes">
      <a class="botao botao--leve" href="/financas">Abrir Finanças<span class="so-leitor">: {{ texto }}</span></a>
    </div>
  </article>
</template>

<style>
/* Mesmas cores do semáforo na aba Finanças e na Sala Finanças: laranja no
   acento, vermelho no negativo com o fundo de erro. A palavra vem no selo. */
.financas-alerta { border-left-width: 8px; }
.financas-alerta[data-semaforo='laranja'] { border-left-color: var(--acento); }
.financas-alerta[data-semaforo='vermelho'] { border-left-color: var(--negativo); }
</style>
