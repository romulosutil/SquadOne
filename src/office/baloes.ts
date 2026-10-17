/**
 * PURO (17/10/2026, Central de comando): o texto dos balões do mapa e para onde o PO raiz vai.
 * Sem Vue, sem fetch, sem relógio (o `agora` vem de fora).
 *
 * O Rômulo pediu o Escritório como página inicial, "com agentes autônomos atuando em várias
 * frentes, em movimento como era antes, mais animado". O passeio ambiente nunca saiu (useOffice), mas
 * só a Sala Finanças falava. Aqui cada balão nasce de uma fonte que já existe e é lida pela tela:
 *  - salas do PRUMO: os robôs pelo status.json (estadoDoRobo) e os leads por passo da jornada
 *    (operacaoDaSala), os dois de office/operacao.ts;
 *  - Sala Finanças: % e semáforo de /api/financas/estado (nunca R$: o mapa aparece em print, RULES 24);
 *  - quem tem agenda: o bloco em curso ou o próximo compromisso de /api/time.
 * Sala que deveria ter fonte e não leu diz "Sem sinal" (RULES 2, 19 e 26). Sala sem fonte nenhuma não
 * ganha balão: o nome acessível do ator já diz "Sem sinal" (GameMap.vue).
 *
 * O passeio continua decoração e não implica "trabalhando". O único movimento que diz algo é o do PO
 * raiz: com um robô em falha ou pedindo para olhar, ele vai até a sala do problema e fica lá com o
 * balão em destaque; resolvido no status.json, volta para a mesa (destinoDoSupervisor).
 */
import { ehSalaDeFinancas, estadoDoAgente, type EstadoDasFinancas, type Semaforo } from './salaFinancas'
import type { OperacaoDaSala } from './operacao'

/** O semáforo das finanças vale para tudo: verde em dia, amarelo pede olhar, vermelho falhou. */
export type TomDoBalao = Semaforo | 'neutro' | 'sem_sinal'

export interface BalaoDaSala {
  texto: string
  tom: TomDoBalao
  /** Pede o Rômulo (falha ou "vale olhar" de um robô): o balão salta e o PO raiz vai até a sala. */
  destaque?: boolean
}

export const SEM_SINAL = 'Sem sinal'

/** O balão é uma linha só, em 8 px de mundo: mais que isso passa da sala vizinha. */
export const LIMITE_DO_BALAO = 34

export function cortar(texto: string, limite = LIMITE_DO_BALAO): string {
  const t = texto.replace(/\s+/g, ' ').trim()
  return t.length <= limite ? t : `${t.slice(0, limite - 1).trimEnd()}…`
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

// ------------------------------------------------------------------ finanças

/** A leitura de /api/financas/estado; null = não lida (falhou ou ainda não chegou). */
export type LeituraDasFinancas = { estado: EstadoDasFinancas | null } | null

export function balaoDeFinancas(leitura: LeituraDasFinancas): BalaoDaSala {
  if (!leitura) return { texto: SEM_SINAL, tom: 'sem_sinal' }
  const e = estadoDoAgente(leitura.estado)
  // Lida e sem cartão com limite nem orçamento no mês: não há o que medir, e não é "tudo bem".
  if (!e) return { texto: 'Sem orçamento no mês', tom: 'neutro' }
  return { texto: cortar(e.texto), tom: e.semaforo }
}

// ------------------------------------------------------------------ operação (PRUMO)

/**
 * Uma frase por sala da operação, do mais grave ao menos: robô que falhou, robô que pede olhar,
 * os leads da sala (com quantos esperam o Rômulo) e, nas salas só de robôs, se estão em dia.
 */
export function balaoDaOperacao(op: OperacaoDaSala): BalaoDaSala | null {
  const falhou = op.robos.find((r) => r.tom === 'falha')
  if (falhou) return { texto: cortar(`Falhou: ${falhou.nome}`), tom: 'vermelho', destaque: true }
  const olhar = op.robos.find((r) => r.tom === 'atencao')
  if (olhar) return { texto: cortar(`Vale olhar: ${olhar.nome}`), tom: 'amarelo', destaque: true }

  const j = op.jornada
  if (j?.estado === 'sem-sinal') return { texto: `${SEM_SINAL} de Vendas`, tom: 'sem_sinal' }
  if (j?.estado === 'ok') {
    const total = j.recortes.reduce((n, r) => n + r.total, 0)
    const comVoce = j.recortes.reduce((n, r) => n + r.comVoce, 0)
    const parados = j.recortes.reduce((n, r) => n + r.parados, 0)
    const velho = j.velho ? ' · velho' : ''
    if (comVoce) return { texto: cortar(`${comVoce} com você · ${plural(total, 'lead', 'leads')}${velho}`), tom: 'amarelo' }
    if (parados) return { texto: cortar(`${plural(parados, 'parado', 'parados')} · ${plural(total, 'lead', 'leads')}${velho}`), tom: 'amarelo' }
    return { texto: cortar(`${plural(total, 'lead', 'leads')}${velho}`), tom: 'neutro' }
  }

  if (!op.robos.length) return null
  if (op.robos.some((r) => r.tom === 'sem_sinal')) return { texto: SEM_SINAL, tom: 'sem_sinal' }
  const sozinho = op.robos.find((r) => r.tom === 'sozinho')
  if (sozinho) return { texto: cortar(`Resolve sozinho: ${sozinho.nome}`), tom: 'neutro' }
  return { texto: op.robos.length === 1 ? 'Robô em dia' : `${op.robos.length} robôs em dia`, tom: 'verde' }
}

/** Os balões por sala: a Sala Finanças pela leitura dela, as do PRUMO pela operação. */
export function baloesDasSalas(
  salas: ReadonlyArray<{ id: string; nome: string }>,
  fontes: { operacoes?: Readonly<Record<string, OperacaoDaSala>>; financas?: LeituraDasFinancas },
): Record<string, BalaoDaSala> {
  const saida: Record<string, BalaoDaSala> = {}
  for (const s of salas) {
    if (ehSalaDeFinancas(s)) {
      // `financas` ausente = a tela nem tenta ler (perfil app): sem fonte, sem balão.
      if (fontes.financas !== undefined) saida[s.id] = balaoDeFinancas(fontes.financas)
      continue
    }
    const op = fontes.operacoes?.[s.id]
    const b = op ? balaoDaOperacao(op) : null
    if (b) saida[s.id] = b
  }
  return saida
}

// ------------------------------------------------------------------ agenda

/** Espelho do que `/api/time` devolve de uma squad (casca/hoje.ts tem o tipo inteiro). */
export interface AgendaDaSquadLida {
  emBlocoAgora: Array<{ pessoaId: string; titulo: string }>
  proxima: { titulo: string; inicio: string; pessoaId: string } | null
}

const FUSO = 'America/Sao_Paulo'

/** "15:00" no mesmo dia, "amanhã 10:00", "sex 09:00" na semana, "24/10" depois. */
export function quandoCurto(iso: string, agora: number, fuso = FUSO): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const dia = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' }).format(new Date(t))
  const dias = Math.round((Date.parse(dia(t)) - Date.parse(dia(agora))) / 86_400_000)
  if (dias <= 0) return hora
  if (dias === 1) return `amanhã ${hora}`
  if (dias < 7) return `${new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'short' }).format(new Date(t)).replace('.', '')} ${hora}`
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' }).format(new Date(t))
}

