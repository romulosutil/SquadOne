<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import GameMap from './components/GameMap.vue'
import CommandBar from './components/CommandBar.vue'
import QuestBackpack from './components/QuestBackpack.vue'
import GrowthCard from './components/GrowthCard.vue'
import SquadSelector from './components/SquadSelector.vue'
import NovaSquadModal from './components/NovaSquadModal.vue'
import TrocaSquadCard from './components/TrocaSquadCard.vue'
import SalasPainel from './components/SalasPainel.vue'
import ContratarModal from './components/ContratarModal.vue'
import { ErroDaApi, rosterApi } from './rosterApi'
import type {
  AlvoDeContratacao,
  DadosDeContratacao,
  DadosNovaSquad,
  Modo,
  PreenchimentoDeContratacao,
  RosterView,
  SquadView,
  Sugestao
} from './types'
import { conectado, conectando, desconectar, irParaConsentimento, lerRetornoDoConsentimento, sincronizarStatus } from './auth/google'
import { gravarSquadAtiva, lerSquadAtiva } from './squadAtiva'

const currentAgent = ref('Idle')
// A Mochila NAO guarda quest local: a verdade e o Google Calendar. Esta ref e
// so o cache da ultima leitura de GET /api/mochila.
const quests = ref([])
const carregandoMochila = ref(false)
const sugestoes = ref<Sugestao[]>([])
// O roster inteiro (todas as squads). Mapa e Mochila mostram só a ativa.
const roster = ref<RosterView | null>(null)
const squadAtivaId = ref<string | null>(lerSquadAtiva())
/** Id guardado que não existe (outro volume, squad de outra instalação): primeira squad. */
const squadAtiva = computed<SquadView | null>(() => {
  const squads = roster.value?.squads ?? []
  return squads.find((s) => s.id === squadAtivaId.value) ?? squads[0] ?? null
})
const nomesDeDominio = computed<Record<string, string>>(() =>
  Object.fromEntries((squadAtiva.value?.dominios ?? []).map((d) => [d.id, d.nome]))
)
const nomeDaSquad = (id: string) => roster.value?.squads.find((s) => s.id === id)?.nome ?? id
const sugestoesDeCrescimento = computed(() => sugestoes.value.filter((s) => s.kind !== 'troca_squad'))
const sugestoesDeTroca = computed(() =>
  sugestoes.value.filter((s): s is Extract<Sugestao, { kind: 'troca_squad' }> => s.kind === 'troca_squad')
)
const criandoSquad = ref(false)
const enviandoSquad = ref(false)
const erroNovaSquad = ref('')
const isLoading = ref(false)
// Contratacao em curso: id da sugestao sendo aprovada (so uma por vez, o
// servidor serializa as escritas no roster de qualquer forma). Id, nao indice:
// um turno novo ou um descarte durante o POST desloca os indices.
const aprovando = ref('')
const erroSugestao = ref<Record<string, string>>({})
const toast = ref('')
let toastTimer = 0

// O roster manda: papeis, slots desbloqueados e roteamento saem daqui.
onMounted(async () => {
  try {
    await carregarRoster()
  } catch (error) {
    console.error('Falha ao carregar o roster:', error)
  }

  // Volta do consentimento: o callback redireciona para /?auth=ok ou
  // /?auth=<motivo>. Avisar aqui e o unico feedback que o usuario tem de que
  // a autorizacao deu certo, porque o resto do fluxo acontece no servidor.
  const retorno = lerRetornoDoConsentimento()
  if (retorno && retorno !== 'ok') avisar(`Google: ${retorno}`)
  else if (retorno === 'ok') avisar('Calendário conectado')

  // A credencial mora no servidor: basta perguntar. Sem popup, sem gesto — se
  // ja houve consentimento antes, continua valendo depois de reload e deploy.
  if (await sincronizarStatus()) await carregarMochila()
})

const carregarRoster = async () => {
  const response = await fetch('/api/squad')
  if (!response.ok) throw new Error('Falha ao carregar o roster')
  roster.value = await response.json()
  // Corrige o guardado quando ele apontava para uma squad que não existe.
  const ativa = squadAtiva.value
  if (ativa && ativa.id !== squadAtivaId.value) {
    squadAtivaId.value = ativa.id
    gravarSquadAtiva(ativa.id)
  }
}

