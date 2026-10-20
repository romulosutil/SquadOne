<script lang="ts">
// Memória desta sessão: sobrevive à troca de Ficha sem gravar contexto de cliente no navegador.
const rascunhosSpiced = new Map<string, import('./spiced').Spiced>()
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CrmLead } from './types'
import { camposDoLote, type SugestaoSpiced } from './copiloto'
import { lerSpiced, spicedVazio, textoDoRegistroSpiced, type Spiced } from './spiced'

const props = defineProps<{ lead: CrmLead; disponivel: boolean; sugestao?: SugestaoSpiced }>()
const emit = defineEmits<{ registrado: [] }>()
const copia = (s?: Spiced): Spiced => JSON.parse(JSON.stringify(s ?? spicedVazio()))
const chaveInicial = `${props.lead.produto}:${props.lead.id}`
const rascunho = ref<Spiced>(copia(rascunhosSpiced.get(chaveInicial) ?? props.lead.spiced))
const estado = ref<'pronto' | 'salvando' | 'aguardando' | 'falhou'>('pronto')
const aviso = ref('')
const identidade = computed(() => `${props.lead.produto}:${props.lead.id}`)
const confirmado = computed(() => props.lead.spiced ?? spicedVazio())
const campos = computed(() => [
  { letra: 'S', nome: 'Situação', preenchido: Boolean(confirmado.value.situacao) },
  { letra: 'P', nome: 'Dor', preenchido: Boolean(confirmado.value.dor) },
  { letra: 'I', nome: 'Impacto', preenchido: Boolean(confirmado.value.impacto) },
  { letra: 'C', nome: 'Evento crítico', preenchido: Boolean(confirmado.value.evento_critico.fato && confirmado.value.evento_critico.data) },
  { letra: 'D', nome: 'Decisor', preenchido: confirmado.value.decisao.decisor_confirmado === 'sim' },
])
const sugestoes = computed(() => Object.entries(props.sugestao ?? {}) as Array<[keyof Spiced, NonNullable<SugestaoSpiced[keyof Spiced]>]>)
// O decisor "sim" fica fora do lote: ele destrava a proposta e pede um toque próprio no "Usar decisão no rascunho".
const noLote = computed(() => camposDoLote(props.sugestao))
const decisorFicaAParte = computed(() => noLote.value.length < sugestoes.value.length)
const nomes = { situacao: 'Situação', dor: 'Dor', impacto: 'Impacto', evento_critico: 'Evento crítico', decisao: 'Decisão' }
const bloqueado = computed(() => !props.disponivel || estado.value === 'salvando' || estado.value === 'aguardando')
watch(identidade, (atual, anterior) => {
  if (anterior) rascunhosSpiced.set(anterior, copia(rascunho.value))
  rascunho.value = copia(rascunhosSpiced.get(atual) ?? props.lead.spiced)
  estado.value = 'pronto'; aviso.value = ''
})
onBeforeUnmount(() => rascunhosSpiced.set(identidade.value, copia(rascunho.value)))
watch(() => props.lead.spiced, (atual) => {
  if (estado.value === 'aguardando' && JSON.stringify(atual) === JSON.stringify(rascunho.value)) {
    estado.value = 'pronto'; aviso.value = 'Qualificação confirmada na Ficha.'
  }
})
function usar(campo: keyof Spiced) {
  const s = props.sugestao?.[campo]
  if (s) Object.assign(rascunho.value, { [campo]: JSON.parse(JSON.stringify(s.valor)) })
}
async function confirmarSugestoes() {
  if (bloqueado.value) return
  for (const campo of noLote.value) usar(campo)
  await salvar()
}
function descartar() {
  rascunho.value = copia(props.lead.spiced)
  rascunhosSpiced.delete(identidade.value)
  estado.value = 'pronto'; aviso.value = ''
}
function valorSugerido(campo: keyof Spiced, valor: Spiced[keyof Spiced]): string {
  if (typeof valor === 'string') return valor
  if (campo === 'evento_critico' && 'fato' in valor) return [valor.fato, valor.data].filter(Boolean).join(' · ')
  if ('decisor_confirmado' in valor) return [valor.decisor_confirmado === 'sim' ? 'Decide a compra' : valor.decisor_confirmado === 'nao' ? 'Não decide' : 'Decisor a confirmar', valor.quem, valor.como_paga].filter(Boolean).join(' · ')
  return ''
}
async function salvar() {
  if (bloqueado.value) return
  let texto: string
  try {
    if (!lerSpiced(rascunho.value)) throw new Error('Confira os campos e a data do evento crítico.')
    texto = textoDoRegistroSpiced(rascunho.value)
  } catch (erro) {
    aviso.value = erro instanceof Error ? erro.message : 'Confira a qualificação.'
    estado.value = 'falhou'; return
  }
  const atual = identidade.value
  const { produto, chave: id } = props.lead
  estado.value = 'salvando'; aviso.value = ''
  try {
    const resposta = await fetch('/api/operations/crm/registro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produto, id, tipo: 'spiced', texto, data: '' }),
    })
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    if (identidade.value !== atual) return
    estado.value = 'aguardando'
    aviso.value = 'Gravado na planilha. Aguardando a confirmação aparecer na Ficha.'
    emit('registrado')
  } catch (erro) {
    if (identidade.value !== atual) return
    estado.value = 'falhou'
    aviso.value = `Não foi possível confirmar a gravação: ${erro instanceof Error ? erro.message : String(erro)}. Confira a Ficha antes de tentar novamente.`
  }
}
</script>

