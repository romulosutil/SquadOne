import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decisoesDoEscritorio } from './decisoes.ts'
import { notaDoAprendizado } from '../operations/aprendizado-comercial.ts'
import type { CrmLead } from '../operations/types.ts'
import type { AcaoDeVenda } from '../operations/proxima-venda.ts'

const agora = Date.parse('2026-10-21T15:00:00-03:00')
const lead = (id: string, campos: Partial<CrmLead> = {}): CrmLead => ({ id, empresa: id, produto: 'site', etapa: 'contato', marcos: {}, links: {}, eventos: [], ...campos }) as CrmLead
const acao = (leadId: string, chave = leadId): AcaoDeVenda => ({ leadId, chave, titulo: 'Responder cliente', primeiroContato: false }) as AcaoDeVenda
const resposta = { ultima: { direcao: 'entrada', em: '2026-10-21T15:00:00Z', trecho: 'Podemos conversar?' } } as CrmLead['conversa']

test('uma linha por cliente preserva ordem e ação de Vendas, mesmo com dois motivos', () => {
  const a = lead('a', { conversa: resposta }), b = lead('b'), c = lead('c', { conversa: resposta })
  const primeira = acao('b')
  const fila = decisoesDoEscritorio([a, b, c], [primeira, acao('a'), acao('b', 'outra')], agora)
  assert.deepEqual(fila.map(d => d.lead.id), ['b', 'a', 'c'])
  assert.equal(fila[0].acao, primeira)
  assert.equal(fila[1].motivo, 'Resposta recebida')
  assert.equal(fila[2].acao, null)
})

test('futuro, espera e encerrados têm destinos distintos; estoque novo fica fora das decisões', () => {
  const entradas = [lead('estoque', { etapa: 'novo' }), lead('ganho', { etapa: 'ganho' }), lead('perdido', { etapa: 'perdido' }), lead('futuro', { proximoPasso: { texto: 'Conversar com Ana', data: '2026-10-25', registradoEm: '' } }), lead('espera'), lead('hoje', { proximoPasso: { texto: 'Entregar material', data: '2026-10-21', registradoEm: '' } })]
  const fila = decisoesDoEscritorio(entradas, [], agora)
  assert.deepEqual(fila.map(d => [d.lead.id, d.estado]), [['hoje', 'agora'], ['espera', 'acompanhando'], ['futuro', 'acompanhando'], ['ganho', 'encerrada'], ['perdido', 'encerrada']])
  assert.equal(entradas[3].proximoPasso?.data, '2026-10-25')
})

test('recusa, exclusão e pausa não oferecem retomada mesmo com ação antiga', () => {
  const pausa = notaDoAprendizado({ fato: 'Pediu prazo', hipotese: 'Ainda está avaliando', teste: 'Esperar retorno', resultado: 'em-teste', pausarAteResposta: true })
  const entradas = [lead('recusa', { resposta: { tipo: 'negativa', trecho: 'Não quero' } }), lead('exclusao', { resposta: { tipo: 'exclusao', trecho: 'Remova meu número' } }), lead('pausa', { eventos: [{ tipo: 'nota', origem: 'manual', em: '2026-10-20T10:00:00Z', texto: pausa, rotulo: 'Nota', fonte: 'planilha' }] })]
  const fila = decisoesDoEscritorio(entradas, entradas.map(l => acao(l.id)), agora)
  assert.ok(fila.every(d => d.estado === 'acompanhando' && d.acao === null))
})

test('primeiro contato e ações de cliente inexistente não criam decisões; releitura move só o cliente atualizado', () => {
  const antes = [lead('a'), lead('b')]
  const acoes = [acao('a'), acao('b')]
  assert.equal(decisoesDoEscritorio([lead('novo', { etapa: 'novo' })], [{ ...acao('novo'), primeiroContato: true }, acao('inexistente')], agora).length, 0)
  const depois = decisoesDoEscritorio([{ ...antes[0], etapa: 'ganho' }, antes[1]], acoes, agora)
  assert.deepEqual(depois.map(d => [d.lead.id, d.estado]), [['b', 'agora'], ['a', 'encerrada']])
})
