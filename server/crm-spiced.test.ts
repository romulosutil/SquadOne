import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { CrmStore, montarCrm, RegistroInvalido, validarRegistro, validarRetrato, type CrmVisao } from './crm.ts'
import { spicedVazio, textoDoRegistroSpiced } from '../src/operations/spiced.ts'

const AGORA = new Date('2026-10-19T15:00:00Z')
const QUAL = { ...spicedVazio(), dor: 'perde pedidos', impacto: 'retrabalho', decisao: { decisor_confirmado: 'sim' as const, quem: 'a dona', como_paga: '' } }
const registro = (produto: string, texto = textoDoRegistroSpiced(QUAL), em = '2026-10-19T14:00:00Z') => ({ produto, id: 'SPI-001', tipo: 'spiced', texto, em, data: '' })

function montar(registros: Record<string, string>[]) {
  const r = validarRetrato({ versao: 1, geradoEm: AGORA.toISOString(), fontes: {
    site: { linhas: [{ place_id: 'SPI-001', nome: 'Empresa Site', status: 'enviado', enviado_em: '2026-10-19T10:00:00Z' }] },
    prumo: { linhas: [{ ID: 'SPI-001', Empresa: 'Empresa PRUMO', Etapa: 'Convidado' }] },
    iris: { linhas: [{ ID: 'SPI-001', Empresa: 'Empresa Iris', Etapa: 'Convidado' }] },
    estampa: { linhas: [{ ID: 'SPI-001', Empresa: 'Empresa Estampa', Etapa: 'Convidado' }] },
    registros: { linhas: registros },
  } })
  return montarCrm(r, { agora: AGORA, plus: { leads: [{ id: 'SPI-001', empresa: 'Empresa Plus', nicho: 'teste', cidade: 'Vitória', uf: 'ES', whatsapp: '5527999990000', fixo: false, oferta: 'site', descricao: '' }] } })
}

describe('CRM: SPICED é registro confirmado, independente da etapa histórica', () => {
  it('as cinco linhas leem a última confirmação válida, sem usar registro futuro, inválido ou de outro lead', () => {
    const produtos = ['site', 'prumo', 'iris', 'estampa', 'plus']
    const registros = produtos.flatMap(p => [
      registro(p, textoDoRegistroSpiced(spicedVazio()), '2026-10-19T12:00:00Z'),
      registro(p),
      registro(p, '{', '2026-10-19T14:30:00Z'),
      registro(p, textoDoRegistroSpiced(spicedVazio()), '2026-10-20T14:00:00Z'),
      { ...registro(p, textoDoRegistroSpiced(spicedVazio())), id: 'OUTRO' },
    ])
    const v = montar(registros)
    assert.equal(v.leads.length, 5)
    for (const lead of v.leads) assert.deepEqual(lead.spiced, QUAL, lead.id)
  })

  it('nenhuma coluna da fonte ou nota do modelo vira qualificação confirmada', () => {
    const v = montar([{ ...registro('site'), tipo: 'nota' }])
    assert.ok(v.leads.every(l => l.spiced === undefined))
  })

  it('uma revisão humana vazia válida limpa a qualificação anterior', () => {
    const l = montar([registro('site'), registro('site', textoDoRegistroSpiced(spicedVazio()), '2026-10-19T14:59:00Z')]).leads.find(l => l.produto === 'site')!
    assert.deepEqual(l.spiced, spicedVazio())
  })

  it('excesso não é cortado até se tornar um JSON válido', () => {
    assert.equal(montar([registro('site', textoDoRegistroSpiced(QUAL) + ' '.repeat(1000))]).leads.find(l => l.produto === 'site')?.spiced, undefined)
  })

  it('valida esquema e data real na fronteira de gravação', () => {
    assert.equal(validarRegistro(registro('site'), AGORA).tipo, 'spiced')
    assert.throws(() => validarRegistro(registro('site', JSON.stringify({ ...QUAL, evento_critico: { fato: 'teste', data: '2026-02-30' } })), AGORA), RegistroInvalido)
    assert.throws(() => validarRegistro(registro('site', textoDoRegistroSpiced(QUAL) + ' '.repeat(1000)), AGORA), RegistroInvalido)
    assert.throws(() => validarRegistro(registro('site', JSON.stringify({ ...QUAL, decisao: { ...QUAL.decisao, decisor_confirmado: 'talvez' } })), AGORA), RegistroInvalido)
  })

  it('o caminho CRM existente grava SPICED e conserva proposta histórica sem gate retroativo', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spiced-crm-'))
    try {
      const segredoArquivo = path.join(dir, 'segredo')
      await fs.writeFile(segredoArquivo, 'somente-fixture')
      const corpos: Array<Record<string, unknown>> = []
      const fakeFetch: typeof fetch = async (_url, init) => {
        corpos.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ ok: true, em: AGORA.toISOString() }), { status: 200 })
      }
      const store = new CrmStore({ retrato: path.join(dir, 'nao-usado.json'), segredoArquivo, registroUrl: 'http://127.0.0.1:5679/webhook/crm-registro' }, fakeFetch)
      store.visao = async () => ({ leads: [{ id: 'site:SPI-001', empresa: 'Empresa exemplo', produto: 'site', etapa: 'contato', sinal: 'respondeu', eventos: [] }] }) as unknown as CrmVisao
      await store.registrar(registro('site'), AGORA)
      await store.registrar({ produto: 'site', id: 'SPI-001', tipo: 'proposta', texto: 'Condição histórica confirmada pelo operador: 90/mês', data: '2026-10-18' }, AGORA)
      assert.equal(corpos[0].tipo, 'spiced')
      assert.deepEqual(JSON.parse(String(corpos[0].texto)), QUAL)
      assert.equal(corpos[1].tipo, 'proposta')
      assert.match(String(corpos[1].texto), /90\/mês/)
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
})
