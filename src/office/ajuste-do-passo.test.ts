import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ajusteDoPasso } from '../operations/ajuste-do-passo.ts'
import { retomadaDoLead } from '../operations/retomadas.ts'
import type { CrmLead } from '../operations/types.ts'
const agora = new Date('2026-10-19T01:00:00Z')
test('conclusão usa data real sem registrar ganho; reagendar futuro sai de Hoje mas preserva lead', () => {
  assert.deepEqual(ajusteDoPasso('concluir', 'ignorado', '2026-10-18', agora), { tipo: 'proximo_passo', texto: '', data: '2026-10-18' })
  const futuro = ajusteDoPasso('reagendar', ' Rômulo: confirmar decisão com Ana ', '2026-10-19', agora)
  const lead = { etapa: 'contato', eventos: [], proximoPasso: { ...futuro, registradoEm: agora.toISOString() } } as unknown as CrmLead
  assert.equal(retomadaDoLead(lead, agora), null)
  assert.ok(lead.proximoPasso)
  assert.equal(retomadaDoLead({ ...lead, proximoPasso: { ...lead.proximoPasso!, data: '2026-10-18' } }, agora)?.quando, 'hoje')
})
test('recusa datas inexistentes, conclusão futura, reagendamento passado e ação vazia', () => {
  for (const [acao, texto, data] of [['concluir', '', '2026-10-19'], ['concluir', '', '2026-02-30'], ['reagendar', 'Ligar', '2026-10-17'], ['reagendar', ' ', '2026-10-19'], ['ganhar', '', '2026-10-18']]) assert.throws(() => ajusteDoPasso(acao, texto, data, agora))
})
