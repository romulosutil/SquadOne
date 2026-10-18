import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PAUSA_ENTRE_LEITURAS_MS, alvosDoLote, corpoDaLeitura, desfechoDaResposta, lerEmSerie, podeLerSinais, resumoVazio, textoDoAndamento, textoDoResumo,
  type AlvoDaLeitura, type Andamento, type ResultadoDoPedido,
} from './operations/leitura-de-sinais.ts'
import { SEM_FONTE } from '../server/sinais-do-site.ts'
import type { CrmLead } from './operations/types.ts'

// Leads inventados: nenhum nome, telefone ou link real.
type LeadDeTeste = Pick<CrmLead, 'id' | 'chave' | 'produto' | 'empresa' | 'links' | 'sinais'>
const lead = (id: string, extra: Partial<LeadDeTeste> = {}): LeadDeTeste => ({
  id: `iris:${id}`, chave: id, produto: 'iris', empresa: `Clínica ${id}`, links: { site: `https://${id}.example.com.br/` }, ...extra,
})
const mapa = (ls: LeadDeTeste[]) => new Map(ls.map((l) => [l.id, l]))
const alvo = (id: string): AlvoDaLeitura => ({ id: `iris:${id}`, chave: id, produto: 'iris', empresa: `Clínica ${id}` })

describe('podeLerSinais: quem vale uma leitura', () => {
  const casos: Array<[string, LeadDeTeste, boolean]> = [
    ['site próprio, sem leitura', lead('a'), true],
    ['já tem leitura guardada', lead('b', { sinais: { ...SEM_FONTE } }), false],
    ['sem site (o servidor já o marca sem fonte, mas mesmo sem isso não há o que ler)', lead('c', { links: {} }), false],
    ['perfil de rede social no lugar do site', lead('d', { links: { site: 'https://www.instagram.com/clinica' } }), false],
    ['o demo do Site antes da venda não é o site do lead', lead('e', { produto: 'site' }), false],
    ['PRUMO com site próprio', lead('f', { produto: 'prumo' }), true],
  ]
  for (const [nome, l, esperado] of casos) it(nome, () => assert.equal(podeLerSinais(l), esperado))
})

describe('alvosDoLote: só o lote, na ordem, sem repetir', () => {
  const leads = mapa([lead('a'), lead('b', { sinais: { ...SEM_FONTE } }), lead('c', { links: {} }), lead('d'), lead('e')])
  it('guarda a ordem do lote e tira quem não precisa', () => {
    assert.deepEqual(alvosDoLote(['iris:e', 'iris:a', 'iris:b', 'iris:c', 'iris:d'], leads).map((a) => a.chave), ['e', 'a', 'd'])
  })
  it('ignora id que não está na visão e id repetido', () => {
    assert.deepEqual(alvosDoLote(['iris:a', 'iris:a', 'iris:zzz'], leads).map((a) => a.chave), ['a'])
  })
  it('só olha os ids do lote: o resto da fila nunca entra', () => {
    assert.deepEqual(alvosDoLote(['iris:a'], leads).map((a) => a.chave), ['a'])
  })
  it('quem esta tela já tentou e não ganhou leitura não é oferecido de novo', () => {
    assert.deepEqual(alvosDoLote(['iris:a', 'iris:d'], leads, new Set(['iris:a'])).map((a) => a.chave), ['d'])
  })
  it('lote vazio: nada a ler', () => assert.deepEqual(alvosDoLote([], leads), []))
  it('o corpo do pedido leva a chave da planilha, não o id do CRM', () => {
    assert.deepEqual(corpoDaLeitura(alvo('a')), { produto: 'iris', id: 'a' })
  })
})

