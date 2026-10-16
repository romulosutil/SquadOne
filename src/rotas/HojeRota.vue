<script setup lang="ts">
/**
 * Hoje (/), celular primeiro, nesta ordem (RULES 13):
 *  1. o que precisa do Rômulo agora, no máximo 3 cartões (falhas do Dell,
 *     cartões de decisão dos agentes, finanças em laranja/vermelho, fila e
 *     "vale olhar"); o resto atrás de "ver todos";
 *  2. os próximos compromissos (os 3 primeiros da agenda dos agentes);
 *  3. o time: uma linha por squad, com texto e só com fonte (a Mochila da
 *     ativa e o /api/time de todas);
 *  4. a linha do funil (o resumo do CRM, que abre /crm);
 *  5. o que resolve sozinho, fechado.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AjusteCard from '../components/AjusteCard.vue'
import GrowthCard from '../components/GrowthCard.vue'
import TrocaSquadCard from '../components/TrocaSquadCard.vue'
import DellAlerta from '../casca/DellAlerta.vue'
import FinancasAlerta from '../casca/FinancasAlerta.vue'
import RespostasAlerta from '../casca/RespostasAlerta.vue'
import ListaDeQuests from '../agentes/ListaDeQuests.vue'
import { useAgentes } from '../agentes/estado'
import { useOverview } from '../casca/overview'
import { navegar } from '../casca/rota'
import {
  MAX_NA_HOJE,
  ROTULO_DO_ESTADO_DA_SQUAD,
  estadoDaSquad,
  pendenciaDeRespostas,
  pendenciasDaHoje,
  proximasQuests,
  resumoDoFunil,
  type EstadoDasFinancasLido,
  type TimeLido
} from '../casca/hoje'
import { remedioEmComum, separarAlertas } from '../operations/alertas'
import { upcomingAgendaEvents } from '../operations/agenda-window'
import type { CrmVisao } from '../operations/types'
import type { Capacidades } from '../casca/destinos'
import type { PropostaDominio, PropostaIntegrante, PropostaTrocaSquad } from '../types'
import { conectado, conectando } from '../auth/google'

const props = defineProps<{ capacidades: Capacidades }>()

const ag = useAgentes()
const {
  roster,
  squadAtiva,
  quests,
  carregandoMochila,
  mochilaDe,
  isLoading,
  turnoSquadId,
  sugestoesDeTroca,
  sugestoesDeCrescimento,
  ajustes,
  aprovando,
  erroSugestao,
  aprovandoAjuste,
  erroAjuste,
  ajusteNaoCabe,
  nomesDeDominio,
  nomesDePessoa
} = ag
const { overview, carregando: lendoDell, erro: erroDell } = useOverview()

const ops = computed(() => props.capacidades.perfil === 'operations')
const agentes = computed(() => props.capacidades.agentes)

// Relógio para o "próximo" andar sozinho (a quest terminada sai sem esperar o Google).
const agora = ref(Date.now())
let relogio = 0

// ---------------------------------------------------------------- 1. precisa de você

const alertas = computed(() => (ops.value && overview.value ? separarAlertas(overview.value.dell.verificacoes) : null))

// Finanças em semáforo: só o Dell tem o banco. A leitura é a mesma da Sala
// Finanças (só % e semáforo, nunca R$). Falha = sem cartão: não dá para
// afirmar um estado que não foi lido (RULES 2).
const financas = ref<EstadoDasFinancasLido | null>(null)
async function lerFinancas() {
  try {
    const r = await fetch('/api/financas/estado')
    const json = (r.headers.get('content-type') ?? '').includes('application/json')
    financas.value = r.ok && json ? await r.json() : null
  } catch {
    financas.value = null
  }
}

const pendencias = computed(() =>
  pendenciasDaHoje(
    alertas.value,
    {
      trocas: agentes.value ? sugestoesDeTroca.value.map((s) => s.id) : [],
      ajustes: agentes.value ? ajustes.value.map((a) => a.id) : [],
      crescimentos: agentes.value ? sugestoesDeCrescimento.value.map((s) => s.id) : []
    },
    ops.value ? financas.value : null,
    // Do mesmo retrato do CRM que a linha do funil lê (bloco 4): nenhuma leitura a mais.
    ops.value ? pendenciaDeRespostas(funil.value) : null
  )
)
const verTodos = ref(false)
const mostradas = computed(() => (verTodos.value ? pendencias.value : pendencias.value.slice(0, MAX_NA_HOJE)))
const emComum = computed(() => remedioEmComum(alertas.value?.falhas ?? []))

const titulo = computed(() => {
  const n = pendencias.value.length
  if (n) return `${n} ${n === 1 ? 'coisa precisa' : 'coisas precisam'} de você`
  // Sem retrato do monitor não há como afirmar que está tudo bem (RULES 2).
  if (ops.value) {
    if (erroDell.value) return 'Não consegui ler o estado do Dell'
    if (!overview.value) return lendoDell.value ? 'Conferindo o Dell…' : 'Sem leitura do Dell'
    if (!overview.value.dell.geradoEm) return 'Ainda sem leitura do Dell'
    return 'Nada precisa de você agora'
  }
  return 'Nenhum cartão dos agentes esperando você'
})
const subtitulo = computed(() => {
  if (ops.value && erroDell.value) return erroDell.value
  const quando = overview.value?.dell.geradoEm
    ? `Dell conferido às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(overview.value.dell.geradoEm))}.`
    : ''
  const falhas = alertas.value?.falhas.length ? ' O Hermes já avisou das falhas no WhatsApp.' : ''
  return `${quando}${falhas}`.trim()
})
const tom = computed(() =>
  (alertas.value?.falhas.length || erroDell.value) ? 'falha' : pendencias.value.length || (ops.value && !overview.value?.dell.geradoEm) ? 'atencao' : 'ok'
)

const troca = (id: string) => sugestoesDeTroca.value.find((s) => s.id === id) as (PropostaTrocaSquad & { id: string }) | undefined
const ajuste = (id: string) => ajustes.value.find((a) => a.id === id)
const crescimento = (id: string) =>
  sugestoesDeCrescimento.value.find((s) => s.id === id) as ((PropostaDominio | PropostaIntegrante) & { id: string }) | undefined
const nomeSeOutraSquad = (squadId: string) => (squadId !== squadAtiva.value?.id ? ag.nomeDaSquad(squadId) : '')

// ---------------------------------------------------------------- 2. próximos

const proximas = computed(() => proximasQuests(quests.value, agora.value, 3))
const restantes = computed(() => Math.max(0, proximasQuests(quests.value, agora.value, Number.MAX_SAFE_INTEGER).length - proximas.value.length))
/** Sem os agentes aqui: a agenda do dia que a Central já lia (todo o Calendar, não só o SquadOne). */
const eventosDoDia = computed(() =>
  overview.value?.agenda.state === 'connected' ? upcomingAgendaEvents(overview.value.agenda.events, agora.value, 3) : []
)
const hora = (iso: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

// ---------------------------------------------------------------- 3. time

// O time de TODAS as squads ativas, de uma leitura só no servidor (um
// events.list por calendário, cache de 60 s lá). A Mochila das outras squads
// não é lida aqui: seriam N leituras por domínio só para uma linha de texto.
const timeLido = ref<TimeLido | null>(null)
const erroDoTime = ref('')
async function lerTime() {
  try {
    const r = await fetch('/api/time')
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) {
      throw new Error(r.status === 401 ? 'Google Calendar desconectado.' : corpo.error ?? `HTTP ${r.status}`)
    }
    timeLido.value = corpo
    erroDoTime.value = ''
  } catch (e) {
    // Leitura velha não vale como estado de agora: sem leitura, sem sinal (com o motivo).
    timeLido.value = null
    erroDoTime.value = e instanceof Error ? e.message : String(e)
  }
}

