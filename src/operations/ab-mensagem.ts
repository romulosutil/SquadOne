/**
 * PURO: o A/B estratificado da 1ª mensagem do Site (14/10/2026). Só a MEDIÇÃO: quem escolhe a
 * letra é o Balcão (`alocarRodada` em deploy/dell/claude-ops/site-mensagem.js).
 *
 * Por que existe: em 14/10/2026 o placar "Por mensagem" dava A 24% × B 8% de resposta (41 e 25
 * envios, Fisher p = 0,11), mas a comparação era confundida: a B só é elegível para lead com
 * nota 4,3+ e 15+ avaliações, a C só com Raio-X no ar, e o hash do place_id não equilibrava nada
 * por nicho (dentro de advocacia, a única com amostra nas duas, A 4/24 × B 2/21 era empate).
 *
 * Regras (as mesmas de honestidade do A/B do vídeo, ab-video.ts):
 * - só entra lead ENVIADO com a coluna `ab_elegiveis` (o Balcão a grava desde 14/10/2026); o
 *   histórico sem ela (150 envios sem letra e os sorteados pelo hash) fica fora, e o follow-up
 *   do 05 · Acompanhamento não é sorteado: o teste é da 1ª mensagem;
 * - a letra X só é comparada com a Y entre leads cujo conjunto contém AS DUAS: quem só podia
 *   receber a A não diz nada sobre a B;
 * - métrica: respondeu de gente (o robô, tipo `bot`, não conta), pela mesma conta de resultados.ts;
 * - sem espiar: com menos de ENVIOS_MINIMOS_POR_BRACO em algum braço, só a contagem de envios
 *   ("faltam N"); a taxa, o p e o veredito nem são calculados;
 * - "ganhou" só com DIFERENCA_MINIMA_PP pontos E Fisher exato bilateral p < P_MAXIMO; o resto é
 *   "não provado". Cada nicho tem a letra equilibrada pelo Balcão, então o total do par não é
 *   confundido pelo nicho; a quebra por nicho é para ver, não para declarar ganhador;
 * - texto trocado recomeça a contagem: o par só conta envios a partir do TEXTO_DESDE mais recente
 *   das duas letras (antes dele, a letra levava outro texto, e misturar os dois mede nada).
 */
import { DIFERENCA_MINIMA_PP, P_MAXIMO, fisherExato } from './ab-video.ts'
import { chaveDe, resultados, type LinhaDeResultado } from './resultados.ts'
import type { CrmLead } from './types'

export const ENVIOS_MINIMOS_POR_BRACO = 30
export type Letra = 'A' | 'B' | 'C' | 'D'
export type Par = 'AB' | 'AC' | 'AD' | 'BC' | 'BD' | 'CD'
export const PARES: readonly Par[] = ['AB', 'AC', 'AD', 'BC', 'BD', 'CD']

/**
 * Desde quando cada letra tem o texto de hoje em site-mensagem.js. 19/10/2026: B e C ficaram mais
 * soltas (pedido do Rômulo); a A não mudou. Vale a meia-noite de SP do dia SEGUINTE à troca: o
 * Balcão remonta o wa_link dos `pronto` de hora em hora, e até lá ainda podia sair o texto velho.
 */
export const TEXTO_DESDE: Readonly<Partial<Record<Letra, string>>> = {
  B: '2026-10-20T03:00:00.000Z',
  C: '2026-10-20T03:00:00.000Z',
}
const desdeDoPar = (x: Letra, y: Letra) =>
  Math.max(Date.parse(TEXTO_DESDE[x] ?? '') || 0, Date.parse(TEXTO_DESDE[y] ?? '') || 0)

/** `linha` (respostas, interesse...) só existe na leitura: antes dos 30 por braço, só os envios. */
export interface BracoDoPar {
  letra: Letra
  enviados: number
  linha?: LinhaDeResultado
}

export interface LeituraDoPar {
  par: Par
  x: BracoDoPar
  y: BracoDoPar
  estado: 'faltam' | 'lido'
  /** Envios que faltam em cada braço até ENVIOS_MINIMOS_POR_BRACO (0 quando já tem). */
  faltam: { x: number; y: number }
  /** Do nicho com mais envios para o com menos; mesma regra do total (linha só na leitura). */
  porNicho: Array<{ nicho: string; x: BracoDoPar; y: BracoDoPar }>
  /** Só em `lido`. `diferencaPp` = taxa de x − taxa de y; `ganhou` null = não provado. */
  numeros?: { taxaX: number; taxaY: number; diferencaPp: number; p: number; ganhou: Letra | null }
}

export interface LeituraDoAbMensagem {
  /** O primeiro envio com `ab_elegiveis`; null = nenhum ainda (o bloco só explica). */
  inicio: string | null
  /** A×B sempre que há envio sorteado; A×C e B×C só com envio nos dois braços. */
  pares: LeituraDoPar[]
  /** Enviados do Site sem `ab_elegiveis` (histórico): fora do teste. */
  semColuna: number
  /** Com `ab_elegiveis`, mas a letra não está nele ("manual": saiu sem o clique no wa_link): fora. */
  letraFora: number
}

