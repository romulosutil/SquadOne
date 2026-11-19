<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import CrmFicha from './CrmFicha.vue'
import { orientacaoDoAtendimento } from './atendimento-cliente'
import type { AcaoDeVenda } from './proxima-venda'
import type { CrmLead, CrmVisao } from './types'
import type { EnviosLiberados } from './trava-de-horario'
import type { EstadoDoRitmo } from './trava-de-ritmo'
import type { DetalheDoCliente } from './vendas-abas'
import type { EventoWhatsApp } from './canais-comerciais'

const MissaoDaConversa = defineAsyncComponent(() => import('../office/MissaoDaConversa.vue'))

const props = defineProps<{
  lead: CrmLead; visao: CrmVisao; disponivel: boolean; inicial: DetalheDoCliente
  agora: number; acao?: AcaoDeVenda | null; aviso?: string | null
  liberados: EnviosLiberados; ritmo: EstadoDoRitmo
  fichaDireta?: boolean; eventoWhatsApp?: EventoWhatsApp
}>()
const emit = defineEmits<{
  fechar: []; registrado: []; colinha: []; ocupado: [valor: boolean]; detalhe: [modo: DetalheDoCliente]
  liberar: [id: string]; primeiro: [id: string]
}>()
const modo = ref(props.fichaDireta ? 'ficha' : props.inicial), ocupado = ref(false)
const visitouOrientacao = ref(!props.fichaDireta && props.inicial === 'orientacao'), visitouFicha = ref(props.fichaDireta || props.inicial === 'ficha')
const conteudo = ref<HTMLElement | null>(null)
watch(() => props.inicial, valor => { modo.value = props.fichaDireta ? 'ficha' : valor })
watch(modo, async valor => {
  if (valor === 'orientacao') visitouOrientacao.value = true
  else visitouFicha.value = true
  await nextTick()
  conteudo.value?.focus({ preventScroll: true })
  conteudo.value?.scrollIntoView({ block: 'start' })
})
function mudar(valor: DetalheDoCliente) {
  if (ocupado.value) return
  modo.value = valor
  emit('detalhe', valor)
}
function mudarOcupado(valor: boolean) { ocupado.value = valor; emit('ocupado', valor) }
const atendimento = computed(() => orientacaoDoAtendimento(props.lead, props.visao.leads, props.agora))
const plano = computed(() => atendimento.value.plano)
const procedimento = computed(() => atendimento.value.procedimento)
const estado = computed(() => atendimento.value.estado)
const visaoDaFicha = computed(() => props.disponivel ? props.visao : {
  ...props.visao, registro: { ...props.visao.registro, disponivel: false, motivo: 'A leitura está indisponível ou atrasada. Atualize antes de registrar.' },
})
</script>

<template>
  <div ref="conteudo" class="atendimento-cliente" tabindex="-1">
    <nav v-if="!fichaDireta" class="atendimento-cliente__navegacao" aria-label="Visão deste cliente">
      <button class="botao botao--leve" type="button" :aria-pressed="modo === 'orientacao'" :disabled="ocupado" @click="mudar('orientacao')">Orientação de atendimento</button>
      <button class="botao botao--leve" type="button" :aria-pressed="modo === 'ficha'" :disabled="ocupado" @click="mudar('ficha')">Ficha completa e registros</button>
    </nav>
    <div v-if="visitouOrientacao" v-show="modo === 'orientacao'">
      <MissaoDaConversa :lead="lead" :acao="acao" :orientacao="plano" :procedimento-inicial="procedimento" :passo-inicial="1" :estado="estado" :motivo="plano.acao" :disponivel="disponivel" :registro-disponivel="visao.registro.disponivel"
        @ficha="mudar('ficha')" @fila="emit('fechar')" @ocupado="mudarOcupado" @registrado="emit('registrado')" />
    </div>
    <div v-if="visitouFicha" v-show="modo === 'ficha'" class="crm-na-folha">
      <CrmFicha :lead="lead" :visao="visaoDaFicha" :orientacao="plano" :evento-whats-app="eventoWhatsApp" :central="fichaDireta" :aviso="aviso" :liberados="liberados" :ritmo="ritmo"
        @registrado="emit('registrado')" @colinha="emit('colinha')" @liberar="emit('liberar', $event)" @primeiro="emit('primeiro', $event)" />
    </div>
  </div>
</template>

<style scoped>
.atendimento-cliente { display: grid; gap: var(--esp-5); min-width: 0; outline: none; }
.atendimento-cliente__navegacao { display: flex; flex-wrap: wrap; gap: var(--esp-2); padding-bottom: var(--esp-3); border-bottom: var(--contorno-painel); }
.atendimento-cliente__navegacao button { font-size: var(--tam-apoio); }
.atendimento-cliente__navegacao [aria-pressed="true"] { background: var(--realce); box-shadow: inset 0 -3px 0 var(--destaque); }
</style>
