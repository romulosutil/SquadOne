<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import type { CharSheet } from './useOffice'
import { carregarCatalogoSprites, resolverSprite } from './catalogoSprites'
import { useMovimentoDoEscritorio } from './movimento'
const { preferencia } = useMovimentoDoEscritorio()
const props = defineProps<{ sprite: string; hue?: number; ordem: number }>()
const chars = shallowRef<Record<string, CharSheet> | null>(null)
onMounted(async () => {
  try { chars.value = await carregarCatalogoSprites() } catch { /* O nome e os controles continuam disponíveis. */ }
})
const aparencia = computed(() => resolverSprite(props.sprite, props.hue, props.ordem, chars.value))
const sheet = computed(() => chars.value?.[aparencia.value.sprite])
const estilo = computed(() => {
  const s = sheet.value
  if (!s) return {}
  const a = s.anims.idle
  return { width: `${s.frameW}px`, height: `${s.frameH}px`, backgroundImage: `url(${a.file})`, backgroundSize: `${s.frameW * a.frames}px ${s.frameH}px`, '--strip-end': `${-s.frameW * a.frames}px`, animation: `strip 1.4s steps(${a.frames}) infinite`, filter: aparencia.value.hue ? `hue-rotate(${aparencia.value.hue}deg)` : undefined }
})
</script>

<template><div class="sprite-da-sala" :data-movimento="preferencia" aria-hidden="true"><div v-if="sheet" class="sprite-da-sala__ator" :style="estilo"></div></div></template>

<style scoped>
.sprite-da-sala { display: grid; align-items: end; justify-items: center; width: var(--esp-16); min-height: var(--esp-16); flex: 0 0 auto; border-radius: var(--raio-controle); background: var(--superficie-2); }
.sprite-da-sala__ator { background-repeat: no-repeat; }
.sprite-da-sala[data-movimento="false"] .sprite-da-sala__ator { animation: none !important; }
@media (prefers-reduced-motion: reduce) { .sprite-da-sala:not([data-movimento="true"]) .sprite-da-sala__ator { animation: none !important; } }
</style>