/**
 * Devolve se a squad ativa é `id` ao final. Com turno em curso não troca — o
 * mesmo guarda do seletor: a resposta do turno e o recarregar da Mochila são
 * da squad em que ele começou, e trocar no meio misturaria as duas.
 */
const trocarSquad = async (id: string): Promise<boolean> => {
  if (id === squadAtiva.value?.id) return true
  if (isLoading.value) return false
  // Squad criada em outra aba: o roster local ainda não a conhece.
  if (!roster.value?.squads.some((s) => s.id === id)) await carregarRoster()
  squadAtivaId.value = id
  gravarSquadAtiva(id)
  quests.value = []
  currentAgent.value = 'Idle'
  await carregarMochila()
  return true
}

const abrirNovaSquad = () => {
  erroNovaSquad.value = ''
  criandoSquad.value = true
}

const criarSquad = async (dados: DadosNovaSquad) => {
  enviandoSquad.value = true
  erroNovaSquad.value = ''
  try {
    const response = await fetch('/api/squad/nova', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    })
    const corpo = await response.json().catch(() => ({}))
    // Erro fica DENTRO do modal: o usuário corrige o nome sem redigitar o resto.
    if (!response.ok) throw new Error(corpo.error ?? `HTTP ${response.status}`)
    roster.value = corpo.roster
    criandoSquad.value = false
    // A squad já existe no servidor; só a troca espera o turno acabar.
    const trocou = await trocarSquad(corpo.squad.id)
    avisar(
      trocou
        ? `Squad ${corpo.squad.nome} criada`
        : `Squad ${corpo.squad.nome} criada — troque no seletor quando o turno acabar`
    )
  } catch (error) {
    erroNovaSquad.value = error instanceof Error ? error.message : String(error)
  } finally {
    enviandoSquad.value = false
  }
}

/** Aceite do card de troca. Reenviar usa `auto`: o modo forçado era da squad anterior. */
const aceitarTroca = async (id: string, reenviar: boolean) => {
  const proposta = sugestoesDeTroca.value.find((s) => s.id === id)
  if (!proposta) return
  // Sem troca não há reenvio: reenviar na squad de origem agendaria justamente
  // onde o modelo disse que a demanda não pertence. O card fica para depois.
  if (!(await trocarSquad(proposta.destino_id))) return
  sugestoes.value = sugestoes.value.filter((s) => s.id !== id)
  if (reenviar) await handleDelegation({ demanda: proposta.demanda, modo: 'auto' })
}

/** 409 squadInexistente: a squad desta aba sumiu do servidor. */
const recuperarSquadInexistente = async () => {
  squadAtivaId.value = null
  await carregarRoster()
  avisar('A squad selecionada não existe mais: voltei para a primeira.')
}

