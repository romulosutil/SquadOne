<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { brl, diaMes, enviarJson, ROTULO_DA_NATUREZA } from './formato'
import type { Lancamento, ListaDeLancamentos } from './types'

// Lançamentos com filtro por conta, categoria e mês. O filtro mora na URL
// (?conta=&categoria=&mes=) para o link de uma categoria da Visão abrir aqui.
// Tocar num lançamento abre o editor (07/10/2026): trocar a categoria, com
// "aplicar sempre a este estabelecimento" (vira regra), e marcar ou desmarcar
// como recorrente.
const props = defineProps<{ versao: number }>()

const aberto = ref('')
const novaCategoria = ref('')
const aplicarSempre = ref(false)
const salvando = ref(false)
const erroDoEditor = ref('')
const anuncio = ref('')

function abrir(l: Lancamento) {
  if (aberto.value === l.id) {
    aberto.value = ''
    return
  }
  aberto.value = l.id
  novaCategoria.value = l.categoria
  aplicarSempre.value = false
  erroDoEditor.value = ''
}

async function salvarCategoria(l: Lancamento) {
  salvando.value = true
  erroDoEditor.value = ''
  try {
    const r = await enviarJson<{ categoria: string; regra: string | null }>('PATCH', `/lancamentos/${encodeURIComponent(l.id)}`, {
      categoria: novaCategoria.value,
      aplicarSempre: aplicarSempre.value,
    })
    anuncio.value = r.regra ? `Categoria trocada para ${r.categoria}, e daqui para a frente também nos outros deste estabelecimento.` : `Categoria trocada para ${r.categoria}.`
    aberto.value = ''
    await carregar()
  } catch (e) {
    erroDoEditor.value = e instanceof Error ? e.message : String(e)
  } finally {
    salvando.value = false
  }
}

async function marcarRecorrente(l: Lancamento, recorrente: boolean) {
  salvando.value = true
  erroDoEditor.value = ''
  try {
    // Desmarcar o que só estava por marca volta para a detecção; o detectado ganha a marca "não".
    const valor = recorrente ? true : l.marcaDeRecorrente === true ? null : false
    await enviarJson('PUT', '/recorrentes', { estabelecimento: l.estabelecimento, recorrente: valor })
    anuncio.value = recorrente ? 'Marcado como recorrente.' : 'Não é mais recorrente.'
    aberto.value = ''
    await carregar()
  } catch (e) {
    erroDoEditor.value = e instanceof Error ? e.message : String(e)
  } finally {
    salvando.value = false
  }
}

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
    <p class="fin-anuncio" role="status" aria-live="polite">{{ anuncio }}</p>

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
                <template v-if="l.parcela"> · parcela {{ l.parcela }}</template>
                <template v-if="l.natureza !== 'despesa' && l.natureza !== 'receita' && ROTULO_DA_NATUREZA[l.natureza] !== l.categoria"> · {{ ROTULO_DA_NATUREZA[l.natureza] }}</template>
                <template v-if="l.dataCompra !== l.data"> · compra em {{ diaMes(l.dataCompra) }}</template>
                <template v-if="l.recorrente"> · recorrente</template>
                <template v-if="l.pendente"> · <span class="fin-pilula is-atualizando">pendente</span></template>
              </small>
            </span>
            <span class="fin-valor" :class="{ 'is-positivo': l.centavos > 0, 'is-neutro': l.natureza === 'transferencia' || l.natureza === 'pagamento_fatura' }">{{ brl(l.centavos) }}</span>
          </button>
          <form v-if="aberto === l.id" :id="`editor-${l.id}`" class="fin-editor" @submit.prevent="salvarCategoria(l)">
            <label>Categoria
              <select v-model="novaCategoria" :disabled="salvando">
                <option v-for="c in opcoesDe(l)" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label v-if="l.estabelecimento" class="fin-marca">
              <input v-model="aplicarSempre" type="checkbox" :disabled="salvando" />
              Aplicar sempre a este estabelecimento
            </label>
            <small v-if="l.estabelecimento" class="fin-sub">{{ l.estabelecimento }}<template v-if="l.temRegra"> · já tem uma regra, que será trocada</template></small>
            <p v-if="erroDoEditor" class="fin-aviso is-forte" role="alert">{{ erroDoEditor }}</p>
            <div class="fin-acoes">
              <button type="submit" class="fin-botao fin-botao--primario" :disabled="salvando || (novaCategoria === l.categoria && !aplicarSempre)">Salvar</button>
              <button v-if="l.natureza === 'despesa' && l.estabelecimento" type="button" class="fin-botao" :disabled="salvando" @click="marcarRecorrente(l, !l.recorrente)">
                {{ l.recorrente ? 'Não é recorrente' : 'Marcar como recorrente' }}
              </button>
              <button type="button" class="fin-botao" @click="aberto = ''">Fechar</button>
            </div>
          </form>
        </li>
      </ul>
    </div>

    <button v-if="lista && itens.length < lista.total" type="button" class="fin-botao fin-mais" :disabled="carregando" @click="carregar(true)">
      Mostrar mais ({{ lista.total - itens.length }})
    </button>
  </section>
</template>
