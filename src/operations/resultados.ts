/**
 * PURO: "Resultados" do CRM (08/10/2026) — o que cada nicho, cada variação da
 * primeira mensagem e cada versão do site rendeu, contado só sobre quem foi
 * ENVIADO no período (pela data de envio). É o placar que o ciclo de
 * aprendizado do funil olha: sem ele, o funil semanal do WhatsApp era o único
 * lugar com o número por nicho, e nada mostrava a variação nem a versão.
 *
 * Honestidade dos números (RULES 2 e 15):
 * - "leram" só conta quem deixa a confirmação de leitura ligada (ou respondeu);
 *   o resto é "não sei", nunca "não leu";
 * - "respondeu" é gente: a saudação automática do WhatsApp Business não marca
 *   `respondeu_em` (regra dos 5 min e classificação "bot");
 * - recusa só conta entre os enviados: o acervo de `_recusados/` de 25/09 não
 *   recebeu mensagem rastreada e distorceria a taxa;
 * - linha com menos de AMOSTRA_MINIMA enviados ganha o aviso de amostra
 *   pequena: 1 de 3 não é 33%.
 */
import { ROTULO_DO_REGIME } from './crm-formato'
import { papelDaMensagem, pedeMaterial } from './marcadores-da-conversa'
import type { CrmLead } from './types'
import { noExpedienteDeVenda, TEXTO_DO_EXPEDIENTE } from './trava-de-horario'

export type Periodo = '14' | '30' | 'tudo'
export const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: '14', rotulo: '14 dias' },
  { id: '30', rotulo: '30 dias' },
  { id: 'tudo', rotulo: 'Tudo' },
]
export const AMOSTRA_MINIMA = 10

export interface LinhaDeResultado {
  chave: string
  enviados: number
  /** Leram (`leu`): o nome do campo ficou do tempo do "viu"; na tela é "leram", como no funil. */
  viram: number
  responderam: number
  interesse: number
  recusaram: number
  fecharam: number
}

/**
 * `video` (11/10/2026): o A/B do vídeo no envio (ab-video.ts). Coluna `braco_video` vazia
 * é "Sem vídeo"; a tela só mostra o critério dentro do bloco do A/B, e só com a coluna preenchida.
 */
export type Criterio = 'nicho' | 'mensagem' | 'site' | 'horario' | 'video'

const DIA_MS = 24 * 60 * 60 * 1000
const FUSO = 'America/Sao_Paulo'

// ---------------------------------------------------------------- horário do envio (08/10/2026)
// Medido até 08/10/2026: 26 envios depois das 18h tiveram 0 respostas de gente; das 8h às 18h,
// 15 de 65 (23%). O horário vira critério do placar e um aviso na fila de envio, sempre com os
// números do próprio retrato (nada fixo no código além da definição do expediente).

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const formatoHoraSP = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hour: 'numeric', hourCycle: 'h23', weekday: 'short' })
/** Hora (0–23) e dia da semana (0 = domingo) em São Paulo, qualquer que seja o fuso da máquina. */
export function horaEmSP(ms: number): { hora: number; diaDaSemana: number } {
  const partes = formatoHoraSP.formatToParts(new Date(ms))
  const valor = (tipo: string) => partes.find(p => p.type === tipo)?.value ?? ''
  return { hora: Number(valor('hour')) % 24, diaDaSemana: DIAS.indexOf(valor('weekday')) }
}

export const FAIXAS_DO_HORARIO = ['Manhã (8h–12h)', 'Almoço (12h–14h)', 'Tarde (14h–18h)', 'Noite (18h–21h)', 'Madrugada (21h–8h)'] as const

export function faixaDoHorario(ms: number): (typeof FAIXAS_DO_HORARIO)[number] {
  const { hora } = horaEmSP(ms)
  if (hora >= 8 && hora < 12) return FAIXAS_DO_HORARIO[0]
  if (hora >= 12 && hora < 14) return FAIXAS_DO_HORARIO[1]
  if (hora >= 14 && hora < 18) return FAIXAS_DO_HORARIO[2]
  if (hora >= 18 && hora < 21) return FAIXAS_DO_HORARIO[3]
  return FAIXAS_DO_HORARIO[4]
}

