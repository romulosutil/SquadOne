<script setup lang="ts">
/**
 * O Escritório no centro da Central de comando (17/10/2026): um andar por vez, em Mapa (padrão,
 * animado) ou Lista (a mesma informação em texto, para leitor de tela e para poupar bateria).
 *
 * Diferente do Escritório completo (/squadone, em Manutenção): sem o seletor de squad que cria e
 * edita, sem contratar nem arquivar. Aqui só se olha. O andar é escolha da Central (central.ts),
 * não a squad ativa da aba, e tocar numa sala abre a operação dela numa folha.
 *
 * O GameMap entra por import assíncrono, mas sem esperar toque: ele começa a carregar quando a
 * Central monta e pinta assim que chega. A Lista não carrega nada disso.
 */
import { computed, defineAsyncComponent, h, ref } from 'vue'
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
}>()
const emit = defineEmits<{ andar: [id: string]; completo: [] }>()

const guardador = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
const vista = ref<VistaDoEscritorio>(vistaInicialDaCentral(lerVistaGuardada(guardador(), CHAVE_DA_VISTA_DA_CENTRAL)))
const escolher = (v: VistaDoEscritorio) => {
  vista.value = v
  gravarVista(guardador(), v, CHAVE_DA_VISTA_DA_CENTRAL)
}

const salaAberta = ref<string | null>(null)
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
  <section class="central__bloco escritorio-vivo" aria-labelledby="central-escritorio">
    <div class="central__cabeca">
      <h2 id="central-escritorio">Escritório</h2>
      <div class="segmentado segmentado--auto" role="group" aria-label="Ver o escritório como">
        <button type="button" :aria-pressed="vista === 'mapa'" @click="escolher('mapa')">Mapa</button>
        <button type="button" :aria-pressed="vista === 'lista'" @click="escolher('lista')">Lista</button>
      </div>
    </div>

    <p v-if="!andar" class="texto-2" role="status">{{ semAndar }}</p>
    <template v-else>
      <!-- O andar: só troca o que a Central mostra, nunca a squad ativa dos pedidos. -->
      <div v-if="squads.length > 1" class="escolhas" role="group" aria-label="Andar (squad)">
        <button v-for="s in squads" :key="s.id" type="button" :aria-pressed="s.id === andar.id" @click="emit('andar', s.id)">{{ s.nome }}</button>
      </div>

      <!-- :key pelo andar: recria useOffice ao trocar, senão as salas do outro andar seriam lidas como crescimento. -->
      <GameMap
        v-if="vista === 'mapa'"
        :key="andar.id"
        :squad="andar"
        :status="status"
        :baloes="baloes"
        :visita="visita"
        compacto
        @abrir-sala="salaAberta = $event"
      />
      <template v-else>
        <p class="escritorio-vivo__status" role="status">{{ status }}</p>
        <ul class="escritorio-vivo__lista">
          <li v-for="s in salas" :key="s.id">
            <button type="button" class="escritorio-vivo__sala" :data-tom="s.balao?.tom" @click="salaAberta = s.id">
              <strong>{{ s.nome }}</strong>
              <span class="texto-2 texto-pequeno">{{ s.po }} · {{ s.pessoas }} pessoa(s)<template v-if="s.visitada"> · o PO da squad foi até lá</template></span>
              <span v-if="s.balao" class="escritorio-vivo__balao">{{ s.balao.texto }}</span>
            </button>
          </li>
        </ul>
      </template>
      <button type="button" class="botao botao--leve escritorio-vivo__completo" @click="emit('completo')">
        Escritório completo: contratar, editar e arquivar
      </button>
    </template>

    <Sheet v-if="dominioAberto && andar" :titulo="`Sala ${dominioAberto.nome}`" :subtitulo="`Squad ${andar.nome}`" @fechar="salaAberta = null">
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
