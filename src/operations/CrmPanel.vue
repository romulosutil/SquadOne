<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Sheet from '../components/Sheet.vue'
import CrmColinha from './CrmColinha.vue'
import CrmFicha from './CrmFicha.vue'
import CrmFilaDeEnvio from './CrmFilaDeEnvio.vue'
import CrmFunil from './CrmFunil.vue'
import CrmHoje from './CrmHoje.vue'
import CrmResultados from './CrmResultados.vue'
import { ETAPAS, ROTULO_DA_ETAPA, ROTULO_DO_PRODUTO, dataHora, hora } from './crm-formato'
import { gravarEnvios, lerEnvios, marcarEnvio, podarEnvios, type EnviosAbertos } from './fila-de-envio'
import { avisoDeHorario } from './resultados'
import type { CrmEtapa, CrmGrupoHoje, CrmLead, CrmProduto, CrmVisao } from './types'
import './crm.css'

// CRM da Central (/crm): Site antes da venda + PRUMO num modelo só, com as
// vistas Hoje (padrão), Funil e Resultados (08/10/2026) e a Ficha de um lead.
// Tudo vem do retrato que o n8n grava das planilhas (server/crm.ts); a
// Central não guarda etapa. A Colinha (?ver=colinha) é a exceção: texto
// estático (colinha.ts), que aparece mesmo com o CRM fora do ar.
type Vista = 'hoje' | 'funil' | 'resultados' | 'colinha'
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
const filaAberta = ref(false)
const envios = ref<EnviosAbertos>({})
const anuncio = ref('')
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
  const ver = q.get('ver')
  vista.value = ver === 'funil' || ver === 'resultados' || ver === 'colinha' ? ver : 'hoje'
  const p = q.get('produto')
  produto.value = p === 'site' || p === 'prumo' ? p : 'todos'
  leadId.value = q.get('lead')
  filaAberta.value = vista.value === 'hoje' && q.get('fila') === 'envio'
}

function escreverEndereco(substituir = false) {
  const q = new URLSearchParams()
  if (vista.value !== 'hoje') q.set('ver', vista.value)
  if (produto.value !== 'todos') q.set('produto', produto.value)
  if (filaAberta.value) q.set('fila', 'envio')
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
    // Só um retrato legível diz quem ainda está pronto; sem ele, as marcas ficam.
    if (corpo.estado === 'ok') {
      const prontos = new Set<string>((corpo.leads ?? []).filter((l: CrmLead) => l.sinal === 'pronto').map((l: CrmLead) => l.id))
      guardarEnvios(podarEnvios(envios.value, prontos, Date.now()))
    }
    if (anunciar) anuncio.value = `CRM atualizado: ${corpo.leads?.length ?? 0} leads.`
  } catch (motivo) {
    erro.value = motivo instanceof Error ? motivo.message : String(motivo)
    if (anunciar) anuncio.value = 'Não foi possível ler o CRM.'
  } finally {
    carregando.value = false
  }
}

const aoMudarVisibilidade = () => { if (document.visibilityState === 'visible') carregar() }

// ------------------------------------------------------------------ envios abertos nesta tela (fila-de-envio.ts)

