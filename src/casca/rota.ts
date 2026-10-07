/**
 * Roteamento da casca, sem dependência de roteador: um `ref` com o caminho,
 * `history.pushState` e o `popstate`. As regras (o que é rota de quem) são
 * puras e ficam em `destinos.ts`.
 *
 * Por que não deixar o link recarregar a página, como a Central fazia: com os
 * agentes no mesmo app, um turno pode estar rodando (até ~6 min) quando o
 * usuário toca em "Funil". Recarregar perderia a resposta dele — o servidor
 * criaria os eventos e a tela nunca contaria.
 */
import { ref } from 'vue'
import { ehLinkDaCasca, normalizarCaminho, type Capacidades } from './destinos'

export const caminho = ref(normalizarCaminho(window.location.pathname))

/** Foco no conteúdo novo: quem usa leitor de tela ouve a página trocar. */
function focarConteudo() {
  const alvo = document.getElementById('conteudo')
  alvo?.focus({ preventScroll: true })
}

export function navegar(href: string, substituir = false) {
  const url = new URL(href, window.location.href)
  const destino = `${url.pathname}${url.search}${url.hash}`
  if (destino !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    if (substituir) history.replaceState(null, '', destino)
    else history.pushState(null, '', destino)
  }
  const novo = normalizarCaminho(url.pathname)
  const mudou = novo !== caminho.value
  caminho.value = novo
  if (mudou) {
    window.scrollTo({ top: 0 })
    setTimeout(focarConteudo)
  }
}

/**
 * Clique em `<a>` de rota da casca vira navegação sem recarregar. Respeita o
 * que o usuário pediu ao navegador: Ctrl/Cmd/Shift/meio abrem aba nova, e
 * `target`/`download` seguem o padrão.
 */
export function interceptarLink(e: MouseEvent, c: Capacidades) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = (e.target as Element | null)?.closest?.('a')
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
  const href = a.getAttribute('href')
  if (!href || href.startsWith('#')) return
  if (!ehLinkDaCasca(href, window.location.origin, c)) return
  e.preventDefault()
  navegar(href)
}

/** Voltar/avançar do navegador (e do Android) troca a rota. */
export function ouvirHistorico(): () => void {
  const aoVoltar = () => {
    caminho.value = normalizarCaminho(window.location.pathname)
  }
  window.addEventListener('popstate', aoVoltar)
  return () => window.removeEventListener('popstate', aoVoltar)
}
