<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  adicionarCriterio, alternarCriterio, chaveDoCriterio, cohortVazio, descreverCohort, opcoesDoCohort, rotuloDoCriterio, semCriterios, temCriterio,
  type ColunaDoCohort, type Cohort, type Criterio, type LeadDoCohort,
} from './cohort'
import { SIGLA_DO_PRODUTO } from './crm-formato'
import { PASSOS } from './jornada'
import type { CrmProduto } from './types'

// "Filtro por motivo" da Triagem (cohort.ts, 17/10/2026): o que o prospect DEVE ter e o que o
// DESQUALIFICA, com a contagem ao vivo. Peças: BP-DOBRA (fechado por padrão, com o resumo à vista; no
// celular é o mesmo "Filtros" fechado do resto de Vendas) e BP-ESCOLHAS (os chips; escolhido em
// --destaque, com aria-pressed). Só FILTRA quem entra nos lotes: não envia nem decide nada, e o
// Convidar e o Dispensar seguem com as travas de lá (CrmHoje.vue). O pai guarda o cohort.
const props = defineProps<{
  modelValue: Cohort
  /** Os prospects que ainda esperam decisão: é sobre eles que as opções e as contagens valem. */
  leads: readonly LeadDoCohort[]
  quantos: { batem: number; semLeitura: number; total: number }
}>()
const emit = defineEmits<{ 'update:modelValue': [cohort: Cohort] }>()

// As opções só são calculadas com o painel aberto: fechado, nada disto é lido.
const aberto = ref(false)
const opcoes = computed(() => opcoesDoCohort(props.leads))

const ativo = computed(() => !semCriterios(props.modelValue))
const numero = (n: number) => n.toLocaleString('pt-BR')
const resumo = computed(() => (ativo.value ? `${numero(props.quantos.batem)} de ${numero(props.quantos.total)}` : 'desligado'))

const COLUNAS: ReadonlyArray<{ id: ColunaDoCohort; titulo: string; dica: string }> = [
  { id: 'deve', titulo: 'Deve ter', dica: 'todos estes' },
  { id: 'naoPode', titulo: 'Desqualifica', dica: 'qualquer um destes' },
]

// Os chips que o grupo permite (cada um separa alguém de alguém), mais o que já está escolhido na
// coluna: um filtro guardado de outro dia continua à vista e dá para tirar, mesmo sem opção hoje.
const chipsDoGrupo = computed<Criterio[]>(() => {
  const o = opcoes.value
  return [
    ...(o.temSite ? [{ tipo: 'temSite' } as Criterio] : []),
    ...(o.whatsappPublicado ? [{ tipo: 'whatsappPublicado' } as Criterio] : []),
    ...o.pontuacoes.map((minimo): Criterio => ({ tipo: 'pontuacao', minimo })),
    ...o.sinais.map((chave): Criterio => ({ tipo: 'sinal', chave })),
  ]
})
function chips(coluna: ColunaDoCohort): Criterio[] {
  const vistos = new Set<string>()
  return [...chipsDoGrupo.value, ...props.modelValue[coluna]].filter((c) => {
    const k = chaveDoCriterio(c)
    return vistos.has(k) ? false : (vistos.add(k), true)
  })
}

type TipoEscolhido = 'oferta' | 'nicho' | 'cidade' | 'passo'
const escolhas = computed<Array<{ tipo: TipoEscolhido; rotulo: string; opcoes: Array<{ valor: string; rotulo: string; quantos: number }> }>>(() => {
  const o = opcoes.value
  return [
    { tipo: 'oferta' as const, rotulo: 'Oferta', opcoes: o.ofertas.map((x) => ({ valor: x.valor, rotulo: SIGLA_DO_PRODUTO[x.valor], quantos: x.quantos })) },
    { tipo: 'nicho' as const, rotulo: 'Nicho', opcoes: o.nichos.map((x) => ({ valor: x.valor, rotulo: x.valor, quantos: x.quantos })) },
    { tipo: 'cidade' as const, rotulo: 'Cidade', opcoes: o.cidades.map((x) => ({ valor: x.valor, rotulo: x.valor, quantos: x.quantos })) },
    { tipo: 'passo' as const, rotulo: 'Passo', opcoes: o.passos.map((x) => ({ valor: x.valor, rotulo: PASSOS.find((p) => p.id === x.valor)?.nome ?? x.valor, quantos: x.quantos })) },
  ].filter((e) => e.opcoes.length)
})

