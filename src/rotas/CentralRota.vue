<script setup lang="ts">
/**
 * Central de comando (/ no perfil `operations`, 17/10/2026). O pedido: "os menus são Central de
 * comando + Assistente + Vendas. O BI já tem boas coisas, mas está espalhado e sem cara de centro de
 * comando. O Escritório poderia ser a página inicial, com agentes autônomos atuando em várias
 * frentes, em movimento, mais animado. Finanças, Agenda e Entrada poderiam estar aqui."
 *
 * Celular primeiro, em ordem de prioridade:
 *  1. cabeçalho: o estado do Dell (o ÚNICO lugar do número "N precisam de você"; o chip do topo
 *     saiu) e, logo abaixo, o que precisa do Rômulo, no máximo 3 cartões (RULES 13, PrecisaDeVoce);
 *  2. o Escritório animado no centro (EscritorioVivo): os balões só com fonte (office/baloes.ts) e o
 *     PO raiz indo à sala onde um robô falhou ou pede olhar, e voltando quando o status.json resolve;
 *  3. as faixas de uma linha (casca/central.ts): Vendas, Agenda, Finanças, Entrada e Dell. Finanças e
 *     Agenda abrem o conteúdo inteiro numa folha aqui mesmo; as rotas /financas e /agenda continuam.
 *
 * A Próxima venda deixou de ser o primeiro cartão daqui: Vendas é o lugar dela; aqui entra só o passo
 * da vez e a contagem, numa faixa. Nada aqui grava: as escritas são as dos cartões e das folhas, que
 * já existiam.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AgendaRota from './AgendaRota.vue'
import Sheet from '../components/Sheet.vue'
import EscritorioVivo from '../casca/EscritorioVivo.vue'
import PrecisaDeVoce from '../casca/PrecisaDeVoce.vue'
import PorQueNaoVende from '../operations/PorQueNaoVende.vue'
import ProximaVenda from '../operations/ProximaVenda.vue'
import FinSaude from '../operations/financas/FinSaude.vue'
import FinVisao from '../operations/financas/FinVisao.vue'
import { useAgentes } from '../agentes/estado'
import { useOverview } from '../casca/overview'
import { interceptarLink, navegar } from '../casca/rota'
import { conectado } from '../auth/google'
import { pendenciasDaHoje, proximasQuests, referenciaDaQuest, type EstadoDasFinancasLido, type TimeLido } from '../casca/hoje'
import {
  andarDaCentral, depoisDaTrocaDeAndar, faixasDaCentral, gravarAndar, lerAndar, pedidoDaCentral, statusDoMapa,
  type Faixa, type FontesDasFaixas,
} from '../casca/central'
import { baloesDaAgenda, baloesDasSalas, baloesDosAtores, destinoDoSupervisor, quandoCurto, type LeituraDasFinancas } from '../office/baloes'
import { fonteDoCrm, operacaoDaSala, temOperacao, type OperacaoDaSala } from '../office/operacao'
import { upcomingAgendaEvents } from '../operations/agenda-window'
import { diagnosticoDeVenda } from '../operations/por-que-nao-vende'
import { filaDaTela, lerResolvidas, resumoDaFila, type Resolvidas } from '../operations/proxima-venda'
import type { VisaoFinanceira } from '../operations/financas/types'
import type { CrmVisao } from '../operations/types'
import type { Capacidades } from '../casca/destinos'
import '../operations/financas/financas.css'

const props = defineProps<{ capacidades: Capacidades }>()
const agentes = computed(() => props.capacidades.agentes)

const ag = useAgentes()
const { roster, squadAtiva, quests, carregandoMochila, sugestoesDeTroca, sugestoesDeCrescimento, ajustes } = ag
const { overview, carregando: lendoDell, erro: erroDell, resumo, ler: lerDell } = useOverview()

const agora = ref(Date.now())

function armazenamento(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- leituras

/** O retrato do CRM: a faixa de Vendas e as salas do PRUMO leem o mesmo. */
const visaoDoCrm = ref<CrmVisao | null>(null)
const erroDoCrm = ref('')
async function lerCrm() {
  try {
    // no-cache: revalida com o ETag; sem mudança no retrato o servidor responde 304.
    const r = await fetch('/api/operations/crm', { cache: 'no-cache' })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(corpo.error ?? `HTTP ${r.status}`)
    visaoDoCrm.value = corpo
    erroDoCrm.value = ''
  } catch (e) {
    // O último retrato bom continua valendo (fonteDoCrm diz que está velho); sem nenhum, "Sem sinal".
    erroDoCrm.value = e instanceof Error ? e.message : String(e)
  }
}

