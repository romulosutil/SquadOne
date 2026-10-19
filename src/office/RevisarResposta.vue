<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { diaEmSP } from '../operations/retomadas'
import { guardarRascunhoDaVenda, lerRascunhoDaVenda, voltarAosPassos, apenasPreparar } from './rascunhos'
import { acompanharVenda } from './andamento'
import type { CrmLead } from '../operations/types'
import { impedimentoDaMensagem, linkDoRaioXParaMensagem, whatsappParaRevisao } from '../operations/revisao-resposta'

const props = defineProps<{ lead: CrmLead; mensagem: string; contextoHash?: string; rascunhoId?: string; aberturaAnterior?: boolean; preparadaPara?: string }>()
const emit = defineEmits<{ revisada: []; ficha: []; atualizar: [] }>()
function lerRascunho(): { texto: string; aberturaSolicitada: boolean } | null {
  try {
    if (!props.rascunhoId) return null
    const salvo = JSON.parse(sessionStorage.getItem(`squadone.revisao.${props.rascunhoId}`) ?? 'null')
    return salvo?.contextoHash === props.contextoHash && salvo?.base === props.mensagem && typeof salvo.texto === 'string' && salvo.texto.length <= 2000 && typeof salvo.aberturaSolicitada === 'boolean' ? salvo : null
  } catch { return null }
}
const acompanhar = inject(acompanharVenda, undefined)
const voltar = inject(voltarAosPassos, undefined)
const salvo = lerRascunho()
const texto = ref(salvo?.texto ?? props.mensagem)
const validando = ref(false)
const url = ref('')
const aberturaSolicitada = ref(salvo?.aberturaSolicitada ?? props.aberturaAnterior ?? false)
const erro = ref('')
const hoje = ref(diaEmSP(new Date()))
let relogio: ReturnType<typeof setInterval> | undefined
onMounted(() => { relogio = setInterval(() => { hoje.value = diaEmSP(new Date()) }, 60_000) })
onBeforeUnmount(() => clearInterval(relogio))
const para = computed(() => props.preparadaPara ?? (props.lead.proximoPasso?.data && props.lead.proximoPasso.data > hoje.value ? props.lead.proximoPasso.data : ''))
const soPreparar = computed(() => { void hoje.value; return apenasPreparar(para.value) })
const guardado = computed(() => { const r = lerRascunhoDaVenda(props.lead); return r?.texto === texto.value && r.contextoHash === props.contextoHash && r.para === para.value })
const comprovante = ref('')
const material = computed(() => /raio[ -]?x/i.test(texto.value) && /\[link(?: do raio-x)?\]/i.test(texto.value) ? linkDoRaioXParaMensagem(props.lead.links.raioX) : '')
function inserirMaterial() { if (material.value) texto.value = texto.value.replace(/\[link(?: do raio-x)?\]/gi, material.value) }
const bloqueio = computed(() => impedimentoDaMensagem(texto.value))
let geracao = 0
let expira: ReturnType<typeof setTimeout> | undefined
let validoAte = 0
function invalidar() { comprovante.value = ''; geracao++; url.value = ''; aberturaSolicitada.value = false; erro.value = ''; clearTimeout(expira) }
watch(texto, invalidar, { flush: 'sync' })
watch([texto, aberturaSolicitada], () => {
  try { if (props.rascunhoId) sessionStorage.setItem(`squadone.revisao.${props.rascunhoId}`, JSON.stringify({ contextoHash: props.contextoHash, base: props.mensagem, texto: texto.value, aberturaSolicitada: aberturaSolicitada.value })) } catch { /* Sem armazenamento: conserva até sair desta tela. */ }
}, { flush: 'sync' })
watch(() => props.mensagem, t => { texto.value = t; invalidar() })
onBeforeUnmount(() => { geracao++; clearTimeout(expira) })
async function revisar() {
  if (validando.value || bloqueio.value || soPreparar.value) return
  const turno = ++geracao
  validando.value = true
  erro.value = ''
  url.value = ''
  try {
    if (!props.contextoHash) throw new Error('Esta sugestão precisa ser atualizada. Peça ao agente uma nova resposta com o contexto atual.')
    const q = new URLSearchParams({ produto: props.lead.produto, id: props.lead.id })
    const r = await fetch(`/api/operations/crm/resposta/contexto?${q}`, { cache: 'no-store' })
    if (!r.ok) throw new Error('Não consegui conferir Vendas. Tente novamente antes de abrir a mensagem.')
    const contexto: { contextoHash: string; whatsapp: string | null } = await r.json()
    if (contexto.contextoHash !== props.contextoHash) {
      emit('atualizar')
      throw new Error('O contexto mudou desde a sugestão. Confira a ficha e peça uma nova resposta antes de continuar.')
    }
    const link = whatsappParaRevisao(contexto.whatsapp ?? undefined, texto.value)
    if (!link) throw new Error('Não há destino de WhatsApp válido ou a mensagem ainda tem campos pendentes. Confira a ficha.')
    if (turno !== geracao) return
    url.value = link
    validoAte = Date.now() + 60_000
    expira = setTimeout(() => { url.value = ''; if (!aberturaSolicitada.value) erro.value = 'A conferência expirou. Revise novamente antes de abrir.' }, 60_000)
  } catch (e) { if (turno === geracao) erro.value = e instanceof Error ? e.message : 'Não foi possível preparar a abertura.' }
  finally { validando.value = false }
}
async function guardar() {
  if (validando.value || bloqueio.value || !para.value) return
  validando.value = true; erro.value = ''; comprovante.value = ''
  try {
    const q = new URLSearchParams({ produto: props.lead.produto, id: props.lead.id })
    const r = await fetch(`/api/operations/crm/resposta/contexto?${q}`, { cache: 'no-store' })
    if (!r.ok) throw new Error('Não consegui conferir o contexto. O rascunho não foi guardado.')
    const atual = await r.json()
    if (!props.contextoHash || atual.contextoHash !== props.contextoHash) { emit('atualizar'); throw new Error('O contexto mudou. Peça ao agente uma nova preparação antes de guardar.') }
    guardarRascunhoDaVenda(props.lead, texto.value, props.contextoHash, para.value)
    comprovante.value = 'Rascunho guardado neste aparelho. Nenhuma mensagem enviada e nenhum próximo passo alterado.'
  } catch (e) { erro.value = (e as Error).message }
  finally { validando.value = false }
}
function aoAbrir(e: MouseEvent) {
  if (soPreparar.value || !url.value || Date.now() > validoAte) { e.preventDefault(); url.value = ''; erro.value = 'Reconfirme a mensagem antes de abrir.'; return }
  aberturaSolicitada.value = true
  clearTimeout(expira)
  emit('revisada')
}
</script>

