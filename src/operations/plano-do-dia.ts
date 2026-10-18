/**
 * PURO: o plano do dia da Hoje no Dell (17/10/2026, "a Central está muito reativa, precisa ser mais
 * proativa"). Até aqui a tela esperava o Rômulo olhar a fila; agora ela abre dizendo o dia: quanto já
 * foi feito, quanto falta, em que ordem e quanto tempo de janela de envio sobra. Quando a fila zera,
 * o que sobra é o gargalo do funil (por-que-nao-vende.ts), dito como a próxima coisa a fazer.
 *
 * Nada aqui é novo dado: tudo sai do resumo da fila (resumoDoDia, a contagem única do dia), das
 * ações já resolvidas e do relógio do expediente. Sem Vue, sem relógio (o `agora` é injetado) e sem
 * fetch.
 */
import type { Gargalo } from './por-que-nao-vende'
import type { ResumoDoDia } from './proxima-venda'
import { minutosAteFecharOExpediente, proximaAberturaDoExpediente } from './trava-de-horario'

export interface PlanoDoDia {
  feitas: number
  /** O que ainda falta hoje: a fila sem os primeiros contatos, mais quantos o ritmo deixa sair. */
  restantes: number
  /** feitas / (feitas + restantes), 0..1. */
  progresso: number
  /** A frase do dia: o estado em poucas palavras. */
  manchete: string
  /** O que falta, em ordem de venda: "2 respostas · 1 proposta · até 4 primeiros contatos". */
  oQueFalta: string
  /** Quanto tempo de janela de envio sobra, ou quando ela volta. */
  janela: string
  /** Falta pouco para fechar a janela e ainda há o que mandar: a tela destaca. */
  urgente: boolean
  /** Com a fila vazia, a próxima coisa a fazer em vez de esperar: a ação do gargalo. Vazio com trabalho na fila. */
  proximoPasso: string
}

export interface EntradaDoPlano {
  resumo: Pick<ResumoDoDia, 'total' | 'porGrupo' | 'primeirosAindaHoje'>
  /** Ações resolvidas hoje com "Enviei" (as puladas ficam na fila e não contam como feitas). */
  feitas: number
  agora: number
  gargalo: Pick<Gargalo, 'titulo' | 'acao'> | null
}

const pluraliza = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

function duracao(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const resto = min % 60
  return resto ? `${h} h ${resto} min` : `${h} h`
}

export function planoDoDia({ resumo, feitas, agora, gargalo }: EntradaDoPlano): PlanoDoDia {
  const minutos = minutosAteFecharOExpediente(agora)
  const noExpediente = minutos !== null
  const g = resumo.porGrupo
  // Só um primeiro contato entra na fila por vez; o dia tem tantos quantos o ritmo ainda deixa.
  // Fora do expediente eles esperam a janela: não entram na conta de "falta hoje".
  const primeiros = noExpediente ? resumo.primeirosAindaHoje : 0
  const semPrimeiros = resumo.total - g.primeiro
  const restantes = semPrimeiros + primeiros

  const partes: string[] = []
  if (g.responder) partes.push(pluraliza(g.responder, 'resposta', 'respostas'))
  if (g.proposta) partes.push(pluraliza(g.proposta, 'proposta', 'propostas'))
  if (g.followup) partes.push(pluraliza(g.followup, 'follow-up', 'follow-ups'))
  if (g.desfecho) partes.push(pluraliza(g.desfecho, 'recusa para marcar', 'recusas para marcar'))
  if (primeiros) partes.push(`até ${pluraliza(primeiros, 'primeiro contato', 'primeiros contatos')}`)

  const total = feitas + restantes
  const progresso = total ? Math.min(1, feitas / total) : 0

  let manchete: string
  if (restantes === 0 && feitas === 0) manchete = 'Nada esperando por você agora'
  else if (restantes === 0) manchete = `Em dia: ${pluraliza(feitas, 'envio feito', 'envios feitos')} hoje`
  else if (feitas === 0) manchete = `${pluraliza(restantes, 'ação', 'ações')} para hoje`
  else manchete = `${feitas} de ${total} feitas, ${restantes === 1 ? 'falta 1' : `faltam ${restantes}`}`

  // Resposta a quem escreveu não depende da janela (só o primeiro contato depende): a frase diz isso.
  const aindaHaPrimeiros = resumo.primeirosAindaHoje > 0
  let janela: string
  if (minutos !== null) {
    janela = minutos <= 60 && restantes > 0
      ? `Faltam ${duracao(minutos)} para fechar a janela de envio (17h30).`
      : `Janela de envio aberta até as 17h30 (faltam ${duracao(minutos)}).`
  } else {
    janela = `Fora do horário de envio: volta ${proximaAberturaDoExpediente(agora)}.${aindaHaPrimeiros ? ' Os primeiros contatos esperam por ela; as respostas não.' : ''}`
  }

  return {
    feitas,
    restantes,
    progresso,
    manchete,
    oQueFalta: partes.join(' · '),
    janela,
    urgente: minutos !== null && minutos <= 45 && restantes > 0,
    proximoPasso: restantes === 0 && gargalo ? `${gargalo.titulo}. ${gargalo.acao}` : '',
  }
}
