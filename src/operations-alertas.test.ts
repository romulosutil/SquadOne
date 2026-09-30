import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { linkExterno, quantidadeDaFila, remedioEmComum, seloDoPasso, separarAlertas, soNoDell } from './operations/alertas.ts'
import type { DellCheck } from './operations/types.ts'

const c = (id: string, estado: DellCheck['estado'], extra: Partial<DellCheck> = {}): DellCheck => ({
  id, grupo: 'fluxos', nome: id, estado, detalhe: '', ...extra,
})

describe('separarAlertas', () => {
  it('vermelho nunca se esconde, fila é do CRM e o que resolve sozinho fica à parte', () => {
    const a = separarAlertas([
      c('ok', 'ok'),
      c('balcao', 'falha'),
      c('falha-sozinha', 'falha', { sozinho: true }),
      c('pend:site-enviar', 'atencao', { grupo: 'pendencias' }),
      c('pend:site-resposta', 'atencao', { grupo: 'pendencias', sozinho: true }),
      c('cacador', 'atencao', { sozinho: true }),
      c('cofre', 'atencao', { grupo: 'dados' }),
    ])
    assert.deepEqual(a.falhas.map(x => x.id), ['balcao', 'falha-sozinha'])
    assert.deepEqual(a.fila.map(x => x.id), ['pend:site-enviar'])
    assert.deepEqual(a.olhar.map(x => x.id), ['cofre'])
    assert.deepEqual(a.sozinhos.map(x => x.id), ['pend:site-resposta', 'cacador'])
  })
})

describe('links e filas', () => {
  it('loopback só abre no Dell; rota da Central abre aqui', () => {
    assert.equal(soNoDell('http://127.0.0.1:5679/workflow/1'), true)
    assert.equal(soNoDell('https://docs.google.com/spreadsheets/d/x'), false)
    assert.equal(soNoDell('/crm?produto=site'), false)
    assert.equal(linkExterno('/crm'), false)
    assert.equal(linkExterno('https://x.invalid/'), true)
  })

  it('conta a fila pelo começo do detalhe', () => {
    assert.equal(quantidadeDaFila(c('pend:site-enviar', 'atencao', { grupo: 'pendencias', detalhe: '53 · Clique no wa_link' })), 53)
    assert.equal(quantidadeDaFila(c('pend:sites-fila', 'atencao', { grupo: 'pendencias', detalhe: '14 lead(s) com pasta' })), 14)
    assert.equal(quantidadeDaFila(c('pend:x', 'ok', { grupo: 'pendencias', detalhe: 'nada' })), null)
    assert.equal(quantidadeDaFila(undefined), null)
  })

  it('selo do passo diz o estado por texto', () => {
    assert.deepEqual(seloDoPasso(c('x', 'falha')), { texto: 'Falhou agora', tom: 'falha' })
    assert.deepEqual(seloDoPasso(c('x', 'atencao', { sozinho: true })), { texto: 'Resolve sozinho', tom: 'sozinho' })
    assert.equal(seloDoPasso(c('x', 'ok')), null)
  })
})

describe('remedioEmComum', () => {
  it('junta falhas que pedem o mesmo gesto', () => {
    const cred = 'Reconecte a credencial "Google Sheets account" no n8n (Credentials › abrir › Reconnect, com a conta do Google).'
    const falhas = [
      c('balcao', 'falha', { oQueFazer: `${cred} Depois disso, a próxima rodada volta sozinha.` }),
      c('wa', 'falha', { oQueFazer: `${cred} Depois disso, clique em Retry.` }),
      c('hermes', 'falha', { oQueFazer: 'O Hermes parou.' }),
    ]
    assert.deepEqual(remedioEmComum(falhas), { texto: cred, quantas: 2 })
    assert.equal(remedioEmComum(falhas.slice(1)), null)
  })
})
