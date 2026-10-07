<script setup lang="ts">
import { diaHora, diaMes, oQueFazer, ROTULO_DA_SAUDE } from './formato'
import type { ConexaoVista, Situacao } from './types'

// Saúde de cada conexão e "dados até": em toda tela de finanças, porque número
// sem data é número que mente (RULES 2).
defineProps<{ conexoes: ConexaoVista[]; dadosAte: string | null; situacao: Situacao | null }>()
</script>

<template>
  <section class="fin-saude" aria-label="Fonte dos dados">
    <p class="fin-saude__ate">
      <strong>Dados até {{ diaMes(dadosAte) }}</strong>
      <span v-if="situacao?.ultimaSincronizacao?.fim"> · lido em {{ diaHora(situacao.ultimaSincronizacao.fim) }}</span>
      <span v-else> · ainda não lido</span>
    </p>
    <p v-if="situacao?.problema" class="fin-aviso">{{ situacao.problema }}</p>
    <ul v-if="conexoes.length" class="fin-saude__lista">
      <li v-for="c in conexoes" :key="c.itemId" :class="`is-${c.saude}`">
        <span class="fin-pilula" :class="`is-${c.saude}`">{{ ROTULO_DA_SAUDE[c.saude] }}</span>
        <span class="fin-saude__nome">{{ c.nome }}</span>
        <small>até {{ diaMes(c.dadosAte) }}</small>
        <small v-if="c.erroLeitura" class="fin-saude__detalhe">Leitura falhou: {{ c.erroLeitura }}</small>
        <small v-else-if="oQueFazer(c.status)" class="fin-saude__detalhe">{{ oQueFazer(c.status) }}</small>
      </li>
    </ul>
  </section>
</template>
