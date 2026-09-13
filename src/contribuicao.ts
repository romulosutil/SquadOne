import type {
  EstadoDeContribuicao,
  EventoAjustado,
  EventoCriado,
  PedidoDeContribuicao,
  RespostaDeAjuste
} from './types'

/**
 * Fila de contribuições da aba, sem Vue para ser verificável com tsx.
 *
 * EM SÉRIE de propósito: cada pedido faz o servidor chamar tokenValido(), e o
 * auth-store não tem lock de refresh — pedidos paralelos multiplicariam
 * refreshes concorrentes. A fila não persiste: recarregar a página perde o que
 * não rodou, e nada ficou gravado pela metade (o servidor faz um PATCH só).
 */

export const MAX_PESSOAS_POR_PEDIDO = 6

/** Um pedido por evento principal (foco ou marco) que o PO marcou com colaboradores. */
export function pedidosDoTurno(
  turno: { eventos_criados?: Pick<EventoCriado, 'eventId' | 'colaboradores_ids'>[] },
  squadId: string
): PedidoDeContribuicao[] {
  return (turno.eventos_criados ?? [])
    .filter((e) => e.colaboradores_ids?.length)
    .map((e) => ({ eventId: e.eventId, squadId, pessoaIds: [...(e.colaboradores_ids ?? [])] }))
}

export interface FilaDeContribuicao {
  enfileirar(p: PedidoDeContribuicao): void
  pendentes(): PedidoDeContribuicao[]
  /** Tira e devolve os que ainda não começaram. */
  limpar(): PedidoDeContribuicao[]
}

export function criarFila(
  executar: (p: PedidoDeContribuicao) => Promise<void>,
  aoMudar: () => void = () => {}
): FilaDeContribuicao {
  const pendentes: PedidoDeContribuicao[] = []
  let rodando = false

  const girar = async () => {
    if (rodando) return
    rodando = true
    try {
      while (pendentes.length) {
        const p = pendentes.shift()!
        aoMudar()
        try {
          await executar(p)
        } catch (err) {
          // O executor já captura; isto só impede que um bug trave a fila.
          console.error('Contribuição falhou fora do executor:', err)
        }
      }
    } finally {
      rodando = false
      aoMudar()
    }
  }

  return {
    enfileirar(p) {
      // Mesmo evento ainda esperando: junta as pessoas num pedido só (uma
      // chamada ao servidor, um PATCH). Se já está rodando, entra depois.
      const mesmo = pendentes.find((x) => x.eventId === p.eventId)
      if (mesmo) {
        for (const id of p.pessoaIds) {
          if (mesmo.pessoaIds.length >= MAX_PESSOAS_POR_PEDIDO) break
          if (!mesmo.pessoaIds.includes(id)) mesmo.pessoaIds.push(id)
        }
      } else {
        pendentes.push({ ...p, pessoaIds: [...new Set(p.pessoaIds)].slice(0, MAX_PESSOAS_POR_PEDIDO) })
      }
      aoMudar()
      void girar()
    },
    pendentes: () => pendentes.map((p) => ({ ...p, pessoaIds: [...p.pessoaIds] })),
    limpar() {
      const tirados = pendentes.splice(0)
      aoMudar()
      return tirados
    }
  }
}

/** `status` 0 = a requisição nem chegou ao servidor (rede). */
export function estadoDaResposta(pessoaIds: string[], status: number, corpo: any): EstadoDeContribuicao {
  if (status === 200) return { estado: 'feito', pessoaIds, resultados: corpo?.resultados ?? [] }
  return {
    estado: 'erro',
    pessoaIds,
    resultados: [],
    erro: corpo?.error ?? `HTTP ${status}`,
    ...(status === 401 ? { precisaConectar: true } : {}),
    ...(corpo?.questSumiu ? { questSumiu: true } : {})
  }
}

/**
 * Só o que tentar de novo pode resolver: Gemini ocupado, falta de espaço, ou o
 * pedido inteiro — menos credencial (é reconectar) e quest apagada (não volta).
 */
export function idsParaRepetir(e: EstadoDeContribuicao): string[] {
  if (e.estado === 'erro') return e.precisaConectar || e.questSumiu ? [] : e.pessoaIds
  if (e.estado !== 'feito') return []
  return e.resultados
    .filter((r) => 'erro' in r && (r.modeloOcupado || r.semEspaco))
    .map((r) => r.pessoa_id)
}

export function linhasDeStatus(
  e: EstadoDeContribuicao,
  nomes: Record<string, string>
): { texto: string; erro: boolean }[] {
  const nome = (id: string) => nomes[id] ?? id
  const lista = (ids: string[]) => ids.map(nome).join(', ')
  if (e.estado === 'fila') return [{ texto: `⏳ Na fila: ${lista(e.pessoaIds)}`, erro: false }]
  if (e.estado === 'rodando') return [{ texto: `🤝 ${lista(e.pessoaIds)} contribuindo...`, erro: false }]
  if (e.estado === 'erro') return [{ texto: `✗ ${e.erro ?? 'Falhou'}`, erro: true }]
  const linhas: { texto: string; erro: boolean }[] = []
  const oks = e.resultados.filter((r) => 'ok' in r)
  if (oks.length) {
    const cortado = oks.some((r) => 'ok' in r && r.truncado) ? ' (cortado)' : ''
    const verbo = oks.length === 1 ? 'contribuiu' : 'contribuíram'
    linhas.push({ texto: `✓ ${lista(oks.map((r) => r.pessoa_id))} ${verbo}${cortado}`, erro: false })
  }
  for (const r of e.resultados) {
    if ('erro' in r) linhas.push({ texto: `✗ ${nome(r.pessoa_id)}: ${r.erro}`, erro: true })
  }
  return linhas
}

/** Mesmo formato do servidor (`server/agendamento.ts`). */
export function formatarMinutos(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** Toast depois de aprovar: o que mudou no Google, mais os avisos do servidor. */
export function resumoDoAjuste(r: RespostaDeAjuste): string {
  const partes: string[] = []
  const hora = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (r.alvo === 'duracao' && r.eventos[0]) {
    const e = r.eventos[0]
    partes.push(
      e.acao === 'movido'
        ? `Bloco movido para ${new Date(e.inicio).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
        : `Bloco ${e.acao} até ${hora(e.fim)}`
    )
  }
  if (r.alvo === 'esforco') {
    const conta = (acao: EventoAjustado['acao']) => r.eventos.filter((e) => e.acao === acao).length
    if (conta('criado')) partes.push(`${conta('criado')} bloco(s) criado(s)`)
    if (conta('encurtado')) partes.push(`${conta('encurtado')} bloco(s) encurtado(s)`)
  }
  partes.push(...r.avisos)
  return partes.join(' · ') || 'Nada mudou'
}
