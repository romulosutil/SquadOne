// Se o copiloto está ligado nesta Central (GET /api/operations/crm/copiloto). Uma pergunta por
// carga da página: a env só muda com reinício, e a Ficha abre e fecha muitas vezes. Falha de
// rede não fica guardada (a próxima Ficha pergunta de novo) e conta como desligado: sem o
// copiloto, a Ficha é a de sempre.
let pedido: Promise<boolean> | null = null

export function copilotoLigado(): Promise<boolean> {
  pedido ??= fetch('/api/operations/crm/copiloto')
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: { ligado?: unknown }) => d.ligado === true)
    .catch(() => {
      pedido = null
      return false
    })
  return pedido
}
