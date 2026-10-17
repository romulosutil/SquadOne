import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ACEITA_NA_IMPORTACAO, tipoDoArquivo } from './operations/financas/importar.ts'

// OT-11 (16/10/2026): um "Importar" só em Finanças; o arquivo escolhe o fluxo.
describe('tipoDoArquivo', () => {
  it('a extensão manda, sem diferenciar caixa', () => {
    const casos: Array<[string, string, ReturnType<typeof tipoDoArquivo>]> = [
      ['fatura-out.pdf', 'application/pdf', 'fatura'],
      ['FATURA.PDF', '', 'fatura'],
      ['extrato.ofx', '', 'extrato'],
      ['extrato.OFX', 'application/octet-stream', 'extrato'],
      ['nubank.csv', 'text/csv', 'extrato'],
      // O celular manda CSV como texto puro: a extensão decide, não o MIME.
      ['inter.csv', 'text/plain', 'extrato'],
      // .txt seguia ao extrato no seletor antigo (banco que baixa CSV assim).
      ['extrato.txt', 'text/plain', 'extrato'],
    ]
    for (const [nome, mime, esperado] of casos) assert.equal(tipoDoArquivo(nome, mime), esperado, nome)
  })

  it('sem extensão, o MIME desempata', () => {
    assert.equal(tipoDoArquivo('fatura', 'application/pdf'), 'fatura')
    assert.equal(tipoDoArquivo('extrato', 'application/x-ofx'), 'extrato')
    assert.equal(tipoDoArquivo('extrato', 'text/csv; charset=utf-8'), 'extrato')
    assert.equal(tipoDoArquivo('extrato', ''), null)
  })

  it('o que nenhum fluxo lê é recusado na tela, mesmo com MIME que pareceria servir', () => {
    assert.equal(tipoDoArquivo('planilha.xlsx', 'text/csv'), null)
    assert.equal(tipoDoArquivo('foto.jpg', 'image/jpeg'), null)
    assert.equal(tipoDoArquivo('a.constructor', ''), null)
  })

  it('o seletor aceita PDF, OFX e CSV (e o .txt de antes)', () => {
    for (const ext of ['.pdf', '.ofx', '.csv', '.txt']) assert.ok(ACEITA_NA_IMPORTACAO.split(',').includes(ext), ext)
  })
})
