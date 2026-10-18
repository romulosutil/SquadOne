import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planoDoDia } from './operations/plano-do-dia.ts'
import { diagnosticoDeVenda, MAX_PARADOS } from './operations/por-que-nao-vende.ts'
import { chamadaDaAcao, type AcaoDeVenda } from './operations/proxima-venda.ts'
import { minutosAteFecharOExpediente, proximaAberturaDoExpediente } from './operations/trava-de-horario.ts'
import type { CrmLead } from './operations/types.ts'

// O plano do dia, a chamada "Envie para X, isto:" e o gargalo com nomes (17/10/2026). Tudo fixture.
// Relógio de São Paulo = UTC−3.

const qua10h = Date.parse('2026-10-14T13:00:00Z') // quarta 10:00
const qua17h = Date.parse('2026-10-14T20:00:00Z') // quarta 17:00 (30 min para fechar)
const qua19h = Date.parse('2026-10-14T22:00:00Z') // quarta 19:00, fora
const sex19h = Date.parse('2026-10-16T22:00:00Z') // sexta 19:00, fora
const sab10h = Date.parse('2026-10-17T13:00:00Z') // sábado 10:00, fora
const qua06h = Date.parse('2026-10-14T09:00:00Z') // quarta 06:00, fora

const resumo = (porGrupo: Partial<Record<string, number>>, primeirosAindaHoje = 0, total?: number) => ({
  total: total ?? Object.values(porGrupo).reduce((s, n) => s + (n ?? 0), 0),
  porGrupo: { responder: 0, proposta: 0, followup: 0, primeiro: 0, desfecho: 0, ...porGrupo },
  primeirosAindaHoje,
})

describe('janela do expediente', () => {
  it('minutos até fechar só dentro do expediente', () => {
    assert.equal(minutosAteFecharOExpediente(qua10h), 7 * 60 + 30)
    assert.equal(minutosAteFecharOExpediente(qua17h), 30)
    assert.equal(minutosAteFecharOExpediente(qua19h), null)
  })
  it('quando abre de novo', () => {
    assert.equal(proximaAberturaDoExpediente(qua06h), 'hoje às 8h')
    assert.equal(proximaAberturaDoExpediente(qua19h), 'amanhã às 8h')
    assert.equal(proximaAberturaDoExpediente(sex19h), 'segunda às 8h')
    assert.equal(proximaAberturaDoExpediente(sab10h), 'segunda às 8h')
  })
})

describe('planoDoDia', () => {
  it('começo do dia: tudo por fazer, primeiros contatos pela conta do ritmo', () => {
    const p = planoDoDia({ resumo: resumo({ responder: 2, followup: 1, primeiro: 1 }, 4), feitas: 0, agora: qua10h, gargalo: null })
    assert.equal(p.restantes, 7) // 2 respostas + 1 follow-up + até 4 primeiros
    assert.equal(p.manchete, '7 ações para hoje')
    assert.equal(p.oQueFalta, '2 respostas · 1 follow-up · até 4 primeiros contatos')
    assert.equal(p.progresso, 0)
    assert.equal(p.urgente, false)
    assert.match(p.janela, /aberta até as 17h30 \(faltam 7 h 30 min\)/)
  })

  it('meio do dia: mostra o andamento', () => {
    const p = planoDoDia({ resumo: resumo({ responder: 1 }), feitas: 3, agora: qua10h, gargalo: null })
    assert.equal(p.manchete, '3 de 4 feitas, falta 1')
    assert.equal(p.progresso, 0.75)
  })

  it('perto de fechar com trabalho na fila: urgente, em minutos', () => {
    const p = planoDoDia({ resumo: resumo({ followup: 2 }), feitas: 0, agora: qua17h, gargalo: null })
    assert.equal(p.urgente, true)
    assert.equal(p.janela, 'Faltam 30 min para fechar a janela de envio (17h30).')
  })

  it('perto de fechar sem nada na fila não alarma', () => {
    const p = planoDoDia({ resumo: resumo({}), feitas: 5, agora: qua17h, gargalo: null })
    assert.equal(p.urgente, false)
    assert.equal(p.manchete, 'Em dia: 5 envios feitos hoje')
  })

  it('fora do horário: os primeiros contatos esperam a janela e não entram na conta; as respostas não', () => {
    const p = planoDoDia({ resumo: resumo({ responder: 1 }, 6), feitas: 0, agora: sex19h, gargalo: null })
    assert.equal(p.restantes, 1)
    assert.equal(p.oQueFalta, '1 resposta')
    assert.match(p.janela, /volta segunda às 8h/)
    assert.match(p.janela, /primeiros contatos esperam por ela; as respostas não/)
  })

  it('fila vazia e dia sem envio: o próximo passo é a ação do gargalo', () => {
    const p = planoDoDia({ resumo: resumo({}), feitas: 0, agora: qua10h, gargalo: { titulo: 'Pouca gente responde', acao: 'Termine com uma pergunta de sim ou não.' } })
    assert.equal(p.manchete, 'Nada esperando por você agora')
    assert.equal(p.proximoPasso, 'Pouca gente responde. Termine com uma pergunta de sim ou não.')
  })

  it('com trabalho na fila não propõe o gargalo (a fila manda)', () => {
    const p = planoDoDia({ resumo: resumo({ responder: 1 }), feitas: 0, agora: qua10h, gargalo: { titulo: 'x', acao: 'y' } })
    assert.equal(p.proximoPasso, '')
  })

  it('ritmo pausado: nenhum primeiro contato entra na conta', () => {
    const p = planoDoDia({ resumo: resumo({ primeiro: 1 }, 0), feitas: 0, agora: qua10h, gargalo: null })
    assert.equal(p.restantes, 0)
  })
})

