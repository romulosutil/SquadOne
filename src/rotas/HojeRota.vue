<script setup lang="ts">
/**
 * Hoje (/), celular primeiro, nesta ordem (RULES 13):
 *  0. no Dell (16/10/2026, "a Hoje não está entregando valor"): a próxima venda, uma ação por vez
 *     com a mensagem pronta (ProximaVenda), e o porquê de não vender (PorQueNaoVende), que
 *     substituiu a linha do funil e o cartão "N responderam" (a resposta agora é a própria venda);
 *  1. o que precisa do Rômulo agora, no máximo 3 cartões: o do Dell (um só, com o título
 *     de cada falha e o link para Mais › Manutenção; AC-17, 17/10/2026), os de decisão dos
 *     agentes e as finanças em laranja/vermelho; o resto atrás de "ver todos". As filas do
 *     CRM viram uma linha que abre Vendas;
 *  2. os próximos compromissos (os 3 primeiros da agenda dos agentes);
 *  3. o time: uma linha por squad, com texto e só com fonte (a Mochila da
 *     ativa e o /api/time de todas); só no perfil app desde 17/10/2026 (AC-18);
 *  4. a linha do funil (o resumo do CRM, que abre /crm);
 *  5. o que resolve sozinho, fechado.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AjusteCard from '../components/AjusteCard.vue'
import GrowthCard from '../components/GrowthCard.vue'
import TrocaSquadCard from '../components/TrocaSquadCard.vue'
import DellAlerta from '../casca/DellAlerta.vue'
import FinancasAlerta from '../casca/FinancasAlerta.vue'
import ListaDeQuests from '../agentes/ListaDeQuests.vue'
import PorQueNaoVende from '../operations/PorQueNaoVende.vue'
import ProximaVenda from '../operations/ProximaVenda.vue'
import { useAgentes } from '../agentes/estado'
import { useOverview } from '../casca/overview'
import { navegar } from '../casca/rota'
import {
  MAX_NA_HOJE,
  ROTULO_DO_ESTADO_DA_SQUAD,
  estadoDaSquad,
  pendenciasDaHoje,
  proximasQuests,
  type EstadoDasFinancasLido,
  type TimeLido
} from '../casca/hoje'
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
const { overview, carregando: lendoDell, erro: erroDell, resumo } = useOverview()

const ops = computed(() => props.capacidades.perfil === 'operations')
const agentes = computed(() => props.capacidades.agentes)

// Relógio para o "próximo" andar sozinho (a quest terminada sai sem esperar o Google).
const agora = ref(Date.now())
let relogio = 0

// ---------------------------------------------------------------- 1. precisa de você

// O Dell sai pela mesma regra do topo e do Mais (resumoDoDell): um número, um instante. Sem
// retrato recente não há contagem nenhuma, só "Sem notícia do Dell desde HH:MM" (RULES 19).
const dell = computed(() => (ops.value && overview.value ? resumo.value : null))
const cartaoDoDell = computed(() => !!dell.value && !dell.value.semNoticia && dell.value.precisam.length > 0)

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

// Sem os alertas do Dell aqui: eles viram o cartão único acima, e as filas do CRM, uma linha.
const pendencias = computed(() =>
  pendenciasDaHoje(
    null,
    {
      trocas: agentes.value ? sugestoesDeTroca.value.map((s) => s.id) : [],
      ajustes: agentes.value ? ajustes.value.map((a) => a.id) : [],
      crescimentos: agentes.value ? sugestoesDeCrescimento.value.map((s) => s.id) : []
    },
    ops.value ? financas.value : null
  )
)
const verTodos = ref(false)
// RULES 13: o cartão do Dell conta como um dos 3.
const vagas = computed(() => MAX_NA_HOJE - (cartaoDoDell.value ? 1 : 0))
const mostradas = computed(() => (verTodos.value ? pendencias.value : pendencias.value.slice(0, vagas.value)))

const titulo = computed(() => {
  // No Dell o título é o número do Dell, o mesmo do topo e do Mais; os cartões dos agentes e
  // das finanças vêm abaixo com o próprio título. Somar tudo num "9 coisas" era o que não batia.
  if (ops.value) {
    if (erroDell.value) return 'Não consegui ler o estado do Dell'
    if (!dell.value) return lendoDell.value ? 'Conferindo o Dell…' : 'Sem leitura do Dell'
    return dell.value.textoPrecisam
  }
  const n = pendencias.value.length
  if (n) return `${n} ${n === 1 ? 'coisa precisa' : 'coisas precisam'} de você`
  return 'Nenhum cartão dos agentes esperando você'
})
const subtitulo = computed(() => {
  if (ops.value && erroDell.value) return erroDell.value
  const d = dell.value
  if (!d || d.semNoticia) return ''
  const quando = d.hora ? `Dell conferido às ${d.hora}.` : ''
  const falhas = d.vermelhos ? ' O Hermes já avisou das falhas no WhatsApp.' : ''
  return `${quando}${falhas}`.trim()
})
const tom = computed(() => {
  if (erroDell.value || dell.value?.vermelhos) return 'falha'
  const dellPede = !!dell.value && (dell.value.semNoticia || dell.value.precisam.length > 0)
  return dellPede || pendencias.value.length || (ops.value && !dell.value) ? 'atencao' : 'ok'
})
/** As filas do CRM: trabalho de venda, não saúde do Dell; uma linha só, pelo nome de cada uma. */
const linhaDasFilas = computed(() => {
  const filas = dell.value && !dell.value.semNoticia ? dell.value.filas : []
  return filas.length ? `Na fila de Vendas: ${filas.map((c) => c.nome).join(', ')}.` : ''
})

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

