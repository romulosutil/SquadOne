/**
 * PURO: o A/B do vídeo no primeiro envio do Site (11/10/2026). Só a MEDIÇÃO:
 * nada aqui envia, grava planilha ou escolhe lead; o vídeo sai à mão, logo
 * depois da mensagem (o `wa.me?text=` não anexa mídia).
 *
 * Desenho (decidido antes de qualquer envio, para o número não ser escolhido
 * depois de visto):
 * - um nicho, uma letra de mensagem, 20 envios por braço;
 * - braço sorteado de forma DETERMINÍSTICA pelo place_id com sal próprio
 *   (`bracoDoLead`): o mesmo lead cai sempre no mesmo braço, em qualquer
 *   máquina, e ninguém escolhe quem "merece" o vídeo;
 * - métrica primária: respondeu de gente (o robô, tipo `bot`, não conta);
 * - leitura ÚNICA 7 dias depois do último envio; antes disso a tela mostra só
 *   quantos foram enviados, nunca a taxa (sem espiar: olhar e parar quando
 *   "parece bom" fabrica vencedor);
 * - "vídeo ganhou" só com +20 pontos percentuais E Fisher exato bilateral
 *   p < 0,10; qualquer outra coisa é "não provado";
 * - regra de parada: aviso ou restrição do WhatsApp, ou 2 ou mais bloqueios no
 *   braço com vídeo. O CRM não enxerga bloqueio: a regra fica escrita na tela.
 *
 * Quem está no teste: os leads do Site enviados a partir do primeiro envio
 * marcado na coluna `braco_video`, no nicho e na letra do braço com vídeo.
 * Sem nenhuma marca na planilha, `leituraDoAbVideo` devolve null e a tela não muda.
 */
import { resultados, type LinhaDeResultado } from './resultados.ts'
import type { CrmLead } from './types'

/** O sal deste teste. Outro teste, outro sal: senão os mesmos leads cairiam nos mesmos braços. */
export const SAL_DO_AB_VIDEO = 'squadone-ab-video-1'
export const ENVIOS_POR_BRACO = 20
export const DIAS_ATE_A_LEITURA = 7
export const DIFERENCA_MINIMA_PP = 20
export const P_MAXIMO = 0.1
export const REGRA_DE_PARADA = 'Pare o teste (e não leia) se o WhatsApp mostrar qualquer aviso ou restrição na conta, '
  + 'ou se 2 ou mais leads do braço com vídeo bloquearem o número.'

export type BracoVideo = 'video' | 'sem-video'

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * Hash de 32 bits, estável entre máquinas e linguagens: FNV-1a sobre os bytes
 * UTF-8 de `<sal>:<placeId>`, seguido do finalizador do MurmurHash3 (fmix32).
 * O finalizador não é enfeite: o bit mais baixo do FNV-1a puro é só a paridade
 * da soma dos bytes, e trocar o sal inverteria todos os braços de uma vez em
 * vez de sortear de novo.
 */
export function hashDoLead(placeId: string, sal: string): number {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(`${sal}:${placeId.trim()}`)) {
    h ^= byte
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Hash par = braço com vídeo. O que vai na coluna `braco_video`: "video" ou "sem-video". */
export function bracoDoLead(placeId: string, sal: string = SAL_DO_AB_VIDEO): BracoVideo {
  return hashDoLead(placeId, sal) % 2 === 0 ? 'video' : 'sem-video'
}

/**
 * Fisher exato BILATERAL da tabela [[a, b], [c, d]]: soma das probabilidades
 * (hipergeométrica, margens fixas) de toda tabela tão ou menos provável que a
 * observada, com a mesma folga relativa de 1e-7 do `fisher.test` do R.
 */
export function fisherExato(a: number, b: number, c: number, d: number): number {
  for (const x of [a, b, c, d]) {
    if (!Number.isInteger(x) || x < 0) throw new RangeError('fisherExato: contagens inteiras e não negativas')
  }
  const n = a + b + c + d
  const linha1 = a + b
  const coluna1 = a + c
  const linha2 = c + d
  if (n === 0) return 1
  const logFat = [0]
  for (let i = 1; i <= n; i++) logFat[i] = logFat[i - 1] + Math.log(i)
  const fixo = logFat[linha1] + logFat[linha2] + logFat[coluna1] + logFat[n - coluna1] - logFat[n]
  const logP = (x: number) => fixo - logFat[x] - logFat[linha1 - x] - logFat[coluna1 - x] - logFat[linha2 - coluna1 + x]
  const observada = logP(a) + Math.log1p(1e-7)
  let p = 0
  for (let x = Math.max(0, coluna1 - linha2); x <= Math.min(linha1, coluna1); x++) {
    const lp = logP(x)
    if (lp <= observada) p += Math.exp(lp)
  }
  return Math.min(1, p)
}

export type Veredito = 'video-ganhou' | 'nao-provado'

export const FRASE_DO_VEREDITO: Record<Veredito, string> = { 'video-ganhou': 'vídeo ganhou', 'nao-provado': 'não provado' }

/** A regra fixada antes do teste: +20 pontos E p < 0,10. Empate na borda dos 20 pontos vale. */
export function veredito(diferencaPp: number, p: number): Veredito {
  return diferencaPp >= DIFERENCA_MINIMA_PP - 1e-9 && p < P_MAXIMO ? 'video-ganhou' : 'nao-provado'
}

export interface LeituraDoAbVideo {
  /** `amostra-insuficiente`: algum braço com menos de 20; `aguardando-leitura`: 7 dias ainda não passaram. */
  estado: 'amostra-insuficiente' | 'aguardando-leitura' | 'lido'
  nicho: string
  /** A letra da mensagem do braço com vídeo; null se a planilha não diz. */
  mensagem: string | null
  /** O primeiro envio marcado: daí em diante, todo envio do nicho e da letra está no teste. */
  inicio: string | null
  comVideo: LinhaDeResultado
  semVideo: LinhaDeResultado
  /** 7 dias depois do último envio do teste. */
  leituraEm: string | null
  /** Marcados e enviados fora do nicho ou da letra: não entram na conta. */
  foraDoDesenho: number
  /** No teste, mas com a coluna diferente do sorteio (`bracoDoLead` com o sal): conferir antes de ler. */
  foraDoSorteio: number
  /** Só em `lido`. */
  numeros?: { taxaCom: number; taxaSem: number; diferencaPp: number; p: number; veredito: Veredito }
}

const nichoDe = (lead: CrmLead) => lead.nicho.trim() || 'Sem nicho'
const enviadoEm = (lead: CrmLead) => Date.parse(lead.marcos.enviado ?? '')

function moda(valores: string[]): string | undefined {
  const contagem = new Map<string, number>()
  for (const v of valores) contagem.set(v, (contagem.get(v) ?? 0) + 1)
  return [...contagem].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'pt-BR'))[0]?.[0]
}

