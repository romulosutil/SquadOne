<script setup lang="ts">
import { computed } from 'vue'
import { ROTULO_DO_ESTADO, ROTULO_DO_TRILHO, jornadaDoLead, passoAtual, passoDaJornada } from './jornada'
import { dataCurta, textoDaSubEtapa } from './crm-formato'
import type { CrmLead } from './types'

// Onde o lead está na jornada (jornada.ts), numa linha: "Passo 8 de 11" e uma barra. A trilha
// inteira fica dobrada (16/10/2026): eram onze etiquetas com borda à vista, as pendentes
// tracejadas, e o olho tinha de achar a amarela no meio delas. Só lê o lead.
const props = defineProps<{ lead: CrmLead }>()

const passos = computed(() => jornadaDoLead(props.lead))
const atual = computed(() => passoDaJornada(passoAtual(props.lead)))
// O Perdido não está no caminho (jornada.ts): nele não há "passo N de M", só o nome.
const posicao = computed(() => passos.value.findIndex((p) => p.estado === 'agora'))
const porcento = computed(() => (posicao.value < 0 ? 100 : Math.round(((posicao.value + 1) / passos.value.length) * 100)))
// A sub-etapa da cabeça costuma ser o mesmo nome do passo: repetir só quando ela diz outra coisa.
const nomeAqui = computed(() => (atual.value.nome === textoDaSubEtapa(props.lead.subEtapa) ? '' : atual.value.nome))
const GLIFO = { feito: '✓', agora: '●', depois: '○', 'sem-registro': '?' } as const
</script>

<template>
  <div class="crm-jornada">
    <p class="crm-jornada__onde">
      <template v-if="posicao >= 0">Passo {{ posicao + 1 }} de {{ passos.length }}<template v-if="nomeAqui">: {{ nomeAqui }}</template></template>
      <template v-else>{{ atual.nome }}</template>
    </p>
    <div class="crm-jornada__barra" aria-hidden="true"><span :style="{ width: `${porcento}%` }" /></div>

    <details class="dobra crm-jornada__passos">
      <summary>Ver os {{ passos.length }} passos</summary>
      <!-- Só a posição (AC-12): o "Para avançar: …" era mais uma redação do passo ("Proposta por escrito
           em até 24 h"), ao lado da frase do "Agora". O que tira de cada passo fica no filtro Passo do Funil. -->
      <p class="crm-muted">{{ ROTULO_DO_TRILHO[atual.trilho] }}.</p>
      <ol aria-label="Passos deste lead">
        <li v-for="p in passos" :key="p.passo.id" :class="`is-${p.estado}`" :aria-current="p.estado === 'agora' ? 'step' : undefined">
          <span class="so-leitor">{{ ROTULO_DO_ESTADO[p.estado] }}:</span>
          <span class="crm-jornada__glifo" aria-hidden="true">{{ GLIFO[p.estado] }}</span>
          <span>{{ p.passo.nome }}<template v-if="p.em"> <span class="crm-muted">{{ dataCurta(p.em) }}</span></template></span>
        </li>
      </ol>
    </details>
  </div>
</template>
