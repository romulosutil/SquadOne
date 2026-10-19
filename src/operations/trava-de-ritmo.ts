/**
 * PURO (o storage entra por parâmetro): a trava de ritmo dos primeiros contatos (15/10/2026).
 *
 * Em 15/10/2026 o WhatsApp do Rômulo levou 24 h de restrição depois de 25 primeiros contatos em
 * 25 minutos (10 a 50 s entre um e outro), logo depois de 26 no dia 14 e 18 no dia 13. A fila
 * "Enviar um por um" deixava esvaziar 25 sites de uma vez. A proximidade da restrição não
 * comprova qual sinal a causou. Plano em docs/superpowers/plans/2026-10-15-envio-whatsapp-sem-bloqueio.md.
 *
 * Três limites, todos sobre PRIMEIRO contato (os mesmos links da trava de horário,
 * `linksDePrimeiroContato`: envio do Site, convite do PRUMO/Iris/estamparias e o reenvio do
 * só-robô). Resposta, 2ª mensagem e follow-up de quem leu não contam: são conversa.
 *  - intervalo mínimo entre dois primeiros contatos;
 *  - teto por hora (janela móvel de 60 min);
 *  - teto por dia (dia de São Paulo). Desde 18/10/2026, 100; a configuração ainda aceita rampa.
 * E `pausadoAte`: depois de um aviso ou restrição do WhatsApp, nada sai até a data (editar e
 * fazer push; a Central se atualiza sozinha em até 10 min).
 *
 * São limites operacionais internos, não uma faixa segura publicada pelo WhatsApp. Envio
 * manual também pode ser restringido, mesmo abaixo do teto. Ao contrário da trava de
 * horário, esta não tem "Liberar". Envios diretos pelo celular podem ficar fora da contagem.
 *
 * De onde vêm os envios: do retrato (`marcos.enviado` de todo produto e, para o só-robô, o
 * `marcos.followupEnviado`, que é o reenvio) e dos toques desta tela (`squadone:crm:primeiros-contatos`,
 * 24 h), porque o retrato só muda no próximo ciclo do 08 · CRM: sem o toque local, dava para
 * mandar outros 10 antes de a planilha confirmar o primeiro. Toque e retrato do mesmo lead a
 * menos de 15 min um do outro são o mesmo envio. Outro aparelho entra pelo retrato (até 10 min).
 *
 * 17/10/2026 (AC-06): os toques têm uma fonte no servidor (venda-do-dia.json, `primeiros`), que a
 * Central grava no toque do link e o vendedor do Telegram no "Enviei". As telas e o vendedor somam
 * servidor + reforço local + vendedor.json com `somarPrimeiros` (um por lead) antes desta regra, que
 * não mudou.
 */
import type { CrmLead } from './types'
import { hora } from './crm-formato'
import type { Guardador } from './fila-de-envio'

export interface RegrasDoRitmo {
  intervaloMs: number
  porHora: number
  /** Teto do dia na 1ª semana, na 2ª e daí em diante. */
  tetosPorSemana: readonly number[]
  /** AAAA-MM-DD (São Paulo): o dia em que o número começou ou voltou de uma restrição. */
  inicioDoNumero: string
  /** ISO: nenhum primeiro contato até este instante; null sem pausa. */
  pausadoAte: string | null
}

export const REGRAS_DO_RITMO: RegrasDoRitmo = {
  intervaloMs: 5 * 60_000,
  porHora: 12,
  tetosPorSemana: [100],
  // Data histórica preservada; o teto único não cresce com a idade do número.
  inicioDoNumero: '2026-10-16',
  pausadoAte: null,
}

export const AVISO_DO_RITMO = 'Teto interno; não garante ausência de bloqueio. Inicie contato só com autorização do destinatário.'

const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA
/** Dia de São Paulo (UTC−3, sem horário de verão desde 2019), como em server/crm.ts. */
const diaSP = (ms: number) => Math.floor((ms - 3 * HORA) / DIA)
/** Meia-noite de São Paulo do dia seguinte ao de `ms`. */
const amanhaSP = (ms: number) => (diaSP(ms) + 1) * DIA + 3 * HORA

