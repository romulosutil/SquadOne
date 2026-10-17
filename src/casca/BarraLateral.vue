<script setup lang="ts">
// Barra lateral (a partir de 1024 px): os destinos do perfil, o Pedir (ou o Assistente) e a paleta
// (Ctrl+K). Abaixo de 1024 px some, e quem navega é a barra inferior. No Dell, desde 17/10/2026, os
// destinos são os três menus (Central de comando, o ＋ Assistente e Vendas) e a Manutenção fica
// discreta, junto do Ctrl+K.
import type { Destino } from './destinos'

withDefaults(
  defineProps<{
    destinos: Destino[]
    /** A Manutenção no Dell (destinoDiscreto): fora dos menus, a um toque. */
    discreto?: Destino | null
    atual: Destino['id'] | null
    pedirIndisponivel: string
    pedindo: boolean
    /** "Mac" mostra ⌘K; o resto, Ctrl+K. Só o rótulo muda: os dois atalhos valem. */
    atalho: string
    /** "Pedir", ou "Assistente" no Dell com a flag (RULES 28): o mesmo botão abre o painel dele. */
    rotulo?: string
    subtitulo?: string
  }>(),
  { rotulo: 'Pedir', discreto: null, subtitulo: 'Hoje, agenda e agentes' }
)
defineEmits<{ pedir: []; paleta: [] }>()
</script>

<template>
  <aside class="barra-lateral" aria-label="Navegação">
    <a class="barra-lateral__marca" href="/">
      <span class="barra-lateral__selo" aria-hidden="true">S1</span>
      <span><strong>SquadOne</strong><small>{{ subtitulo }}</small></span>
    </a>

    <button type="button" class="barra-lateral__pedir" :disabled="!!pedirIndisponivel" @click="$emit('pedir')">
      <span aria-hidden="true">＋</span> {{ rotulo }}
      <small v-if="pedirIndisponivel || pedindo">{{ pedirIndisponivel || (rotulo === 'Pedir' ? 'Pedido em andamento' : 'Em andamento') }}</small>
    </button>

    <nav aria-label="Navegação principal">
      <a v-for="d in destinos" :key="d.id" :href="d.href" :aria-current="atual === d.id ? 'page' : undefined">
        <span class="barra-lateral__icone" aria-hidden="true">{{ d.icone }}</span>{{ d.rotulo }}
      </a>
    </nav>

    <a v-if="discreto" class="barra-lateral__discreto" :href="discreto.href" :aria-current="atual === discreto.id ? 'page' : undefined">
      <span class="barra-lateral__icone" aria-hidden="true">{{ discreto.icone }}</span>{{ discreto.rotulo }}
    </a>
    <button type="button" class="barra-lateral__paleta" :class="{ 'barra-lateral__paleta--junto': discreto }" @click="$emit('paleta')">
      Buscar e ir <kbd>{{ atalho }}</kbd>
    </button>
  </aside>
</template>
