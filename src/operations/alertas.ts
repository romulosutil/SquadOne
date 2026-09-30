import type { DellCheck } from './types'

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
