<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import CrmFicha from './CrmFicha.vue'
import CrmFunil from './CrmFunil.vue'
import CrmHoje from './CrmHoje.vue'
import { ETAPAS, ROTULO_DA_ETAPA, dataHora, hora } from './crm-formato'
import type { CrmEtapa, CrmGrupoHoje, CrmLead, CrmProduto, CrmVisao } from './types'

// CRM da Central (/crm): Site antes da venda + PRUMO num modelo só, com três
// vistas — Hoje (padrão), Funil e a Ficha de um lead. Tudo vem do retrato que
// o n8n grava das planilhas (server/crm.ts); a Central não guarda etapa.
type Vista = 'hoje' | 'funil'
type FiltroProduto = 'todos' | CrmProduto

const visao = ref<CrmVisao | null>(null)
const carregando = ref(true)
const erro = ref('')
const lidoEm = ref<Date | null>(null)
const agora = ref(Date.now())
const vista = ref<Vista>('hoje')
const produto = ref<FiltroProduto>('todos')
const leadId = ref<string | null>(null)
const etapaEmFoco = ref<CrmEtapa | null>(null)
const anuncio = ref('')
let origemDaFicha: string | null = null
let temporizador = 0
let relogio = 0
const atrasos: number[] = []

const PRODUTOS: Array<{ id: FiltroProduto; rotulo: string }> = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'site', rotulo: 'Site antes da venda' },
  { id: 'prumo', rotulo: 'PRUMO' },
]

// ------------------------------------------------------------------ endereço (?ver=&produto=&lead=)

function lerEndereco() {
  const q = new URLSearchParams(window.location.search)
  vista.value = q.get('ver') === 'funil' ? 'funil' : 'hoje'
  const p = q.get('produto')
  produto.value = p === 'site' || p === 'prumo' ? p : 'todos'
  leadId.value = q.get('lead')
}

function escreverEndereco(substituir = false) {
  const q = new URLSearchParams()
  if (vista.value !== 'hoje') q.set('ver', vista.value)
  if (produto.value !== 'todos') q.set('produto', produto.value)
  if (leadId.value) q.set('lead', leadId.value)
  const busca = q.toString()
  const url = `/crm${busca ? `?${busca}` : ''}`
  if (url === `${window.location.pathname}${window.location.search}`) return
  if (substituir) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
}

const aoVoltarNoNavegador = () => lerEndereco()

// ------------------------------------------------------------------ leitura

async function carregar(anunciar = false) {
  carregando.value = true
  erro.value = ''
  try {
    // no-cache: revalida com o ETag; sem mudança no retrato o servidor responde 304.
    const resposta = await fetch('/api/operations/crm', { cache: 'no-cache' })
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    visao.value = corpo
    lidoEm.value = new Date()
    if (anunciar) anuncio.value = `CRM atualizado: ${corpo.leads?.length ?? 0} leads.`
  } catch (motivo) {
    erro.value = motivo instanceof Error ? motivo.message : String(motivo)
    if (anunciar) anuncio.value = 'Não foi possível ler o CRM.'
  } finally {
    carregando.value = false
  }
}

const aoMudarVisibilidade = () => { if (document.visibilityState === 'visible') carregar() }

// O n8n refaz o retrato logo depois de gravar o registro (uns 5 s).
function depoisDoRegistro() {
  atrasos.push(window.setTimeout(() => carregar(), 5000), window.setTimeout(() => carregar(), 15000))
}

onMounted(async () => {
  lerEndereco()
  escreverEndereco(true)
  window.addEventListener('popstate', aoVoltarNoNavegador)
  document.addEventListener('visibilitychange', aoMudarVisibilidade)
  await carregar()
  temporizador = window.setInterval(() => { if (document.visibilityState === 'visible') carregar() }, 120_000)
  relogio = window.setInterval(() => { agora.value = Date.now() }, 30_000)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', aoVoltarNoNavegador)
  document.removeEventListener('visibilitychange', aoMudarVisibilidade)
  window.clearInterval(temporizador)
  window.clearInterval(relogio)
  atrasos.forEach(id => window.clearTimeout(id))
})

// ------------------------------------------------------------------ derivados

