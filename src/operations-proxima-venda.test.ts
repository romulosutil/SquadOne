import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAVE_DAS_RESOLVIDAS, filaDaTela, gravarResolvidas, lerResolvidas, resumoDoDia, textoDosPrimeiros,
  type AcaoDeVenda, type EstadoDaTela,
} from './operations/proxima-venda.ts'
import type { EstadoDoRitmo } from './operations/trava-de-ritmo.ts'
import type { CrmGrupoHojeId, CrmLead, CrmVisao } from './operations/types.ts'

// A contagem da fila do dia (AC-02, 17/10/2026): a aba "A fazer", o "N na fila" e o "Ver a fila
// inteira (N)" diziam 183, 3 e 2 para a mesma fila. Tudo fixture: nenhum retrato real.

const AGORA = Date.parse('2026-10-14T13:00:00Z') // quarta, 10:00 em São Paulo
const LIVRE: Pick<EstadoDoRitmo, 'motivo' | 'enviadosHoje' | 'teto'> = { motivo: null, enviadosHoje: 0, teto: 10 }

const acao = (tipo: AcaoDeVenda['tipo'], primeiroContato = tipo === 'primeiro') => ({ tipo, primeiroContato })

function lead(id: string, extra: Partial<CrmLead> = {}): CrmLead {
  return {
    id, chave: id, empresa: `Empresa ${id}`, produto: 'site', nicho: 'pilates', cidade: 'Vitória', etapa: 'novo',
    links: {}, marcos: {}, ...extra,
  } as unknown as CrmLead
}

function visao(grupos: Partial<Record<CrmGrupoHojeId, string[]>>, leads: CrmLead[], estado: CrmVisao['estado'] = 'ok'): CrmVisao {
  return {
    estado, leads,
    hoje: Object.entries(grupos).map(([id, ids]) => ({
      id, titulo: id, explicacao: '',
      itens: (ids ?? []).map((leadId, ordem) => ({ leadId, acao: 'Fazer', detalhe: '', ordem, links: [] })),
    })),
  } as unknown as CrmVisao
}