/** O "Enviei"/"Pular" do dia (o mesmo da Próxima venda e do Telegram): a faixa não oferece o que já foi feito. */
const resolvidas = ref<Resolvidas>({})
async function lerVendaDoDia() {
  resolvidas.value = lerResolvidas(armazenamento(), Date.now())
  try {
    const r = await fetch('/api/operations/crm/venda', { cache: 'no-store' })
    if (!r.ok) return
    const corpo = (await r.json()) as { resolvidas?: Resolvidas }
    if (corpo?.resolvidas) resolvidas.value = { ...resolvidas.value, ...corpo.resolvidas }
  } catch {
    // sem servidor: fica o que este navegador lembra
  }
}

/** Finanças: o semáforo (só %) para os cartões e o balão; a Visão para a faixa e a folha. */
const leituraDasFinancas = ref<LeituraDasFinancas>(null)
const erroDasFinancas = ref('')
const visaoFinanceira = ref<VisaoFinanceira | null>(null)
let mesDaFolha = ''
let modoDaFolha: 'competencia' | 'caixa' = 'competencia'
async function lerFinancas() {
  try {
    const r = await fetch('/api/financas/estado')
    const json = (r.headers.get('content-type') ?? '').includes('application/json')
    if (!r.ok || !json) throw new Error(`HTTP ${r.status}`)
    leituraDasFinancas.value = { estado: await r.json() }
    erroDasFinancas.value = ''
  } catch (e) {
    // Falha = sem cartão nem balão: não dá para afirmar um estado que não foi lido (RULES 2).
    leituraDasFinancas.value = null
    erroDasFinancas.value = e instanceof Error ? e.message : String(e)
  }
  // A Visão (com os R$) só é lida com a folha aberta: a faixa não mostra valor, então a home não
  // precisa buscá-los a cada 5 minutos.
  if (folha.value === 'financas') await lerVisaoFinanceira()
}
async function lerVisaoFinanceira() {
  const q = new URLSearchParams({ visao: modoDaFolha })
  if (mesDaFolha) q.set('mes', mesDaFolha)
  try {
    const r = await fetch(`/api/financas/visao?${q}`)
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(corpo.error ?? `HTTP ${r.status}`)
    visaoFinanceira.value = corpo
  } catch {
    visaoFinanceira.value = null
  }
}
/** A folha muda de mês sem mexer no endereço (a Visão inteira, em /financas, é que escreve nele). */
function mudarMesDaFolha(mes: string, modo: 'competencia' | 'caixa') {
  mesDaFolha = mes
  modoDaFolha = modo
  void lerVisaoFinanceira()
}

/** O time de todas as squads (/api/time): a agenda que fala nos balões. Só com os agentes. */
const timeLido = ref<TimeLido | null>(null)
async function lerTime() {
  try {
    const r = await fetch('/api/time')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    timeLido.value = await r.json()
  } catch {
    // Leitura velha não vale como agora: sem leitura, sem balão de agenda.
    timeLido.value = null
  }
}

