<script setup lang="ts">
/**
 * Folha (sheet) acessível: sobe de baixo no celular e vira diálogo no meio da
 * tela a partir de 48 rem. Substitui os modais do roster (contratar, editar,
 * nova squad, arquivo), a folha Pedir, a ficha do CRM e a paleta Ctrl+K.
 *
 * O contrato de acessibilidade (RULES 3):
 *  - `role="dialog"` + `aria-modal`, rotulada pelo título;
 *  - foco PRESO: Tab e Shift+Tab giram dentro da folha, e o resto do app fica
 *    `inert` (fora do alcance do teclado e do leitor de tela) enquanto ela
 *    está aberta;
 *  - foco DEVOLVIDO a quem abriu, ao fechar;
 *  - Esc, o botão "Fechar", o fundo e arrastar a alça para baixo fecham — os
 *    quatro respeitam `bloqueada` (envio em curso: fechar no meio deixava a
 *    resposta atrasada agir sobre a tela seguinte, e o usuário achava que
 *    tinha cancelado algo que o servidor já gravava).
 *
 * Quem usa monta com `v-if` e escuta `fechar`: a folha não guarda se está
 * aberta. Teleport para o `body`: fica fora do `#app`, que é o que vira `inert`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { pilhaDeFolhas as pilha } from '../casca/pilhaDeFolhas'

const props = withDefaults(
  defineProps<{
    titulo: string
    /** Envio em curso: nada fecha a folha. */
    bloqueada?: boolean
    /** Altura toda (ficha do CRM): no celular ocupa a tela, no desktop um diálogo largo. */
    cheia?: boolean
    /** Texto curto abaixo do título. */
    subtitulo?: string
  }>(),
  { bloqueada: false, cheia: false, subtitulo: '' }
)

const emit = defineEmits<{ fechar: [] }>()

const idTitulo = `folha-${useId()}`
const painel = ref<HTMLElement | null>(null)
const deslocamento = ref(0)
let quemAbriu: HTMLElement | null = null

const eu = Symbol('folha')
const noTopo = () => pilha[pilha.length - 1] === eu

const pedirFechar = () => {
  if (!props.bloqueada) emit('fechar')
}

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const focaveis = () =>
  [...(painel.value?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement)

function aoTeclar(e: KeyboardEvent) {
  if (!noTopo()) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    pedirFechar()
    return
  }
  if (e.key !== 'Tab') return
  const lista = focaveis()
  if (!lista.length) {
    e.preventDefault()
    painel.value?.focus()
    return
  }
  const primeiro = lista[0]
  const ultimo = lista[lista.length - 1]
  const ativo = document.activeElement
  if (e.shiftKey && (ativo === primeiro || ativo === painel.value)) {
    e.preventDefault()
    ultimo.focus()
  } else if (!e.shiftKey && ativo === ultimo) {
    e.preventDefault()
    primeiro.focus()
  }
}

/** Foco que escapou (clique fora, script): volta para dentro da folha de cima. */
function aoFocarFora(e: FocusEvent) {
  if (!noTopo() || !painel.value) return
  const alvo = e.target as Node | null
  if (alvo && !painel.value.contains(alvo)) painel.value.focus()
}

function travarFundo(travar: boolean) {
  const app = document.getElementById('app')
  if (travar) {
    app?.setAttribute('inert', '')
    document.documentElement.classList.add('com-folha')
  } else if (!pilha.length) {
    app?.removeAttribute('inert')
    document.documentElement.classList.remove('com-folha')
  }
}

