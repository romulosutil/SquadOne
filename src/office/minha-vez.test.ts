import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CrmLead } from '../operations/types.ts'
import { decisoesHumanasDoEscritorio, motivoDaMinhaVez } from './minha-vez.ts'
const agora = Date.parse('2026-10-26T20:00:00Z')
const entrada = '2026-10-26T18:00:00Z'
function lead(extra: Partial<CrmLead> = {}): CrmLead {
  return { id: 'cliente', produto: 'estampa', empresa: 'Cliente', etapa: 'contato', sinal: 'respondeu', eventos: [], marcos: { enviado: '2026-10-20T12:00:00Z' }, links: {},
    atendimentoComercial: { id: 'tarefa', tipo: 'handoff', titulo: 'Decisão comercial', motivo: 'Confirmar o contato direto antes de iniciar outra conversa.', alvo: 'operador', estado: 'humano', identidade: 'confirmada', ocorridoEm: entrada },
    conversa: { ultimaEntrada: entrada, ultimaSaida: '2026-10-26T17:00:00Z', ultima: { em: entrada, direcao: 'entrada', trecho: 'Fale com o responsável', papel: 'gente' } }, ...extra } as CrmLead
}
test('handoff comercial confirmado permanece mesmo com saída posterior e compromisso preservado', () => {
  assert.ok(motivoDaMinhaVez(lead(), agora))
  const casa = lead({ conversa: { ...lead().conversa!, ultimaSaida: '2026-10-26T19:00:00Z' } })
  assert.ok(motivoDaMinhaVez(casa, agora))
})
for (const [nome, extra] of [
  ['processado', { estado: 'concluido' }], ['time', { alvo: 'time' }], ['identidade ausente', { identidade: 'sem-prova' }],
  ['conflito', { identidade: 'conflito' }], ['captura', { motivo: 'A atualização do contexto não se confirmou; resolver a captura/projeção antes de responder.' }],
  ['identidade', { motivo: 'Resolver identidade da conta e da conversa antes de qualquer resposta.' }], ['futuro', { ocorridoEm: '2026-10-27T18:00:00Z' }],
] as const) test(`${nome} fica no acompanhamento sem reabrir decisão pelo rótulo handoff`, () => {
  const l = lead({ atendimentoComercial: { ...lead().atendimentoComercial!, ...extra } })
  assert.equal(motivoDaMinhaVez(l, agora), null)
  const [d] = decisoesHumanasDoEscritorio([l], [], agora)
  assert.equal(d.estado, 'acompanhando')
  assert.equal(d.acao, null)
})
for (const etapa of ['ganho', 'perdido'] as const) test(`handoff não reabre ${etapa}`, () => {
  const l = lead({ etapa })
  assert.equal(motivoDaMinhaVez(l, agora), null)
  assert.equal(decisoesHumanasDoEscritorio([l], [], agora)[0].estado, 'encerrada')
})
test('follow-up de silêncio e revisão interna genérica não são decisões', () => {
  const l = lead({ atendimentoComercial: undefined, conversa: undefined, classificacaoResposta: { classe: 'silencio', houveRespostaHumana: false } as CrmLead['classificacaoResposta'] })
  assert.equal(motivoDaMinhaVez(l, agora), null)
  const revisao = lead({ atendimentoComercial: undefined, conversa: undefined, proximoPasso: { texto: 'Revisão interna do histórico para conferir o contexto', data: '2026-10-20', registradoEm: '2026-10-19T20:00:00Z' } })
  assert.equal(motivoDaMinhaVez(revisao, agora), null)
})
test('resposta humana atual sem automação ainda precisa do operador', () => {
  const l = lead({ atendimentoComercial: undefined, classificacaoResposta: { classe: 'interesse', houveRespostaHumana: true, revisar: false, materialSolicitado: false } as CrmLead['classificacaoResposta'] })
  assert.ok(motivoDaMinhaVez(l, agora))
  const atendido = { ...l, conversa: { ...l.conversa!, ultimaSaida: '2026-10-26T19:00:00Z' } }
  assert.equal(motivoDaMinhaVez(atendido, agora), null)
})
test('filtro é puro e preserva todos os cartões e o histórico', () => {
  const l = lead({ atendimentoComercial: { ...lead().atendimentoComercial!, estado: 'concluido' } })
  const antes = JSON.stringify(l)
  assert.equal(decisoesHumanasDoEscritorio([l], [], agora).length, 1)
  assert.equal(JSON.stringify(l), antes)
})
