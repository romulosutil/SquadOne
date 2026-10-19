import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lerExportacao } from '../src/operations/importar-conversa.ts'
import { chaveDoNumero, lerLinhasDaConversa } from './conversa-do-lead.ts'

/** Só chamado com telefone resolvido no CRM e confirmação humana. Acrescenta, nunca substitui. */
export async function importarConversa(texto: string, dono: string, whatsapp: string | undefined, pasta: string, agora = Date.now()) {
  const chave = chaveDoNumero(whatsapp)
  if (!chave) throw new Error('Lead sem número válido de WhatsApp.')
  const lida = lerExportacao(texto, dono, agora)
  await fs.mkdir(pasta, { recursive: true, mode: 0o700 })
  return comTravaDoObservador(pasta, async () => {
  const arquivo = path.join(pasta, `${chave}.jsonl`)
  let guardado = ''
  try { guardado = await fs.readFile(arquivo, 'utf8') } catch (e: any) { if (e.code !== 'ENOENT') throw e }
  if (Buffer.byteLength(guardado) > 5 * 1024 * 1024) throw new Error('Arquivo existente excede o limite de importação.')
  const assinatura = (m: { em: string; direcao: string; texto: string }) => `${m.em.slice(0, 16)}|${m.direcao}|${m.texto.trim()}`
  const vistos = new Set(lerLinhasDaConversa(guardado, 100_000).map(assinatura))
  const novas = lida.mensagens.filter((m) => {
    const s = assinatura(m)
    if (vistos.has(s)) return false
    vistos.add(s)
    return true
  })
  if (novas.length) {
    await fs.mkdir(pasta, { recursive: true, mode: 0o700 })
    const linhas = novas.map((m) => JSON.stringify({ ...m, origem: 'importacao-exportacao', id: `import:${createHash('sha256').update(assinatura(m)).digest('hex')}` })).join('\n')
    await fs.appendFile(arquivo, `${guardado && !guardado.endsWith('\n') ? '\n' : ''}${linhas}\n`, { mode: 0o600 })
    await fs.chmod(arquivo, 0o600)
  }
  return { importadas: novas.length, duplicadas: lida.mensagens.length - novas.length, contato: lida.contato }
  })
}

/** A mesma .trava dos dois observadores: importação não pode competir com a poda atômica. */
async function comTravaDoObservador<T>(pasta: string, executar: () => Promise<T>): Promise<T> {
  if (process.platform !== 'linux') return executar() // testes locais; produção é Linux no Dell
  const trava = path.join(pasta, '.trava')
  const fd = await fs.open(trava, 'a', 0o600)
  await fd.close()
  const filho = spawn('flock', ['-w', '10', trava, process.execPath, '-e', "process.stdout.write('pronto'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"], { stdio: ['pipe', 'pipe', 'pipe'] })
  const encerrado = new Promise<void>((resolve) => { filho.once('exit', () => resolve()); filho.once('error', () => resolve()) })
  try {
    await new Promise<void>((resolve, reject) => {
      filho.stdout.once('data', () => resolve())
      filho.once('error', () => reject(new Error('Não foi possível obter a trava do histórico.')))
      filho.once('exit', () => reject(new Error('Histórico ocupado. Tente importar novamente.')))
    })
    return await executar()
  } finally { filho.stdin.end(); await encerrado }
}
