<script setup lang="ts">
/**
 * Escritório — spec §4.1 (tiles), §4.2 (movimento), §4.3 (pathfinding).
 *
 * O personagem NÃO vive no CSS Grid. Ele é position:absolute dentro de .world
 * e é movido por translate3d escrito direto no style pelo loop de useOffice.
 * A versão anterior usava `transition: grid-column-start`, que não anima —
 * teleporta (medido no navegador: getAnimations() == [] e 1 valor único em 700ms).
 */
import { computed, watch } from 'vue'
import { useOffice, type OfficeMember } from '../office/useOffice'
import { TILE } from '../office/rooms'

const props = defineProps<{ agent?: string }>()

/**
 * Roster local até §3.1 (GET /api/squad) existir. A ordem segue UNLOCK_ORDER:
 * (0,0) (1,0) (0,1) (1,1) — monótona direita/baixo, nada já na tela se move.
 */
const ROSTER: OfficeMember[] = [
  { id: 'po', nome: 'Rômulo', papel: 'PO', slot: [0, 0], room: 'ROOM_SOLO', emoji: '🧑‍💼' },
  { id: 'TechLead', nome: 'Tech Lead', papel: 'TechLead', slot: [1, 0], room: 'ROOM_DEV', emoji: '🧑‍💻' },
  { id: 'ProfissionalMaker', nome: 'Maker', papel: 'Maker', slot: [0, 1], room: 'ROOM_STUDIO', emoji: '🧑‍🎨' },
  { id: 'PessoalFamiliar', nome: 'Família', papel: 'Família', slot: [1, 1], room: 'ROOM_LOUNGE', emoji: '🧑‍🍼' },
]

const members = computed(() => ROSTER)

const { setViewportEl, setWorldEl, scale, assets, rooms, mapPx, setActorEl, moveTo, SPRITE_URL } =
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

const floorStyle = computed(() =>
  assets.floor
    ? { backgroundImage: `url(${SPRITE_URL.floor})`, backgroundRepeat: 'repeat', backgroundSize: `${TILE}px ${TILE}px` }
    : {}
)

function wallStyle(horizontal: boolean) {
  if (!assets.wall) return {}
  return {
    backgroundImage: `url(${SPRITE_URL.wall})`,
    backgroundRepeat: horizontal ? 'repeat-x' : 'repeat-y',
    backgroundSize: `${TILE * 5}px ${TILE}px`,
  }
}

function hasSprite(kind: string): boolean {
  return !!(assets as Record<string, boolean>)[kind]
}