const carregarMochila = async (recuperando = false) => {
  if (!conectado.value || !squadAtiva.value) return
  const squadId = squadAtiva.value.id
  carregandoMochila.value = true
  try {
    const response = await fetch(`/api/mochila?squadId=${encodeURIComponent(squadId)}`)
    const corpo = await response.json().catch(() => ({}))
    // Trocou de squad enquanto esperava: esta resposta é da squad anterior, e
    // gravá-la mostraria as quests de uma squad no mapa de outra.
    if (squadAtiva.value?.id !== squadId) return
    if (!response.ok) {
      if (response.status === 409 && corpo.squadInexistente && !recuperando) {
        await recuperarSquadInexistente()
        return await carregarMochila(true)
      }
      // 401 = o servidor nao tem credencial valida (nunca conectou, ou o
      // Google recusou o refresh). Derruba o estado pra UI voltar a oferecer
      // o botao de conectar.
      if (response.status === 401) conectado.value = false
      throw new Error(corpo.error ?? `HTTP ${response.status}`)
    }
    quests.value = corpo.quests ?? []
    if (corpo.erros?.length) console.warn('Dominios com erro na Mochila:', corpo.erros)
  } catch (error) {
    // So no console, a Mochila vazia fica indistinguivel de "nao ha quests":
    // o motivo tem que chegar na tela de quem pode agir sobre ele.
    console.error('Falha ao ler a Mochila:', error)
    avisar(`Mochila: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    carregandoMochila.value = false
  }
}

const avisar = (texto) => {
  toast.value = texto
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = '' }, 4000)
}

/**
 * [APROVAR] do card (§4.4). E aqui que a proposta do modelo vira roster: o
 * POST devolve o squad ja atualizado, e trocar `squad.value` e o unico gatilho
 * de que o escritorio precisa — o GameMap ve um dominio (ou uma pessoa) a mais
 * e roda a sequencia de crescimento sozinho.
 */
const aprovarSugestao = async (id, nome) => {
  if (aprovando.value) return
  const sugestao = sugestoes.value.find((s) => s.id === id)
  if (!sugestao) return
  aprovando.value = id
  erroSugestao.value = { ...erroSugestao.value, [id]: '' }
  // Um turno novo pode substituir a lista enquanto o POST corre. Aí o card
  // deste id nao existe mais, e mexer no estado dos cards (remover, gravar
  // erro, liberar `aprovando`) atropelaria os cards do turno novo.
  const aindaNaLista = () => sugestoes.value.some((s) => s.id === id)
  try {
    const response = await fetch('/api/squad/hire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sugestao, nome })
    })
    const dados = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(dados.error ?? `HTTP ${response.status}`)

    // O roster mudou de qualquer jeito: roster e aviso valem mesmo sem o card.
    roster.value = dados.roster
    if (aindaNaLista()) {
      sugestoes.value = sugestoes.value.filter((s) => s.id !== id)
      const { [id]: _, ...outrosErros } = erroSugestao.value
      erroSugestao.value = outrosErros
    }
    // A contratação cai na squad da proposta, que pode não ser a da tela.
    const onde = dados.squadId !== squadAtiva.value?.id ? ` na squad ${nomeDaSquad(dados.squadId)}` : ''
    avisar(
      dados.kind === 'dominio'
        ? `${dados.pessoa.nome} abriu o dominio ${dados.dominio.nome}${onde}`
        : `${dados.pessoa.nome} entrou no squad (${dados.dominio.nome})${onde}`
    )
  } catch (error) {
    console.error('Falha ao contratar:', error)
    if (aindaNaLista()) erroSugestao.value = { ...erroSugestao.value, [id]: error.message }
  } finally {
    // So libera se ainda for a aprovacao deste id: depois de um turno novo,
    // `aprovando` pode ja pertencer a um card do turno novo.
    if (aprovando.value === id) aprovando.value = ''
  }
}

const descartarSugestao = (id) => {
  sugestoes.value = sugestoes.value.filter((s) => s.id !== id)
}

// Modal de contratação aberto pela sala, pelo slot livre ou pelo "Ajustar" de
// um card. `sugestaoId` existe só no último caso: contratar remove o card.
const contratacao = ref<{ alvo: AlvoDeContratacao; inicial?: PreenchimentoDeContratacao; sugestaoId?: string } | null>(null)
const enviandoContratacao = ref(false)
const erroContratacao = ref('')

const totalArquivado = computed(
  () =>
    (squadAtiva.value?.arquivo.dominios.length ?? 0) +
    (squadAtiva.value?.arquivo.integrantes.length ?? 0) +
    (roster.value?.squadsArquivadas.length ?? 0)
)

const acharDominioAtivo = (id: string) => squadAtiva.value?.dominios.find((d) => d.id === id)

const abrirContratacao = (alvo: AlvoDeContratacao, inicial?: PreenchimentoDeContratacao, sugestaoId?: string) => {
  erroContratacao.value = ''
  contratacao.value = { alvo, inicial, sugestaoId }
}

const contratarNaSala = (dominioId: string) => {
  const dominio = acharDominioAtivo(dominioId)
  if (dominio && squadAtiva.value) abrirContratacao({ alvo: 'integrante', squadId: squadAtiva.value.id, dominio })
}

const abrirSala = () => {
  const squad = squadAtiva.value
  if (squad?.proximoSlot) abrirContratacao({ alvo: 'dominio', squadId: squad.id, slot: squad.proximoSlot })
}

const substituirPoDaSala = (dominioId: string) => {
  const dominio = acharDominioAtivo(dominioId)
  if (dominio && squadAtiva.value) abrirContratacao({ alvo: 'po', squadId: squadAtiva.value.id, dominio })
}

/** "Ajustar" do card: o mesmo modal, com a proposta do modelo como ponto de partida. */
const ajustarSugestao = (id: string) => {
  const s = sugestoes.value.find((x) => x.id === id)
  if (!s || s.kind === 'troca_squad') return
  const falhar = (msg: string) => {
    erroSugestao.value = { ...erroSugestao.value, [id]: msg }
  }
  const squad = roster.value?.squads.find((q) => q.id === s.squad_id)
  if (!squad) return falhar('A squad desta proposta não está ativa.')
  if (s.kind === 'integrante') {
    const dominio = squad.dominios.find((d) => d.id === s.dominio_id)
    if (!dominio) return falhar('O domínio desta proposta não está mais ativo.')
    abrirContratacao({ alvo: 'integrante', squadId: squad.id, dominio }, { papel: s.papel, escopo: s.escopo }, id)
  } else {
    if (!squad.proximoSlot) return falhar('Escritório cheio: não há sala livre.')
    abrirContratacao(
      { alvo: 'dominio', squadId: squad.id, slot: squad.proximoSlot },
      { nomeDominio: s.dominio, escopoDominio: s.escopo, papel: s.papel_po, escopo: s.escopo },
      id
    )
  }
}

/**
 * Contratar pela UI usa as mesmas rotas do card (hire) e da substituição de PO.
 * Trocar `roster` é o único gatilho de que o escritório precisa: o GameMap vê a
 * sala ou a pessoa nova e anima sozinho.
 */
const confirmarContratacao = async (dados: DadosDeContratacao) => {
  const atual = contratacao.value
  if (!atual || enviandoContratacao.value) return
  const { alvo } = atual
  enviandoContratacao.value = true
  erroContratacao.value = ''
  try {
    if (dados.alvo === 'po' && alvo.alvo === 'po') {
      const corpo =
        'integranteId' in dados
          ? { integranteId: dados.integranteId }
          : { nome: dados.nome || undefined, papel: dados.papel, escopo: dados.escopo }
      const r = await rosterApi.substituirPo(alvo.dominio.id, corpo)
      roster.value = r.roster
      avisar(`${r.po.nome} é o novo PO de ${alvo.dominio.nome}`)
    } else if (dados.alvo === 'integrante' && alvo.alvo === 'integrante') {
      const r = await rosterApi.contratar(
        { kind: 'integrante', squad_id: alvo.squadId, dominio_id: alvo.dominio.id, papel: dados.papel, escopo: dados.escopo },
        dados.nome || undefined
      )
      roster.value = r.roster
      avisar(`${r.pessoa.nome} entrou em ${r.dominio.nome}`)
    } else if (dados.alvo === 'dominio' && alvo.alvo === 'dominio') {
      const r = await rosterApi.contratar(
        {
          kind: 'dominio',
          squad_id: alvo.squadId,
          dominio: dados.nomeDominio,
          escopo: dados.escopoDominio,
          papel_po: dados.papelPo,
          escopo_po: dados.escopoPo
        },
        dados.nome || undefined
      )
      roster.value = r.roster
      avisar(`${r.pessoa.nome} abriu o domínio ${r.dominio.nome}`)
    }
    if (atual.sugestaoId) descartarSugestao(atual.sugestaoId)
    contratacao.value = null
  } catch (error) {
    // Squad sumiu ou foi arquivada em outra aba: mesmo gesto da Fase 1.
    if (error instanceof ErroDaApi && error.corpo.squadInexistente) {
      contratacao.value = null
      await recuperarSquadInexistente()
      return
    }
    erroContratacao.value = error instanceof Error ? error.message : String(error)
  } finally {
    enviandoContratacao.value = false
  }
}

// Navega para fora da SPA; o retorno cai no onMounted acima.
const conectarGoogle = () => irParaConsentimento()

const desconectarGoogle = async () => {
  await desconectar()
  quests.value = []
  avisar('Calendário desconectado')
}

const handleDelegation = async (payload: { demanda: string; modo: Modo }) => {
  if (isLoading.value || criandoSquad.value) return;

  isLoading.value = true;
  currentAgent.value = 'Idle';

  try {
    // O token e problema do servidor: ele pega do store e renova sozinho. Um
    // turno que nao toca o calendario roda mesmo sem credencial.
    const response = await fetch('/api/orquestrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demanda: payload.demanda, modo: payload.modo, squadId: squadAtiva.value?.id })
    })

    if (!response.ok) {
      // O corpo carrega a classificacao: `modeloOcupado` e transitorio e passa
      // sozinho, por isso o texto manda tentar de novo em vez de sugerir que
      // algo quebrou.
      const corpo = await response.json().catch(() => ({}))
      // A squad desta aba sumiu: o servidor recusou ANTES do Gemini, entao nada
      // foi agendado. Reenviar sozinho mandaria a demanda para outra squad sem
      // o usuario ver.
      if (response.status === 409 && corpo.squadInexistente) {
        await recuperarSquadInexistente()
        alert('A squad selecionada não existe mais. Confira a squad no topo e reenvie a demanda.')
        return
      }
      throw new Error(corpo.error || 'Erro na requisição')
    }

    const turno = await response.json()

    if (turno.eventos_criados?.length) {
      // responsavel_id e uma PESSOA (PO ou integrante); o GameMap resolve em
      // qual DOMINIO ela esta para mandar o PO raiz ate a sala certa.
      currentAgent.value = turno.eventos_criados[0].responsavel_id
    }

    // Cada turno SUBSTITUI as propostas, inclusive por nenhuma: sugestao de
    // uma demanda antiga nao tem mais contexto, e deixar a lista so crescer
    // (ou nunca esvaziar) mostrava cards que ninguem pediu agora.
    sugestoes.value = turno.sugestoes ?? []
    erroSugestao.value = {}
    // Aprovacao em curso era de um card que acabou de sair: sem zerar, os
    // cards novos ficariam bloqueados ate o POST antigo voltar.
    aprovando.value = ''

    const erros = turno.erros ?? []
    const avisos = turno.avisos ?? []
    // Agendar sem credencial falha por compromisso, nao o turno inteiro: o
    // motivo classificado e o que diz para a Mochila voltar a oferecer o
    // botao de conectar.
    if (erros.some(e => e.motivo === 'precisaConectar')) conectado.value = false
    if (erros.length || avisos.length) {
      // try por tarefa: o lote sobrevive, os erros vem nomeados. Avisos sao
      // coisas feitas de um jeito diferente do pedido (conflito, esforco que
      // nao coube antes do prazo) e o usuario precisa saber delas agora.
      console.warn('Tarefas com erro:', erros, 'Avisos:', avisos)
      alert([
        ...erros.map(e => `${e.capacidade}: ${e.erro}`),
        ...avisos.map(a => `Aviso — ${a.titulo}: ${a.aviso}`)
      ].join('\n'))
    }

    // Rele o calendario em vez de confiar no retorno: o que o Google gravou e
    // o que vale, inclusive edicoes feitas fora do app.
    await carregarMochila()
  } catch (error) {
    console.error('Falha ao orquestrar:', error)
    alert(error?.message || 'Houve um erro ao processar a demanda. Tente novamente.')
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="h-screen w-full bg-[#f4f0e6] font-sans overflow-hidden flex flex-col selection:bg-black selection:text-white">
    <!-- Header -->
    <header class="h-16 border-b-4 border-black bg-[#ffdb58] flex items-center justify-between px-6 shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] z-30 shrink-0">
      <div class="flex items-center gap-4">
        <div class="w-8 h-8 bg-black flex items-center justify-center animate-pulse">
          <div class="w-4 h-4 bg-[#ffdb58]"></div>
        </div>
        <h1 class="text-2xl font-black uppercase tracking-wider">Quest Hub <span class="text-xs ml-2 bg-black text-white px-2 py-1 align-middle">MVP</span></h1>
      </div>
      <div class="flex items-center gap-4">
        <SquadSelector
          v-if="roster"
          :squads="roster.squads"
          :ativa-id="squadAtiva?.id ?? ''"
          :desabilitado="isLoading"
          @trocar="trocarSquad"
          @nova="abrirNovaSquad"
        />
        <div v-if="isLoading" class="font-bold text-sm uppercase flex items-center gap-2">
          <span class="animate-spin text-xl">⚙️</span>
          Processando...
        </div>
        <!-- Credencial mora no servidor: sobrevive a reload e a deploy. -->
        <button
          v-if="!conectado"
          @click="conectarGoogle"
          :disabled="conectando"
          class="border-4 border-black bg-white px-4 py-2 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50"
        >
          {{ conectando ? 'Conectando...' : '🔌 Conectar Google Calendar' }}
        </button>
        <button
          v-else
          @click="desconectarGoogle"
          title="Desconectar do Google Calendar"
          class="font-black text-xs uppercase bg-black text-white px-3 py-2 hover:bg-red-700 transition-colors"
        >
          📅 Calendário conectado
        </button>
      </div>
    </header>

    <!-- Main Content -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Sidebar (Backpack) -->
      <QuestBackpack
        :quests="quests"
        :conectado="conectado"
        :carregando="carregandoMochila"
        :nomes-de-dominio="nomesDeDominio"
        @conectar="conectarGoogle"
        @recarregar="() => carregarMochila()"
      />

      <!-- Map Area -->
      <main class="flex-1 p-6 flex flex-col gap-4 bg-[#e0e7ff] overflow-y-auto">
        <!-- Crescimento em DOIS niveis (spec 4.4): um dominio novo abre sala,
             um integrante entra na sala do dominio que ja existe. O modelo so
             propoe; aprovar aqui e o que escreve no roster. -->
        <!-- :key pelo id do servidor: cada card tem seu proprio estado (nome
             digitado); com key por indice, o card seguinte herdava o nome
             depois de um descarte ou aprovacao. -->
        <!-- Troca de squad: o modelo so propoe; trocar e reenviar sao cliques. -->
        <TrocaSquadCard
          v-for="sugestao in sugestoesDeTroca"
          :key="sugestao.id"
          :sugestao="sugestao"
          :desabilitado="isLoading"
          @trocar="aceitarTroca(sugestao.id, false)"
          @reenviar="aceitarTroca(sugestao.id, true)"
          @descartar="descartarSugestao(sugestao.id)"
        />

        <GrowthCard
          v-for="sugestao in sugestoesDeCrescimento"
          :key="sugestao.id"
          :sugestao="sugestao"
          :squad-nome="sugestao.squad_id !== squadAtiva?.id ? nomeDaSquad(sugestao.squad_id) : ''"
          :enviando="aprovando === sugestao.id"
          :erro="erroSugestao[sugestao.id] || ''"
          @aprovar="(nome) => aprovarSugestao(sugestao.id, nome)"
          @descartar="descartarSugestao(sugestao.id)"
          @ajustar="ajustarSugestao(sugestao.id)"
        />

        <!-- Gestos por sala fora do canvas: o mapa segue sem eventos (Fase 2 §3.1). -->
        <SalasPainel
          v-if="squadAtiva"
          :squad="squadAtiva"
          :total-arquivado="totalArquivado"
          :desabilitado="isLoading || enviandoContratacao"
          @contratar="contratarNaSala"
          @abrir-sala="abrirSala"
          @substituir-po="substituirPoDaSala"
        />

        <!-- :key por squad: recria useOffice ao trocar, senao as salas da
             outra squad seriam lidas como crescimento e animariam. -->
        <GameMap :key="squadAtiva?.id ?? 'sem-squad'" :agent="currentAgent" :squad="squadAtiva" />
      </main>
    </div>

    <ContratarModal
      v-if="contratacao"
      :alvo="contratacao.alvo"
      :inicial="contratacao.inicial"
      :enviando="enviandoContratacao"
      :erro="erroContratacao"
      @contratar="confirmarContratacao"
      @fechar="contratacao = null"
    />

    <NovaSquadModal
      v-if="criandoSquad"
      :enviando="enviandoSquad"
      :erro="erroNovaSquad"
      @criar="criarSquad"
      @fechar="criandoSquad = false"
    />

    <!-- Toast: a contratacao acontece no mapa, longe do card que foi clicado. -->
    <div
      v-if="toast"
      class="fixed bottom-24 right-6 z-50 border-4 border-black bg-[#ffdb58] px-4 py-3 font-black text-sm uppercase shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
    >
      ✨ {{ toast }}
    </div>

    <!-- Command Bar -->
    <!-- Modal aberto bloqueia o envio: o Enter no input de baixo mandaria um
         turno às cegas, e a troca de squad do modal colidiria com ele. -->
    <CommandBar :desabilitado="criandoSquad" @delegate="handleDelegation" />
  </div>
</template>

<style>
/* Reset and Neo-Brutalist base styles */
:root {
  --font-sans: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
body {
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
