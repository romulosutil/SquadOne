<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CrmLead } from './types'
import { GRUPOS_DE_RETOMADA, revisaoRetomadaDoLead } from './revisao-retomadas'
const props = defineProps<{ leads: CrmLead[] }>()
const grupo = ref('todos')
const revisadas = computed(() => props.leads.flatMap(lead => {
  const revisao = revisaoRetomadaDoLead(lead)
  return revisao ? [{ lead, revisao }] : []
}).sort((a,b) => Object.keys(GRUPOS_DE_RETOMADA).indexOf(a.revisao.grupo) - Object.keys(GRUPOS_DE_RETOMADA).indexOf(b.revisao.grupo) || a.lead.empresa.localeCompare(b.lead.empresa)))
const visiveis = computed(() => revisadas.value.filter(r => grupo.value === 'todos' || (grupo.value === 'mudou' ? !r.revisao.atual : r.revisao.atual && r.revisao.grupo === grupo.value)))
const data = (em:string) => new Date(em).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
</script>
<template>
  <section v-if="revisadas.length" class="crm-grupo" aria-label="Retomadas revisadas">
    <header class="crm-grupo__cabeca"><h2>Retomadas revisadas · {{ revisadas.length }}</h2></header>
    <p class="crm-nota-pequena">Revisão analítica do histórico disponível. Os textos são rascunhos internos; não confirmam reunião nem autorizam envio. Pausas e próximos passos existentes continuam valendo.</p>
    <label v-if="revisadas.length > 1">Separar por decisão
      <select v-model="grupo">
        <option value="todos">Todos os recortes</option>
        <option v-for="(rotulo,chave) in GRUPOS_DE_RETOMADA" :key="chave" :value="chave">{{ rotulo }} · {{ revisadas.filter(r => r.revisao.atual && r.revisao.grupo === chave).length }}</option>
        <option value="mudou">Contexto mudou · {{ revisadas.filter(r => !r.revisao.atual).length }}</option>
      </select>
    </label>
    <details v-for="{lead,revisao} in visiveis" :key="lead.id" class="dobra revisao-retomada">
      <summary>{{ lead.empresa }} · {{ revisao.atual ? GRUPOS_DE_RETOMADA[revisao.grupo] : 'Contexto mudou · revisar novamente' }}</summary>
      <p class="crm-nota-pequena">Revisado em {{ data(revisao.em) }} · {{ lead.produto }}</p>
      <p>{{ revisao.fato }}</p>
      <template v-if="revisao.atual">
        <p><strong>Próximo passo interno:</strong> {{ revisao.proximo }}</p>
        <p><strong>Condição para usar o texto:</strong> {{ revisao.condicao }}</p>
        <blockquote v-if="revisao.rascunho">{{ revisao.rascunho }}</blockquote>
        <p v-else class="crm-nota-pequena">Sem mensagem sugerida enquanto faltar contexto ou houver restrição.</p>
      </template>
      <p v-else>Houve mudança desde a revisão. O rascunho ficou oculto; confira a conversa atual e o último combinado.</p>
    </details>
  </section>
</template>
<style scoped>
.revisao-retomada { margin-block: var(--esp-3); }
select { display:block; max-width:100%; margin-block:var(--esp-2); }
blockquote { white-space:pre-wrap; margin-inline:0; padding-inline-start:var(--esp-3); border-inline-start:2px solid currentColor; }
</style>