function propStyle(kind: string) {
  const url = (SPRITE_URL as Record<string, string>)[kind]
  return hasSprite(kind) && url ? { backgroundImage: `url(${url})`, backgroundSize: '100% 100%' } : {}
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
    <div :ref="setViewportEl" class="office-viewport flex-1 relative overflow-hidden bg-[#1b2432]">
      <!-- SCALE aparece em UM lugar: este transform (escrito por useOffice). -->
      <div
        :ref="setWorldEl"
        class="office-world"
        :style="{ width: mapPx[0] + 'px', height: mapPx[1] + 'px' }"
      >
        <div
          v-for="room in rooms"
          :key="room.key"
          class="room"
          :class="{ 'room--new': room.isNew }"
          :style="{ left: room.left + 'px', top: room.top + 'px', width: room.width + 'px', height: room.height + 'px' }"
        >
          <!-- 1 chão + 4 paredes + props ≈ 13 nós por sala (§4.1) -->
          <div class="room__floor pixelated" :style="floorStyle"></div>
          <div class="room__wall room__wall--top pixelated" :style="wallStyle(true)"></div>
          <div class="room__wall room__wall--bottom pixelated" :style="wallStyle(true)"></div>
          <div class="room__wall room__wall--left pixelated" :style="wallStyle(false)"></div>
          <div class="room__wall room__wall--right pixelated" :style="wallStyle(false)"></div>

          <div
            v-for="(p, i) in room.props"
            :key="room.key + '-p' + i"
            class="prop pixelated"
            :style="{
              left: p.left - room.left + 'px',
              top: p.top - room.top + 'px',
              width: p.width + 'px',
              height: p.height + 'px',
              ...propStyle(p.kind),
            }"
          >
            <span v-if="!hasSprite(p.kind)" class="prop__emoji">{{ p.emoji }}</span>
          </div>

          <span class="room__label">{{ room.label }}</span>
        </div>

        <!-- Portas: só materializam quando o slot vizinho está desbloqueado. -->
        <template v-for="room in rooms" :key="room.key + '-doors'">
          <div
            v-for="(d, i) in room.doors"
            :key="room.key + '-d' + i"
            class="door pixelated"
            :style="assets.door ? { left: d.left + 'px', top: d.top + 'px', backgroundImage: `url(${SPRITE_URL.door})`, backgroundSize: '200% 100%' } : { left: d.left + 'px', top: d.top + 'px' }"
          ></div>
        </template>

        <!-- Atores: absolutos, movidos por translate3d direto no style. -->
        <div
          v-for="m in members"
          :key="m.id"
          :ref="(el) => setActorEl(m.id, el)"
          class="actor"
        >
          <div class="actor__shadow"></div>
          <div v-if="assets.char" data-sprite class="actor__sprite pixelated"></div>
          <div v-else data-sprite class="actor__emoji">{{ m.emoji }}</div>
          <span class="actor__name">{{ m.nome }}</span>
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

.room {
  position: absolute;
}

.room__floor {
  position: absolute;
  left: 32px;
  top: 32px;
  right: 32px;
  bottom: 32px;
  background-color: #6b5a4a;
}

.room__wall {
  position: absolute;
  background-color: #2f3b52;
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.35);
}
.room__wall--top { left: 0; top: 0; width: 100%; height: 32px; }
.room__wall--bottom { left: 0; bottom: 0; width: 100%; height: 32px; }
.room__wall--left { left: 0; top: 0; width: 32px; height: 100%; }
.room__wall--right { right: 0; top: 0; width: 32px; height: 100%; }

.room__label {
  position: absolute;
  left: 34px;
  top: 34px;
  font-size: 8px;
  line-height: 1;
  font-weight: 900;
  text-transform: uppercase;
  color: #fff;
  background: #000;
  padding: 2px 3px;
}

.prop {
  position: absolute;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.prop__emoji {
  font-size: 20px;
  line-height: 1;
}

.door {
  position: absolute;
  width: 32px;
  height: 32px;
  background-color: #7a4b22;
  box-shadow: inset 0 0 0 2px #000;
}

.actor {
  position: absolute;
  left: 0;
  top: 0;
  width: 32px;
  height: 32px;
  will-change: transform;
  pointer-events: none;
}

.actor__shadow {
  position: absolute;
  left: 6px;
  bottom: 1px;
  width: 20px;
  height: 5px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
}

.actor__sprite {
  position: absolute;
  inset: 0;
  background-image: url('/sprites/char_po.png');
  background-size: 96px 128px;
  background-position: 0 0;
  /* idle/working: CSS puro com steps(2), sem gastar rAF */
  animation: sprite-idle 0.9s steps(2) infinite;
}
.actor--walk .actor__sprite {
  animation: none;
}

.actor__emoji {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  line-height: 1;
  animation: emoji-idle 0.9s steps(2) infinite;
}
.actor--walk .actor__emoji {
  animation: emoji-walk 0.35s steps(2) infinite;
}

.actor__name {
  position: absolute;
  left: 50%;
  top: -10px;
  transform: translateX(-50%);
  font-size: 7px;
  line-height: 1;
  font-weight: 900;
  white-space: nowrap;
  color: #000;
  background: #fff;
  border: 1px solid #000;
  padding: 1px 2px;
}
</style>
