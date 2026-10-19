<script setup lang="ts">
/**
 * O Escritório no centro da Central de comando (17/10/2026): um andar por vez, em Mapa (padrão,
 * animado) ou Lista (a mesma informação em texto, para leitor de tela e para poupar bateria).
 *
 * Diferente do Escritório completo (/squadone, em Manutenção): sem o seletor de squad que cria e
 * edita, sem contratar nem arquivar. No PRUMO, cada sala tem controle de trabalho. O andar é escolha da Central (central.ts),
 * não a squad ativa da aba; pedidos fazem a troca guardada antes de delegar.
 *
 * O GameMap entra por import assíncrono, mas sem esperar toque: ele começa a carregar quando a
 * Central monta e pinta assim que chega. A Lista não carrega nada disso.
 */
import { computed, defineAsyncComponent, h, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import SalaComando from '../office/SalaComando.vue'
import type { TimeLido } from './hoje'
import { useMovimentoDoEscritorio } from '../office/movimento'
const { animar, alternar: alternarMovimento } = useMovimentoDoEscritorio()
const consultaLarga = window.matchMedia('(min-width: 64rem)')
const largo = ref(consultaLarga.matches)
const mudouLargura = () => { largo.value = consultaLarga.matches }
onMounted(() => consultaLarga.addEventListener('change', mudouLargura))
onBeforeUnmount(() => consultaLarga.removeEventListener('change', mudouLargura))
import type { CrmVisao } from '../operations/types'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import Sheet from '../components/Sheet.vue'
import SalaOperacao from '../components/SalaOperacao.vue'
import { CHAVE_DA_VISTA_DA_CENTRAL, gravarVista, lerVistaGuardada, vistaInicialDaCentral, type VistaDoEscritorio } from '../office/vista'
import type { BalaoDaSala } from '../office/baloes'
import type { OperacaoDaSala } from '../office/operacao'
import type { SquadView } from '../types'
import type { Capacidades } from './destinos'
import { interceptarLink } from './rota'

const GameMap = defineAsyncComponent({
  loader: () => import('../components/GameMap.vue'),
  loadingComponent: { render: () => h('p', { class: 'texto-2 escritorio-vivo__carregando', role: 'status' }, 'Carregando o mapa…') },
  errorComponent: { render: () => h('p', { class: 'recado recado--erro', role: 'alert' }, 'O mapa não carregou. A Lista mostra as mesmas salas.') },
  delay: 150
})

const props = defineProps<{
  squads: SquadView[]
  andar: SquadView | null
  /** Pessoa → balão (baloesDosAtores). */
  baloes: Record<string, BalaoDaSala>
  /** Sala → balão (baloesDasSalas): a Lista mostra por sala. */
  baloesDasSalas: Record<string, BalaoDaSala>
  visita: string | null
  status: string
  operacoes: Record<string, OperacaoDaSala>
  capacidades: Capacidades
  /** Por que não há andar (sem agentes neste processo, roster não lido). */
  semAndar: string
  visao: CrmVisao | null
  erroCrm: string
  fila: AcaoDeVenda[]
  time?: TimeLido | null
}>()
const emit = defineEmits<{ andar: [id: string]; completo: []; registrado: [] }>()

const guardador = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
const vista = ref<VistaDoEscritorio>(vistaInicialDaCentral(lerVistaGuardada(guardador(), CHAVE_DA_VISTA_DA_CENTRAL), typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 64rem)').matches))
const escolher = (v: VistaDoEscritorio) => {
  vista.value = v
  gravarVista(guardador(), v, CHAVE_DA_VISTA_DA_CENTRAL)
}

const salaAberta = ref<string | null>(null)
const conversaSelecionada = ref<{ salaId: string; pessoaId: string; clique: number } | null>(null)
function conversarComAgente(salaId: string, pessoaId: string) {
  conversaSelecionada.value = { salaId, pessoaId, clique: (conversaSelecionada.value?.clique ?? 0) + 1 }
}
const comando = computed(() => props.andar?.dominios.some(d => d.id.startsWith('prumo--')) ?? false)
watch(() => props.andar?.id, () => {
  salaAberta.value = comando.value ? props.andar?.dominios.find(d => d.id === 'prumo--geral')?.id ?? props.andar?.dominios[0]?.id ?? null : null
}, { immediate: true })
async function selecionarSala(id: string) {
  salaAberta.value = id
  if (comando.value) {
    await nextTick()
    document.getElementById('sala-comando-titulo')?.focus({ preventScroll: true })
  }
}
/** A folha fica fora da casca: "Ver no Funil" e o "Como funciona" do robô navegam sem recarregar. */
function aoClicarNaFolha(e: MouseEvent) {
  interceptarLink(e, props.capacidades)
  if (e.defaultPrevented) salaAberta.value = null
}
const dominioAberto = computed(() => props.andar?.dominios.find((d) => d.id === salaAberta.value) ?? null)

const salas = computed(() =>
  (props.andar?.dominios ?? []).map((d) => ({
    id: d.id,
    nome: d.nome,
    po: d.po.nome,
    pessoas: 1 + d.integrantes.length,
    balao: props.baloesDasSalas[d.id] ?? null,
    visitada: props.visita === d.id,
  }))
)
</script>

<template>
  <section id="central-escritorio" class="central__bloco escritorio-vivo" aria-labelledby="escritorio-titulo">
    <div class="central__cabeca">
      <slot name="cabecalho"><div><h2 id="escritorio-titulo">Escritório</h2><p class="texto-2 texto-pequeno">Selecione uma sala para acompanhar, decidir e delegar.</p></div></slot>
      <details class="escritorio-vivo__visualizacao" :open="largo">
      <summary>Visualização</summary>
      <div class="segmentado segmentado--auto" role="group" aria-label="Vista e movimento do escritório">
        <button type="button" :aria-pressed="vista === 'mapa'" @click="escolher('mapa')">Mapa</button>
        <button type="button" :aria-pressed="vista === 'lista'" @click="escolher('lista')">Lista</button>
        <button type="button" :aria-pressed="animar" :aria-label="animar ? 'Pausar animação dos sprites' : 'Animar sprites'" @click="alternarMovimento">{{ animar ? 'Pausar sprites' : 'Animar sprites' }}</button>
      </div>
      </details>
    </div>

    <p v-if="!andar" class="texto-2" role="status">{{ semAndar }}</p>
    <template v-else>
      <!-- O andar: só troca o que a Central mostra, nunca a squad ativa dos pedidos. -->
      <div class="escritorio-vivo__navegacao"><label v-if="squads.length > 1" class="escritorio-vivo__contexto rotulo-contexto">Escritório
        <select :value="andar.id" @change="emit('andar', ($event.target as HTMLSelectElement).value)"><option v-for="s in squads" :key="s.id" :value="s.id">{{ s.nome }}</option></select>
      </label>

      <label v-if="comando" class="escritorio-vivo__contexto rotulo-contexto escritorio-vivo__contexto--sala">Sala
        <select :value="salaAberta" @change="selecionarSala(($event.target as HTMLSelectElement).value)"><option v-for="s in salas" :key="s.id" :value="s.id">{{ s.nome }}</option></select>
      </label></div>
      <div class="escritorio-vivo__estacoes" :class="{ 'escritorio-vivo__estacoes--comando': comando && vista === 'mapa' }">
      <div v-if="vista === 'mapa' || !comando" class="escritorio-vivo__mapa">
      <!-- :key pelo andar: recria useOffice ao trocar, senão as salas do outro andar seriam lidas como crescimento. -->
      <GameMap
        v-if="vista === 'mapa'"
        :key="andar.id"
        :squad="andar"
        :status="status"
        :baloes="baloes"
        :visita="visita"
        :sala-selecionada="comando ? salaAberta : null"
        :compacto="false"
        @abrir-sala="selecionarSala"
        @abrir-agente="conversarComAgente"
      />
      <template v-else>
        <p class="escritorio-vivo__status" role="status">{{ status }}</p>
        <ul class="escritorio-vivo__lista">
          <li v-for="s in salas" :key="s.id">
            <button type="button" class="escritorio-vivo__sala" :data-tom="s.balao?.tom" :aria-pressed="comando ? salaAberta === s.id : undefined" @click="selecionarSala(s.id)">
              <strong>{{ s.nome }}</strong>
              <span class="texto-2 texto-pequeno">{{ s.po }} · {{ s.pessoas }} pessoa(s)<template v-if="s.visitada"> · o PO da squad foi até lá</template></span>
              <span v-if="s.balao" class="escritorio-vivo__balao">{{ s.balao.texto }}</span>
            </button>
          </li>
        </ul>
      </template>
      </div>
      <KeepAlive v-if="comando" :max="12">
        <SalaComando v-if="dominioAberto" :key="dominioAberto.id" :sala="dominioAberto" :squad="andar" :time="time" :conversar="conversaSelecionada?.salaId === dominioAberto.id ? conversaSelecionada : null" :visao="visao" :erro="erroCrm" :fila="fila" :operacao="operacoes[dominioAberto.id]" @registrado="emit('registrado')" />
      </KeepAlive>
      </div>

    </template>

    <slot name="apoio" />

    <Sheet v-if="!comando && dominioAberto && andar" :titulo="`Sala ${dominioAberto.nome}`" :subtitulo="`Squad ${andar.nome}`" @fechar="salaAberta = null">
      <div class="bloco" @click="aoClicarNaFolha">
        <p><strong>{{ dominioAberto.po.nome }}</strong> <span class="texto-2">· {{ dominioAberto.po.papel }}</span></p>
        <ul v-if="dominioAberto.integrantes.length" class="escritorio-vivo__pessoas">
          <li v-for="p in dominioAberto.integrantes" :key="p.id">{{ p.nome }} <span class="texto-2">· {{ p.papel }}</span></li>
        </ul>
        <p v-if="baloesDasSalas[dominioAberto.id]" class="recado" :class="{ 'recado--erro': baloesDasSalas[dominioAberto.id].tom === 'vermelho', 'recado--atencao': baloesDasSalas[dominioAberto.id].tom === 'amarelo' || baloesDasSalas[dominioAberto.id].tom === 'laranja' }">
          {{ baloesDasSalas[dominioAberto.id].texto }}
        </p>
        <SalaOperacao v-if="operacoes[dominioAberto.id]" :operacao="operacoes[dominioAberto.id]" :nome-da-sala="dominioAberto.nome" />
      </div>
    </Sheet>
  </section>
</template>

<style>
.escritorio-vivo.central__bloco { display: grid; min-width: 0; padding: var(--esp-3); gap: var(--esp-4); background: var(--superficie); border-radius: var(--raio-bloco); }
.escritorio-vivo .central__cabeca { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-3); }
.escritorio-vivo__visualizacao > summary { cursor: pointer; min-height: var(--toque); align-content: center; font-size: var(--tam-apoio); }
@media (min-width: 64rem) { .escritorio-vivo__visualizacao > summary { display: none; } }
.escritorio-vivo__navegacao { display: flex; flex-wrap: wrap; gap: var(--esp-3); }
.escritorio-vivo__contexto { min-width: 0; display: grid; gap: var(--esp-2); }
.escritorio-vivo__contexto select { min-width: 0; max-width: 100%; min-height: var(--toque); padding: var(--esp-1) var(--esp-3); border: var(--linha-fina); border-radius: var(--raio-controle); background: var(--superficie); color: var(--texto); font: inherit; font-weight: var(--peso-forte); }
.escritorio-vivo .central__topo { flex: 1; min-width: 0; }
.escritorio-vivo__apoio[open] { display: grid; gap: var(--esp-3); }
.escritorio-vivo .office-viewport { height: 22rem; }
.escritorio-vivo__estacoes { display: grid; gap: var(--esp-4); min-width: 0; align-items: start; }
.escritorio-vivo__mapa { display: grid; gap: var(--esp-3); min-width: 0; }
.escritorio-vivo .escritorio-vivo__salas { gap: var(--esp-2); display: flex; flex-wrap: nowrap; overflow-x: auto; padding-bottom: var(--esp-2); scroll-snap-type: x proximity; }
.escritorio-vivo .escritorio-vivo__salas button { display: grid; gap: var(--esp-0); flex: 0 0 auto; font-size: var(--tam-apoio); border-radius: var(--raio-controle); text-align: left; scroll-snap-align: start; }
.escritorio-vivo .escritorio-vivo__salas button span { font-size: var(--tam-mini); font-weight: var(--peso-medio); }
.escritorio-vivo .sala-comando { padding-top: var(--esp-3); border-top: var(--linha-fina); }
@media (max-width: 63.99rem) {
  .escritorio-vivo__navegacao { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.8fr); gap: var(--esp-2); }
  .escritorio-vivo__contexto { display: grid; gap: var(--esp-1); }
  .escritorio-vivo__contexto select { width: 100%; }
  .escritorio-vivo__contexto:only-child { grid-column: 1 / -1; }
  .escritorio-vivo .central__cabeca { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--esp-1); }
  .escritorio-vivo .central__topo { display: contents; }
  .escritorio-vivo .central__titulo { grid-column: 1 / -1; }
  .escritorio-vivo .escritorio-vivo__andares { flex-wrap: nowrap; overflow-x: auto; }
  .escritorio-vivo .escritorio-vivo__andares button { flex: 0 0 auto; padding-inline: var(--esp-3); }
  .escritorio-vivo { padding: var(--esp-3); }
  .escritorio-vivo__estacoes--comando .escritorio-vivo__mapa { order: 2; }
  .escritorio-vivo .sala-comando > .segmentado { position: static; background: var(--superficie); }
  .escritorio-vivo .mapa--compacto .office-viewport { height: 16rem; }
}
@media (min-width: 80rem) {
  .escritorio-vivo__estacoes--comando { grid-template-columns: minmax(0, .85fr) minmax(24rem, 1.4fr); }
  .escritorio-vivo .sala-comando { padding: 0 var(--esp-2) var(--esp-3) var(--esp-4); border-top: 0; border-left: var(--linha-fina); height: auto; max-height: none; min-height: 0; overflow: visible; grid-auto-rows: max-content; }
}
.escritorio-vivo__carregando { min-height: clamp(16rem, 48dvh, 26rem); }
.escritorio-vivo__status { margin: 0; font-weight: var(--peso-forte); }
.escritorio-vivo__lista { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.escritorio-vivo__sala {
  display: grid;
  width: 100%;
  min-height: var(--toque);
  gap: var(--esp-0);
  padding: var(--esp-2) var(--esp-3);
  border: 0;
  border-radius: var(--raio-controle);
  background: var(--superficie-2);
  box-shadow: inset var(--faixa) 0 0 var(--borda);
  color: var(--texto);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.escritorio-vivo__sala:hover { background: var(--hover); }
/* A faixa da esquerda repete o tom do balão do mapa; a palavra está no texto. */
.escritorio-vivo__sala[data-tom='verde'] { box-shadow: inset var(--faixa) 0 0 var(--positivo); }
.escritorio-vivo__sala[data-tom='amarelo'],
.escritorio-vivo__sala[data-tom='laranja'] { box-shadow: inset var(--faixa) 0 0 var(--destaque); }
.escritorio-vivo__sala[data-tom='vermelho'] { box-shadow: inset var(--faixa) 0 0 var(--negativo); background: var(--erro-fundo); }
.escritorio-vivo__balao { font-weight: var(--peso-medio); overflow-wrap: anywhere; }
.escritorio-vivo__pessoas { display: grid; gap: var(--esp-1); margin: 0; padding: 0; list-style: none; }
.escritorio-vivo__completo { justify-self: start; }
</style>
