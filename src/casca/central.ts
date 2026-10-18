/**
 * PURO (17/10/2026): a Central de comando, a home do perfil `operations`. Sem Vue, sem relógio e
 * sem `fetch`: o CentralRota.vue lê as fontes e entrega aqui só o que foi lido.
 *
 * O pedido do Rômulo: "os menus são Central de comando + Assistente + Vendas. O BI já tem boas
 * coisas, mas está espalhado e sem cara de centro de comando. O Escritório poderia ser a página
 * inicial, com agentes autônomos em movimento. Finanças, Agenda e Entrada poderiam estar aqui."
 * Por isso a Central é: o estado do Dell e o que precisa dele (no máximo 3 cartões, RULES 13), o
 * Escritório animado no centro e, embaixo, uma faixa de uma linha por frente (Vendas, Agenda,
 * Finanças, Entrada, Dell). A faixa resume; o detalhe abre numa folha dentro da Central ou na
 * rota inteira, que continua existindo por endereço.
 *
 * Regra que atravessa o arquivo (RULES 2 e 19): faixa sem leitura diz que não leu ("Sem sinal…"),
 * nunca zero nem "tudo certo".
 */
import { ROTULO_DO_SEMAFORO } from '../operations/financas/formato'
import { SIGLA_DO_PRODUTO } from '../operations/crm-formato'
import type { ResumoDoDell } from '../operations/alertas'
import type { CrmProduto } from '../operations/types'
import type { Semaforo } from '../office/salaFinancas'
import type { Guardador } from '../office/vista'
import type { EstadoDasFinancasLido } from './hoje'

export type IdDaFaixa = 'vendas' | 'agenda' | 'financas' | 'entrada' | 'dell'

/** As frentes, nesta ordem: o que vira dinheiro primeiro, depois o dia, o dinheiro de casa, o que entra e a máquina. */
export const ORDEM_DAS_FAIXAS: readonly IdDaFaixa[] = ['vendas', 'agenda', 'financas', 'entrada', 'dell']

export type TomDaFaixa = 'ok' | 'atencao' | 'falha' | 'neutro' | 'sem_sinal'

export interface ItemDaFaixa {
  quando: string
  titulo: string
  href?: string
}

export interface Faixa {
  id: IdDaFaixa
  titulo: string
  /** A linha que importa: o próximo passo, o semáforo, o estado. */
  linha: string
  /** A segunda linha, mais apagada (a contagem, o gargalo, a fonte). */
  detalhe: string
  tom: TomDaFaixa
  /** Os próximos compromissos (só na Agenda). */
  itens?: ItemDaFaixa[]
  /** Tocar abre uma folha dentro da Central; null = o toque segue o link. */
  folha: 'financas' | 'agenda' | null
  /** A rota inteira (ou a Entrada, que não é da SPA). */
  href: string
  rotuloDoLink: string
  /** `/entrada/` é outro serviço repassado pelo servidor (RULES 23): navegação de verdade. */
  externo?: boolean
}

// ------------------------------------------------------------------ fontes, como a tela as leu

/** Leitura que falhou: o motivo vira o "Sem sinal". */
export interface Falhou { erro: string }
const falhou = (x: unknown): x is Falhou => !!x && typeof x === 'object' && 'erro' in x

export interface AcaoDaFaixa { titulo: string; produto: CrmProduto; quente: boolean }

export interface FontesDasFaixas {
  /** null = lendo. `resumo` é o resumoDaFila; `gargalo`, o título do "por que não vende". */
  vendas: { fila: AcaoDaFaixa[]; resumo: string; gargalo: string | null } | Falhou | null
  agenda: { itens: ItemDaFaixa[]; restantes: number; fonte: string } | Falhou | null
  financas: { estado: EstadoDasFinancasLido | null } | Falhou | null
  entrada: { pendentes: number; avisos: number } | Falhou | null
  dell: ResumoDoDell | Falhou | null
}

const GRAVIDADE: Record<Semaforo, number> = { verde: 0, amarelo: 1, laranja: 2, vermelho: 3 }
const TOM_DO_SEMAFORO: Record<Semaforo, TomDaFaixa> = { verde: 'ok', amarelo: 'atencao', laranja: 'atencao', vermelho: 'falha' }
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

function faixaDeVendas(f: FontesDasFaixas['vendas']): Omit<Faixa, 'id' | 'titulo' | 'folha' | 'href' | 'rotuloDoLink'> {
  if (!f) return { linha: 'Lendo Vendas…', detalhe: '', tom: 'sem_sinal' }
  if (falhou(f)) return { linha: 'Sem sinal de Vendas', detalhe: f.erro, tom: 'sem_sinal' }
  const [primeira] = f.fila
  // O passo e a oferta, sem o texto da mensagem: a mensagem pronta mora em Vendas › A fazer.
  const linha = primeira ? `Agora: ${primeira.titulo} · ${SIGLA_DO_PRODUTO[primeira.produto]}` : 'Nenhuma conversa esperando você'
  const detalhe = [f.resumo, f.gargalo ? `Gargalo: ${f.gargalo}` : ''].filter(Boolean).join(' · ')
  return { linha, detalhe, tom: primeira?.quente ? 'atencao' : primeira ? 'neutro' : 'ok' }
}