/** A Entrada é outro serviço (RULES 23): só o selo; falhar aqui não derruba nada. */
const entrada = ref<FontesDasFaixas['entrada']>(null)
async function lerEntrada() {
  try {
    const r = await fetch('/entrada/api/estado', { cache: 'no-store' })
    const json = (r.headers.get('content-type') ?? '').includes('application/json')
    if (!r.ok || !json) throw new Error(`HTTP ${r.status}`)
    const corpo = (await r.json()) as { pendentes?: unknown; avisos?: unknown }
    entrada.value = {
      pendentes: typeof corpo.pendentes === 'number' ? corpo.pendentes : 0,
      avisos: Array.isArray(corpo.avisos) ? corpo.avisos.length : 0,
    }
  } catch (e) {
    entrada.value = { erro: e instanceof Error ? e.message : String(e) }
  }
}

function lerTudo() {
  void lerCrm()
  void lerVendaDoDia()
  void lerFinancas()
  void lerEntrada()
  if (agentes.value) void lerTime()
}

// ---------------------------------------------------------------- 1. cabeçalho e o que precisa de você

const dellLido = computed(() => (overview.value ? resumo.value : null))
const linhaDoDell = computed(() => {
  if (erroDell.value && !overview.value) return { tom: 'falha', texto: 'Dell sem resposta', quando: erroDell.value }
  const d = dellLido.value
  if (!d) return { tom: 'pendente', texto: lendoDell.value ? 'Conferindo o Dell…' : 'Sem leitura do Dell', quando: '' }
  return { tom: d.topo.tom, texto: d.textoPrecisam, quando: d.semNoticia ? '' : d.hora ? `conferido às ${d.hora}` : '' }
})

const pendencias = computed(() =>
  pendenciasDaHoje(
    null,
    {
      trocas: agentes.value ? sugestoesDeTroca.value.map((s) => s.id) : [],
      ajustes: agentes.value ? ajustes.value.map((a) => a.id) : [],
      crescimentos: agentes.value ? sugestoesDeCrescimento.value.map((s) => s.id) : [],
    },
    (leituraDasFinancas.value?.estado ?? null) as EstadoDasFinancasLido | null
  )
)
const temCartao = computed(() => {
  const d = dellLido.value
  return (!!d && !d.semNoticia && d.precisam.length > 0) || pendencias.value.length > 0
})

// ---------------------------------------------------------------- 2. o Escritório

const andarEscolhido = ref<string | null>(lerAndar(armazenamento()))
const squads = computed(() => (agentes.value ? roster.value?.squads ?? [] : []))
const andar = computed(() => {
  const id = andarDaCentral(squads.value, andarEscolhido.value, (salas) => temOperacao(salas))
  return squads.value.find((s) => s.id === id) ?? null
})
function escolherAndar(id: string) {
  andarEscolhido.value = id
  gravarAndar(armazenamento(), id)
}
const semAndar = computed(() => {
  if (!agentes.value) return 'Os agentes não moram neste processo: sem salas para mostrar. Os robôs e as frentes continuam nas faixas abaixo.'
  if (ag.erroRoster.value) return `Sem roster: ${ag.erroRoster.value}`
  return 'Lendo as squads…'
})

