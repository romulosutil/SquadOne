<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { brl, diaMes, ROTULO_DA_NATUREZA } from './formato'
import type { Lancamento, ListaDeLancamentos } from './types'

// Lançamentos com filtro por conta, categoria e mês. O filtro mora na URL
// (?conta=&categoria=&mes=) para o link de uma categoria da Visão abrir aqui.
const props = defineProps<{ versao: number }>()

const conta = ref('')
const categoria = ref('')
const mes = ref('')
const lista = ref<ListaDeLancamentos | null>(null)
const itens = ref<Lancamento[]>([])
const carregando = ref(false)
const erro = ref('')

function lerEndereco() {
  const q = new URLSearchParams(window.location.search)
  conta.value = q.get('conta') ?? ''
  categoria.value = q.get('categoria') ?? ''
  mes.value = q.get('mes') ?? ''
}

function escreverEndereco() {
  const q = new URLSearchParams()
  if (conta.value) q.set('conta', conta.value)
  if (categoria.value) q.set('categoria', categoria.value)
  if (mes.value) q.set('mes', mes.value)
  const busca = q.toString()
  history.replaceState(null, '', `/financas/lancamentos${busca ? `?${busca}` : ''}`)
}

async function carregar(mais = false) {
  carregando.value = true
  erro.value = ''
  const q = new URLSearchParams()
  if (conta.value) q.set('conta', conta.value)
  if (categoria.value) q.set('categoria', categoria.value)
  if (mes.value) q.set('mes', mes.value)
  if (mais) q.set('offset', String(itens.value.length))
  try {
    const resposta = await fetch(`/api/financas/lancamentos?${q}`)
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    lista.value = corpo
    itens.value = mais ? [...itens.value, ...corpo.lancamentos] : corpo.lancamentos
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    carregando.value = false
  }
}

const porDia = computed(() => {
  const grupos: { dia: string; itens: Lancamento[] }[] = []
  for (const l of itens.value) {
    const ultimo = grupos.at(-1)
    if (ultimo?.dia === l.data) ultimo.itens.push(l)
    else grupos.push({ dia: l.data, itens: [l] })
  }
  return grupos
})

const filtrado = computed(() => Boolean(conta.value || categoria.value || mes.value))
const dia = (data: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${data}T12:00:00Z`))

function limpar() {
  conta.value = ''
  categoria.value = ''
  mes.value = ''
}

watch([conta, categoria, mes], () => {
  escreverEndereco()
  void carregar()
})
watch(() => props.versao, () => void carregar())

const aoVoltar = () => lerEndereco()
onMounted(() => {
  lerEndereco()
  // Com filtro na URL, o watch acima já carrega; sem, carrega aqui.
  if (!filtrado.value) void carregar()
  window.addEventListener('popstate', aoVoltar)
})
onBeforeUnmount(() => window.removeEventListener('popstate', aoVoltar))
</script>

<template>
  <section class="fin-bloco fin-bloco--largo" aria-labelledby="fin-lancamentos">
    <header class="fin-bloco__topo">
      <h2 id="fin-lancamentos">Lançamentos</h2>
      <p class="fin-sub" role="status">
        <template v-if="lista">{{ lista.total }} lançamento(s){{ filtrado ? ' no filtro' : '' }} · saldo do filtro {{ brl(lista.somaCentavos) }}</template>
        <template v-else-if="carregando">Carregando…</template>
      </p>
    </header>

    <form class="fin-filtros" @submit.prevent>
      <label>Conta
        <select v-model="conta">
          <option value="">Todas</option>
          <option v-for="c in lista?.contas ?? []" :key="c.id" :value="c.id">{{ c.nome }}</option>
        </select>
      </label>
      <label>Categoria
        <select v-model="categoria">
          <option value="">Todas</option>
          <option v-for="c in lista?.categorias ?? []" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <label>Mês
        <input v-model="mes" type="month" />
      </label>
      <button v-if="filtrado" type="button" class="fin-botao" @click="limpar">Limpar filtro</button>
    </form>

    <p v-if="erro" class="fin-aviso is-forte" role="alert">{{ erro }}</p>
    <p v-else-if="!carregando && !itens.length" class="fin-vazio">Nada aqui{{ filtrado ? ' com este filtro' : '' }}.</p>

    <div v-for="g in porDia" :key="g.dia" class="fin-dia">
      <h3>{{ dia(g.dia) }}</h3>
      <ul class="fin-linhas">
        <li v-for="l in g.itens" :key="l.id">
          <span>
            <b>{{ l.descricao }}</b>
            <small>
              {{ l.conta }} · {{ l.categoria || 'Sem categoria' }}
              <template v-if="l.parcela"> · parcela {{ l.parcela }}</template>
              <template v-if="l.natureza !== 'despesa' && l.natureza !== 'receita' && ROTULO_DA_NATUREZA[l.natureza] !== l.categoria"> · {{ ROTULO_DA_NATUREZA[l.natureza] }}</template>
              <template v-if="l.dataCompra !== l.data"> · compra em {{ diaMes(l.dataCompra) }}</template>
              <template v-if="l.pendente"> · <span class="fin-pilula is-atualizando">pendente</span></template>
            </small>
          </span>
          <span class="fin-valor" :class="{ 'is-positivo': l.centavos > 0, 'is-neutro': l.natureza === 'transferencia' || l.natureza === 'pagamento_fatura' }">{{ brl(l.centavos) }}</span>
        </li>
      </ul>
    </div>

    <button v-if="lista && itens.length < lista.total" type="button" class="fin-botao fin-mais" :disabled="carregando" @click="carregar(true)">
      Mostrar mais ({{ lista.total - itens.length }})
    </button>
  </section>
</template>
