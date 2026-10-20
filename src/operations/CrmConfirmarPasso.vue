<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { acaoDoLead, type AcaoDeVenda } from './proxima-venda'
import type { CrmLead, CrmVisao } from './types'
const props = defineProps<{ lead: CrmLead; acao: AcaoDeVenda; disponivel: boolean }>()
const emit = defineEmits<{ registrado: [] }>()
const estado = ref<'pronto' | 'salvando' | 'aguardando' | 'falhou'>('pronto')
const aviso = ref('')
const igual = ref(false)
const chave = computed(() => `${props.lead.id}|${props.acao.chave}|${props.acao.textoDoRegistro}`)
watch(chave, () => { estado.value = 'pronto'; aviso.value = ''; igual.value = false })
const bloqueado = computed(() => !props.disponivel || estado.value === 'salvando' || estado.value === 'aguardando')
async function confirmar() {
  if (bloqueado.value || !igual.value) return
  const identidade = chave.value
  const a = props.acao, lead = props.lead
  estado.value = 'salvando'; aviso.value = ''
  try {
    // Antes da confirmação, relê a fonte; uma resposta nova ou outro degrau invalida o cartão antigo.
    const leitura = await fetch('/api/operations/crm', { cache: 'no-store' })
    if (!leitura.ok) throw new Error('Não foi possível reler a Ficha.')
    const visao = await leitura.json() as CrmVisao
    if (chave.value !== identidade) return
    const atual = visao.estado === 'ok' ? acaoDoLead(visao, lead.id, Date.now()) : null
    if (!atual || atual.chave !== a.chave || atual.anota !== a.anota || atual.textoDoRegistro !== a.textoDoRegistro || atual.rascunho !== a.rascunho) throw new Error('A conversa ou o passo mudou. Releia a Ficha antes de confirmar.')
    const r = await fetch('/api/operations/crm/venda/anotar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: a.chave, produto: lead.produto, id: lead.chave, tipo: a.anota, texto: a.textoDoRegistro }) })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(corpo.error ?? `HTTP ${r.status}`)
    if (chave.value !== identidade) return
    estado.value = 'aguardando'
    aviso.value = corpo.jaEstava ? 'Este envio já estava registrado. Aguardando a Ficha atualizada.' : 'Envio confirmado. Aguardando a Ficha atualizada.'
    emit('registrado')
  } catch (erro) {
    if (chave.value !== identidade) return
    estado.value = 'falhou'; aviso.value = erro instanceof Error ? erro.message : String(erro)
  }
}
</script>
<template>
  <section aria-label="Confirmar envio deste passo" class="crm-confirmar-passo">
    <p><strong>{{ acao.titulo }}</strong></p>
    <blockquote>{{ acao.rascunho }}</blockquote>
    <a v-if="acao.link" class="botao" :href="acao.link.url" target="_blank" rel="noopener">Abrir no WhatsApp com esta mensagem</a>
    <p class="crm-nota-pequena">Abrir não registra envio. Confirme somente depois de enviar. Esta confirmação guarda o degrau da cadência ou a versão do follow-up que saiu de verdade.</p>
    <label><input v-model="igual" type="checkbox" :disabled="bloqueado">Enviei a mensagem exibida, sem alterar o texto.</label>
    <button class="botao" type="button" :disabled="bloqueado || !igual" @click="confirmar">{{ estado === 'salvando' ? 'Conferindo…' : 'Enviei esta mensagem' }}</button>
    <p v-if="aviso" role="status" class="recado">{{ aviso }}</p>
  </section>
</template>
