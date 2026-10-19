/**
 * Retrato do Dell (`/api/operations/overview`): alertas, agenda do dia,
 * ferramentas. Só no perfil `operations`; no `app` a rota é 404 e nada aqui
 * roda. Um por aba: a Hoje, o Mais e o topo leem o mesmo retrato.
 */
import { computed, ref } from 'vue'
import { resumoDoDell } from '../operations/alertas'
import type { OperationsOverview } from '../operations/types'

const overview = ref<OperationsOverview | null>(null)
const carregando = ref(false)
const erro = ref('')
// O relógio do resumo: sem ele, um retrato que parou de chegar continuaria "recente"
// até a próxima leitura dar certo (RULES 19).
const agora = ref(Date.now())
let temporizador = 0
let controle: AbortController | null = null
const retomar = () => { if (document.visibilityState === 'visible') void ler() }

async function ler() {
  if (carregando.value) return
  controle = new AbortController()
  const prazo = window.setTimeout(() => controle?.abort(), 25_000)
  carregando.value = true
  erro.value = ''
  try {
    const response = await fetch('/api/operations/overview', { signal: controle.signal })
    const corpo = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(corpo.error ?? `HTTP ${response.status}`)
    overview.value = corpo
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    window.clearTimeout(prazo)
    carregando.value = false
    agora.value = Date.now()
  }
}

/** Topo, Hoje e Mais contam pela mesma regra e do mesmo retrato (AC-17): um número só. */
const resumo = computed(() => resumoDoDell(overview.value?.dell ?? null, agora.value))
/** O que precisa do Rômulo no Dell (vermelho ou amarelo sem "sozinho"), não só os vermelhos. */
const falhas = computed(() => resumo.value.precisam.length)

/** Lê agora e a cada 30 s com a aba visível (o monitor grava a cada minuto). */
function iniciar() {
  if (temporizador) return
  document.addEventListener('visibilitychange', retomar)
  window.addEventListener('focus', retomar)
  void ler()
  temporizador = window.setInterval(() => {
    agora.value = Date.now()
    if (document.visibilityState === 'visible') void ler()
  }, 30_000)
}

function parar() {
  controle?.abort()
  document.removeEventListener('visibilitychange', retomar)
  window.removeEventListener('focus', retomar)
  window.clearInterval(temporizador)
  temporizador = 0
}

export function useOverview() {
  return { overview, carregando, erro, falhas, resumo, ler, iniciar, parar }
}
