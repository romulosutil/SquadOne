import './testes/politica-historica.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filaDaTela, type EstadoDaTela } from './operations/proxima-venda.ts'
import type { CrmGrupoHojeId, CrmLead, CrmVisao } from './operations/types.ts'

// A fila das conversas na tela (filaDaTela): sem primeiro contato, com o "Enviei" e o "Pular" do dia.
// Tudo fixture: nenhum retrato real.

const AGORA = Date.parse('2026-10-14T13:00:00Z') // quarta, 10:00 em São Paulo

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

describe('filaDaTela: a fila das conversas', () => {
  const quente = lead('r1', { etapa: 'contato', resposta: { tipo: 'interesse', trecho: 'pode sim', em: '2026-10-14T12:00:00Z' } } as Partial<CrmLead>)
  const prontos = enviar(5).map((id) => lead(id))
  const v = visao({ resposta: ['r1'], enviar: enviar(5) }, [quente, ...prontos])
  const tela: EstadoDaTela = { agora: AGORA }

  it('só a conversa: o primeiro contato nunca entra (é do time e do Telegram), com o horário e o ritmo que for', () => {
    assert.deepEqual(filaDaTela(v, tela).map((a) => a.tipo), ['responder'])
  })

  it('"Enviei" tira da fila; "Pular" manda para o fim', () => {
    const [resp] = filaDaTela(v, tela)
    assert.deepEqual(filaDaTela(v, tela, { [resp.chave]: { em: AGORA, pulou: false } }), [])
    assert.deepEqual(filaDaTela(v, tela, { [resp.chave]: { em: AGORA, pulou: true } }).map((a) => a.chave), [resp.chave])
  })

  it('sem retrato legível, fila vazia', () => {
    assert.deepEqual(filaDaTela(visao({ resposta: ['r1'] }, [quente], 'sem-retrato'), tela), [])
    assert.deepEqual(filaDaTela(null, tela), [])
  })
})
