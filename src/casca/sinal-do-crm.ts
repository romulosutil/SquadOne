import { onBeforeUnmount, onMounted, ref } from 'vue'

/** O servidor avisa quando o histórico muda; reconecta ao voltar à tela. */
export function useSinalDoCrm(atualizar: () => unknown) {
  const conectado = ref(false)
  let fonte: EventSource | undefined
  function fechar() { fonte?.close(); fonte = undefined; conectado.value = false }
  function abrir() {
    if (document.visibilityState === 'hidden') { fechar(); return }
    if (fonte || typeof EventSource === 'undefined') return
    fonte = new EventSource('/api/operations/crm/ao-vivo')
    fonte.onopen = () => { conectado.value = true; atualizar() }
    fonte.onerror = () => { conectado.value = false }
    fonte.addEventListener('atualizar', () => { atualizar() })
  }
  onMounted(() => { document.addEventListener('visibilitychange', abrir); abrir() })
  onBeforeUnmount(() => { document.removeEventListener('visibilitychange', abrir); fechar() })
  return { conectado }
}