/** Nome por id em todas as squads ativas, inclusive integrante arquivado (o evento continua no Google). */
const nomeDaPessoa = computed(() => {
  const mapa = new Map<string, string>()
  for (const s of roster.value?.squads ?? []) {
    for (const i of s.arquivo.integrantes) mapa.set(i.pessoa.id, `${i.pessoa.nome} (arquivado)`)
    for (const d of s.dominios) for (const p of [d.po, ...d.integrantes]) mapa.set(p.id, p.nome)
  }
  return (id: string) => mapa.get(id) ?? id
})

const time = computed(() =>
  (roster.value?.squads ?? []).map((s) => {
    const pessoas = s.dominios.reduce((t, d) => t + 1 + d.integrantes.length, 0)
    const proxima = mochilaDe.value === s.id ? proximasQuests(quests.value, agora.value, 1)[0] ?? null : null
    const { estado, detalhe, emBloco, lidoEm } = estadoDaSquad(s.id, {
      turnoSquadId: turnoSquadId.value,
      mochilaDe: mochilaDe.value,
      proxima,
      time: timeLido.value,
      erroDoTime: erroDoTime.value,
      nomeDaPessoa: nomeDaPessoa.value
    })
    const fonte = lidoEm ? `lido do Google às ${hora(lidoEm)}` : ''
    return { id: s.id, nome: s.nome, ativa: s.id === squadAtiva.value?.id, salas: s.dominios.length, pessoas, estado, detalhe, emBloco, fonte }
  })
)
const abrirEscritorio = async (id: string) => {
  if (!(await ag.trocarSquad(id))) return
  navegar('/squadone')
}

