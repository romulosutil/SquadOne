<script setup lang="ts">
// O que o Dell pede ao Rômulo, num cartão só na Hoje (AC-17, 17/10/2026). Era um
// cartão por verificação, com nome de container, caminho de pasta e comando, entre a
// venda e a agenda; o socorro do Hermes já tenta o primeiro remédio de cada falha.
// Aqui fica o título de cada uma (o nome que o dell-status dá ao check) e o caminho
// para o detalhe, que mora só em Mais › Manutenção. Número e textos vêm de
// resumoDoDell, o mesmo do topo e do Mais.
import type { ResumoDoDell } from '../operations/alertas'
import type { DellCheck } from '../operations/types'

defineProps<{ resumo: ResumoDoDell }>()

/** Destino do link: o Mais com a Manutenção e a lista do Dell já abertas. */
const MANUTENCAO = '/mais?abrir=manutencao'

const formatoDoDesde = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const desde = (c: DellCheck) => (c.desde ? `desde ${formatoDoDesde.format(new Date(c.desde))}` : '')
</script>

<template>
  <article class="cartao" :class="{ 'cartao--falha': resumo.vermelhos }" :aria-label="`Dell: ${resumo.textoPrecisam}`">
    <div class="selos">
      <span class="selo" :class="resumo.vermelhos ? 'selo--erro' : 'selo--atencao'">Dell</span>
    </div>
    <!-- O "N falhas precisam de você" é o cabeçalho da Central de comando: o cartão não o repete. -->
    <ul class="dell-alerta__lista">
      <li v-for="c in resumo.precisam" :key="c.id">
        <span class="selo" :class="c.estado === 'falha' ? 'selo--erro' : 'selo--atencao'">{{ c.estado === 'falha' ? 'Falhou' : 'Aviso' }}</span>
        <span>{{ c.nome }}</span>
        <small v-if="c.desde" class="texto-2 texto-pequeno">{{ desde(c) }}</small>
      </li>
    </ul>
    <div class="acoes">
      <a class="botao botao--leve" :href="MANUTENCAO">Ver em Manutenção</a>
    </div>
  </article>
</template>

<style>
.dell-alerta__lista { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.dell-alerta__lista li { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--esp-1) var(--esp-2); overflow-wrap: anywhere; }
</style>
