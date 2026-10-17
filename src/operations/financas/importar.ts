/**
 * PURO (16/10/2026, OT-11 do blueprint de serviço): a entrada única "Importar" de
 * Finanças decide, pelo arquivo escolhido, para qual dos dois fluxos ele vai:
 *  - `fatura`: PDF da fatura do Santander (/api/financas/importar/santander);
 *  - `extrato`: OFX ou CSV de reserva (/api/financas/importar/extrato).
 * A extensão manda: o celular costuma mandar CSV como `text/plain` ou sem tipo, e o
 * OFX quase nunca tem um MIME próprio. O MIME só desempata quando não há extensão.
 * `.txt` continua indo ao extrato, como no seletor antigo, porque há banco que baixa
 * o CSV com essa extensão. O resto é `null`, e a tela diz o que aceita em vez de
 * mandar ao servidor um arquivo que ele recusaria com um erro menos claro.
 */

export type TipoDeImportacao = 'fatura' | 'extrato'

/** O `accept` do seletor único: o que os dois fluxos aceitavam, somado. */
export const ACEITA_NA_IMPORTACAO = '.pdf,.ofx,.csv,.txt,application/pdf,application/x-ofx,text/csv'

const POR_EXTENSAO: Record<string, TipoDeImportacao> = {
  pdf: 'fatura',
  ofx: 'extrato',
  csv: 'extrato',
  txt: 'extrato',
}

const POR_MIME: Record<string, TipoDeImportacao> = {
  'application/pdf': 'fatura',
  'application/x-ofx': 'extrato',
  'application/ofx': 'extrato',
  'text/csv': 'extrato',
}

export function tipoDoArquivo(nome: string, mime: string): TipoDeImportacao | null {
  const ponto = nome.lastIndexOf('.')
  if (ponto > 0) {
    const extensao = nome.slice(ponto + 1).trim().toLowerCase()
    // hasOwn, não `in`: "arquivo.constructor" não pode cair num campo do protótipo.
    if (Object.hasOwn(POR_EXTENSAO, extensao)) return POR_EXTENSAO[extensao]
    // Extensão conhecida de outra coisa (.xlsx, .jpg): não adivinha pelo MIME.
    if (extensao) return null
  }
  const tipo = mime.split(';')[0].trim().toLowerCase()
  return Object.hasOwn(POR_MIME, tipo) ? POR_MIME[tipo] : null
}
