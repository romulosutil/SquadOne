<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { CrmLead } from './types'
import { hashDoContexto } from './revisao-resposta'
const props = defineProps<{ lead: CrmLead; disponivel: boolean }>()
const emit = defineEmits<{ registrado: [] }>()
const aberto = ref(false)
const decisao = ref<'reabrir' | 'manter'>('reabrir')
const motivo = ref('')
const previa = ref<{ hash: string; decisao: string; motivo: string } | null>(null)
const ocupado = ref(false)
const erro = ref('')
const incerto = ref(false)
const concluido = ref(false)
const titulo = ref<HTMLElement | null>(null)
async function abrir() { aberto.value = true; await nextTick(); titulo.value?.focus() }
async function revisar() { previa.value = { hash: await hashDoContexto(props.lead), decisao: decisao.value, motivo: motivo.value.trim() }; await nextTick(); titulo.value?.focus() }
async function confirmar() {
  if (!previa.value || ocupado.value || incerto.value || concluido.value) return
  ocupado.value = true; erro.value = ''
  try {
    const r = await fetch('/api/operations/crm/decisao/confirmar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'classificacao', leadId: props.lead.id, contextoHash: previa.value.hash, decisao: previa.value.decisao, motivo: previa.value.motivo }) })
    const corpo = await r.json()
    if (!r.ok) { incerto.value = !!corpo.incerto; throw new Error(corpo.error || 'Não foi possível registrar a revisão.') }
    concluido.value = true; emit('registrado')
  } catch (e) { if (e instanceof TypeError) incerto.value = true; erro.value = (e as Error).message } finally { ocupado.value = false }
}
</script>
<template>
  <section class="crm-revisar-classificacao">
    <button v-if="!aberto" type="button" class="botao botao--primario" :disabled="!disponivel" @click="abrir">Revisar classificação</button>
    <template v-else>
      <h3 ref="titulo" tabindex="-1">{{ previa ? 'Conferir decisão' : 'Revisar classificação' }} de {{ lead.empresa }}</h3>
      <p>Confira o histórico do cliente. Esta decisão corrige o acompanhamento no SquadOne e fica registrada em Vendas; não envia mensagens.</p>
      <form v-if="!previa" class="crm-form" @submit.prevent="revisar">
        <label>Como este contato deve ficar?<select v-model="decisao"><option value="reabrir">Reabrir acompanhamento em Em contato</option><option value="manter">Manter a classificação atual, após conferência</option></select></label>
        <label>O que você conferiu e por que está corrigindo?<textarea v-model="motivo" rows="3" maxlength="200" required /></label>
        <button type="submit" class="botao botao--primario" :disabled="!motivo.trim()">Revisar decisão</button>
        <button type="button" class="botao botao--leve" @click="aberto = false">Cancelar</button>
      </form>
      <template v-else-if="!concluido">
        <p><strong>{{ previa.decisao === 'reabrir' ? 'O contato voltará para Em contato.' : 'A classificação atual será mantida e marcada como conferida.' }}</strong></p>
        <p>{{ previa.motivo }}</p>
        <p>O histórico e os combinados serão preservados. Reabrir não autoriza novo contato nem confirma uma venda.</p>
        <button type="button" class="botao botao--primario" :disabled="ocupado || incerto || !disponivel" @click="confirmar">{{ ocupado ? 'Salvando…' : 'Confirmar classificação' }}</button>
        <button v-if="!incerto" type="button" class="botao botao--leve" :disabled="ocupado" @click="previa = null">Voltar e editar</button>
      </template>
      <p v-if="erro" role="alert">{{ erro }}</p>
      <p v-if="concluido" role="status">Revisão registrada. A classificação será atualizada na próxima leitura. Se reabriu, confira ou salve o próximo passo nesta ficha.</p>
      <p v-if="concluido || incerto" class="texto-2" role="status">Vendas acompanha a alteração automaticamente.</p>
      <p v-if="incerto" role="status">Confira a linha do tempo antes de repetir. A gravação não será repetida automaticamente.</p>
    </template>
  </section>
</template>
