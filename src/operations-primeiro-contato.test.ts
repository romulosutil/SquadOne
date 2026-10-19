import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  elegivelParaOTime, frenteDosArquivos, primeirosDoTime, quemFazOPrimeiroContato, RECUSAS_GERAIS, reservaDoTime,
  type FrenteDoPrimeiro, type PedidoDoTime,
} from './operations/primeiro-contato.ts'
import { filaDeVenda, type ContextoDaVenda } from './operations/proxima-venda.ts'
import { REGRAS_DO_RITMO } from './operations/trava-de-ritmo.ts'
import type { CrmGrupoHojeId, CrmLead, CrmVisao } from './operations/types.ts'
import { decidir, estadoDoDia } from '../server/vendedor.ts'

// O time comercial (19/10/2026): quem faz o primeiro contato e se o time pode fazê-lo agora, com a
// janela e o ritmo da Central. Tudo fixture: nenhum retrato, arquivo ou WhatsApp de verdade.

const AGORA = Date.parse('2026-10-19T14:00:00Z') // segunda, 11:00 em São Paulo
const MIN = 60_000

function lead(id: string, extra: Partial<CrmLead> = {}): CrmLead {
  return {
    id, chave: id, empresa: `Empresa ${id}`, produto: 'site', nicho: 'pilates', cidade: 'Vitória', etapa: 'novo', sinal: 'pronto',
    mensagemPronta: 'Olá! Vi que a empresa ainda não tem site. Fiz uma prévia, posso mandar?',
    links: { enviar: `https://dell.test/webhook/enviar?place_id=${id}`, whatsapp: 'https://wa.me/5511998887766' }, marcos: {}, ...extra,
  } as unknown as CrmLead
}

function visao(grupos: Partial<Record<CrmGrupoHojeId, string[]>>, leads: CrmLead[]): CrmVisao {
  return {
    estado: 'ok', leads,
    hoje: Object.entries(grupos).map(([id, ids]) => ({
      id, titulo: id, explicacao: '',
      itens: (ids ?? []).map((leadId, ordem) => ({ leadId, acao: 'Fazer', detalhe: '', ordem, links: [] })),
    })),
  } as unknown as CrmVisao
}

const frente = (ativo: boolean, leads: FrenteDoPrimeiro['leads']): FrenteDoPrimeiro => ({ ativo, leads })

describe('quem faz o primeiro contato', () => {
  const casos: Array<[string, FrenteDoPrimeiro, 'time' | 'operador']> = [
    ['fora da fila do time: o operador', frente(true, {}), 'operador'],
    ['na fila, time ligado: o time', frente(true, { L: 'pronto' }), 'time'],
    ['na fila, time pausado: volta ao operador', frente(false, { L: 'pronto' }), 'operador'],
    ['envio incerto do time, mesmo pausado: o time (seria o segundo)', frente(false, { L: 'incerto' }), 'time'],
    ['enviado pelo time: o time', frente(false, { L: 'enviado' }), 'time'],
  ]
  for (const [nome, f, quem] of casos) it(nome, () => assert.equal(quemFazOPrimeiroContato('L', f), quem))

  it('primeirosDoTime junta só os do time', () => {
    assert.deepEqual([...primeirosDoTime(frente(true, { a: 'pronto', b: 'enviado', c: 'incerto' }))].sort(), ['a', 'b', 'c'])
    assert.deepEqual([...primeirosDoTime(frente(false, { a: 'pronto', b: 'enviado' }))], ['b'])
  })

  it('Plus pronto fica com o Rômulo; tentativa incerta antiga continua protegida contra repetição', () => {
    assert.equal(quemFazOPrimeiroContato('plus:a', frente(true, { 'plus:a': 'pronto' })), 'operador')
    assert.equal(quemFazOPrimeiroContato('plus:a', frente(true, { 'plus:a': 'incerto' })), 'time')
    assert.deepEqual(frenteDosArquivos({ ativo: true }, { fila: [
      { id: 'plus:a', produto: 'plus', estado: 'pronto' },
      { id: 'plus:b', produto: 'plus', estado: 'incerto' },
    ] }), { ativo: true, leads: { 'plus:b': 'incerto' } })
  })

  it('os arquivos do Dell: ausente ou ilegível é o time desligado e sem fila', () => {
    assert.deepEqual(frenteDosArquivos(null, null), { ativo: false, leads: {} })
    assert.deepEqual(frenteDosArquivos({ ativo: 'true' }, { fila: 'x' }), { ativo: false, leads: {} })
    assert.deepEqual(frenteDosArquivos({ ativo: true }, { fila: [{ id: 'a', estado: 'pronto' }, { id: 'b', estado: 'outro' }, { estado: 'pronto' }, null] }),
      { ativo: true, leads: { a: 'pronto' } })
  })
})