export function enviadoNoPeriodo(lead: CrmLead, periodo: Periodo, agora: number): boolean {
  return periodo === 'tudo' ? Number.isFinite(Date.parse(lead.marcos.enviado ?? '')) : enviadoNosUltimos(lead, Number(periodo), agora)
}

/**
 * A janela de "últimos N dias" pela data do envio, a mesma do placar e do "Por que não está vendendo"
 * (AC-03, 17/10/2026). Sem limite de cima de propósito: o relógio da aba pode estar segundos atrás do
 * servidor que gravou o envio, e um envio "no futuro" sumiria de uma tela e não da outra.
 */
export function enviadoNosUltimos(lead: Pick<CrmLead, 'marcos'>, dias: number, agora: number): boolean {
  const t = Date.parse(lead.marcos.enviado ?? '')
  return Number.isFinite(t) && agora - t <= dias * DIA_MS
}

// ---------------------------------------------------------------- uma regra por métrica (AC-03, 17/10/2026)
// Em Números, na mesma tela, a barra dizia 41 responderam e 70 leram e o placar logo abaixo, 42 e 68 viram:
// o placar contava `respondeu_em` e o funil, a resposta classificada; o placar lia o recibo e o funil, a
// `leitura` do servidor (que conta a resposta do robô como leitura). As duas telas leem daqui agora.

/**
 * Respondeu de gente: `respondeu_em` (o Plus só tem este) ou a resposta classificada pelo n8n (às vezes
 * chega antes da coluna), nunca a saudação automática (classificação "bot").
 */
export function respondeuDeGente(lead: Pick<CrmLead, 'marcos' | 'resposta'> & Partial<Pick<CrmLead, 'conversa'>>): boolean {
  return (Boolean(lead.marcos.respondeu) || Boolean(lead.resposta)) && lead.resposta?.tipo !== 'bot' && quemRespondeu(lead) !== 'robo'
}

/**
 * A vez é dele: a última mensagem da conversa guardada é de gente (entrada que não é do robô nem a
 * saudação classificada "bot"). Devolve quando foi (ms), ou null. As "Conversas para você" usam; a
 * recepção conta (é gente, e quem decide o que fazer com ela é o Rômulo).
 */
export function entradaDeGenteDaVez(lead: Pick<CrmLead, 'resposta'> & Partial<Pick<CrmLead, 'conversa'>>): number | null {
  const ultima = lead.conversa?.ultima
  if (!ultima || ultima.direcao !== 'entrada' || papelDaMensagem(ultima.trecho, ultima.papel) === 'robo') return null
  const em = Date.parse(ultima.em)
  return Number.isFinite(em) ? em : null
}

/**
 * PURO (17/10/2026). Quem respondeu, pela conversa guardada, quando ela cobre a resposta (começou antes
 * dela): 'robo' = só o atendimento automático escreveu; 'recepcao' = gente, mas só a recepção (não
 * decide); 'gente' = alguém escreveu por si. `undefined` = a conversa não diz (ausente, resumo antigo
 * ou começou depois da resposta): vale o que a planilha diz, como antes.
 */
export function quemRespondeu(lead: Pick<CrmLead, 'marcos' | 'resposta'> & Partial<Pick<CrmLead, 'conversa'>>): 'gente' | 'recepcao' | 'robo' | undefined {
  const c = lead.conversa
  if (!c?.entradas) return undefined
  const resposta = Math.min(...[lead.marcos.respondeu, lead.resposta?.em].map((v) => Date.parse(v ?? '')).filter(Number.isFinite))
  if (Number.isFinite(resposta) && Date.parse(c.desde) > resposta) return undefined
  const { gente, recepcao, robo } = c.entradas
  if (gente > 0) return 'gente'
  if (recepcao > 0) return 'recepcao'
  return robo > 0 ? 'robo' : undefined
}