function faixaDaAgenda(f: FontesDasFaixas['agenda']): Omit<Faixa, 'id' | 'titulo' | 'folha' | 'href' | 'rotuloDoLink'> {
  if (!f) return { linha: 'Lendo a agenda…', detalhe: '', tom: 'sem_sinal' }
  if (falhou(f)) return { linha: 'Sem sinal da agenda', detalhe: f.erro, tom: 'sem_sinal' }
  if (!f.itens.length) return { linha: 'Nada marcado pela frente', detalhe: f.fonte, tom: 'ok', itens: [] }
  const mais = f.restantes ? ` · mais ${f.restantes}` : ''
  return { linha: plural(f.itens.length, 'próximo compromisso', 'próximos compromissos'), detalhe: `${f.fonte}${mais}`, tom: 'neutro', itens: f.itens }
}

function faixaDeFinancas(f: FontesDasFaixas['financas']): Omit<Faixa, 'id' | 'titulo' | 'folha' | 'href' | 'rotuloDoLink'> {
  if (!f) return { linha: 'Lendo as finanças…', detalhe: '', tom: 'sem_sinal' }
  if (falhou(f)) return { linha: 'Sem sinal das finanças', detalhe: f.erro, tom: 'sem_sinal' }
  const cores = [f.estado?.cartao?.semaforo, f.estado?.orcamento?.semaforo].filter((s): s is Semaforo => !!s)
  const pior = cores.reduce<Semaforo | null>((a, b) => (a === null || GRAVIDADE[b] > GRAVIDADE[a] ? b : a), null)
  const pcts = [
    f.estado?.cartao ? `cartão ${f.estado.cartao.pct}%` : '',
    f.estado?.orcamento ? `orçamento ${f.estado.orcamento.pct}%` : '',
  ].filter(Boolean).join(' · ')
  // Sem R$ na faixa (decisão do dono, 17/10/2026): a tela inicial aparece em print e a quem está ao lado;
  // os valores ficam na folha que ele abre de propósito (Visão), nunca na home.
  if (!pior) return { linha: 'Sem orçamento nem cartão com limite', detalhe: '', tom: 'neutro' }
  return { linha: ROTULO_DO_SEMAFORO[pior], detalhe: pcts, tom: TOM_DO_SEMAFORO[pior] }
}

function faixaDaEntrada(f: FontesDasFaixas['entrada']): Omit<Faixa, 'id' | 'titulo' | 'folha' | 'href' | 'rotuloDoLink'> {
  // A Entrada é outro serviço: sem resposta, o envio ainda pode funcionar; a faixa só não afirma nada.
  if (!f) return { linha: 'Mande um texto ou arquivo para a Mel guardar', detalhe: '', tom: 'neutro' }
  if (falhou(f)) return { linha: 'Mande um texto ou arquivo para a Mel guardar', detalhe: `Sem sinal da Entrada: ${f.erro}`, tom: 'sem_sinal' }
  const detalhe = [
    f.pendentes ? `${plural(f.pendentes, 'envio', 'envios')} para organizar` : 'Nada esperando para organizar',
    f.avisos ? plural(f.avisos, 'aviso', 'avisos') : '',
  ].filter(Boolean).join(' · ')
  return { linha: 'Mande um texto ou arquivo para a Mel guardar', detalhe, tom: f.avisos ? 'atencao' : 'ok' }
}

function faixaDoDell(f: FontesDasFaixas['dell']): Omit<Faixa, 'id' | 'titulo' | 'folha' | 'href' | 'rotuloDoLink'> {
  if (!f) return { linha: 'Conferindo o Dell…', detalhe: '', tom: 'sem_sinal' }
  if (falhou(f)) return { linha: 'Dell sem resposta', detalhe: f.erro, tom: 'falha' }
  // Sem retrato recente, a contagem é do último: diz de quando, em vez de parecer o agora (RULES 19).
  if (f.semNoticia) return { linha: f.textoPrecisam, detalhe: f.total ? `No último retrato, ${f.ok} de ${f.total} ok` : '', tom: 'sem_sinal' }
  // O "N precisam de você" é o cabeçalho da Central (um lugar só para o número): aqui, a saúde.
  const linha = `${f.ok} de ${f.total} ok`
  return { linha, detalhe: [f.hora ? `conferido às ${f.hora}` : '', f.textoSozinhas].filter(Boolean).join(' · '), tom: f.vermelhos ? 'falha' : f.precisam.length ? 'atencao' : 'ok' }
}

