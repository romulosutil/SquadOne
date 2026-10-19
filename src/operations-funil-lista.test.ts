import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAVE_DA_VISTA_DO_FUNIL, chaveDoNicho, contagemDaEtapa, gravarVistaDoFunil, juntarAbertas, lerFiltroDePasso, lerVistaDoFunil, naEtapa,
  opcoesDeNicho, opcoesDePasso, ordenarLista, sinalMaisForte, textoDaColunaProximo, textoDosDescartados, textoDoProximoPasso, type Guardador,
} from './operations/funil-lista.ts'
import { SIGLA_DO_PRODUTO } from './operations/crm-formato.ts'
import { acaoDoLead } from './operations/proxima-venda.ts'
import type { CrmLead, CrmVisao } from './operations/types.ts'

const lead = (id: string, extra: Partial<CrmLead> = {}): CrmLead => ({
  id, produto: 'site', chave: id, empresa: id, nicho: '', cidade: '', etapa: 'contato', sinal: 'enviado', subEtapa: '',
  estadoNaPlanilha: 'enviado', leitura: 'desconhecida', marcos: {}, followupHoje: false, respostaNova: false, acervo: false,
  notas: 0, eventos: [], links: {}, divergencias: [], ...extra,
})

describe('contagemDaEtapa (AC-03): Quadro e Lista com o mesmo número', () => {
  // O caso de 17/10/2026 em miniatura: 245 perdidos "de verdade" e 1.290 descartados antes do contato.
  const perdidos = [
    ...Array.from({ length: 245 }, (_, i) => lead(`p${i}`, { etapa: 'perdido', motivoPerda: i % 2 ? 'recusou' : 'expirou' })),
    ...Array.from({ length: 1290 }, (_, i) => lead(`d${i}`, { etapa: 'perdido', motivoPerda: 'descartado' })),
  ]
  // O que a Lista mostra: o mesmo filtro de daEtapa em CrmFunil.vue.
  const linhasDaLista = (mostrar: boolean) => (mostrar ? perdidos : perdidos.filter((l) => l.motivoPerda !== 'descartado')).length
  const CASOS: Array<{ mostrar: boolean; mostrados: number; fora: number; texto: string }> = [
    { mostrar: false, mostrados: 245, fora: 1290, texto: '+1.290 descartados antes do contato' },
    { mostrar: true, mostrados: 1535, fora: 0, texto: '' },
  ]
  for (const c of CASOS) {
    it(`mostrar descartados = ${c.mostrar}: ${c.mostrados}, igual às linhas da Lista`, () => {
      const n = contagemDaEtapa(perdidos, 'perdido', c.mostrar)
      assert.deepEqual(n, { mostrados: c.mostrados, foraDescartados: c.fora })
      assert.equal(n.mostrados, linhasDaLista(c.mostrar))
      assert.equal(n.mostrados + n.foraDescartados, perdidos.length, 'o total nunca some: o que sai vira aviso')
      assert.equal(textoDosDescartados(n), c.texto)
    })
  }

  it('só o Perdido tira descartados; um só no singular', () => {
    assert.deepEqual(contagemDaEtapa([lead('a'), lead('b')], 'contato', false), { mostrados: 2, foraDescartados: 0 })
    assert.equal(textoDosDescartados(contagemDaEtapa([lead('d', { etapa: 'perdido', motivoPerda: 'descartado' })], 'perdido', false)),
      '+1 descartado antes do contato')
  })
})

describe('juntarAbertas', () => {
  it('a ação vale entre etapas: a resposta de Em contato vem antes dos prospects do Novo (16/10/2026)', () => {
    const peso = (l: CrmLead) => (l.respostaNova ? 0 : l.followupHoje ? 1 : 6)
    const porEtapa = {
      novo: [lead('n1', { etapa: 'novo', triagem: { prioridade: 100 } }), lead('n2', { etapa: 'novo' })],
      contato: [lead('c1', { followupHoje: true }), lead('c2'), lead('c3', { respostaNova: true })],
      proposta: [lead('p1', { etapa: 'proposta' })],
      ganho: [], perdido: [],
    }
    assert.deepEqual(juntarAbertas(porEtapa, peso).map((l) => l.id), ['c3', 'c1', 'p1', 'c2', 'n1', 'n2'])
  })
})

