import { computed, ref } from 'vue'

const CHAVE = 'squadone:escritorio:movimento'
export function movimentoPermitido(preferencia: boolean | null, sistemaReduzido: boolean): boolean {
  return preferencia ?? !sistemaReduzido
}
function ler(): boolean | null {
  try {
    const valor = window.localStorage.getItem(CHAVE)
    return valor === 'animar' ? true : valor === 'reduzir' ? false : null
  } catch { return null }
}
const preferencia = ref<boolean | null>(ler())
const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
const reduzido = ref(media?.matches ?? false)
media?.addEventListener('change', e => { reduzido.value = e.matches })
const animar = computed(() => movimentoPermitido(preferencia.value, reduzido.value))
function alternar() {
  preferencia.value = !animar.value
  try { window.localStorage.setItem(CHAVE, preferencia.value ? 'animar' : 'reduzir') } catch { /* Vale nesta aba. */ }
}
export function useMovimentoDoEscritorio() { return { preferencia, animar, alternar } }