// ---------------------------------------------------------------- 4. funil

const funil = ref<CrmVisao | null>(null)
const erroFunil = ref('')
async function lerFunil() {
  try {
    // no-cache: revalida com o ETag; sem mudança no retrato o servidor responde 304.
    const r = await fetch('/api/operations/crm', { cache: 'no-cache' })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(corpo.error ?? `HTTP ${r.status}`)
    funil.value = corpo
    erroFunil.value = ''
  } catch (e) {
    erroFunil.value = e instanceof Error ? e.message : String(e)
  }
}
const linhaDoFunil = computed(() => {
  if (erroFunil.value) return `Funil indisponível: ${erroFunil.value}`
  if (!funil.value) return 'Lendo o funil…'
  if (funil.value.estado !== 'ok') return funil.value.estado === 'sem-retrato' ? 'Ainda sem retrato das planilhas.' : 'Retrato das planilhas ilegível.'
  return resumoDoFunil(funil.value.contagens)
})
const fonteDoFunil = computed(() => (funil.value?.geradoEm ? `planilhas lidas às ${hora(funil.value.geradoEm)}` : ''))

// Finanças, time e funil: no mount e a cada 5 min com a aba visível. A % muda com a
// leitura diária da Pluggy ou um gasto anotado; o time, com o relógio; o funil, com o
// retrato do n8n (10 min), e é dele que sai o cartão de quem respondeu: lido só no
// mount, um lead que respondesse com a Hoje aberta não apareceria. O CRM responde 304
// quando nada mudou.
let releitura = 0
function lerFontesDaHoje() {
  if (ops.value) {
    void lerFinancas()
    void lerFunil()
  }
  if (agentes.value) void lerTime()
}

onMounted(() => {
  relogio = window.setInterval(() => { agora.value = Date.now() }, 30_000)
  lerFontesDaHoje()
  releitura = window.setInterval(() => {
    if (document.visibilityState === 'visible') lerFontesDaHoje()
  }, 5 * 60_000)
})
onBeforeUnmount(() => {
  window.clearInterval(relogio)
  window.clearInterval(releitura)
})
</script>

