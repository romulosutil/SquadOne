import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { duracao, mediana, velocidadeDaVenda } from './operations/velocidade.ts'
import type { CrmLead } from './operations/types.ts'

// OT-09 (16/10/2026): o tempo depois do "sim", só com o que o retrato já tem.
const AGORA = Date.parse('2026-10-16T19:00:00Z')
const h = (n: number) => new Date(AGORA - n * 3600_000).toISOString()

type L = Pick<CrmLead, 'id' | 'empresa' | 'resposta' | 'marcos' | 'conversa' | 'proposta' | 'etapa'>
const lead = (id: string, extra: Partial<L>): L => ({ id, empresa: id, etapa: 'contato', marcos: {}, ...extra })
const interesse = (em: string) => ({ tipo: 'interesse' as const, trecho: 'quero ver', em })

describe('velocidade depois do "sim"', () => {
  it('do "quero ver" ao link: a 2ª anotada ou o link visto na conversa, o que vier primeiro', () => {
    const v = velocidadeDaVenda([
      lead('anotado', { resposta: interesse(h(10)), marcos: { segundaEnviada: h(9) } }),
      lead('pela-conversa', { resposta: interesse(h(30)), conversa: { desde: h(40), mensagens: 3, ultima: { direcao: 'saida', em: h(26), trecho: '' }, linkEm: h(26) } }),
      lead('parado', { resposta: interesse(h(48)) }),
    ], AGORA)
    const m = v.queroVerAoLink
    assert.deepEqual(m.feitos.map((f) => [f.leadId, f.horas]), [['anotado', 1], ['pela-conversa', 4]])
    assert.equal(m.medianaHoras, 2.5)
    assert.equal(m.rapidos, 1, 'só o de 1 h ficou dentro das 2 h')
    assert.deepEqual(m.esperando.map((e) => [e.leadId, e.horas]), [['parado', 48]])
  })

  it('link antes do interesse não conta como resposta ao interesse', () => {
    const v = velocidadeDaVenda([lead('a', { resposta: interesse(h(5)), marcos: { segundaEnviada: h(20) } })], AGORA)
    assert.equal(v.queroVerAoLink.feitos.length, 0)
    assert.equal(v.queroVerAoLink.esperando.length, 1)
  })

  it('do link à proposta, e quem viu o link e espera a proposta', () => {
    const v = velocidadeDaVenda([
      lead('com', { marcos: { segundaEnviada: h(50) }, proposta: { em: h(2), data: '2026-10-16' } }),
      lead('sem', { marcos: { segundaEnviada: h(30) } }),
    ], AGORA)
    assert.deepEqual(v.linkAProposta.feitos.map((f) => [f.leadId, f.horas]), [['com', 48]])
    assert.deepEqual(v.linkAProposta.esperando.map((e) => e.leadId), ['sem'])
  })

  it('perdido não espera mais; fora dos 30 dias não entra', () => {
    const v = velocidadeDaVenda([
      lead('perdido', { etapa: 'perdido', resposta: interesse(h(30)) }),
      lead('antigo', { resposta: interesse(h(24 * 40)), marcos: { segundaEnviada: h(24 * 39) } }),
    ], AGORA)
    assert.equal(v.queroVerAoLink.esperando.length, 0)
    assert.equal(v.queroVerAoLink.feitos.length, 0)
  })

  it('mediana e duração legível', () => {
    assert.equal(mediana([]), null)
    assert.equal(mediana([5, 1, 3]), 3)
    assert.equal(duracao(0.5), '30 min')
    assert.equal(duracao(3.2), '3 h')
    assert.equal(duracao(28), '1 dia e 4 h')
    assert.equal(duracao(48), '2 dias')
  })
})
