<script setup lang="ts">
// Barra inferior do celular (abaixo de 1024 px): metade dos destinos de cada lado do ＋ (destinosDaBarra).
// No Dell, desde 17/10/2026, são os três menus: Central de comando · ＋ Assistente · Vendas. No
// Easypanel, Hoje · Agenda · ＋ Pedir · Escritório · Mais. A partir de 1024 px quem navega é a barra
// lateral. O ＋Pedir só funciona com os agentes neste processo; sem eles fica desabilitado com o
// motivo escrito.
import { computed } from 'vue'
import type { Destino } from './destinos'

const props = withDefaults(
  defineProps<{
    destinos: Destino[]
    atual: Destino['id'] | null
    /** Vazio = Pedir disponível; senão, o motivo curto de não estar. */
    pedirIndisponivel: string
    /** Um pedido rodando: o ＋ diz isso em texto, não só gira. */
    pedindo: boolean
    /** "Pedir", ou "Assistente" no Dell com a flag (RULES 28): o mesmo ＋ abre o painel dele. */
    rotulo?: string
    apos?: number
  }>(),
  { rotulo: 'Pedir' }
)
defineEmits<{ pedir: [] }>()

// O ＋ sempre no meio: com dois destinos, um de cada lado; com quatro, dois.
const meio = computed(() => props.apos ?? Math.ceil(props.destinos.length / 2))
const antes = computed(() => props.destinos.slice(0, meio.value))
const depois = computed(() => props.destinos.slice(meio.value))
</script>

<template>
  <nav class="barra-inferior" aria-label="Navegação principal">
    <a v-for="d in antes" :key="d.id" :href="d.href" :aria-current="atual === d.id ? 'page' : undefined">
      <span class="barra-inferior__icone" aria-hidden="true">{{ d.icone }}</span>{{ d.rotulo }}
    </a>
    <button
      type="button"
      class="barra-inferior__pedir"
      :disabled="!!pedirIndisponivel"
      :aria-describedby="pedirIndisponivel || pedindo ? 'pedir-estado' : undefined"
      @click="$emit('pedir')"
    >
      <span class="barra-inferior__icone" aria-hidden="true">＋</span>{{ rotulo }}
      <small v-if="pedirIndisponivel || pedindo" id="pedir-estado">{{ pedirIndisponivel || 'em andamento' }}</small>
    </button>
    <a v-for="d in depois" :key="d.id" :href="d.href" :aria-current="atual === d.id ? 'page' : undefined">
      <span class="barra-inferior__icone" aria-hidden="true">{{ d.icone }}</span>{{ d.rotulo }}
    </a>
  </nav>
</template>
