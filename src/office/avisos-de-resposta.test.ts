import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CrmLead } from '../operations/types.ts'
import type { Decisao } from './decisoes.ts'
import { avisosPorPrioridade, lerNovasRespostas } from './avisos-de-resposta.ts'

const inicio = Date.parse('2026-10-21T13:00:00Z')
const lead = (id: string, em: number, campos: Partial<CrmLead> = {}) => ({ id, empresa: `Cliente ${id}`, produto: 'site', eventos: [], etapa: 'contato', marcos: {}, links: {}, conversa: { ultima: { direcao: 'entrada', em: new Date(em).toISOString(), trecho: 'Tenho uma dúvida' } }, ...campos }) as CrmLead
const decisao = (lead: CrmLead, estado: Decisao['estado'] = 'agora'): Decisao => ({ lead, estado, acao: null, motivo: 'Resposta recebida' })

test('primeira leitura não anuncia histórico; somente nova resposta humana gera aviso', () => {
  const antigo = lead('a', inicio - 1000)
  const primeira = lerNovasRespostas([antigo], null, inicio)
  assert.deepEqual(primeira.novas, [])
  const novo = lead('a', inicio + 1000)
  const segunda = lerNovasRespostas([novo], primeira.leitura, inicio + 2000)
  assert.deepEqual(segunda.novas, [{ id: 'a', em: inicio + 1000 }])
  assert.deepEqual(lerNovasRespostas([novo], segunda.leitura, inicio + 3000).novas, [], 'releitura não repete aviso dispensado')
  assert.deepEqual(lerNovasRespostas([antigo], segunda.leitura, inicio + 3000).novas, [], 'snapshot atrasado não retrocede o controle')
  assert.equal(primeira.leitura.vistas.get('a'), inicio - 1000, 'a leitura anterior permanece intacta')
})

test('número novo só avisa por resposta posterior ao início, sem replay ao desaparecer e reaparecer', () => {
  const primeira = lerNovasRespostas([], null, inicio)
  assert.deepEqual(lerNovasRespostas([lead('antigo', inicio - 1000)], primeira.leitura, inicio + 2000).novas, [])
  const nova = lead('novo', inicio + 1000)
  const segunda = lerNovasRespostas([nova], primeira.leitura, inicio + 2000)
  assert.equal(segunda.novas.length, 1)
  const vazia = lerNovasRespostas([], segunda.leitura, inicio + 3000)
  assert.deepEqual(lerNovasRespostas([nova], vazia.leitura, inicio + 4000).novas, [])
})

test('robô, saída e horário futuro não geram aviso; recepção humana gera', () => {
  const primeira = lerNovasRespostas([], null, inicio)
  const bot = lead('robo', inicio + 1000); bot.conversa!.ultima.trecho = '[Bot] Aguarde'
  const saida = lead('saida', inicio + 1000); saida.conversa!.ultima.direcao = 'saida'
  const recepcao = lead('recepcao', inicio + 1000); recepcao.conversa!.ultima.papel = 'recepcao'
  const futuro = lead('futuro', inicio + 5000)
  assert.deepEqual(lerNovasRespostas([bot, saida, recepcao, futuro], primeira.leitura, inicio + 2000).novas.map(a => a.id), ['recepcao'])
})

test('avisos mostram nome e prioridade global atual, deduplicam e saem quando a resposta é atendida', () => {
  const a = lead('a', inicio + 1000), b = lead('b', inicio + 2000), c = lead('c', inicio + 3000)
  const fila = [decisao(c), decisao(a), decisao(b)]
  const avisos = [{ id: 'a', em: inicio + 1000 }, { id: 'b', em: inicio + 2000 }, { id: 'a', em: inicio + 1000 }]
  assert.deepEqual(avisosPorPrioridade(avisos, fila).map(a => [a.empresa, a.posicao, a.total]), [['Cliente a', 2, 3], ['Cliente b', 3, 3]])
  assert.deepEqual(avisosPorPrioridade(avisos, [decisao(b), decisao(a)]).map(a => [a.id, a.posicao]), [['b', 1], ['a', 2]])
  const respondeu = lead('a', inicio + 1000); respondeu.conversa!.ultima.direcao = 'saida'
  assert.deepEqual(avisosPorPrioridade(avisos, [decisao(respondeu), decisao(b, 'acompanhando')]), [])
})
