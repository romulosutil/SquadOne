/**
 * Retrato do Dell (`/api/operations/overview`): alertas, agenda do dia,
 * ferramentas. Só no perfil `operations`; no `app` a rota é 404 e nada aqui
 * roda. Um por aba: a Hoje, o Mais e o topo leem o mesmo retrato.
 */
import { computed, ref } from 'vue'
import type { OperationsOverview } from '../operations/types'

const overview = ref<OperationsOverview | null>(null)
const carregando = ref(false)
const erro = ref('')
let temporizador = 0

async function ler() {
  carregando.value = true
  erro.value = ''
  try {
    const response = await fetch('/api/operations/overview')
    const corpo = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(corpo.error ?? `HTTP ${response.status}`)
    overview.value = corpo
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    carregando.value = false
  }
}

const falhas = computed(() => overview.value?.dell.verificacoes.filter((c) => c.estado === 'falha').length ?? 0)

/** Lê agora e a cada 30 s com a aba visível (o monitor grava a cada minuto). */
function iniciar() {
  if (temporizador) return
  void ler()
  temporizador = window.setInterval(() => {
    if (document.visibilityState === 'visible') void ler()
  }, 30_000)
}

function parar() {
  window.clearInterval(temporizador)
  temporizador = 0
}

export function useOverview() {
  return { overview, carregando, erro, falhas, ler, iniciar, parar }
}