/**
 * A leitura do A/B a partir do retrato do CRM. null quando nenhum lead do Site
 * tem a coluna `braco_video` preenchida: sem teste, nada aparece.
 */
export function leituraDoAbVideo(leads: CrmLead[], agora: number, sal: string = SAL_DO_AB_VIDEO): LeituraDoAbVideo | null {
  const site = leads.filter(l => l.produto === 'site')
  const marcados = site.filter(l => l.abordagem?.video)
  if (!marcados.length) return null
  const comVideoMarcados = marcados.filter(l => l.abordagem?.video === 'video')
  const referencia = comVideoMarcados.length ? comVideoMarcados : marcados
  const nicho = moda(referencia.map(nichoDe)) ?? 'Sem nicho'
  const mensagem = moda(referencia.map(l => l.abordagem?.mensagem ?? '')) || null

  const enviadosMarcados = marcados.filter(l => Number.isFinite(enviadoEm(l)))
  const inicioMs = enviadosMarcados.length ? Math.min(...enviadosMarcados.map(enviadoEm)) : null
  const noTeste = inicioMs === null ? [] : site.filter(l => {
    const t = enviadoEm(l)
    return Number.isFinite(t) && t >= inicioMs && nichoDe(l) === nicho && (l.abordagem?.mensagem || null) === mensagem
  })
  const ids = new Set(noTeste.map(l => l.id))
  const foraDoDesenho = enviadosMarcados.filter(l => !ids.has(l.id)).length
  const foraDoSorteio = noTeste.filter(l => (l.abordagem?.video === 'video') !== (bracoDoLead(l.chave, sal) === 'video')).length

  const { linhas } = resultados(noTeste, 'video', 'tudo', agora)
  const vazia = (chave: string): LinhaDeResultado => ({ chave, enviados: 0, viram: 0, responderam: 0, interesse: 0, recusaram: 0, fecharam: 0 })
  const comVideo = linhas.find(l => l.chave === 'Com vídeo') ?? vazia('Com vídeo')
  const semVideo = linhas.find(l => l.chave === 'Sem vídeo') ?? vazia('Sem vídeo')
  const leituraMs = noTeste.length ? Math.max(...noTeste.map(enviadoEm)) + DIAS_ATE_A_LEITURA * DIA_MS : null

  const base = {
    nicho, mensagem, inicio: inicioMs === null ? null : new Date(inicioMs).toISOString(), comVideo, semVideo,
    leituraEm: leituraMs === null ? null : new Date(leituraMs).toISOString(), foraDoDesenho, foraDoSorteio,
  }
  if (comVideo.enviados < ENVIOS_POR_BRACO || semVideo.enviados < ENVIOS_POR_BRACO) return { estado: 'amostra-insuficiente', ...base }
  if (leituraMs === null || agora < leituraMs) return { estado: 'aguardando-leitura', ...base }

  const taxaCom = comVideo.responderam / comVideo.enviados
  const taxaSem = semVideo.responderam / semVideo.enviados
  // Pelas contagens, arredondado: 9/20 − 5/20 em ponto flutuante dá 19,999… ou 20,000…4.
  const diferencaPp = Math.round(((comVideo.responderam * semVideo.enviados - semVideo.responderam * comVideo.enviados) * 100
    / (comVideo.enviados * semVideo.enviados)) * 1e6) / 1e6
  const p = fisherExato(comVideo.responderam, comVideo.enviados - comVideo.responderam, semVideo.responderam, semVideo.enviados - semVideo.responderam)
  return { estado: 'lido', ...base, numeros: { taxaCom, taxaSem, diferencaPp, p, veredito: veredito(diferencaPp, p) } }
}

/** "+25 pontos" / "−5 pontos" / "+1 ponto": a diferença do braço com vídeo sobre o sem. */
export function textoDaDiferenca(pp: number): string {
  const arredondado = Math.round(pp)
  const sinal = arredondado > 0 ? '+' : arredondado < 0 ? '−' : ''
  return `${sinal}${Math.abs(arredondado)} ${Math.abs(arredondado) === 1 ? 'ponto' : 'pontos'}`
}

/** "p = 0,014" / "p = 0,32": dois algarismos significativos; abaixo de 0,001, "p < 0,001". */
export function textoDoP(p: number): string {
  return p < 0.001 ? 'p < 0,001' : `p = ${Number(p.toPrecision(2)).toString().replace('.', ',')}`
}
