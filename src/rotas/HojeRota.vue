<script setup lang="ts">
/**
 * Hoje (/) no perfil `app` (Easypanel, reserva fria), celular primeiro, nesta ordem (RULES 13):
 *  1. o que precisa do Rômulo agora, no máximo 3 cartões (os de decisão dos agentes); o resto
 *     atrás de "ver todos" (casca/PrecisaDeVoce.vue, o mesmo da Central de comando);
 *  2. os próximos compromissos (os 3 primeiros da agenda dos agentes);
 *  3. o time: uma linha por squad, com texto e só com fonte (a Mochila da ativa e o /api/time de
 *     todas).
 *
 * No `operations` a home é a carteira da Prumo. Esta visão usa o estado do
 * Dell, o Escritório animado e as faixas de Vendas, Agenda, Finanças e Entrada. A Próxima venda, o
 * "por que não vende", as finanças e a agenda do dia sem agentes saíram daqui com ela.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ListaDeQuests from '../agentes/ListaDeQuests.vue'
import PrecisaDeVoce from '../casca/PrecisaDeVoce.vue'
import { useAgentes } from '../agentes/estado'
import { navegar } from '../casca/rota'
import {
  ROTULO_DO_ESTADO_DA_SQUAD,
  estadoDaSquad,
  pendenciasDaHoje,
  proximasQuests,
  type TimeLido
} from '../casca/hoje'
import type { Capacidades } from '../casca/destinos'
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
  aprovandoAjuste,
  nomesDeDominio,
  nomesDePessoa
} = ag

const agentes = computed(() => props.capacidades.agentes)

// Relógio para o "próximo" andar sozinho (a quest terminada sai sem esperar o Google).
const agora = ref(Date.now())
let relogio = 0

// ---------------------------------------------------------------- 1. precisa de você

const pendencias = computed(() =>
  pendenciasDaHoje(null, {
    trocas: agentes.value ? sugestoesDeTroca.value.map((s) => s.id) : [],
    ajustes: agentes.value ? ajustes.value.map((a) => a.id) : [],
    crescimentos: agentes.value ? sugestoesDeCrescimento.value.map((s) => s.id) : []
  })
)
const titulo = computed(() => {
  const n = pendencias.value.length
  if (n) return `${n} ${n === 1 ? 'coisa precisa' : 'coisas precisam'} de você`
  return 'Nenhum cartão dos agentes esperando você'
})
const tom = computed(() => (pendencias.value.length ? 'atencao' : 'ok'))

// ---------------------------------------------------------------- 2. próximos

const proximas = computed(() => proximasQuests(quests.value, agora.value, 3))
const restantes = computed(() => Math.max(0, proximasQuests(quests.value, agora.value, Number.MAX_SAFE_INTEGER).length - proximas.value.length))
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

// O time no mount e a cada 5 min com a aba visível: muda com o relógio e com o Google.
let releitura = 0
onMounted(() => {
  relogio = window.setInterval(() => { agora.value = Date.now() }, 30_000)
  // Sem os agentes, sem a leitura: /api/time faz um events.list por calendário.
  if (agentes.value) void lerTime()
  releitura = window.setInterval(() => {
    if (agentes.value && document.visibilityState === 'visible') void lerTime()
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
      </div>
      <PrecisaDeVoce :dell="null" :pendencias="pendencias" />
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
      <p v-else class="texto-2">Sem sinal dos agentes: a agenda deles não está ligada neste processo.</p>
    </section>

    <!-- 3. Time (só com os agentes neste processo: sem eles era um bloco que dizia "sem sinal"). -->
    <section v-if="agentes" class="hoje__bloco" aria-labelledby="hoje-time">
      <div class="hoje__cabeca hoje__cabeca--linha">
        <h2 id="hoje-time">Time</h2>
        <a class="hoje__mais" href="/squadone">Abrir o escritório</a>
      </div>
      <p v-if="!roster" class="texto-2" role="status">{{ ag.erroRoster.value ? `Sem roster: ${ag.erroRoster.value}` : 'Lendo as squads…' }}</p>
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
            Ver o escritório<span class="so-leitor"> da squad {{ s.nome }}</span>
          </button>
        </li>
      </ul>
    </section>
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
.hoje__precisa.is-atencao { border-left-width: var(--faixa-forte); border-left-color: var(--destaque); }
.hoje__precisa.is-ok { border-left-width: var(--faixa-forte); border-left-color: var(--positivo); }
.hoje__mais { display: inline-flex; min-height: var(--toque); align-items: center; color: var(--texto); font-weight: var(--peso-forte); }
.hoje__time { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.hoje__time li { display: grid; gap: var(--esp-2); padding: var(--esp-3) var(--esp-4); border-radius: var(--raio-controle); background: var(--superficie-2); }
.hoje__squad { display: grid; gap: var(--esp-0); }
.hoje__squad strong { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); font-size: var(--tam-nome); }
.hoje__estado { display: grid; gap: var(--esp-0); }
.hoje__bloco-agora { font-weight: var(--peso-medio); overflow-wrap: anywhere; }
@media (min-width: 40rem) {
  .hoje__time li { grid-template-columns: minmax(10rem, 0.8fr) minmax(0, 1.4fr) auto; align-items: center; }
}
</style>
