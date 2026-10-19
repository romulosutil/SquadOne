/**
 * PURO: para onde a casca navega, em cada perfil. Sem Vue e sem `window`,
 * para os testes fixarem a tabela de rotas sem montar nada.
 *
 * Dois eixos decidem o que existe:
 *  - `perfil`: `operations` (Dell) tem Funil, Finanças, Entrada e o estado do
 *    Dell; `app` (Easypanel, reserva fria) não tem nenhum deles. Desde 17/10/2026
 *    o `operations` tem três menus (Central de comando, Assistente, Vendas) e a
 *    Manutenção discreta; as outras rotas seguem existindo por endereço.
 *  - `agentes`: o app dos agentes (roster, turno, Mochila) mora neste processo.
 *    No `app` é sempre verdade; no `operations`, só com a agenda ligada.
 */

import { NOME_DAS_ABAS, caminhoDaAba } from '../operations/vendas-abas'

export type Perfil = 'app' | 'operations'

export interface Capacidades {
  perfil: Perfil
  agentes: boolean
  /**
   * O Assistente da Central (RULES 28, `assistente` no /api/runtime): no `operations` ele toma o
   * lugar do Pedir no ＋, na lateral e no Ctrl+K. Ausente ou falso, tudo fica como antes.
   */
  assistente?: boolean
}

/** O ＋ abre o Assistente em vez da folha Pedir: só no Dell e só com a flag ligada. */
export function usaAssistente(c: Capacidades): boolean {
  return c.perfil === 'operations' && c.assistente === true
}

export type RotaId = 'hoje' | 'agenda' | 'funil' | 'financas' | 'escritorio' | 'mais' | 'design-system' | 'nao-encontrada'

export interface Destino {
  id: Exclude<RotaId, 'nao-encontrada'> | 'entrada'
  rotulo: string
  href: string
  /** Glifo decorativo: o rótulo é sempre o nome acessível (RULES 4). */
  icone: string
}

const HOJE: Destino = { id: 'hoje', rotulo: 'Hoje', href: '/', icone: '◉' }
/**
 * A home do `operations` desde 17/10/2026: "os menus são Central de comando + Assistente + Vendas".
 * Mesma rota e mesmo id da Hoje (o `/`), outro nome e outra tela (rotas/CentralRota.vue).
 */
const CENTRAL: Destino = { id: 'hoje', rotulo: 'Central de comando', href: '/', icone: '◉' }
const AGENDA: Destino = { id: 'agenda', rotulo: 'Agenda', href: '/agenda', icone: '▦' }
const FUNIL: Destino = { id: 'funil', rotulo: 'Vendas', href: '/crm', icone: '▤' }
const ESCRITORIO: Destino = { id: 'escritorio', rotulo: 'Escritório', href: '/squadone', icone: '▣' }
const MAIS: Destino = { id: 'mais', rotulo: 'Mais', href: '/mais', icone: '≡' }
/** O Mais do `operations` encolheu para a Manutenção: some da barra e vira a engrenagem discreta. */
const MANUTENCAO: Destino = { id: 'mais', rotulo: 'Configurações', href: '/mais', icone: '⚙' }

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
  // Design system (16/10/2026; era /blueprint, renomeado no mesmo dia: o blueprint é o de serviço, docs/blueprint/): os tokens e os componentes vivos, nos dois perfis. Fora da barra e
  // do trilho (é ferramenta de quem mexe no app, não destino do dia); entra pelo Mais e pelo Ctrl+K.
  if (caminho === '/design-system') return 'design-system'
  if (caminho === '/agenda') return c.agentes ? 'agenda' : 'nao-encontrada'
  if (comeca(caminho, '/squadone')) return c.agentes ? 'escritorio' : 'nao-encontrada'
  if (c.perfil !== 'operations') return 'nao-encontrada'
  if (caminho === '/crm') return 'funil'
  if (comeca(caminho, '/financas')) return 'financas'
  return 'nao-encontrada'
}

/**
 * Trilho lateral (a partir de 1024 px). No `operations`, desde 17/10/2026, só os dois destinos dos
 * três menus (Central de comando e Vendas; o terceiro, o Assistente, é o botão ＋, não uma página);
 * Agenda, Finanças, Escritório e Entrada viraram faixas da Central, e o Mais virou a Manutenção
 * discreta (`destinoDiscreto`). No `app` (Easypanel, reserva fria) tudo fica como era.
 */
