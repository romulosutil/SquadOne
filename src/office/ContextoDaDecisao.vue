<script setup lang="ts">
import { computed } from 'vue'
import type { CrmLead } from '../operations/types'
import { papelDaMensagem, textoParaATela } from '../operations/marcadores-da-conversa'
const props = defineProps<{ lead: CrmLead }>()
const mensagens = computed(() => props.lead.conversa?.recentes?.length ? props.lead.conversa.recentes : props.lead.conversa ? [props.lead.conversa.ultima] : [])
function autor(m: typeof mensagens.value[number]) {
  if (m.direcao === 'saida') return 'Você enviou'
  const papel = papelDaMensagem(m.trecho, m.papel)
  return papel === 'robo' ? 'Atendimento automático' : papel === 'recepcao' ? 'Recepção respondeu' : 'Cliente respondeu'
}
function data(em: string) {
  return Number.isFinite(Date.parse(em)) ? new Date(em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Data não informada'
}
</script>
<template>
  <section class="contexto-decisao" aria-label="Contexto observado no WhatsApp">
    <div class="contexto-decisao__titulo"><h4>O que foi dito no WhatsApp</h4><span>Trechos da conversa observada</span></div>
    <ol v-if="mensagens.length">
      <li v-for="(m, i) in mensagens" :key="i" :class="{ 'contexto-decisao__enviada': m.direcao === 'saida' }">
        <div><strong>{{ autor(m) }}</strong><time :datetime="m.em">{{ data(m.em) }}</time></div>
        <p>{{ m.trecho ? textoParaATela(m.trecho) : 'Texto não guardado. Confira a conversa no WhatsApp.' }}</p>
      </li>
    </ol>
    <p v-else class="texto-2">Nenhuma mensagem observada nesta leitura. Confira o WhatsApp antes de escolher a ação.</p>
    <p class="contexto-decisao__limite">O histórico pode estar incompleto. A ficha permite conferir a conversa disponível.</p>
  </section>
</template>
<style scoped>
.contexto-decisao { display: grid; gap: var(--esp-3); min-width: 0; }
.contexto-decisao__titulo { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-2); }
.contexto-decisao h4 { margin: 0; font-size: var(--tam-texto); font-weight: var(--peso-forte); }
.contexto-decisao__titulo span, .contexto-decisao time, .contexto-decisao__limite { font-size: var(--tam-apoio); color: var(--texto-2); }
.contexto-decisao ol { display: grid; gap: var(--esp-3); list-style: none; margin: 0; padding: 0; }
.contexto-decisao li { padding: var(--esp-3) var(--esp-4); border-left: var(--faixa) solid var(--borda); background: var(--superficie-2); border-radius: var(--raio-selo); }
.contexto-decisao li.contexto-decisao__enviada { margin-left: var(--esp-6); border-left: 0; border-right: var(--faixa) solid var(--texto-2); }
.contexto-decisao li > div { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-2); font-size: var(--tam-apoio); }
.contexto-decisao p { margin: 0; overflow-wrap: anywhere; }
.contexto-decisao li p { margin-top: var(--esp-2); white-space: pre-wrap; line-height: 1.6; }
</style>
