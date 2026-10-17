import type { DellCheck, DellStatus } from './types'

// PURO: como a home separa o retrato do dell-status. Vermelho é "você precisa
// agir ou está quebrado agora" e nunca se esconde; amarelo de fila é trabalho
// dele (CRM); o resto amarelo é "vale olhar"; o que resolve sozinho fica à parte.

export type GrupoDoAlerta = 'falha' | 'fila' | 'olhar'

export const ROTULO_DO_GRUPO: Record<GrupoDoAlerta, string> = {
  falha: 'Falhou',
  fila: 'Sua fila',
  olhar: 'Vale olhar',
}

export interface AlertasDaHome {
  falhas: DellCheck[]
  fila: DellCheck[]
  olhar: DellCheck[]
  sozinhos: DellCheck[]
}

export function grupoDoAlerta(c: DellCheck): GrupoDoAlerta {
  if (c.estado === 'falha') return 'falha'
  return c.grupo === 'pendencias' ? 'fila' : 'olhar'
}

export function separarAlertas(checks: DellCheck[]): AlertasDaHome {
  const alertas: AlertasDaHome = { falhas: [], fila: [], olhar: [], sozinhos: [] }
  for (const c of checks) {
    if (c.estado === 'ok') continue
    if (c.estado !== 'falha' && c.sozinho) alertas.sozinhos.push(c)
    else if (c.estado === 'falha') alertas.falhas.push(c)
    else if (c.grupo === 'pendencias') alertas.fila.push(c)
    else alertas.olhar.push(c)
  }
  return alertas
}

/** Quando duas ou mais falhas pedem a mesma coisa (ex.: reconectar a mesma
 * credencial do Google), a primeira frase do "o que fazer" é igual: diz uma
 * vez só que um gesto resolve todas. */
export function remedioEmComum(falhas: DellCheck[]): { texto: string; quantas: number } | null {
  const contagem = new Map<string, number>()
  for (const c of falhas) {
    const primeira = /^[^.]*\./.exec(c.oQueFazer ?? '')?.[0]
    if (primeira) contagem.set(primeira, (contagem.get(primeira) ?? 0) + 1)
  }
  const [texto, quantas] = [...contagem].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  return quantas >= 2 ? { texto, quantas } : null
}

/** Link que só abre no navegador do próprio Dell (loopback), não pelo celular. */
export function soNoDell(url: string): boolean {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url, 'https://central.invalid').hostname)
  } catch {
    return false
  }
}

/** Link para outra página (abre em aba nova); rota da Central abre aqui mesmo. */
export function linkExterno(url: string): boolean {
  return !url.startsWith('/')
}

/** Quantos itens uma fila tem ("53 · Clique…" ou "14 lead(s)…"). */
export function quantidadeDaFila(c: DellCheck | undefined): number | null {
  if (!c || c.grupo !== 'pendencias' || c.estado === 'ok') return null
  const m = /^\s*(\d+)/.exec(c.detalhe)
  return m ? Number(m[1]) : null
}

/** Selo de um passo do fluxo ligado a uma verificação viva; null quando está ok. */
export function seloDoPasso(c: DellCheck | undefined): { texto: string; tom: 'falha' | 'atencao' | 'sozinho' } | null {
  if (!c || c.estado === 'ok' || c.grupo === 'pendencias') return null
  if (c.estado === 'falha') return { texto: 'Falhou agora', tom: 'falha' }
  return c.sozinho ? { texto: 'Resolve sozinho', tom: 'sozinho' } : { texto: 'Vale olhar', tom: 'atencao' }
}

// ---------------------------------------------------------------- um número só (AC-17, 17/10/2026)

/**
 * O monitor grava a cada minuto e a Central relê a cada 30 s: cinco minutos sem
 * retrato novo é o monitor parado ou o Dell desligado. É o mesmo corte de
 * `RETRATO_VENCIDO_MS` em server/dell-status.ts (não importado de lá porque
 * aquele módulo lê o disco e não entra no bundle do navegador).
 */
export const RETRATO_VELHO_MS = 5 * 60_000

/**
 * O retrato contado do mesmo jeito no topo, na Hoje e no Mais. Até 17/10/2026
 * cada um contava uma coisa: o topo, só os vermelhos ("3 com falha"); a Hoje,
 * vermelhos + filas do CRM + amarelos + cartões dos agentes + finanças ("9
 * coisas"); o Mais, tudo o que não estava ok fora das filas, inclusive o que
 * resolve sozinho ("43 de 49 ok"). Três números para o mesmo instante.
 *
 * Aqui só entra saúde (as filas do CRM são trabalho de venda e têm contagem à
 * parte), e cada verificação que não está ok cai em exatamente um balde:
 *  - precisam de você: vermelho (nunca se esconde, mesmo marcado "sozinho") ou
 *    amarelo sem "sozinho" (o dell-status escreveu o que o Rômulo faz);
 *  - resolvem sozinhas: amarelo com "sozinho".
 * Assim `total - ok === precisam + sozinhas`, e o "N de M ok" do Mais bate com
 * o número do topo e da Hoje.
 */
export interface ResumoDoDell {
  /** Sem retrato recente (RULES 19): as contagens são do último retrato e não valem como "agora". */
  semNoticia: boolean
  /** Instante do retrato, "HH:MM"; vazio quando o retrato nem tem horário. */
  hora: string
  precisam: DellCheck[]
  /** Dos que precisam, quantos são vermelhos (o resto é amarelo). */
  vermelhos: number
  sozinhas: DellCheck[]
  /** Filas do CRM com algo esperando o Rômulo (não é saúde; não entra no "N de M ok"). */
  filas: DellCheck[]
  ok: number
  total: number
  /** "3 falhas precisam de você", "Nada no Dell precisa de você", "Sem notícia do Dell desde 08:15". */
  textoPrecisam: string
  /** "3 resolvem sozinhas"; vazio quando nenhuma. */
  textoSozinhas: string
  /** O chip do topo: o texto e o instante ("às 08:15" ou "desde 08:15"). */
  topo: { tom: 'ok' | 'falha' | 'pendente'; texto: string; quando: string }
  /** "43 de 49 ok · 3 precisam de você · 3 resolvem sozinhas". */
  textoDoMais: string
}

