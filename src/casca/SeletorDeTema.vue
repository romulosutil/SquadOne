<script setup lang="ts">
/**
 * Claro | Escuro | Automático (17/10/2026). O mesmo em Mais › Aparência e no /design-system:
 * os dois leem o estado único de temaVivo.ts, então trocar num aparece no outro.
 *
 * Grupo de rádio de verdade (role=radiogroup, aria-checked) e não três botões de alternar:
 * é uma escolha entre três, uma sempre marcada. Tab entra só na marcada e as setas trocam,
 * como num rádio nativo; o visual é o .segmentado de agentes.css.
 */
import { nextTick, ref } from 'vue'
import { PREFERENCIAS_DE_TEMA, type PreferenciaDeTema } from './tema'
import { useTema } from './temaVivo'

withDefaults(defineProps<{ rotulo?: string }>(), { rotulo: 'Tema' })

const { preferencia, temaVisto, escolherTema } = useTema()
// Pelo DOM e não por ref em v-for: a ordem do array de refs não é garantida.
const grupo = ref<HTMLElement | null>(null)

function mover(atual: number, passo: number) {
  const n = PREFERENCIAS_DE_TEMA.length
  const proximo = (atual + passo + n) % n
  escolherTema(PREFERENCIAS_DE_TEMA[proximo].id)
  void nextTick(() => grupo.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[proximo]?.focus())
}

function teclado(e: KeyboardEvent, i: number) {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); mover(i, 1) }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); mover(i, -1) }
}

const marcado = (id: PreferenciaDeTema) => preferencia.value === id
</script>

<template>
  <div class="seletor-tema">
    <div ref="grupo" class="segmentado segmentado--auto" role="radiogroup" :aria-label="rotulo">
      <button
        v-for="(p, i) in PREFERENCIAS_DE_TEMA"
        :key="p.id"
        type="button"
        role="radio"
        :aria-checked="marcado(p.id)"
        :tabindex="marcado(p.id) ? 0 : -1"
        @click="escolherTema(p.id)"
        @keydown="teclado($event, i)"
      >
        {{ p.rotulo }}
      </button>
    </div>
    <p v-if="preferencia === 'automatico'" class="texto-2 texto-pequeno" aria-live="polite">
      Segue o sistema: agora {{ temaVisto }}.
    </p>
  </div>
</template>

<style>
.seletor-tema { display: grid; gap: var(--esp-1); justify-items: start; }
.seletor-tema .segmentado { display: flex; flex-wrap: wrap; width: auto; }
.seletor-tema .segmentado button { flex: 0 0 auto; min-width: max-content; padding-inline: var(--esp-3); }
.seletor-tema p { margin: 0; }
</style>