describe('desfechoDaResposta: o que cada resposta do servidor quer dizer', () => {
  const casos: Array<[string, number, unknown, ResultadoDoPedido]> = [
    ['lido no site', 200, { estado: 'ok', origem: 'site' }, { desfecho: 'lido', origem: 'site' }],
    ['lido do cache do servidor', 200, { estado: 'ok', origem: 'cache' }, { desfecho: 'lido', origem: 'cache' }],
    ['site fora do ar', 200, { estado: 'inacessivel', origem: 'site' }, { desfecho: 'inacessivel', origem: 'site' }],
    ['estado bloqueado na leitura', 200, { estado: 'bloqueado', origem: 'site' }, { desfecho: 'bloqueado', origem: 'site' }],
    ['409: sem site próprio não é erro', 409, { error: 'x', semSite: true }, { desfecho: 'semSite' }],
    ['422: endereço que a Central não lê não é erro', 422, { bloqueado: true }, { desfecho: 'bloqueado' }],
    ['503: leitura desligada', 503, { error: 'x' }, { desfecho: 'desligado' }],
    ['500', 500, { error: 'x' }, { desfecho: 'falhou' }],
    ['404: sumiu do retrato', 404, { error: 'x' }, { desfecho: 'falhou' }],
    ['200 sem corpo legível', 200, null, { desfecho: 'falhou' }],
    ['200 com estado desconhecido', 200, { estado: 'talvez' }, { desfecho: 'falhou' }],
    ['origem estranha é ignorada', 200, { estado: 'ok', origem: 'outra' }, { desfecho: 'lido' }],
  ]
  for (const [nome, status, corpo, esperado] of casos) it(nome, () => assert.deepEqual(desfechoDaResposta(status, corpo), esperado))
})

// Dublê do laço: respostas por chave, relógio que só registra as esperas.
function laco(respostas: Record<string, ResultadoDoPedido | Error>, extra: { parouDepoisDe?: number } = {}) {
  const chamadas: string[] = []
  const esperas: number[] = []
  const andamentos: Andamento[] = []
  let parado = false
  const deps = {
    async ler(a: AlvoDaLeitura) {
      chamadas.push(a.chave)
      const r = respostas[a.chave] ?? { desfecho: 'lido', origem: 'site' }
      if (r instanceof Error) throw r
      if (extra.parouDepoisDe !== undefined && chamadas.length >= extra.parouDepoisDe) parado = true
      return r
    },
    async esperar(ms: number) { esperas.push(ms) },
    parou: () => parado,
    aoAndar: (a: Andamento) => { andamentos.push(a) },
  }
  return { deps, chamadas, esperas, andamentos, parar: () => { parado = true } }
}
const tres = [alvo('a'), alvo('b'), alvo('c')]