<template>
  <div class="hoje">
    <!-- 1. O que precisa de você -->
    <section class="hoje__bloco hoje__precisa" :class="`is-${tom}`" aria-labelledby="hoje-precisa">
      <div class="hoje__cabeca" role="status" aria-live="polite">
        <h1 id="hoje-precisa">{{ titulo }}</h1>
        <p v-if="subtitulo" class="texto-2 texto-pequeno">{{ subtitulo }}</p>
      </div>
      <p v-if="emComum" class="recado recado--atencao"><strong>{{ emComum.quantas }} falhas, um gesto só:</strong> {{ emComum.texto }}</p>

      <ol v-if="mostradas.length" class="hoje__cartoes">
        <li v-for="p in mostradas" :key="p.chave">
          <DellAlerta v-if="p.tipo === 'dell'" :check="p.check" />
          <FinancasAlerta v-else-if="p.tipo === 'financas'" :pendencia="p" />
          <RespostasAlerta v-else-if="p.tipo === 'respostas'" :pendencia="p" />
          <TrocaSquadCard
            v-else-if="p.tipo === 'troca' && troca(p.id)"
            :sugestao="troca(p.id)!"
            :desabilitado="isLoading"
            @trocar="ag.aceitarTroca(p.id, false)"
            @reenviar="ag.aceitarTroca(p.id, true)"
            @descartar="ag.descartarSugestao(p.id)"
          />
          <!-- Ajuste: nada muda no Google sem este clique, e mover é um segundo clique. -->
          <AjusteCard
            v-else-if="p.tipo === 'ajuste' && ajuste(p.id)"
            :proposta="ajuste(p.id)!"
            :squad-nome="nomeSeOutraSquad(ajuste(p.id)!.squad_id)"
            :enviando="aprovandoAjuste === p.id"
            :erro="erroAjuste[p.id] || ''"
            :nao-cabe="!!ajusteNaoCabe[p.id]"
            @aprovar="(mover, min) => ag.aprovarAjuste(p.id, mover, min)"
            @descartar="ag.tirarAjuste(p.id)"
          />
          <!-- :key pelo id do servidor (no v-for acima): cada cartão tem seu próprio
               nome digitado; por índice, o seguinte herdava o nome depois de um descarte. -->
          <GrowthCard
            v-else-if="p.tipo === 'crescimento' && crescimento(p.id)"
            :sugestao="crescimento(p.id)!"
            :squad-nome="nomeSeOutraSquad(crescimento(p.id)!.squad_id)"
            :enviando="aprovando === p.id"
            :erro="erroSugestao[p.id] || ''"
            @aprovar="(nome) => ag.aprovarSugestao(p.id, nome)"
            @descartar="ag.descartarSugestao(p.id)"
            @ajustar="ag.ajustarSugestao(p.id)"
          />
        </li>
      </ol>
      <button
        v-if="pendencias.length > MAX_NA_HOJE"
        type="button"
        class="botao botao--leve botao--largo"
        :aria-expanded="verTodos"
        @click="verTodos = !verTodos"
      >
        {{ verTodos ? 'Mostrar só as 3 primeiras' : `Ver todas as ${pendencias.length}` }}
      </button>
    </section>

    <!-- 2. Próximos -->
    <section class="hoje__bloco" aria-labelledby="hoje-proximos">
      <div class="hoje__cabeca hoje__cabeca--linha">
        <h2 id="hoje-proximos">Próximos</h2>
        <a v-if="agentes" class="hoje__mais" href="/agenda">Abrir a agenda<template v-if="restantes"> (+{{ restantes }})</template></a>
      </div>
      <template v-if="agentes">
        <p v-if="squadAtiva" class="texto-2 texto-pequeno">Agenda da squad {{ squadAtiva.nome }}, lida do Google Calendar.</p>
        <div v-if="!conectado" class="recado recado--atencao">
          Google Calendar desconectado: sem agenda para mostrar.
          <button type="button" class="botao botao--leve" :disabled="conectando" @click="ag.conectarGoogle">Conectar</button>
        </div>
        <p v-else-if="carregandoMochila && !proximas.length" class="texto-2" role="status">Lendo a agenda…</p>
        <p v-else-if="!proximas.length" class="texto-2">Nada marcado pela frente.</p>
        <ListaDeQuests
          v-else
          :itens="proximas"
          :todas="quests"
          :nomes-de-dominio="nomesDeDominio"
          :nomes-de-pessoa="nomesDePessoa"
          :ajustando="!!aprovandoAjuste"
          @ajustar="ag.abrirAjusteDaQuest"
        />
      </template>
      <template v-else-if="ops">
        <p class="texto-2 texto-pequeno">Agenda do dia no Google Calendar (os agentes ainda não moram neste processo).</p>
        <p v-if="!overview" class="texto-2" role="status">Lendo a agenda…</p>
        <div v-else-if="overview.agenda.state === 'disconnected'" class="recado recado--atencao">
          Google não conectado. <a class="botao botao--leve" href="/api/auth/google">Conectar</a>
        </div>
        <p v-else-if="overview.agenda.state === 'unavailable'" class="recado recado--erro">Agenda indisponível: {{ overview.agenda.message }}</p>
        <p v-else-if="!eventosDoDia.length" class="texto-2">Nada mais hoje.</p>
        <ol v-else class="hoje__dia">
          <li v-for="e in eventosDoDia" :key="e.id">
            <strong>{{ e.allDay ? 'Dia inteiro' : hora(e.start) }}</strong>
            <a v-if="e.htmlLink" :href="e.htmlLink" target="_blank" rel="noopener">{{ e.title }}</a>
            <span v-else>{{ e.title }}</span>
          </li>
        </ol>
      </template>
    </section>

    <!-- 3. Time -->
    <section class="hoje__bloco" aria-labelledby="hoje-time">
      <div class="hoje__cabeca hoje__cabeca--linha">
        <h2 id="hoje-time">Time</h2>
        <a v-if="agentes" class="hoje__mais" href="/squadone">Abrir o escritório</a>
      </div>
      <p v-if="!agentes" class="texto-2">Sem sinal dos agentes: a agenda deles não está ligada neste processo.</p>
      <p v-else-if="!roster" class="texto-2" role="status">{{ ag.erroRoster.value ? `Sem roster: ${ag.erroRoster.value}` : 'Lendo as squads…' }}</p>
      <ul v-else class="hoje__time">
        <li v-for="s in time" :key="s.id">
          <div class="hoje__squad">
            <strong>{{ s.nome }}<span v-if="s.ativa" class="selo">Ativa</span></strong>
            <span class="texto-2 texto-pequeno">{{ s.salas }} sala(s) · {{ s.pessoas }} pessoa(s)</span>
          </div>
          <p class="hoje__estado">
            <span class="estado" :class="`is-${s.estado}`">{{ ROTULO_DO_ESTADO_DA_SQUAD[s.estado] }}</span>
            <span class="texto-2 texto-pequeno">{{ s.detalhe }}</span>
            <span v-for="(linha, i) in s.emBloco" :key="i" class="hoje__bloco-agora">{{ linha }}</span>
            <small v-if="s.fonte" class="texto-2 texto-pequeno">{{ s.fonte }}</small>
          </p>
          <button type="button" class="botao botao--leve" :disabled="isLoading && !s.ativa" @click="abrirEscritorio(s.id)">
            Ver salas<span class="so-leitor"> da squad {{ s.nome }}</span>
          </button>
        </li>
      </ul>
    </section>

    <!-- 4. Funil -->
    <a v-if="ops" class="hoje__bloco hoje__funil" href="/crm">
      <span class="hoje__funil-rotulo">Funil</span>
      <strong>{{ linhaDoFunil }}</strong>
      <small v-if="fonteDoFunil" class="texto-2">{{ fonteDoFunil }} · abrir o CRM</small>
    </a>

    <!-- 5. O que resolve sozinho, fechado: está aqui para conferir, não para interromper. -->
    <details v-if="alertas?.sozinhos.length" class="hoje__bloco hoje__sozinhos">
      <summary>
        {{ alertas.sozinhos.length }} {{ alertas.sozinhos.length === 1 ? 'item resolve' : 'itens resolvem' }} sozinho{{ alertas.sozinhos.length === 1 ? '' : 's' }}: ver
      </summary>
      <ul>
        <li v-for="c in alertas.sozinhos" :key="c.id">
          <strong>{{ c.nome }}</strong>
          <p v-if="c.oQueFazer">{{ c.oQueFazer }}</p>
          <small class="texto-2">{{ c.detalhe }}</small>
        </li>
      </ul>
    </details>
  </div>
