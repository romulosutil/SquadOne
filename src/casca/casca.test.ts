import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  comandosDaPaleta,
  destinoAtual,
  destinosDaBarra,
  destinosLaterais,
  ehLinkDaCasca,
  filtrarComandos,
  rotaDaCasca,
  type Capacidades,
} from './destinos.ts'
import {
  MAX_NA_HOJE,
  estadoDaPessoa,
  estadoDaSquad,
  pendenciasDaHoje,
  proximasQuests,
  resumoDoFunil,
} from './hoje.ts'
import type { DellCheck } from '../operations/types.ts'
import type { QuestCalendario } from '../types.ts'

const DELL: Capacidades = { perfil: 'operations', agentes: true }
const DELL_SEM_AGENDA: Capacidades = { perfil: 'operations', agentes: false }
const EASYPANEL: Capacidades = { perfil: 'app', agentes: true }

describe('rotaDaCasca', () => {
  it('cada caminho cai na sua rota, com e sem barra final', () => {
    assert.equal(rotaDaCasca('/', DELL), 'hoje')
    assert.equal(rotaDaCasca('/agenda/', DELL), 'agenda')
    assert.equal(rotaDaCasca('/crm', DELL), 'funil')
    assert.equal(rotaDaCasca('/financas', DELL), 'financas')
    assert.equal(rotaDaCasca('/financas/lancamentos', DELL), 'financas')
    assert.equal(rotaDaCasca('/squadone', DELL), 'escritorio')
    assert.equal(rotaDaCasca('/mais', DELL), 'mais')
    assert.equal(rotaDaCasca('/financasx', DELL), 'nao-encontrada')
  })

  it('sem a agenda no processo, Agenda e Escritório não existem', () => {
    assert.equal(rotaDaCasca('/agenda', DELL_SEM_AGENDA), 'nao-encontrada')
    assert.equal(rotaDaCasca('/squadone', DELL_SEM_AGENDA), 'nao-encontrada')
    assert.equal(rotaDaCasca('/crm', DELL_SEM_AGENDA), 'funil')
  })

  it('no Easypanel não há Funil nem Finanças: o perfil app não tem os dados do Dell', () => {
    assert.equal(rotaDaCasca('/crm', EASYPANEL), 'nao-encontrada')
    assert.equal(rotaDaCasca('/financas', EASYPANEL), 'nao-encontrada')
    assert.equal(rotaDaCasca('/agenda', EASYPANEL), 'agenda')
  })
})

describe('destinos', () => {
  it('a barra do Dell é a de design.md, quatro destinos em volta do Pedir', () => {
    assert.deepEqual(destinosDaBarra(DELL).map((d) => d.rotulo), ['Hoje', 'Funil', 'Finanças', 'Mais'])
    assert.deepEqual(destinosDaBarra(EASYPANEL).map((d) => d.rotulo), ['Hoje', 'Agenda', 'Escritório', 'Mais'])
  })

  it('o trilho lateral só lista o que existe no perfil', () => {
    assert.deepEqual(destinosLaterais(DELL).map((d) => d.id), ['hoje', 'agenda', 'funil', 'financas', 'escritorio', 'entrada', 'mais'])
    assert.deepEqual(destinosLaterais(DELL_SEM_AGENDA).map((d) => d.id), ['hoje', 'funil', 'financas', 'entrada', 'mais'])
    assert.deepEqual(destinosLaterais(EASYPANEL).map((d) => d.id), ['hoje', 'agenda', 'escritorio', 'mais'])
  })

  it('aria-current vai para o destino da rota, inclusive em subcaminho', () => {
    assert.equal(destinoAtual('/financas/lancamentos', DELL), 'financas')
    assert.equal(destinoAtual('/nada', DELL), null)
  })
})

describe('ehLinkDaCasca', () => {
  const origem = 'https://dell.tailnet.ts.net:8443'
  it('rota da casca navega sem recarregar; Entrada, API e outro host recarregam', () => {
    assert.equal(ehLinkDaCasca('/crm?ver=funil', origem, DELL), true)
    assert.equal(ehLinkDaCasca(`${origem}/agenda`, origem, DELL), true)
    assert.equal(ehLinkDaCasca('/entrada/', origem, DELL), false)
    assert.equal(ehLinkDaCasca('/api/auth/google', origem, DELL), false)
    assert.equal(ehLinkDaCasca('https://calendar.google.com/x', origem, DELL), false)
    assert.equal(ehLinkDaCasca('/squadone', origem, DELL_SEM_AGENDA), false)
  })
})

describe('paleta', () => {
  it('sem agentes só navega; com agentes oferece pedir e trocar para as outras squads', () => {
    assert.ok(comandosDaPaleta(DELL_SEM_AGENDA, [], null).every((c) => c.acao.tipo === 'ir'))
    const cmds = comandosDaPaleta(DELL, [{ id: 'pessoal', nome: 'Pessoal' }, { id: 'p4f', nome: 'Pay4Fun' }], 'pessoal')
    assert.equal(cmds[0].acao.tipo, 'pedir')
    assert.deepEqual(cmds.filter((c) => c.acao.tipo === 'squad').map((c) => c.rotulo), ['Trocar para a squad Pay4Fun'])
  })

  it('filtra por todas as palavras, sem acento nem caixa', () => {
    const cmds = comandosDaPaleta(DELL, [], null)
    assert.deepEqual(filtrarComandos(cmds, 'FINANCAS').map((c) => c.id), ['ir:financas'])
    assert.deepEqual(filtrarComandos(cmds, 'ir escri').map((c) => c.id), ['ir:escritorio'])
    assert.equal(filtrarComandos(cmds, '  ').length, cmds.length)
    assert.equal(filtrarComandos(cmds, 'xyz').length, 0)
  })
})