/** Pessoa → balão, só de quem a agenda lida cita: em bloco agora vence o próximo. */
export function baloesDaAgenda(lida: AgendaDaSquadLida | null | undefined, agora: number, fuso = FUSO): Record<string, BalaoDaSala> {
  const saida: Record<string, BalaoDaSala> = {}
  if (!lida) return saida
  if (lida.proxima) {
    const q = quandoCurto(lida.proxima.inicio, agora, fuso)
    saida[lida.proxima.pessoaId] = { texto: cortar(`${q ? `${q}: ` : ''}${lida.proxima.titulo}`), tom: 'neutro' }
  }
  for (const b of lida.emBlocoAgora) saida[b.pessoaId] = { texto: cortar(`Em bloco: ${b.titulo}`), tom: 'verde' }
  return saida
}

// ------------------------------------------------------------------ quem vai aonde

const GRAVIDADE: Record<TomDoBalao, number> = { vermelho: 3, laranja: 2, amarelo: 1, verde: 0, neutro: 0, sem_sinal: 0 }

/**
 * A sala que o PO raiz visita: a do problema mais grave em destaque (vermelho antes de amarelo),
 * empate pela ordem das salas no andar. null = nada pede o Rômulo, e ele volta para a mesa.
 */
export function destinoDoSupervisor(baloes: Readonly<Record<string, BalaoDaSala>>, ordemDasSalas: readonly string[]): string | null {
  let melhor: string | null = null
  let pior = 0
  for (const id of ordemDasSalas) {
    const b = baloes[id]
    if (!b?.destaque) continue
    const g = GRAVIDADE[b.tom]
    if (g > pior) {
      pior = g
      melhor = id
    }
  }
  return melhor
}

/**
 * Pessoa → balão, na ordem de quem fala mais alto: a agenda de cada um, o balão da sala no PO dela
 * (o estado de uma sala é de quem responde por ela) e, por cima de tudo, o PO raiz em visita, que
 * leva o problema que foi ver. Na própria sala, a visita não muda nada: o balão já é dele.
 */
export function baloesDosAtores(
  dominios: ReadonlyArray<{ id: string; po: { id: string } }>,
  deSalas: Readonly<Record<string, BalaoDaSala>>,
  dePessoas: Readonly<Record<string, BalaoDaSala>> = {},
  visita: string | null = null,
): Record<string, BalaoDaSala> {
  const saida: Record<string, BalaoDaSala> = { ...dePessoas }
  for (const d of dominios) if (deSalas[d.id]) saida[d.po.id] = deSalas[d.id]
  const raiz = dominios[0]
  const alvo = visita ? dominios.find((d) => d.id === visita) : undefined
  if (raiz && alvo && alvo.id !== raiz.id && deSalas[alvo.id]) saida[raiz.po.id] = deSalas[alvo.id]
  return saida
}