// Arrastar a alça para baixo fecha (gesto do celular). Abaixo de 96 px volta.
let inicioY: number | null = null
function comecarArraste(e: PointerEvent) {
  if (props.bloqueada) return
  inicioY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function arrastar(e: PointerEvent) {
  if (inicioY === null) return
  deslocamento.value = Math.max(0, e.clientY - inicioY)
}
function soltar() {
  if (inicioY === null) return
  inicioY = null
  if (deslocamento.value > 96) pedirFechar()
  deslocamento.value = 0
}

const estiloDoPainel = computed(() => (deslocamento.value ? { transform: `translateY(${deslocamento.value}px)` } : undefined))

onMounted(async () => {
  quemAbriu = document.activeElement instanceof HTMLElement ? document.activeElement : null
  pilha.push(eu)
  travarFundo(true)
  document.addEventListener('keydown', aoTeclar, true)
  document.addEventListener('focusin', aoFocarFora)
  await nextTick()
  // Quem está dentro pode já ter posto o foco onde quer (a ficha do CRM foca o
  // título); só sem isso a folha escolhe: o campo marcado ou o próprio painel.
  if (!painel.value?.contains(document.activeElement)) {
    const marcado = painel.value?.querySelector<HTMLElement>('[data-autofocus]')
    ;(marcado ?? painel.value)?.focus()
  }
})

onBeforeUnmount(() => {
  const i = pilha.indexOf(eu)
  if (i >= 0) pilha.splice(i, 1)
  travarFundo(false)
  document.removeEventListener('keydown', aoTeclar, true)
  document.removeEventListener('focusin', aoFocarFora)
  // Devolve o foco a quem abriu, se ele ainda existe na página. Com outra folha
  // aberta no lugar (a paleta que abre o Pedir), o foco é dela. setTimeout e
  // não rAF: rAF não roda com a aba em segundo plano, e o foco se perderia.
  const volta = quemAbriu
  setTimeout(() => {
    if (!pilha.length && volta && document.contains(volta)) volta.focus()
  })
})
</script>

<template>
  <Teleport to="body">
    <div class="folha-fundo" @click.self="pedirFechar">
      <section
        ref="painel"
        class="folha"
        :class="{ 'folha--cheia': cheia }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="idTitulo"
        tabindex="-1"
        :style="estiloDoPainel"
      >
        <div
          class="folha__alca"
          aria-hidden="true"
          @pointerdown="comecarArraste"
          @pointermove="arrastar"
          @pointerup="soltar"
          @pointercancel="soltar"
        >
          <span />
        </div>
        <header class="folha__topo">
          <div class="folha__titulos">
            <h2 :id="idTitulo">{{ titulo }}</h2>
            <p v-if="subtitulo">{{ subtitulo }}</p>
          </div>
          <button type="button" class="folha__fechar" :disabled="bloqueada" @click="pedirFechar">
            {{ bloqueada ? 'Aguarde…' : 'Fechar' }}
          </button>
        </header>
        <div class="folha__corpo">
          <slot />
        </div>
        <footer v-if="$slots.rodape" class="folha__rodape">
          <slot name="rodape" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style>
html.com-folha { overflow: hidden; }

.folha-fundo {
  position: fixed;
  z-index: 80;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
  font-family: var(--fonte);
}

.folha {
  display: flex;
  width: 100%;
  max-height: 92dvh;
  flex-direction: column;
  border-top: var(--linha);
  background: var(--superficie);
  color: var(--texto);
  box-shadow: 0 -4px 0 var(--borda);
  outline: none;
  animation: folha-sobe 160ms ease-out;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.folha *, .folha *::before, .folha *::after { box-sizing: border-box; }
.folha--cheia { height: 100dvh; max-height: 100dvh; }

.folha__alca {
  display: grid;
  height: 1.5rem;
  flex-shrink: 0;
  place-items: center;
  cursor: grab;
  touch-action: none;
}
.folha__alca span { width: 3rem; height: 0.3rem; background: var(--texto-2); }

.folha__topo {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--esp-3);
  padding: 0 var(--esp-4) var(--esp-3);
  border-bottom: var(--linha-fina);
}
.folha__titulos { min-width: 0; }
.folha__topo h2 { margin: 0; font-size: 1.35rem; font-weight: var(--peso-titulo); letter-spacing: -0.02em; overflow-wrap: anywhere; }
.folha__topo p { margin: var(--esp-1) 0 0; color: var(--texto-2); font-size: 0.85rem; }

.folha__fechar {
  flex-shrink: 0;
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--esp-3);
  border: var(--linha-fina);
  background: var(--superficie-2);
  color: var(--texto);
  font: inherit;
  font-weight: var(--peso-forte);
  cursor: pointer;
}
.folha__fechar:disabled { opacity: 0.6; cursor: not-allowed; }

.folha__corpo {
  display: grid;
  min-height: 0;
  flex: 1;
  align-content: start;
  gap: var(--esp-3);
  padding: var(--esp-4);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.folha__rodape {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--esp-2);
  padding: var(--esp-3) var(--esp-4);
  border-top: var(--linha-fina);
  background: var(--superficie-2);
}

.folha :focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; }
.folha:focus-visible { outline-offset: -3px; }

@media (min-width: 48rem) {
  .folha-fundo { align-items: center; padding: var(--esp-6); }
  .folha {
    width: min(100%, 38rem);
    max-height: min(90dvh, 52rem);
    border: var(--linha);
    box-shadow: var(--sombra);
    padding-bottom: 0;
  }
  .folha--cheia { width: min(100%, 60rem); height: 90dvh; }
  .folha__alca { display: none; }
  .folha__topo { padding-top: var(--esp-4); }
}

@keyframes folha-sobe {
  from { transform: translateY(2rem); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .folha { animation: none; }
}
</style>
