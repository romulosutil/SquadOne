import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'node:test'
import { notaDoAprendizado } from '../src/operations/aprendizado-comercial.ts'

it('o nó real de montagem do retrato preserva notas de 1000 caracteres e o JSON do aprendizado', async () => {
  const fonte = await readFile(new URL('../deploy/dell/claude-ops/crm.py', import.meta.url), 'utf8')
  const codigo = fonte.slice(fonte.indexOf('const ler = '), fonte.indexOf("const site = ler('Ler Leads'"))
  assert.ok(codigo.startsWith('const ler = '))
  const nota = notaDoAprendizado({ fato: 'f'.repeat(180), hipotese: 'h'.repeat(180), teste: 't'.repeat(180), resultado: 'inconclusivo', pausarAteResposta: true })
  assert.ok(nota.length > 500 && nota.length <= 1000)
  const linhas = [{ json: { id: 'lead-1', texto: nota, outra: 'x'.repeat(700), wa_me: 'w'.repeat(4500) } },
    { json: { id: 'lead-2', texto: 'y'.repeat(1100) } }]
  const executar = new Function('$', 'txt', 'norm', 'FORA', codigo + "\nreturn ler('Ler aba CRM', 'id');")
  const retrato = executar(() => ({ all: () => linhas }), (v: unknown) => String(v ?? '').trim(), (s: string) => s.toLowerCase(), new Set())
  assert.equal(retrato.linhas[0].texto, nota)
  assert.equal(retrato.linhas[0].outra.length, 500)
  assert.equal(retrato.linhas[0].wa_me.length, 4000)
  assert.equal(retrato.linhas[1].texto.length, 1000)
})
