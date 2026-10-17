/**
 * Balões do mapa na Central de comando (17/10/2026): texto por fonte, "Sem sinal" sem ela, e a
 * sala que o PO raiz visita só por problema real do status.json.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LIMITE_DO_BALAO, SEM_SINAL, balaoDaOperacao, balaoDeFinancas, baloesDaAgenda, baloesDasSalas, baloesDosAtores, cortar,
  destinoDoSupervisor, quandoCurto, type BalaoDaSala,
} from './baloes.ts'
import type { OperacaoDaSala, RecorteLido, RoboNaSala, TomDoRobo } from './operacao.ts'

const robo = (nome: string, tom: TomDoRobo): RoboNaSala => ({ id: nome, nome, quando: '', faz: '', onde: '', href: '', tom, texto: '' })
const recorte = (total: number, comVoce = 0, parados = 0): RecorteLido =>
  ({ produto: null, rotulo: 'Todas', href: '', total, etapas: [], passos: [], comVoce, parados })
const op = (robos: RoboNaSala[], jornada: OperacaoDaSala['jornada'] = null): OperacaoDaSala => ({ robos, jornada })
const ok = (recortes: RecorteLido[], velho = false): OperacaoDaSala['jornada'] => ({ titulo: 't', estado: 'ok', recortes, velho, idadeMin: 3 })

describe('balaoDaOperacao: do mais grave ao menos, só com fonte', () => {
  const casos: Array<[string, OperacaoDaSala, BalaoDaSala | null]> = [
    ['robô que falhou vence tudo e pede destaque', op([robo('Balcão', 'falha'), robo('Caçador', 'atencao')], ok([recorte(9, 2)])), { texto: 'Falhou: Balcão', tom: 'vermelho', destaque: true }],
    ['robô que pede olhar', op([robo('Caçador', 'atencao')], ok([recorte(9)])), { texto: 'Vale olhar: Caçador', tom: 'amarelo', destaque: true }],
    ['leads com você', op([robo('Balcão', 'ok')], ok([recorte(9, 2), recorte(3, 1)])), { texto: '3 com você · 12 leads', tom: 'amarelo' }],
    ['parados, sem ninguém com você', op([], ok([recorte(1, 0, 1)])), { texto: '1 parado · 1 lead', tom: 'amarelo' }],
    ['só a contagem', op([], ok([recorte(4)])), { texto: '4 leads', tom: 'neutro' }],
    ['retrato velho diz que é velho', op([], ok([recorte(4)], true)), { texto: '4 leads · velho', tom: 'neutro' }],
    ['Vendas não lido: sem sinal, nunca zero', op([robo('Balcão', 'ok')], { titulo: 't', estado: 'sem-sinal', motivo: 'HTTP 500' }), { texto: `${SEM_SINAL} de Vendas`, tom: 'sem_sinal' }],
    ['só robôs em dia', op([robo('A', 'ok'), robo('B', 'ok')]), { texto: '2 robôs em dia', tom: 'verde' }],
    ['um robô em dia', op([robo('A', 'ok')]), { texto: 'Robô em dia', tom: 'verde' }],
    ['robô sem retrato: sem sinal', op([robo('A', 'ok'), robo('B', 'sem_sinal')]), { texto: SEM_SINAL, tom: 'sem_sinal' }],
    ['resolve sozinho não pede o Rômulo', op([robo('Cofre', 'sozinho')]), { texto: 'Resolve sozinho: Cofre', tom: 'neutro' }],
    ['sala sem robô e sem jornada não fala', op([]), null],
  ]
  for (const [nome, entrada, esperado] of casos) it(nome, () => assert.deepEqual(balaoDaOperacao(entrada), esperado))
})

describe('balaoDeFinancas: % e semáforo, nunca R$', () => {
  it('não lida: sem sinal', () => assert.deepEqual(balaoDeFinancas(null), { texto: SEM_SINAL, tom: 'sem_sinal' }))
  it('lida sem cartão nem orçamento: neutro, não "tudo bem"', () => assert.deepEqual(balaoDeFinancas({ estado: { cartao: null, orcamento: null } }), { texto: 'Sem orçamento no mês', tom: 'neutro' }))
  it('o pior semáforo pinta o balão', () => {
    const b = balaoDeFinancas({ estado: { cartao: { pct: 92, semaforo: 'laranja', nome: 'Nubank' }, orcamento: { pct: 40, semaforo: 'verde' } } })
    assert.deepEqual(b, { texto: 'cartão 92% · orçamento 40%', tom: 'laranja' })
    assert.ok(!b.texto.includes('R$'))
  })
})

describe('baloesDasSalas', () => {
  const salas = [{ id: 'pessoal--financeiro', nome: 'Finanças' }, { id: 'prumo--geral', nome: 'Atendimento' }, { id: 'geral', nome: 'Geral' }]
  it('Finanças pela leitura dela, PRUMO pela operação, o resto calado', () => {
    const b = baloesDasSalas(salas, { financas: null, operacoes: { 'prumo--geral': op([robo('Balcão', 'falha')]) } })
    assert.deepEqual(Object.keys(b), ['pessoal--financeiro', 'prumo--geral'])
    assert.equal(b['pessoal--financeiro'].texto, SEM_SINAL)
  })
  it('sem a fonte de finanças (perfil app), a sala não ganha balão inventado', () => {
    assert.deepEqual(baloesDasSalas(salas, {}), {})
  })
})

describe('agenda nos balões', () => {
  const AGORA = Date.parse('2026-10-17T12:00:00-03:00')
  it('quandoCurto: hoje, amanhã, na semana, depois', () => {
    assert.equal(quandoCurto('2026-10-17T15:00:00-03:00', AGORA), '15:00')
    assert.equal(quandoCurto('2026-10-18T10:00:00-03:00', AGORA), 'amanhã 10:00')
    assert.match(quandoCurto('2026-10-21T09:00:00-03:00', AGORA), /^\S+ 09:00$/)
    assert.equal(quandoCurto('2026-11-02T09:00:00-03:00', AGORA), '02/11')
    assert.equal(quandoCurto('nada', AGORA), '')
  })
  it('em bloco vence o próximo, só de quem a leitura cita', () => {
    const b = baloesDaAgenda({ emBlocoAgora: [{ pessoaId: 'bia', titulo: 'Deploy' }], proxima: { titulo: 'Revisão', inicio: '2026-10-17T15:00:00-03:00', pessoaId: 'ana' } }, AGORA)
    assert.deepEqual(b, { ana: { texto: '15:00: Revisão', tom: 'neutro' }, bia: { texto: 'Em bloco: Deploy', tom: 'verde' } })
    assert.deepEqual(baloesDaAgenda(null, AGORA), {})
  })
})

describe('destinoDoSupervisor: o PO raiz só sai da mesa por problema real', () => {
  const ordem = ['a', 'b', 'c']
  it('vermelho antes de amarelo; empate pela ordem do andar', () => {
    assert.equal(destinoDoSupervisor({ a: { texto: '', tom: 'amarelo', destaque: true }, c: { texto: '', tom: 'vermelho', destaque: true } }, ordem), 'c')
    assert.equal(destinoDoSupervisor({ b: { texto: '', tom: 'amarelo', destaque: true }, c: { texto: '', tom: 'amarelo', destaque: true } }, ordem), 'b')
  })
  it('sem destaque (leads com você, finanças no laranja), fica na mesa', () => {
    assert.equal(destinoDoSupervisor({ a: { texto: '', tom: 'amarelo' }, b: { texto: '', tom: 'laranja' } }, ordem), null)
    assert.equal(destinoDoSupervisor({}, ordem), null)
  })
})

describe('baloesDosAtores', () => {
  const dominios = [{ id: 'raiz', po: { id: 'po-raiz' } }, { id: 'x', po: { id: 'po-x' } }]
  const deSalas = { raiz: { texto: '4 leads', tom: 'neutro' as const }, x: { texto: 'Falhou: Balcão', tom: 'vermelho' as const, destaque: true } }
  it('sala no PO, agenda em quem não tem sala falando, visita leva o problema ao PO raiz', () => {
    const b = baloesDosAtores(dominios, deSalas, { ana: { texto: '15:00: Revisão', tom: 'neutro' }, 'po-x': { texto: 'x', tom: 'neutro' } }, 'x')
    assert.equal(b['po-raiz'].texto, 'Falhou: Balcão')
    assert.equal(b['po-x'].texto, 'Falhou: Balcão')
    assert.equal(b.ana.texto, '15:00: Revisão')
  })
  it('sem visita, cada PO fala da própria sala', () => {
    assert.equal(baloesDosAtores(dominios, deSalas)['po-raiz'].texto, '4 leads')
  })
})

describe('cortar', () => {
  it('uma linha, no limite, com reticências', () => {
    assert.equal(cortar('  a   b  '), 'a b')
    const longo = cortar('x'.repeat(80))
    assert.equal(longo.length, LIMITE_DO_BALAO)
    assert.ok(longo.endsWith('…'))
  })
})
