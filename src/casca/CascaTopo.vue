<script setup lang="ts">
// Topo da casca: a marca (no celular, onde não há barra lateral), o dia, o pedido em andamento e,
// no Dell, a engrenagem da Manutenção. Tudo com texto; o ponto colorido só reforça (RULES 3).
//
// O chip do Dell saiu daqui em 17/10/2026: o número "N precisam de você" aparecia no topo, na Hoje
// e no Mais. Agora mora num lugar só, o cabeçalho da Central de comando, que também tem o Atualizar.
import type { Destino } from './destinos'

defineProps<{
  nome: string
  /** A Manutenção no Dell (destinoDiscreto); null no Easypanel, onde o Mais está na barra. */
  discreto: Destino | null
  atual: Destino['id'] | null
  pedindo: boolean
}>()

const hoje = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
</script>

<template>
  <header class="topo">
    <a class="topo__marca" href="/"><span aria-hidden="true">S1</span> SquadOne</a>
    <p class="topo__dia"><span v-if="nome">Olá, {{ nome }} · </span>{{ hoje }}</p>
    <div class="topo__estados">
      <p v-if="pedindo" class="topo__chip is-pendente" role="status">Pedido em andamento</p>
      <a
        v-if="discreto"
        class="topo__discreto"
        :href="discreto.href"
        :aria-current="atual === discreto.id ? 'page' : undefined"
        :aria-label="discreto.rotulo"
        :title="discreto.rotulo"
      ><span aria-hidden="true">{{ discreto.icone }}</span></a>
    </div>
  </header>
</template>
