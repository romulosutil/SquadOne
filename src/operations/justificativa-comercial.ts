export interface JustificativaComercial {
  porQueComprar: string
  porQueOferta: string
  porQueAgora: string
  viabilidade: string
}

/** Só texto limitado chega à tela; retratos antigos não recebem justificativa fabricada. */
export function lerJustificativaComercial(valor: unknown): JustificativaComercial | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null
  const v = valor as Record<string, unknown>
  const campos = ['porQueComprar', 'porQueOferta', 'porQueAgora', 'viabilidade'] as const
  if (!campos.every(c => typeof v[c] === 'string' && v[c].trim() && v[c].length <= 1000)) return null
  return Object.fromEntries(campos.map(c => [c, v[c]])) as unknown as JustificativaComercial
}
