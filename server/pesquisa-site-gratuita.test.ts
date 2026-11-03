import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { achadosDaPesquisaSite, lerPastasDosLeads } from './auto-production.ts'

const agora = Date.now()
const dado = () => ({ versao: 1, place_id: 'ChIJpesquisa01', revisadoEm: new Date(agora).toISOString(),
  validoAte: new Date(agora + 6 * 86400_000).toISOString(),
  fontes: [{ url: 'https://empresa.example/contato', em: new Date(agora).toISOString() }],
  achados: [{ id: 'site-sem-celular-ou-whatsapp', celular: false, whatsapp: false }] })

test('fonte explícita e identidade correta permitem achado; rejeita identidade trocada e ausência de fonte', () => {
  assert.equal(achadosDaPesquisaSite(dado(), 'ChIJpesquisa01', agora)?.length, 1)
  assert.equal(achadosDaPesquisaSite(dado(), 'ChIJoutra', agora), undefined)
  assert.equal(achadosDaPesquisaSite({ ...dado(), fontes: [] }, 'ChIJpesquisa01', agora), undefined)
  assert.equal(achadosDaPesquisaSite({ ...dado(), achados: [{ id: 'sem-site' }, { id: 'foo' }] }, 'ChIJpesquisa01', agora)?.length, 1)
})
test('não renova evidência vencida apenas alterando data da revisão', () => {
  assert.equal(achadosDaPesquisaSite({ ...dado(), fontes: [{ url: 'https://empresa.example', em: new Date(agora - 31 * 86400_000).toISOString() }] }, 'ChIJpesquisa01', agora), undefined)
  assert.equal(achadosDaPesquisaSite({ ...dado(), revisadoEm: new Date(agora + 3600_000).toISOString() }, 'ChIJpesquisa01', agora), undefined)
  assert.equal(achadosDaPesquisaSite({ ...dado(), validoAte: new Date(agora - 1).toISOString() }, 'ChIJpesquisa01', agora), undefined)
})
test('pesquisa local não fabrica demo ou relatório publicado', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pesquisa-site-'))
  try {
    const lead = path.join(root, 'empresa'); await fs.mkdir(lead)
    await fs.writeFile(path.join(lead, 'content.md'), '# Empresa\n- **place_id:** ChIJpesquisa01')
    await fs.writeFile(path.join(lead, 'raio-x-pesquisa-gratuita.json'), JSON.stringify(dado()))
    const { pastas } = await lerPastasDosLeads(root)
    assert.equal(pastas[0].pesquisaSiteAchados?.length, 1)
    assert.equal(pastas[0].artefatos.publicado, false)
    assert.equal(pastas[0].siteUrl, undefined)
    assert.equal(pastas[0].raioXUrl, undefined)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
