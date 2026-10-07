<script setup lang="ts">
/**
 * Escritório isométrico — spec §4.1 (tiles), §4.2 (movimento), §4.3 (pathfinding).
 *
 * O personagem NÃO vive no CSS Grid. Ele é position:absolute dentro de .world
 * e é movido por translate3d escrito direto no style pelo loop de useOffice.
 * A versão anterior usava `transition: grid-column-start`, que não anima —
 * teleporta (medido no navegador: getAnimations() == [] e 1 valor único em 700ms).
 *
 * Duas camadas: `.ground` leva a matriz isométrica e desenha os losangos de
 * chão; `.objects` fica sem skew e recebe paredes, props e atores já projetados,
 * ordenados por z-index = diagonal do mundo (algoritmo do pintor).
 *
 * O mapa vem do roster em ÁRVORE (§3.1): UMA SALA POR DOMÍNIO, com o PO e os
 * integrantes dele dentro. Nada aqui deriva sala de pessoa.
 *
 * Uma instância por SQUAD (um andar por vez): o Escritório monta com
 * `:key="squadAtiva.id"`, e só quando o Mapa está aberto (import assíncrono).
 * Trocar de squad recria o componente, e com ele o `knownRooms` de useOffice —
 * sem isso as salas da outra squad seriam lidas como crescimento e animariam.
 *
 * Toque: cada personagem tem um botão de 44×44 px de TELA (dividido pela
 * escala) que abre a sala dele. O estado de cada um vai no nome acessível, em
 * texto (`estados`, só com fonte; `Sem sinal` quando não há).
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch, watchEffect } from 'vue'
import { ESCALA_MAXIMA, escalaInteira } from '../office/vista'
import type { EstadoDaPessoa } from '../casca/hoje'
import {
  useOffice,
  type CharSheet,
  type OfficeDominio,
  type OfficePessoa,
  type RoomPhase,
} from '../office/useOffice'
import {
  ISO_MATRIX,
  ROOM_TEMPLATES,
  TILE,
  WALL_H,
  WALL_MATRIX_X,
  WALL_MATRIX_Y,
  type RoomId,
} from '../office/rooms'
import { PE_DO_PROP, PROP_SPRITE, VIES_Z } from '../office/pixelProps'
import type { EstadoDoAgente } from '../office/salaFinancas'
import type { Pessoa, SquadView } from '../types'

const props = defineProps<{
  agent?: string
  squad?: SquadView | null
  /** Estado de cada pessoa, em texto. Quem não está aqui é `Sem sinal`. */
  estados?: Record<string, { estado: EstadoDaPessoa; texto: string }>
  /** Uma frase sobre o andar agora ("Pedido em andamento", "Último pedido: Ana"). */
  status?: string
  /**
   * Domínio → estado que o PO da sala mostra num balão sempre visível (hoje
   * só a Sala Finanças: % do cartão e do orçamento, ver
   * `office/salaFinancas.ts`). Dado da tela, não do roster.
   */
  estadosDasSalas?: Record<string, EstadoDoAgente>
}>()

const emit = defineEmits<{ abrirSala: [dominioId: string] }>()

/** Pessoa → balão: o estado de uma sala é do agente que responde por ela, o PO. */
const estadoDoAtor = computed<Record<string, EstadoDoAgente>>(() => {
  const estados = props.estadosDasSalas ?? {}
  return Object.fromEntries((props.squad?.dominios ?? []).filter((d) => estados[d.id]).map((d) => [d.po.id, estados[d.id]]))
})

/** 3 personagens no pacote CraftPix para N papéis: o resto reusa com hue (§5.3). */
const SPRITE_POOL = ['wraith_01', 'wraith_02', 'wraith_03']
const HUE_POOL = [0, 150, 45, 280, 200, 320]

const EMOJI_POR_PAPEL: { re: RegExp; emoji: string }[] = [
  { re: /\bpo\b|product|produto/i, emoji: '🧑‍💼' },
  { re: /tech|dev|eng/i, emoji: '🧑‍💻' },
  { re: /design/i, emoji: '🧑‍🎨' },
  { re: /qa|test/i, emoji: '🕵️' },
  { re: /dados|data|analy/i, emoji: '🧑‍🔬' },
]