const leads = computed(() => (visao.value?.leads ?? []).filter(l => produto.value === 'todos' || l.produto === produto.value))
const porId = computed(() => new Map((visao.value?.leads ?? []).map(l => [l.id, l] as [string, CrmLead])))
const hoje = computed<CrmGrupoHoje[]>(() => (visao.value?.hoje ?? []).map(g => ({
  ...g,
  itens: g.itens.filter(i => produto.value === 'todos' || porId.value.get(i.leadId)?.produto === produto.value),
})))
const totalHoje = computed(() => hoje.value.reduce((soma, g) => soma + g.itens.length, 0))
const contagens = computed(() => Object.fromEntries(ETAPAS.map(e => [e, leads.value.filter(l => l.etapa === e).length])) as Record<CrmEtapa, number>)
const lead = computed(() => (leadId.value ? porId.value.get(leadId.value) ?? null : null))

const idadeMin = computed(() => visao.value?.geradoEm ? Math.max(0, Math.round((agora.value - Date.parse(visao.value.geradoEm)) / 60_000)) : null)
const velho = computed(() => idadeMin.value === null || idadeMin.value > (visao.value?.minutosAteVelho ?? 30))
const textoDoRetrato = computed(() => {
  if (!visao.value?.geradoEm) return 'Sem retrato das planilhas ainda.'
  const idade = idadeMin.value ?? 0
  const quando = idade < 1 ? 'agora há pouco' : idade < 60 ? `há ${idade} min` : `há ${Math.floor(idade / 60)} h`
  return `Planilhas lidas às ${hora(visao.value.geradoEm)} (${quando}) · o n8n relê a cada 10 min`
})

// ------------------------------------------------------------------ navegação

function trocarVista(nova: Vista) {
  vista.value = nova
  leadId.value = null
  escreverEndereco()
}

function trocarProduto(novo: FiltroProduto) {
  produto.value = novo
  escreverEndereco(true)
  anuncio.value = `Mostrando ${PRODUTOS.find(p => p.id === novo)?.rotulo}.`
}

async function irParaEtapa(etapa: CrmEtapa) {
  vista.value = 'funil'
  leadId.value = null
  etapaEmFoco.value = etapa
  escreverEndereco()
  await nextTick()
  const coluna = document.getElementById(`crm-coluna-${etapa}`)
  coluna?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'start' })
  coluna?.focus({ preventScroll: true })
}

function abrirFicha(id: string) {
  origemDaFicha = id
  leadId.value = id
  escreverEndereco()
  window.scrollTo({ top: 0 })
}

async function fecharFicha() {
  leadId.value = null
  escreverEndereco()
  await nextTick()
  // Foco volta para o botão que abriu a ficha (RULES 3).
  const origem = origemDaFicha ? document.querySelector<HTMLElement>(`[data-lead="${CSS.escape(origemDaFicha)}"]`) : null
  origem?.focus()
  origem?.scrollIntoView({ block: 'center' })
}
</script>