const enviar = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`)

describe('resumoDoDia: um número só para a fila', () => {
  const casos: Array<{
    nome: string
    fila: Array<Pick<AcaoDeVenda, 'tipo' | 'primeiroContato'>>
    prontos: number
    ritmo: Pick<EstadoDoRitmo, 'motivo' | 'enviadosHoje' | 'teto'>
    total: number
    porGrupo: Partial<Record<string, number>>
    aindaHoje: number
  }> = [
    { nome: 'fila vazia, nada pronto', fila: [], prontos: 0, ritmo: LIVRE, total: 0, porGrupo: {}, aindaHoje: 0 },
    {
      nome: 'o caso de 16/10: 165 prontos entram como um primeiro contato só',
      fila: [acao('responder'), acao('followup'), acao('primeiro')], prontos: 165, ritmo: LIVRE,
      total: 3, porGrupo: { responder: 1, followup: 1, primeiro: 1 }, aindaHoje: 10,
    },
    {
      nome: 'combinado conta como responder; "o que achou?" como follow-up; as duas propostas juntas',
      fila: [acao('combinado'), acao('depois-do-link'), acao('mandar-proposta'), acao('proposta'), acao('desfecho')],
      prontos: 0, ritmo: LIVRE, total: 5, porGrupo: { responder: 1, followup: 1, proposta: 2, desfecho: 1 }, aindaHoje: 0,
    },
    {
      nome: 'o reenvio do só-robô é follow-up no tipo, mas primeiro contato na conta',
      fila: [acao('followup', true)], prontos: 2, ritmo: LIVRE, total: 1, porGrupo: { primeiro: 1 }, aindaHoje: 2,
    },
    {
      nome: 'teto do dia atingido: nenhum mais hoje',
      fila: [acao('responder')], prontos: 40, ritmo: { motivo: 'dia', enviadosHoje: 10, teto: 10 },
      total: 1, porGrupo: { responder: 1 }, aindaHoje: 0,
    },
    {
      nome: 'intervalo segura agora, mas o dia ainda deixa 7',
      fila: [], prontos: 40, ritmo: { motivo: 'intervalo', enviadosHoje: 3, teto: 10 }, total: 0, porGrupo: {}, aindaHoje: 7,
    },
    {
      nome: 'pausa: zero hoje, mesmo com teto sobrando (melhor prometer de menos)',
      fila: [], prontos: 40, ritmo: { motivo: 'pausa', enviadosHoje: 0, teto: 10 }, total: 0, porGrupo: {}, aindaHoje: 0,
    },
  ]
  for (const c of casos) {
    it(c.nome, () => {
      const r = resumoDoDia(c.fila, visao({ enviar: enviar(c.prontos) }, []), c.ritmo)
      assert.equal(r.total, c.fila.length)
      assert.equal(r.total, c.total)
      assert.deepEqual(r.porGrupo, { responder: 0, proposta: 0, followup: 0, primeiro: 0, desfecho: 0, ...c.porGrupo })
      assert.equal(Object.values(r.porGrupo).reduce((a, b) => a + b, 0), r.total, 'a quebra soma o total')
      assert.equal(r.primeirosProntos, c.prontos)
      assert.equal(r.primeirosAindaHoje, c.aindaHoje)
    })
  }

  it('sem retrato, nada pronto', () => {
    assert.equal(resumoDoDia([], null, LIVRE).primeirosProntos, 0)
  })
})

describe('textoDosPrimeiros', () => {
  const casos: Array<[number, number, string]> = [
    [0, 0, ''],
    [165, 10, '165 primeiros contatos prontos · até 10 hoje'],
    [1, 1, '1 primeiro contato pronto · até 1 hoje'],
    [40, 0, '40 primeiros contatos prontos'],
  ]
  for (const [primeirosProntos, primeirosAindaHoje, esperado] of casos) {
    it(`${primeirosProntos} prontos, ${primeirosAindaHoje} hoje`, () => {
      assert.equal(textoDosPrimeiros({ primeirosProntos, primeirosAindaHoje }), esperado)
    })
  }
})

describe('filaDaTela: a fila que o cartão e a aba contam', () => {
  const quente = lead('r1', { etapa: 'contato', resposta: { tipo: 'interesse', trecho: 'pode sim', em: '2026-10-14T12:00:00Z' } } as Partial<CrmLead>)
  const prontos = enviar(5).map((id) => lead(id))
  const v = visao({ resposta: ['r1'], enviar: enviar(5) }, [quente, ...prontos])
  const tela: EstadoDaTela = { ritmo: { motivo: null }, noExpediente: true, agora: AGORA }

  it('no expediente e com o ritmo livre: a resposta e um primeiro contato só', () => {
    const fila = filaDaTela(v, tela)
    assert.deepEqual(fila.map((a) => a.tipo), ['responder', 'primeiro'])
    const r = resumoDoDia(fila, v, { motivo: null, enviadosHoje: 0, teto: 10 })
    assert.equal(r.total, 2)
    assert.equal(r.primeirosProntos, 5)
    assert.equal(r.primeirosAindaHoje, 5)
  })

  it('fora do expediente ou com o ritmo segurando: nenhum primeiro contato', () => {
    assert.deepEqual(filaDaTela(v, { ...tela, noExpediente: false }).map((a) => a.tipo), ['responder'])
    assert.deepEqual(filaDaTela(v, { ...tela, ritmo: { motivo: 'intervalo' } }).map((a) => a.tipo), ['responder'])
  })

  it('"Enviei" tira da fila; "Pular" manda para o fim', () => {
    const [resp, primeiro] = filaDaTela(v, tela)
    assert.deepEqual(filaDaTela(v, tela, { [resp.chave]: { em: AGORA, pulou: false } }).map((a) => a.tipo), ['primeiro'])
    assert.deepEqual(filaDaTela(v, tela, { [resp.chave]: { em: AGORA, pulou: true } }).map((a) => a.chave), [primeiro.chave, resp.chave])
  })

  it('sem retrato legível, fila vazia', () => {
    assert.deepEqual(filaDaTela(visao({ resposta: ['r1'] }, [quente], 'sem-retrato'), tela), [])
    assert.deepEqual(filaDaTela(null, tela), [])
  })
})

describe('resolvidas do dia no storage', () => {
  function guardador() {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m }
  }

  it('grava e lê no mesmo dia de São Paulo; outro dia volta vazio', () => {
    const g = guardador()
    gravarResolvidas(g, { 'a|responder': { em: AGORA, pulou: false } }, AGORA)
    assert.deepEqual(lerResolvidas(g, AGORA + 3600_000), { 'a|responder': { em: AGORA, pulou: false } })
    assert.deepEqual(lerResolvidas(g, AGORA + 24 * 3600_000), {})
  })

  it('storage ilegível ou ausente não derruba a fila', () => {
    const g = guardador()
    g.m.set(CHAVE_DAS_RESOLVIDAS, '{quebrado')
    assert.deepEqual(lerResolvidas(g, AGORA), {})
    assert.deepEqual(lerResolvidas(null, AGORA), {})
    const quebra = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    assert.deepEqual(lerResolvidas(quebra, AGORA), {})
    gravarResolvidas(quebra, {}, AGORA)
  })
})
