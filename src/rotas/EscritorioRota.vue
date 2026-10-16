<script setup lang="ts">
/**
 * Escritório (/squadone): as salas da squad ativa — um andar por vez —, em
 * Lista (padrão no celular, texto, acessível) ou Mapa (pixel art isométrica).
 *
 * O Mapa só carrega quando aberto: o GameMap, o useOffice e os sprites vêm
 * num pedaço separado do bundle (import dinâmico), e nada disso roda na Lista.
 * A escolha Lista|Mapa fica no localStorage (src/office/vista.ts, com try/catch).
 *
 * Tocar num personagem do Mapa abre a sala dele numa folha, com os mesmos
 * gestos da Lista.
 */
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Sheet from '../components/Sheet.vue'
import SalaCartao from '../components/SalaCartao.vue'
import SalasPainel from '../components/SalasPainel.vue'
import SalaOperacao from '../components/SalaOperacao.vue'
import SquadSelector from '../components/SquadSelector.vue'
import { useAgentes } from '../agentes/estado'
import { estadoDaPessoa } from '../casca/hoje'
import { useOverview } from '../casca/overview'
import { gravarVista, lerVistaGuardada, vistaInicial, type VistaDoEscritorio } from '../office/vista'
import { ehSalaDeFinancas, estadoDoAgente, type EstadoDasFinancas, type EstadoDoAgente } from '../office/salaFinancas'
import { fonteDoCrm, operacaoDaSala, temOperacao, type OperacaoDaSala } from '../office/operacao'
import type { CrmVisao } from '../operations/types'

const GameMap = defineAsyncComponent({
  loader: () => import('../components/GameMap.vue'),
  loadingComponent: { render: () => h('p', { class: 'texto-2', role: 'status' }, 'Carregando o mapa…') },
  errorComponent: { render: () => h('p', { class: 'recado recado--erro', role: 'alert' }, 'O mapa não carregou. A Lista mostra as mesmas salas.') },
  delay: 150
})

const ag = useAgentes()
const { roster, squadAtiva, quests, mochilaDe, currentAgent, isLoading, turnoSquadId, totalArquivado, ocupadoComRoster } = ag

const guardador = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
const telaLarga = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 64rem)').matches
const vista = ref<VistaDoEscritorio>(vistaInicial(lerVistaGuardada(guardador()), telaLarga))
const escolher = (v: VistaDoEscritorio) => {
  vista.value = v
  gravarVista(guardador(), v)
}

// Relógio só para o estado "em bloco agora" virar quando o bloco acaba.
const agora = ref(Date.now())
let relogio = 0
onMounted(() => { relogio = window.setInterval(() => { agora.value = Date.now() }, 60_000) })
onBeforeUnmount(() => window.clearInterval(relogio))

/** Estado de cada pessoa, só com fonte: a agenda lida desta squad ou o último pedido. */
const estados = computed(() => {
  const squad = squadAtiva.value
  if (!squad) return {}
  const ctx = {
    quests: mochilaDe.value === squad.id ? quests.value : [],
    responsavelId: currentAgent.value === 'Idle' ? '' : currentAgent.value,
    agora: agora.value
  }
  return Object.fromEntries(squad.dominios.flatMap((d) => [d.po, ...d.integrantes]).map((p) => [p.id, estadoDaPessoa(p.id, ctx)]))
})

const status = computed(() => {
  const squad = squadAtiva.value
  if (!squad) return ''
  if (isLoading.value && turnoSquadId.value === squad.id) return 'Pedido em andamento nesta squad'
  const id = currentAgent.value
  if (id && id !== 'Idle') {
    const dominio = squad.dominios.find((d) => [d.po, ...d.integrantes].some((p) => p.id === id))
    const pessoa = dominio && [dominio.po, ...dominio.integrantes].find((p) => p.id === id)
    if (pessoa) return `Último pedido: ${pessoa.nome} (${dominio.nome})`
  }
  return 'Aguardando pedidos'
})

