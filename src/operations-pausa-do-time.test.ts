import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pausaDoTime, textoDaPausa } from './operations/pausa-do-time.ts'
import { proximoPassoDoTime } from './operations/proximo-passo-do-time.ts'

// A pausa visível (29/10/2026): em 28/10 às 19:41 a proteção pausou o time por WhatsApp desconectado
// e a Central só dizia "Primeiros contatos pausados".

const DESCONECTADO = { motivo: 'desconectado', desde: '2026-10-28T22:41:54.406Z', detalhe: 'O WhatsApp do PRUMO está desconectado.' }

describe('pausa do time', () => {
  it('a pausa automática diz desde quando e por quê, mesmo com a config antiga sem autor', () => {
    const p = pausaDoTime({ ativo: false, atualizadoEm: '2026-10-28T22:41:54.500Z' }, DESCONECTADO)
    assert.deepEqual(p, { desde: '2026-10-28T22:41:54.406Z', por: 'protecao', motivo: 'WhatsApp do PRUMO desconectado' })
    assert.equal(textoDaPausa(p!), 'Pausado desde 28/10 19:41 por WhatsApp do PRUMO desconectado (proteção automática)')
  })

  it('a pausa automática vale mesmo com a config dizendo ativo', () => {
    assert.equal(pausaDoTime({ ativo: true }, DESCONECTADO)?.por, 'protecao')
  })

  it('pausa manual registrada na config', () => {
    const p = pausaDoTime({ ativo: false, pausadoEm: '2026-10-29T12:00:00Z', pausadoPor: 'central', motivoDaPausa: 'Pausa manual na Central' }, null)
    assert.equal(textoDaPausa(p!), 'Pausado desde 29/10 09:00 por Pausa manual na Central (na Central)')
  })

  it('config antiga sem autor: a última gravação e "motivo não registrado", nunca um motivo inventado', () => {
    const p = pausaDoTime({ ativo: false, atualizadoEm: '2026-10-28T22:41:54.500Z' }, null)
    assert.deepEqual(p, { desde: '2026-10-28T22:41:54.500Z', por: 'nao-registrado', motivo: 'motivo não registrado' })
  })

  it('ativo e sem pausa automática: sem pausa', () => {
    assert.equal(pausaDoTime({ ativo: true, pausadoPor: 'central' }, null), null)
  })

  it('o passo do time leva a pausa para a Central', () => {
    const agora = Date.parse('2026-10-29T12:00:00Z')
    const pausa = pausaDoTime({ ativo: false }, DESCONECTADO)
    const passo = proximoPassoDoTime({ ativo: false, estado: 'pausado', atualizadoEm: '2026-10-29T11:59:00Z', fila: [], pausa }, '', agora)
    assert.equal(passo.titulo, 'Primeiros contatos pausados')
    assert.equal(passo.quando, 'Pausado desde 28/10 19:41 por WhatsApp do PRUMO desconectado (proteção automática)')
    assert.equal(passo.pausa, passo.quando)
    assert.equal(passo.tom, 'atencao')
  })
})
