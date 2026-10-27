/** Cache de consulta: nunca fornece autorização para uma ação comercial. */
export function compartilharLeitura<T>(buscar: () => Promise<T>, validadeMs = 5_000, agora = Date.now) {
  let cache: { valor: T; ate: number } | undefined
  let pendente: Promise<T> | undefined
  let geracao = 0
  function ler(): Promise<T> {
    if (cache && agora() < cache.ate) return Promise.resolve(cache.valor)
    if (pendente) return pendente
    const inicio = geracao
    const leitura = Promise.resolve().then(buscar).then(valor => {
      if (geracao === inicio) cache = { valor, ate: agora() + validadeMs }
      return valor
    }).finally(() => { if (pendente === leitura) pendente = undefined })
    pendente = leitura
    return leitura
  }
  ler.invalidar = () => { geracao++; cache = undefined; pendente = undefined }
  return ler
}
