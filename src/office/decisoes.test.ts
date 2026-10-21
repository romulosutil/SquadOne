import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decisoesDoEscritorio, novaRespostaEnviada, proximaDecisaoPorPrioridade } from './decisoes.ts'
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

test('envio confirmado atende a resposta antiga; uma nova entrada volta à fila por prioridade', () => {
  const a = lead('a', { conversa: resposta }), b = lead('b', { conversa: resposta })
  const envio = { tipo: 'nota', origem: 'manual', em: '2026-10-21T15:05:00Z', texto: '[Envio confirmado pelo operador · 2026-10-21]\nExpliquei como funciona.', rotulo: 'Nota', fonte: 'planilha' } as const
  const atendido = { ...a, eventos: [envio] }
  const acoes = [{ ...acao('a'), tipo: 'responder' as const }, { ...acao('b'), tipo: 'responder' as const }]
  const fila = decisoesDoEscritorio([atendido, b], acoes, agora)
  assert.equal(fila.find(d => d.lead.id === 'a')?.estado, 'acompanhando')
  assert.equal(proximaDecisaoPorPrioridade(fila, 'a')?.lead.id, 'b')
  const novaEntrada = { ...atendido, conversa: { ...resposta!, ultima: { ...resposta!.ultima, em: '2026-10-21T15:10:00Z' } } }
  assert.equal(decisoesDoEscritorio([novaEntrada, b], acoes, agora)[0].lead.id, 'a')
  assert.equal(a.eventos.length, 0)
})

test('saída observada tira resposta antiga mesmo com fila anterior, mas preserva próximo passo vencido', () => {
  const cliente = lead('a', { conversa: { ...resposta!, ultimaEntrada: resposta!.ultima.em, ultima: { direcao: 'saida', em: '2026-10-21T15:05:00Z', trecho: 'Já respondi.' } } })
  const antiga = [{ lead: cliente, rotulo: 'Resposta recebida' }]
  assert.equal(decisoesDoEscritorio([cliente], [{ ...acao('a'), tipo: 'responder' }], agora, antiga)[0].estado, 'acompanhando')
  const comPlano = { ...cliente, proximoPasso: { texto: 'Revisar internamente o material', data: '2026-10-20', registradoEm: '' } }
  assert.equal(decisoesDoEscritorio([comPlano], [], agora)[0].estado, 'agora')
})

test('próxima decisão escolhe a primeira prioridade global, inclusive antes do item atual e fora do filtro', () => {
  const fila = decisoesDoEscritorio([lead('a'), lead('b'), lead('c')], [acao('a'), acao('b')], agora)
  assert.equal(proximaDecisaoPorPrioridade(fila, 'b')?.lead.id, 'a')
  assert.equal(proximaDecisaoPorPrioridade(fila.filter(d => d.lead.id !== 'a'), 'b'), null)
})

test('responder com texto não esconde material solicitado que ainda falta enviar', () => {
  const cliente = lead('material', { resposta: { tipo: 'licenca', trecho: 'Pode enviar o vídeo' }, links: { segunda: 'https://wa.me/5511999990000?text=Material' }, conversa: { ...resposta!, ultimaEntrada: resposta!.ultima.em, ultima: { direcao: 'saida', em: '2026-10-21T15:05:00Z', trecho: 'Já vou buscar o vídeo.' } } })
  assert.equal(decisoesDoEscritorio([cliente], [{ ...acao('material'), tipo: 'responder' }], agora)[0].estado, 'agora')
})

test('planejar retorno futuro move para acompanhamento; resposta posterior recupera prioridade', () => {
  const cliente = lead('plano', { conversa: resposta, proximoPasso: { texto: 'Conferir retorno na sexta', data: '2026-10-23', registradoEm: '2026-10-21T15:05:00Z' } })
  assert.equal(decisoesDoEscritorio([cliente], [{ ...acao('plano'), tipo: 'responder' }], agora)[0].estado, 'acompanhando')
  const novo = { ...cliente, conversa: { ...resposta!, ultima: { ...resposta!.ultima, em: '2026-10-21T15:10:00Z' } } }
  assert.equal(decisoesDoEscritorio([novo], [{ ...acao('plano'), tipo: 'responder' }], agora)[0].estado, 'agora')
})

test('nova saída observada aciona avanço mesmo com outra tarefa ainda ativa no cliente', () => {
  const antes = lead('a', { conversa: resposta })
  const depois = { ...antes, conversa: { ...resposta!, ultimaSaida: '2026-10-21T15:05:00Z', ultima: { direcao: 'saida' as const, em: '2026-10-21T15:05:00Z', trecho: 'Expliquei como funciona.' } } }
  assert.equal(novaRespostaEnviada(antes, depois), true)
  assert.equal(novaRespostaEnviada(depois, { ...depois }), false, 'releitura do mesmo envio não avança outra vez')
  assert.equal(novaRespostaEnviada(antes, { ...depois, id: 'b' }), false, 'abrir outro cliente com envio antigo não avança')
  assert.equal(novaRespostaEnviada(undefined, depois), false)
})

test('retorno posterior, mensagem recebida e saída histórica não são uma nova resposta enviada', () => {
  const antes = lead('a', { conversa: resposta })
  const recebeu = { ...antes, conversa: { ...resposta!, ultima: { ...resposta!.ultima, em: '2026-10-21T15:06:00Z' }, ultimaSaida: '2026-10-21T15:05:00Z' } }
  assert.equal(novaRespostaEnviada(antes, recebeu), false, 'uma nova resposta do cliente mantém a decisão aberta')
  const historico = { ...antes, conversa: { ...resposta!, ultimaSaida: '2026-10-21T14:00:00Z' } }
  assert.equal(novaRespostaEnviada(antes, historico), false)
  assert.equal(novaRespostaEnviada(antes, { ...antes, conversa: { ...resposta!, ultimaSaida: 'inválido' } }), false)
})