describe('elegível para o time: só o que a Central liberou', () => {
  it('pronto do Site, com o link rastreado e a mensagem do Balcão', () => assert.equal(elegivelParaOTime(lead('L')), true))
  it('Plus com celular, mensagem e destino corretos é enviado apenas pelo Rômulo', () => {
    const mensagemPronta = 'Meu Ir., posso mostrar uma prévia?'
    assert.equal(elegivelParaOTime(lead('plus:a', { produto: 'plus', mensagemPronta,
      plus: { oferta: 'site', fixo: false, descricao: '' }, links: {
        enviar: `https://wa.me/5511998887766?text=${encodeURIComponent(mensagemPronta)}`,
        whatsapp: 'https://wa.me/5511998887766',
      },
    })), false)
  })
  const fora: Array<[string, Partial<CrmLead>]> = [
    ['revisar (a Triagem é do Rômulo)', { sinal: 'revisar' } as Partial<CrmLead>],
    ['Plus', { produto: 'plus' } as Partial<CrmLead>],
    ['PRUMO', { produto: 'prumo' } as Partial<CrmLead>],
    ['estamparia', { produto: 'estampa' } as Partial<CrmLead>],
    ['sem o link rastreado', { links: { whatsapp: 'https://wa.me/5511998887766' } } as Partial<CrmLead>],
    ['sem a mensagem do Balcão', { mensagemPronta: ' ' } as Partial<CrmLead>],
    ['já enviado', { marcos: { enviado: '2026-10-18T12:00:00Z' } } as Partial<CrmLead>],
    ['com conversa', { conversa: { mensagens: 1 } } as unknown as Partial<CrmLead>],
    ['fora de Novo', { etapa: 'contato' } as Partial<CrmLead>],
  ]
  for (const [nome, extra] of fora) it(`fora: ${nome}`, () => assert.equal(elegivelParaOTime(lead('L', extra)), false))
})

