<script setup lang="ts">
import { computed, markRaw, onMounted, ref, shallowRef } from 'vue'
import GameMap from '../../src/components/GameMap.vue'
import { equipe, estacoes } from './fixture'
import type { FaseDoEscritorio } from '../../src/office/jornada-do-escritorio'
import type { PassagemDaProducao } from '../../src/office/linha-de-producao'
import { criarRenderizadorPixi } from './renderizador-pixi'
import { medirCadencia } from './medicao'
import { useMovimentoDoEscritorio } from '../../src/office/movimento'

declare const __OFFICE_BASELINE__: string
const parametros = new URLSearchParams(location.search)
const componente = shallowRef<typeof GameMap | null>(null)
const referenciaPronta = ref(false)
const referencia = ref('atual')
const modo = ref(parametros.get('renderer') === 'pixi' ? 'pixi' : 'dom')
const congelado = ref(parametros.has('freeze'))
const cenario = ref(parametros.get('scene') !== 'salas')
const backend = ref('DOM/CSS')
const { animar, alternar } = useMovimentoDoEscritorio()
const criarPixi = () => criarRenderizadorPixi({ pronto: texto => { backend.value = texto }, congelado: () => congelado.value, movimento: () => animar.value })
const medicao = ref('')
const medindo = ref(false)
async function medir() {
  if (medindo.value) return
  const renderer = modo.value, agents = quantidade.value
  medindo.value = true; medicao.value = ''
  try { medicao.value = JSON.stringify({ renderer, agents, ...await medirCadencia() }) }
  finally { medindo.value = false }
}
onMounted(async () => {
  const alvo = parametros.has('baseline') && __OFFICE_BASELINE__
    ? (await import(/* @vite-ignore */ __OFFICE_BASELINE__)).default : GameMap
  referencia.value = parametros.has('baseline') && __OFFICE_BASELINE__ ? 'snapshot' : 'atual'
  await document.fonts.ready
  componente.value = markRaw(alvo)
  referenciaPronta.value = true
})

const quantidade = ref(Number(parametros.get('agents')) || 18)
const squad = computed(() => equipe(quantidade.value))
const selecionada = ref<FaseDoEscritorio | null>(null)
const passagem = ref<PassagemDaProducao | null>(null)
const visita = ref<string | null>(null)
const recado = ref('Dados fictícios · nenhuma integração conectada')
const modal = ref('')
let sequencia = 0
function entregar() {
  passagem.value = { id: `teste-${++sequencia}`, leadId: 'cliente-0', empresa: 'Empresa exemplo', de: 1, para: 4,
    em: '2026-10-26T12:00:00Z', motivo: 'Material confirmado no cenário de teste', salaPortadora: 'prumo--geral' }
}
</script>
<template>
  <div class="comparacao" :data-pronto="referenciaPronta" :data-referencia="referencia" :data-passagem="passagem?.id ?? ''">
    <header>
      <strong>Escritório · comparação local</strong>
      <label>Renderizador <select v-model="modo" aria-label="Renderizador" :disabled="medindo"><option value="dom">DOM atual</option><option value="pixi">PixiJS (corpos)</option></select></label>
      <label>Agentes <select v-model="quantidade" aria-label="Quantidade de agentes" :disabled="medindo"><option :value="18">18</option><option :value="60">60</option><option :value="120">120</option></select></label>
      <button @click="entregar" :disabled="medindo">Simular passagem</button>
      <button @click="visita = visita ? null : 'prumo--site-antes-da-venda'" :disabled="medindo">Visitar produção</button>
      <button @click="alternar" :disabled="medindo">{{ animar ? 'Reduzir movimento' : 'Animar' }}</button>
      <button @click="medir" :disabled="medindo">{{ medindo ? 'Medindo…' : 'Medir 5 segundos' }}</button>
      <label><input type="checkbox" v-model="cenario" :disabled="medindo"> Ilustração</label>
      <small data-backend>{{ modo === 'pixi' && cenario ? backend : 'DOM/CSS' }}</small>
      <span role="status">{{ recado }}</span>
      <output v-if="medicao" data-medicao>{{ medicao }}</output>
    </header>
    <main>
      <component v-if="componente" :is="componente" :key="`${quantidade}-${modo}-${cenario}`" :squad="squad" :imersivo="cenario" :visita="visita" :estacoes-producao="estacoes"
        :criar-renderizador="modo === 'pixi' && cenario ? criarPixi : undefined" :class="{ congelado }"
        :estacao-selecionada="selecionada" producao-disponivel :passagem="passagem" :suspenso="!!modal"
        :painel-agentes="{ resumo: 'Time de demonstração', detalhe: 'Mesmo cenário e sprites do escritório' }"
        :painel-decisoes="{ resumo: '1 decisão', detalhe: 'Conferir próximo passo' }"
        @abrir-agente="(_, id) => modal = `Conversa com ${id}`" @painel="tipo => modal = tipo === 'agentes' ? 'Jornada do time' : 'Sua vez'"
        @estacao="selecionada = $event" @cliente="modal = `Jornada de ${$event}`"
        @transporte="recado = $event || 'Dados fictícios · nenhuma integração conectada'"
        @passagem-finalizada="passagem = null" />
    </main>
    <div v-if="modal" class="modal-fundo" @click.self="modal = ''" @keydown.esc="modal = ''">
      <section role="dialog" aria-modal="true" :aria-label="modal" tabindex="-1"><h2>{{ modal }}</h2><p>Interação demonstrativa; a aplicação principal conserva os painéis atuais.</p><button autofocus @click="modal = ''">Fechar</button></section>
    </div>
  </div>
</template>
<style>
html, body, #app, .comparacao { margin:0; width:100%; height:100%; overflow:hidden; }
.comparacao { font-family:var(--fonte); background:#20283a; color:#f8ecd6; display:flex; flex-direction:column; }
.comparacao header { height:128px; flex:0 0 128px; overflow:auto; box-sizing:border-box; padding:12px 20px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; background:#172d2f; }
.comparacao header button,.comparacao select,.modal-fundo button { background:#f3dfaf; color:#243b38; border:1px solid #9b875a; border-radius:6px; padding:8px 12px; min-height:40px; cursor:pointer; }
.comparacao header span { font-size:12px; }
.comparacao header small { font-size:11px; }
.comparacao output { font:11px/1.3 monospace; }
.comparacao .actor[data-pixi] .actor__billboard { visibility:hidden; }
.comparacao .congelado .actor__strip--idle { animation:none !important; }
.comparacao main { flex:1; min-height:0; }
.modal-fundo { position:fixed; inset:0; z-index:200000; display:grid; place-items:center; background:#0008; padding:24px; }
.modal-fundo section { background:#fff1d6; color:#243b38; padding:24px; border-radius:12px; max-width:420px; }
@media(max-width:600px) { .comparacao header{height:240px;flex-basis:240px;padding:8px;gap:6px;} }
</style>
