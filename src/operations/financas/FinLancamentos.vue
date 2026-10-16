<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FinEditorDeLancamento from './FinEditorDeLancamento.vue'
import { brl, diaMes, ROTULO_DA_NATUREZA } from './formato'
import type { Lancamento, ListaDeLancamentos } from './types'

// Lançamentos com filtro por conta, categoria e mês. O filtro mora na URL
// (?conta=&categoria=&mes=) para o link de uma categoria da Visão abrir aqui.
// Tocar num lançamento abre o editor (FinEditorDeLancamento.vue).
const props = defineProps<{ versao: number }>()

const aberto = ref('')
const anuncio = ref('')

function abrir(l: Lancamento) {
  aberto.value = aberto.value === l.id ? '' : l.id
}

async function aoSalvar(texto: string) {
  anuncio.value = texto
  aberto.value = ''
  await carregar()
}

// A partir de 64 rem (16/10/2026, item 7 da auditoria de 15/10), uma <table> de verdade:
// na lista, o nome ficava a meio metro do valor e revisar 40 categorias era atravessar
// a tela 40 vezes. Abaixo disso, a lista por dia de sempre. Uma das duas no DOM, nunca
// as duas: o editor tem id e o leitor de tela leria tudo duas vezes.
const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 64rem)') : null
const largo = ref(mq?.matches ?? false)
const aoMudarLargura = (e: MediaQueryListEvent) => { largo.value = e.matches }

/** As categorias que se escolhem à mão; a atual entra mesmo sendo fixa, para o select mostrar o que é. */
const opcoesDe = (l: Lancamento) => {
  const escolhiveis = lista.value?.categoriasEscolhiveis ?? []
  return escolhiveis.includes(l.categoria) ? escolhiveis : [l.categoria, ...escolhiveis]
}

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
/** Zebra da tabela pela posição na lista inteira: o nth-child contaria a linha do editor aberto. */
const posicao = computed(() => new Map(itens.value.map((l, i) => [l.id, i])))

const classeDoValor = (l: Lancamento) => ({ 'is-positivo': l.centavos > 0, 'is-neutro': l.natureza === 'transferencia' || l.natureza === 'pagamento_fatura' })
/** O que vem depois de conta e categoria na lista; na tabela, embaixo da descrição. */
function detalhes(l: Lancamento): string[] {
  const d: string[] = []
  if (l.parcela) d.push(`parcela ${l.parcela}`)
  if (l.natureza !== 'despesa' && l.natureza !== 'receita' && ROTULO_DA_NATUREZA[l.natureza] !== l.categoria) d.push(ROTULO_DA_NATUREZA[l.natureza])
  if (l.dataCompra !== l.data) d.push(`compra em ${diaMes(l.dataCompra)}`)
  if (l.recorrente) d.push('recorrente')
  return d
}

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
  mq?.addEventListener('change', aoMudarLargura)
})
onBeforeUnmount(() => {
  window.removeEventListener('popstate', aoVoltar)
  mq?.removeEventListener('change', aoMudarLargura)
})
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
    <p class="fin-anuncio" role="status" aria-live="polite">{{ anuncio }}</p>

    <table v-if="largo && itens.length" class="fin-tabela">
      <caption class="so-leitor">Lançamentos, do mais recente para o mais antigo. Escolha a descrição para trocar a categoria.</caption>
      <thead>
        <tr>
          <th scope="col">Data</th>
          <th scope="col">Descrição</th>
          <th scope="col">Categoria</th>
          <th scope="col">Conta</th>
          <th scope="col" class="fin-tabela__valor">Valor</th>
        </tr>
      </thead>
      <!-- Um tbody por dia: o dia aparece só na primeira linha do grupo (o leitor de tela ouve em todas). -->
      <tbody v-for="g in porDia" :key="g.dia">
        <template v-for="(l, i) in g.itens" :key="l.id">
          <tr :class="{ 'is-par': (posicao.get(l.id) ?? 0) % 2 === 1, 'is-aberto': aberto === l.id }" @click="abrir(l)">
            <td class="fin-tabela__data"><span :class="{ 'so-leitor': i > 0 }">{{ dia(g.dia) }}</span></td>
            <td>
              <button type="button" class="fin-tabela__abrir" :aria-expanded="aberto === l.id" :aria-controls="`editor-${l.id}`" @click.stop="abrir(l)">{{ l.descricao }}</button>
              <small v-if="detalhes(l).length || l.pendente">
                {{ detalhes(l).join(' · ') }}<template v-if="l.pendente">{{ detalhes(l).length ? ' · ' : '' }}<span class="fin-pilula is-atualizando">pendente</span></template>
              </small>
            </td>
            <td>{{ l.categoria || 'Sem categoria' }}<small v-if="l.origemCategoria === 'regra_usuario'" class="fin-tabela__regra"> (regra sua)</small></td>
            <td>{{ l.conta }}</td>
            <td class="fin-tabela__valor fin-valor" :class="classeDoValor(l)">{{ brl(l.centavos) }}</td>
          </tr>
          <tr v-if="aberto === l.id" class="fin-tabela__editor">
            <td colspan="5">
              <FinEditorDeLancamento :lancamento="l" :opcoes="opcoesDe(l)" @salvo="aoSalvar" @fechar="aberto = ''" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <template v-else>
      <div v-for="g in porDia" :key="g.dia" class="fin-dia">
        <h3>{{ dia(g.dia) }}</h3>
        <ul class="fin-linhas">
          <li v-for="l in g.itens" :key="l.id" class="fin-lanc">
            <button type="button" class="fin-lanc__abrir" :aria-expanded="aberto === l.id" :aria-controls="`editor-${l.id}`" @click="abrir(l)">
              <span>
                <b>{{ l.descricao }}</b>
                <small>
                  {{ l.conta }} · {{ l.categoria || 'Sem categoria' }}
                  <template v-if="l.origemCategoria === 'regra_usuario'"> (regra sua)</template>
                  <template v-for="d in detalhes(l)" :key="d"> · {{ d }}</template>
                  <template v-if="l.pendente"> · <span class="fin-pilula is-atualizando">pendente</span></template>
                </small>
              </span>
              <span class="fin-valor" :class="classeDoValor(l)">{{ brl(l.centavos) }}</span>
            </button>
            <FinEditorDeLancamento v-if="aberto === l.id" :lancamento="l" :opcoes="opcoesDe(l)" @salvo="aoSalvar" @fechar="aberto = ''" />
          </li>
        </ul>
      </div>
    </template>

    <button v-if="lista && itens.length < lista.total" type="button" class="fin-botao fin-mais" :disabled="carregando" @click="carregar(true)">
      Mostrar mais ({{ lista.total - itens.length }})
    </button>
  </section>
</template>
