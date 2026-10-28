<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{ inicio: string | null; pendentes: number; disponivel: boolean }>()
const emit = defineEmits<{ atualizado: [] }>()
const motivo = ref(''), conferi = ref(false), salvando = ref(false), erro = ref(''), sucesso = ref('')
async function revisar() {
  if (!props.disponivel || !conferi.value || !motivo.value.trim() || salvando.value) return
  salvando.value = true; erro.value = ''; sucesso.value = ''
  try {
    const r = await fetch('/api/operations/crm/frente/rodada/revisar',{ method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ motivo:motivo.value.trim(), inicioAnterior:props.inicio }) })
    const corpo = await r.json(); if (!r.ok) throw new Error(corpo.error || 'Não foi possível revisar a rodada.')
    motivo.value = ''; conferi.value = false; sucesso.value = 'Nova rodada iniciada após sua revisão. Os contatos anteriores continuam no histórico e no BI.'; emit('atualizado')
  } catch (e) { erro.value = e instanceof Error ? e.message : 'Resultado desconhecido. Atualize a leitura antes de tentar novamente.'; conferi.value = false; emit('atualizado') }
  finally { salvando.value = false }
}
</script>
<template>
  <details class="dobra"><summary>{{ inicio ? 'Revisar a rodada e liberar uma nova' : 'Iniciar rodada com até 10 aguardando resposta' }}</summary>
    <form class="revisar-rodada" @submit.prevent="revisar"><p>Esta revisão encerra a contagem da rodada atual, com {{ pendentes }} contato(s) pendente(s), e inicia outra com até 10 aguardando resposta. Não reenvia mensagens nem muda Vendas. Pausas, recusas, expediente e teto diário permanecem.</p><label class="rotulo">O que foi revisado e por que abrir outra rodada?<textarea v-model="motivo" class="campo" required maxlength="400" rows="3" :disabled="salvando" /></label><label><input v-model="conferi" type="checkbox" :disabled="salvando"> Conferi público, mensagens e encaminhamentos dos contatos sem resposta.</label><button type="submit" class="botao" :disabled="!disponivel || salvando || !conferi || !motivo.trim()">{{ salvando ? 'Registrando revisão…' : 'Registrar revisão e iniciar nova rodada' }}</button><p v-if="erro" class="recado recado--atencao" role="alert">{{ erro }}</p><p v-if="sucesso" class="recado" role="status">{{ sucesso }}</p></form>
  </details>
</template>
<style scoped>.revisar-rodada { display:grid; gap:var(--esp-3); padding-top:var(--esp-3); }.revisar-rodada textarea { width:100%; }.revisar-rodada label { min-height:var(--toque); }.revisar-rodada .botao { white-space:normal; }</style>