/** Leu: o recibo de leitura ou a resposta de gente (quem respondeu leu). Sem recibo é "não sei", nunca "não leu". */
export function leu(lead: Pick<CrmLead, 'marcos' | 'resposta' | 'leitura'>): boolean {
  return Boolean(lead.marcos.visto) || lead.leitura === 'viu' || respondeuDeGente(lead)
}

/**
 * Disse "quero ver": a resposta de gente que pede o material (interesse OU licença, pedeMaterial), ou já
 * na proposta/fechado. A licença conta (17/10/2026): até então o "pode mandar" do Site era gravado como
 * interesse, e separar o tipo não pode encolher a contagem. A recepção também conta: o que ela disse o
 * classificador já leu com o papel na mão, e excluí-la aqui rebaixava interesse de verdade; só o robô fica
 * de fora (respondeuDeGente). A recepção com resposta neutra não conta, como qualquer neutra.
 */
export function quisVer(lead: Pick<CrmLead, 'marcos' | 'resposta' | 'etapa'> & Partial<Pick<CrmLead, 'conversa'>>): boolean {
  if (!respondeuDeGente(lead)) return false
  if (lead.etapa === 'proposta' || lead.etapa === 'ganho') return true
  return pedeMaterial(lead.resposta)
}

/** O rótulo do grupo do lead em cada critério. */
export function chaveDe(lead: CrmLead, criterio: Criterio): string {
  if (criterio === 'nicho') return lead.nicho.trim() || 'Sem nicho'
  if (criterio === 'horario') return faixaDoHorario(Date.parse(lead.marcos.enviado ?? ''))
  if (criterio === 'video') return lead.abordagem?.video === 'video' ? 'Com vídeo' : 'Sem vídeo'
  if (criterio === 'mensagem') {
    const m = lead.abordagem?.mensagem
    // Sem a letra (150 de 221 envios em 14/10/2026), o regime pela data separa quem recebeu o link
    // na 1ª mensagem de quem recebeu o pedido de licença: "Sem registro" juntava os dois.
    if (!m) return lead.abordagem?.regime ? ROTULO_DO_REGIME[lead.abordagem.regime] : 'Sem registro (envios até 07/10)'
    if (m === 'manual') return 'Escrita à mão'
    if (m === 'EN') return 'Em inglês'
    return `Mensagem ${m}`
  }
  return lead.abordagem?.site ? `Site ${lead.abordagem.site}` : 'Sem registro (envios até 07/10)'
}

function contar(chave: string, leads: CrmLead[]): LinhaDeResultado {
  const linha: LinhaDeResultado = { chave, enviados: 0, viram: 0, responderam: 0, interesse: 0, recusaram: 0, fecharam: 0 }
  for (const l of leads) {
    linha.enviados++
    if (leu(l)) linha.viram++
    if (respondeuDeGente(l)) linha.responderam++
    if (quisVer(l)) linha.interesse++
    if (l.motivoPerda === 'recusou' || l.motivoPerda === 'sem-interesse') linha.recusaram++
    if (l.etapa === 'ganho') linha.fecharam++
  }
  return linha
}

/**
 * Uma linha por grupo, do que tem mais enviados para o que tem menos (empate:
 * alfabética), e o total. Só leads enviados no período entram.
 */
export function resultados(leads: CrmLead[], criterio: Criterio, periodo: Periodo, agora: number): { linhas: LinhaDeResultado[]; total: LinhaDeResultado } {
  const enviados = leads.filter(l => enviadoNoPeriodo(l, periodo, agora))
  const grupos = new Map<string, CrmLead[]>()
  for (const l of enviados) {
    const chave = chaveDe(l, criterio)
    grupos.set(chave, [...(grupos.get(chave) ?? []), l])
  }
  // Horário na ordem do dia; o resto, do grupo com mais enviados para o com menos.
  const ordemDaFaixa = (chave: string) => (FAIXAS_DO_HORARIO as readonly string[]).indexOf(chave)
  const linhas = [...grupos].map(([chave, ls]) => contar(chave, ls))
    .sort((a, b) => (criterio === 'horario' ? ordemDaFaixa(a.chave) - ordemDaFaixa(b.chave) : 0)
      || b.enviados - a.enviados || a.chave.localeCompare(b.chave, 'pt-BR'))
  return { linhas, total: contar('Total', enviados) }
}