const check = (id: string, estado: DellCheck['estado'], grupo: DellCheck['grupo'] = 'fluxos'): DellCheck => ({ id, grupo, nome: id, estado, detalhe: '' })

describe('pendenciasDaHoje', () => {
  it('falha do Dell primeiro, depois os cartões dos agentes, depois fila e vale olhar', () => {
    const p = pendenciasDaHoje(
      { falhas: [check('balcao', 'falha')], fila: [check('pend:x', 'atencao', 'pendencias')], olhar: [check('cofre', 'atencao', 'dados')], sozinhos: [check('cacador', 'atencao')] },
      { trocas: ['t1'], ajustes: ['a1'], crescimentos: ['c1', 'c2'] }
    )
    assert.deepEqual(p.map((x) => x.chave), ['dell:balcao', 'troca:t1', 'ajuste:a1', 'crescimento:c1', 'crescimento:c2', 'dell:pend:x', 'dell:cofre'])
    // O que resolve sozinho nunca entra: fica fechado no fim da Hoje.
    assert.ok(!p.some((x) => x.chave === 'dell:cacador'))
    assert.equal(MAX_NA_HOJE, 3)
  })

  it('sem leitura do Dell (Easypanel), só os cartões', () => {
    assert.deepEqual(pendenciasDaHoje(null, { trocas: [], ajustes: ['a'], crescimentos: [] }).map((x) => x.tipo), ['ajuste'])
  })
})

const quest = (eventId: string, inicio: string, fim: string, extra: Partial<QuestCalendario> = {}): QuestCalendario => ({
  eventId, titulo: eventId, inicio, fim, diaInteiro: false, tipo: 'time_blocking', dominio: 'd', membro: 'm', squad: 's', prazoRef: '', ...extra,
})
const AGORA = Date.parse('2026-10-07T12:00:00-03:00')

describe('proximasQuests', () => {
  it('tira o que terminou, ordena pelo início (marco pelo prazo) e corta', () => {
    const lista = [
      quest('terminou', '2026-10-07T09:00:00-03:00', '2026-10-07T10:00:00-03:00'),
      quest('depois', '2026-10-08T09:00:00-03:00', '2026-10-08T10:00:00-03:00'),
      quest('agora', '2026-10-07T11:30:00-03:00', '2026-10-07T12:30:00-03:00'),
      quest('marco', '2026-10-07T17:45:00-03:00', '2026-10-07T18:00:00-03:00', { tipo: 'deadline' }),
    ]
    assert.deepEqual(proximasQuests(lista, AGORA, 3).map((q) => q.eventId), ['agora', 'marco', 'depois'])
    assert.deepEqual(proximasQuests(lista, AGORA, 0), [])
  })
})

describe('estado do time, só com fonte', () => {
  const proxima = quest('Revisar contrato', '2026-10-07T15:00:00-03:00', '2026-10-07T16:00:00-03:00')
  it('turno em andamento, agenda lida ou sem sinal', () => {
    assert.equal(estadoDaSquad('pessoal', { turnoSquadId: 'pessoal', mochilaDe: 'pessoal', proxima }).estado, 'atendendo')
    assert.equal(estadoDaSquad('pessoal', { turnoSquadId: null, mochilaDe: 'pessoal', proxima }).detalhe, 'Próximo na agenda: Revisar contrato')
    assert.equal(estadoDaSquad('pessoal', { turnoSquadId: null, mochilaDe: 'pessoal', proxima: null }).estado, 'livre')
    // A agenda lida é de outra squad: não serve de fonte para esta.
    assert.equal(estadoDaSquad('p4f', { turnoSquadId: 'pessoal', mochilaDe: 'pessoal', proxima }).estado, 'sem_sinal')
  })

  it('pessoa: bloco em curso, último pedido, próximo ou sem sinal', () => {
    const quests = [
      quest('Bloco', '2026-10-07T11:00:00-03:00', '2026-10-07T13:00:00-03:00', { membro: 'ana' }),
      quest('Prazo', '2026-10-09T17:45:00-03:00', '2026-10-09T18:00:00-03:00', { membro: 'bia', tipo: 'deadline' }),
    ]
    const ctx = { quests, responsavelId: 'caio', agora: AGORA }
    assert.deepEqual(estadoDaPessoa('ana', ctx), { estado: 'em_bloco', texto: 'Em bloco agora: Bloco' })
    assert.deepEqual(estadoDaPessoa('bia', ctx), { estado: 'proximo', texto: 'Próximo: Prazo' })
    assert.equal(estadoDaPessoa('caio', ctx).estado, 'responsavel')
    assert.deepEqual(estadoDaPessoa('davi', ctx), { estado: 'sem_sinal', texto: 'Sem sinal' })
    // Sem Mochila lida, ninguém tem agenda: sobra o último pedido.
    assert.equal(estadoDaPessoa('ana', { quests: [], responsavelId: 'Idle', agora: AGORA }).estado, 'sem_sinal')
  })
})

describe('resumoDoFunil', () => {
  const n = (total: number) => ({ total, site: total, prumo: 0 })
  it('só as etapas abertas, no singular e no plural', () => {
    assert.equal(
      resumoDoFunil({ novo: n(3), contatado: n(1), conversando: n(2), proposta: n(1), ganho: n(9), perdido: n(40) }),
      '3 novos · 1 contatado · 2 conversando · 1 em proposta'
    )
    assert.equal(resumoDoFunil({ novo: n(0), ganho: n(2) }), 'Nenhum lead em aberto')
    assert.equal(resumoDoFunil(null), '')
  })
})
