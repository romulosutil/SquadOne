<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { CrmLead } from '../operations/types'
import { ajusteDoPasso } from '../operations/ajuste-do-passo'
import { diaEmSP } from '../operations/retomadas'
import { hashDoContexto } from '../operations/revisao-resposta'
import { focarNaSala } from './foco'
const props = defineProps<{ lead: CrmLead; modo: 'concluir' | 'reagendar'; disponivel?: boolean }>()
const emit = defineEmits<{ registrado: []; confirmado: []; fechar: []; ocupado: [valor: boolean] }>()
const contextoInicial = hashDoContexto(props.lead)
const hoje = diaEmSP(new Date())
const original = { ...props.lead.proximoPasso! }
const texto = ref(original.texto)
const data = ref(props.modo === 'concluir' ? hoje : '')
const previa = ref<{ contextoHash: string; tipo: string; texto: string; data: string } | null>(null)
const ocupado = ref(false), erro = ref(''), gravado = ref(false)
const chave = `squadone.ajuste-passo.${JSON.stringify([props.lead.produto, props.lead.id, original])}`
function memoria(valor?: string) { try { if (valor === '') sessionStorage.removeItem(chave); else if (valor) sessionStorage.setItem(chave, valor); else return sessionStorage.getItem(chave) } catch { /* Confirmações continuam em memória nesta tela. */ } }
const incerto = ref(memoria() === 'incerto')
const ancora = ref<HTMLElement | null>(null)
const atualizado = computed(() => gravado.value && (props.modo === 'concluir' ? !props.lead.proximoPasso : props.lead.proximoPasso?.texto === previa.value?.texto && props.lead.proximoPasso?.data === previa.value?.data && props.lead.proximoPasso?.registradoEm !== original.registradoEm))
watch(atualizado, async v => { if (v) { memoria(''); await nextTick(); focarNaSala(ancora.value) } })
async function revisar() {
  if (props.disponivel === false) return
  erro.value = ''
  try { if (await hashDoContexto(props.lead) !== await contextoInicial) throw new Error('O contexto mudou. Feche esta revisão, atualize a leitura e confira novamente.'); const r = ajusteDoPasso(props.modo, texto.value, data.value); previa.value = { ...r, contextoHash: await hashDoContexto(props.lead) }; await nextTick(); focarNaSala(ancora.value) }
  catch (e) { erro.value = (e as Error).message }
}
async function confirmar() {
  if (!previa.value || ocupado.value || incerto.value || gravado.value || props.disponivel === false) return
  ocupado.value = true; emit('ocupado', true); erro.value = ''
  try {
    memoria('incerto')
    const r = await fetch('/api/operations/crm/proximo-passo/ajustar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...previa.value, acao: props.modo, produto: props.lead.produto, id: props.lead.id }) })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) { incerto.value = r.status >= 500 || r.status === 409; if (!incerto.value) memoria(''); throw new Error(corpo.error ?? 'Não foi possível confirmar.') }
    gravado.value = true; emit('confirmado'); emit('registrado')
  } catch (e) {
    if (e instanceof TypeError) incerto.value = true
    erro.value = (e as Error).message
  } finally { ocupado.value = false; emit('ocupado', false) }
}
nextTick(() => focarNaSala(ancora.value))
</script>
<template>
  <section class="ajuste-passo" aria-label="Revisar próximo passo">
    <h4 ref="ancora" tabindex="-1">{{ modo === 'concluir' ? 'Concluir este passo' : 'Reagendar este passo' }}</h4>
    <strong>{{ lead.empresa }}</strong>
    <p v-if="modo === 'concluir'" class="ajuste-passo__texto">{{ original.texto }}</p>
    <details v-else-if="!gravado"><summary>Ver próximo passo anterior</summary><p class="ajuste-passo__texto">{{ original.texto }}</p></details>
    <p class="texto-2 texto-pequeno">Data anterior: {{ original.data.split('-').reverse().join('/') }}</p>
    <form v-if="!previa && !incerto" @submit.prevent="revisar">
      <label v-if="modo === 'reagendar'" class="rotulo">Próxima ação para avançar<textarea v-model="texto" class="campo" maxlength="900" rows="3" required /></label>
      <label class="rotulo">{{ modo === 'concluir' ? 'Quando você concluiu?' : 'Nova data' }}<input v-model="data" class="campo" type="date" :max="modo === 'concluir' ? hoje : undefined" :min="modo === 'reagendar' ? hoje : undefined" required /></label>
      <p class="texto-2 texto-pequeno">{{ modo === 'concluir' ? 'Confirme apenas o passo que você já resolveu. Não marca a venda como ganha ou perdida. As regras de prazo de Vendas continuam valendo.' : 'Indique sua ação planejada; só descreva como combinado aquilo que o cliente confirmou.' }}</p>
      <button type="submit" class="botao botao--primario" :disabled="disponivel === false">Revisar alteração</button>
    </form>
    <template v-if="previa && !gravado">
      <p v-if="modo === 'concluir'">Ao confirmar, este passo será concluído em {{ previa.data.split('-').reverse().join('/') }} e deixará de ser um próximo passo ativo após atualizar Vendas.</p>
      <template v-else><p class="ajuste-passo__texto">Novo passo: {{ previa.texto }}</p><p>Nova data: {{ previa.data.split('-').reverse().join('/') }}. {{ previa.data === hoje ? 'Fica na lista de Hoje após atualizar Vendas.' : original.data <= hoje ? 'Sai de Hoje quando a leitura for atualizada.' : 'Passa a aparecer na nova data após atualizar Vendas.' }}</p></template>
      <p class="texto-2 texto-pequeno">O histórico fica preservado. Não envia mensagem nem altera o calendário.</p>
      <button type="button" class="botao botao--primario" :disabled="ocupado || incerto || disponivel === false" @click="confirmar">{{ ocupado ? 'Gravando…' : modo === 'concluir' ? 'Confirmar conclusão do passo' : 'Confirmar reagendamento' }}</button>
      <button v-if="!incerto" type="button" class="botao botao--leve" :disabled="ocupado" @click="previa = null">Voltar e editar</button>
    </template>
    <p v-if="erro" role="alert" class="recado recado--atencao">{{ erro }}</p>
    <p v-if="incerto" role="status">Confira o histórico e atualize a leitura antes de uma nova tentativa. Não repetiremos a gravação automaticamente.</p>
    <p v-if="gravado && modo === 'reagendar'" class="ajuste-passo__texto"><strong>Novo passo · {{ previa?.data.split('-').reverse().join('/') }}</strong><br />{{ previa?.texto }}</p>
    <p v-if="gravado" role="status">{{ atualizado ? modo === 'concluir' ? 'Passo concluído e retirado dos próximos passos ativos.' : previa?.data === hoje ? 'Reagendado para hoje. Aparece na lista de Hoje.' : `Reagendado para ${previa?.data.split('-').reverse().join('/')}. ${original.data <= hoje ? 'Já saiu de Hoje.' : 'Nova data confirmada na leitura.'}` : 'Registro confirmado. Aguardando a leitura de Vendas; o item continua visível até lá.' }}</p>
    <p v-if="(gravado && !atualizado) || incerto" class="texto-2" role="status">A leitura de Vendas acompanha o registro automaticamente.</p>
    <button v-if="incerto" type="button" class="botao botao--leve" @click="memoria(''); emit('fechar')">Conferi o histórico: voltar aos leads</button>
    <details v-if="incerto"><summary>Conferir histórico</summary><p v-for="(e, i) in lead.eventos.slice(-6)" :key="i">{{ e.rotulo }} · {{ e.em }} · {{ e.texto }}</p></details>
    <a v-if="lead.links.whatsapp" :href="lead.links.whatsapp" target="_blank" rel="noopener">Ler conversa no WhatsApp ↗</a>
    <button type="button" class="botao botao--leve" :disabled="ocupado" @click="emit('fechar')">{{ atualizado ? 'Voltar aos leads' : 'Fechar revisão' }}</button>
  </section>
</template>
<style scoped>
.ajuste-passo, .ajuste-passo form { display: grid; gap: var(--esp-3); min-width: 0; }
.ajuste-passo { padding: var(--esp-3); border: var(--linha-fina); border-radius: var(--raio-controle); background: var(--superficie-2); }
.ajuste-passo__texto { white-space: pre-wrap; overflow-wrap: anywhere; }
.ajuste-passo input, .ajuste-passo textarea { width: 100%; min-width: 0; }
.ajuste-passo textarea { field-sizing: content; min-height: 6rem; }
.ajuste-passo .botao { white-space: normal; }
</style>
