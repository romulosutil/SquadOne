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

// ------------------------------------------------------------------ contador de uso (AC-28)

const ROTA_DO_USO = '/api/operations/uso'
let ultimaTelaContada = ''

/**
 * Só o caminho, `ver`/`produto` e se há ficha aberta: o id do lead nunca sai daqui (o servidor
 * peneira de novo em server/uso.ts, mas o que não sai não vaza). Finanças vão só pelo caminho.
 */
function telaAtual(): string {
  const q = new URLSearchParams(window.location.search)
  const p = new URLSearchParams()
  const caminhoAtual = normalizarCaminho(window.location.pathname)
  if (caminhoAtual === '/crm') {
    for (const chave of ['ver', 'produto']) {
      const v = q.get(chave)
      if (v) p.set(chave, v.slice(0, 20))
    }
    if (q.get('lead')) p.set('lead', '1')
  }
  const busca = p.toString()
  return `${caminhoAtual}${busca ? `?${busca}` : ''}`
}

/**
 * Conta a tela no servidor quando ela muda. sendBeacon porque não segura a navegação nem espera
 * resposta; falha (perfil app, que responde 404, ou navegador sem beacon) é silenciosa: contar
 * nunca pode atrapalhar a tela.
 */
function contarTela() {
  const tela = telaAtual()
  if (tela === ultimaTelaContada) return
  ultimaTelaContada = tela
  try {
    navigator.sendBeacon?.(ROTA_DO_USO, JSON.stringify({ rota: tela }))
  } catch {
    // sem contagem
  }
}

/**
 * O CRM (`?ver=&lead=`) e as Finanças escrevem o endereço com o próprio history, fora de `navegar`;
 * por isso o contador escuta no history e não só aqui. Uma vez por página (o HMR do Vite reavalia o
 * módulo): a marca fica no próprio history. Trocar só a query das finanças (mês, busca) dá a mesma
 * tela e não conta de novo.
 */
const MARCA_DO_CONTADOR = Symbol.for('squadone.contadorDeUso')
function instalarContadorDeUso() {
  const h = history as History & { [MARCA_DO_CONTADOR]?: true }
  if (!h[MARCA_DO_CONTADOR]) {
    h[MARCA_DO_CONTADOR] = true
    for (const metodo of ['pushState', 'replaceState'] as const) {
      const original = h[metodo].bind(h)
      h[metodo] = (...args: Parameters<History['pushState']>) => {
        original(...args)
        contarTela()
      }
    }
    window.addEventListener('popstate', contarTela)
  }
  contarTela()
}
instalarContadorDeUso()

/** Voltar/avançar do navegador (e do Android) troca a rota. */
export function ouvirHistorico(): () => void {
  const aoVoltar = () => {
    caminho.value = normalizarCaminho(window.location.pathname)
  }
  window.addEventListener('popstate', aoVoltar)
  return () => window.removeEventListener('popstate', aoVoltar)
}