function emojiDe(papel: string): string {
  return EMOJI_POR_PAPEL.find((e) => e.re.test(papel))?.emoji ?? '🧑'
}

function roomIdDe(room: string): RoomId {
  return (room in ROOM_TEMPLATES ? room : 'ROOM_EMPTY') as RoomId
}

/**
 * Espelho do manifest do CraftPix. `sheets` nasce DENTRO de useOffice, que por
 * sua vez já precisa de `dominios` pronto — ler `sheets` direto no computed
 * abaixo seria um ciclo. O espelho quebra o ciclo e mantém a reatividade: o
 * computed re-avalia sozinho quando o fetch do manifest resolve.
 */
const manifest = shallowRef<Record<string, CharSheet> | null>(null)

/**
 * Árvore -> vista. A pessoa carrega só aparência; slot e sala são do domínio.
 * `ordem` é um contador global só para distribuir sprites/hue entre quem não
 * trouxe os seus do roster — não tem significado no modelo.
 *
 * O sprite do roster só é honrado se existir em `chars`: um nome morto (roster
 * de uma versão antiga) viraria sheet null e cairia no emoji em silêncio.
 * Quem cai no pool por sprite inválido ganha hue como qualquer outro do pool.
 * Sem manifest carregado não há o que validar — aí o emoji é o certo.
 */
function paraOfficePessoa(
  p: Pessoa,
  ordem: number,
  chars: Record<string, CharSheet> | null
): OfficePessoa {
  const proprio = p.sprite && (!chars || chars[p.sprite]) ? p.sprite : ''
  return {
    id: p.id,
    nome: p.nome,
    papel: p.papel,
    sprite: proprio || SPRITE_POOL[ordem % SPRITE_POOL.length],
    hue: p.hue ?? (proprio ? undefined : HUE_POOL[Math.floor(ordem / SPRITE_POOL.length) % HUE_POOL.length]),
    emoji: emojiDe(p.papel),
  }
}

const dominios = computed<OfficeDominio[]>(() => {
  const chars = manifest.value
  let ordem = 0
  return (props.squad?.dominios ?? []).map((d) => ({
    id: d.id,
    nome: d.nome,
    slot: d.slot,
    room: roomIdDe(d.room),
    // PO primeiro: a ordem define qual cadeira cada um ocupa na sala.
    pessoas: [d.po, ...d.integrantes].map((p) => paraOfficePessoa(p, ordem++, chars)),
  }))
})

const { setViewportEl, setWorldEl, scale, sheets, pessoas, rooms, bounds, setActorEl, moveTo, pausado } =
  useOffice(dominios)

/** Sala de cada pessoa: o toque no personagem abre a sala, não a pessoa. */
const salaDe = computed(() => {
  const mapa = new Map<string, { id: string; nome: string }>()
  for (const d of dominios.value) for (const p of d.pessoas) mapa.set(p.id, { id: d.id, nome: d.nome })
  return mapa
})

const rotuloDoAtor = (p: OfficePessoa) => {
  const sala = salaDe.value.get(p.id)
  const estado = props.estados?.[p.id]?.texto ?? 'Sem sinal'
  return `${p.nome}, ${p.papel}${sala ? `, sala ${sala.nome}` : ''}. ${estado}. Abrir a sala.`
}

// ---------------------------------------------------------------- escala

/** Tamanho do viewport em px de tela, medido por ResizeObserver. */
const caixa = ref({ w: 0, h: 0 })
let roCaixa: ResizeObserver | null = null
function ligarViewport(el: unknown) {
  setViewportEl(el)
  roCaixa?.disconnect()
  roCaixa = null
  const no = el as HTMLElement | null
  if (!no || typeof ResizeObserver === 'undefined') return
  roCaixa = new ResizeObserver(() => {
    caixa.value = { w: no.clientWidth, h: no.clientHeight }
  })
  roCaixa.observe(no)
}
onBeforeUnmount(() => roCaixa?.disconnect())

