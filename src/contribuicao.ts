import { diasDoEventoDiaInteiro } from './mochila'
import {
  LIMITES_DE_AJUSTE,
  type EventoAjustado,
  type EventoCriado,
  type PropostaDeAjuste,
  type QuestCalendario,
  type RespostaDeAjuste,
  type TarefaCriada
} from './types'

/** Sem Vue para ser verificável com tsx. */

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

/**
 * Locale e fuso do navegador na UI; os testes fixam os dois para o texto não
 * depender da máquina. Dia inteiro ignora `timeZone` de propósito: "AAAA-MM-DD"
 * é dia de calendário, e reinterpretá-lo noutro fuso trocaria o dia.
 */
export interface FormatoDeData {
  locale?: string
  timeZone?: string
}

const duracaoMin = (e: EventoCriado) =>
  Math.round((new Date(e.fim).getTime() - new Date(e.inicio).getTime()) / 60000)

/**
 * O que foi marcado num evento criado, para o toast do turno: título, dia/hora
 * e duração. O modelo já decidia tudo isso; só não aparecia em lugar nenhum —
 * o toast antigo era genérico e só erro/aviso chegava na tela.
 */
export function resumoDoEvento(e: EventoCriado, fmt: FormatoDeData = {}): string {
  const zona = fmt.timeZone ? { timeZone: fmt.timeZone } : {}
  const dia = (iso: string) =>
    new Date(iso).toLocaleDateString(fmt.locale, { weekday: 'short', day: '2-digit', month: '2-digit', ...zona })
  const hora = (iso: string) =>
    new Date(iso).toLocaleTimeString(fmt.locale, { hour: '2-digit', minute: '2-digit', ...zona })

  if (e.dia_inteiro) {
    // `fim` do Google é exclusivo: o prazo é o ÚLTIMO dia, não o seguinte.
    const { primeiro, ultimo } = diasDoEventoDiaInteiro(e.inicio, e.fim)
    const diaLocal = (d: Date) => d.toLocaleDateString(fmt.locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
    const quando = ultimo.getTime() === primeiro.getTime()
      ? diaLocal(primeiro)
      : `${diaLocal(primeiro)} – ${diaLocal(ultimo)}`
    return e.papel === 'marco' ? `${e.titulo}: prazo em ${quando}` : `${e.titulo}: dia inteiro, ${quando}`
  }
  if (e.papel === 'marco') return `${e.titulo}: prazo ${dia(e.fim)} ${hora(e.fim)}`
  const rotulo = e.papel === 'bloco' ? 'bloco de ' : ''
  return `${e.titulo}: ${rotulo}${formatarMinutos(duracaoMin(e))}, ${dia(e.inicio)} ${hora(e.inicio)}–${hora(e.fim)}`
}

/**
 * Uma linha por compromisso do turno. Os blocos de um prazo entram DOBRADOS no
 * marco: um prazo pode render até 20 blocos, e listá-los um a um viraria um
 * muro de texto. Bloco cujo marco não veio neste turno (o marco já existia)
 * continua aparecendo sozinho. Lista e não string porque o bot do Telegram
 * mostra uma por linha e o toast junta numa só.
 */
export function linhasDosEventosCriados(eventos: EventoCriado[], fmt: FormatoDeData = {}): string[] {
  const marcos = new Set(eventos.filter((e) => e.papel === 'marco').map((e) => e.eventId))
  return eventos
    .filter((e) => !(e.papel === 'bloco' && e.prazo_ref && marcos.has(e.prazo_ref)))
    .map((e) => {
      const blocos = e.papel === 'marco' ? eventos.filter((b) => b.prazo_ref === e.eventId) : []
      const total = blocos.reduce((t, b) => t + duracaoMin(b), 0)
      const base = blocos.length
        ? `${resumoDoEvento(e, fmt)} (${blocos.length} bloco(s), ${formatarMinutos(total)})`
        : resumoDoEvento(e, fmt)
      // A checklist mora fora do app (Google Tasks): esta linha é o único lugar
      // em que o usuário fica sabendo que ela nasceu.
      return e.passos ? `${base} · ${e.passos} passo(s) no Google Tasks` : base
    })
}

/**
 * Uma linha por tarefa avulsa. A data é dia de calendário ("AAAA-MM-DD"), como
 * o dia inteiro: montada no fuso local e sem `timeZone`, para não trocar o dia.
 */
export function linhasDasTarefasCriadas(tarefas: TarefaCriada[], fmt: FormatoDeData = {}): string[] {
  return tarefas.map((t) => {
    let linha = `${t.titulo}: tarefa no Google Tasks`
    const m = t.data ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.data) : null
    if (m) {
      const dia = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      linha += `, para ${dia.toLocaleDateString(fmt.locale, { weekday: 'short', day: '2-digit', month: '2-digit' })}`
    }
    return t.passos ? `${linha} · ${t.passos} passo(s)` : linha
  })
}