<template>
  <section class="revisar-resposta" aria-label="Revisar resposta ao cliente">
    <p class="texto-pequeno"><strong>{{ lead.empresa }}</strong> · {{ aberturaSolicitada ? 'Envio ainda não confirmado' : 'Revisão antes do WhatsApp' }}</p>
    <p v-if="!aberturaSolicitada" class="texto-2 texto-pequeno">Confira a conversa atual e o último combinado. O histórico de Vendas pode ser parcial.</p>
    <label class="rotulo">Mensagem para o cliente
      <textarea v-model="texto" class="campo" rows="4" maxlength="2000" :disabled="validando" />
    </label>
    <div v-if="material"><p class="texto-2 texto-pequeno">Material registrado para este lead: {{ material }}</p><button type="button" class="botao botao--leve" @click="inserirMaterial">Inserir link do Raio-X deste lead</button></div>
    <p v-if="bloqueio" class="texto-2 texto-pequeno" role="status">{{ bloqueio }}</p>
    <p v-if="erro" class="recado recado--atencao" role="alert">{{ erro }}</p>
    <template v-if="para">
      <p class="texto-2 texto-pequeno">Preparada para {{ para.split('-').reverse().join('/') }}. {{ soPreparar ? 'Guarde para revisar na data; não antecipe o contato.' : 'Confira a conversa atual antes de usar o texto guardado.' }}</p>
      <button type="button" class="botao" :class="soPreparar ? 'botao--primario' : 'botao--leve'" :disabled="validando || !!bloqueio || guardado" @click="guardar">{{ validando ? 'Conferindo contexto…' : guardado ? 'Rascunho guardado neste aparelho' : 'Revisei; guardar rascunho' }}</button>
      <p v-if="comprovante" role="status">{{ comprovante }}</p>
      <button v-if="guardado && voltar && rascunhoId" type="button" class="botao botao--leve" @click="voltar">Voltar aos próximos passos</button>
      <a :href="lead.links.whatsapp" v-if="lead.links.whatsapp" target="_blank" rel="noopener">Ler conversa no WhatsApp ↗</a>
    </template>
    <template v-if="aberturaSolicitada && !soPreparar">
      <p role="status">A abertura foi solicitada. Envie no WhatsApp e volte para registrar o que aconteceu com o cliente.</p>
      <button type="button" class="botao botao--primario" @click="acompanhar ? acompanhar(lead, texto) : emit('ficha')">Confirmar envio e continuar na sala</button>
      <p class="texto-2 texto-pequeno">Abrir não confirma envio, resposta do cliente ou venda. Confirme separadamente o que aconteceu e combine o próximo passo.</p>
      <button type="button" class="botao botao--leve" @click="invalidar">Retomar revisão da mensagem</button>
    </template>
    <a v-else-if="url && !soPreparar" class="botao botao--primario" :href="url" target="_blank" rel="noopener" @click="aoAbrir">Abrir WhatsApp com esta mensagem ↗</a>
    <button v-else-if="!soPreparar" type="button" class="botao botao--primario" :disabled="validando || !!bloqueio" @click="revisar">{{ validando ? 'Conferindo contexto e destinatário…' : 'Revisei a mensagem; preparar WhatsApp' }}</button>
    <p v-if="erro && para" class="texto-2" role="status">O contexto é relido automaticamente. Revise a mensagem quando a nova leitura chegar.</p>
    <button v-else-if="erro" type="button" class="botao botao--leve" @click="emit('ficha')">Conferir ficha do lead</button>
  </section>
</template>

<style scoped>
.revisar-resposta { display: grid; gap: var(--esp-2); min-width: 0; }
.revisar-resposta textarea { width: 100%; min-height: var(--esp-16); resize: vertical; }
.revisar-resposta .botao { white-space: normal; text-align: center; }
</style>