describe('sinalMaisForte', () => {
  it('Resposta nova > Follow-up hoje > Perdido amanhã > Divergência > o resto', () => {
    const tudo = { respostaNova: true, followupHoje: true, diasParaSair: 1, divergencias: ['x'], resposta: { tipo: 'interesse' as const, trecho: '' } }
    assert.equal(sinalMaisForte(lead('a', tudo))?.texto, 'Resposta nova')
    assert.equal(sinalMaisForte(lead('a', { ...tudo, respostaNova: false }))?.texto, 'Follow-up hoje')
    assert.equal(sinalMaisForte(lead('a', { ...tudo, respostaNova: false, followupHoje: false }))?.texto, 'Perdido amanhã')
    assert.equal(sinalMaisForte(lead('a', { ...tudo, respostaNova: false, followupHoje: false, diasParaSair: 3 }))?.texto, 'Divergência')
    assert.deepEqual(sinalMaisForte(lead('a', { resposta: { tipo: 'interesse', trecho: '' }, diasParaSair: 3 })), { texto: 'Interesse', classe: 'is-interesse' })
  })

  it('Perdido em 3 dias só entra no fim; sem nada, nenhum sinal', () => {
    assert.deepEqual(sinalMaisForte(lead('a', { diasParaSair: 3 })), { texto: 'Perdido em 3 dias', classe: 'is-prazo' })
    assert.equal(sinalMaisForte(lead('a')), null)
  })

  it('o follow-up de hoje, e o reenvio do só-robô com o nome dele', () => {
    assert.equal(sinalMaisForte(lead('a', { followupHoje: true }))?.texto, 'Follow-up hoje')
    assert.equal(sinalMaisForte(lead('a', { followupHoje: true, reenvioDoRobo: true }))?.texto, 'Reenvio hoje (só robô)')
  })

  it('no Novo, WhatsApp não confirmado antes da prioridade do caçador', () => {
    const triagem = { prioridade: 8, origemWhatsapp: 'não confirmado (site)' }
    assert.equal(sinalMaisForte(lead('a', { etapa: 'novo', triagem }))?.texto, 'WhatsApp não confirmado')
    assert.equal(sinalMaisForte(lead('a', { etapa: 'novo', triagem: { prioridade: 8 } }))?.texto, 'Prioridade 8')
  })
})

describe('ordenarLista', () => {
  const a = lead('a', { ultimoEvento: '2026-10-10T12:00:00Z', proximoPasso: { texto: 'ligar', data: '2026-10-20', registradoEm: '' } })
  const b = lead('b', { ultimoEvento: '2026-10-14T12:00:00Z' })
  const c = lead('c', { proximoPasso: { texto: 'proposta', data: '2026-10-17', registradoEm: '' } })
  const ids = (ls: CrmLead[]) => ls.map((l) => l.id).join('')

  it('pela ação mantém a ordem recebida (a do quadro)', () => {
    assert.equal(ids(ordenarLista([c, a, b], 'acao', 'asc')), 'cab')
  })

  it('sem a data vai para o fim nos dois sentidos', () => {
    assert.equal(ids(ordenarLista([c, a, b], 'ultimo', 'desc')), 'bac')
    assert.equal(ids(ordenarLista([c, a, b], 'ultimo', 'asc')), 'abc')
    assert.equal(ids(ordenarLista([b, a, c], 'proximo', 'asc')), 'cab')
    assert.equal(ids(ordenarLista([b, a, c], 'proximo', 'desc')), 'acb')
  })
})

describe('apoio da Lista', () => {
  it('abertas são Novo, Em contato e Proposta', () => {
    assert.deepEqual((['novo', 'contato', 'proposta', 'ganho', 'perdido'] as const).map((e) => naEtapa('abertas', e)), [true, true, true, false, false])
    assert.equal(naEtapa('perdido', 'perdido'), true)
  })

  it('próximo passo em dd/mm com o texto', () => {
    assert.equal(textoDoProximoPasso(lead('a', { proximoPasso: { texto: 'Ligar', data: '2026-10-02', registradoEm: '' } })), '02/10 · Ligar')
    assert.equal(textoDoProximoPasso(lead('a')), '')
  })

  it('o rótulo curto da oferta é um só, sem "Organizar" nem "Estampa" (AC-19)', () => {
    assert.deepEqual(SIGLA_DO_PRODUTO, { site: 'Site', prumo: 'PRUMO', iris: 'Iris', estampa: 'Estamparia', plus: 'Plus' })
  })

  it('a vista guardada só vale se for "lista"; storage que lança vira quadro', () => {
    const dados: Record<string, string> = {}
    const s: Guardador = { getItem: (k) => dados[k] ?? null, setItem: (k, v) => { dados[k] = v } }
    assert.equal(lerVistaDoFunil(s), 'quadro')
    gravarVistaDoFunil(s, 'lista')
    assert.equal(dados[CHAVE_DA_VISTA_DO_FUNIL], 'lista')
    assert.equal(lerVistaDoFunil(s), 'lista')
    const quebrado: Guardador = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    assert.equal(lerVistaDoFunil(quebrado), 'quadro')
    assert.doesNotThrow(() => gravarVistaDoFunil(quebrado, 'lista'))
  })
})

