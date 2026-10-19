export interface MensagemImportada { em: string; direcao: 'entrada' | 'saida'; texto: string }
export interface ExportacaoLida { mensagens: MensagemImportada[]; dono: string; contato: string }

/** Exportação individual PT-BR de Android/iOS. Prévia e servidor usam a mesma validação. */
export function lerExportacao(texto: string, dono: string, agora = Date.now()): ExportacaoLida {
  if (texto.length > 400_000) throw new Error('Use um arquivo de até 400 mil caracteres, sem mídia.')
  if (!dono.trim() || dono.trim().length > 100) throw new Error('Informe seu nome exatamente como aparece na exportação.')
  const linhas: Array<{ em: string; autor: string; texto: string }> = []
  let atual: typeof linhas[number] | null = null
  for (const bruta of texto.replace(/\r/g, '').replace(/[\u200e\u200f]/g, '').split('\n')) {
    const m = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(?:-\s*)?(.*)$/.exec(bruta)
    if (!m) { if (atual) atual.texto += `\n${bruta}`; continue }
    atual = null
    const autor = /^([^:]{1,100}): (.*)$/.exec(m[7]!)
    if (!autor) continue // avisos do sistema, sem participante
    const [dia, mes, ano, h, min, seg] = m.slice(1, 7).map(Number)
    const a = ano! < 100 ? 2000 + ano! : ano!
    const utc = Date.UTC(a, mes! - 1, dia, h! + 3, min, seg || 0)
    const local = new Date(utc - 3 * 3600_000)
    if (a < 2020 || local.getUTCFullYear() !== a || local.getUTCMonth() !== mes! - 1 || local.getUTCDate() !== dia || h! > 23 || min! > 59 || seg! > 59 || utc > agora + 300_000)
      throw new Error('Data inválida ou futura. Use uma exportação PT-BR desde 2020.')
    atual = { em: new Date(utc).toISOString(), autor: autor[1]!.trim(), texto: autor[2]! }
    linhas.push(atual)
    if (linhas.length > 2000) throw new Error('Mais de 2.000 mensagens: selecione uma exportação menor.')
  }
  const autores = [...new Set(linhas.map((m) => m.autor))]
  if (!linhas.length) throw new Error('Não encontrei mensagens no formato de exportação PT-BR.')
  if (!autores.includes(dono.trim()) || autores.length !== 2) throw new Error('Precisamos de uma conversa individual com dois participantes e seu nome exato. Grupos não são aceitos.')
  if (linhas.some((m) => m.texto.length > 2000)) throw new Error('Uma mensagem ultrapassa 2.000 caracteres; a importação foi cancelada para não cortar conteúdo.')
  return { dono: dono.trim(), contato: autores.find((a) => a !== dono.trim())!, mensagens: linhas.map((m) => ({ em: m.em, direcao: m.autor === dono.trim() ? 'saida' : 'entrada', texto: m.texto.trim() })) }
}
