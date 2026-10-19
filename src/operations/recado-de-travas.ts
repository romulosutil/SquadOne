/**
 * PURO (17/10/2026): as duas travas do primeiro contato num recado só, que diz o PRÓXIMO PASSO.
 *
 * Até aqui cada tela empilhava dois avisos: o do horário (trava-de-horario.ts, com a taxa medida de
 * resultados.ts) e o do ritmo (trava-de-ritmo.ts, textoDoRitmo). Os dois diziam o que estava errado,
 * nenhum dizia quando voltava, e o botão principal ficava desabilitado sem o "e agora?". O dono, ao
 * vivo: "não sei o que fazer e em que ordem". Daqui sai UMA frase por estado, sempre com o quando:
 *
 *  - "Pode enviar agora"
 *  - "Libera às 14:20 (ritmo)"                       intervalo ou teto da hora
 *  - "Teto de hoje (10 de 10): volta segunda às 8h"   teto do dia, já pulando o fim de semana
 *  - "Pausado até 18/10 09:00 (aviso do WhatsApp)"
 *  - "Fora do expediente: volta segunda às 8h"        com o "Liberar" possível ao lado
 *
 * e o que continua livre (responder, follow-up, Dispensar), para a trava nunca parecer a tela toda parada.
 *
 * As regras não mudam: a ordem é a de sempre (o ritmo antes do horário, porque ele não tem "Liberar" e
 * liberar o horário com o ritmo segurando não destravaria nada) e `pode` é exatamente
 * `podeMandarPrimeiroContato`. Este módulo só lê as funções das travas, nunca as altera.
 */
import { dataHora, hora } from './crm-formato'
import { EXPEDIENTE_DE_VENDA, noExpedienteDeVenda, podeMandarPrimeiroContato } from './trava-de-horario'
import { indiceDoDiaSP, textoDoRitmo, type EstadoDoRitmo } from './trava-de-ritmo'

const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA
/** São Paulo é UTC−3 o ano todo desde 2019 (o mesmo atalho das duas travas). */
const FUSO_MS = 3 * HORA

const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