export function destinosLaterais(c: Capacidades): Destino[] {
  if (c.perfil === 'operations') return [CENTRAL, FUNIL, ...(c.agentes ? [AGENDA] : []), { id: 'financas', rotulo: 'Finanças', href: '/financas', icone: '◈' }, { id: 'entrada', rotulo: 'Entrada', href: '/entrada/', icone: '↧' }]
  return [HOJE, ...(c.agentes ? [AGENDA, ESCRITORIO] : []), MAIS]
}

/**
 * Barra inferior (abaixo de 1024 px), metade de cada lado do ＋. No `operations`, Central · ＋ · Vendas
 * (o ＋ no meio é o Assistente, o terceiro menu). No `app`, Hoje · Agenda · ＋ · Escritório · Mais.
 */
export function destinosDaBarra(c: Capacidades): Destino[] {
  if (c.perfil === 'operations') return [{ ...CENTRAL, rotulo: 'Escritório', icone: '▣' }, FUNIL, MAIS]
  return [HOJE, AGENDA, ESCRITORIO, MAIS]
}

/**
 * A Manutenção no `operations`: fora dos menus, mas a um toque de qualquer tela (a engrenagem do topo e
 * do trilho, e a do cabeçalho da Central). null no `app`, onde o Mais já está na barra.
 */
export function destinoDiscreto(c: Capacidades): Destino | null {
  return c.perfil === 'operations' ? MANUTENCAO : null
}

/**
 * O destino que leva `aria-current="page"`; null quando o caminho é de outro lugar. No `operations`, as
 * rotas que viraram faixa da Central (Agenda, Finanças) acendem a Central, e as que moram na Manutenção
 * (Escritório completo, design system) acendem a engrenagem.
 */
export function destinoAtual(caminhoCru: string, c: Capacidades): Destino['id'] | null {
  const rota = rotaDaCasca(caminhoCru, c)
  if (rota === 'nao-encontrada') return null
  // O design system mora dentro do Mais (a Manutenção, no Dell): é ele que fica aceso.
  if (rota === 'design-system') return 'mais'
  if (c.perfil === 'operations') {
    if (rota === 'agenda' || rota === 'financas') return 'mais'
    if (rota === 'escritorio') return 'mais'
  }
  return rota
}