/**
 * A taxa de resposta dentro e fora do expediente: o conjunto é decidido AQUI, não por quem chama
 * (AC-03, 17/10/2026). A Próxima venda passava todos os leads e a Triagem só os do Site, e a mesma
 * frase dizia 18 % numa e 20 % na outra. Só o Site: é a 1ª mensagem com a hora do envio gravada pelo
 * observador, o dado em que a trava foi medida (0 de 29 depois das 18h); o convite do PRUMO e o
 * toque do Plus têm outra mensagem e outro público, e misturá-los mudaria a taxa sem mudar o horário.
 */
export function taxaPorExpediente(leads: readonly CrmLead[], agora: number): { dentro: LinhaDeResultado; fora: LinhaDeResultado } {
  const enviados = leads.filter(l => l.produto === 'site' && enviadoNoPeriodo(l, 'tudo', agora))
  const noExpediente = (l: CrmLead) => noExpedienteDeVenda(Date.parse(l.marcos.enviado ?? ''))
  return { dentro: contar('dentro', enviados.filter(noExpediente)), fora: contar('fora', enviados.filter(l => !noExpediente(l))) }
}

/**
 * Aviso da fila de envio fora do expediente, com a taxa de resposta medida dentro e fora dele.
 * `null` no horário comercial. Com pouco envio de um dos lados, o aviso não cita número
 * (1 de 3 não é taxa).
 */
export function avisoDeHorario(leads: readonly CrmLead[], agora: number): string | null {
  // O expediente de venda (trava-de-horario.ts), o mesmo da Próxima venda e do Telegram (OT-02):
  // a janela que trava é a mesma que a taxa mede.
  if (noExpedienteDeVenda(agora)) return null
  const { dentro, fora } = taxaPorExpediente(leads, agora)
  const expediente = TEXTO_DO_EXPEDIENTE
  if (amostraPequena(dentro) || amostraPequena(fora)) {
    return `Agora é fora do expediente de quem recebe (${expediente}): mensagem de número desconhecido nessa hora costuma ficar sem resposta.`
  }
  // "do Site": a frase diz de que envios é a taxa, para ninguém compará-la com o placar de todas as ofertas.
  return `Agora é fora do expediente de quem recebe (${expediente}). Fora dele, ${fora.enviados} envios do Site tiveram `
    + `${fora.responderam === 1 ? '1 resposta' : `${fora.responderam} respostas`} (${porcento(fora.responderam, fora.enviados)}); `
    + `dentro, ${porcento(dentro.responderam, dentro.enviados)} responderam.`
}

/** "25%"; sem enviados não há taxa. Arredonda para inteiro: com amostras deste tamanho, casa decimal é ruído. */
export function porcento(parte: number, total: number): string {
  return total > 0 ? `${Math.round((parte / total) * 100)}%` : '—'
}

export const amostraPequena = (linha: LinhaDeResultado) => linha.enviados < AMOSTRA_MINIMA

const flexao = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "3 responderam (25%) · 2 leram · 1 quis ver · 0 recusaram · 0 ganharam". "Leram", o rótulo do funil (AC-03). */
export function resumoDaLinha(l: LinhaDeResultado): string {
  return [
    `${flexao(l.responderam, 'respondeu', 'responderam')} (${porcento(l.responderam, l.enviados)})`,
    flexao(l.viram, 'leu', 'leram'),
    `${flexao(l.interesse, 'quis', 'quiseram')} ver`,
    flexao(l.recusaram, 'recusou', 'recusaram'),
    flexao(l.fecharam, 'ganhou', 'ganharam'),
  ].join(' · ')
}