const enviadoEm = (lead: CrmLead) => Date.parse(lead.marcos.enviado ?? '')
const ehLetra = (v: string | undefined): v is Letra => v === 'A' || v === 'B' || v === 'C' || v === 'D'

function braco(letra: Letra, leads: CrmLead[], lido: boolean, agora: number): BracoDoPar {
  const daLetra = leads.filter(l => l.abordagem?.mensagem === letra)
  return {
    letra,
    enviados: daLetra.length,
    ...(lido ? { linha: { ...resultados(daLetra, 'mensagem', 'tudo', agora).total, chave: `Mensagem ${letra}` } } : {}),
  }
}

/** Quem ganhou pelo critério fixado (diferença em pontos e p), ou null. */
export function ganhadorDoPar(x: Letra, y: Letra, diferencaPp: number, p: number): Letra | null {
  if (p >= P_MAXIMO || Math.abs(diferencaPp) < DIFERENCA_MINIMA_PP - 1e-9) return null
  return diferencaPp > 0 ? x : y
}

function lerPar(par: Par, sorteados: CrmLead[], agora: number): LeituraDoPar {
  const [x, y] = par.split('') as [Letra, Letra]
  const desde = desdeDoPar(x, y)
  const doPar = sorteados.filter(l => {
    const elegiveis = l.abordagem?.elegiveis ?? ''
    return elegiveis.includes(x) && elegiveis.includes(y) && (l.abordagem?.mensagem === x || l.abordagem?.mensagem === y)
      && enviadoEm(l) >= desde
  })
  const nx = doPar.filter(l => l.abordagem?.mensagem === x).length
  const ny = doPar.length - nx
  const lido = nx >= ENVIOS_MINIMOS_POR_BRACO && ny >= ENVIOS_MINIMOS_POR_BRACO

  const nichos = new Map<string, CrmLead[]>()
  for (const l of doPar) {
    const nicho = chaveDe(l, 'nicho')
    nichos.set(nicho, [...(nichos.get(nicho) ?? []), l])
  }
  const porNicho = [...nichos]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([nicho, ls]) => ({ nicho, x: braco(x, ls, lido, agora), y: braco(y, ls, lido, agora) }))

  const base = {
    par, x: braco(x, doPar, lido, agora), y: braco(y, doPar, lido, agora), porNicho,
    faltam: { x: Math.max(0, ENVIOS_MINIMOS_POR_BRACO - nx), y: Math.max(0, ENVIOS_MINIMOS_POR_BRACO - ny) },
  }
  if (!lido || !base.x.linha || !base.y.linha) return { ...base, estado: 'faltam' }

  const rx = base.x.linha.responderam
  const ry = base.y.linha.responderam
  // Pelas contagens, arredondado: em ponto flutuante 9/30 − 3/30 dá 19,999… (mesma conta do vídeo).
  const diferencaPp = Math.round(((rx * ny - ry * nx) * 100 / (nx * ny)) * 1e6) / 1e6
  const p = fisherExato(rx, nx - rx, ry, ny - ry)
  return { ...base, estado: 'lido', numeros: { taxaX: rx / nx, taxaY: ry / ny, diferencaPp, p, ganhou: ganhadorDoPar(x, y, diferencaPp, p) } }
}

/** A leitura do A/B estratificado a partir do retrato do CRM. Ignora o período da tela: o teste conta inteiro. */
export function leituraDoAbMensagem(leads: CrmLead[], agora: number, produto: 'site' | 'prumo' = 'site'): LeituraDoAbMensagem {
  const enviados = leads.filter(l => l.produto === produto && Number.isFinite(enviadoEm(l)))
  const comColuna = enviados.filter(l => l.abordagem?.elegiveis)
  const sorteados = comColuna.filter(l => ehLetra(l.abordagem?.mensagem) && l.abordagem!.elegiveis!.includes(l.abordagem!.mensagem!))
  const inicioMs = comColuna.length ? Math.min(...comColuna.map(enviadoEm)) : null
  const paresDoProduto: readonly Par[] = produto === 'prumo' ? ['AD'] : PARES
  const pares = inicioMs === null ? [] : paresDoProduto.map(par => lerPar(par, sorteados, agora))
    .filter(l => produto === 'prumo' || l.par === 'AB' || (l.x.enviados > 0 && l.y.enviados > 0))
  return {
    inicio: inicioMs === null ? null : new Date(inicioMs).toISOString(),
    pares,
    semColuna: enviados.length - comColuna.length,
    letraFora: comColuna.length - sorteados.length,
  }
}

/** "Faltam 12 envios de A e 30 de B para ler." / "Faltam 3 envios de B para ler." */
export function textoDoFaltam(l: LeituraDoPar): string {
  const partes = ([[l.x.letra, l.faltam.x], [l.y.letra, l.faltam.y]] as const).filter(([, n]) => n > 0)
  if (!partes.length) return ''
  const primeiro = `${partes[0][1]} ${partes[0][1] === 1 ? 'envio' : 'envios'} de ${partes[0][0]}`
  return `Faltam ${primeiro}${partes[1] ? ` e ${partes[1][1]} de ${partes[1][0]}` : ''} para ler.`
}
