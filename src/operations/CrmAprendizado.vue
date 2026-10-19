<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CrmLead } from './types'
import { aprendizadoDoLead, direcaoDoLead, notaDoAprendizado, RESULTADOS_DO_TESTE, ROTULO_DO_TESTE, type ResultadoDoTeste } from './aprendizado-comercial'

const props = defineProps<{ lead: CrmLead; disponivel: boolean; salvando: boolean }>()
const emit = defineEmits<{ salvar: [texto: string] }>()
const fato = ref(''), hipotese = ref(''), teste = ref('')
const resultado = ref<ResultadoDoTeste>('em-teste')
const pausarAteResposta = ref(false)
const erro = ref('')
const guardado = computed(() => aprendizadoDoLead(props.lead))
watch(() => `${props.lead.id}|${guardado.value?.em ?? ''}`, () => {
  fato.value = guardado.value?.fato ?? ''
  hipotese.value = guardado.value?.hipotese ?? ''
  teste.value = guardado.value?.teste ?? ''
  resultado.value = guardado.value?.resultado ?? 'em-teste'
  pausarAteResposta.value = guardado.value?.pausarAteResposta === true
  erro.value = ''
}, { immediate: true })
function salvar() {
  try {
    erro.value = ''
    emit('salvar', notaDoAprendizado({ fato: fato.value, hipotese: hipotese.value, teste: teste.value, resultado: resultado.value, pausarAteResposta: pausarAteResposta.value }))
  } catch (e) { erro.value = e instanceof Error ? e.message : String(e) }
}
</script>

<template>
  <details class="dobra">
    <summary>O que este lead ensinou <span v-if="guardado" class="crm-muted">· {{ ROTULO_DO_TESTE[guardado.resultado] }}</span></summary>
    <p class="crm-nota-pequena">{{ direcaoDoLead(lead) }}</p>
    <p class="crm-nota-pequena">Registre uma mudança por teste. Uma resposta isolada não muda a estratégia automaticamente. Salvar aqui não agenda nem envia mensagens.</p>
    <form class="crm-form" @submit.prevent="salvar">
      <label><span>Fato observado (mensagem ou ação, sem interpretação)</span><textarea v-model="fato" required maxlength="220" rows="2" /></label>
      <label><span>Hipótese que queremos verificar</span><textarea v-model="hipotese" required maxlength="220" rows="2" /></label>
      <label><span>Próximo teste e sinal de sucesso</span><textarea v-model="teste" required maxlength="220" rows="2" /></label>
      <label><span>Resultado observado</span><select v-model="resultado"><option v-for="r in RESULTADOS_DO_TESTE" :key="r" :value="r">{{ ROTULO_DO_TESTE[r] }}</option></select></label>
      <label><input v-model="pausarAteResposta" type="checkbox"> Pausar sugestões de contato até ele responder (ou eu desmarcar e salvar)</label>
      <p class="crm-nota-pequena">A pausa tira este lead das Conversas para você, inclusive no Telegram. Uma nova mensagem humana guardada depois deste registro libera a fila; recibo de leitura não libera.</p>
      <button class="botao" type="submit" :disabled="!disponivel || salvando">{{ salvando ? 'Salvando…' : 'Salvar aprendizado' }}</button>
      <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
    </form>
  </details>
</template>
