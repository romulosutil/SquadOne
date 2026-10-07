<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import FinLancamentos from './FinLancamentos.vue'
import FinSaude from './FinSaude.vue'
import FinVisao from './FinVisao.vue'
import type { VisaoFinanceira } from './types'
import './financas.css'

// Finanças (06/10/2026): Visão (/financas) e Lançamentos (/financas/lancamentos).
// O cabeçalho com a saúde de cada conexão e o "dados até" vale para as duas.
// Valores só nesta tela (RULES 24): nada de R$ em título, anúncio ou URL.
const props = defineProps<{ caminho: string }>()

const aba = props.caminho.startsWith('/financas/lancamentos') ? 'lancamentos' : 'visao'
const dados = ref<VisaoFinanceira | null>(null)
const carregando = ref(true)
const erro = ref('')
const anuncio = ref('')
const atualizando = ref(false)
const versao = ref(0)
let mes = new URLSearchParams(window.location.search).get('mes') ?? ''
let visao: 'competencia' | 'caixa' = new URLSearchParams(window.location.search).get('visao') === 'caixa' ? 'caixa' : 'competencia'

async function carregar() {
  carregando.value = true
  erro.value = ''
  const q = new URLSearchParams({ visao })
  if (mes) q.set('mes', mes)
  try {
    const resposta = await fetch(`/api/financas/visao?${q}`)
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    dados.value = corpo
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    carregando.value = false
  }
}

function mudar(novoMes: string, novaVisao: 'competencia' | 'caixa') {
  mes = novoMes
  visao = novaVisao
  const q = new URLSearchParams()
  if (dados.value && novoMes !== dados.value.hoje.slice(0, 7)) q.set('mes', novoMes)
  if (novaVisao === 'caixa') q.set('visao', 'caixa')
  history.replaceState(null, '', `/financas${q.toString() ? `?${q}` : ''}`)
  void carregar()
}

async function atualizarAgora() {
  atualizando.value = true
  anuncio.value = 'Lendo os bancos pela Pluggy…'
  try {
    const resposta = await fetch('/api/financas/sincronizar', { method: 'POST' })
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    const falhas = (corpo.conexoes ?? []).filter((c: { erro: string | null }) => c.erro)
    anuncio.value = falhas.length
      ? `Atualizado, mas ${falhas.length} conexão(ões) falharam: ${falhas.map((c: { nome: string }) => c.nome).join(', ')}.`
      : `Atualizado: ${corpo.conexoes?.length ?? 0} conexão(ões) lidas.`
  } catch (e) {
    anuncio.value = e instanceof Error ? e.message : String(e)
  } finally {
    atualizando.value = false
    versao.value += 1
    await carregar()
  }
}

let temporizador = 0
onMounted(() => {
  void carregar()
  // A leitura diária pode chegar com a tela aberta; relê a cada 5 min com a aba visível.
  temporizador = window.setInterval(() => {
    if (document.visibilityState === 'visible') void carregar()
  }, 5 * 60_000)
})
onBeforeUnmount(() => window.clearInterval(temporizador))
</script>

<template>
  <div class="fin">
    <header class="fin-topo">
      <div>
        <span class="fin-kicker">Finanças</span>
        <h1>{{ aba === 'visao' ? 'Visão' : 'Lançamentos' }}</h1>
      </div>
      <nav class="fin-abas" aria-label="Finanças">
        <a href="/financas" :aria-current="aba === 'visao' ? 'page' : undefined">Visão</a>
        <a href="/financas/lancamentos" :aria-current="aba === 'lancamentos' ? 'page' : undefined">Lançamentos</a>
      </nav>
      <button
        type="button"
        class="fin-botao fin-botao--primario"
        :disabled="atualizando || dados?.sincronizando || !dados?.pluggyConfigurada"
        @click="atualizarAgora"
      >
        {{ atualizando || dados?.sincronizando ? 'Atualizando…' : 'Atualizar agora' }}
      </button>
    </header>

    <p class="fin-anuncio" role="status" aria-live="polite">{{ anuncio }}</p>

    <FinSaude v-if="dados" :conexoes="dados.saude.conexoes" :dados-ate="dados.saude.dadosAte" :situacao="dados" />
    <p v-if="erro" class="fin-aviso is-forte" role="alert">{{ erro }} <button type="button" class="fin-botao" @click="carregar">Tentar de novo</button></p>
    <p v-else-if="carregando && !dados" class="fin-sub" role="status">Carregando…</p>

    <FinVisao v-if="aba === 'visao' && dados" :dados="dados" @mudar="mudar" @importado="carregar" />
    <FinLancamentos v-if="aba === 'lancamentos'" :versao="versao" />
  </div>
</template>