/** null = encaixe automático (a maior escala inteira em que o andar cabe). */
const zoom = ref<number | null>(null)
const encaixe = computed(() =>
  escalaInteira(caixa.value, { w: bounds.value.maxX - bounds.value.minX, h: bounds.value.maxY - bounds.value.minY })
)
watchEffect(() => {
  scale.value = zoom.value ?? encaixe.value
})
const aproximar = () => { zoom.value = Math.min(ESCALA_MAXIMA, scale.value + 1) }
const afastar = () => { zoom.value = Math.max(1, scale.value - 1) }
const encaixar = () => { zoom.value = null }

// Só aqui `sheets` existe: liga o espelho. Imediato para nascer em sincronia.
watch(sheets, (chars) => (manifest.value = chars), { immediate: true })

/** Tile livre no miolo de todas as salas — onde o PO raiz para ao visitar. */
const VISIT_TILE: [number, number] = [4, 3]

/** O PO raiz é o dono do primeiro domínio: é ele quem circula pelo escritório. */
const poRaiz = computed(() => props.squad?.dominios[0]?.po.id ?? null)

/**
 * `agent` é o id de uma PESSOA (responsavel_id do turno). Quem anda é o PO
 * raiz, até a SALA DO DOMÍNIO dessa pessoa — visitar alguém é ir ao domínio
 * dele, não a uma coordenada pessoal.
 */
/**
 * Só a troca de AGENTE move o PO raiz. O roster também entra no watch porque
 * o primeiro carregamento precisa posicionar a câmera — mas uma contratação
 * (§4.4) não pode puxar a câmera de volta para a sala do PO no meio da
 * animação de entrada do recém-chegado.
 */
watch(
  [() => props.agent, dominios],
  ([agent], anterior) => {
    const [agentAnterior, domAnterior] = anterior ?? [undefined, [] as OfficeDominio[]]
    const raiz = poRaiz.value
    if (!raiz || !dominios.value.length) return
    const rosterChegou = !domAnterior?.length
    if (!rosterChegou && agent === agentAnterior) return
    const destino = dominios.value.find((d) => d.pessoas.some((p) => p.id === agent))
    if (destino && destino.id !== dominios.value[0].id) moveTo(raiz, destino.slot, VISIT_TILE)
    else moveTo(raiz, dominios.value[0].slot) // Idle ou próprio domínio: volta pra mesa
  },
  { immediate: true }
)

const worldBox = computed(() => ({
  width: bounds.value.maxX - bounds.value.minX + 'px',
  height: bounds.value.maxY - bounds.value.minY + 'px',
  // O botão de toque divide por isto para ter 44 px na TELA em qualquer escala.
  '--escala': String(scale.value),
}))

function sheetOf(p: OfficePessoa) {
  return sheets.value?.[p.sprite] ?? null
}

/** Strip horizontal: uma linha, N frames de frameW. */
function stripStyle(p: OfficePessoa, anim: 'idle' | 'walk') {
  const sheet = sheetOf(p)
  const a = sheet?.anims?.[anim]
  if (!sheet || !a) return {}
  const base: Record<string, string> = {
    backgroundImage: `url(${a.file})`,
    backgroundSize: `${a.frames * sheet.frameW}px ${sheet.frameH}px`,
    width: `${sheet.frameW}px`,
    height: `${sheet.frameH}px`,
  }
  if (anim === 'idle') {
    // Ciclo parado em CSS puro: nenhum frame de rAF é gasto com quem não anda.
    base['--strip-end'] = `${-a.frames * sheet.frameW}px`
    base.animation = `strip 1.4s steps(${a.frames}) infinite`
  }
  return base
}

/**
 * Crescimento do escritório (§4.4). 'pending' = o slot já conta para o mapa
 * (a câmera precisa poder enquadrá-lo) mas nada aparece; 'building' toca
 * `room-build`. Sem fase, a sala é só uma sala. 'closing' toca room-build ao
 * contrário: a sala de um domínio arquivado some no lugar em que estava.
 */
function faseClasse(room: { phase: RoomPhase }) {
  return {
    'room--pending': room.phase === 'pending',
    'room--new': room.phase === 'building',
    'room--closing': room.phase === 'closing',
  }
}

