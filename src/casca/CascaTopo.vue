<script setup lang="ts">
// Topo da casca: a marca (no celular, onde não há barra lateral), o dia, o
// estado do Dell (só no perfil operations, do status.json) e o pedido em
// andamento. Tudo com texto; o ponto colorido só reforça (RULES 3).
import { computed } from 'vue'
import { useOverview } from './overview'

const props = defineProps<{
  nome: string
  /** null = perfil sem Dell (Easypanel): o chip não aparece, em vez de dizer "tudo certo". */
  dell: { carregando: boolean; falhas: number; semLeitura: boolean; conferidoEm: string; erro: string } | null
  pedindo: boolean
}>()
defineEmits<{ atualizar: [] }>()

// O número e o instante vêm do mesmo resumo da Hoje e do Mais (AC-17): o topo dizia
// "3 com falha" enquanto a Hoje dizia "9 coisas" e o Mais "43 de 49 ok".
const { resumo } = useOverview()

const hoje = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
const estadoDoDell = computed(() => {
  const d = props.dell
  if (!d) return null
  if (d.erro) return { tom: 'falha', texto: 'Dell sem resposta', quando: '' }
  if (d.carregando && d.semLeitura) return { tom: 'pendente', texto: 'Conferindo o Dell', quando: '' }
  return resumo.value.topo
})
</script>

<template>
  <header class="topo">
    <a class="topo__marca" href="/"><span aria-hidden="true">S1</span> SquadOne</a>
    <p class="topo__dia"><span v-if="nome">Olá, {{ nome }} · </span>{{ hoje }}</p>
    <div class="topo__estados">
      <p v-if="pedindo" class="topo__chip is-pendente" role="status">Pedido em andamento</p>
      <p v-if="estadoDoDell" class="topo__chip" :class="`is-${estadoDoDell.tom}`" role="status">
        {{ estadoDoDell.texto }}<small v-if="estadoDoDell.quando"> {{ estadoDoDell.quando }}</small>
      </p>
      <button v-if="dell" type="button" class="botao botao--leve" :disabled="dell.carregando" @click="$emit('atualizar')">
        {{ dell.carregando ? 'Lendo…' : 'Atualizar' }}<span class="so-leitor"> o estado do Dell</span>
      </button>
    </div>
  </header>
</template>
