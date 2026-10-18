/**
 * O tema da aba como estado do Vue (17/10/2026): um só para o app inteiro, para o seletor de
 * Mais e o do /design-system mostrarem a mesma escolha e o blueprint remedir o contraste quando
 * ela muda. A regra (padrão, storage, atributo) é de tema.ts, que é PURO; aqui só a cola com
 * `window`, `document` e a reatividade.
 */
import { computed, ref } from 'vue'
import {
  aplicarTema, gravarPreferenciaDeTema, lerPreferenciaDeTema, temaVisto as temaVistoPuro,
  type GuardadorDeTema, type PreferenciaDeTema,
} from './tema'

function storage(): GuardadorDeTema | null {
  // Acessar `window.localStorage` já lança com o storage bloqueado.
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const CONSULTA = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

const preferencia = ref<PreferenciaDeTema>(lerPreferenciaDeTema(storage()))
const sistemaEscuro = ref(CONSULTA?.matches ?? false)
// Um listener para a vida da aba: o módulo é único, então não vaza por componente montado.
CONSULTA?.addEventListener('change', (e) => { sistemaEscuro.value = e.matches })

const temaVisto = computed(() => temaVistoPuro(preferencia.value, sistemaEscuro.value))

/** Lê a escolha guardada e põe no <html>. Chamado no main.ts antes de montar. */
export function iniciarTema(): void {
  preferencia.value = lerPreferenciaDeTema(storage())
  aplicarTema(preferencia.value, document)
}

export function escolherTema(pref: PreferenciaDeTema): void {
  preferencia.value = pref
  gravarPreferenciaDeTema(storage(), pref)
  aplicarTema(pref, document)
}

export function useTema() {
  return { preferencia, sistemaEscuro, temaVisto, escolherTema }
}
