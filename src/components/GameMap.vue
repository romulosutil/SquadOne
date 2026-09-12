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
 */
import { computed, shallowRef, watch } from 'vue'
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
import type { Pessoa, SquadResponse } from '../types'

const props = defineProps<{ agent?: string; squad?: SquadResponse | null }>()

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

const { setViewportEl, setWorldEl, scale, sheets, pessoas, rooms, bounds, setActorEl, moveTo } =
  useOffice(dominios)

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

const statusLabel = computed(() =>
  !props.agent || props.agent === 'Idle' ? 'Aguardando Demandas' : `Agente ${props.agent} Ativo`
)

const worldBox = computed(() => ({
  width: bounds.value.maxX - bounds.value.minX + 'px',
  height: bounds.value.maxY - bounds.value.minY + 'px',
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
 * `room-build`. Sem fase, a sala é só uma sala.
 */
function faseClasse(room: { phase: RoomPhase }) {
  return {
    'room--pending': room.phase === 'pending',
    'room--new': room.phase === 'building',
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
  <div class="w-full h-full border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] bg-[#8cb07a] relative overflow-hidden flex flex-col">
    <div class="p-2 border-b-4 border-black bg-[#f4f0e6] z-20 shrink-0 flex justify-between items-center">
      <span class="font-black uppercase text-sm">📍 Mapa do Escritório</span>
      <div class="flex items-center gap-2">
        <span class="font-bold text-[10px] uppercase px-2 py-1 border-2 border-black">Tab: {{ scale }}x</span>
        <span class="font-bold text-xs uppercase px-2 py-1 bg-black text-white">Status: {{ statusLabel }}</span>
      </div>
    </div>

    <!-- Viewport: recorta o mundo. A câmera é o transform de .world. -->
    <div :ref="setViewportEl" class="office-viewport flex-1 relative overflow-hidden bg-[#20283a]">
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
          <div
            v-for="room in rooms"
            :key="room.key + '-floor'"
            class="floor"
            :class="faseClasse(room)"
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
              :style="{ left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px', zIndex: p.z }"
            >
              <span class="prop__emoji">{{ p.emoji }}</span>
            </div>

            <!-- A placa é do DOMÍNIO: a sala inteira pertence a ele. -->
            <span
              class="room__label"
              :style="{ left: room.label.left + 'px', top: room.label.top + 'px' }"
              >{{ room.label.text }}</span
            >
          </div>

          <!-- Atores: billboards, movidos por translate3d direto no style. -->
          <div
            v-for="p in pessoas"
            :key="p.id"
            :ref="(el) => setActorEl(p.id, el)"
            class="actor"
            :style="actorStyle(p)"
          >
            <div class="actor__shadow"></div>
            <div data-billboard class="actor__billboard">
              <template v-if="sheetOf(p)">
                <div class="actor__strip actor__strip--idle" :style="stripStyle(p, 'idle')"></div>
                <div data-walk class="actor__strip actor__strip--walk" :style="stripStyle(p, 'walk')"></div>
              </template>
              <div v-else class="actor__emoji">{{ p.emoji }}</div>
            </div>
            <span class="actor__name">{{ p.nome }} · {{ p.papel }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.floor {
  position: absolute;
  background-color: #e9dcc3;
  background-image: linear-gradient(to right, rgba(0, 0, 0, 0.16) 2px, transparent 2px),
    linear-gradient(to bottom, rgba(0, 0, 0, 0.16) 2px, transparent 2px);
  background-size: 32px 32px;
  box-shadow: inset 0 0 0 2px #000;
}

.wall {
  position: absolute;
  transform-origin: 0 0;
  background-color: #3d4a63;
  border-top: 3px solid #000;
}
/* A face oeste pega menos luz: mesmo tom, um degrau mais escuro. */
.wall--y {
  background-color: #2a3448;
}

.prop {
  position: absolute;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none;
}
.prop__emoji {
  font-size: 26px;
  line-height: 1;
  filter: drop-shadow(0 2px 0 rgba(0, 0, 0, 0.45));
}

.room__label {
  position: absolute;
  z-index: 100000;
  transform: translateX(-50%);
  font-size: 9px;
  line-height: 1;
  font-weight: 900;
  white-space: nowrap;
  text-transform: uppercase;
  color: #fff;
  background: #000;
  padding: 3px 5px;
  pointer-events: none;
}

.actor {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
  pointer-events: none;
}

.actor__shadow {
  position: absolute;
  left: 50%;
  bottom: 2px;
  width: 34px;
  height: 16px;
  margin-left: -17px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.28);
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

.actor__name {
  position: absolute;
  left: 50%;
  top: -12px;
  transform: translateX(-50%);
  font-size: 8px;
  line-height: 1;
  font-weight: 900;
  white-space: nowrap;
  color: #000;
  background: #fff;
  border: 2px solid #000;
  padding: 1px 3px;
}
</style>
