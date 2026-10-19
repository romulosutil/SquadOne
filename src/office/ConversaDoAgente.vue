<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onBeforeUnmount, ref } from 'vue'
import { PEDIDO_DE_RETOMADA, PEDIDO_DE_PREPARO_AMANHA } from '../operations/retomadas'
import { ultimoRetornoRegistrado, PEDIDO_DE_RESPOSTA_AO_RETORNO } from '../operations/retorno-da-venda'
import { hashDoContexto } from '../operations/revisao-resposta'
import { PEDIDO_DE_RESPOSTA_REVISADA } from '../operations/revisao-resposta'
import type { CrmLead } from '../operations/types'
import type { Pessoa } from '../types'
import AssistenteCartao from '../casca/AssistenteCartao.vue'
import { horaCurta, textoDaEtapa, useConversaDoAgente } from '../casca/assistente'

const props = defineProps<{ squadId: string; salaId: string; pessoa: Pessoa; trabalho: boolean; lead?: CrmLead | null }>()
const emit = defineEmits<{ conversar: []; ficha: []; registrado: [] }>()
const conversa = useConversaDoAgente(props.squadId, props.salaId, props.pessoa.id, props.lead ?? undefined)
const texto = ref('')
const campo = ref<HTMLTextAreaElement | null>(null)
const historico = ref<HTMLElement | null>(null)
const retorno = computed(() => props.lead ? ultimoRetornoRegistrado(props.lead) : null)
const mensagensAtuais = computed(() => conversa.mensagens.value.filter(m => !retorno.value || Date.parse(m.quando) >= Date.parse(retorno.value.registradoEm)))
const preparandoRetorno = ref(false)
const erroDoRetorno = ref('')
const ocupado = computed(() => preparandoRetorno.value || !!conversa.pendente.value || !!conversa.enviando.value)
const desligado = computed(() => conversa.estado.value?.ligado === false)
const ultimaResposta = computed(() => [...mensagensAtuais.value].reverse().find(m => m.autor === 'assistente'))
const ultimaAcao = computed(() => ultimaResposta.value?.cartoes.length ? ultimaResposta.value : undefined)
const cartoes = computed(() => mensagensAtuais.value.flatMap(m => m.cartoes))
const aguardando = computed(() => (props.trabalho ? cartoes.value : ultimaAcao.value?.cartoes ?? []).filter(c => (conversa.desfechos.value[c.id] ?? c.estado) === 'proposto').length)
const estado = computed(() => conversa.pendente.value ? textoDaEtapa(conversa.pendente.value.etapa) : conversa.enviando.value ? 'Enviando comando…' : conversa.falha.value || conversa.mensagens.value.at(-1)?.falha ? 'O acompanhamento encontrou um problema' : aguardando.value ? `${aguardando.value} ${aguardando.value === 1 ? 'ação aguarda' : 'ações aguardam'} sua confirmação` : conversa.mensagens.value.length ? 'Resposta pronta · confira abaixo' : 'Pronto para conversar')
onMounted(conversa.retomar)
onActivated(conversa.retomar)
onDeactivated(conversa.pausar)
onBeforeUnmount(conversa.pausar)
async function enviar() {
  if (ocupado.value || desligado.value || !texto.value.trim()) return
  const enviado = texto.value
  const ok = await conversa.mandar(enviado, { pagina: 'escritorio', ...(props.lead ? { lead: { produto: props.lead.produto, id: props.lead.id } } : {}), agente: { squadId: props.squadId, salaId: props.salaId, pessoaId: props.pessoa.id } })
  if (ok && texto.value === enviado) texto.value = ''
}
async function prepararResposta(modo?: 'retomada' | 'amanha') {
  if (ocupado.value || desligado.value || !props.lead) return
  const lead = props.lead
  erroDoRetorno.value = ''
  preparandoRetorno.value = true
  try {
    const hash = (retorno.value || !!modo) ? await hashDoContexto(lead) : undefined
    await conversa.mandar(modo === 'amanha' ? PEDIDO_DE_PREPARO_AMANHA : modo === 'retomada' ? PEDIDO_DE_RETOMADA : retorno.value ? PEDIDO_DE_RESPOSTA_AO_RETORNO : PEDIDO_DE_RESPOSTA_REVISADA, { pagina: 'escritorio', agente: { squadId: props.squadId, salaId: props.salaId, pessoaId: props.pessoa.id }, lead: { produto: lead.produto, id: lead.id }, ...(hash ? modo === 'amanha' ? { preparoAmanhaContextoHash: hash } : modo === 'retomada' ? { retomadaContextoHash: hash } : { retornoContextoHash: hash } : {}) })
  } catch { erroDoRetorno.value = 'Não consegui conferir o retorno. Atualize a sala e tente novamente.' }
  finally { preparandoRetorno.value = false }
}
defineExpose({ prepararResposta })
function sugerir(t: string) { texto.value = t; campo.value?.focus() }
</script>

