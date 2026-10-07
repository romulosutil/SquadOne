<script setup lang="ts">
// Barra inferior do celular (abaixo de 1024 px): dois destinos, o ＋Pedir no
// meio, mais dois (destinosDaBarra). A partir de 1024 px quem navega é a barra
// lateral. O ＋Pedir só funciona com os agentes neste processo; sem eles fica
// desabilitado com o motivo escrito.
import { computed } from 'vue'
import type { Destino } from './destinos'

const props = defineProps<{
  destinos: Destino[]
  atual: Destino['id'] | null
  /** Vazio = Pedir disponível; senão, o motivo curto de não estar. */
  pedirIndisponivel: string
  /** Um pedido rodando: o ＋ diz isso em texto, não só gira. */
  pedindo: boolean
}>()
defineEmits<{ pedir: [] }>()

const antes = computed(() => props.destinos.slice(0, 2))
const depois = computed(() => props.destinos.slice(2))
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
      <span class="barra-inferior__icone" aria-hidden="true">＋</span>Pedir
      <small v-if="pedirIndisponivel || pedindo" id="pedir-estado">{{ pedirIndisponivel || 'em andamento' }}</small>
    </button>
    <a v-for="d in depois" :key="d.id" :href="d.href" :aria-current="atual === d.id ? 'page' : undefined">
      <span class="barra-inferior__icone" aria-hidden="true">{{ d.icone }}</span>{{ d.rotulo }}
    </a>
  </nav>
</template>