const operacoes = computed<Record<string, OperacaoDaSala>>(() => {
  const salas = andar.value?.dominios ?? []
  if (!temOperacao(salas.map((d) => d.id))) return {}
  const fontes = { crm: fonteDoCrm(visaoDoCrm.value, erroDoCrm.value, agora.value), dell: overview.value?.dell ?? null, agora: agora.value }
  const pares = salas.map((d) => [d.id, operacaoDaSala(d.id, fontes)] as const)
  return Object.fromEntries(pares.filter((p): p is readonly [string, OperacaoDaSala] => p[1] !== null))
})
const baloesPorSala = computed(() => baloesDasSalas(andar.value?.dominios ?? [], { operacoes: operacoes.value, financas: leituraDasFinancas.value }))
const visita = computed(() => destinoDoSupervisor(baloesPorSala.value, (andar.value?.dominios ?? []).map((d) => d.id)))
const baloes = computed(() => {
  const a = andar.value
  if (!a) return {}
  const daAgenda = baloesDaAgenda(timeLido.value?.squads.find((s) => s.id === a.id), agora.value)
  return baloesDosAtores(a.dominios, baloesPorSala.value, daAgenda, visita.value)
})
const statusDoAndar = computed(() => {
  if (!overview.value) return erroDell.value ? 'Sem o retrato do Dell: os robôs estão sem sinal' : 'Lendo o retrato do Dell…'
  const destaques = Object.values(baloesPorSala.value).filter((b) => b.destaque).length
  return statusDoMapa(destaques, resumo.value.hora, resumo.value.semNoticia)
})
async function abrirEscritorioCompleto() {
  // O Escritório completo mostra a squad ativa: leva o andar que se estava olhando. Troca recusada
  // (pedido em andamento): fica na Central e avisa, em vez de abrir o Escritório na squad errada.
  const destino = andar.value && andar.value.id !== squadAtiva.value?.id ? andar.value.id : null
  const passo = depoisDaTrocaDeAndar(destino !== null, destino === null || await ag.trocarSquad(destino))
  if (passo.navegar === false) {
    ag.avisar(passo.aviso)
    return
  }
  navegar('/squadone')
}

// ---------------------------------------------------------------- 3. as faixas

const fontesDaVenda = computed<FontesDasFaixas['vendas']>(() => {
  const v = visaoDoCrm.value
  if (!v) return erroDoCrm.value ? { erro: erroDoCrm.value } : null
  if (v.estado !== 'ok') return { erro: v.mensagem ?? 'sem retrato das planilhas' }
  // Sem a trava de ritmo aqui, a faixa não oferece primeiro contato (quem decide é a Próxima venda,
  // em Vendas): só as conversas que já existem. Por isso a contagem diz os tipos, não um total.
  const fila = filaDaTela(v, { ritmo: { motivo: 'dia' }, noExpediente: false, agora: agora.value }, resolvidas.value)
  return {
    fila: fila.map((a) => ({ titulo: a.titulo, produto: a.produto, quente: a.quente })),
    resumo: resumoDaFila(fila),
    gargalo: diagnosticoDeVenda(v.leads, agora.value).gargalo?.titulo ?? null,
  }
})

const fontesDaAgenda = computed<FontesDasFaixas['agenda']>(() => {
  if (agentes.value) {
    if (!conectado.value) return { erro: 'Google Calendar desconectado' }
    const todas = proximasQuests(quests.value, agora.value, Number.MAX_SAFE_INTEGER)
    if (carregandoMochila.value && !todas.length) return null
    return {
      itens: todas.slice(0, 3).map((q) => ({ quando: quandoCurto(new Date(referenciaDaQuest(q)).toISOString(), agora.value), titulo: q.titulo })),
      restantes: Math.max(0, todas.length - 3),
      fonte: squadAtiva.value ? `Squad ${squadAtiva.value.nome}, do Google Calendar` : 'Do Google Calendar',
    }
  }
  // Sem os agentes aqui: o dia do Google Calendar que o retrato da Central já lê.
  const ov = overview.value
  if (!ov) return erroDell.value ? { erro: erroDell.value } : null
  if (ov.agenda.state === 'disconnected') return { erro: 'Google não conectado' }
  if (ov.agenda.state === 'unavailable') return { erro: ov.agenda.message }
  const eventos = upcomingAgendaEvents(ov.agenda.events, agora.value, 3)
  return {
    itens: eventos.map((e) => ({ quando: e.allDay ? 'dia inteiro' : quandoCurto(e.start, agora.value), titulo: e.title, ...(e.htmlLink ? { href: e.htmlLink } : {}) })),
    restantes: 0,
    fonte: 'O dia no Google Calendar',
  }
})

const fontesDasFinancas = computed<FontesDasFaixas['financas']>(() => {
  const v = visaoFinanceira.value
  if (!leituraDasFinancas.value && !v) return erroDasFinancas.value ? { erro: erroDasFinancas.value } : null
  return { estado: (leituraDasFinancas.value?.estado as EstadoDasFinancasLido | null) ?? null }
})

