import assert from 'node:assert/strict'
import { it } from 'node:test'
import { contextoHumanoPreservado, ultimaRespostaHumanaEm } from './operations/resposta-humana.ts'
import type { CrmLead } from './operations/types'

const agora = Date.parse('2026-10-19T15:00:00Z')
const lead = (extra = {}): CrmLead => ({ id: 'site:fixture', produto: 'site', marcos: { respondeu: '2026-10-19T14:00:00Z' }, resposta: { tipo: 'bot', trecho: 'Atendimento automático', em: '2026-10-19T14:00:00Z' }, ...extra } as CrmLead)
it('marco e entrada genérica sem papel declarado não provam resposta humana', () => {
  const l = lead({ conversa: { desde: '2026-10-19T13:00:00Z', mensagens: 1, ultima: { direcao: 'entrada', em: '2026-10-19T14:00:00Z', trecho: 'Olá, como podemos ajudar?' } } })
  assert.equal(ultimaRespostaHumanaEm(l, agora), 0)
  assert.equal(contextoHumanoPreservado(l, agora), null)
})
it('última entrada humana do contrato preserva resposta anterior ao robô e ignora futuro', () => {
  const l = lead({ conversa: { desde: '2026-10-19T13:00:00Z', mensagens: 3, ultimaEntrada: '2026-10-19T13:30:00Z', ultima: { direcao: 'entrada', em: '2026-10-20T14:00:00Z', trecho: 'Resposta com relógio errado', papel: 'recepcao' } } })
  assert.equal(ultimaRespostaHumanaEm(l, agora), Date.parse('2026-10-19T13:30:00Z'))
  assert.ok(contextoHumanoPreservado(l, agora))
})
