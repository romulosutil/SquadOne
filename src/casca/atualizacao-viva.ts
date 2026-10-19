import { onBeforeUnmount, onMounted, ref } from 'vue'

/** Uma leitura por vez, prazo de rede e retomada imediata ao voltar ao app. */
export function useAtualizacaoViva(ler: (signal: AbortSignal) => Promise<unknown>, intervalo = 30_000) {
  const atualizando = ref(false)
  const conferidoEm = ref<number | null>(null)
  let ativo = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let controle: AbortController | undefined
  async function sincronizar() {
    if (!ativo || atualizando.value || document.visibilityState === 'hidden') return
    clearTimeout(timer)
    controle = new AbortController()
    const prazo = setTimeout(() => controle?.abort(), 25_000)
    atualizando.value = true
    try { const ok = await ler(controle.signal); if (ok !== false && ativo && !controle.signal.aborted) conferidoEm.value = Date.now() }
    finally {
      clearTimeout(prazo)
      atualizando.value = false
      if (ativo) timer = setTimeout(() => { void sincronizar() }, intervalo)
    }
  }
  const retomar = () => { if (!conferidoEm.value || Date.now() - conferidoEm.value > 3_000) void sincronizar() }
  onMounted(() => { ativo = true; document.addEventListener('visibilitychange', retomar); window.addEventListener('focus', retomar); void sincronizar() })
  onBeforeUnmount(() => { ativo = false; clearTimeout(timer); controle?.abort(); document.removeEventListener('visibilitychange', retomar); window.removeEventListener('focus', retomar) })
  return { atualizando, conferidoEm, sincronizar }
}