describe('lerEmSerie: a série do lote', () => {
  it('lê todos, na ordem, e conta os lidos', async () => {
    const { deps, chamadas } = laco({})
    const r = await lerEmSerie(tres, deps)
    assert.deepEqual(chamadas, ['a', 'b', 'c'])
    assert.deepEqual({ ...r, resolvidos: [] }, { ...resumoVazio(3), feitos: 3, lidos: 3 })
    assert.deepEqual(r.resolvidos, ['iris:a', 'iris:b', 'iris:c'])
  })

  it('pausa só ENTRE leituras que foram ao site, nunca depois da última', async () => {
    const { deps, esperas } = laco({})
    await lerEmSerie(tres, deps)
    assert.deepEqual(esperas, [PAUSA_ENTRE_LEITURAS_MS, PAUSA_ENTRE_LEITURAS_MS])
  })

  it('leitura que veio do cache não faz ninguém esperar', async () => {
    const { deps, esperas } = laco({
      a: { desfecho: 'lido', origem: 'cache' }, b: { desfecho: 'lido', origem: 'cache' }, c: { desfecho: 'lido', origem: 'cache' },
    })
    await lerEmSerie(tres, deps)
    assert.deepEqual(esperas, [])
  })

  it('409 e 422 não são erro: contam à parte, a série segue e a tela não os oferece de novo', async () => {
    const { deps, chamadas } = laco({ a: { desfecho: 'semSite' }, b: { desfecho: 'bloqueado' }, c: { desfecho: 'inacessivel', origem: 'site' } })
    const r = await lerEmSerie(tres, deps)
    assert.deepEqual(chamadas, ['a', 'b', 'c'])
    assert.equal(r.semSite, 1)
    assert.equal(r.bloqueados, 1)
    assert.equal(r.inacessiveis, 1)
    assert.equal(r.falhas, 0)
    assert.equal(r.lidos, 0)
    assert.deepEqual(r.resolvidos, ['iris:a', 'iris:b', 'iris:c'])
  })

  it('a falha de um (resposta ruim ou exceção) nunca derruba os outros', async () => {
    const { deps, chamadas } = laco({ a: new Error('rede caiu'), b: { desfecho: 'falhou' } })
    const r = await lerEmSerie(tres, deps)
    assert.deepEqual(chamadas, ['a', 'b', 'c'])
    assert.equal(r.falhas, 2)
    assert.equal(r.lidos, 1)
    assert.equal(r.feitos, 3)
    // erro de rede pode passar: só quem deu erro continua oferecido numa próxima vez.
    assert.deepEqual(r.resolvidos, ['iris:c'])
  })

  it('parar interrompe: o que já foi lido conta, o resto não é pedido', async () => {
    const { deps, chamadas } = laco({}, { parouDepoisDe: 2 })
    const r = await lerEmSerie(tres, deps)
    assert.deepEqual(chamadas, ['a', 'b'])
    assert.equal(r.parou, true)
    assert.equal(r.total, 3)
    // o pedido em andamento quando a parada veio não vale (pode ser o próprio cancelamento).
    assert.equal(r.feitos, 1)
    assert.equal(r.lidos, 1)
  })

  it('parar durante a pausa não pede o seguinte', async () => {
    const c = laco({})
    const deps = { ...c.deps, async esperar(ms: number) { c.esperas.push(ms); c.parar() } }
    const r = await lerEmSerie(tres, deps)
    assert.deepEqual(c.chamadas, ['a'])
    assert.equal(r.parou, true)
    assert.equal(r.feitos, 1)
  })

  it('já parado antes de começar: nada é pedido', async () => {
    const c = laco({})
    c.parar()
    const r = await lerEmSerie(tres, c.deps)
    assert.deepEqual(c.chamadas, [])
    assert.equal(r.parou, true)
  })

  it('503 (leitura desligada) para a série: os outros dariam a mesma resposta', async () => {
    const { deps, chamadas } = laco({ a: { desfecho: 'desligado' } })
    const r = await lerEmSerie(tres, deps)
    assert.deepEqual(chamadas, ['a'])
    assert.equal(r.desligado, true)
    assert.equal(r.feitos, 0)
  })

  it('o progresso anda de 0 até o total e termina sem ninguém "em leitura"', async () => {
    const { deps, andamentos } = laco({})
    await lerEmSerie(tres, deps)
    assert.deepEqual(andamentos.map((a) => textoDoAndamento(a)), ['0 de 3', '1 de 3', '2 de 3', '3 de 3'])
    assert.equal(andamentos[0].empresa, 'Clínica a')
    assert.equal(andamentos.at(-1)?.empresa, '')
  })

  it('lote vazio: devolve o resumo vazio sem tocar em nada', async () => {
    const { deps, chamadas } = laco({})
    const r = await lerEmSerie([], deps)
    assert.deepEqual(chamadas, [])
    assert.equal(r.total, 0)
  })
})

describe('textoDoResumo: a frase de fim', () => {
  const com = (extra: Partial<ReturnType<typeof resumoVazio>>) => ({ ...resumoVazio(10), ...extra })
  const casos: Array<[string, ReturnType<typeof resumoVazio>, string]> = [
    ['tudo lido', com({ feitos: 10, lidos: 10 }), '10 sites lidos.'],
    ['um só lido', com({ feitos: 1, lidos: 1, total: 1 }), '1 site lido.'],
    ['mistura, com os dois tipos de "não deu"', com({ feitos: 10, lidos: 6, semSite: 1, inacessiveis: 2, bloqueados: 1 }), '6 sites lidos · 1 sem site para ler · 3 não pôde ler.'],
    ['erro avisa que dá para tentar de novo', com({ feitos: 10, lidos: 8, falhas: 2 }), '8 sites lidos · 2 deram erro (tente de novo).'],
    ['um erro só', com({ feitos: 10, lidos: 9, falhas: 1 }), '9 sites lidos · 1 deu erro (tente de novo).'],
    ['parado no meio', com({ feitos: 4, lidos: 4, parou: true }), 'Parado em 4 de 10: 4 sites lidos.'],
    ['parado sem ler nenhum', com({ parou: true }), 'Parado em 0 de 10.'],
    ['nada lido e ninguém parou', com({ feitos: 10 }), 'Nenhum site lido.'],
    ['desligado', com({ desligado: true }), 'A leitura dos sinais do site está desligada nesta Central.'],
  ]
  for (const [nome, r, esperado] of casos) it(nome, () => assert.equal(textoDoResumo(r), esperado))
})
