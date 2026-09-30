<script setup lang="ts">
import { computed, ref } from 'vue'
import { SIGLA_DO_PRODUTO } from './crm-formato'
import type { CrmGrupoHoje, CrmGrupoHojeId, CrmLead } from './types'

// "Hoje": só o que depende do Rômulo, na ordem do servidor (server/crm.ts,
// montarHoje). Cada linha é uma ação e o link que a resolve.
const props = defineProps<{ grupos: CrmGrupoHoje[]; leads: Map<string, CrmLead> }>()
const emit = defineEmits<{ abrir: [leadId: string, origem: HTMLElement | null] }>()

const LIMITE = 5
const abertos = ref<Set<CrmGrupoHojeId>>(new Set())
const visiveis = computed(() => props.grupos.filter(g => g.itens.length))
const total = computed(() => visiveis.value.reduce((soma, g) => soma + g.itens.length, 0))

const itens = (grupo: CrmGrupoHoje) => abertos.value.has(grupo.id) ? grupo.itens : grupo.itens.slice(0, LIMITE)
const alternar = (id: CrmGrupoHojeId) => {
  const proximo = new Set(abertos.value)
  if (proximo.has(id)) proximo.delete(id)
  else proximo.add(id)
  abertos.value = proximo
}
</script>

<template>
  <div class="crm-hoje">
    <p v-if="!total" class="crm-vazio"><strong>Nada esperando você hoje.</strong> Nenhum follow-up, resposta, prospect, proposta ou site pronto neste filtro.</p>
    <section v-for="grupo in visiveis" :key="grupo.id" class="crm-grupo" :class="`is-${grupo.id}`" :aria-labelledby="`crm-grupo-${grupo.id}`">
      <header class="crm-grupo__cabeca">
        <h2 :id="`crm-grupo-${grupo.id}`">{{ grupo.titulo }}</h2>
        <strong :aria-label="`${grupo.itens.length} ${grupo.itens.length === 1 ? 'item' : 'itens'}`">{{ grupo.itens.length }}</strong>
      </header>
      <p class="crm-grupo__explicacao">{{ grupo.explicacao }}</p>
      <ul class="crm-lista">
        <li v-for="item in itens(grupo)" :key="`${grupo.id}-${item.leadId}`" class="crm-item">
          <div class="crm-item__quem">
            <button type="button" class="crm-item__empresa" :data-lead="item.leadId" @click="emit('abrir', item.leadId, $event.currentTarget as HTMLElement)">
              {{ leads.get(item.leadId)?.empresa ?? item.leadId }}
              <span class="ops-visually-hidden">: abrir a ficha</span>
            </button>
            <span class="crm-tag" :class="`is-${leads.get(item.leadId)?.produto}`">{{ SIGLA_DO_PRODUTO[leads.get(item.leadId)?.produto ?? 'site'] }}</span>
          </div>
          <p class="crm-item__acao"><strong>{{ item.acao }}</strong> <span>{{ item.detalhe }}</span></p>
          <div v-if="item.links.length" class="crm-item__links">
            <a v-for="link in item.links" :key="link.url" :href="link.url" target="_blank" rel="noopener">{{ link.rotulo }} <span aria-hidden="true">↗</span></a>
          </div>
        </li>
      </ul>
      <button v-if="grupo.itens.length > LIMITE" type="button" class="crm-mais" :aria-expanded="abertos.has(grupo.id)" @click="alternar(grupo.id)">
        {{ abertos.has(grupo.id) ? 'Mostrar menos' : `Ver todos os ${grupo.itens.length}` }}
      </button>
    </section>
  </div>
</template>
