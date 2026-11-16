import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexarResponsaveisDaConversa, responsavelDaConversa, textoResponsavelConversa, chaveDaConversaBrasil } from './operations/responsavel-conversa.ts'
import type { CrmLead } from './operations/types.ts'

const agora = Date.parse('2026-10-26T15:00:00Z')
function evento(id: string, conversa: string, em: string, responsavel: 'romulo' | 'time' = 'romulo', anterior: string | null = null): CrmLead['eventos'][number] {
  return { tipo: 'nota', em, origem: 'manual', fonte: 'CRM', rotulo: 'Responsável', texto: textoResponsavelConversa({
    v: 2, id, conversa: chaveDaConversaBrasil(conversa), conta: 'prumo', canal: 'whatsapp', anterior, responsavel, data: em, motivo: 'Conferência humana', humano: true,
  }) }
}

test('índice compartilha responsável entre ofertas somente com sucessão v2 válida', () => {
  const telefone = '5511999999999', outro = '5521999999999'
  const eventos = [
    { eventos: [evento('owner-01', telefone, '2026-10-24T12:00:00Z')] },
    { eventos: [evento('owner-03', telefone, '2026-10-25T12:01:00Z', 'time', 'owner-02'), evento('owner-02', telefone, '2026-10-25T12:00:00Z', 'romulo', 'owner-01'), evento('owner-04', outro, '2026-10-25T13:00:00Z')] },
  ]
  const indice = indexarResponsaveisDaConversa(eventos, agora)
  const lead = { links: { whatsapp: `https://wa.me/${telefone}` } }
  assert.equal(responsavelDaConversa(lead, eventos, agora, indice)?.id, 'owner-03')
  assert.deepEqual(responsavelDaConversa(lead, eventos, agora, indice), responsavelDaConversa(lead, [...eventos].reverse(), agora))
  assert.equal(indice.get(chaveDaConversaBrasil(outro)!)?.id, 'owner-04')
  assert.equal(responsavelDaConversa({ links: {} }, eventos, agora, indice), null)
})

test('nota v2 temporalmente inválida bloqueia o índice, sem recuperar decisão anterior', () => {
  const valido = evento('owner-01', '5511999999999', '2026-10-24T12:00:00Z')
  const futuro = { ...valido, em: '2026-10-27T12:00:00Z' }
  const eventos = [{ eventos: [valido, futuro, { ...valido, em: 'inválida' }, { ...valido, origem: 'automático' as const }, { ...valido, texto: '[responsavel-conversa-v1] {}' }] }]
  assert.equal(indexarResponsaveisDaConversa(eventos, agora).size, 0)
  assert.deepEqual(indexarResponsaveisDaConversa(eventos.slice(0, 0), agora), new Map())
  const semValido = [{ eventos: eventos[0].eventos.slice(1) }]
  assert.equal(indexarResponsaveisDaConversa(semValido, agora).size, 0)
})

test('consultar mil leads com o índice não relê o histórico a cada cliente', () => {
  let leituras = 0
  const leads = Array.from({ length: 1000 }, () => ({
    links: { whatsapp: 'https://wa.me/5511999999999' },
    get eventos() { leituras++; return [evento('owner-01', '5511999999999', '2026-10-24T12:00:00Z')] },
  }))
  const indice = indexarResponsaveisDaConversa(leads, agora)
  for (const lead of leads) assert.equal(responsavelDaConversa(lead, leads, agora, indice)?.responsavel, 'romulo')
  assert.equal(leituras, leads.length)
})