/**
 * "Agora" (17/10/2026, "a Central está muito reativa"): com o retrato do CRM lido, a Central mostra o
 * plano do dia, o passo da vez com a mensagem pronta e o porquê de não vender, e a faixa de Vendas
 * (a mesma informação em uma linha) sai: duas vezes o mesmo passo na tela era ruído. Sem retrato, a
 * faixa fica e diz "sem sinal de Vendas".
 */
const agoraNaCentral = computed(() => visaoDoCrm.value?.estado === 'ok')
// Depois do "Enviei", o n8n refaz o retrato em uns 5 s: a Central relê duas vezes, como a Hoje fazia.
const atrasos: number[] = []
function agendarReleituraDoCrm() {
  atrasos.push(window.setTimeout(() => void lerCrm(), 5000), window.setTimeout(() => void lerCrm(), 15000))
}

const faixas = computed<Faixa[]>(() =>
  faixasDaCentral(
    {
      vendas: fontesDaVenda.value,
      agenda: fontesDaAgenda.value,
      financas: fontesDasFinancas.value,
      entrada: entrada.value,
      dell: erroDell.value && !overview.value ? { erro: erroDell.value } : dellLido.value,
    },
    agentes.value
  )
)

const faixasVisiveis = computed(() => (agoraNaCentral.value ? faixas.value.filter((f) => f.id !== 'vendas') : faixas.value))

const folha = ref<'financas' | 'agenda' | null>(null)
watch(folha, (aberta) => { if (aberta === 'financas') void lerVisaoFinanceira() })
/**
 * A folha é teleportada para fora da casca, onde o clique em link não vira navegação sem recarregar
 * (App.vue escuta só dentro de .casca). Aqui ela vira: um turno rodando não se perde por um
 * "Abrir Finanças inteiras", e a folha fecha porque a tela trocou.
 */
function aoClicarNaFolha(e: MouseEvent) {
  interceptarLink(e, props.capacidades)
  if (e.defaultPrevented) folha.value = null
}

// ---------------------------------------------------------------- ciclo de vida

let relogio = 0
let releitura = 0
onMounted(() => {
  relogio = window.setInterval(() => { agora.value = Date.now() }, 30_000)
  lerTudo()
  // O retrato do CRM muda a cada 10 min (n8n), as finanças com a Pluggy, a Entrada com um envio.
  releitura = window.setInterval(() => {
    if (document.visibilityState === 'visible') lerTudo()
  }, 5 * 60_000)

  // ?abrir= (Ctrl+K e links antigos): abre a folha ou rola até o mapa, e limpa o endereço para
  // recarregar a página não abrir de novo.
  const pedido = pedidoDaCentral(window.location.search)
  if (pedido) {
    history.replaceState(null, '', '/')
    if (pedido === 'financas' || (pedido === 'agenda' && agentes.value)) folha.value = pedido
    else if (pedido === 'escritorio') void nextTick(() => document.getElementById('central-escritorio')?.scrollIntoView({ block: 'start' }))
  }
})
onBeforeUnmount(() => {
  window.clearInterval(relogio)
  window.clearInterval(releitura)
  atrasos.forEach((id) => window.clearTimeout(id))
})
</script>

