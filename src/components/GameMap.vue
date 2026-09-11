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
 */
import { computed, watch } from 'vue'
import { useOffice, type OfficeMember } from '../office/useOffice'
import { ISO_MATRIX, TILE, WALL_H, WALL_MATRIX_X, WALL_MATRIX_Y } from '../office/rooms'

const props = defineProps<{ agent?: string }>()

/**
 * Roster local até §3.1 (GET /api/squad) existir. A ordem segue UNLOCK_ORDER:
 * (0,0) (1,0) (0,1) (1,1) — monótona direita/baixo, nada já na tela se move.
 * São 3 personagens no pacote CraftPix para 4 papéis: o quarto reusa o primeiro
 * com hue-rotate (palette swap, §5.3).
 */
const ROSTER: OfficeMember[] = [
  { id: 'po', nome: 'Rômulo', papel: 'PO', slot: [0, 0], room: 'ROOM_SOLO', sprite: 'wraith_01', emoji: '🧑‍💼' },
  { id: 'TechLead', nome: 'Tech Lead', papel: 'TechLead', slot: [1, 0], room: 'ROOM_DEV', sprite: 'wraith_02', emoji: '🧑‍💻' },
  { id: 'ProfissionalMaker', nome: 'Maker', papel: 'Maker', slot: [0, 1], room: 'ROOM_STUDIO', sprite: 'wraith_03', emoji: '🧑‍🎨' },
  { id: 'PessoalFamiliar', nome: 'Família', papel: 'Família', slot: [1, 1], room: 'ROOM_LOUNGE', sprite: 'wraith_01', hue: 150, emoji: '🧑‍🍼' },
]

const members = computed(() => ROSTER)

const { setViewportEl, setWorldEl, scale, sheets, rooms, bounds, setActorEl, moveTo } =
  useOffice(members)

/** Tile livre no miolo de todas as salas — onde o PO para ao visitar alguém. */
const VISIT_TILE: [number, number] = [4, 3]

watch(
  () => props.agent,
  (agent) => {
    const dest = ROSTER.find((m) => m.id === agent)
    if (dest) moveTo('po', dest.slot, VISIT_TILE)
    else moveTo('po', ROSTER[0].slot) // Idle: volta pra própria mesa
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

function sheetOf(m: OfficeMember) {
  return sheets.value?.[m.sprite] ?? null
}

/** Strip horizontal: uma linha, N frames de frameW. */
function stripStyle(m: OfficeMember, anim: 'idle' | 'walk') {
  const sheet = sheetOf(m)
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

function actorStyle(m: OfficeMember) {
  const sheet = sheetOf(m)
  return {
    width: `${sheet ? sheet.frameW : TILE}px`,
    height: `${sheet ? sheet.frameH : TILE}px`,
    filter: m.hue ? `hue-rotate(${m.hue}deg)` : undefined,
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
            :class="{ 'room--new': room.isNew }"
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
          <template v-for="room in rooms" :key="room.key">
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

            <span
              class="room__label"
              :style="{ left: room.label.left + 'px', top: room.label.top + 'px' }"
              >{{ room.label.text }}</span
            >
          </template>

          <!-- Atores: billboards, movidos por translate3d direto no style. -->
          <div
            v-for="m in members"
            :key="m.id"
            :ref="(el) => setActorEl(m.id, el)"
            class="actor"
            :style="actorStyle(m)"
          >
            <div class="actor__shadow"></div>
            <div data-billboard class="actor__billboard">
              <template v-if="sheetOf(m)">
                <div class="actor__strip actor__strip--idle" :style="stripStyle(m, 'idle')"></div>
                <div data-walk class="actor__strip actor__strip--walk" :style="stripStyle(m, 'walk')"></div>
              </template>
              <div v-else class="actor__emoji">{{ m.emoji }}</div>
            </div>
            <span class="actor__name">{{ m.nome }}</span>
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