function actorStyle(p: OfficePessoa) {
  const sheet = sheetOf(p)
  return {
    width: `${sheet ? sheet.frameW : TILE}px`,
    height: `${sheet ? sheet.frameH : TILE}px`,
    filter: p.hue ? `hue-rotate(${p.hue}deg)` : undefined,
  }
}
</script>

<template>
  <section class="mapa" :aria-label="`Mapa do escritório de ${squad?.nome ?? 'squad'}`">
    <div class="mapa__barra">
      <p class="mapa__status" role="status">{{ status || 'Aguardando pedidos' }}<template v-if="pausado"> · animação pausada (mapa fora de vista)</template></p>
      <div class="mapa__zoom" role="group" aria-label="Escala do mapa">
        <button type="button" class="botao botao--leve" :disabled="scale <= 1" @click="afastar">Afastar</button>
        <span class="mapa__escala">Escala {{ scale }}x{{ zoom === null ? ' (encaixe)' : '' }}</span>
        <button type="button" class="botao botao--leve" :disabled="scale >= ESCALA_MAXIMA" @click="aproximar">Aproximar</button>
        <button v-if="zoom !== null" type="button" class="botao botao--leve" @click="encaixar">Encaixar</button>
      </div>
    </div>

    <!-- Viewport: recorta o mundo. A câmera é o transform de .world. -->
    <div :ref="ligarViewport" class="office-viewport" :class="{ 'office--pausado': pausado }">
      <!-- SCALE aparece em UM lugar: este transform (escrito por useOffice). -->
      <div :ref="setWorldEl" class="office-world" :style="worldBox">
        <!-- Chão: retângulos em coordenadas de mundo, projetados pela matriz. -->
        <div class="ground" :style="{ transform: ISO_MATRIX }">
          <div
            v-for="room in rooms"
            :key="room.key + '-base'"
            class="base"
            :class="faseClasse(room)"
            :style="{
              left: room.base.left + 'px',
              top: room.base.top + 'px',
              width: room.base.width + 'px',
              height: room.base.height + 'px',
            }"
          ></div>
          <!-- `data-tapete` só varia a cor do tapete entre salas vizinhas; sai do
               slot, então a mesma sala tem sempre o mesmo tapete. -->
          <div
            v-for="room in rooms"
            :key="room.key + '-floor'"
            class="floor"
            :class="faseClasse(room)"
            :data-tapete="(room.slot[0] + 2 * room.slot[1]) % 3"
            :style="{
              left: room.floor.left + 'px',
              top: room.floor.top + 'px',
              width: room.floor.width + 'px',
              height: room.floor.height + 'px',
            }"
          ></div>
        </div>

        <!-- Objetos: já projetados, ordenados por diagonal do mundo. -->
        <div class="objects">
          <!-- Um wrapper por sala para que paredes, props e placa materializem
               JUNTOS com o chão. O wrapper é estático e sem filtro fora da
               animação: não cria contexto de empilhamento e o z-index de cada
               objeto continua valendo contra `.objects` (painter's algorithm). -->
          <div v-for="room in rooms" :key="room.key" class="room-objects" :class="faseClasse(room)">
            <!-- Paredes de trás, um tile por div: o vão da porta é o tile ausente. -->
            <div
              v-for="w in room.walls"
              :key="w.key"
              class="wall"
              :class="`wall--${w.axis}`"
              :style="{
                left: w.left + 'px',
                top: w.top + 'px',
                width: w.len + 'px',
                height: WALL_H + 'px',
                zIndex: w.z,
                transform: w.axis === 'x' ? WALL_MATRIX_X : WALL_MATRIX_Y,
              }"
            ></div>

            <div
              v-for="(p, i) in room.props"
              :key="room.key + '-p' + i"
              class="prop"
              :style="{
                left: p.left + 'px',
                top: p.top + 'px',
                width: p.width + 'px',
                height: p.height + 'px',
                zIndex: p.z + (VIES_Z[p.kind] ?? 0),
              }"
            >
              <img
                class="prop__sprite"
                :src="PROP_SPRITE[p.kind]"
                :width="p.width"
                :height="p.height + PE_DO_PROP"
                alt=""
                draggable="false"
              />
            </div>

            <!-- A placa é do DOMÍNIO: a sala inteira pertence a ele. -->
            <span
              class="room__label"
              :style="{ left: room.label.left + 'px', top: room.label.top + 'px' }"
              >{{ room.label.text }}</span
            >
          </div>

          <!-- Atores: billboards, movidos por translate3d direto no style.
               Nada de :class aqui: useOffice escreve `actor--walk`/`actor--focus`
               por classList e o patch de class do Vue apagaria as duas. O estado
               que vem do componente entra por data-attribute. -->
          <div
            v-for="p in pessoas"
            :key="p.id"
            :ref="(el) => setActorEl(p.id, el)"
            class="actor"
            :data-ativo="p.id === props.agent ? 'true' : undefined"
            :style="actorStyle(p)"
          >
            <div class="actor__shadow"></div>
            <!-- Área de toque do corpo: o ator inteiro tem a caixa do frame, com
                 muito vazio transparente em volta, e segue sem eventos. O botão
                 tem 44×44 px de tela e abre a sala de quem foi tocado. -->
            <button
              type="button"
              class="actor__hit"
              :aria-label="rotuloDoAtor(p)"
              @click="salaDe.get(p.id) && emit('abrirSala', salaDe.get(p.id)!.id)"
            ></button>
            <div data-billboard class="actor__billboard">
              <template v-if="sheetOf(p)">
                <div class="actor__strip actor__strip--idle" :style="stripStyle(p, 'idle')"></div>
                <div data-walk class="actor__strip actor__strip--walk" :style="stripStyle(p, 'walk')"></div>
              </template>
              <div v-else class="actor__emoji">{{ p.emoji }}</div>
            </div>
            <span class="actor__name" aria-hidden="true">{{ p.nome }} · {{ p.papel }}</span>
            <span v-if="estadoDoAtor[p.id]" class="actor__estado" :data-semaforo="estadoDoAtor[p.id].semaforo">{{ estadoDoAtor[p.id].texto }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mapa {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border: var(--linha);
  background: #8cb07a;
  box-shadow: var(--sombra);
}
.mapa__barra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--esp-2);
  padding: var(--esp-2) var(--esp-3);
  border-bottom: var(--linha);
  background: var(--superficie);
  color: var(--texto);
}
.mapa__status { margin: 0; font-weight: 900; overflow-wrap: anywhere; }
.mapa__zoom { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); }
.mapa__escala { font-size: 0.8rem; font-weight: 800; font-variant-numeric: tabular-nums; }

