<script setup lang="ts">
/**
 * Paleta de comandos (Ctrl+K / ⌘K, a partir de 1024 px): ir a qualquer
 * destino, pedir, trocar de squad. Combobox com lista (padrão ARIA 1.2): o
 * foco fica no campo, as setas movem a opção ativa e Enter executa.
 */
import { computed, ref, watch } from 'vue'
import Sheet from '../components/Sheet.vue'
import { filtrarComandos, type Comando } from './destinos'

const props = defineProps<{ comandos: Comando[] }>()
const emit = defineEmits<{ fechar: []; executar: [comando: Comando] }>()

const termo = ref('')
const ativo = ref(0)
const lista = computed(() => filtrarComandos(props.comandos, termo.value))
watch(termo, () => { ativo.value = 0 })

const idDa = (c: Comando) => `paleta-${c.id.replace(/[^a-z0-9-]/gi, '-')}`

function aoTeclar(e: KeyboardEvent) {
  const n = lista.value.length
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault()
    ativo.value = (ativo.value + 1) % n
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault()
    ativo.value = (ativo.value - 1 + n) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const c = lista.value[ativo.value]
    if (c) emit('executar', c)
  }
}
</script>

<template>
  <Sheet titulo="Ir para…" subtitulo="Setas escolhem, Enter abre, Esc fecha." @fechar="emit('fechar')">
    <label class="rotulo">
      Buscar um destino ou ação
      <input
        v-model="termo"
        class="campo"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="paleta-lista"
        :aria-expanded="lista.length > 0"
        :aria-activedescendant="lista[ativo] ? idDa(lista[ativo]) : undefined"
        autocomplete="off"
        data-autofocus
        @keydown="aoTeclar"
      />
    </label>
    <ul id="paleta-lista" class="paleta" role="listbox" aria-label="Comandos">
      <li
        v-for="(c, i) in lista"
        :id="idDa(c)"
        :key="c.id"
        role="option"
        :aria-selected="i === ativo"
        class="paleta__item"
        @mousemove="ativo = i"
        @click="emit('executar', c)"
      >
        <strong>{{ c.rotulo }}</strong>
        <small>{{ c.dica }}</small>
      </li>
    </ul>
    <p v-if="!lista.length" class="texto-2" role="status">Nada com “{{ termo }}”.</p>
  </Sheet>
</template>

<style>
.paleta { display: grid; gap: var(--esp-1); margin: 0; padding: 0; list-style: none; }
.paleta__item { display: grid; gap: var(--esp-0); min-height: var(--toque); padding: var(--esp-2) var(--esp-3); border: var(--linha-fina); background: var(--superficie); cursor: pointer; }
.paleta__item small { color: var(--texto-2); }
.paleta__item[aria-selected="true"] { background: var(--destaque); color: var(--destaque-texto); }
.paleta__item[aria-selected="true"] small { color: inherit; }
</style>
