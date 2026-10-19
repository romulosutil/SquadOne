<script setup lang="ts">
import { ref } from 'vue'
import { useAtualizacaoViva } from '../../casca/atualizacao-viva'
import FinLancamentos from './FinLancamentos.vue'
import FinOrganizar from './FinOrganizar.vue'
import FinSaude from './FinSaude.vue'
import FinVisao from './FinVisao.vue'
import type { VisaoFinanceira } from './types'
import './financas.css'

// Finanças (06/10/2026): Visão (/financas, com o "Importar" único de fatura em
// PDF e extrato OFX/CSV desde 16/10/2026), Lançamentos (/financas/lancamentos)
// e Organizar (/financas/organizar: categorias, orçamento e regras, 07/10/2026).
// O cabeçalho com a saúde de cada conexão e o "dados
// até" vale para as três. Valores só nesta tela (RULES 24): nada de R$ em
// título, anúncio ou URL.
const props = defineProps<{ caminho: string }>()

const aba = props.caminho.startsWith('/financas/lancamentos') ? 'lancamentos' : props.caminho.startsWith('/financas/organizar') ? 'organizar' : 'visao'
const TITULO = { visao: 'Visão', lancamentos: 'Lançamentos', organizar: 'Organizar' } as const
const dados = ref<VisaoFinanceira | null>(null)
const carregando = ref(true)
const erro = ref('')
const anuncio = ref('')
const versao = ref(0)
let mes = new URLSearchParams(window.location.search).get('mes') ?? ''
let visao: 'competencia' | 'caixa' = new URLSearchParams(window.location.search).get('visao') === 'caixa' ? 'caixa' : 'competencia'

async function carregar(signal?: AbortSignal) {
  carregando.value = true
  erro.value = ''
  const q = new URLSearchParams({ visao })
  if (mes) q.set('mes', mes)
  try {
    const resposta = await fetch(`/api/financas/visao?${q}`, { signal, cache: 'no-store' })
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

useAtualizacaoViva(signal => carregar(signal), 60_000)
</script>

<template>
  <div class="fin">
    <header class="fin-topo">
      <div>
        <span class="fin-kicker">Finanças</span>
        <h1>{{ TITULO[aba] }}</h1>
      </div>
      <nav class="fin-abas" aria-label="Finanças">
        <a href="/financas" :aria-current="aba === 'visao' ? 'page' : undefined">Visão</a>
        <a href="/financas/lancamentos" :aria-current="aba === 'lancamentos' ? 'page' : undefined">Lançamentos</a>
        <a href="/financas/organizar" :aria-current="aba === 'organizar' ? 'page' : undefined">Organizar</a>
      </nav>
    </header>

    <p class="fin-anuncio" role="status" aria-live="polite">{{ anuncio }}</p>

    <!-- O "Atualizar" (era "Atualizar agora"; AC-13: um nome nas três recargas) era o primário amarelo da tela, de largura inteira no celular, para um
         gesto raro: a tela já relê a cada 5 min e a Pluggy lê os bancos sozinha. Vira um botão
         pequeno ao lado do "dados até" (AC-25), o lugar onde se vê que está velho. -->
    <FinSaude v-if="dados" :conexoes="dados.saude.conexoes" :dados-ate="dados.saude.dadosAte" :situacao="dados">
      <span class="sincronizacao" role="status">{{ dados.sincronizando ? 'Lendo os bancos…' : 'Atualização automática' }}</span>
    </FinSaude>
    <p v-if="erro" class="fin-aviso is-forte" role="alert">{{ erro }} <button type="button" class="fin-botao" @click="carregar()">Tentar de novo</button></p>
    <p v-else-if="carregando && !dados" class="fin-sub" role="status">Carregando…</p>

    <FinVisao v-if="aba === 'visao' && dados" :dados="dados" @mudar="mudar" @importado="carregar" />
    <FinLancamentos v-if="aba === 'lancamentos'" :versao="versao" />
    <FinOrganizar v-if="aba === 'organizar'" :versao="versao" @mudou="carregar" />
  </div>
</template>
