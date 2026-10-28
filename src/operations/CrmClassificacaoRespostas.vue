<script setup lang="ts">
import { computed } from 'vue'
import { ROTULOS_DA_CLASSIFICACAO, type ClasseDaResposta, type resumoDasRespostas } from './classificacao-resposta'
const props = defineProps<{ resumo: ReturnType<typeof resumoDasRespostas>; periodo: string }>()
const recortes = computed(() => Object.entries(props.resumo.classes).filter(([classe]) => classe !== 'nao-contatado')
  .map(([classe,quantos]) => ({ classe,quantos,rotulo:ROTULOS_DA_CLASSIFICACAO[classe as ClasseDaResposta] })))
</script>
<template>
  <section class="crm-grupo" aria-labelledby="crm-classificacao-respostas">
    <header class="crm-grupo__cabeca"><h2 id="crm-classificacao-respostas">O que as respostas mostram</h2></header>
    <p class="crm-grupo__explicacao">{{ resumo.enviados }} contatos com envio registrado · {{ periodo === 'tudo' ? 'todo o histórico disponível' : `últimos ${periodo} dias` }}. Cada contato aparece em um recorte; os números mostram o estado atual, com tempos de observação diferentes.</p>
    <dl class="recortes-respostas" aria-label="Respostas por significado">
      <div v-for="r in recortes" :key="r.classe"><dt>{{ r.rotulo }}</dt><dd>{{ r.quantos }}</dd></div>
    </dl>
    <p class="crm-nota-pequena">Sem resposta: {{ resumo.leituraSemResposta }} com leitura confirmada e {{ resumo.semLeituraSemResposta }} sem leitura confirmada. Silêncio não comprova desinteresse.</p>
    <p class="crm-nota-pequena">Permissão e acesso ao responsável não são interesse comercial. Interesse explícito ainda exige dor, impacto e decisor confirmados antes de uma proposta. {{ resumo.revisar }} contatos precisam de revisão de contexto. Classificações e eventos originais permanecem no histórico.</p>
  </section>
</template>
<style scoped>
.recortes-respostas { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--esp-3); }
.recortes-respostas dt { font-weight: var(--peso-forte); }
.recortes-respostas dd { margin: var(--esp-1) 0 0; }
</style>
