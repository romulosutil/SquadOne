/** Espelho conferido em 19/10/2026 da fonte existente da Iris; não depende do checkout externo em runtime. */
export const ORIGEM_DOS_PRECOS_IRIS = {
  arquivo: 'Iris/src/lib/billing/calculator.ts',
  sha256: 'd8a8006d8151ef7c5ea54bc3c8622306a4a899175d1ed3ee57f8428a3dae880d',
  conferidoEm: '2026-10-19',
} as const

/** Marginais e acumuladas: a 16ª ficha não altera o preço das 15 anteriores. Unidade = ficha ativa/mês. */
export const FAIXAS_PRECIFICACAO_IRIS = [
  { ateQuantidade: 15, valorCentavos: 3900 },
  { ateQuantidade: 40, valorCentavos: 3200 },
  { ateQuantidade: null, valorCentavos: 2500 },
] as const

export function detalharMensalidadeIris(fichasAtivas: number) {
  if (!Number.isSafeInteger(fichasAtivas) || fichasAtivas < 0) throw new RangeError('Informe uma quantidade inteira não negativa de fichas ativas.')
  const detalhes: Array<{ quantidade: number; valorCentavos: number; subtotalCentavos: number }> = []
  let contabilizadas = 0
  for (const faixa of FAIXAS_PRECIFICACAO_IRIS) {
    const quantidade = Math.min(fichasAtivas, faixa.ateQuantidade ?? fichasAtivas) - contabilizadas
    if (quantidade <= 0) continue
    const subtotalCentavos = quantidade * faixa.valorCentavos
    if (!Number.isSafeInteger(subtotalCentavos)) throw new RangeError('Quantidade de fichas ativas excede o limite de cálculo.')
    detalhes.push({ quantidade, valorCentavos: faixa.valorCentavos, subtotalCentavos })
    contabilizadas += quantidade
  }
  return detalhes
}

export function mensalidadeIrisCentavos(fichasAtivas: number): number {
  const total = detalharMensalidadeIris(fichasAtivas).reduce((s, f) => s + f.subtotalCentavos, 0)
  if (!Number.isSafeInteger(total)) throw new RangeError('Mensalidade excede o limite de cálculo.')
  return total
}

export const PRECOS_CANONICOS_IRIS = FAIXAS_PRECIFICACAO_IRIS.map(f => `R$ ${f.valorCentavos / 100}`)

/** Texto determinístico: quantidade e total só podem ser completados depois de confirmação humana. */
export function textoDasFaixasIris(): string {
  const [primeira, segunda, terceira] = FAIXAS_PRECIFICACAO_IRIS
  return `Mensalidade por ficha ativa, em faixas marginais acumuladas:\nAté ${primeira.ateQuantidade} fichas: R$ ${primeira.valorCentavos / 100} por ficha ativa/mês.\nDa ${primeira.ateQuantidade + 1}ª à ${segunda.ateQuantidade}ª ficha: R$ ${segunda.valorCentavos / 100} por ficha adicional/mês.\nA partir da ${segunda.ateQuantidade + 1}ª ficha: R$ ${terceira.valorCentavos / 100} por ficha adicional/mês.\nAs faixas anteriores mantêm seus valores; a faixa seguinte não recalcula as anteriores.\nQuantidade de fichas ativas: [confirmar]. Total mensal: [calcular após confirmar a quantidade].`
}