describe('reservaDoTime: a janela e o ritmo da Central, para todos', () => {
  const base = (extra: Partial<PedidoDoTime> = {}): PedidoDoTime => ({
    leadId: 'L', lead: lead('L'), frente: frente(true, { L: 'pronto' }), leads: [lead('L')], primeiros: {}, mensagemAprovada: true, agora: AGORA,
    regras: { ...REGRAS_DO_RITMO, inicioDoNumero: '2026-10-16', pausadoAte: null }, ...extra,
  })
  it('tudo certo: reserva', () => assert.deepEqual(reservaDoTime(base()), { ok: true }))
  it('fora do expediente (antes das 8h, sábado): não', () => {
    assert.equal(reservaDoTime(base({ agora: Date.parse('2026-10-19T10:30:00Z') })).ok, false)
    const sabado = reservaDoTime(base({ agora: Date.parse('2026-10-17T14:00:00Z') }))
    assert.equal(sabado.ok === false && sabado.motivo, 'fora-do-expediente')
  })
  it('o toque da Central de 2 min atrás segura o intervalo de 5 min, com a hora em que libera', () => {
    const r = reservaDoTime(base({ primeiros: { outro: { em: AGORA - 2 * MIN } } }))
    assert.deepEqual(r, { ok: false, motivo: 'intervalo', ate: AGORA + 3 * MIN })
  })
  it('o retrato conta: 12 envios na última hora (de qualquer superfície) seguram a hora', () => {
    const leads = Array.from({ length: 12 }, (_, i) => lead(`e${i}`, { marcos: { enviado: new Date(AGORA - (59 - i * 4.5) * MIN).toISOString() } }))
    const r = reservaDoTime(base({ leads: [lead('L'), ...leads] }))
    assert.equal(r.ok === false && r.motivo, 'hora')
  })
  it('o teto do dia é o da trava de ritmo, somando Central, Telegram e time', () => {
    // 30 no dia (o teto da Fase 0 de 19/10/2026), todos antes da última hora: só o do dia segura.
    const primeiros = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, { em: AGORA - (65 + i) * MIN }]))
    const r = reservaDoTime(base({ primeiros }))
    assert.equal(r.ok === false && r.motivo, 'dia')
  })
  it('as recusas gerais param a rodada; as do lead, não', () => {
    for (const m of ['fora-do-expediente', 'pausa', 'dia', 'hora', 'intervalo'] as const) assert.ok(RECUSAS_GERAIS.has(m))
    for (const m of ['nao-elegivel', 'nao-e-do-time', 'ja-tocado', 'mensagem-barrada'] as const) assert.ok(!RECUSAS_GERAIS.has(m))
  })
  const doLead: Array<[string, Partial<PedidoDoTime>, string]> = [
    ['lead da Triagem', { lead: lead('L', { sinal: 'revisar' } as Partial<CrmLead>) }, 'nao-elegivel'],
    ['sumiu do retrato', { lead: undefined }, 'nao-elegivel'],
    ['fora da fila do time', { frente: frente(true, {}) }, 'nao-e-do-time'],
    ['time pausado', { frente: frente(false, { L: 'pronto' }) }, 'nao-e-do-time'],
    ['o time já começou este envio', { frente: frente(true, { L: 'incerto' }) }, 'nao-e-do-time'],
    ['o Rômulo já tocou neste lead hoje (há 5 min)', { primeiros: { L: { em: AGORA - 5 * MIN } } }, 'ja-tocado'],
    ['o gate barrou a mensagem', { mensagemAprovada: false }, 'mensagem-barrada'],
  ]
  for (const [nome, extra, motivo] of doLead) {
    it(nome, () => {
      const r = reservaDoTime(base(extra))
      assert.equal(r.ok === false && r.motivo, motivo)
    })
  }
})

describe('a tela e o Telegram não oferecem o primeiro contato dos leads do time', () => {
  const prontos = ['p0', 'p1', 'p2'].map((id) => lead(id))
  const v = visao({ enviar: ['p0', 'p1', 'p2'] }, prontos)
  const tela: ContextoDaVenda = { primeiroLiberado: true, agora: AGORA }

  it('a fila de venda: pula os do time e oferece o próximo do operador', () => {
    assert.deepEqual(filaDeVenda(v, tela).map((a) => a.leadId), ['p0'])
    assert.deepEqual(filaDeVenda(v, { ...tela, primeirosDoTime: new Set(['p0']) }).map((a) => a.leadId), ['p1'])
    assert.deepEqual(filaDeVenda(v, { ...tela, primeirosDoTime: new Set(['p0', 'p1', 'p2']) }), [])
  })

  it('vendedor do Telegram: o mesmo predicado, no mesmo lugar da fila', () => {
    const estado = estadoDoDia(null, AGORA)
    const semTime = decidir(v, estado, AGORA)
    assert.equal(semTime.decisao.tipo === 'avisar' && semTime.decisao.acao.leadId, 'p0')
    const comTime = decidir(v, estadoDoDia(null, AGORA), AGORA, undefined, null, new Set(['p0']))
    assert.equal(comTime.decisao.tipo === 'avisar' && comTime.decisao.acao.leadId, 'p1')
    const todos = decidir(v, estadoDoDia(null, AGORA), AGORA, undefined, null, new Set(['p0', 'p1', 'p2']))
    assert.deepEqual(todos.decisao, { tipo: 'nada', motivo: 'fila-vazia' })
  })
})
