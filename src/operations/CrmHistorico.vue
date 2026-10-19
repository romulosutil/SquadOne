<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CrmLead } from './types'
import { precisaConferirHistorico } from './historico-comercial'
import { contatoPausado } from './aprendizado-comercial'
import { lerExportacao } from './importar-conversa'

const props = defineProps<{ lead: CrmLead; disponivel: boolean; salvando: boolean }>()
const emit = defineEmits<{ importado: [] }>()
const dono = ref('')
const texto = ref('')
const confirmar = ref(false)
const erro = ref('')
const status = ref('')
const importando = ref(false)
const buscando = ref(false)
let consulta = 0
let tentativas = 0
let geracao = 0
function pararBusca() { window.clearTimeout(consulta); buscando.value = false; geracao++ }
onBeforeUnmount(pararBusca)
watch(() => props.lead.id, pararBusca)
async function buscar(inicial = true) {
  if (inicial) { pararBusca(); tentativas = 0; erro.value = ''; status.value = ''; buscando.value = true }
  const vez = geracao
  try {
    const r = await fetch('/api/operations/crm/historico', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: props.lead.id }) })
    const corpo = await r.json()
    if (vez !== geracao) return
    if (!r.ok) throw new Error(corpo.error ?? 'Consulta indisponível.')
    if (corpo.recebidas > 0) {
      status.value = `${corpo.recebidas} mensagens retornaram pelo Hermes; ${corpo.gravadas} foram acrescentadas. A cobertura continua parcial. Confira as mensagens disponíveis abaixo.`
      buscando.value = false
      emit('importado')
    } else if (++tentativas < 6) {
      status.value = 'O Hermes pediu o histórico ao aparelho. Aguardando mensagens; pedido aceito não significa histórico recuperado.'
      consulta = window.setTimeout(() => void buscar(false), 5000)
    } else {
      buscando.value = false
      status.value = 'O aparelho ainda não devolveu histórico. Nenhuma mensagem nova foi recuperada nesta consulta.'
    }
  } catch (e) { if (vez === geracao) { buscando.value = false; erro.value = (e as Error).message } }
}
const previa = computed(() => {
  if (!texto.value || !dono.value.trim()) return null
  try { return { dados: lerExportacao(texto.value, dono.value), erro: '' } } catch (e) { return { dados: null, erro: (e as Error).message } }
})
const pendente = computed(() => precisaConferirHistorico(props.lead))
watch(() => props.lead.id, () => { if (pendente.value) void buscar() }, { immediate: true })
const data = (s: string) => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
watch([texto, dono], () => { confirmar.value = false; erro.value = ''; status.value = '' }, { flush: 'sync' })
async function escolher(e: Event) {
  const arquivo = (e.target as HTMLInputElement).files?.[0]
  if (!arquivo) return
  if (arquivo.size > 800_000) { erro.value = 'Arquivo grande demais. Use uma exportação sem mídia.'; return }
  texto.value = await arquivo.text()
}
async function importar() {
  if (!confirmar.value || !previa.value?.dados) return
  importando.value = true
  erro.value = ''
  try {
    const r = await fetch('/api/operations/crm/conversa/importar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: props.lead.id, texto: texto.value, dono: dono.value.trim(), confirmar: true }) })
    const corpo = await r.json()
    if (!r.ok) throw new Error(corpo.error ?? 'Falha ao importar.')
    texto.value = ''
    status.value = `${corpo.importadas} mensagens importadas; ${corpo.duplicadas} já estavam guardadas. Confira a conversa abaixo antes de escolher a próxima ação.`
    emit('importado')
  } catch (e) { erro.value = (e as Error).message } finally { importando.value = false }
}
</script>

<template>
  <section class="historico" aria-labelledby="historico-titulo">
    <h3 id="historico-titulo">{{ contatoPausado(lead) ? 'Contato pausado por você' : buscando ? 'Sincronizando histórico' : pendente ? 'Histórico parcial' : 'Histórico integrado' }}</h3>
    <p v-if="lead.conversa?.mensagens">{{ lead.conversa.mensagens }} mensagens guardadas desde {{ data(lead.conversa.desde) }}. Cobertura parcial: mensagens anteriores, áudios e anexos podem faltar.</p>
    <p v-else>Sem conversa arquivada. As datas e os trechos da planilha não substituem o histórico do WhatsApp.</p>
    <p>O time acompanha os registros da integração. Você não precisa confirmar que leu ou enviou uma mensagem.</p>
    <div class="acoes">
      <a v-if="lead.links.whatsapp" class="botao" :href="lead.links.whatsapp" target="_blank" rel="noopener">Ler no WhatsApp ↗</a>
    </div>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
    <details class="dobra">
      <summary>Trazer mensagens anteriores para o SquadOne</summary>
      <form class="crm-form" @submit.prevent="importar">
        <p>No celular, abra esta conversa → Exportar conversa → Sem mídia. Selecione o arquivo .txt em português. Só a conversa individual deste lead será acrescentada; áudios e anexos continuam no WhatsApp.</p>
        <label>Arquivo da conversa<input type="file" accept=".txt,text/plain" @change="escolher"></label>
        <label>Seu nome na exportação<input v-model="dono" maxlength="100" placeholder="Exatamente como aparece no arquivo" required></label>
        <p v-if="previa?.erro" role="alert">{{ previa.erro }}</p>
        <template v-if="previa?.dados">
          <p><strong>{{ previa.dados.mensagens.length }} mensagens</strong> entre você ({{ previa.dados.dono }}) e {{ previa.dados.contato }}.</p>
          <p>De {{ data(previa.dados.mensagens[0]!.em) }} a {{ data(previa.dados.mensagens.at(-1)!.em) }}.</p>
          <details class="dobra"><summary>Revisar mensagens antes de importar</summary><ol class="historico__previa"><li v-for="(m, i) in previa.dados.mensagens" :key="i"><strong>{{ m.direcao === 'saida' ? 'Você' : previa.dados.contato }}</strong> · {{ data(m.em) }}<p>{{ m.texto }}</p></li></ol></details>
          <label class="historico__confirmar"><input v-model="confirmar" type="checkbox">Confirmo que {{ previa.dados.contato }} é o contato de {{ lead.empresa }} e que identifiquei meu nome corretamente.</label>
          <button class="botao" type="submit" :disabled="!confirmar || importando">{{ importando ? 'Importando…' : 'Confirmar importação deste lead' }}</button>
        </template>
        <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
        <p v-if="status" role="status">{{ status }}</p>
      </form>
    </details>
  </section>
</template>

<style>
.historico { display: grid; gap: var(--esp-3); padding: var(--esp-4); border-left: var(--faixa) solid var(--destaque); background: var(--superficie-2); border-radius: var(--raio-controle); }
.historico h3, .historico p { margin: 0; }
.historico__confirmar { display: flex; align-items: flex-start; gap: var(--esp-2); }
.historico__confirmar input { width: auto; flex: none; }
.historico__previa { max-height: 20rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