/**
 * As faixas da Central, na ordem de ORDEM_DAS_FAIXAS. `agentes` decide se a Agenda abre a folha com
 * a agenda dos agentes (AgendaRota) ou só mostra o dia do Google Calendar.
 */
export function faixasDaCentral(fontes: FontesDasFaixas, agentes: boolean): Faixa[] {
  const montar: Record<IdDaFaixa, () => Faixa> = {
    vendas: () => ({ id: 'vendas', titulo: 'Vendas', ...faixaDeVendas(fontes.vendas), folha: null, href: '/crm', rotuloDoLink: 'Abrir Vendas' }),
    agenda: () => ({
      id: 'agenda', titulo: 'Agenda', ...faixaDaAgenda(fontes.agenda),
      folha: agentes ? 'agenda' : null, href: agentes ? '/agenda' : 'https://calendar.google.com/', rotuloDoLink: agentes ? 'Ver a agenda' : 'Abrir o Google Agenda',
      ...(agentes ? {} : { externo: true }),
    }),
    financas: () => ({ id: 'financas', titulo: 'Finanças', ...faixaDeFinancas(fontes.financas), folha: 'financas', href: '/financas', rotuloDoLink: 'Ver as finanças' }),
    entrada: () => ({ id: 'entrada', titulo: 'Entrada', ...faixaDaEntrada(fontes.entrada), folha: null, href: '/entrada/', rotuloDoLink: 'Enviar para a Mel', externo: true }),
    dell: () => ({ id: 'dell', titulo: 'Dell', ...faixaDoDell(fontes.dell), folha: null, href: '/mais?abrir=manutencao', rotuloDoLink: 'Ver o que o Dell confere' }),
  }
  return ORDEM_DAS_FAIXAS.map((id) => montar[id]())
}

// ------------------------------------------------------------------ o andar do mapa

export const CHAVE_DO_ANDAR = 'squadone:central:andar'

/**
 * O andar que a Central mostra: o guardado (se a squad ainda existe), senão o primeiro com operação
 * (os robôs e os leads do PRUMO são o que mais se mexe), senão o primeiro. É escolha da Central, não a
 * squad ativa da aba: trocar de andar aqui não troca a squad dos pedidos.
 */
export function andarDaCentral(
  squads: ReadonlyArray<{ id: string; dominios: ReadonlyArray<{ id: string }> }>,
  guardado: string | null,
  temOperacao: (salaIds: string[]) => boolean,
): string | null {
  if (guardado && squads.some((s) => s.id === guardado)) return guardado
  return squads.find((s) => temOperacao(s.dominios.map((d) => d.id)))?.id ?? squads[0]?.id ?? null
}

export function lerAndar(storage: Guardador | null | undefined): string | null {
  try {
    return storage?.getItem(CHAVE_DO_ANDAR) || null
  } catch {
    return null
  }
}

export function gravarAndar(storage: Guardador | null | undefined, id: string): void {
  try {
    storage?.setItem(CHAVE_DO_ANDAR, id)
  } catch {
    // sem storage: vale até recarregar
  }
}

// ------------------------------------------------------------------ o que o endereço pede

/** `/?abrir=financas|agenda` abre a folha (o Ctrl+K e os links antigos); `escritorio` rola até o mapa. */
export type PedidoDaCentral = 'financas' | 'agenda' | 'escritorio' | null

export function pedidoDaCentral(search: string): PedidoDaCentral {
  const v = new URLSearchParams(search).get('abrir')
  return v === 'financas' || v === 'agenda' || v === 'escritorio' ? v : null
}

/** O status do mapa, uma frase com a fonte: quantas salas pedem o Rômulo, do retrato de que horas. */
export function statusDoMapa(destaques: number, horaDoDell: string, semNoticia: boolean): string {
  if (semNoticia) return 'Sem notícia do Dell: os robôs estão sem sinal'
  const quando = horaDoDell ? ` (Dell às ${horaDoDell})` : ''
  if (!destaques) return `Nenhuma sala pede você${quando}`
  return `${plural(destaques, 'sala pede', 'salas pedem')} você${quando}`
}

// ---------------------------------------------------------------- o "Escritório completo"

/** O mesmo texto do App.vue e do SquadSelector quando a troca de squad é recusada. */
export const AVISO_DA_TROCA_RECUSADA = 'Espere o pedido em andamento terminar para trocar de squad.'

/**
 * PURO (revisão de 17/10/2026). Depois do "Abrir o Escritório completo": a troca de squad recusada (um
 * pedido em andamento, `trocarSquad` devolve false) não navega, porque o Escritório abriria na squad
 * ativa, que não é o andar que se estava olhando; avisa e fica na Central. Sem troca, ou trocada, navega.
 */
export function depoisDaTrocaDeAndar(precisouTrocar: boolean, trocou: boolean): { navegar: true } | { navegar: false; aviso: string } {
  return !precisouTrocar || trocou ? { navegar: true } : { navegar: false, aviso: AVISO_DA_TROCA_RECUSADA }
}