/** "8h" ou "8h30": o jeito de dizer hora cheia numa frase, sem o ":00". */
function horaFalada(minutos: number): string {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

/**
 * PURO. Quando o expediente de venda abre de novo a partir de `agora` (ms). Dentro dele, é o próprio
 * `agora`. Procura uma semana à frente: o expediente tem dias úteis, então sempre acha.
 */
export function proximaAbertura(agora: number): number | null {
  if (!Number.isFinite(agora)) return null
  if (noExpedienteDeVenda(agora)) return agora
  const hoje = indiceDoDiaSP(agora)
  for (let k = 0; k <= 7; k++) {
    const dia = hoje + k
    const semana = new Date(dia * DIA).getUTCDay()
    if (!(EXPEDIENTE_DE_VENDA.dias as readonly number[]).includes(semana)) continue
    const abre = dia * DIA + EXPEDIENTE_DE_VENDA.inicioMin * MIN + FUSO_MS
    if (abre > agora) return abre
  }
  return null
}

/** PURO. "hoje às 8h", "amanhã às 8h", "segunda às 8h": o dia contado a partir de `agora`. */
export function quandoFalado(instante: number, agora: number): string {
  const dias = indiceDoDiaSP(instante) - indiceDoDiaSP(agora)
  const minutos = Math.round(((instante - FUSO_MS) % DIA + DIA) % DIA / MIN)
  const dia = dias <= 0 ? 'hoje' : dias === 1 ? 'amanhã' : DIAS_DA_SEMANA[new Date(indiceDoDiaSP(instante) * DIA).getUTCDay()]
  return `${dia} às ${horaFalada(minutos)}`
}

/** Em que tela o recado aparece: muda só o que continua livre e o rótulo do "Liberar". */
export type ContextoDoRecado = 'venda' | 'triagem' | 'ficha'

/** O que segura agora: nada, o ritmo (sem "Liberar") ou o horário (com "Liberar"). */
export type TravaQueSegura = 'nenhuma' | 'ritmo' | 'horario'

export interface EntradaDoRecado {
  agora: number
  /** O "Liberar" do dia para este lead (ou para o lote inteiro, na Triagem). */
  liberado: boolean
  ritmo: EstadoDoRitmo
  contexto: ContextoDoRecado
  /** Já calculado pela tela (noExpedienteDeVenda); ausente, calcula aqui. */
  noExpediente?: boolean
  /** O porquê do horário com a taxa medida (avisoDeHorario de resultados.ts), quando a tela o tem. */
  taxa?: string | null
}

export interface RecadoDeTravas {
  /** Dá para mandar o primeiro contato agora (podeMandarPrimeiroContato). */
  pode: boolean
  trava: TravaQueSegura
  /** A frase do próximo passo, sem ponto final. */
  titulo: string
  /** O porquê, para quem quiser ler (a taxa medida, o texto longo do ritmo). */
  detalhe: string
  /** O que continua possível enquanto a trava segura; vazio quando nada segura. */
  continua: string
  /** Só o horário segura: o "Liberar" faz sentido (o ritmo não se libera). */
  podeLiberar: boolean
  /** Quando a trava solta (ms); null sem trava ou sem como saber. */
  ate: number | null
}

const O_QUE_CONTINUA: Record<ContextoDoRecado, string> = {
  venda: 'Respostas, propostas e follow-ups seguem livres.',
  triagem: 'Dispensar continua livre.',
  ficha: 'Responder e o follow-up seguem livres.',
}

/** PURO. O recado único das duas travas, com o próximo passo dito em linguagem simples. */
export function recadoDasTravas(e: EntradaDoRecado): RecadoDeTravas {
  const noExpediente = e.noExpediente ?? noExpedienteDeVenda(e.agora)
  const ritmoLivre = e.ritmo.motivo === null
  const pode = podeMandarPrimeiroContato({ noExpediente, liberado: e.liberado, ritmoLivre })
  const continua = O_QUE_CONTINUA[e.contexto]
  const longoDoRitmo = textoDoRitmo(e.ritmo)
  const foraSemLiberar = !noExpediente && !e.liberado

  if (!ritmoLivre) {
    const ate = e.ritmo.ate
    // Depois do ritmo, o horário ainda pode segurar: dizer agora evita a surpresa às 18:04.
    const depois = foraSemLiberar && e.ritmo.motivo !== 'dia' ? ' Depois disso ainda é fora do expediente.' : ''
    switch (e.ritmo.motivo) {
      case 'pausa':
        return { pode, trava: 'ritmo', titulo: `Pausado até ${ate === null ? '—' : dataHora(new Date(ate).toISOString())} (aviso do WhatsApp)`, detalhe: longoDoRitmo + depois, continua, podeLiberar: false, ate }
      case 'dia': {
        // O teto zera à meia-noite, mas o próximo envio só sai quando o expediente abre.
        const volta = ate === null ? null : proximaAbertura(ate)
        const quando = volta === null ? 'amanhã' : `volta ${quandoFalado(volta, e.agora)}`
        return { pode, trava: 'ritmo', titulo: `Teto de hoje (${e.ritmo.enviadosHoje} de ${e.ritmo.teto}): ${quando}`, detalhe: longoDoRitmo, continua, podeLiberar: false, ate: volta }
      }
      default:
        return { pode, trava: 'ritmo', titulo: `Libera às ${ate === null ? '—' : hora(new Date(ate).toISOString())} (ritmo)`, detalhe: longoDoRitmo + depois, continua, podeLiberar: false, ate }
    }
  }

  if (foraSemLiberar) {
    const volta = proximaAbertura(e.agora)
    return {
      pode, trava: 'horario',
      titulo: `Fora do expediente: volta ${volta === null ? 'no próximo dia útil' : quandoFalado(volta, e.agora)}`,
      detalhe: e.taxa ?? '', continua, podeLiberar: true, ate: volta,
    }
  }

  return {
    pode, trava: 'nenhuma',
    titulo: noExpediente ? 'Pode enviar agora' : 'Liberado fora do expediente: pode enviar agora',
    detalhe: longoDoRitmo, continua: '', podeLiberar: false, ate: null,
  }
}

/**
 * PURO. O rótulo do "Liberar" no recado: diz quem sai da trava. Na Triagem é o lote inteiro, uma vez
 * (era um botão por linha); na Ficha, o lead aberto.
 */
export function rotuloDoLiberar(contexto: ContextoDoRecado, o: { empresa?: string; quantos?: number } = {}): string {
  if (contexto === 'triagem') return o.quantos && o.quantos > 1 ? `Liberar este lote (${o.quantos}) mesmo assim` : 'Liberar mesmo assim'
  if (contexto === 'venda' && o.empresa) return `Liberar ${o.empresa} mesmo assim`
  return 'Liberar este lead mesmo assim'
}