describe('textoDaColunaProximo (AC-19): a coluna "Próximo passo" da Lista', () => {
  const salvo = { proximoPasso: { texto: 'Ligar de manhã', data: '2026-10-20', registradoEm: '' } }
  const CASOS: Array<{ nome: string; acao: { titulo: string } | null; extra: Partial<CrmLead>; texto: string }> = [
    { nome: 'com ação, a frase da ação (mesmo com passo salvo)', acao: { titulo: 'Responda a X' }, extra: salvo, texto: 'Responda a X' },
    { nome: 'sem ação, a data do passo salvo', acao: null, extra: salvo, texto: '20/10' },
    { nome: 'sem ação nem passo salvo, vazio (a tela põe "—")', acao: null, extra: {}, texto: '' },
  ]
  for (const c of CASOS) it(c.nome, () => assert.equal(textoDaColunaProximo(c.acao, lead('a', c.extra)), c.texto))

  it('é a frase da Próxima venda (acaoDoLead), não uma redação da Lista', () => {
    const l = lead('k', { empresa: 'Kulniski Advocacia', resposta: { tipo: 'interesse', trecho: 'pode sim' }, links: { segunda: 'https://n8n.exemplo/segunda' } })
    const visao = {
      estado: 'ok', leads: [l],
      hoje: [{ id: 'resposta', titulo: '', explicacao: '', itens: [{ leadId: 'k', acao: 'Responder', detalhe: '', ordem: 0, links: [] }] }],
    } as unknown as CrmVisao
    const acao = acaoDoLead(visao, 'k', Date.parse('2026-10-17T13:00:00Z'))
    assert.equal(textoDaColunaProximo(acao, l), 'Conferir a conversa de Kulniski Advocacia')
    assert.equal(textoDaColunaProximo(acaoDoLead(visao, 'outro', 0), lead('outro')), '')
  })
})

describe('opcoesDeNicho (AC-19): uma opção por nicho', () => {
  it('a chave ignora caixa, acento e espaço sobrando', () => {
    assert.equal(chaveDoNicho('  Advocacia   Previdenciária '), 'advocacia previdenciaria')
    assert.equal(chaveDoNicho('advocacia previdenciaria'), chaveDoNicho('ADVOCACIA PREVIDENCIÁRIA'))
  })

  it('junta só a mesma palavra com outra grafia; palavras diferentes ficam separadas', () => {
    const opcoes = opcoesDeNicho(['Advocacia previdenciária', 'advocacia previdenciaria', 'Advocacia previdenciária', 'Advogado', 'advocacia', '', '  '])
    assert.deepEqual(opcoes, [
      { chave: 'advocacia', rotulo: 'advocacia', total: 1 },
      { chave: 'advocacia previdenciaria', rotulo: 'Advocacia previdenciária', total: 3 },
      { chave: 'advogado', rotulo: 'Advogado', total: 1 },
    ])
  })

  it('o rótulo é a grafia mais usada; no empate, a com acento', () => {
    assert.equal(opcoesDeNicho(['estetica', 'estetica', 'Estética'])[0].rotulo, 'estetica')
    assert.equal(opcoesDeNicho(['estetica', 'estética'])[0].rotulo, 'estética')
  })
})

describe('filtro Passo (AC-19): a vista "Por passo da jornada" virou filtro do Funil', () => {
  it('o ?passo= só vale para um passo que existe', () => {
    assert.equal(lerFiltroDePasso('segunda'), 'segunda')
    assert.equal(lerFiltroDePasso('inventado'), '')
    assert.equal(lerFiltroDePasso(null), '')
  })

  it('os passos na ordem da jornada, só os que têm alguém, mais o escolhido', () => {
    const leads = [
      lead('a', { etapa: 'novo', sinal: 'pronto' }),
      lead('b', { etapa: 'novo', sinal: 'pronto' }),
      lead('c', { etapa: 'contato', marcos: { segundaEnviada: '2026-10-15' } }),
      lead('d', { etapa: 'perdido' }),
    ]
    assert.deepEqual(opcoesDePasso(leads).map((p) => [p.id, p.total]), [['raio-x', 2], ['segunda', 1], ['perdido', 1]])
    assert.deepEqual(opcoesDePasso(leads, 'proposta').map((p) => [p.id, p.total]), [['raio-x', 2], ['segunda', 1], ['proposta', 0], ['perdido', 1]])
  })
})
