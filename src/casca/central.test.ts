/**
 * Central de comando (17/10/2026): as faixas, a ordem, o "Sem sinal" de cada uma, o andar do mapa e
 * o que o endereço pede. Regras puras, em tabela.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ORDEM_DAS_FAIXAS, andarDaCentral, faixasDaCentral, gravarAndar, lerAndar, pedidoDaCentral, statusDoMapa,
  type FontesDasFaixas,
} from './central.ts'
import { resumoDoDell } from '../operations/alertas.ts'
import type { DellCheck } from '../operations/types.ts'

const AGORA = Date.parse('2026-10-17T13:00:00Z')
const check = (id: string, estado: DellCheck['estado'], extra: Partial<DellCheck> = {}): DellCheck => ({ id, grupo: 'fluxos', nome: id, estado, detalhe: '', ...extra })
const dell = (verificacoes: DellCheck[], geradoEm = '2026-10-17T12:59:00Z') => resumoDoDell({ geradoEm, verificacoes }, AGORA, 'America/Sao_Paulo')

const NADA: FontesDasFaixas = { vendas: null, agenda: null, financas: null, entrada: null, dell: null }
const porId = (f: FontesDasFaixas, agentes = true) => Object.fromEntries(faixasDaCentral(f, agentes).map((x) => [x.id, x]))

describe('faixasDaCentral: seleção e ordem', () => {
  it('as cinco frentes, sempre na mesma ordem', () => {
    assert.deepEqual(faixasDaCentral(NADA, true).map((f) => f.id), [...ORDEM_DAS_FAIXAS])
    assert.deepEqual([...ORDEM_DAS_FAIXAS], ['vendas', 'agenda', 'financas', 'entrada', 'dell'])
  })

  it('lendo: nenhuma faixa afirma estado (nem zero, nem tudo certo)', () => {
    for (const f of faixasDaCentral(NADA, true)) {
      if (f.id === 'entrada') continue
      assert.equal(f.tom, 'sem_sinal', f.id)
      assert.doesNotMatch(f.linha, /\b0\b|tudo certo/i, f.id)
    }
  })

  it('falha de leitura vira "Sem sinal" com o motivo', () => {
    const f = porId({ vendas: { erro: 'HTTP 500' }, agenda: { erro: 'Google desconectado' }, financas: { erro: 'sem banco' }, entrada: { erro: 'HTTP 502' }, dell: { erro: 'HTTP 503' } })
    assert.deepEqual([f.vendas.linha, f.vendas.detalhe, f.vendas.tom], ['Sem sinal de Vendas', 'HTTP 500', 'sem_sinal'])
    assert.equal(f.agenda.linha, 'Sem sinal da agenda')
    assert.equal(f.financas.linha, 'Sem sinal das finanças')
    assert.match(f.entrada.detalhe, /^Sem sinal da Entrada/)
    assert.deepEqual([f.dell.linha, f.dell.tom], ['Dell sem resposta', 'falha'])
  })

  it('destinos: Vendas e Dell seguem link; Finanças e Agenda abrem a folha; a Entrada navega de verdade', () => {
    const f = porId(NADA)
    assert.deepEqual([f.vendas.folha, f.vendas.href], [null, '/crm'])
    assert.deepEqual([f.financas.folha, f.financas.href], ['financas', '/financas'])
    assert.deepEqual([f.agenda.folha, f.agenda.href], ['agenda', '/agenda'])
    assert.deepEqual([f.entrada.href, f.entrada.externo, f.entrada.rotuloDoLink], ['/entrada/', true, 'Enviar para a Mel'])
    assert.equal(f.dell.href, '/mais?abrir=manutencao')
    // Sem a agenda dos agentes neste processo: o dia do Google, sem folha.
    const sem = porId(NADA, false)
    assert.equal(sem.agenda.folha, null)
    assert.equal(sem.agenda.externo, true)
  })
})

describe('faixa de Vendas', () => {
  it('o passo e a oferta numa linha; a contagem e o gargalo na outra', () => {
    const f = porId({ ...NADA, vendas: { fila: [{ titulo: 'Responda a Baobá', produto: 'iris', quente: true }], resumo: '2 respostas · 1 follow-up', gargalo: 'Ninguém chega na proposta' } })
    assert.equal(f.vendas.linha, 'Agora: Responda a Baobá · Iris')
    assert.equal(f.vendas.detalhe, '2 respostas · 1 follow-up · Gargalo: Ninguém chega na proposta')
    assert.equal(f.vendas.tom, 'atencao')
  })
  it('fila vazia: diz que ninguém espera, sem inventar gargalo', () => {
    const f = porId({ ...NADA, vendas: { fila: [], resumo: '', gargalo: null } })
    assert.deepEqual([f.vendas.linha, f.vendas.detalhe, f.vendas.tom], ['Nenhuma conversa esperando você', '', 'ok'])
  })
})

describe('faixa de Finanças', () => {
  it('tenho, devo e gastei numa linha; o pior semáforo com as % na outra', () => {
    const f = porId({ ...NADA, financas: {
      estado: { cartao: { pct: 92, semaforo: 'laranja', nome: 'Nubank' }, orcamento: { pct: 40, semaforo: 'verde' } },
      valores: { tenho: 123456, devo: 50000, gastei: 7890 },
    } })
    assert.match(f.financas.linha, /^Tenho R\$\s?1\.234,56 · Devo R\$\s?500,00 · Gastei R\$\s?78,90$/)
    assert.equal(f.financas.detalhe, 'Passou de 90% (cartão 92% · orçamento 40%)')
    assert.equal(f.financas.tom, 'atencao')
  })
  it('sem os valores, só o semáforo; sem nada medido, neutro', () => {
    const so = porId({ ...NADA, financas: { estado: { cartao: null, orcamento: { pct: 101, semaforo: 'vermelho' } }, valores: null } })
    assert.deepEqual([so.financas.linha, so.financas.tom], ['Chegou a 100% (orçamento 101%)', 'falha'])
    const nada = porId({ ...NADA, financas: { estado: { cartao: null, orcamento: null }, valores: null } })
    assert.equal(nada.financas.tom, 'neutro')
  })
})

describe('faixa da Agenda e da Entrada', () => {
  it('agenda: os próximos e quantos mais; vazia diz que não há nada marcado', () => {
    const itens = [{ quando: '15:00', titulo: 'Revisão' }, { quando: 'amanhã 09:00', titulo: 'Dentista' }]
    const f = porId({ ...NADA, agenda: { itens, restantes: 4, fonte: 'Squad Pessoal, do Google Calendar' } })
    assert.equal(f.agenda.linha, '2 próximos compromissos')
    assert.equal(f.agenda.detalhe, 'Squad Pessoal, do Google Calendar · mais 4')
    assert.deepEqual(f.agenda.itens, itens)
    assert.equal(porId({ ...NADA, agenda: { itens: [], restantes: 0, fonte: '' } }).agenda.linha, 'Nada marcado pela frente')
  })
  it('entrada: o selo do que espera organizar e dos avisos', () => {
    assert.equal(porId({ ...NADA, entrada: { pendentes: 2, avisos: 1 } }).entrada.detalhe, '2 envios para organizar · 1 aviso')
    assert.equal(porId({ ...NADA, entrada: { pendentes: 0, avisos: 0 } }).entrada.tom, 'ok')
  })
})

describe('faixa do Dell', () => {
  it('a saúde, sem repetir o "precisa de você" do cabeçalho', () => {
    const f = porId({ ...NADA, dell: dell([check('a', 'ok'), check('b', 'falha'), check('c', 'atencao', { sozinho: true })]) })
    assert.equal(f.dell.linha, '1 de 3 ok')
    assert.doesNotMatch(`${f.dell.linha} ${f.dell.detalhe}`, /precisa/)
    assert.match(f.dell.detalhe, /1 resolve sozinha/)
    assert.equal(f.dell.tom, 'falha')
  })
  it('retrato parado: diz desde quando, e a contagem é do último retrato', () => {
    const f = porId({ ...NADA, dell: dell([check('a', 'ok')], '2026-10-17T11:00:00Z') })
    assert.match(f.dell.linha, /^Sem notícia do Dell/)
    assert.equal(f.dell.detalhe, 'No último retrato, 1 de 1 ok')
    assert.equal(f.dell.tom, 'sem_sinal')
  })
})

describe('andarDaCentral', () => {
  const squads = [
    { id: 'pessoal', dominios: [{ id: 'geral' }, { id: 'pessoal--financeiro' }] },
    { id: 'prumo', dominios: [{ id: 'prumo--geral' }] },
  ]
  const comOperacao = (ids: string[]) => ids.some((id) => id.startsWith('prumo--'))
  it('o guardado vence; senão o primeiro com operação; senão o primeiro', () => {
    assert.equal(andarDaCentral(squads, 'pessoal', comOperacao), 'pessoal')
    assert.equal(andarDaCentral(squads, null, comOperacao), 'prumo')
    assert.equal(andarDaCentral(squads, 'arquivada', comOperacao), 'prumo')
    assert.equal(andarDaCentral(squads, null, () => false), 'pessoal')
    assert.equal(andarDaCentral([], null, comOperacao), null)
  })
  it('storage que lança não derruba a tela', () => {
    const quebrado = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    assert.equal(lerAndar(quebrado), null)
    assert.doesNotThrow(() => gravarAndar(quebrado, 'prumo'))
  })
})

describe('pedidoDaCentral e statusDoMapa', () => {
  it('?abrir= só aceita as faixas que abrem algo', () => {
    assert.equal(pedidoDaCentral('?abrir=financas'), 'financas')
    assert.equal(pedidoDaCentral('?abrir=agenda'), 'agenda')
    assert.equal(pedidoDaCentral('?abrir=escritorio'), 'escritorio')
    assert.equal(pedidoDaCentral('?abrir=manutencao'), null)
    assert.equal(pedidoDaCentral(''), null)
  })
  it('o status do mapa diz a fonte, e sem retrato não afirma nada', () => {
    assert.equal(statusDoMapa(0, '10:42', false), 'Nenhuma sala pede você (Dell às 10:42)')
    assert.equal(statusDoMapa(2, '10:42', false), '2 salas pedem você (Dell às 10:42)')
    assert.equal(statusDoMapa(0, '', true), 'Sem notícia do Dell: os robôs estão sem sinal')
  })
})