/** O teto do dia de `agora`: pela semana desde o início do número (antes dele, o da 1ª semana). */
export function tetoDoDia(agora: number, regras: RegrasDoRitmo = REGRAS_DO_RITMO): number {
  const inicio = Date.parse(`${regras.inicioDoNumero}T00:00:00-03:00`)
  const tetos = regras.tetosPorSemana
  if (!Number.isFinite(inicio) || !tetos.length) return tetos[0] ?? 0
  const semana = Math.max(0, Math.floor((diaSP(agora) - diaSP(inicio)) / 7))
  return tetos[Math.min(semana, tetos.length - 1)]
}

export type MotivoDoRitmo = 'pausa' | 'dia' | 'hora' | 'intervalo'

export interface EstadoDoRitmo {
  /** null = pode enviar agora. */
  motivo: MotivoDoRitmo | null
  /** Quando o próximo primeiro contato pode sair (ms); null quando livre. */
  ate: number | null
  enviadosHoje: number
  teto: number
}

/**
 * Pode sair um primeiro contato agora? Na ordem do que segura por mais tempo: pausa, teto do
 * dia, teto da hora, intervalo. `instantes` são os primeiros contatos já feitos (ms), em qualquer ordem.
 */
export function ritmoDoEnvio(instantes: readonly number[], agora: number, regras: RegrasDoRitmo = REGRAS_DO_RITMO): EstadoDoRitmo {
  const passados = instantes.filter(t => Number.isFinite(t) && t <= agora + MIN).sort((a, b) => a - b)
  const hoje = diaSP(agora)
  const enviadosHoje = passados.filter(t => diaSP(t) === hoje).length
  const teto = tetoDoDia(agora, regras)
  const base = { enviadosHoje, teto }
  const pausa = regras.pausadoAte ? Date.parse(regras.pausadoAte) : NaN
  if (Number.isFinite(pausa) && agora < pausa) return { ...base, motivo: 'pausa', ate: pausa }
  if (enviadosHoje >= teto) return { ...base, motivo: 'dia', ate: amanhaSP(agora) }
  const naHora = passados.filter(t => agora - t < HORA)
  if (naHora.length >= regras.porHora) {
    // Libera quando o mais antigo que ainda faz a conta passar do teto sai da janela.
    return { ...base, motivo: 'hora', ate: naHora[naHora.length - regras.porHora] + HORA }
  }
  const ultimo = passados[passados.length - 1]
  if (ultimo !== undefined && agora - ultimo < regras.intervaloMs) return { ...base, motivo: 'intervalo', ate: ultimo + regras.intervaloMs }
  return { ...base, motivo: null, ate: null }
}

/** O que a tela diz quando segura o envio (e uma linha curta de quanto falta quando não segura). */
export function textoDoRitmo(estado: EstadoDoRitmo, regras: RegrasDoRitmo = REGRAS_DO_RITMO): string {
  const quando = estado.ate === null ? '' : hora(new Date(estado.ate).toISOString())
  const minutos = Math.round(regras.intervaloMs / MIN)
  switch (estado.motivo) {
    case 'pausa':
      return `Primeiros contatos pausados até ${quando} depois de um aviso do WhatsApp. Respostas e conversas seguem normais.`
    case 'dia':
      return `Teto de hoje atingido: ${estado.enviadosHoje} de ${estado.teto} primeiros contatos. Amanhã a fila volta.`
    case 'hora':
      return `${regras.porHora} primeiros contatos na última hora, o máximo. O próximo sai às ${quando}.`
    case 'intervalo':
      return `O próximo primeiro contato sai às ${quando} (intervalo interno de ${minutos} min entre contatos).`
    default:
      return `${estado.enviadosHoje} de ${estado.teto} primeiros contatos hoje.`
  }
}

// ---------------------------------------------------------------- de onde vêm os instantes

/** O mesmo envio visto pelo toque desta tela e pelo retrato: a planilha marca no clique do link do n8n. */
const MESMO_ENVIO_MS = 15 * MIN

