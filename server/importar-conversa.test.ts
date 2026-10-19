import assert from 'node:assert/strict'
import { it } from 'node:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { importarConversa } from './importar-conversa.ts'
import { lerConversa, lerLinhasDaConversa } from './conversa-do-lead.ts'

it('original recuperado substitui transcrição aproximada do print; repetições reais continuam distintas', () => {
  const base = { em: '2026-10-14T15:31:00Z', direcao: 'saida', texto: 'Vou pedir o link', origem: 'print-16-10' }
  const real = { ...base, em: '2026-10-14T15:31:29Z', origem: 'hermes-historico', id: 'real-1' }
  const outro = { ...real, em: '2026-10-14T15:31:40Z', id: 'real-2' }
  const resultado = lerLinhasDaConversa([base, real, outro].map((m) => JSON.stringify(m)).join('\n'))
  assert.equal(resultado.length, 2)
  assert.equal(resultado[0].em, '2026-10-14T15:31:29.000Z')
});

it('importar acrescenta sem substituir, deduplica exportações e eventos já observados e recusa telefone livre', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'squadone-importacao-'))
  try {
    const arquivo = path.join(pasta, '1199990000.jsonl')
    await fs.writeFile(arquivo, JSON.stringify({ em: '2026-10-17T12:01:30Z', direcao: 'saida', texto: 'Oi', id: 'observado' }) + '\n')
    const texto = '17/10/2026 09:01 - Rômulo: Oi\n17/10/2026 09:02 - Jaqueline: Pode mandar'
    const a = await importarConversa(texto, 'Rômulo', 'https://wa.me/5511999990000', pasta, Date.parse('2026-10-17T13:00Z'))
    assert.deepEqual(a, { importadas: 1, duplicadas: 1, contato: 'Jaqueline' })
    const antes = await fs.readFile(arquivo, 'utf8')
    assert.match(antes, /observado/)
    assert.match(antes, /importacao-exportacao/)
    assert.equal((await lerConversa('1199990000', pasta))?.length, 2)
    assert.equal((await importarConversa(texto, 'Rômulo', 'https://wa.me/5511999990000', pasta, Date.parse('2026-10-17T13:00Z'))).importadas, 0)
    assert.equal(await fs.readFile(arquivo, 'utf8'), antes)
    await assert.rejects(importarConversa(texto, 'Rômulo', undefined, pasta), /número válido/)
    if (process.platform !== 'win32') assert.equal((await fs.stat(arquivo)).mode & 0o777, 0o600)
  } finally { await fs.rm(pasta, { recursive: true, force: true }) }
})