// Sala Finanças (07/10/2026): o PO da sala "Finanças" mostra a % do limite do
// cartão e do orçamento do mês — balão no Mapa, linha de texto na Lista. Só o
// Dell tem finanças: no Easypanel a rota cai no fallback da SPA (HTML), e a
// sala fica sem estado. Só % e semáforo (RULES 24); nada entra no roster nem no prompt.
const estadoDasFinancas = ref<EstadoDasFinancas | null>(null)
const salasDeFinancas = computed(() => (squadAtiva.value?.dominios ?? []).filter(ehSalaDeFinancas))
const estadoDaSalaFinancas = computed(() => estadoDoAgente(estadoDasFinancas.value))
const estadosDasSalas = computed<Record<string, EstadoDoAgente>>(() => {
  const estado = estadoDaSalaFinancas.value
  return estado ? Object.fromEntries(salasDeFinancas.value.map((d) => [d.id, estado])) : {}
})
async function lerEstadoDasFinancas() {
  if (!salasDeFinancas.value.length) return
  try {
    const resposta = await fetch('/api/financas/estado')
    const json = (resposta.headers.get('content-type') ?? '').includes('application/json')
    estadoDasFinancas.value = resposta.ok && json ? await resposta.json() : null
  } catch {
    estadoDasFinancas.value = null
  }
}
watch(
  () => salasDeFinancas.value.length > 0,
  (tem) => {
    if (tem) void lerEstadoDasFinancas()
  },
  { immediate: true }
)
let relogioDasFinancas = 0
onMounted(() => {
  // A leitura diária da Pluggy e um gasto anotado pelo Telegram mudam a %: relê com a aba visível.
  relogioDasFinancas = window.setInterval(() => {
    if (document.visibilityState === 'visible') void lerEstadoDasFinancas()
  }, 5 * 60_000)
})
onBeforeUnmount(() => window.clearInterval(relogioDasFinancas))

// Mapa da operação (15/10/2026): as salas do PRUMO mostram os leads delas por
// passo da jornada (o retrato do CRM, o mesmo do /crm) e o estado de cada robô
// (o status.json do Dell, o mesmo retrato que a casca já lê para a Hoje e Mais).
// Só leitura; sem a fonte, a sala diz "Sem sinal" (office/operacao.ts). O CRM só
// é lido quando a squad tem sala com operação: as outras não pagam os 5 MB.
const { overview } = useOverview()
const visaoDoCrm = ref<CrmVisao | null>(null)
const erroDoCrm = ref('')
const temSalaDeOperacao = computed(() => temOperacao((squadAtiva.value?.dominios ?? []).map((d) => d.id)))
async function lerCrm() {
  try {
    // no-cache: revalida com o ETag; sem mudança no retrato o servidor responde 304.
    const resposta = await fetch('/api/operations/crm', { cache: 'no-cache' })
    const json = (resposta.headers.get('content-type') ?? '').includes('application/json')
    if (!resposta.ok || !json) throw new Error(`HTTP ${resposta.status}`)
    visaoDoCrm.value = await resposta.json()
    erroDoCrm.value = ''
  } catch (e) {
    // O último retrato bom continua valendo (fica "velho" sozinho); sem nenhum, "Sem sinal".
    erroDoCrm.value = e instanceof Error ? e.message : String(e)
  }
}
watch(temSalaDeOperacao, (tem) => { if (tem) void lerCrm() }, { immediate: true })
let relogioDoCrm = 0
onMounted(() => {
  // O n8n regrava o retrato a cada 10 min.
  relogioDoCrm = window.setInterval(() => {
    if (temSalaDeOperacao.value && document.visibilityState === 'visible') void lerCrm()
  }, 5 * 60_000)
})
onBeforeUnmount(() => window.clearInterval(relogioDoCrm))
const operacoes = computed<Record<string, OperacaoDaSala>>(() => {
  if (!temSalaDeOperacao.value) return {}
  const fontes = { crm: fonteDoCrm(visaoDoCrm.value, erroDoCrm.value, agora.value), dell: overview.value?.dell ?? null, agora: agora.value }
  const pares = (squadAtiva.value?.dominios ?? []).map((d) => [d.id, operacaoDaSala(d.id, fontes)] as const)
  return Object.fromEntries(pares.filter((p): p is readonly [string, OperacaoDaSala] => p[1] !== null))
})

const salaAberta = ref<string | null>(null)
const dominioAberto = computed(() => squadAtiva.value?.dominios.find((d) => d.id === salaAberta.value) ?? null)
</script>

