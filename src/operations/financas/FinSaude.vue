<script setup lang="ts">
import { computed } from 'vue'
import { diaHora, diaMes, nomesDasConexoes, oQueFazer, ROTULO_DA_SAUDE } from './formato'
import type { ConexaoVista, Situacao } from './types'

// Saúde de cada conexão e "dados até": em toda tela de finanças, porque número
// sem data é número que mente (RULES 2). Cada selo diz de qual conexão é (AC-26):
// pelo Meu Pluggy todas se chamam igual.
const props = defineProps<{ conexoes: ConexaoVista[]; dadosAte: string | null; situacao: Situacao | null }>()
const nomes = computed(() => nomesDasConexoes(props.conexoes))
</script>

<template>
  <section class="fin-saude" aria-label="Fonte dos dados">
    <div class="fin-saude__linha">
      <p class="fin-saude__ate">
        <strong>Dados até {{ diaMes(dadosAte) }}</strong>
        <span v-if="situacao?.ultimaSincronizacao?.fim"> · lido em {{ diaHora(situacao.ultimaSincronizacao.fim) }}</span>
        <span v-else> · ainda não lido</span>
      </p>
      <!-- O "Atualizar agora" da tela (AC-25): ao lado da data que ele muda. -->
      <slot />
    </div>
    <p v-if="situacao?.problema" class="fin-aviso">{{ situacao.problema }}</p>
    <ul v-if="conexoes.length" class="fin-saude__lista">
      <li v-for="(c, i) in conexoes" :key="c.itemId" :class="`is-${c.saude}`">
        <span class="fin-pilula" :class="`is-${c.saude}`">{{ ROTULO_DA_SAUDE[c.saude] }}</span>
        <span class="fin-saude__nome">{{ nomes[i] }}</span>
        <small>até {{ diaMes(c.dadosAte) }}</small>
        <small v-if="c.erroLeitura" class="fin-saude__detalhe">Leitura falhou: {{ c.erroLeitura }}</small>
        <small v-else-if="oQueFazer(c.status)" class="fin-saude__detalhe">{{ oQueFazer(c.status) }}</small>
      </li>
    </ul>
  </section>
</template>
