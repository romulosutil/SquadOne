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
  pendenciaDeRespostas,
  pendenciasDaHoje,
  pendenciasDeFinancas,
  proximasQuests,
  resumoDoFunil,
  textoDaPendenciaDeFinancas,
  textoDaPendenciaDeRespostas,
  type ContextoDoTime,
  type EstadoDasFinancasLido,
  type TimeLido,
} from './hoje.ts'
import type { Semaforo } from '../office/salaFinancas.ts'
import type { CrmLead, CrmVisao, DellCheck } from '../operations/types.ts'
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

describe('blueprint', () => {
  it('existe nos dois perfis, acende o Mais e entra pelo Ctrl+K, nunca na barra', () => {
    assert.equal(rotaDaCasca('/design-system', DELL_SEM_AGENDA), 'blueprint')
    assert.equal(destinoAtual('/design-system/', DELL), 'mais')
    assert.ok(comandosDaPaleta(DELL_SEM_AGENDA, [], null).some((c) => c.id === 'ir:design-system'))
    assert.ok(!destinosDaBarra(DELL).some((d) => d.href === '/design-system'))
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

describe('Hoje: leads que responderam e esperam você', () => {
  const lead = (id: string, empresa: string, extra: Partial<CrmLead> = {}) =>
    ({ id, empresa, produto: 'site', marcos: {}, ...extra }) as CrmLead
  const visao = (ids: string[], leads: CrmLead[], estado: CrmVisao['estado'] = 'ok') =>
    ({ estado, leads, hoje: [{ id: 'resposta', titulo: '', explicacao: '', itens: ids.map((leadId) => ({ leadId, acao: '', detalhe: '', links: [], ordem: 0 })) }] }) as unknown as CrmVisao
  const leads = [
    lead('site:a', 'Silva Advogados', { resposta: { tipo: 'neutra', trecho: 'quem é?' }, marcos: { respondeu: '2026-10-08T12:00:00Z' } }),
    lead('site:b', 'Dedetizadora Alfa', { resposta: { tipo: 'interesse', trecho: 'pode mandar' } }),
    lead('prumo:c', 'Distribuidora C', { produto: 'prumo', resposta: { tipo: 'bot', trecho: '' } }),
  ]

  it('do grupo "Respostas para responder" do CRM, destacando quem espera há mais tempo', () => {
    const p = pendenciaDeRespostas(visao(['site:a', 'site:b', 'prumo:c'], leads))!
    assert.deepEqual(p, {
      chave: 'crm:respostas', tipo: 'respostas', quantos: 3, interesse: 1,
      primeiro: { empresa: 'Silva Advogados', produto: 'site', trecho: 'quem é?', respondeuEm: '2026-10-08T12:00:00Z' },
    })
    assert.deepEqual(textoDaPendenciaDeRespostas(p), {
      titulo: '3 leads responderam e esperam você',
      detalhe: 'Silva Advogados: “quem é?” · 1 quer ver',
    })
  })

  it('um só: o nome no título; robô não vira trecho', () => {
    const p = pendenciaDeRespostas(visao(['prumo:c'], leads))!
    assert.deepEqual(textoDaPendenciaDeRespostas(p), { titulo: 'Distribuidora C respondeu e espera você', detalhe: '' })
  })

  // 14/10/2026: o servidor põe o interesse parado na frente; o cartão destaca ele e conta quantos esperam o link.
  it('interesse parado: o primeiro é quem espera o link há mais tempo, e o detalhe diz quantos ainda estão sem ele', () => {
    const parados = [
      lead('site:p', 'Locação Sol', { resposta: { tipo: 'interesse', trecho: 'Manda aí' }, interesseParado: { desde: '2026-10-08T12:00:00Z' }, marcos: { respondeu: '2026-10-08T12:00:00Z' } }),
      lead('site:q', 'Marido de Aluguel', { resposta: { tipo: 'interesse', trecho: 'Pode sim' }, interesseParado: {} }),
      ...leads,
    ]
    const p = pendenciaDeRespostas(visao(['site:p', 'site:q', 'site:a', 'site:b'], parados))!
    assert.equal(p.parados, 2)
    assert.equal(p.primeiro.empresa, 'Locação Sol')
    assert.deepEqual(textoDaPendenciaDeRespostas(p), {
      titulo: '4 leads responderam e esperam você',
      detalhe: 'Locação Sol: “Manda aí” · 3 querem ver · 2 ainda sem o link',
    })
    assert.equal('parados' in pendenciaDeRespostas(visao(['site:a', 'site:b'], leads))!, false, 'sem parado, sem o campo')
  })

  it('sem resposta esperando, sem retrato legível ou sem leitura: nenhum cartão', () => {
    assert.equal(pendenciaDeRespostas(visao([], leads)), null)
    assert.equal(pendenciaDeRespostas(visao(['site:a'], leads, 'sem-retrato')), null)
    assert.equal(pendenciaDeRespostas(null), null)
  })

  it('entra depois dos cartões dos agentes e antes das finanças: resposta esfria em horas', () => {
    const p = pendenciasDaHoje(
      { falhas: [check('balcao', 'falha')], fila: [check('pend:x', 'atencao', 'pendencias')], olhar: [], sozinhos: [] },
      { trocas: [], ajustes: ['a1'], crescimentos: [] },
      { cartao: { pct: 95, semaforo: 'laranja', nome: 'Nubank' }, orcamento: null },
      pendenciaDeRespostas(visao(['site:a'], leads))
    )
    assert.deepEqual(p.map((x) => x.chave), ['dell:balcao', 'ajuste:a1', 'crm:respostas', 'financas:cartao', 'dell:pend:x'])
  })
})

describe('pendenciasDaHoje com finanças em semáforo', () => {
  const alertas = { falhas: [check('balcao', 'falha')], fila: [check('pend:x', 'atencao', 'pendencias')], olhar: [check('cofre', 'atencao', 'dados')], sozinhos: [] }
  const cartoes = { trocas: [], ajustes: ['a1'], crescimentos: [] }
  const cartao = (pct: number, semaforo: Semaforo) => ({ pct, semaforo, nome: 'Nubank' })
  const orcamento = (pct: number, semaforo: Semaforo) => ({ pct, semaforo })

  const casos: Array<{ nome: string; financas: EstadoDasFinancasLido | null; chaves: string[] }> = [
    {
      nome: '≥ 90 % entra depois dos cartões dos agentes e antes da fila',
      financas: { cartao: cartao(92, 'laranja'), orcamento: orcamento(40, 'verde') },
      chaves: ['dell:balcao', 'ajuste:a1', 'financas:cartao', 'dell:pend:x', 'dell:cofre'],
    },
    {
      nome: '70 % (amarelo) fica na aba Finanças',
      financas: { cartao: cartao(75, 'amarelo'), orcamento: orcamento(72, 'amarelo') },
      chaves: ['dell:balcao', 'ajuste:a1', 'dell:pend:x', 'dell:cofre'],
    },
    {
      nome: 'os dois acima de 90 %: o vermelho na frente',
      financas: { cartao: cartao(91, 'laranja'), orcamento: orcamento(104, 'vermelho') },
      chaves: ['dell:balcao', 'ajuste:a1', 'financas:orcamento', 'financas:cartao', 'dell:pend:x', 'dell:cofre'],
    },
    {
      nome: 'sem leitura das finanças (falha ou Easypanel), nenhum cartão inventado',
      financas: null,
      chaves: ['dell:balcao', 'ajuste:a1', 'dell:pend:x', 'dell:cofre'],
    },
    {
      nome: 'cartão sem limite e sem orçamento no mês: nada',
      financas: { cartao: null, orcamento: null },
      chaves: ['dell:balcao', 'ajuste:a1', 'dell:pend:x', 'dell:cofre'],
    },
  ]
  for (const c of casos) {
    it(c.nome, () => {
      assert.deepEqual(pendenciasDaHoje(alertas, cartoes, c.financas).map((x) => x.chave), c.chaves)
    })
  }

  it('falha do Dell sempre primeiro, mesmo com finanças no vermelho; o corte em MAX_NA_HOJE deixa o resto atrás de "ver todas"', () => {
    const p = pendenciasDaHoje(
      { falhas: [check('balcao', 'falha'), check('cofre', 'falha', 'dados')], fila: [], olhar: [], sozinhos: [] },
      { trocas: ['t1'], ajustes: [], crescimentos: [] },
      { cartao: cartao(100, 'vermelho'), orcamento: orcamento(95, 'laranja') }
    )
    assert.deepEqual(p.slice(0, MAX_NA_HOJE).map((x) => x.chave), ['dell:balcao', 'dell:cofre', 'troca:t1'])
    assert.deepEqual(p.slice(MAX_NA_HOJE).map((x) => x.chave), ['financas:cartao', 'financas:orcamento'])
  })

  it('o texto leva % e o nome do banco, nunca R$', () => {
    const [c, o] = pendenciasDeFinancas({ cartao: cartao(92, 'laranja'), orcamento: orcamento(101, 'vermelho'), dadosAte: '2026-10-06' }).sort((a, b) => a.chave.localeCompare(b.chave))
    assert.equal(textoDaPendenciaDeFinancas(c), 'Cartão Nubank: 92% do limite')
    assert.equal(textoDaPendenciaDeFinancas(o), 'Orçamento do mês: 101%')
    assert.equal(c.dadosAte, '2026-10-06')
    assert.equal(textoDaPendenciaDeFinancas({ ...c, nome: undefined }), 'Cartão: 92% do limite')
    assert.ok(![c, o].some((p) => textoDaPendenciaDeFinancas(p).includes('R$')))
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

  const TIME: TimeLido = {
    lidoEm: '2026-10-07T15:00:00.000Z',
    squads: [
      { id: 'pessoal', emBlocoAgora: [], proxima: { titulo: 'Da agenda curta', inicio: '2026-10-07T18:00:00-03:00', pessoaId: 'ana' } },
      { id: 'p4f', emBlocoAgora: [{ pessoaId: 'bia', titulo: 'Deploy' }], proxima: { titulo: 'Revisão', inicio: '2026-10-08T10:00:00-03:00', pessoaId: 'bia' } },
      { id: 'vazia', emBlocoAgora: [], proxima: null },
    ],
    erros: [{ squadId: 'prumo', erro: 'Google Calendar respondeu 500' }],
  }
  const nomeDaPessoa = (id: string) => ({ bia: 'Bia' })[id] ?? id

  const casos: Array<{ nome: string; squad: string; ctx: ContextoDoTime; estado: string; detalhe?: string; emBloco?: string[]; lidoEm?: string | null }> = [
    { nome: 'sem /api/time, outra squad continua sem sinal', squad: 'p4f', ctx: { turnoSquadId: null, mochilaDe: 'pessoal', proxima }, estado: 'sem_sinal', emBloco: [], lidoEm: null },
    {
      nome: 'com /api/time, outra squad ganha bloco em curso e próximo',
      squad: 'p4f',
      ctx: { turnoSquadId: null, mochilaDe: 'pessoal', proxima, time: TIME, nomeDaPessoa },
      estado: 'com_agenda',
      detalhe: 'Próximo na agenda: Revisão',
      emBloco: ['Em bloco agora: Bia — Deploy'],
      lidoEm: TIME.lidoEm,
    },
    { nome: 'lida e sem nada: livre (agenda lida, não sem sinal)', squad: 'vazia', ctx: { turnoSquadId: null, mochilaDe: null, proxima: null, time: TIME }, estado: 'livre', lidoEm: TIME.lidoEm },
    {
      nome: 'a Mochila da ativa manda no próximo (vai mais longe que o /api/time)',
      squad: 'pessoal',
      ctx: { turnoSquadId: null, mochilaDe: 'pessoal', proxima, time: TIME },
      estado: 'com_agenda',
      detalhe: 'Próximo na agenda: Revisar contrato',
    },
    { nome: 'turno nesta aba vence a agenda lida', squad: 'p4f', ctx: { turnoSquadId: 'p4f', mochilaDe: null, proxima: null, time: TIME, nomeDaPessoa }, estado: 'atendendo', emBloco: ['Em bloco agora: Bia — Deploy'] },
    {
      nome: 'calendário da squad falhou: sem sinal com o motivo',
      squad: 'prumo',
      ctx: { turnoSquadId: null, mochilaDe: null, proxima: null, time: TIME },
      estado: 'sem_sinal',
      detalhe: 'Agenda não lida: Google Calendar respondeu 500',
      lidoEm: null,
    },
    {
      nome: 'a leitura inteira falhou: sem sinal com o motivo',
      squad: 'p4f',
      ctx: { turnoSquadId: null, mochilaDe: null, proxima: null, time: null, erroDoTime: 'Google desconectado' },
      estado: 'sem_sinal',
      detalhe: 'Agenda não lida: Google desconectado',
    },
  ]
  for (const c of casos) {
    it(`squad: ${c.nome}`, () => {
      const r = estadoDaSquad(c.squad, c.ctx)
      assert.equal(r.estado, c.estado)
      if (c.detalhe !== undefined) assert.equal(r.detalhe, c.detalhe)
      if (c.emBloco !== undefined) assert.deepEqual(r.emBloco, c.emBloco)
      if (c.lidoEm !== undefined) assert.equal(r.lidoEm, c.lidoEm)
    })
  }

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
  const n = (total: number) => ({ total, site: total, prumo: 0, iris: 0, estampa: 0, plus: 0 })
  it('só as etapas abertas, no singular e no plural', () => {
    assert.equal(
      resumoDoFunil({ novo: n(3), contato: n(1), proposta: n(1), ganho: n(9), perdido: n(40) }),
      '3 novos · 1 em contato · 1 em proposta'
    )
    assert.equal(resumoDoFunil({ novo: n(0), ganho: n(2) }), 'Nenhum lead em aberto')
    assert.equal(resumoDoFunil(null), '')
  })
})
