<script setup lang="ts">
/**
 * A casca do SquadOne (07/10/2026): navegação, rota atual, folhas e aviso. O
 * estado dos agentes, que morava aqui (1008 linhas), está em
 * `agentes/estado.ts`; cada tela é uma rota em `rotas/` ou um painel da
 * Central. Nenhum contrato de API mudou.
 *
 * Um app só nos dois perfis: no Dell (`operations`) com Funil, Finanças e o
 * estado do Dell; no Easypanel (`app`, reserva fria) só os agentes. Celular
 * primeiro: barra inferior com o ＋Pedir no meio; a partir de 1024 px, barra
 * lateral e Ctrl+K. No Dell com `assistente` no /api/runtime (RULES 28), o ＋, a
 * lateral e o Ctrl+K abrem o Assistente (casca/AssistentePainel.vue) no lugar do Pedir.
 *
 * Escritório imersivo: cenário permanente, menu flutuante e cards centrais.
 * No desktop o Assistente participa da tela à direita e pode ser recolhido;
 * no celular o mesmo conteúdo abre sob demanda.
 */
import { defineAsyncComponent, computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BarraInferior from './casca/BarraInferior.vue'
import Sheet from './components/Sheet.vue'
import BarraLateral from './casca/BarraLateral.vue'
import CascaTopo from './casca/CascaTopo.vue'
import { useAssistente } from './casca/assistente'
import { useAgentes } from './agentes/estado'
import { useOverview } from './casca/overview'
import { caminho, interceptarLink, navegar, ouvirHistorico } from './casca/rota'
import { pilhaDeFolhas } from './casca/pilhaDeFolhas'
import { reaberturaDepoisDeIr } from './casca/paleta'
import {
  comandosDaPaleta,
  destinoAtual,
  destinoDiscreto,
  destinosDaBarra,
  destinosLaterais,
  nomeDaHome,
  rotaDaCasca,
  usaAssistente,
  type Comando,
  type Perfil
} from './casca/destinos'
import './estilos/tokens.css'
import './estilos/casca.css'
import './estilos/agentes.css'

// Painéis fechados não carregam código nem CSS na abertura do aplicativo.
const ArquivoFolha = defineAsyncComponent(() => import('./components/ArquivoFolha.vue'))
const ContratarFolha = defineAsyncComponent(() => import('./components/ContratarFolha.vue'))
const EditarFolha = defineAsyncComponent(() => import('./components/EditarFolha.vue'))
const NovaSquadFolha = defineAsyncComponent(() => import('./components/NovaSquadFolha.vue'))
const Paleta = defineAsyncComponent(() => import('./casca/Paleta.vue'))
const PedirFolha = defineAsyncComponent(() => import('./casca/PedirFolha.vue'))
const AssistentePainel = defineAsyncComponent(() => import('./casca/AssistentePainel.vue'))
const AgendaRota = defineAsyncComponent(() => import('./rotas/AgendaRota.vue'))
const CentralRota = defineAsyncComponent(() => import('./rotas/CentralRota.vue'))
const EscritorioRota = defineAsyncComponent(() => import('./rotas/EscritorioRota.vue'))
const HojeRota = defineAsyncComponent(() => import('./rotas/HojeRota.vue'))
const MaisRota = defineAsyncComponent(() => import('./rotas/MaisRota.vue'))
const DesignSystemRota = defineAsyncComponent(() => import('./rotas/DesignSystemRota.vue'))
const CrmPanel = defineAsyncComponent(() => import('./operations/CrmPanel.vue'))
const FinancasPanel = defineAsyncComponent(() => import('./operations/financas/FinancasPanel.vue'))

const props = withDefaults(defineProps<{ perfil: Perfil; agentes: boolean; assistente?: boolean }>(), { assistente: false })

const capacidades = computed(() => ({ perfil: props.perfil, agentes: props.agentes, assistente: props.assistente }))
const ops = computed(() => props.perfil === 'operations')
/** RULES 28: no Dell com a flag, o ＋, a lateral e o Ctrl+K abrem o Assistente; senão, o Pedir de sempre. */
const comAssistente = computed(() => usaAssistente(capacidades.value))

// A antiga Produção Auto (/projetos/producao-auto) virou o CRM em 30/09/2026.
if (caminho.value === '/projetos/producao-auto') navegar('/crm', true)

const rota = computed(() => rotaDaCasca(caminho.value, capacidades.value))
const atual = computed(() => destinoAtual(caminho.value, capacidades.value))

const ag = useAgentes()
const ov = useOverview()

const conversa = useAssistente()
// A Ficha (dentro de Vendas) só oferece o "Perguntar sobre este lead" com o Assistente nesta Central.
watch(comAssistente, (sim) => { conversa.disponivel.value = sim }, { immediate: true })

// O Assistente responde mesmo sem a agenda neste processo (só não manda pedido ao time).
const pedirIndisponivel = computed(() =>
  comAssistente.value || props.agentes ? '' : ops.value ? 'sem agenda aqui' : 'indisponível'
)
const rotuloDoPedir = computed(() => (comAssistente.value ? 'Assistente' : 'Pedir'))
const pedindo = computed(() =>
  ag.isLoading.value || (comAssistente.value && (!!conversa.pendente.value || !!conversa.enviando.value))
)
const abrirPedir = () => {
  if (comAssistente.value) {
    if (ops.value) try { localStorage.removeItem('squadone.assistente-recolhido') } catch { /* Preferência opcional. */ }
    conversa.abrir()
  }
  else if (!pedirIndisponivel.value) ag.abrirPedir()
}

// O "Ver detalhes" do aviso do turno (agentes/estado.ts) abre o Pedir: com o Assistente, a folha
// do Pedir não existe no Dell (RULES 28) e o resultado mora no cartão que mandou o pedido.
watch(
  () => ag.pedirAberto.value,
  (aberto) => {
    if (aberto && comAssistente.value) {
      ag.pedirAberto.value = false
      conversa.abrir()
    }
  }
)


// ---------------------------------------------------------------- Ctrl+K

const paletaAberta = ref(false)
/**
 * Chave do Mais e da Central: sobe quando a paleta pede `?abrir=` com a tela já aberta (as duas leem
 * o endereço ao montar).
 */
const remontagens = ref(0)
const ehMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const comandos = computed(() =>
  comandosDaPaleta(capacidades.value, ag.roster.value?.squads ?? [], ag.squadAtiva.value?.id ?? null)
)
const largo = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 64rem)') : null