const contar = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
const precisamDeVoce = (n: number) => `${contar(n, 'precisa', 'precisam')} de você`

export function horaDoRetrato(iso: string | null | undefined, fuso?: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso }).format(new Date(iso))
}

const GRAVIDADE: Record<string, number> = { ok: 0, atencao: 1, falha: 2 }

/**
 * PURO: as verificações `container:<nome>` são o detalhe da verificação "Containers" (id
 * `containers`, mesmo grupo). Contadas uma a uma, o nome técnico do container virava título
 * na Hoje e cada container parado somava mais um "precisa de você" (17/10/2026: 5 em vez
 * de 3). Com a resumo presente, elas se juntam nela: o pior estado, o "desde" mais antigo
 * dos que não estão ok. Sem a resumo, ficam como vieram (nada some calado).
 */
export function juntarContainers(checks: DellCheck[]): DellCheck[] {
  const resumo = checks.find((c) => c.id === 'containers')
  const individuais = checks.filter((c) => c.id.startsWith('container:'))
  if (!resumo || !individuais.length) return checks
  const pior = [resumo, ...individuais].reduce((a, c) => ((GRAVIDADE[c.estado] ?? 0) > (GRAVIDADE[a.estado] ?? 0) ? c : a))
  const desdes = [resumo, ...individuais].filter((c) => c.estado !== 'ok' && c.desde).map((c) => c.desde as string).sort()
  const junto: DellCheck = { ...resumo, estado: pior.estado, desde: desdes[0] ?? resumo.desde }
  return checks.filter((c) => !c.id.startsWith('container:')).map((c) => (c === resumo ? junto : c))
}

/** PURO: retrato + relógio -> os números e os textos. `fuso` existe para o teste não depender da máquina. */
export function resumoDoDell(status: DellStatus | null, agora: number, fuso?: string): ResumoDoDell {
  const geradoEm = status?.geradoEm ?? null
  const instante = geradoEm ? Date.parse(geradoEm) : Number.NaN
  const semNoticia = !status || Number.isNaN(instante) || agora - instante > RETRATO_VELHO_MS
  const hora = horaDoRetrato(geradoEm, fuso)

  const precisam: DellCheck[] = []
  const sozinhas: DellCheck[] = []
  const filas: DellCheck[] = []
  let ok = 0
  let total = 0
  for (const c of juntarContainers(status?.verificacoes ?? [])) {
    if (c.grupo === 'pendencias') {
      if (c.estado !== 'ok' && !c.sozinho) filas.push(c)
      continue
    }
    total++
    if (c.estado === 'ok') ok++
    else if (c.estado !== 'falha' && c.sozinho) sozinhas.push(c)
    else precisam.push(c)
  }
  const vermelhos = precisam.filter((c) => c.estado === 'falha').length
  const amarelos = precisam.length - vermelhos

  const desde = hora ? `desde ${hora}` : ''
  const as = hora ? `às ${hora}` : ''
  let textoPrecisam: string
  if (semNoticia) textoPrecisam = desde ? `Sem notícia do Dell ${desde}` : 'Sem notícia do Dell'
  else if (!precisam.length) textoPrecisam = 'Nada no Dell precisa de você'
  else {
    const partes = [vermelhos ? contar(vermelhos, 'falha', 'falhas') : '', amarelos ? contar(amarelos, 'aviso', 'avisos') : '']
    textoPrecisam = `${partes.filter(Boolean).join(' e ')} ${precisam.length === 1 ? 'precisa' : 'precisam'} de você`
  }
  const textoSozinhas = sozinhas.length ? contar(sozinhas.length, 'resolve sozinha', 'resolvem sozinhas') : ''

  const topo: ResumoDoDell['topo'] = semNoticia
    ? { tom: 'pendente', texto: 'Sem notícia do Dell', quando: desde }
    : precisam.length
      ? { tom: vermelhos ? 'falha' : 'pendente', texto: precisamDeVoce(precisam.length), quando: as }
      : { tom: 'ok', texto: 'Dell: tudo certo', quando: as }

  const contagem = [`${ok} de ${total} ok`, precisam.length ? precisamDeVoce(precisam.length) : '', textoSozinhas]
    .filter(Boolean)
    .join(' · ')
  // Sem notícia, a contagem é do último retrato: diz de quando, em vez de parecer o estado de agora.
  const textoDoMais = semNoticia ? (total ? `${textoPrecisam} · no último retrato, ${contagem}` : textoPrecisam) : contagem

  return { semNoticia, hora, precisam, vermelhos, sozinhas, filas, ok, total, textoPrecisam, textoSozinhas, topo, textoDoMais }
}

/**
 * O texto do servidor pode chegar cortado no limite de caracteres (o "o que
 * fazer" vai até 400 em server/dell-status.ts) e acabar no meio de uma palavra
 * ("ele vai par"). Mostra até a última frase inteira; sem nenhuma, como veio.
 */
export function semFraseCortada(texto: string): string {
  const t = texto.trim()
  if (!t || /[.!?…:;][)"”`]?$/.test(t)) return t
  const inteira = /^[\s\S]*[.!?…](?=[)"”]?\s)[)"”]?/.exec(t)?.[0]
  return inteira ? inteira.trim() : t
}