type LeadDoRitmo = Pick<CrmLead, 'id' | 'sinal' | 'marcos'>

/** Os primeiros contatos que o retrato conhece, por lead. */
function doRetrato(lead: LeadDoRitmo): number[] {
  const m = lead.marcos ?? {}
  // O reenvio do só-robô é anotado como follow-up (anotacao-de-envio.ts) e é primeiro contato de verdade.
  const isso = [m.enviado, lead.sinal === 'so-robo' ? m.followupEnviado : undefined]
  return isso.map(v => Date.parse(v ?? '')).filter(Number.isFinite)
}

/** leadId -> instante (ms) do toque num link de primeiro contato, só neste navegador. */
export type PrimeirosContatos = Record<string, number>

/**
 * Os instantes de primeiro contato: o retrato inteiro mais os toques desta tela que o retrato
 * ainda não tem (nenhum envio do mesmo lead a menos de 15 min do toque).
 */
export function instantesDePrimeiroContato(leads: readonly LeadDoRitmo[], toques: PrimeirosContatos): number[] {
  const porLead = new Map(leads.map(l => [l.id, doRetrato(l)] as [string, number[]]))
  const instantes = [...porLead.values()].flat()
  for (const [id, t] of Object.entries(toques)) {
    if (!Number.isFinite(t)) continue
    if (!(porLead.get(id) ?? []).some(r => Math.abs(r - t) < MESMO_ENVIO_MS)) instantes.push(t)
  }
  return instantes
}

/**
 * PURO (17/10/2026, AC-06): os toques de primeiro contato de várias fontes num monte só, um por lead,
 * o mais antigo. As fontes são o servidor (venda-do-dia.json, que a Central e o Telegram gravam), o
 * localStorage desta tela (reforço até o servidor confirmar) e o vendedor.json de antes de 17/10.
 * Somar as contagens contaria duas vezes o mesmo lead tocado nas duas superfícies; contar só uma
 * deixava passar do teto somando as duas. Aceita o instante cru ou `{ em }` (o formato do servidor).
 */
export function somarPrimeiros(...fontes: Array<Record<string, number | { em: number }> | null | undefined>): PrimeirosContatos {
  const soma: PrimeirosContatos = {}
  for (const fonte of fontes) {
    for (const [id, v] of Object.entries(fonte ?? {})) {
      const t = typeof v === 'number' ? v : v?.em
      if (!id || typeof t !== 'number' || !Number.isFinite(t)) continue
      if (!(id in soma) || t < soma[id]) soma[id] = t
    }
  }
  return soma
}

export const CHAVE_DOS_PRIMEIROS = 'squadone:crm:primeiros-contatos'
/** Um dia basta: o teto é do dia e a janela mais longa é a do dia. */
const VALIDADE_DO_TOQUE_MS = DIA

function validos(toques: PrimeirosContatos, agora: number): PrimeirosContatos {
  return Object.fromEntries(Object.entries(toques).filter(([id, t]) =>
    Boolean(id) && Number.isFinite(t) && t <= agora + MIN && agora - t < VALIDADE_DO_TOQUE_MS))
}

export function lerPrimeiros(storage: Guardador | null | undefined, agora: number): PrimeirosContatos {
  try {
    const bruto = JSON.parse(storage?.getItem(CHAVE_DOS_PRIMEIROS) ?? '{}')
    return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? validos(bruto as PrimeirosContatos, agora) : {}
  } catch {
    return {}
  }
}

export function gravarPrimeiros(storage: Guardador | null | undefined, toques: PrimeirosContatos): void {
  try {
    storage?.setItem(CHAVE_DOS_PRIMEIROS, JSON.stringify(toques))
  } catch {
    // Sem storage: o toque vale até o próximo reload; o retrato cobre depois.
  }
}

/** Repetir o toque no mesmo lead não conta de novo: o que vale é a primeira vez que o WhatsApp abriu. */
export function marcarPrimeiro(toques: PrimeirosContatos, leadId: string, agora: number): PrimeirosContatos {
  const atuais = validos(toques, agora)
  return leadId in atuais ? atuais : { ...atuais, [leadId]: agora }
}