const mudar = (cohort: Cohort) => emit('update:modelValue', cohort)
const alternar = (coluna: ColunaDoCohort, c: Criterio) => mudar(alternarCriterio(props.modelValue, coluna, c))

function aoEscolher(coluna: ColunaDoCohort, tipo: TipoEscolhido, evento: Event) {
  const campo = evento.target as HTMLSelectElement
  const valor = campo.value
  campo.value = ''
  if (!valor) return
  const criterio: Criterio = tipo === 'nicho' || tipo === 'cidade' ? { tipo, valor }
    : tipo === 'oferta' ? { tipo, valor: valor as CrmProduto }
      : { tipo, valor: valor as Extract<Criterio, { tipo: 'passo' }>['valor'] }
  mudar(adicionarCriterio(props.modelValue, coluna, criterio))
}
</script>

<template>
  <div class="crm-cohort-raiz">
    <details class="dobra crm-cohort" @toggle="aberto = ($event.target as HTMLDetailsElement).open">
      <summary>Filtro por motivo<span class="crm-cohort__resumo">{{ resumo }}</span></summary>
      <template v-if="aberto">
        <p class="crm-nota-pequena">Escolha o que o prospect deve ter e o que o desqualifica. Isto só muda quem entra nos lotes: convidar e dispensar continuam sendo decisão sua, com as mesmas travas.</p>
        <div class="crm-cohort__colunas">
          <div v-for="coluna in COLUNAS" :key="coluna.id" class="crm-cohort__coluna" role="group" :aria-labelledby="`crm-cohort-${coluna.id}`">
            <p :id="`crm-cohort-${coluna.id}`" class="rotulo">{{ coluna.titulo }}<small>{{ coluna.dica }}</small></p>
            <div v-if="chips(coluna.id).length" class="escolhas">
              <button v-for="c in chips(coluna.id)" :key="chaveDoCriterio(c)" type="button" :aria-pressed="temCriterio(modelValue, coluna.id, c)" @click="alternar(coluna.id, c)">
                {{ rotuloDoCriterio(c) }}
              </button>
            </div>
            <div v-if="escolhas.length" class="crm-cohort__campos">
              <label v-for="e in escolhas" :key="e.tipo" class="rotulo">
                <span>{{ e.rotulo }}</span>
                <select class="campo" @change="aoEscolher(coluna.id, e.tipo, $event)">
                  <option value="">Escolher…</option>
                  <option v-for="o in e.opcoes" :key="o.valor" :value="o.valor">{{ o.rotulo }} ({{ numero(o.quantos) }})</option>
                </select>
              </label>
            </div>
            <p v-if="!chips(coluna.id).length && !escolhas.length" class="crm-nota-pequena">Nada separa estes prospects entre si.</p>
          </div>
        </div>
        <p v-if="!opcoes.sinais.length" class="crm-nota-pequena">Ainda sem leitura dos sinais do site (anúncios, agência, agendamento) neste grupo: só os dados da planilha viram critério.</p>
        <p class="crm-cohort__conta" role="status">
          <strong>{{ numero(quantos.batem) }}</strong> {{ quantos.batem === 1 ? 'bate' : 'batem' }} de {{ numero(quantos.total) }}<template v-if="quantos.semLeitura"> · {{ numero(quantos.semLeitura) }} sem leitura de algum critério (não entram nos lotes)</template>
        </p>
        <p v-if="ativo" class="acoes">
          <button type="button" class="botao botao--leve" @click="mudar(cohortVazio())">Limpar o filtro</button>
        </p>
      </template>
    </details>
    <!-- Com o painel fechado o filtro continua dito por extenso: quem abre a Triagem vê por que a lista é curta. -->
    <p v-if="ativo" class="crm-nota-pequena crm-cohort__texto">Filtro por motivo: {{ descreverCohort(modelValue) }}. {{ numero(quantos.batem) }} de {{ numero(quantos.total) }}<template v-if="quantos.semLeitura">; {{ numero(quantos.semLeitura) }} sem leitura</template>.</p>
  </div>
</template>