function aoTeclar(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'k' || !(e.ctrlKey || e.metaKey) || e.altKey) return
  // A partir de 1024 px, como a barra lateral; no celular não há teclado para isto.
  if (largo && !largo.matches) return
  // Com outra folha aberta, o atalho não empilha uma paleta por cima dela.
  if (!paletaAberta.value && pilhaDeFolhas.length) return
  e.preventDefault()
  paletaAberta.value = !paletaAberta.value
}

function executar(c: Comando) {
  paletaAberta.value = false
  const a = c.acao
  if (a.tipo === 'ir') {
    if (a.href.startsWith('/entrada/') || /^https?:\/\//.test(a.href)) window.location.assign(a.href)
    else {
      // A mesma tela com outra busca (um lead ou a Triagem estando em Vendas, a Manutenção
      // estando no Mais) não remonta nada sozinha: ver reaberturaDepoisDeIr em casca/paleta.ts.
      const reabrir = reaberturaDepoisDeIr(`${window.location.pathname}${window.location.search}`, a.href)
      navegar(a.href)
      if (reabrir === 'popstate') window.dispatchEvent(new PopStateEvent('popstate'))
      else if (reabrir === 'remontar') remontagens.value += 1
    }
  } else if (a.tipo === 'pedir' || a.tipo === 'assistente') abrirPedir()
  else if (a.tipo === 'squad') void ag.trocarSquad(a.id).then((ok) => { if (!ok) ag.avisar('Espere o pedido em andamento terminar para trocar de squad.') })
  else if (a.tipo === 'nova-squad') ag.abrirNovaSquad()
}

// ---------------------------------------------------------------- ciclo de vida

let pararHistorico: (() => void) | null = null
onMounted(() => {
  pararHistorico = ouvirHistorico()
  window.addEventListener('keydown', aoTeclar)
  if (props.agentes) void ag.iniciar()
  if (ops.value) ov.iniciar()
  // No desktop o Assistente participa do escritório desde a primeira visita.
  if (ops.value && comAssistente.value && largo?.matches) {
    let recolhido = false
    try { recolhido = localStorage.getItem('squadone.assistente-recolhido') === 'sim' } catch { /* Preferência opcional. */ }
    if (!recolhido) conversa.aberto.value = true
  }
})
onBeforeUnmount(() => {
  pararHistorico?.()
  window.removeEventListener('keydown', aoTeclar)
  ov.parar()
})

const aoClicar = (e: MouseEvent) => interceptarLink(e, capacidades.value)

const nome = computed(() => ov.overview.value?.displayName ?? '')
const discreto = computed(() => destinoDiscreto(capacidades.value))
const tituloDoPainel = computed(() => ({ agenda: 'Agenda', funil: 'Vendas', financas: 'Finanças', escritorio: 'Gerenciar equipe', mais: 'Mais', 'design-system': 'Design system', 'nao-encontrada': 'Página não encontrada', hoje: 'Escritório' }[rota.value]))
const fecharPainel = () => navegar('/')
function recolherAssistente() {
  conversa.aberto.value = false
  if (ops.value && largo?.matches) try { localStorage.setItem('squadone.assistente-recolhido', 'sim') } catch { /* Preferência opcional. */ }
}

const {
  roster,
  squadAtiva,
  contratacao,
  enviandoContratacao,
  erroContratacao,
  edicao,
  enviandoEdicao,
  erroEdicao,
  arquivoAberto,
  reativando,
  errosArquivo,
  criandoSquad,
  enviandoSquad,
  erroNovaSquad,
  pedirAberto,
  isLoading,
  toast,
  acaoDoToast
} = ag
</script>

<template>
  <a class="pular" href="#conteudo">Pular para o conteúdo</a>
  <div class="casca" :class="{ 'casca--escritorio': ops, 'casca--imersiva': ops }" @click="aoClicar">
    <BarraLateral v-if="!ops"
      :destinos="destinosLaterais(capacidades)"
      :discreto="discreto"
      :atual="atual"
      :pedir-indisponivel="pedirIndisponivel"
      :pedindo="pedindo"
      :rotulo="rotuloDoPedir"
      :subtitulo="ops ? 'Central, Assistente e Vendas' : 'Hoje, agenda e agentes'"
      :atalho="ehMac ? '⌘K' : 'Ctrl+K'"
      @pedir="abrirPedir"
      @paleta="paletaAberta = true"
    />

    <div class="casca__principal">
      <CascaTopo v-if="!ops" :nome="nome" :discreto="discreto" :atual="atual" :pedindo="isLoading" />

      <main id="conteudo" class="casca__conteudo" :class="{ 'casca__conteudo--escritorio': ops }" tabindex="-1">
        <!-- :key: o salto do Ctrl+K para uma faixa (?abrir=) estando na Central remonta e abre a folha. -->
        <CentralRota v-if="ops" :capacidades="capacidades" />
        <template v-else>
        <HojeRota v-if="rota === 'hoje'" :capacidades="capacidades" />
        <AgendaRota v-else-if="rota === 'agenda'" />
        <CrmPanel v-else-if="rota === 'funil'" />
        <!-- :key pelo caminho: Visão e Lançamentos leem a aba ao montar. -->
        <FinancasPanel v-else-if="rota === 'financas'" :key="caminho" :caminho="caminho" />
        <EscritorioRota v-else-if="rota === 'escritorio'" />
        <MaisRota v-else-if="rota === 'mais'" :key="remontagens" :capacidades="capacidades" />
        <DesignSystemRota v-else-if="rota === 'design-system'" />
        <section v-else class="nao-encontrada">
          <h1>Página não encontrada</h1>
          <p>Este endereço não existe {{ ops ? 'no SquadOne do Dell' : 'neste SquadOne' }}.</p>
          <a class="botao botao--primario" href="/">Voltar para {{ ops ? 'a ' : '' }}{{ nomeDaHome(capacidades) }}</a>
        </section>
        </template>
      </main>
    </div>

    <BarraInferior :imersiva="ops" :assistente-aberto="conversa.aberto.value"
      :destinos="destinosDaBarra(capacidades)"
      :atual="atual"
      :pedir-indisponivel="pedirIndisponivel"
      :pedindo="pedindo"
      :rotulo="rotuloDoPedir"
      @pedir="abrirPedir"
    />
  </div>

  <Sheet v-if="ops && rota !== 'hoje'" :key="`${caminho}:${remontagens}`" flutuante :titulo="tituloDoPainel" @fechar="fecharPainel">
    <div class="painel-do-escritorio" @click="aoClicar">
      <CrmPanel v-if="rota === 'funil'" />
      <AgendaRota v-else-if="rota === 'agenda'" />
      <FinancasPanel v-else-if="rota === 'financas'" :key="caminho" :caminho="caminho" />
      <EscritorioRota v-else-if="rota === 'escritorio'" />
      <MaisRota v-else-if="rota === 'mais'" :key="remontagens" :capacidades="capacidades" />
      <DesignSystemRota v-else-if="rota === 'design-system'" />
      <section v-else><h1>Página não encontrada</h1><a href="/">Voltar ao escritório</a></section>
    </div>
  </Sheet>

  <PedirFolha v-if="agentes && pedirAberto && !comAssistente" @fechar="pedirAberto = false" />
  <!-- Fora do .casca e com Teleport por dentro: o #app fica inerte com a Ficha aberta. -->
  <AssistentePainel v-if="comAssistente && conversa.aberto.value" :agentes="agentes" :flutuante="ops" :integrado="ops" @fechar="recolherAssistente" />
  <Paleta v-if="paletaAberta" :comandos="comandos" :perfil="perfil" @fechar="paletaAberta = false" @executar="executar" />

  <ContratarFolha
    v-if="contratacao"
    :alvo="contratacao.alvo"
    :inicial="contratacao.inicial"
    :enviando="enviandoContratacao"
    :erro="erroContratacao"
    @contratar="ag.confirmarContratacao"
    @fechar="contratacao = null"
  />
  <EditarFolha
    v-if="edicao"
    :alvo="edicao"
    :enviando="enviandoEdicao"
    :erro="erroEdicao"
    @salvar="ag.salvarEdicao"
    @fechar="edicao = null"
  />
  <ArquivoFolha
    v-if="arquivoAberto && squadAtiva && roster"
    :squad="squadAtiva"
    :squads-arquivadas="roster.squadsArquivadas"
    :reativando="reativando"
    :erros="errosArquivo"
    @reativar="ag.reativar"
    @fechar="arquivoAberto = false"
  />
  <NovaSquadFolha
    v-if="criandoSquad"
    :enviando="enviandoSquad"
    :erro="erroNovaSquad"
    @criar="ag.criarSquad"
    @fechar="criandoSquad = false"
  />

  <!-- Aviso: fora do #app, que vira `inert` com uma folha aberta; a região
       existe sempre para o leitor de tela anunciar o texto quando ele chega. -->
  <Teleport to="body">
    <div class="aviso" role="status" aria-live="polite">
      <div v-if="toast" class="aviso__caixa">
        <p>{{ toast }}</p>
        <div class="acoes">
          <button v-if="acaoDoToast" type="button" class="botao botao--primario" @click="acaoDoToast.fazer(); ag.fecharToast()">
            {{ acaoDoToast.rotulo }}
          </button>
          <button type="button" class="botao botao--leve" @click="ag.fecharToast">Dispensar<span class="so-leitor"> o aviso</span></button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
