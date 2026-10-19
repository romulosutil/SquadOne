import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { agruparPendencias, leadsDaSala, pendenciasDaSala, pedidoDaSala } from './comando'
import type { CrmLead } from '../operations/types'
import type { AcaoDeVenda } from '../operations/proxima-venda'

const lead = (id: string, produto: CrmLead['produto'], etapa: CrmLead['etapa']) => ({ id, produto, etapa, sinal: 'na-fila', marcos: {} }) as CrmLead
const leads = [lead('novo', 'prumo', 'novo'), lead('conversa', 'site', 'contato'), lead('clinica', 'iris', 'proposta'), lead('ganho', 'prumo', 'ganho')]

describe('controle por sala', () => {
  it('agrupa o mesmo lead sem descartar motivos nem mudar a ordem de prioridade', () => {
    const fila = [{ leadId: 'a', chave: '1' }, { leadId: 'b', chave: '2' }, { leadId: 'a', chave: '3' }] as AcaoDeVenda[]
    const grupos = agruparPendencias(fila)
    assert.deepEqual(grupos.map(g => g.principal), [fila[0], fila[1]])
    assert.deepEqual(grupos[0].acoes, [fila[0], fila[2]])
    assert.equal(fila.length, 3)
  })
  it('Atendimento reúne conversas de todas as ofertas; Prospecção fica com o estoque', () => {
    assert.deepEqual(leadsDaSala('prumo--geral', leads).map(l => l.id), ['conversa', 'clinica'])
    assert.deepEqual(leadsDaSala('prumo--prospeccao', leads).map(l => l.id), ['novo'])
  })
  it('salas de oferta mantêm seu produto, inclusive encerrados para consulta', () => {
    assert.deepEqual(leadsDaSala('prumo--organizar', leads).map(l => l.id), ['novo', 'ganho'])
    assert.deepEqual(leadsDaSala('inexistente', leads), [])
  })
  it('preserva ordem, travas e instrução de conferir histórico da fila original', () => {
    const fila = [
      { chave: '1', leadId: 'clinica', conferirHistorico: true },
      { chave: '2', leadId: 'novo' },
      { chave: '3', leadId: 'conversa' },
    ] as AcaoDeVenda[]
    const pendentes = pendenciasDaSala('prumo--geral', leads, fila)
    assert.deepEqual(pendentes, [fila[0], fila[2]])
    assert.equal(pendentes[0], fila[0])
    assert.deepEqual(pendenciasDaSala('prumo--geral', [], fila), [])
  })
  it('pedido identifica sala e responsável por IDs estáveis, mantendo a demanda humana', () => {
    assert.equal(pedidoDaSala({ id: 'prumo--geral', nome: 'Atendimento' }, { id: 'ana', nome: 'Ana', papel: 'PO' }, '  Rever proposta  '), 'Sala Atendimento (prumo--geral). Responsável indicado: Ana (ana), PO.\nPedido: Rever proposta')
  })
})