// ---------------------------------------------------------------- envios anotados (14/10/2026)
// O follow-up do 3º dia gerava lembretes (65 até 14/10) sem o CRM saber se algum saiu, e a 2ª
// mensagem também não deixava rastro: "follow-up funciona?" não tinha número. Desde 14/10 o toque
// no link da Central anota o envio (aba CRM); antes disso não há dado, e a tela diz isso.

/** O "desde quando" das anotações: antes do loop fechado, nenhum envio foi anotado. */
export const INICIO_DAS_ANOTACOES = '14/10/2026'

export interface EnviosAnotadosNoPeriodo {
  /** Enviados no período que tiveram o follow-up anotado. */
  followups: number
  /** Desses, quantos responderam (gente, não robô) DEPOIS do follow-up. */
  responderamDepois: number
  /** Enviados no período que disseram que querem ver. */
  quiseramVer: number
  /** Desses, quantos tiveram a 2ª mensagem anotada. */
  segundas: number
}

/**
 * A última mensagem de gente do lead, em ms: `respondeu_em`, a resposta classificada (a saudação "bot"
 * não conta) ou a última entrada da conversa guardada (o robô já fica de fora dela). A régua única de
 * "quando ele escreveu por último": o "o que achou?" da fila e o follow-up deste placar leem daqui.
 */
export function ultimaRespostaDeGente(lead: Pick<CrmLead, 'marcos' | 'resposta'> & Partial<Pick<CrmLead, 'conversa'>>): number | undefined {
  const datas = [Date.parse(lead.marcos.respondeu ?? ''),
    lead.resposta && lead.resposta.tipo !== 'bot' ? Date.parse(lead.resposta.em ?? '') : NaN,
    Date.parse(lead.conversa?.ultimaEntrada ?? '')].filter(Number.isFinite)
  return datas.length ? Math.max(...datas) : undefined
}

export function enviosAnotados(leads: CrmLead[], periodo: Periodo, agora: number): EnviosAnotadosNoPeriodo {
  const saida: EnviosAnotadosNoPeriodo = { followups: 0, responderamDepois: 0, quiseramVer: 0, segundas: 0 }
  for (const l of leads) {
    if (!enviadoNoPeriodo(l, periodo, agora)) continue
    const followup = Date.parse(l.marcos.followupEnviado ?? '')
    if (Number.isFinite(followup)) {
      saida.followups++
      const resposta = ultimaRespostaDeGente(l)
      if (resposta !== undefined && resposta > followup) saida.responderamDepois++
    }
    if (pedeMaterial(l.resposta) && quisVer(l)) {
      saida.quiseramVer++
      if (l.marcos.segundaEnviada) saida.segundas++
    }
  }
  return saida
}

/**
 * "Follow-up anotado em 12: 2 responderam depois (17%), amostra pequena". Com menos de
 * AMOSTRA_MINIMA follow-ups, a taxa sai com o aviso (1 de 3 não é 33%); sem nenhum, nada de taxa.
 */
export function textoDoFollowup(a: EnviosAnotadosNoPeriodo): string {
  if (!a.followups) return `Nenhum follow-up anotado neste período (a anotação começou em ${INICIO_DAS_ANOTACOES}).`
  const taxa = `${flexao(a.responderamDepois, 'respondeu', 'responderam')} depois (${porcento(a.responderamDepois, a.followups)})`
  return `Follow-up anotado em ${a.followups}: ${taxa}${a.followups < AMOSTRA_MINIMA ? ', amostra pequena' : ''}.`
}

/** "2ª mensagem anotada para 3 de 5 que quiseram ver." */
export function textoDaSegunda(a: EnviosAnotadosNoPeriodo): string {
  if (!a.quiseramVer) return 'Ninguém disse que quer ver neste período.'
  return `2ª mensagem anotada para ${a.segundas} de ${a.quiseramVer} que ${a.quiseramVer === 1 ? 'quis' : 'quiseram'} ver.`
}