<template>
  <div class="conversa-agente">
    <p class="conversa-agente__estado" role="status" aria-live="polite">{{ estado }}</p>
    <p v-if="desligado" class="recado" role="status">A conversa está desligada nesta Central. Seus leads e pedidos continuam disponíveis.</p>
    <p v-if="conversa.erroDoEstado.value" class="recado recado--erro" role="alert">Não foi possível consultar a disponibilidade. {{ conversa.erroDoEstado.value.texto }}</p>
    <div v-if="conversa.mensagens.value.at(-1)?.falha" class="recado recado--atencao" role="alert"><p>{{ conversa.mensagens.value.at(-1)?.texto }}</p><p>O contexto da sala é acompanhado automaticamente. Você pode revisar o pedido e tentar novamente.</p></div>
    <p v-if="erroDoRetorno" role="alert" class="recado recado--atencao">{{ erroDoRetorno }}</p>
    <details v-if="retorno && !trabalho" class="dobra"><summary>Retorno usado · {{ retorno.ocorreuEm.split('-').reverse().join('/') }}</summary><p class="conversa-agente__texto">{{ retorno.texto }}</p><p class="texto-2 texto-pequeno">Informado pelo operador. Confira se houve mensagens posteriores no WhatsApp.</p></details>
    <p v-if="!ocupado && !trabalho && !ultimaAcao && ultimaResposta?.texto && !ultimaResposta.falha" class="conversa-agente__texto" role="status">{{ ultimaResposta.texto.replaceAll('**', '') }}</p>
    <template v-if="trabalho">
      <p class="texto-2 texto-pequeno">Acompanhe as ações propostas e o resultado dos pedidos confirmados. Uma tarefa agendada ainda não é uma entrega realizada.</p>
      <p v-if="!cartoes.length">Nenhuma ação proposta nesta conversa.</p>

      <button type="button" class="botao botao--leve" @click="emit('conversar')">Dar outro comando a {{ pessoa.nome }}</button>
    </template>
    <div v-if="lead && !trabalho && (!ultimaResposta || retorno)" class="conversa-agente__objetivo">
      <button type="button" class="botao" :class="ultimaAcao ? 'botao--leve' : 'botao--primario'" :disabled="ocupado || desligado" @click="prepararResposta()">{{ ocupado ? 'Preparando resposta…' : retorno ? 'Responder ao retorno e revisar próximo passo' : 'Preparar resposta e próximo passo' }}</button>
      <p v-if="!ultimaAcao" class="texto-2 texto-pequeno">Objetivo: uma conversa útil ao cliente e um próximo compromisso claro. Abrir o WhatsApp ainda não é envio nem venda.</p>
    </div>
    <template v-if="!trabalho">
      <p v-if="!conversa.mensagens.value.length && !lead" class="texto-2 texto-pequeno">Peça a {{ pessoa.nome }} uma análise, um rascunho ou um plano. Acompanhe a resposta e os pedidos aqui.</p>
      <div v-if="!conversa.mensagens.value.length && !lead" class="conversa-agente__atalhos">
        <button type="button" class="botao botao--leve" @click="sugerir('Explique seu papel nesta sala e o que você consegue fazer agora.')">O que você faz?</button>
        <button type="button" class="botao botao--leve" @click="sugerir('Quero organizar um trabalho nesta sala. Ajude a definir o resultado e o prazo antes de propor um pedido ao time.')">Organizar um trabalho</button>
      </div>
    </template>
    <div v-for="m in conversa.mensagens.value" v-show="!ocupado && (trabalho ? mensagensAtuais.some(atual => atual.id === m.id) : m.id === ultimaAcao?.id)" :key="`acao-${m.id}`" class="conversa-agente__acoes">
      <template v-for="c in m.cartoes" :key="c.id">
        <details v-if="c.tipo === 'anotacao_no_crm'" :open="trabalho" class="dobra"><summary>Próximo passo: {{ c.dados.texto.length > 120 ? c.dados.texto.slice(0, 120) + '…' : c.dados.texto }}</summary>
          <AssistenteCartao :cartao="c" :conversa="conversa" :squad-id="squadId" :lead-aberto="lead ?? null" :lead-da-sala="lead" :agentes="true" @ficha="emit('ficha')" @atualizar="emit('registrado')" @registrado="emit('registrado')" />
        </details>
        <AssistenteCartao v-else :cartao="c" :conversa="conversa" :squad-id="squadId" :lead-aberto="lead ?? null" :lead-da-sala="lead" :agentes="true" @ficha="emit('ficha')" @atualizar="emit('registrado')" @registrado="emit('registrado')" />
      </template>
    </div>
    <button v-if="lead && !trabalho && ultimaAcao && !retorno" type="button" class="botao botao--leve" :disabled="ocupado || desligado" @click="prepararResposta()">Pedir nova resposta e próximo passo</button>
    <details v-if="conversa.mensagens.value.length || conversa.enviando.value" :open="!lead" class="dobra"><summary>Conversa, pedidos e histórico</summary>
      <ol ref="historico" class="conversa-agente__historico" aria-label="Histórico com o agente">
        <li v-for="m in conversa.mensagens.value" v-show="!trabalho || m.cartoes.length" :key="m.id" :class="{ 'conversa-agente__minha': m.autor === 'romulo' }">
          <p class="texto-2 texto-pequeno"><strong>{{ m.autor === 'romulo' ? 'Você' : pessoa.nome }}</strong> · {{ horaCurta(m.quando) }}<template v-if="m.cerebro === 'hermes'"> · com consulta ao Hermes</template></p>
          <p v-show="!trabalho" class="conversa-agente__texto">{{ m.texto }}</p>
          <template v-if="!trabalho && m.id !== ultimaAcao?.id">
            <AssistenteCartao v-for="c in m.cartoes" :key="c.id" :cartao="c" :conversa="conversa" :squad-id="squadId" :lead-aberto="lead ?? null" :lead-da-sala="lead" :agentes="true" @ficha="emit('ficha')" @atualizar="emit('registrado')" @registrado="emit('registrado')" />
          </template>
          <p v-if="m.falha" class="recado recado--erro">{{ m.falha.texto }}</p>
          <ul v-if="m.fontes.length" class="texto-2 texto-pequeno" aria-label="Fontes consultadas"><li v-for="(f, i) in m.fontes" :key="i">{{ f.rotulo }}</li></ul>
        </li>
        <li v-if="!trabalho && conversa.enviando.value && !conversa.mensagens.value.some(m => m.id === conversa.enviando.value?.id)" class="conversa-agente__minha"><strong>Você · enviando</strong><p>{{ conversa.enviando.value.texto }}</p></li>
      </ol>
    </details>
      <details v-show="!trabalho" :open="!lead" class="dobra"><summary>{{ ultimaAcao ? 'Pedir ajuste ao agente' : 'Falar com ' + pessoa.nome }}</summary>
      <form class="conversa-agente__form" @submit.prevent="enviar">
        <label class="sala-comando__campo">Mensagem ou comando para {{ pessoa.nome }}
          <textarea ref="campo" v-model="texto" rows="3" maxlength="2000" :disabled="desligado" placeholder="Descreva o que você precisa…" />
        </label>
        <button type="submit" class="botao botao--primario" :disabled="ocupado || desligado || !texto.trim()">{{ ocupado ? 'Aguardando resposta…' : 'Enviar para ' + pessoa.nome }}</button>
      </form></details>
    <div v-if="conversa.falha.value" class="recado recado--erro" role="alert"><p>{{ conversa.falha.value.texto }}</p><button type="button" class="botao botao--leve" @click="conversa.retomar">Retomar acompanhamento</button></div>
  </div>
</template>

<style scoped>
.conversa-agente__acoes, .conversa-agente__objetivo { display: grid; gap: var(--esp-2); min-width: 0; }
.conversa-agente, .conversa-agente__form { display: grid; gap: var(--esp-3); min-width: 0; }
.conversa-agente__estado { font-size: var(--tam-apoio); font-weight: var(--peso-forte); padding: var(--esp-2) var(--esp-3); background: var(--superficie-2); border-radius: var(--raio-controle); }
.conversa-agente__atalhos { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.conversa-agente__historico { display: grid; gap: var(--esp-3); padding: 0; margin: 0; list-style: none; }
.conversa-agente__historico > li { display: grid; gap: var(--esp-2); padding: var(--esp-3); border: var(--linha-fina); border-radius: var(--raio-controle); overflow-wrap: anywhere; }
.conversa-agente__minha { background: var(--superficie-2); }
.conversa-agente__texto { white-space: pre-wrap; }
</style>