<template>
  <section class="crm" aria-labelledby="crm-titulo">
    <header class="crm-topo">
      <div>
        <span class="crm-kicker">Site antes da venda + PRUMO</span>
        <h1 id="crm-titulo">CRM</h1>
        <p class="crm-topo__fonte">{{ textoDoRetrato }}<template v-if="lidoEm"> · tela lida às {{ hora(lidoEm.toISOString()) }}</template></p>
      </div>
      <button class="ops-button ops-button--outline" type="button" :disabled="carregando" @click="carregar(true)">{{ carregando ? 'Lendo…' : 'Ler de novo' }}</button>
    </header>
    <p class="ops-visually-hidden" aria-live="polite">{{ anuncio }}</p>

    <div v-if="erro" class="crm-erro" role="alert"><strong>CRM indisponível.</strong> {{ erro }} <button class="ops-button" type="button" @click="carregar(true)">Tentar de novo</button></div>

    <template v-if="visao">
      <div v-if="visao.estado !== 'ok'" class="crm-aviso is-forte" role="status">
        <strong>{{ visao.estado === 'sem-retrato' ? 'Ainda sem retrato das planilhas.' : 'Retrato ilegível.' }}</strong> {{ visao.mensagem }}
        <template v-if="visao.ultimaFalha"> Última tentativa do n8n ({{ dataHora(visao.ultimaFalha.em) }}): {{ visao.ultimaFalha.erro }}</template>
      </div>
      <div v-else-if="velho || visao.ultimaFalha" class="crm-aviso" role="status">
        <strong>Retrato desatualizado.</strong> Os números são de {{ dataHora(visao.geradoEm) }}.
        <template v-if="visao.ultimaFalha"> O n8n não conseguiu ler as planilhas em {{ dataHora(visao.ultimaFalha.em) }}: {{ visao.ultimaFalha.erro }}</template>
      </div>
      <p v-if="visao.colunasAusentes.length && !lead" class="crm-nota-pequena">Colunas que a planilha ainda não tem (o CRM trata como vazias): {{ visao.colunasAusentes.join(', ') }}.</p>
      <p v-if="visao.estado === 'ok' && !visao.pastasLidas" class="crm-nota-pequena">A pasta ~/auto-site não foi lida: sem conferência de pastas agora.</p>

      <div v-if="!lead" class="crm-controles">
        <nav class="crm-vistas" aria-label="Vistas do CRM">
          <a href="/crm" :aria-current="vista === 'hoje' ? 'page' : undefined" @click.prevent="trocarVista('hoje')">Hoje <span>{{ totalHoje }}</span></a>
          <a href="/crm?ver=funil" :aria-current="vista === 'funil' ? 'page' : undefined" @click.prevent="trocarVista('funil')">Funil <span>{{ leads.length }}</span></a>
        </nav>
        <div class="crm-produtos" role="group" aria-label="Produto">
          <button v-for="p in PRODUTOS" :key="p.id" type="button" :aria-pressed="produto === p.id" @click="trocarProduto(p.id)">{{ p.rotulo }}</button>
        </div>
      </div>

      <ol v-if="!lead && visao.estado === 'ok'" class="crm-resumo" aria-label="Resumo do funil (toque para abrir a etapa)">
        <li v-for="etapa in ETAPAS" :key="etapa" :class="`is-${etapa}`">
          <button type="button" @click="irParaEtapa(etapa)">
            <strong>{{ contagens[etapa] }}</strong>
            <span>{{ ROTULO_DA_ETAPA[etapa] }}</span>
          </button>
        </li>
      </ol>
      <p v-if="!lead && visao.estado === 'ok' && visao.divergencias" class="crm-nota-pequena">
        {{ visao.divergencias }} lead{{ visao.divergencias === 1 ? '' : 's' }} com divergência entre planilha e pasta (marcados no Funil).
        <template v-if="visao.pastasSemLinha.length"> {{ visao.pastasSemLinha.length }} pasta(s) sem linha na planilha.</template>
      </p>

      <CrmFicha v-if="lead" :key="lead.id" :lead="lead" :visao="visao" @voltar="fecharFicha" @registrado="depoisDoRegistro" />
      <div v-else-if="leadId" class="crm-aviso" role="status">
        Este lead não está no retrato atual. <button class="ops-button" type="button" @click="fecharFicha">Voltar</button>
      </div>
      <CrmHoje v-else-if="vista === 'hoje'" :grupos="hoje" :leads="porId" @abrir="abrirFicha" />
      <CrmFunil v-else :leads="leads" :visao="visao" :etapa-em-foco="etapaEmFoco" @abrir="abrirFicha" />

      <footer v-if="visao.estado === 'ok' && !lead" class="crm-rodape">
        <span v-for="f in visao.fontes" :key="f.id">{{ f.nome }}: {{ f.linhas }} linha{{ f.linhas === 1 ? '' : 's' }}<template v-if="f.erro"> ({{ f.erro }})</template></span>
        <a v-if="visao.links.planilhaSite" :href="visao.links.planilhaSite" target="_blank" rel="noopener">Planilha do Site ↗</a>
        <a v-if="visao.links.planilhaPrumo" :href="visao.links.planilhaPrumo" target="_blank" rel="noopener">Planilha do PRUMO ↗</a>
      </footer>
    </template>
    <p v-else-if="carregando" class="crm-muted" role="status">Lendo o CRM…</p>
  </section>
</template>
