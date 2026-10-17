import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAVE_DAS_DECISOES, TAMANHO_DO_LOTE, VALIDADE_DA_DECISAO_MS, corpoDoRegistro, decidir, detalheSemPrioridade, dispensado, esquecerDecisao,
  gravarDecisoes, lerDecisoes, loteDaTriagem, mesmoLote, motivoDoConviteTravado, podarDecisoes, prioridadesDiferem, textoDaPrioridade,
  type DecisoesDaTriagem,
} from './operations/triagem.ts'
import type { CrmItemHoje, CrmLead } from './operations/types.ts'
import type { EstadoDoRitmo } from './operations/trava-de-ritmo.ts'

const T = Date.parse('2026-10-17T14:00:00-03:00')
const item = (id: string): CrmItemHoje => ({ leadId: id, acao: 'Ver o site e decidir o convite', detalhe: '', links: [], ordem: 0 })
const lead = (id: string, extra: Partial<CrmLead> = {}): CrmLead => ({
  id, produto: 'iris', chave: `chave-${id}`, empresa: id, nicho: '', cidade: '', etapa: 'novo', sinal: 'revisar', subEtapa: 'Revisar',
  estadoNaPlanilha: 'revisar', leitura: 'desconhecida', marcos: {}, followupHoje: false, respostaNova: false, acervo: false,
  notas: 0, eventos: [], links: {}, divergencias: [], ...extra,
})
// 23 prospects, p01..p23, na ordem do servidor.
const ids = Array.from({ length: 23 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`)
const itens = ids.map(item)
const leads = new Map(ids.map((id) => [id, lead(id)] as [string, CrmLead]))
const marcar = (base: DecisoesDaTriagem, quais: string[], tipo: 'convidado' | 'dispensado') =>
  quais.reduce((d, id) => decidir(d, id, tipo, T), base)

describe('loteDaTriagem (AC-10): um lote de 10 de verdade', () => {
  it('nasce com os 10 primeiros na ordem do servidor e conta o total', () => {
    const lote = loteDaTriagem(itens, leads, {}, [])
    assert.equal(TAMANHO_DO_LOTE, 10)
    assert.deepEqual(lote.ids, ids.slice(0, 10))
    assert.equal(lote.itens.length, 10)
    assert.equal(lote.pendentes.length, 10)
    assert.equal(lote.restantes, 23)
  })

  it('dispensar um tira o item na hora e NÃO puxa o 11º para dentro', () => {
    const primeiro = loteDaTriagem(itens, leads, {}, [])
    const d = marcar({}, ['p03'], 'dispensado')
    const lote = loteDaTriagem(itens, leads, d, primeiro.ids)
    assert.deepEqual(lote.ids, primeiro.ids)
    assert.ok(!lote.itens.some((i) => i.leadId === 'p03'))
    assert.ok(!lote.itens.some((i) => i.leadId === 'p11'))
    assert.equal(lote.pendentes.length, 9)
    assert.equal(lote.restantes, 22)
  })

  it('o convidado fica à vista no lote, mas não conta como pendente', () => {
    const d = marcar({}, ['p01'], 'convidado')
    const lote = loteDaTriagem(itens, leads, d, ids.slice(0, 10))
    assert.ok(lote.itens.some((i) => i.leadId === 'p01'))
    assert.ok(!lote.pendentes.some((i) => i.leadId === 'p01'))
  })

  it('decidido o lote inteiro, o próximo traz os 10 seguintes não decididos', () => {
    const d = marcar(marcar({}, ['p01', 'p02'], 'convidado'), ids.slice(2, 10), 'dispensado')
    const lote = loteDaTriagem(itens, leads, d, ids.slice(0, 10))
    assert.deepEqual(lote.ids, ids.slice(10, 20))
    assert.equal(lote.restantes, 13)
    // E o seguinte, até acabar.
    const d2 = marcar(d, ids.slice(10, 20), 'dispensado')
    assert.deepEqual(loteDaTriagem(itens, leads, d2, lote.ids).ids, ids.slice(20))
    const d3 = marcar(d2, ids.slice(20), 'dispensado')
    const fim = loteDaTriagem(itens, leads, d3, ids.slice(20))
    assert.deepEqual(fim.ids, [])
    assert.equal(fim.restantes, 0)
  })

  it('o dispensado no retrato (perdaManual) fica fora, mesmo sem marca local', () => {
    const comRetrato = new Map(leads).set('p01', lead('p01', { perdaManual: 'dispensado' }))
    const lote = loteDaTriagem(itens, comRetrato, {}, [])
    assert.equal(lote.ids[0], 'p02')
    assert.equal(lote.ids.length, 10)
    assert.equal(lote.restantes, 22)
    assert.equal(dispensado({}, comRetrato.get('p01'), 'p01'), true)
  })

  it('lote nascido de novo pula os já decididos nesta tela', () => {
    const d = marcar(marcar({}, ['p01'], 'convidado'), ['p02'], 'dispensado')
    assert.deepEqual(loteDaTriagem(itens, leads, d, []).ids, ids.slice(2, 12))
  })

  it('o lote encolhe quando o retrato tira quem foi decidido, e fecha quando não sobra pendente', () => {
    const anterior = ids.slice(0, 3)
    const semP01 = itens.filter((i) => i.leadId !== 'p01')
    const lote = loteDaTriagem(semP01, leads, {}, anterior)
    assert.deepEqual(lote.ids, anterior)
    assert.deepEqual(lote.itens.map((i) => i.leadId), ['p02', 'p03'])
    const d = marcar({}, ['p02', 'p03'], 'dispensado')
    assert.deepEqual(loteDaTriagem(semP01, leads, d, anterior).ids, ids.slice(3, 13))
  })

  it('mesmoLote compara ids e ordem', () => {
    assert.equal(mesmoLote(['a', 'b'], ['a', 'b']), true)
    assert.equal(mesmoLote(['a', 'b'], ['b', 'a']), false)
    assert.equal(mesmoLote([], ['a']), false)
  })
})

describe('decisões locais: marca otimista e poda pelo retrato', () => {
  it('desfazer (ou falha do POST) tira a marca e o item volta ao lote', () => {
    const d = esquecerDecisao(marcar({}, ['p03'], 'dispensado'), 'p03')
    assert.deepEqual(d, {})
    assert.ok(loteDaTriagem(itens, leads, d, ids.slice(0, 10)).itens.some((i) => i.leadId === 'p03'))
  })

  it('repetir a mesma decisão não renova o instante; trocar a decisão troca', () => {
    const d = decidir({}, 'p01', 'dispensado', T)
    assert.equal(decidir(d, 'p01', 'dispensado', T + 1000).p01.em, T)
    assert.equal(decidir(d, 'p01', 'convidado', T + 1000).p01.tipo, 'convidado')
  })

  it('poda o dispensado que o retrato confirmou e mantém o que ele ainda não viu', () => {
    const d = marcar({}, ['p01', 'p02'], 'dispensado')
    const retrato = new Map(leads).set('p01', lead('p01', { perdaManual: 'dispensado', sinal: 'descartado', etapa: 'perdido' }))
    assert.deepEqual(Object.keys(podarDecisoes(d, retrato, T + 60_000)), ['p02'])
  })

  it('poda o convidado que saiu da Revisar, o lead que sumiu do retrato e o que venceu', () => {
    const d = marcar(marcar({}, ['p01', 'p02'], 'convidado'), ['p03'], 'dispensado')
    const retrato = new Map(leads).set('p01', lead('p01', { sinal: 'convite' }))
    retrato.delete('p03')
    assert.deepEqual(Object.keys(podarDecisoes(d, retrato, T + 60_000)), ['p02'])
    assert.deepEqual(podarDecisoes(d, leads, T + VALIDADE_DA_DECISAO_MS), {})
  })

  it('lê e grava pelo storage, e sobrevive a storage quebrado ou lixo', () => {
    const guardado = new Map<string, string>()
    const storage = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => { guardado.set(k, v) } }
    gravarDecisoes(storage, marcar({}, ['p01'], 'dispensado'))
    assert.deepEqual(lerDecisoes(storage, T + 1000), { p01: { tipo: 'dispensado', em: T } })
    assert.deepEqual(lerDecisoes(storage, T + VALIDADE_DA_DECISAO_MS), {})
    guardado.set(CHAVE_DAS_DECISOES, '{"p01":{"tipo":"outro","em":1},"p02":3,"p03":null}')
    assert.deepEqual(lerDecisoes(storage, T), {})
    guardado.set(CHAVE_DAS_DECISOES, 'não é json')
    assert.deepEqual(lerDecisoes(storage, T), {})
    const quebrado = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    assert.deepEqual(lerDecisoes(quebrado, T), {})
    assert.doesNotThrow(() => gravarDecisoes(quebrado, {}))
    assert.deepEqual(lerDecisoes(null, T), {})
  })

  it('o corpo do registro leva a chave da planilha, não o id do CRM', () => {
    assert.deepEqual(corpoDoRegistro(lead('p01'), 'dispensado'), { produto: 'iris', id: 'chave-p01', tipo: 'dispensado', texto: '', data: '' })
    assert.equal(corpoDoRegistro(lead('p01'), 'dispensado_desfeito').tipo, 'dispensado_desfeito')
  })
})

describe('pontuação do caçador: só quando diferencia', () => {
  const com = (p: Array<number | undefined>) => new Map(p.map((v, i) => [`p${i}`, lead(`p${i}`, v === undefined ? {} : { triagem: { prioridade: v } })] as [string, CrmLead]))
  const lista = (n: number) => Array.from({ length: n }, (_, i) => item(`p${i}`))
  const CASOS: Array<{ nome: string; p: Array<number | undefined>; esperado: boolean }> = [
    { nome: 'todos 100 (o caso de 17/10/2026)', p: [100, 100, 100], esperado: false },
    { nome: 'valores diferentes', p: [100, 80, 80], esperado: true },
    { nome: 'um só com pontuação', p: [90, undefined, undefined], esperado: false },
    { nome: 'nenhum com pontuação', p: [undefined, undefined], esperado: false },
  ]
  for (const c of CASOS) {
    it(c.nome, () => assert.equal(prioridadesDiferem(lista(c.p.length), com(c.p)), c.esperado))
  }
  it('o selo diz o que o número é', () => assert.equal(textoDaPrioridade(72), 'Pontuação 72 de 100'))

  const DETALHES: Array<[string, string]> = [
    ['Psicologia · Vitória · encontrado há 2 dias. Prioridade 100 · nota 4.8 · tem agenda.', 'Psicologia · Vitória · encontrado há 2 dias. Nota 4.8 · tem agenda.'],
    ['Psicologia · Vitória · encontrado hoje. Prioridade 100. WhatsApp não confirmado (é o celular do Google): confira.', 'Psicologia · Vitória · encontrado hoje. WhatsApp não confirmado (é o celular do Google): confira.'],
    ['Sem segmento · sem data. Prioridade 72.', 'Sem segmento · sem data.'],
    ['Estamparia · Serra · encontrado ontem.', 'Estamparia · Serra · encontrado ontem.'],
  ]
  for (const [antes, depois] of DETALHES) {
    it(`tira a prioridade do detalhe: "${antes.slice(0, 40)}…"`, () => assert.equal(detalheSemPrioridade(antes), depois))
  }
})

describe('motivoDoConviteTravado: o porquê curto do Convidar desligado', () => {
  const livre: EstadoDoRitmo = { motivo: null, ate: null, enviadosHoje: 2, teto: 10 }
  const ate = Date.parse('2026-10-17T14:04:00-03:00')
  it('livre e no expediente: dá para convidar', () => {
    assert.equal(motivoDoConviteTravado({ temConvite: true, ritmo: livre, travadoPeloHorario: false }), null)
  })
  it('sem link de convite, antes de tudo', () => {
    assert.equal(motivoDoConviteTravado({ temConvite: false, ritmo: livre, travadoPeloHorario: false }), 'Sem link de convite')
  })
  it('fora do expediente (o "Liberar" fica ao lado)', () => {
    assert.equal(motivoDoConviteTravado({ temConvite: true, ritmo: livre, travadoPeloHorario: true }), 'Fora do expediente')
  })
  it('o ritmo vem antes do horário, com a hora em que libera', () => {
    const intervalo: EstadoDoRitmo = { motivo: 'intervalo', ate, enviadosHoje: 3, teto: 10 }
    assert.equal(motivoDoConviteTravado({ temConvite: true, ritmo: intervalo, travadoPeloHorario: true }), 'O próximo sai às 14:04')
    assert.equal(motivoDoConviteTravado({ temConvite: true, ritmo: { ...intervalo, motivo: 'dia' }, travadoPeloHorario: false }), 'Teto de hoje atingido')
    assert.equal(motivoDoConviteTravado({ temConvite: true, ritmo: { ...intervalo, motivo: 'hora' }, travadoPeloHorario: false }), 'Teto da hora: libera às 14:04')
  })
})
