<script setup lang="ts">
/**
 * Agenda (/agenda): os compromissos que os agentes marcaram para a squad
 * ativa, por dia, lidos do Google Calendar a cada abertura (invariante 3: a
 * verdade é o Google; isto é cache da última leitura). Também é onde a
 * conexão com o Google aparece por extenso: conectar, autorizar o Tasks e
 * desconectar — o botão "Calendário conectado" que desconectava ao toque saiu.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AjusteCard from '../components/AjusteCard.vue'
import ListaDeQuests from '../agentes/ListaDeQuests.vue'
import { useAgentes } from '../agentes/estado'
import { ampliarAcesso, conectado, conectando, tasksLiberado } from '../auth/google'
import { questTerminou, diasDoEventoDiaInteiro } from '../mochila'
import { proximasQuests } from '../casca/hoje'
import type { QuestCalendario } from '../types'

const ag = useAgentes()
const {
  quests,
  carregandoMochila,
  squadAtiva,
  nomesDeDominio,
  nomesDePessoa,
  ajustes,
  aprovandoAjuste,
  erroAjuste,
  ajusteNaoCabe
} = ag

// Quest terminada sai só da VISTA: `quests` segue inteira para "Bloco i/N"
// não renumerar. O relógio anda para o compromisso sumir no horário.
const agora = ref(Date.now())
let relogio = 0
onMounted(() => {
  relogio = window.setInterval(() => { agora.value = Date.now() }, 30_000)
  // Abrir a agenda relê: editar no Google reflete aqui sem esperar outro gesto.
  if (conectado.value) void ag.carregarMochila()
})
onBeforeUnmount(() => window.clearInterval(relogio))

const diaDe = (q: QuestCalendario): Date => {
  if (q.diaInteiro) return diasDoEventoDiaInteiro(q.inicio, q.fim).primeiro
  const d = new Date(q.tipo === 'deadline' ? q.fim : q.inicio)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
const formatoDia = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })

const porDia = computed(() => {
  const hoje = new Date(agora.value)
  const zero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()
  const grupos = new Map<number, QuestCalendario[]>()
  for (const q of proximasQuests(quests.value, agora.value, Number.MAX_SAFE_INTEGER)) {
    // Bloco em andamento de ontem para hoje (raro) cai em hoje.
    const chave = Math.max(diaDe(q).getTime(), zero)
    grupos.set(chave, [...(grupos.get(chave) ?? []), q])
  }
  return [...grupos].map(([t, itens]) => {
    const dias = Math.round((t - zero) / 86_400_000)
    const nome = dias === 0 ? 'Hoje' : dias === 1 ? 'Amanhã' : formatoDia.format(new Date(t))
    return { chave: t, nome, itens }
  })
})
const total = computed(() => quests.value.filter((q) => !questTerminou(q, agora.value)).length)

const desconectar = () => {
  if (window.confirm('Desconectar o Google? O SquadOne para de ler e marcar na agenda até você conectar de novo. O refresh token é revogado no Google.')) {
    void ag.desconectarGoogle()
  }
}
</script>

<template>
  <div class="agenda">
    <header class="agenda__topo">
      <div>
        <h1>Agenda</h1>
        <p class="texto-2">
          <template v-if="squadAtiva">Squad {{ squadAtiva.nome }} · </template>
          <template v-if="conectado">{{ total }} compromisso(s) pela frente, do Google Calendar</template>
          <template v-else>Google Calendar desconectado</template>
        </p>
      </div>
      <button v-if="conectado" type="button" class="botao" :disabled="carregandoMochila" @click="ag.carregarMochila()">
        {{ carregandoMochila ? 'Lendo…' : 'Ler de novo' }}
      </button>
    </header>

    <section class="agenda__conexao" aria-label="Conexão com o Google">
      <p v-if="conectado" class="recado recado--ok">
        Google Calendar conectado.
        <template v-if="tasksLiberado"> Google Tasks autorizado: os passos viram checklist.</template>
        <template v-else> Google Tasks não autorizado: passos e tarefas avulsas ficam de fora.</template>
      </p>
      <p v-else class="recado recado--atencao">Sem conexão com o Google: os agentes ainda rodam o pedido, mas não marcam nada na agenda.</p>
      <div class="acoes">
        <button v-if="!conectado" type="button" class="botao botao--primario" :disabled="conectando" @click="ag.conectarGoogle">
          {{ conectando ? 'Conectando…' : 'Conectar o Google Calendar' }}
        </button>
        <!-- Degradado, não desconectado: o Calendar segue; só os passos não viram
             checklist. Mesmo consentimento, sem logout. -->
        <button v-if="conectado && !tasksLiberado" type="button" class="botao" :disabled="conectando" @click="ampliarAcesso">
          Autorizar o Google Tasks
        </button>
        <button v-if="conectado" type="button" class="botao botao--leve botao--perigo" @click="desconectar">Desconectar o Google</button>
      </div>
    </section>

    <template v-if="conectado">
      <!-- O ajuste aberto aqui aparece aqui (e também em Hoje, entre o que precisa de você). -->
      <section v-if="ajustes.length" class="agenda__ajustes" aria-label="Ajustes esperando aprovação">
        <AjusteCard
          v-for="proposta in ajustes"
          :key="proposta.id"
          :proposta="proposta"
          :squad-nome="proposta.squad_id !== squadAtiva?.id ? ag.nomeDaSquad(proposta.squad_id) : ''"
          :enviando="aprovandoAjuste === proposta.id"
          :erro="erroAjuste[proposta.id] || ''"
          :nao-cabe="!!ajusteNaoCabe[proposta.id]"
          @aprovar="(mover, min) => ag.aprovarAjuste(proposta.id, mover, min)"
          @descartar="ag.tirarAjuste(proposta.id)"
        />
      </section>
      <p v-if="carregandoMochila && !porDia.length" class="texto-2" role="status">Lendo o calendário…</p>
      <p v-else-if="!porDia.length" class="recado">Nada marcado pela frente. Use o ＋ Pedir.</p>
      <section v-for="dia in porDia" :key="dia.chave" class="agenda__dia" :aria-labelledby="`agenda-dia-${dia.chave}`">
        <h2 :id="`agenda-dia-${dia.chave}`">{{ dia.nome }}</h2>
        <ListaDeQuests
          :itens="dia.itens"
          :todas="quests"
          :nomes-de-dominio="nomesDeDominio"
          :nomes-de-pessoa="nomesDePessoa"
          :ajustando="!!aprovandoAjuste"
          @ajustar="ag.abrirAjusteDaQuest"
        />
      </section>
    </template>
  </div>
</template>

<style>
.agenda { display: grid; gap: var(--esp-4); width: 100%; max-width: 56rem; margin: 0 auto; color: var(--texto); }
.agenda__topo { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--esp-3); }
.agenda h1 { margin: 0; font-size: clamp(1.8rem, 8vw, 2.6rem); font-weight: var(--peso-titulo); letter-spacing: -0.03em; }
.agenda p { margin: 0; }
.agenda__conexao, .agenda__ajustes { display: grid; gap: var(--esp-2); }
.agenda__dia { display: grid; gap: var(--esp-2); }
.agenda__dia h2 { margin: 0; font-size: 0.95rem; font-weight: var(--peso-titulo); letter-spacing: 0.05em; text-transform: uppercase; }
.agenda a { color: var(--texto); }
</style>
