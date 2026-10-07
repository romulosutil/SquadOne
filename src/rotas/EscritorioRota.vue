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
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref } from 'vue'
import Sheet from '../components/Sheet.vue'
import SalaCartao from '../components/SalaCartao.vue'
import SalasPainel from '../components/SalasPainel.vue'
import SquadSelector from '../components/SquadSelector.vue'
import { useAgentes } from '../agentes/estado'
import { estadoDaPessoa } from '../casca/hoje'
import { gravarVista, lerVistaGuardada, vistaInicial, type VistaDoEscritorio } from '../office/vista'

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

      <SalasPainel
        v-if="vista === 'lista'"
        :squad="squadAtiva"
        :total-arquivado="totalArquivado"
        :desabilitado="ocupadoComRoster"
        :estados="estados"
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
      />
    </Sheet>
  </div>
</template>

<style>
.escritorio { display: grid; gap: var(--esp-4); width: 100%; max-width: 72rem; margin: 0 auto; color: var(--texto); }
.escritorio__topo { display: grid; gap: var(--esp-1); }
.escritorio h1 { margin: 0; font-size: clamp(1.8rem, 8vw, 2.6rem); font-weight: 950; letter-spacing: -0.03em; }
.escritorio p { margin: 0; }
.escritorio__barra { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-3); }
.escritorio__status { font-weight: 900; }
</style>