<template>
  <div class="central">
    <!-- 1. Cabeçalho: o estado do Dell, num lugar só, e o que precisa de você. -->
    <header class="central__topo">
      <div class="central__titulo">
        <h1>Central de comando</h1>
        <p class="central__dell" :class="`is-${linhaDoDell.tom}`" role="status" aria-live="polite">
          <strong>{{ linhaDoDell.texto }}</strong><small v-if="linhaDoDell.quando"> · {{ linhaDoDell.quando }}</small>
        </p>
      </div>
      <div class="central__acoes">
        <button type="button" class="botao botao--leve" :disabled="lendoDell" @click="lerDell(); lerTudo()">
          {{ lendoDell ? 'Lendo…' : 'Atualizar' }}<span class="so-leitor"> a Central</span>
        </button>
        <!-- A engrenagem da Manutenção é a do topo da casca (CascaTopo), logo acima: uma só na tela. -->
      </div>
    </header>

    <section v-if="temCartao" class="central__bloco" aria-labelledby="central-precisa">
      <h2 id="central-precisa">Precisa de você</h2>
      <PrecisaDeVoce :dell="dellLido" :pendencias="pendencias" />
    </section>

    <!-- Agora: o que fazer, em ordem, sem esperar o Rômulo procurar (o plano do dia, o passo da vez
         "Envie para X, isto:" e o porquê de não vender, com quem está parado). -->
    <section v-if="agoraNaCentral" class="central__agora" aria-label="Agora">
      <ProximaVenda :visao="visaoDoCrm" :erro="erroDoCrm" @registrado="agendarReleituraDoCrm" />
      <PorQueNaoVende v-if="visaoDoCrm" :leads="visaoDoCrm.leads" :agora="agora" resumido />
    </section>

    <!-- 2. O Escritório no centro. -->
    <EscritorioVivo
      :squads="squads"
      :andar="andar"
      :baloes="baloes"
      :baloes-das-salas="baloesPorSala"
      :visita="visita"
      :status="statusDoAndar"
      :operacoes="operacoes"
      :sem-andar="semAndar"
      :capacidades="capacidades"
      @andar="escolherAndar"
      @completo="abrirEscritorioCompleto"
    />

    <!-- 3. As frentes, uma linha cada. -->
    <section class="central__faixas" aria-label="Frentes">
      <ul>
        <li v-for="f in faixasVisiveis" :key="f.id" class="central__faixa" :class="`is-${f.tom}`">
          <component
            :is="f.folha ? 'button' : 'a'"
            class="central__faixa-alvo"
            v-bind="f.folha ? { type: 'button' } : /^https?:/.test(f.href) ? { href: f.href, target: '_blank', rel: 'noopener' } : { href: f.href }"
            @click="f.folha ? (folha = f.folha) : undefined"
          >
            <span class="central__faixa-titulo">{{ f.titulo }}</span>
            <span class="central__faixa-linha">{{ f.linha }}</span>
            <span v-if="f.detalhe" class="central__faixa-detalhe">{{ f.detalhe }}</span>
            <ol v-if="f.itens?.length" class="central__faixa-itens">
              <li v-for="(i, n) in f.itens" :key="n"><strong>{{ i.quando }}</strong> {{ i.titulo }}</li>
            </ol>
            <span class="central__faixa-acao">{{ f.rotuloDoLink }}<span aria-hidden="true"> →</span></span>
          </component>
        </li>
      </ul>
    </section>

    <!-- Finanças inteiras sem sair da Central: a mesma Visão da rota, sobre a mesma leitura. -->
    <Sheet v-if="folha === 'financas'" titulo="Finanças" subtitulo="Visão do mês" cheia @fechar="folha = null">
      <div class="fin central__folha" @click="aoClicarNaFolha">
        <FinSaude v-if="visaoFinanceira" :conexoes="visaoFinanceira.saude.conexoes" :dados-ate="visaoFinanceira.saude.dadosAte" :situacao="visaoFinanceira" />
        <p v-if="!visaoFinanceira" class="recado" role="status">{{ erroDasFinancas ? `Sem sinal das finanças: ${erroDasFinancas}` : 'Lendo as finanças…' }}</p>
        <FinVisao v-else :dados="visaoFinanceira" @mudar="mudarMesDaFolha" @importado="lerFinancas" />
        <a class="botao botao--leve" href="/financas">Abrir Finanças inteiras (Lançamentos e Organizar)</a>
      </div>
    </Sheet>
    <Sheet v-if="folha === 'agenda' && agentes" titulo="Agenda" subtitulo="Compromissos dos agentes" cheia @fechar="folha = null">
      <div @click="aoClicarNaFolha"><AgendaRota /></div>
    </Sheet>
  </div>