// Só no perfil app (AC-18): no operations a Hoje é a venda, e o bloco do time era só ruído ali.
const mostraOTime = computed(() => agentes.value && !ops.value)

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
// A anotação de um envio feito pela Próxima venda: o n8n refaz o retrato em uns 5 s.
const atrasos: number[] = []
function agendarReleitura() {
  atrasos.push(window.setTimeout(() => void lerFunil(), 5000), window.setTimeout(() => void lerFunil(), 15000))
}
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
  // Sem o bloco, sem a leitura: /api/time faz um events.list por calendário.
  if (mostraOTime.value) void lerTime()
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
  atrasos.forEach((id) => window.clearTimeout(id))
})
</script>

<template>
  <div class="hoje">
    <!-- 0. Vender: a próxima ação com a mensagem pronta, e onde o funil perde. -->
    <template v-if="ops">
      <h1 class="so-leitor">Hoje</h1>
      <ProximaVenda :visao="funil" :erro="erroFunil" @registrado="agendarReleitura" />
      <PorQueNaoVende v-if="funil?.estado === 'ok'" :leads="funil.leads" :agora="agora" resumido />
    </template>

    <!-- 1. O que precisa de você -->
    <section class="hoje__bloco hoje__precisa" :class="`is-${tom}`" aria-labelledby="hoje-precisa">
      <div class="hoje__cabeca" role="status" aria-live="polite">
        <!-- No Dell o título da página é a venda; o estado do Dell vira um bloco de apoio. -->
        <component :is="ops ? 'h2' : 'h1'" id="hoje-precisa">{{ titulo }}</component>
        <p v-if="subtitulo" class="texto-2 texto-pequeno">{{ subtitulo }}</p>
      </div>
      <!-- Sem retrato recente: só o aviso e o caminho para o último retrato (RULES 19), nunca zero. -->
      <p v-if="dell?.semNoticia" class="texto-pequeno">
        O que aparece em Mais é do último retrato. <a href="/mais?abrir=manutencao">Ver em Mais › Manutenção</a>
      </p>

      <ol v-if="cartaoDoDell || mostradas.length" class="hoje__cartoes">
        <li v-if="cartaoDoDell && dell"><DellAlerta :resumo="dell" /></li>
        <li v-for="p in mostradas" :key="p.chave">
          <FinancasAlerta v-if="p.tipo === 'financas'" :pendencia="p" />
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
      <p v-if="linhaDasFilas" class="texto-2 texto-pequeno">{{ linhaDasFilas }} <a href="/crm">Abrir Vendas</a></p>
      <button
        v-if="pendencias.length > vagas"
        type="button"
        class="botao botao--leve botao--largo"
        :aria-expanded="verTodos"
        @click="verTodos = !verTodos"
      >
        {{ verTodos ? 'Mostrar menos' : `Ver todos os ${pendencias.length} cartões` }}
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

    <!-- 3. Time (só com os agentes neste processo: sem eles era um bloco que dizia "sem sinal").
         No Dell sai da Hoje (AC-18, 17/10/2026): quatro squads com "Agenda livre" não decidem nada
         na tela da venda; o Escritório continua a um toque (trilho lateral e Mais). -->
    <section v-if="mostraOTime" class="hoje__bloco" aria-labelledby="hoje-time">
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

    <!-- 4. A linha do funil saiu (16/10/2026): o "Por que não está vendendo" (bloco 0) a substitui. -->
    <p v-if="ops && fonteDoFunil" class="texto-2 texto-pequeno hoje__fonte">{{ fonteDoFunil }} · <a href="/crm">abrir Vendas</a></p>

    <!-- 5. O que resolve sozinho, fechado: está aqui para conferir, não para interromper. Mesma
         contagem do Mais ("3 resolvem sozinhas"); o detalhe técnico fica lá. -->
    <details v-if="dell && !dell.semNoticia && dell.sozinhas.length" class="hoje__bloco hoje__sozinhos">
      <summary>No Dell, {{ dell.textoSozinhas }}: ver</summary>
      <ul>
        <li v-for="c in dell.sozinhas" :key="c.id"><strong>{{ c.nome }}</strong></li>
      </ul>
      <a class="hoje__mais" href="/mais?abrir=manutencao">Ver em Mais › Manutenção</a>
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
.hoje #hoje-precisa { margin: 0; }
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
.hoje__fonte { margin: 0; text-align: center; }
.hoje__fonte a { color: var(--texto-2); }
.hoje__sozinhos summary { min-height: var(--toque); display: flex; align-items: center; font-weight: var(--peso-forte); cursor: pointer; }
.hoje__sozinhos ul { display: grid; gap: var(--esp-2); margin: var(--esp-3) 0 0; padding: 0; list-style: none; }
.hoje__sozinhos li { display: grid; gap: var(--esp-1); padding: var(--esp-2) var(--esp-4); border-radius: var(--raio-controle); background: var(--superficie-2); }
@media (min-width: 40rem) {
  .hoje__time li { grid-template-columns: minmax(10rem, 0.8fr) minmax(0, 1.4fr) auto; align-items: center; }
}
</style>
