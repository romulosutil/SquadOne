<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { CrmLead } from '../operations/types'
import { focarNaSala } from './foco'
import { ultimoRetornoRegistrado } from '../operations/retorno-da-venda'
import { registroDaSala, type FatoDaVenda } from './andamento'
const props = defineProps<{ lead: CrmLead; mensagem?: string }>()
const emit = defineEmits<{ registrado: []; responder: [] }>()
const chave = `squadone.andamento.${JSON.stringify([props.lead.produto, props.lead.id])}`
let salvo: { fato?: FatoDaVenda; texto?: string; data?: string; incerto?: boolean } = {}
try { salvo = JSON.parse(sessionStorage.getItem(chave) ?? '{}') ?? {} } catch { /* O formulário continua sem persistência. */ }
const fato = ref<FatoDaVenda>(props.mensagem ? 'envio' : ['envio', 'retorno', 'passo'].includes(salvo.fato ?? '') ? salvo.fato! : 'retorno')
const texto = ref(props.mensagem || (typeof salvo.texto === 'string' ? salvo.texto.slice(0, 900) : ''))
const data = ref(!props.mensagem && typeof salvo.data === 'string' ? salvo.data : '')
const tituloDaPrevia = ref<HTMLElement | null>(null)
const previa = ref<ReturnType<typeof registroDaSala> | null>(null)
const salvando = ref(false)
const incerto = ref(salvo.incerto === true)
const erro = ref('')
const sucesso = ref('')
const retornoGravado = ref('')
const retornoAtualizado = computed(() => !!retornoGravado.value && ultimoRetornoRegistrado(props.lead)?.registro === retornoGravado.value)
const rascunhos: Partial<Record<FatoDaVenda, { texto: string; data: string }>> = {}
watch([fato, texto, data, incerto], () => { try { sessionStorage.setItem(chave, JSON.stringify({ fato: fato.value, texto: texto.value, data: data.value, incerto: incerto.value })) } catch { /* Mantém o rascunho em memória. */ } }, { flush: 'sync' })
const titulo = computed(() => fato.value === 'envio' ? 'O que você enviou?' : fato.value === 'retorno' ? 'O que o cliente respondeu?' : 'Qual é o próximo passo para avançar?')
function escolher(valor: FatoDaVenda) {
  rascunhos[fato.value] = { texto: texto.value, data: data.value }
  fato.value = valor; texto.value = rascunhos[valor]?.texto ?? (valor === 'envio' ? props.mensagem ?? '' : ''); data.value = rascunhos[valor]?.data ?? ''; previa.value = null; erro.value = ''; sucesso.value = ''
}
function revisar() {
  erro.value = ''; sucesso.value = ''
  try { previa.value = registroDaSala(props.lead, fato.value, texto.value, data.value); nextTick(() => focarNaSala(tituloDaPrevia.value)) }
  catch (e) { erro.value = e instanceof Error ? e.message : 'Confira os campos.' }
}
async function confirmar() {
  if (!previa.value || salvando.value || incerto.value) return
  const registro = previa.value
  salvando.value = true; erro.value = ''
  try {
    const r = await fetch('/api/operations/crm/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registro) })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) { incerto.value = r.status >= 500; throw new Error(corpo.error ?? 'O servidor não confirmou o registro.') }
    sucesso.value = 'Registro confirmado na planilha. A leitura de Vendas será atualizada em alguns segundos.'
    if (fato.value === 'retorno') retornoGravado.value = registro.texto
    previa.value = null; texto.value = ''; data.value = ''; emit('registrado')
  } catch (e) {
    if (e instanceof TypeError) incerto.value = true
    erro.value = `${e instanceof Error ? e.message : 'Não foi possível confirmar.'}${incerto.value ? ' O resultado é incerto. Confira o histórico antes de repetir para evitar duplicação.' : ''}`
  } finally { salvando.value = false }
}
</script>
<template>
  <section class="andamento-venda" aria-label="Avançar a venda na sala">
    <h4 tabindex="-1">Continuar a venda</h4>
    <p class="texto-pequeno"><strong>{{ lead.empresa }}</strong></p>
    <p class="texto-2 texto-pequeno">Registre fatos da conversa. Abrir o WhatsApp não comprova envio; silêncio não é recusa.</p>
    <div v-if="!previa && !sucesso" class="andamento-venda__acoes" role="group" aria-label="O que aconteceu com este cliente?">
      <button v-for="op in (['envio', 'retorno', 'passo'] as const)" :key="op" type="button" class="botao botao--leve" :aria-pressed="fato === op" :disabled="salvando || incerto" @click="escolher(op)">{{ op === 'envio' ? 'Enviei' : op === 'retorno' ? 'Cliente respondeu' : 'Próximo passo' }}</button>
    </div>
    <form v-if="!previa && !incerto && !sucesso" @submit.prevent="revisar">
      <label class="rotulo">{{ titulo }}<textarea v-model="texto" class="campo" rows="3" maxlength="900" required /></label>
      <p class="texto-2 texto-pequeno">{{ fato === 'envio' ? 'Confira o conteúdo que realmente saiu no WhatsApp, incluindo suas edições.' : fato === 'retorno' ? 'Registre as palavras do cliente e quem respondeu. Diferencie pedido, objeção e compromisso; não deduza interesse.' : 'Defina quem faz o quê e quando. Se ainda não combinaram, indique que é sua ação planejada. Isto não agenda envio nem compromisso no calendário.' }}</p>
      <label class="rotulo">{{ fato === 'passo' ? 'Data do próximo passo' : 'Data em que aconteceu' }}<input v-model="data" class="campo" type="date" required /></label>
      <button type="submit" class="botao botao--primario">Revisar registro</button>
    </form>
    <div v-if="previa" class="andamento-venda__previa">
      <strong ref="tituloDaPrevia" tabindex="-1">Confirmar para {{ lead.empresa }} · {{ lead.produto }}</strong>
      <p class="andamento-venda__texto">{{ previa.texto }}</p><p v-if="previa.data">Data: {{ previa.data.split('-').reverse().join('/') }}</p>
      <p class="texto-2 texto-pequeno">{{ fato === 'passo' ? 'Atualiza o próximo passo atual em Vendas.' : 'Grava uma nota identificada em Vendas, sem alterar a etapa ou a classificação da conversa.' }}</p>
      <button type="button" class="botao botao--primario" :disabled="salvando || incerto" @click="confirmar">{{ salvando ? 'Gravando…' : 'Confirmar e registrar' }}</button>
      <button type="button" class="botao botao--leve" :disabled="salvando" @click="previa = null">Voltar e editar</button>
    </div>
    <p v-if="erro" role="alert" class="recado recado--atencao">{{ erro }}</p>
    <p v-if="sucesso" role="status" class="recado">{{ sucesso }}</p>
    <details><summary>Conferir registros e próximo passo atuais</summary><p v-if="lead.proximoPasso"><strong>Próximo passo:</strong> {{ lead.proximoPasso.texto }} · {{ lead.proximoPasso.data }}</p><p v-else class="texto-2">Sem próximo passo na última leitura.</p><ul><li v-for="evento in lead.eventos.slice(-6)" :key="`${evento.em}-${evento.tipo}-${evento.texto}`"><strong>{{ evento.rotulo }}</strong> · {{ evento.em }}<p v-if="evento.texto" class="andamento-venda__texto">{{ evento.texto }}</p></li></ul><p class="texto-2 texto-pequeno">Leitura parcial de Vendas; o registro pode levar alguns segundos para aparecer.</p></details>
    <button v-if="incerto" type="button" class="botao botao--leve" @click="incerto = false; previa = null; erro = ''">Conferi o histórico: liberar uma nova revisão</button>
    <template v-if="sucesso && fato === 'retorno'">
      <button type="button" class="botao botao--primario" :disabled="!retornoAtualizado" @click="emit('responder')">{{ retornoAtualizado ? 'Preparar resposta com este retorno' : 'Aguardando retorno na leitura de Vendas…' }}</button>
      <button v-if="!retornoAtualizado" type="button" class="botao botao--leve" @click="emit('registrado')">Atualizar leitura do retorno</button>
      <p class="texto-2 texto-pequeno">O agente vai revisar a resposta e o próximo passo com os dados relidos. Você confirma cada ação depois.</p>
    </template>
    <button v-if="sucesso && fato === 'envio'" type="button" class="botao botao--primario" @click="escolher(fato === 'envio' ? 'retorno' : 'passo')">{{ fato === 'envio' ? 'Registrar retorno do cliente' : 'Definir próximo passo' }}</button>
    <button v-if="sucesso && fato === 'envio'" type="button" class="botao botao--leve" @click="escolher('passo')">Ainda sem retorno: planejar próximo passo</button>
  </section>
</template>
<style scoped>
.andamento-venda, .andamento-venda form, .andamento-venda__previa { display: grid; gap: var(--esp-3); min-width: 0; }
.andamento-venda { border: var(--linha-fina); border-radius: var(--raio-controle); padding: var(--esp-3); background: var(--superficie-2); }
.andamento-venda__acoes { display: flex; flex-wrap: wrap; gap: var(--esp-1); }
.andamento-venda__acoes [aria-pressed="true"] { background: var(--destaque); color: var(--texto); }
.andamento-venda [tabindex="-1"] { scroll-margin-top: calc(var(--toque) + var(--esp-4)); }
.andamento-venda textarea, .andamento-venda input { width: 100%; min-width: 0; }
.andamento-venda__texto { white-space: pre-wrap; overflow-wrap: anywhere; }
.andamento-venda .botao { white-space: normal; }
</style>