</template>

<style>
.central { display: grid; gap: var(--respiro-pilha); width: 100%; min-width: 0; max-width: 72rem; margin: 0 auto; color: var(--texto); }
.central p { margin: 0; }
.central__topo { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--esp-3); }
.central__titulo { display: grid; gap: var(--esp-1); min-width: 0; }
.central h1 { margin: 0; font-size: var(--tam-titulo); font-weight: var(--peso-titulo); line-height: 1.05; letter-spacing: -0.02em; }
.central h2 { margin: 0; font-size: var(--tam-nome); font-weight: var(--peso-forte); letter-spacing: -0.01em; }
/* O número do Dell: o ponto reforça, a palavra diz (RULES 3). */
.central__dell { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-1); font-size: var(--tam-apoio); }
.central__dell::before { content: ""; width: 0.7rem; height: 0.7rem; flex-shrink: 0; border: var(--linha); border-radius: 50%; background: var(--superficie-2); }
.central__dell.is-ok::before { background: var(--positivo); }
.central__dell.is-pendente::before { background: var(--destaque); }
.central__dell.is-falha::before { background: var(--negativo); }
.central__dell small { color: var(--texto-2); font-weight: var(--peso-medio); }
.central__acoes { display: flex; align-items: center; gap: var(--esp-2); }

.central__bloco { display: grid; gap: var(--respiro-interno); min-width: 0; padding: var(--respiro-bloco); border: var(--linha); border-radius: var(--raio-bloco); background: var(--superficie); }
/* Agora: o passo da vez e o diagnóstico lado a lado a partir de 64 rem, empilhados antes disso. */
.central__agora { display: grid; gap: var(--respiro-pilha); min-width: 0; }
@media (min-width: 64rem) { .central__agora { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; } }
.central__cabeca { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-2); }

/* As faixas: zonas (fundo, sem borda; BP-R1) com a faixa do tom à esquerda. */
.central__faixas ul { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.central__faixa-alvo {
  display: grid;
  width: 100%;
  height: 100%;
  gap: var(--esp-0);
  min-height: var(--toque);
  padding: var(--esp-3) var(--esp-4);
  border: 0;
  border-radius: var(--raio-controle);
  background: var(--superficie-2);
  box-shadow: inset var(--faixa) 0 0 var(--borda);
  color: var(--texto);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.central__faixa-alvo:hover { background: var(--hover); }
.central__faixa.is-ok .central__faixa-alvo { box-shadow: inset var(--faixa) 0 0 var(--positivo); }
.central__faixa.is-atencao .central__faixa-alvo { box-shadow: inset var(--faixa) 0 0 var(--destaque); }
.central__faixa.is-falha .central__faixa-alvo { box-shadow: inset var(--faixa) 0 0 var(--negativo); background: var(--erro-fundo); }
.central__faixa.is-sem_sinal .central__faixa-alvo { box-shadow: inset var(--faixa) 0 0 var(--texto-2); }
.central__faixa-titulo { color: var(--texto-2); font-size: var(--tam-apoio); font-weight: var(--peso-forte); }
.central__faixa-linha { font-weight: var(--peso-forte); overflow-wrap: anywhere; }
.central__faixa-detalhe { color: var(--texto-2); font-size: var(--tam-apoio); overflow-wrap: anywhere; }
.central__faixa-itens { display: grid; gap: var(--esp-0); margin: 0; padding: 0; list-style: none; font-size: var(--tam-apoio); }
.central__faixa-itens li { overflow-wrap: anywhere; }
.central__faixa-acao { margin-top: var(--esp-1); font-size: var(--tam-apoio); font-weight: var(--peso-forte); }
.central__folha { display: grid; gap: var(--esp-4); }

@media (min-width: 40rem) {
  .central__faixas ul { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 64rem) {
  .central__faixas ul { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
