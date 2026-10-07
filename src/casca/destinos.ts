/**
 * PURO: para onde a casca navega, em cada perfil. Sem Vue e sem `window`,
 * para os testes fixarem a tabela de rotas sem montar nada.
 *
 * Dois eixos decidem o que existe:
 *  - `perfil`: `operations` (Dell) tem Funil, Finanças, Entrada e o estado do
 *    Dell; `app` (Easypanel, reserva fria) não tem nenhum deles.
 *  - `agentes`: o app dos agentes (roster, turno, Mochila) mora neste processo.
 *    No `app` é sempre verdade; no `operations`, só com a agenda ligada.
 */

export type Perfil = 'app' | 'operations'

export interface Capacidades {
  perfil: Perfil
  agentes: boolean
}

export type RotaId = 'hoje' | 'agenda' | 'funil' | 'financas' | 'escritorio' | 'mais' | 'nao-encontrada'

export interface Destino {
  id: Exclude<RotaId, 'nao-encontrada'> | 'entrada'
  rotulo: string
  href: string
  /** Glifo decorativo: o rótulo é sempre o nome acessível (RULES 4). */
  icone: string
}

const HOJE: Destino = { id: 'hoje', rotulo: 'Hoje', href: '/', icone: '◉' }
const AGENDA: Destino = { id: 'agenda', rotulo: 'Agenda', href: '/agenda', icone: '▦' }
const FUNIL: Destino = { id: 'funil', rotulo: 'Funil', href: '/crm', icone: '▤' }
const FINANCAS: Destino = { id: 'financas', rotulo: 'Finanças', href: '/financas', icone: 'R$' }
const ESCRITORIO: Destino = { id: 'escritorio', rotulo: 'Escritório', href: '/squadone', icone: '▣' }
/** Não é da SPA: o servidor repassa /entrada/ ao serviço da Entrada (RULES 23). */
const ENTRADA: Destino = { id: 'entrada', rotulo: 'Entrada', href: '/entrada/', icone: '⇣' }
const MAIS: Destino = { id: 'mais', rotulo: 'Mais', href: '/mais', icone: '≡' }

/** Normaliza o caminho: sem barra final, raiz vira "/". */
export function normalizarCaminho(caminho: string): string {
  return caminho.replace(/\/+$/, '') || '/'
}

const comeca = (caminho: string, base: string) => caminho === base || caminho.startsWith(`${base}/`)

/** A rota que a casca desenha para um caminho; o que não existe neste perfil é 404. */
export function rotaDaCasca(caminhoCru: string, c: Capacidades): RotaId {
  const caminho = normalizarCaminho(caminhoCru)
  if (caminho === '/') return 'hoje'
  if (caminho === '/mais') return 'mais'
  if (caminho === '/agenda') return c.agentes ? 'agenda' : 'nao-encontrada'
  if (comeca(caminho, '/squadone')) return c.agentes ? 'escritorio' : 'nao-encontrada'
  if (c.perfil !== 'operations') return 'nao-encontrada'
  if (caminho === '/crm') return 'funil'
  if (comeca(caminho, '/financas')) return 'financas'
  return 'nao-encontrada'
}

/**
 * Trilho lateral (a partir de 1024 px): todos os destinos do perfil. O Pedir
 * não entra aqui: é um botão, não uma página.
 */
export function destinosLaterais(c: Capacidades): Destino[] {
  const ops = c.perfil === 'operations'
  return [
    HOJE,
    ...(c.agentes ? [AGENDA] : []),
    ...(ops ? [FUNIL, FINANCAS] : []),
    ...(c.agentes ? [ESCRITORIO] : []),
    ...(ops ? [ENTRADA] : []),
    MAIS,
  ]
}

/**
 * Barra inferior (abaixo de 1024 px): quatro destinos, dois de cada lado do
 * ＋Pedir. No Dell é a de design.md (Hoje · Funil · Finanças · Mais); sem Funil
 * nem Finanças (Easypanel), Agenda e Escritório ocupam os lugares.
 */
export function destinosDaBarra(c: Capacidades): Destino[] {
  if (c.perfil === 'operations') return [HOJE, FUNIL, FINANCAS, MAIS]
  return [HOJE, AGENDA, ESCRITORIO, MAIS]
}

/** O destino que leva `aria-current="page"`; null quando o caminho é de outro lugar. */
export function destinoAtual(caminhoCru: string, c: Capacidades): Destino['id'] | null {
  const rota = rotaDaCasca(caminhoCru, c)
  return rota === 'nao-encontrada' ? null : rota
}

/**
 * Um clique num link vira navegação dentro da casca (sem recarregar) só para
 * as rotas que ela desenha. Recarregar a página no meio de um turno perderia a
 * resposta dele; o resto (`/entrada/`, `/api/...`, outro host) navega de verdade.
 */
export function ehLinkDaCasca(href: string, origem: string, c: Capacidades): boolean {
  let url: URL
  try {
    url = new URL(href, origem)
  } catch {
    return false
  }
  if (url.origin !== new URL(origem).origin) return false
  return rotaDaCasca(url.pathname, c) !== 'nao-encontrada'
}

// ---------------------------------------------------------------- Ctrl+K

export type AcaoDoComando =
  | { tipo: 'ir'; href: string }
  | { tipo: 'pedir' }
  | { tipo: 'squad'; id: string }
  | { tipo: 'nova-squad' }

export interface Comando {
  id: string
  rotulo: string
  dica: string
  acao: AcaoDoComando
}

/** O que a paleta oferece: ir a cada destino, pedir e trocar de squad. */
export function comandosDaPaleta(
  c: Capacidades,
  squads: Array<{ id: string; nome: string }>,
  ativaId: string | null
): Comando[] {
  const ir = destinosLaterais(c).map<Comando>((d) => ({
    id: `ir:${d.id}`,
    rotulo: `Ir para ${d.rotulo}`,
    dica: d.href,
    acao: { tipo: 'ir', href: d.href },
  }))
  if (!c.agentes) return ir
  return [
    { id: 'pedir', rotulo: 'Fazer um pedido', dica: 'Abre a folha Pedir', acao: { tipo: 'pedir' } },
    ...ir,
    ...squads
      .filter((s) => s.id !== ativaId)
      .map<Comando>((s) => ({ id: `squad:${s.id}`, rotulo: `Trocar para a squad ${s.nome}`, dica: 'Squad ativa desta aba', acao: { tipo: 'squad', id: s.id } })),
    { id: 'nova-squad', rotulo: 'Criar uma squad', dica: 'Nome, escopo e PO', acao: { tipo: 'nova-squad' } },
  ]
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Todas as palavras do termo aparecem no rótulo, sem diferenciar acento nem caixa. */
export function filtrarComandos(comandos: Comando[], termo: string): Comando[] {
  const palavras = semAcento(termo).split(/\s+/).filter(Boolean)
  if (!palavras.length) return comandos
  return comandos.filter((cmd) => {
    const alvo = semAcento(`${cmd.rotulo} ${cmd.dica}`)
    return palavras.every((p) => alvo.includes(p))
  })
}
