<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { CrmLead } from './types'
import { hashDoContexto } from './revisao-resposta'
const props = defineProps<{ lead: CrmLead; disponivel: boolean }>()
const emit = defineEmits<{ registrado: [] }>()
const aberto = ref(false)
const mensagem = ref('')
const quando = ref('')
const previa = ref<{ hash: string; mensagem: string; enviadoEm: string } | null>(null)
const ocupado = ref(false)
const concluido = ref(false)
const incerto = ref(false)
const erro = ref('')
const titulo = ref<HTMLElement | null>(null)
async function abrir() {
  aberto.value = true
  try { mensagem.value = new URL(props.lead.links.convite ?? '').searchParams.get('text') ?? '' } catch { mensagem.value = '' }
  await nextTick(); titulo.value?.focus()
}
async function revisar() {
  erro.value = ''
  const data = new Date(quando.value)
  if (!Number.isFinite(data.getTime()) || data.getTime() > Date.now() + 60_000) { erro.value = 'Informe o horário em que você realmente enviou, sem data futura.'; return }
  previa.value = { hash: await hashDoContexto(props.lead), mensagem: mensagem.value.trim(), enviadoEm: data.toISOString() }
  await nextTick(); titulo.value?.focus()
}
async function confirmar() {
  if (!previa.value || ocupado.value || incerto.value || concluido.value) return
  ocupado.value = true; erro.value = ''
  try {
    const r = await fetch('/api/operations/crm/decisao/confirmar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'convite', leadId: props.lead.id, contextoHash: previa.value.hash, ...previa.value }) })
    const corpo = await r.json()
    if (!r.ok) { incerto.value = !!corpo.incerto; throw new Error(corpo.error || 'Não foi possível confirmar o registro.') }
    concluido.value = true; emit('registrado')
  } catch (e) { if (e instanceof TypeError) incerto.value = true; erro.value = (e as Error).message } finally { ocupado.value = false }
}
</script>
<template>
  <div class="crm-convite-confirmacao">
    <button v-if="!aberto" type="button" class="botao botao--leve" :disabled="!disponivel" @click="abrir">Já enviei: registrar convite<span class="so-leitor"> de {{ lead.empresa }}</span></button>
    <template v-else>
      <h3 ref="titulo" tabindex="-1">Confirmar envio para {{ lead.empresa }}</h3>
      <p>Abrir o WhatsApp não registra envio. Confirme somente a mensagem que você realmente enviou.</p>
      <form v-if="!previa" class="crm-form" @submit.prevent="revisar">
        <label>Conteúdo enviado<textarea v-model="mensagem" rows="3" maxlength="600" required /></label>
        <label>Quando você enviou? (horário deste aparelho)<input v-model="quando" type="datetime-local" required /></label>
        <button type="submit" class="botao" :disabled="!mensagem.trim() || !quando">Revisar registro do convite</button>
        <button type="button" class="botao botao--leve" @click="aberto = false">Cancelar</button>
      </form>
      <template v-else-if="!concluido">
        <blockquote>{{ previa.mensagem }}</blockquote>
        <p>Enviado em {{ new Date(previa.enviadoEm).toLocaleString('pt-BR') }}. Após a leitura do registro, o contato sai da triagem e passa a Em contato.</p>
        <button type="button" class="botao botao--primario" :disabled="ocupado || incerto || !disponivel" @click="confirmar">{{ ocupado ? 'Salvando…' : 'Confirmar que enviei o convite' }}</button>
        <button v-if="!incerto" type="button" class="botao botao--leve" :disabled="ocupado" @click="previa = null">Voltar e editar</button>
      </template>
      <p v-if="concluido" role="status">Envio registrado. Aguardando a leitura de Vendas para atualizar a triagem.</p>
      <p v-if="erro" role="alert">{{ erro }}</p>
      <p v-if="incerto" role="status">Confira o histórico antes de repetir. Não repetiremos a gravação automaticamente.</p>
      <button v-if="concluido || incerto" type="button" class="botao botao--leve" @click="emit('registrado')">Atualizar leitura</button>
    </template>
  </div>
</template>