/** O nome da home no perfil: "Central de comando" no Dell, "Hoje" no Easypanel. */
export function nomeDaHome(c: Capacidades): string {
  return c.perfil === 'operations' ? CENTRAL.rotulo : HOJE.rotulo
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
  | { tipo: 'assistente' }
  | { tipo: 'squad'; id: string }
  | { tipo: 'nova-squad' }

export interface Comando {
  id: string
  rotulo: string
  dica: string
  acao: AcaoDoComando
}

/**
 * A dica de cada destino diz a tela em palavras (17/10/2026, AC-23): o caminho cru (/crm,
 * /squadone) não dizia nada a quem não escreveu o roteador, e "squadone" nem é o nome da tela.
 */
const DICA_DO_DESTINO: Record<Destino['id'], string> = {
  hoje: 'O que fazer agora',
  agenda: 'Compromissos dos agentes, por dia',
  funil: caminhoDaAba('afazer'),
  financas: 'Finanças › Visão',
  escritorio: 'Squads e salas',
  entrada: 'Mande um texto ou arquivo para a Mel guardar',
  mais: 'Ajustes, ferramentas e manutenção',
  'design-system': 'Mais › Design system',
}
/** No Dell a home e o Mais mudaram de papel (17/10/2026); a dica acompanha. */
const DICA_NO_DELL: Partial<Record<Destino['id'], string>> = {
  hoje: 'Conversas prioritárias e primeiros contatos pelo time',
  mais: 'Equipe, Escritório completo, aparência, integrações e o Google',
  'design-system': 'Manutenção › Design system',
}

type Atalho = { id: string; rotulo: string; dica: string; href: string; soComAgentes?: boolean }

/**
 * Os atalhos do perfil `operations`. As abas de Vendas (17/10/2026, AC-23: buscar "triagem" dava
 * "Nada com…"); desde a Central de comando (17/10/2026), os saltos para as faixas dela (Finanças e
 * Agenda abrem a folha na própria Central, `?abrir=`) e o que mora na Manutenção. O rótulo é o nome
 * da tela; a dica diz onde ela mora. Lançamentos e Organizar seguem como caminhos de Finanças.
 */
const ATALHOS_DO_DELL: Atalho[] = [
  { id: 'vendas-afazer', rotulo: NOME_DAS_ABAS.afazer, dica: caminhoDaAba('afazer'), href: '/crm' },
  { id: 'vendas-triagem', rotulo: NOME_DAS_ABAS.triagem, dica: `${caminhoDaAba('triagem')} · avaliação do time e triagem`, href: '/crm?ver=triagem' },
  { id: 'vendas-funil', rotulo: NOME_DAS_ABAS.funil, dica: caminhoDaAba('funil'), href: '/crm?ver=funil' },
  { id: 'vendas-numeros', rotulo: NOME_DAS_ABAS.numeros, dica: caminhoDaAba('numeros'), href: '/crm?ver=numeros' },
  { id: 'central-escritorio', rotulo: 'Escritório', dica: 'Central de comando › o mapa das salas', href: '/?abrir=escritorio' },
  { id: 'financas-lancamentos', rotulo: 'Lançamentos', dica: 'Finanças › Lançamentos', href: '/financas/lancamentos' },
  { id: 'financas-organizar', rotulo: 'Organizar', dica: 'Finanças › Organizar', href: '/financas/organizar' },
  { id: 'mais-manutencao', rotulo: 'O que o Dell confere', dica: 'Manutenção › Dell', href: '/mais?abrir=manutencao' },
  { id: 'mais-escritorio', rotulo: 'Escritório completo', dica: 'Manutenção › contratar, editar e arquivar', href: '/squadone', soComAgentes: true },
  { id: 'mais-roteiro', rotulo: 'Roteiro de venda', dica: 'Manutenção › Roteiro de venda', href: '/mais?abrir=roteiro' },
]

/** O que a paleta oferece: o Assistente (ou o Pedir), ir a cada destino e atalho, trocar de squad. */
export function comandosDaPaleta(
  c: Capacidades,
  squads: Array<{ id: string; nome: string }>,
  ativaId: string | null
): Comando[] {
  const ops = c.perfil === 'operations'
  const dica = (id: Destino['id']) => (ops ? DICA_NO_DELL[id] : undefined) ?? DICA_DO_DESTINO[id]
  const destinos = [...destinosLaterais(c), ...(destinoDiscreto(c) ? [destinoDiscreto(c)!] : [])]
  const ir = destinos.map<Comando>((d) => ({
    id: `ir:${d.id}`,
    rotulo: `Ir para ${d.id === 'hoje' && ops ? 'a ' : ''}${d.rotulo}`,
    dica: dica(d.id),
    acao: { tipo: 'ir', href: d.href },
  }))
  ir.push({ id: 'ir:design-system', rotulo: 'Ir para o Design system', dica: dica('design-system'), acao: { tipo: 'ir', href: '/design-system' } })
  if (ops) {
    ir.push(
      ...ATALHOS_DO_DELL.filter((a) => !a.soComAgentes || c.agentes).map<Comando>((a) => ({
        id: `aba:${a.id}`, rotulo: a.rotulo, dica: a.dica, acao: { tipo: 'ir', href: a.href },
      }))
    )
  }
  // Com o Assistente, o primeiro comando é ele, com ou sem a agenda neste processo: sem agentes ele
  // ainda responde, só não oferece "Mandar para o time" (AssistenteCartao.vue).
  const primeiro: Comando[] = usaAssistente(c)
    ? [{ id: 'assistente', rotulo: 'Assistente', dica: 'Pergunte ou peça; ele propõe, você confirma', acao: { tipo: 'assistente' } }]
    : c.agentes
      ? [{ id: 'pedir', rotulo: 'Fazer um pedido', dica: 'Abre a folha Pedir', acao: { tipo: 'pedir' } }]
      : []
  if (!c.agentes) return [...primeiro, ...ir]
  return [
    ...primeiro,
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