<template>
  <section class="crm-spiced" data-blueprint="BP-SPICED" aria-label="Qualificação SPICED">
    <h3 class="crm-ficha__rotulo">Qualificação para a proposta</h3>
    <ul class="crm-spiced__faixa" aria-label="SPICED confirmado pelo Rômulo">
      <li v-for="campo in campos" :key="campo.letra"><strong>{{ campo.letra }}</strong> · {{ campo.nome }}: <span>{{ campo.preenchido ? 'preenchido' : 'falta' }}</span></li>
    </ul>
    <details class="dobra">
      <summary>Conferir e preencher a qualificação</summary>
      <p class="crm-nota-pequena">Só o que você confirmar fica na Ficha. As sugestões do copiloto precisam de revisão.</p>
      <div v-for="[campo, sugestao] in sugestoes" :key="campo" class="zona">
        <strong>{{ nomes[campo] }} · sugestão</strong>
        <p>{{ valorSugerido(campo, sugestao.valor) }}</p>
        <blockquote>“{{ sugestao.citacao }}”</blockquote>
        <button type="button" class="botao botao--leve" :disabled="bloqueado" @click="usar(campo)">Usar {{ nomes[campo].toLowerCase() }} no rascunho</button>
      </div>
      <button v-if="noLote.length" type="button" class="botao" :disabled="bloqueado" @click="confirmarSugestoes">Confirmar sugestões exibidas</button>
      <p v-if="decisorFicaAParte" class="crm-nota-pequena">O decisor não entra no lote: confirme-o à parte, com “Usar decisão no rascunho”.</p>
      <form class="crm-form" @submit.prevent="salvar">
        <label><span>Situação</span><textarea v-model="rascunho.situacao" maxlength="200" rows="2" :disabled="bloqueado" /></label>
        <label><span>Dor: qual problema ele quer resolver?</span><textarea v-model="rascunho.dor" maxlength="200" rows="2" :disabled="bloqueado" /></label>
        <label><span>Impacto: o que esse problema causa?</span><textarea v-model="rascunho.impacto" maxlength="200" rows="2" :disabled="bloqueado" /></label>
        <label><span>Evento crítico: fato verificável</span><input v-model="rascunho.evento_critico.fato" maxlength="200" :disabled="bloqueado"></label>
        <label><span>Data do evento crítico</span><input v-model="rascunho.evento_critico.data" type="date" :disabled="bloqueado"></label>
        <label><span>Quem está falando decide a compra?</span><select v-model="rascunho.decisao.decisor_confirmado" :disabled="bloqueado"><option value="nao-sei">Não sei</option><option value="sim">Sim, confirmei</option><option value="nao">Não</option></select></label>
        <label><span>Quem decide?</span><input v-model="rascunho.decisao.quem" maxlength="200" :disabled="bloqueado"></label>
        <label><span>Como paga? Só o que ele informou</span><input v-model="rascunho.decisao.como_paga" maxlength="200" :disabled="bloqueado"></label>
        <p class="crm-nota-pequena">Impacto em dinheiro só quando dito pelo lead. A proposta pede dor, impacto e decisor confirmado.</p>
        <div class="crm-form__botoes"><button class="botao" type="submit" :disabled="bloqueado">{{ estado === 'salvando' ? 'Confirmando…' : 'Confirmar qualificação revisada' }}</button><button class="botao botao--leve" type="button" :disabled="estado === 'salvando'" @click="descartar">Descartar rascunho e reler a Ficha</button></div>
      </form>
    </details>
    <p v-if="aviso" class="recado" :class="{ 'recado--erro': estado === 'falhou' }" role="status">{{ aviso }}</p>
  </section>
</template>

<style scoped>
.crm-spiced { display: grid; gap: var(--esp-2); }
.crm-spiced__faixa { display: flex; flex-wrap: wrap; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; font-size: var(--tam-apoio); }
.crm-spiced .crm-form { margin-top: var(--esp-3); }
.crm-spiced blockquote { margin: var(--esp-2) 0; overflow-wrap: anywhere; }
</style>