describe('chamadaDaAcao: "Envie para X, isto:"', () => {
  const base = { empresa: 'Kulniski Advocacia', tipo: 'responder' as AcaoDeVenda['tipo'] }
  it('com mensagem pronta', () => {
    assert.equal(chamadaDaAcao({ ...base, rascunho: 'Oi!' }), 'Envie para Kulniski Advocacia, isto:')
  })
  it('sem texto pronto o passo é escrever à mão', () => {
    assert.equal(chamadaDaAcao(base), 'Escreva para Kulniski Advocacia:')
  })
  it('recusa: marcar, não escrever', () => {
    assert.equal(chamadaDaAcao({ ...base, tipo: 'desfecho', rascunho: 'x' }), 'Marque que Kulniski Advocacia recusou')
  })
  it('a leitura do copiloto manda no destino', () => {
    const copiloto = (quem: 'recepcao' | 'robo' | 'decisor') => ({ porque: '', quando: '', momento: { quem, leitura: '', passo: '' } })
    assert.equal(chamadaDaAcao({ ...base, rascunho: 'Oi', copiloto: copiloto('recepcao') }), 'Envie para a recepção de Kulniski Advocacia, isto:')
    assert.equal(chamadaDaAcao({ ...base, rascunho: 'Oi', copiloto: copiloto('robo') }), 'Envie para o atendimento automático de Kulniski Advocacia, isto:')
    assert.equal(chamadaDaAcao({ ...base, rascunho: 'Oi', copiloto: copiloto('decisor') }), 'Envie para Kulniski Advocacia, isto:')
  })
})

describe('diagnosticoDeVenda: quem está parado no gargalo', () => {
  const AGORA = Date.parse('2026-10-16T15:00:00Z')
  const lead = (id: string, extra: Partial<CrmLead> = {}, enviado = '2026-10-10T12:00:00Z'): CrmLead => ({
    id, chave: id, empresa: `Empresa ${id}`, produto: 'site', nicho: 'x', cidade: 'y', etapa: 'contato',
    links: {}, marcos: { enviado }, ...extra,
  } as unknown as CrmLead)
  const sim = (id: string, enviado: string, extra: Partial<CrmLead> = {}) =>
    lead(id, { resposta: { tipo: 'interesse' }, marcos: { enviado, respondeu: enviado }, ...extra } as Partial<CrmLead>)

  it('quem disse "quero ver" e não recebeu a 2ª mensagem vem com nome, o mais antigo primeiro', () => {
    const leads = [
      sim('a', '2026-10-12T12:00:00Z'), sim('b', '2026-10-08T12:00:00Z'), sim('c', '2026-10-10T12:00:00Z'),
      // enviados que não responderam: só fazem número
      lead('d'), lead('e'),
    ]
    const g = diagnosticoDeVenda(leads, AGORA).gargalo
    assert.ok(g)
    assert.equal(g.degrau, 'segunda')
    assert.deepEqual(g.parados.map((p) => p.id), ['b', 'c', 'a'])
    assert.equal(g.totalParados, 3)
    assert.equal(g.verEm.href, '/crm?ver=funil')
  })

  it('corta a lista em MAX_PARADOS e conta o total', () => {
    const leads = Array.from({ length: MAX_PARADOS + 3 }, (_, i) => sim(`s${i}`, `2026-10-0${(i % 8) + 1}T12:00:00Z`))
    const g = diagnosticoDeVenda(leads, AGORA).gargalo
    assert.ok(g)
    assert.equal(g.parados.length, MAX_PARADOS)
    assert.equal(g.totalParados, MAX_PARADOS + 3)
  })

  it('"responderam" não tem lista: leva à comparação das mensagens', () => {
    const leads = Array.from({ length: 5 }, (_, i) => lead(`n${i}`))
    const g = diagnosticoDeVenda(leads, AGORA).gargalo
    assert.ok(g)
    assert.equal(g.degrau, 'responderam')
    assert.deepEqual(g.parados, [])
    assert.equal(g.totalParados, 0)
    assert.equal(g.verEm.href, '/crm?ver=numeros')
  })
})