/** Um toast para o turno inteiro (4 segundos na tela): as linhas numa só. */
export function resumoDosEventosCriados(
  eventos: EventoCriado[],
  fmt: FormatoDeData = {},
  tarefas: TarefaCriada[] = []
): string {
  return [...linhasDosEventosCriados(eventos, fmt), ...linhasDasTarefasCriadas(tarefas, fmt)].join(' · ')
}

/**
 * O que dá para ajustar nesta quest, ou "" quando nada. String e não null
 * porque o tsconfig do projeto não tem strictNullChecks: `null` não discrimina
 * a união e o template não conseguiria ler o alvo. Espelha o que
 * `aplicarAjuste` aceita — duração só em bloco com horário, esforço só no
 * marco de um prazo —, para o botão não abrir um card que vira 409.
 */
export function alvoDeAjuste(quest: QuestCalendario): 'duracao' | 'esforco' | '' {
  if (quest.tipo === 'deadline') return 'esforco'
  return quest.diaInteiro ? '' : 'duracao'
}

/** Minutos hoje reservados: a própria duração (bloco) ou a soma dos blocos do prazo (marco). */
export function minutosAtuais(quest: QuestCalendario, quests: QuestCalendario[]): number {
  const minutos = (q: QuestCalendario) =>
    Math.round((new Date(q.fim).getTime() - new Date(q.inicio).getTime()) / 60000)
  if (alvoDeAjuste(quest) === 'duracao') return minutos(quest)
  return quests
    .filter((q) => q.prazoRef === quest.eventId && !q.diaInteiro)
    .reduce((t, q) => t + minutos(q), 0)
}

/**
 * Põe `valor` na grade de 15 min e dentro dos limites do alvo, para o card não
 * mandar um `proposto_min` que o servidor devolveria como 400.
 */
export function normalizarPropostoMin(alvo: 'duracao' | 'esforco', valor: number): number {
  const { min, max } = LIMITES_DE_AJUSTE[alvo]
  const grade = LIMITES_DE_AJUSTE.grade
  if (!Number.isFinite(valor)) return min
  return Math.min(max, Math.max(min, Math.round(valor / grade) * grade))
}

/**
 * Ajuste iniciado pelo PRÓPRIO usuário na Mochila: monta a mesma proposta que
 * o `AjusteCard` já sabia mostrar, sem agente nenhum ter sugerido antes. O id
 * é derivado do evento, então clicar duas vezes não empilha dois cards do
 * mesmo compromisso. Devolve `null` quando a quest não aceita ajuste.
 */
export function propostaDoUsuario(
  quest: QuestCalendario,
  quests: QuestCalendario[],
  squadId: string,
  responsavel = ''
): PropostaDeAjuste | null {
  const alvo = alvoDeAjuste(quest)
  if (!alvo) return null
  const atual = minutosAtuais(quest, quests)
  return {
    id: `usuario:${quest.eventId}`,
    kind: 'ajuste',
    origem: 'usuario',
    squad_id: squadId,
    eventId: quest.eventId,
    titulo: quest.titulo,
    pessoa_id: quest.membro,
    pessoa_nome: responsavel || quest.membro,
    papel: '',
    alvo,
    atual_min: atual,
    // Começa no atual normalizado: o usuário edita no card, e aprovar sem
    // mexer não muda nada (o servidor responde "a duração proposta é a atual").
    proposto_min: normalizarPropostoMin(alvo, atual),
    motivo:
      alvo === 'duracao'
        ? 'Escolha a nova duração deste bloco.'
        : 'Escolha o esforço total reservado para este prazo.'
  }
}