.office-viewport {
  position: relative;
  height: min(62dvh, 40rem);
  min-height: 18rem;
  overflow: hidden;
  background: #20283a;
}

/* Fora da tela ou com a aba no fundo: nem os ciclos parados em CSS gastam. */
/* !important: o ciclo idle vem no style inline, e o shorthand dele diz `running`. */
.office--pausado .actor__strip,
.office--pausado .actor__emoji {
  animation-play-state: paused !important;
}

@media (prefers-reduced-motion: reduce) {
  .actor__strip--idle,
  .actor__emoji {
    animation: none !important;
  }
}

.office-world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.ground,
.objects {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}

.base {
  position: absolute;
  background-color: #2a3448;
}

/*
 * Chão em coordenadas de MUNDO: tudo aqui é retângulo e a matriz da `.ground`
 * transforma em losango. Por isso o xadrez é um conic-gradient de 64px (2
 * tiles) e a sombra de canto é um degrau reto — projetados, viram ladrilho
 * isométrico e rodapé sem nenhuma conta de ângulo.
 */
.floor {
  position: absolute;
  background-color: #eadfc8;
  background-image:
    /* sombra dura junto das paredes de trás (norte e oeste) */
    linear-gradient(to bottom, rgba(20, 22, 31, 0.22) 5px, transparent 5px),
    linear-gradient(to right, rgba(20, 22, 31, 0.16) 5px, transparent 5px),
    /* rejunte */
    linear-gradient(to right, rgba(0, 0, 0, 0.1) 2px, transparent 2px),
    linear-gradient(to bottom, rgba(0, 0, 0, 0.1) 2px, transparent 2px),
    /* xadrez de 2 tons */
    conic-gradient(#dccdaf 25%, transparent 0 50%, #dccdaf 0 75%, transparent 0);
  background-size: 100% 100%, 100% 100%, 32px 32px, 32px 32px, 64px 64px;
  box-shadow: inset 0 0 0 2px #000;
}

/* Tapete no miolo (x 2..5, y 2..3): é chão, não prop — fica sempre sob os
   atores e não entra no pintor. Some e aparece junto com o chão na obra. */
.floor::after {
  content: '';
  position: absolute;
  inset: 32px;
  background-color: var(--tapete, #e58a6e);
  background-image: repeating-linear-gradient(
    to right,
    transparent 0 12px,
    rgba(255, 255, 255, 0.18) 12px 16px
  );
  box-shadow:
    0 0 0 2px #14161f,
    inset 0 0 0 3px var(--tapete, #e58a6e),
    inset 0 0 0 5px rgba(255, 255, 255, 0.55);
}
.floor[data-tapete='1']::after {
  --tapete: #5fb3ab;
}
.floor[data-tapete='2']::after {
  --tapete: #e0b44c;
}

/*
 * Parede: faixas horizontais na face (a matriz só cisalha em Y, então as
 * faixas continuam paralelas ao chão). De cima para baixo: aresta preta, fio
 * de luz, painel, frisa, lambri mais escuro e rodapé. As duas faces usam as
 * mesmas faixas com tons diferentes, a leste pegando mais luz que a oeste.
 */
.wall {
  --parede-luz: #5a6a8e;
  --parede: #3d4a63;
  --parede-frisa: #2a3448;
  --parede-lambri: #354157;
  --parede-rodape: #1a202d;
  position: absolute;
  transform-origin: 0 0;
  background-color: var(--parede);
  background-image: linear-gradient(
    to bottom,
    var(--parede-luz) 0 3px,
    transparent 3px calc(100% - 17px),
    var(--parede-frisa) calc(100% - 17px) calc(100% - 15px),
    var(--parede-lambri) calc(100% - 15px) calc(100% - 5px),
    var(--parede-rodape) calc(100% - 5px)
  );
  border-top: 3px solid #000;
  /* junta entre placas: um tile por div, então a junta sai de graça */
  box-shadow: inset 1px 0 0 rgba(0, 0, 0, 0.28);
}
.wall--y {
  --parede-luz: #3f4c68;
  --parede: #2a3448;
  --parede-frisa: #1c2433;
  --parede-lambri: #242d3f;
  --parede-rodape: #12161f;
}

.prop {
  position: absolute;
  pointer-events: none;
}
/* O desenho desce meio losango abaixo da caixa (PE_DO_PROP): overflow visível. */
.prop__sprite {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  max-width: none;
  image-rendering: pixelated;
  user-select: none;
}

/* Plaquinha de porta: creme, borda de 2px e sombra dura, como os cards da UI.
   Sobe 6px além da âncora: a cadeira (1,2) fica logo abaixo do canto da sala,
   e sem a folga o rótulo de quem senta nela some atrás da placa (que está
   acima de todo ator). Mais que isso a placa sai do topo do mapa em 2x. */
.room__label {
  position: absolute;
  z-index: 100000;
  transform: translate(-50%, -6px);
  font-size: 9px;
  line-height: 1;
  font-weight: 900;
  letter-spacing: 0.04em;
  white-space: nowrap;
  text-transform: uppercase;
  color: #000;
  background: #f4f0e6;
  border: 2px solid #000;
  box-shadow: 2px 2px 0 #000;
  padding: 2px 5px 3px;
  pointer-events: none;
}

.actor {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
  pointer-events: none;
}

/*
 * Em hover o ator sobe acima de tudo (placas incluídas) para o rótulo não ficar
 * embaixo de quem está na frente. Só em hover: foco e ativo ficam na
 * profundidade do pintor, senão atravessariam mesas e paredes enquanto andam.
 * `!important` porque o z-index de profundidade é escrito no style pelo loop.
 */
.actor:hover,
.actor:focus-within {
  z-index: 100001 !important;
}

/* 44×44 px de TELA em qualquer escala (o mundo é escalado inteiro). */
.actor__hit {
  --lado: calc(44px / var(--escala, 1));
  position: absolute;
  left: 50%;
  bottom: 0;
  width: var(--lado);
  height: var(--lado);
  margin-left: calc(var(--lado) / -2);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}
.actor__hit:focus-visible {
  outline: calc(3px / var(--escala, 1)) solid #ffd23f;
  outline-offset: 0;
}

/* Elipse em degraus de 2px: um radial-gradient sairia com borda borrada. */
.actor__shadow {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 32px;
  height: 12px;
  margin-left: -16px;
  --sombra: linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3));
  background:
    var(--sombra) 8px 0 / 16px 2px no-repeat,
    var(--sombra) 2px 2px / 28px 2px no-repeat,
    var(--sombra) 0 4px / 32px 4px no-repeat,
    var(--sombra) 2px 8px / 28px 2px no-repeat,
    var(--sombra) 8px 10px / 16px 2px no-repeat;
}

.actor__billboard {
  position: absolute;
  inset: 0;
  transform-origin: 50% 100%;
}

.actor__strip {
  position: absolute;
  left: 0;
  bottom: 0;
  background-repeat: no-repeat;
  background-position: 0 0;
}
.actor__strip--walk {
  display: none;
}
.actor--walk .actor__strip--walk {
  display: block;
}
.actor--walk .actor__strip--idle {
  display: none;
}

.actor__emoji {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  line-height: 1;
  animation: emoji-idle 0.9s steps(2) infinite;
}
.actor--walk .actor__emoji {
  animation: emoji-walk 0.35s steps(2) infinite;
}

/*
 * Rótulo escondido por padrão: com cinco pessoas numa sala os rótulos fixos
 * se empilhavam e nenhum era legível. Aparece em três casos — hover, foco da
 * câmera (`actor--focus`, ligado por useOffice) e o agente ativo da demanda
 * (`data-ativo`, do GameMap). visibility em vez de v-if: o nó continua lá e a
 * troca não re-renderiza nada.
 */
.actor__name {
  position: absolute;
  left: 50%;
  top: -14px;
  transform: translateX(-50%);
  font-size: 8px;
  line-height: 1;
  font-weight: 900;
  white-space: nowrap;
  color: #000;
  background: #fff;
  border: 2px solid #000;
  box-shadow: 2px 2px 0 #000;
  padding: 1px 3px 2px;
  pointer-events: none;
  visibility: hidden;
}
.actor:hover .actor__name,
.actor:focus-within .actor__name,
.actor--focus .actor__name,
.actor[data-ativo] .actor__name {
  visibility: visible;
}
/* Balão de estado (Sala Finanças): sempre visível, acima da plaquinha do nome.
   A borda esquerda é o semáforo; o texto já diz a %, então a cor nunca é a
   única pista. Cores fixas como o resto do mapa (o mapa não segue o tema). */
.actor__estado {
  position: absolute;
  left: 50%;
  top: -30px;
  transform: translateX(-50%);
  font-size: 8px;
  line-height: 1;
  font-weight: 900;
  white-space: nowrap;
  color: #000;
  background: #f4f0e6;
  border: 2px solid #000;
  border-left-width: 6px;
  box-shadow: 2px 2px 0 #000;
  padding: 2px 4px 3px;
  pointer-events: none;
}
.actor__estado[data-semaforo='verde'] { border-left-color: #167a4c; }
.actor__estado[data-semaforo='amarelo'] { border-left-color: #e0b100; }
.actor__estado[data-semaforo='laranja'] { border-left-color: #ff6a2b; }
.actor__estado[data-semaforo='vermelho'] { border-left-color: #c92f3f; background: #ffd9d2; }
/* Quem atende a demanda ganha a plaquinha amarela com a setinha de pixel. */
.actor[data-ativo] .actor__name {
  background: #ffd23f;
}
.actor[data-ativo] .actor__name::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  width: 6px;
  height: 4px;
  margin: 2px 0 0 -3px;
  background:
    linear-gradient(#000, #000) 0 0 / 6px 2px no-repeat,
    linear-gradient(#000, #000) 2px 2px / 2px 2px no-repeat;
}
</style>