</template>

<style>
.hoje { display: grid; gap: var(--respiro-pilha); width: 100%; max-width: 56rem; margin: 0 auto; }
.hoje__bloco { display: grid; gap: var(--respiro-interno); min-width: 0; padding: var(--respiro-bloco); border: var(--linha); border-radius: var(--raio-bloco); background: var(--superficie); color: var(--texto); }
/* Um nível de contorno (design.md, 16/10/2026): o bloco tem a borda e nenhuma sombra; o cartão
   de dentro vira zona (fundo, sem borda) com a faixa que diz o tipo, em agentes.css (RULES 3). */
.hoje__cabeca { display: grid; gap: var(--esp-1); }
.hoje__cabeca--linha { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--esp-2); }
.hoje h1 { margin: 0; font-size: var(--tam-titulo); font-weight: var(--peso-titulo); line-height: 1.05; letter-spacing: -0.02em; }
.hoje h2 { margin: 0; font-size: var(--tam-nome); font-weight: var(--peso-forte); letter-spacing: -0.01em; }
.hoje p { margin: 0; }
.hoje__precisa.is-falha { border-left-width: var(--faixa-forte); border-left-color: var(--negativo); }
.hoje__precisa.is-atencao { border-left-width: var(--faixa-forte); border-left-color: var(--destaque); }
.hoje__precisa.is-ok { border-left-width: var(--faixa-forte); border-left-color: var(--positivo); }
.hoje__cartoes { display: grid; gap: var(--esp-3); margin: 0; padding: 0; list-style: none; }
.hoje__mais { display: inline-flex; min-height: var(--toque); align-items: center; color: var(--texto); font-weight: var(--peso-forte); }
.hoje__dia { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.hoje__dia li { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: var(--esp-2); min-height: var(--toque); align-items: center; border-top: var(--divisor); }
.hoje__dia a { color: var(--texto); overflow-wrap: anywhere; }
.hoje__time { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.hoje__time li { display: grid; gap: var(--esp-2); padding: var(--esp-3) var(--esp-4); border-radius: var(--raio-controle); background: var(--superficie-2); }
.hoje__squad { display: grid; gap: var(--esp-0); }
.hoje__squad strong { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); font-size: var(--tam-nome); }
.hoje__estado { display: grid; gap: var(--esp-0); }
.hoje__bloco-agora { font-weight: var(--peso-medio); overflow-wrap: anywhere; }
.hoje__funil { gap: var(--esp-1); color: var(--texto); text-decoration: none; }
.hoje__funil:hover { background: var(--hover); }
.hoje__funil-rotulo { font-size: var(--tam-nome); font-weight: var(--peso-forte); letter-spacing: -0.01em; }
.hoje__funil strong { font-size: var(--tam-nome); font-variant-numeric: tabular-nums; }
.hoje__sozinhos summary { min-height: var(--toque); display: flex; align-items: center; font-weight: var(--peso-forte); cursor: pointer; }
.hoje__sozinhos ul { display: grid; gap: var(--esp-2); margin: var(--esp-3) 0 0; padding: 0; list-style: none; }
.hoje__sozinhos li { display: grid; gap: var(--esp-1); padding: var(--esp-2) var(--esp-4); border-radius: var(--raio-controle); background: var(--superficie-2); }
@media (min-width: 40rem) {
  .hoje__time li { grid-template-columns: minmax(10rem, 0.8fr) minmax(0, 1.4fr) auto; align-items: center; }
}
</style>