function armazenamento(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function guardarEnvios(novos: EnviosAbertos) {
  envios.value = novos
  gravarEnvios(armazenamento(), novos)
}

function marcarAberto(id: string) {
  guardarEnvios(marcarEnvio(envios.value, id, Date.now()))
  anuncio.value = `${porId.value.get(id)?.empresa ?? 'Lead'}: aberto no WhatsApp.`
}

// O n8n refaz o retrato logo depois de gravar o registro (uns 5 s).
function depoisDoRegistro() {
  atrasos.push(window.setTimeout(() => carregar(), 5000), window.setTimeout(() => carregar(), 15000))
}

onMounted(async () => {
  envios.value = lerEnvios(armazenamento(), Date.now())
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
const prontosParaEnviar = computed(() => hoje.value.find(g => g.id === 'enviar')?.itens ?? [])
// Os números do aviso saem dos envios do Site (a fila só envia Site), não do filtro de produto da tela.
const avisoDaFila = computed(() => avisoDeHorario((visao.value?.leads ?? []).filter(l => l.produto === 'site'), agora.value))
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
  filaAberta.value = false
  escreverEndereco()
}

// "Enviar um por um" abre numa folha, como a ficha; ?fila=envio faz o "voltar"
// do celular fechar a folha, e a ficha aberta de dentro dela empilha por cima.
function abrirFila() {
  filaAberta.value = true
  escreverEndereco()
}

function fecharFila() {
  filaAberta.value = false
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

// A ficha abre numa folha cheia por cima da lista (07/10/2026): a lista fica
// onde estava, e fechar devolve o foco ao botão que abriu (o Sheet faz isso).
// O endereço ganha ?lead=, então o "voltar" do celular fecha a folha.
function abrirFicha(id: string) {
  leadId.value = id
  escreverEndereco()
}

function fecharFicha() {
  leadId.value = null
  escreverEndereco()
}

// "Ver a colinha inteira", da ficha: a folha fecha e quem a abriu (um item da
// lista) sai da tela junto com a vista, então o foco vai para o título da colinha.
async function abrirColinha() {
  trocarVista('colinha')
  await nextTick()
  document.getElementById('crm-colinha-titulo')?.focus()
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
      <button class="botao" type="button" :disabled="carregando" @click="carregar(true)">{{ carregando ? 'Lendo…' : 'Ler de novo' }}</button>
    </header>
    <p class="so-leitor" aria-live="polite">{{ anuncio }}</p>

    <div v-if="erro" class="crm-erro" role="alert"><strong>CRM indisponível.</strong> {{ erro }} <button class="botao" type="button" @click="carregar(true)">Tentar de novo</button></div>

    <!-- Os avisos do retrato falam dos números; a colinha não tem nenhum. -->
    <template v-if="visao && vista !== 'colinha'">
      <div v-if="visao.estado !== 'ok'" class="crm-aviso is-forte" role="status">
        <strong>{{ visao.estado === 'sem-retrato' ? 'Ainda sem retrato das planilhas.' : 'Retrato ilegível.' }}</strong> {{ visao.mensagem }}
        <template v-if="visao.ultimaFalha"> Última tentativa do n8n ({{ dataHora(visao.ultimaFalha.em) }}): {{ visao.ultimaFalha.erro }}</template>
      </div>
      <div v-else-if="velho || visao.ultimaFalha" class="crm-aviso" role="status">
        <strong>Retrato desatualizado.</strong> Os números são de {{ dataHora(visao.geradoEm) }}.
        <template v-if="visao.ultimaFalha"> O n8n não conseguiu ler as planilhas em {{ dataHora(visao.ultimaFalha.em) }}: {{ visao.ultimaFalha.erro }}</template>
      </div>
      <p v-if="visao.colunasAusentes.length" class="crm-nota-pequena">Colunas que a planilha ainda não tem (o CRM trata como vazias): {{ visao.colunasAusentes.join(', ') }}.</p>
      <p v-if="visao.estado === 'ok' && !visao.pastasLidas" class="crm-nota-pequena">A pasta ~/auto-site não foi lida: sem conferência de pastas agora.</p>
    </template>

    <!-- Fora do v-if do retrato: com o CRM fora do ar, ainda se chega à Colinha. As contagens só com retrato. -->
    <div v-if="visao || vista === 'colinha' || erro" class="crm-controles" :class="{ 'crm-controles--funil': vista === 'funil' }">
      <nav class="crm-vistas" aria-label="Vistas do CRM">
        <a href="/crm" :aria-current="vista === 'hoje' ? 'page' : undefined" @click.prevent="trocarVista('hoje')">Hoje <span v-if="visao">{{ totalHoje }}</span></a>
        <a href="/crm?ver=funil" :aria-current="vista === 'funil' ? 'page' : undefined" @click.prevent="trocarVista('funil')">Funil <span v-if="visao">{{ leads.length }}</span></a>
        <a href="/crm?ver=resultados" :aria-current="vista === 'resultados' ? 'page' : undefined" @click.prevent="trocarVista('resultados')">Resultados</a>
        <a href="/crm?ver=colinha" :aria-current="vista === 'colinha' ? 'page' : undefined" @click.prevent="trocarVista('colinha')">Colinha</a>
      </nav>
      <div class="crm-produtos" role="group" aria-label="Produto">
        <button v-for="p in PRODUTOS" :key="p.id" type="button" :aria-pressed="produto === p.id" @click="trocarProduto(p.id)">{{ p.rotulo }}</button>
      </div>
    </div>

    <CrmColinha v-if="vista === 'colinha'" :produto="produto" />

    <template v-if="visao">
      <!-- No Funil cada coluna (ou aba, no celular) já traz o número: o resumo só repetiria. -->
      <ol v-if="visao.estado === 'ok' && vista !== 'funil' && vista !== 'colinha'" class="crm-resumo" aria-label="Resumo do funil (toque para abrir a etapa)">
        <li v-for="etapa in ETAPAS" :key="etapa" :class="`is-${etapa}`">
          <button type="button" @click="irParaEtapa(etapa)">
            <strong>{{ contagens[etapa] }}</strong>
            <span>{{ ROTULO_DA_ETAPA[etapa] }}</span>
          </button>
        </li>
      </ol>
      <p v-if="visao.estado === 'ok' && visao.divergencias && vista !== 'colinha'" class="crm-nota-pequena">
        {{ visao.divergencias }} lead{{ visao.divergencias === 1 ? '' : 's' }} com divergência entre planilha e pasta (marcados no Funil).
        <template v-if="visao.pastasSemLinha.length"> {{ visao.pastasSemLinha.length }} pasta(s) sem linha na planilha.</template>
      </p>

      <CrmHoje v-if="vista === 'hoje'" :grupos="hoje" :leads="porId" :envios="envios" :agora="agora" @abrir="abrirFicha" @enviado="marcarAberto" @fila="abrirFila" />
      <CrmResultados v-else-if="vista === 'resultados'" :leads="leads" :agora="agora" />
      <CrmFunil v-else-if="vista === 'funil'" :leads="leads" :visao="visao" :etapa-em-foco="etapaEmFoco" :produto="produto" @abrir="abrirFicha" @produto="trocarProduto" />

      <Sheet v-if="filaAberta" cheia titulo="Enviar um por um" subtitulo="Sites prontos para enviar" @fechar="fecharFila">
        <div class="crm-na-folha">
          <CrmFilaDeEnvio :itens="prontosParaEnviar" :leads="porId" :envios="envios" :aviso="avisoDaFila" @enviado="marcarAberto" @abrir="abrirFicha" />
        </div>
      </Sheet>

      <Sheet v-if="leadId" cheia titulo="Ficha do lead" :subtitulo="lead ? ROTULO_DO_PRODUTO[lead.produto] : ''" @fechar="fecharFicha">
        <div class="crm-na-folha">
          <CrmFicha v-if="lead" :key="lead.id" :lead="lead" :visao="visao" @registrado="depoisDoRegistro" @colinha="abrirColinha" />
          <p v-else class="crm-aviso" role="status">Este lead não está no retrato atual: pode ter saído da planilha ou mudado de id.</p>
        </div>
      </Sheet>

      <footer v-if="visao.estado === 'ok' && vista !== 'colinha'" class="crm-rodape">
        <span v-for="f in visao.fontes" :key="f.id">{{ f.nome }}: {{ f.linhas }} linha{{ f.linhas === 1 ? '' : 's' }}<template v-if="f.erro"> ({{ f.erro }})</template></span>
        <a v-if="visao.links.planilhaSite" :href="visao.links.planilhaSite" target="_blank" rel="noopener">Planilha do Site ↗</a>
        <a v-if="visao.links.planilhaPrumo" :href="visao.links.planilhaPrumo" target="_blank" rel="noopener">Planilha do PRUMO ↗</a>
      </footer>
    </template>
    <p v-else-if="carregando && vista !== 'colinha'" class="crm-muted" role="status">Lendo o CRM…</p>
  </section>
</template>