<template>
  <div class="escritorio">
    <header class="escritorio__topo">
      <h1>Escritório</h1>
      <p class="texto-2">Cada squad é um andar; cada sala, um domínio com o PO e quem trabalha nele.</p>
    </header>

    <p v-if="!roster" class="texto-2" role="status">{{ ag.erroRoster.value ? `Sem roster: ${ag.erroRoster.value}` : 'Lendo as squads…' }}</p>
    <template v-else-if="squadAtiva">
      <SquadSelector
        rotulo="Andar (squad)"
        :squads="roster.squads"
        :ativa-id="squadAtiva.id"
        :desabilitado="ocupadoComRoster"
        :pode-arquivar="roster.squads.length > 1"
        @trocar="ag.trocarSquad"
        @nova="ag.abrirNovaSquad"
        @editar="ag.editarSquadAtiva"
        @arquivar="ag.arquivarSquadAtiva"
      />

      <div class="escritorio__barra">
        <div class="segmentado segmentado--auto" role="group" aria-label="Ver o escritório como">
          <button type="button" :aria-pressed="vista === 'lista'" @click="escolher('lista')">Lista</button>
          <button type="button" :aria-pressed="vista === 'mapa'" @click="escolher('mapa')">Mapa</button>
        </div>
        <!-- No Mapa o estado fica no cabeçalho dele, junto da escala. -->
        <p v-if="vista === 'lista'" class="escritorio__status" role="status">{{ status }}</p>
      </div>
      <!-- salasDeFinancas.length: o estado lido fica da squad anterior ao trocar de andar (Pessoal → PRUMO
           derrubava a tela inteira lendo salasDeFinancas[0].nome). -->
      <p v-if="vista === 'lista' && estadoDaSalaFinancas && salasDeFinancas.length" class="escritorio__financas" :data-semaforo="estadoDaSalaFinancas.semaforo">
        <b>Sala {{ salasDeFinancas[0].nome }}:</b> {{ estadoDaSalaFinancas.texto }} <a href="/financas">ver Finanças</a>
      </p>

      <SalasPainel
        v-if="vista === 'lista'"
        :squad="squadAtiva"
        :total-arquivado="totalArquivado"
        :desabilitado="ocupadoComRoster"
        :estados="estados"
        :operacoes="operacoes"
        @contratar="ag.contratarNaSala"
        @abrir-sala="ag.abrirSala"
        @substituir-po="ag.substituirPoDaSala"
        @editar-pessoa="ag.editarPessoa"
        @arquivar-pessoa="ag.arquivarPessoa"
        @editar-dominio="ag.editarDominio"
        @arquivar-dominio="ag.arquivarDominio"
        @abrir-arquivo="ag.abrirArquivo"
      />
      <!-- :key por squad: recria useOffice ao trocar, senão as salas da outra
           squad seriam lidas como crescimento e animariam. -->
      <GameMap
        v-else
        :key="squadAtiva.id"
        :agent="currentAgent"
        :squad="squadAtiva"
        :estados="estados"
        :status="status"
        :estados-das-salas="estadosDasSalas"
        @abrir-sala="salaAberta = $event"
      />
    </template>

    <Sheet v-if="dominioAberto && squadAtiva" :titulo="`Sala ${dominioAberto.nome}`" :subtitulo="`Squad ${squadAtiva.nome}`" @fechar="salaAberta = null">
      <SalaCartao
        :dominio="dominioAberto"
        :eh-raiz="dominioAberto.id === squadAtiva.dominios[0]?.id"
        :desabilitado="ocupadoComRoster"
        :estados="estados"
        aberta
        @contratar="ag.contratarNaSala"
        @substituir-po="ag.substituirPoDaSala"
        @editar-pessoa="ag.editarPessoa"
        @arquivar-pessoa="ag.arquivarPessoa"
        @editar-dominio="ag.editarDominio"
        @arquivar-dominio="(id) => { salaAberta = null; ag.arquivarDominio(id) }"
      >
        <template v-if="operacoes[dominioAberto.id]" #rodape>
          <SalaOperacao :operacao="operacoes[dominioAberto.id]" :nome-da-sala="dominioAberto.nome" />
        </template>
      </SalaCartao>
    </Sheet>
  </div>
</template>

<style>
.escritorio { display: grid; gap: var(--esp-4); width: 100%; max-width: 72rem; margin: 0 auto; color: var(--texto); }
.escritorio__topo { display: grid; gap: var(--esp-1); }
.escritorio h1 { margin: 0; font-size: var(--tam-titulo); font-weight: var(--peso-titulo); letter-spacing: -0.03em; }
.escritorio p { margin: 0; }
.escritorio__barra { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-3); }
.escritorio__status { font-weight: var(--peso-forte); }
/* A borda é o semáforo; o texto já diz a %, a cor nunca é a única pista. */
.escritorio__financas { padding: var(--esp-2) var(--esp-3); border: var(--linha-fina); border-left-width: 8px; background: var(--superficie); }
.escritorio__financas[data-semaforo='verde'] { border-left-color: var(--positivo); }
.escritorio__financas[data-semaforo='amarelo'] { border-left-color: var(--destaque); }
.escritorio__financas[data-semaforo='laranja'] { border-left-color: var(--acento); }
.escritorio__financas[data-semaforo='vermelho'] { border-left-color: var(--negativo); background: var(--erro-fundo); }
.escritorio__financas a { color: inherit; font-weight: var(--peso-forte); }
</style>
