/**
 * O cliente do Assistente da Central (RULES 28): as regras puras do painel e o acompanhamento com
 * relógio e visibilidade falsos. Nada aqui toca a rede: `buscar` é dublê.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  acompanhar,
  atalhosDoContexto,
  chaveParaRegistro,
  contextoDoEndereco,
  enterEnvia,
  gastoDoTexto,
  gravarGasto,
  linhaDoTempo,
  textoDoValor,
  useAssistente,
  type GastoNaTela,
  enviar,
  ErroDoAssistente,
  estadoDoCartao,
  falhaDaResposta,
  horaCurta,
  juntarMensagens,
  leadDoCartao,
  leadDoId,
  lerConversa,
  maiorN,
  modoDoTurno,
  textoDaEtapa,
  textoDaFalha,
  usoDeHoje,
} from './assistente.ts'
import { comandosDaPaleta, usaAssistente } from './destinos.ts'
import type { ConversaDoAssistente, MensagemDoAssistente } from '../operations/assistente-contrato.ts'

describe('assistente: o lead do cartão diz a oferta e avisa quando não é o da Ficha aberta', () => {
  const dados = { produto: 'site', id: 'site:ChIJkulniski', empresa: 'Kulniski Advocacia' }
  const casos: Array<[string, { produto: string; id: string } | null, { rotulo: string; outroLead: boolean }]> = [
    ['sem Ficha aberta', null, { rotulo: 'Kulniski Advocacia · Site', outroLead: false }],
    ['a Ficha é dele (id inteiro)', { produto: 'site', id: 'site:ChIJkulniski' }, { rotulo: 'Kulniski Advocacia · Site', outroLead: false }],
    ['a Ficha é dele (só a chave)', { produto: 'site', id: 'ChIJkulniski' }, { rotulo: 'Kulniski Advocacia · Site', outroLead: false }],
    ['a Ficha é de outro lead', { produto: 'site', id: 'site:ChIJpadaria' }, { rotulo: 'Kulniski Advocacia · Site', outroLead: true }],
    ['mesma chave, outra oferta', { produto: 'prumo', id: 'prumo:ChIJkulniski' }, { rotulo: 'Kulniski Advocacia · Site', outroLead: true }],
  ]
  for (const [caso, aberto, esperado] of casos) it(caso, () => assert.deepEqual(leadDoCartao(dados, aberto), esperado))
  it('a oferta pela sigla do CRM', () => {
    assert.equal(leadDoCartao({ produto: 'estampa', id: 'estampa:x', empresa: 'Malharia' }).rotulo, 'Malharia · Estamparia')
    assert.equal(leadDoCartao({ produto: 'plus', id: 'plus:x', empresa: 'Loja' }).rotulo, 'Loja · Plus')
  })
})

describe('assistente: a casca troca o Pedir por ele só no Dell com a flag', () => {
  it('usaAssistente', () => {
    assert.equal(usaAssistente({ perfil: 'operations', agentes: true, assistente: true }), true)
    assert.equal(usaAssistente({ perfil: 'operations', agentes: false, assistente: true }), true)
    assert.equal(usaAssistente({ perfil: 'operations', agentes: true, assistente: false }), false)
    assert.equal(usaAssistente({ perfil: 'operations', agentes: true }), false)
    assert.equal(usaAssistente({ perfil: 'app', agentes: true, assistente: true }), false)
  })
  it('Ctrl+K: "Assistente" no lugar de "Fazer um pedido", com ou sem agenda', () => {
    const com = comandosDaPaleta({ perfil: 'operations', agentes: true, assistente: true }, [], null)
    assert.deepEqual([com[0].id, com[0].rotulo, com[0].acao.tipo], ['assistente', 'Assistente', 'assistente'])
    assert.ok(!com.some((c) => c.acao.tipo === 'pedir'))
    const semAgenda = comandosDaPaleta({ perfil: 'operations', agentes: false, assistente: true }, [], null)
    assert.equal(semAgenda[0].acao.tipo, 'assistente')
  })
  it('sem a flag (ou no Easypanel) a paleta fica como era', () => {
    assert.equal(comandosDaPaleta({ perfil: 'operations', agentes: true }, [], null)[0].acao.tipo, 'pedir')
    assert.equal(comandosDaPaleta({ perfil: 'app', agentes: true, assistente: true }, [], null)[0].acao.tipo, 'pedir')
    assert.ok(comandosDaPaleta({ perfil: 'operations', agentes: false }, [], null).every((c) => c.acao.tipo === 'ir'))
  })
})

const msg = (n: number, texto = `m${n}`, autor: MensagemDoAssistente['autor'] = 'assistente'): MensagemDoAssistente => ({
  id: `id${n}`, n, autor, texto, quando: '2026-10-17T11:00:00.000Z', fontes: [], cartoes: [],
})

describe('assistente: o contexto vem do endereço', () => {
  const casos: Array<[string, string, ReturnType<typeof contextoDoEndereco>]> = [
    ['/', '', { pagina: 'hoje' }],
    ['/agenda', '', { pagina: 'agenda' }],
    ['/crm', '', { pagina: 'vendas' }],
    ['/crm/', '?ver=funil', { pagina: 'funil' }],
    ['/crm', '?ver=jornada', { pagina: 'funil' }],
    ['/crm', '?ver=triagem&produto=site', { pagina: 'triagem' }],
    ['/crm', '?ver=resultados', { pagina: 'numeros' }],
    ['/crm', '?ver=funil&lead=site%3Aabc123', { pagina: 'ficha', lead: { produto: 'site', id: 'site:abc123' } }],
    ['/crm', '?lead=plus:42', { pagina: 'ficha', lead: { produto: 'plus', id: 'plus:42' } }],
    ['/crm', '?lead=semprefixo', { pagina: 'vendas' }],
    ['/financas/lancamentos', '?mes=2026-10', { pagina: 'financas' }],
    ['/squadone/sala', '', { pagina: 'escritorio' }],
    ['/mais', '?abrir=roteiro', { pagina: 'mais' }],
    ['/design-system', '', { pagina: 'design-system' }],
    ['/qualquer', '', { pagina: 'outra' }],
  ]
  for (const [caminho, busca, esperado] of casos) {
    it(`${caminho}${busca}`, () => assert.deepEqual(contextoDoEndereco(caminho, busca), esperado))
  }

  it('o lead só vai com produto e id (nada de nome ou telefone)', () => {
    assert.deepEqual(Object.keys(leadDoId('iris:x') ?? {}).sort(), ['id', 'produto'])
    assert.equal(leadDoId(':x'), null)
    assert.equal(leadDoId('site:'), null)
    assert.equal(leadDoId(null), null)
  })
})

describe('assistente: atalhos da conversa vazia', () => {
  it('Hoje', () => assert.deepEqual(atalhosDoContexto('hoje'), ['O que faço agora?', 'Quem espera resposta?', 'Como está o Dell?']))
  it('Ficha com a empresa', () =>
    assert.deepEqual(atalhosDoContexto('ficha', { empresa: ' Padaria Sol ' }), ['O que respondo para Padaria Sol?', 'Em que pé está?', 'Anotar o próximo passo']))
  it('Ficha antes de o nome aparecer', () => assert.equal(atalhosDoContexto('ficha', null)[0], 'O que respondo para este lead?'))
  it('Agenda', () => assert.deepEqual(atalhosDoContexto('agenda'), ['O que tenho hoje?']))
  it('Funil', () => assert.deepEqual(atalhosDoContexto('funil'), ['Onde está travando?']))
  it('Finanças não tem atalho (finanças não vão ao Assistente)', () => assert.deepEqual(atalhosDoContexto('financas'), []))
  it('página sem atalho', () => assert.deepEqual(atalhosDoContexto('mais'), []))
})

describe('assistente: junção das mensagens', () => {
  it('não duplica pelo n e mantém a ordem', () => {
    const r = juntarMensagens([msg(1), msg(2)], [msg(2), msg(3)])
    assert.deepEqual(r.map((m) => m.n), [1, 2, 3])
  })
  it('a versão nova da mesma mensagem vence', () => {
    assert.equal(juntarMensagens([msg(2, 'velha')], [msg(2, 'nova')])[0].texto, 'nova')
  })
  it('ordena o que chega fora de ordem', () => {
    assert.deepEqual(juntarMensagens([msg(5)], [msg(3), msg(4)]).map((m) => m.n), [3, 4, 5])
  })
  it('maiorN: o desde do próximo pedido', () => {
    assert.equal(maiorN([]), undefined)
    assert.equal(maiorN([], 4), 4)
    assert.equal(maiorN([msg(2), msg(7), msg(3)]), 7)
  })
})

describe('assistente: textos', () => {
  it('etapas', () => {
    assert.equal(textoDaEtapa('pensando'), 'Pensando…')
    assert.equal(textoDaEtapa('lendo'), 'Lendo Vendas…')
    assert.equal(textoDaEtapa('hermes'), 'Consultando o Hermes, ~20 s (pode fechar)')
    assert.equal(textoDaEtapa('desconhecida'), 'Pensando…')
  })
  it('toda falha diz o que fazer', () => {
    for (const t of ['modeloOcupado', 'teto', 'hermes', 'semCrm', 'desligado', 'outro', 'rede']) {
      const f = textoDaFalha(t)
      assert.ok(f.titulo && f.oQueFazer, t)
    }
    assert.match(textoDaFalha('semCrm').titulo, /Vendas/)
    assert.deepEqual(textoDaFalha('inventada'), textoDaFalha('outro'))
  })
  it('a resposta de erro do servidor vira falha classificada', () => {
    assert.deepEqual(falhaDaResposta(429, { error: 'Teto de 60 por dia.', teto: true }), { tipo: 'teto', texto: 'Teto de 60 por dia.' })
    assert.equal(falhaDaResposta(503, { error: 'desligado', desligado: true }).tipo, 'desligado')
    assert.equal(falhaDaResposta(400, { error: 'Texto vazio.' }).texto, 'Texto vazio.')
    assert.equal(falhaDaResposta(400, { error: 'Texto vazio.' }).tipo, 'outro')
    assert.match(falhaDaResposta(500, null).texto, /HTTP 500/)
  })
  it('uso, hora e modo', () => {
    assert.equal(usoDeHoje({ usadosHoje: 12, tetoDia: 60 }), '12 de 60 perguntas hoje')
    assert.equal(usoDeHoje(null), '')
    assert.equal(horaCurta('2026-10-17T11:05:00.000Z'), '08:05')
    assert.equal(horaCurta('ontem'), '')
    assert.equal(modoDoTurno('baixa'), 'baixa_prioridade')
    assert.equal(modoDoTurno('foco'), 'foco')
  })
  it('Enter envia; Shift+Enter e a composição de acento não', () => {
    assert.equal(enterEnvia({ key: 'Enter', shiftKey: false }), true)
    assert.equal(enterEnvia({ key: 'Enter', shiftKey: true }), false)
    assert.equal(enterEnvia({ key: 'Enter', shiftKey: false, isComposing: true }), false)
    assert.equal(enterEnvia({ key: 'a', shiftKey: false }), false)
  })
})

describe('assistente: cartões', () => {
  it('a chave do registro de Vendas, com ou sem o prefixo do produto', () => {
    assert.equal(chaveParaRegistro('site', 'site:abc'), 'abc')
    assert.equal(chaveParaRegistro('site', 'abc'), 'abc')
    assert.equal(chaveParaRegistro('plus', 'site:abc'), 'site:abc')
  })
  it('o toque desta aba vence o estado guardado', () => {
    const c = { id: 'c1', tipo: 'mensagem_ao_lead' as const, estado: 'proposto' as const, dados: { produto: 'site', id: 'site:a', empresa: 'A', texto: 'oi' } }
    assert.equal(estadoDoCartao(c), 'proposto')
    assert.equal(estadoDoCartao(c, 'descartado'), 'descartado')
  })
})

describe('assistente: transporte', () => {
  it('enviar manda JSON da mesma origem e corta em 2000', async () => {
    let visto: { url: string; init?: RequestInit } | null = null
    const r = await enviar({ texto: 'x'.repeat(2500), contexto: { pagina: 'hoje' } }, async (url, init) => {
      visto = { url, init }
      return new Response(JSON.stringify({ conversaId: 'c', mensagemId: 'm', respostaId: 'r' }), { status: 202 })
    })
    assert.equal(r.conversaId, 'c')
    assert.equal(visto!.url, '/api/operations/assistente/mensagens')
    assert.equal(visto!.init?.method, 'POST')
    assert.equal((visto!.init?.headers as Record<string, string>)['Content-Type'], 'application/json')
    assert.equal(JSON.parse(String(visto!.init?.body)).texto.length, 2000)
  })
  it('429 com teto vira ErroDoAssistente classificado', async () => {
    await assert.rejects(
      enviar({ texto: 'oi', contexto: { pagina: 'hoje' } }, async () => new Response(JSON.stringify({ error: 'teto', teto: true }), { status: 429 })),
      (e: unknown) => e instanceof ErroDoAssistente && e.tipo === 'teto' && e.status === 429
    )
  })
  it('sem rede é `rede`', async () => {
    await assert.rejects(lerConversa('c', undefined, async () => { throw new TypeError('Failed to fetch') }), (e: unknown) => e instanceof ErroDoAssistente && e.tipo === 'rede')
  })
  it('lerConversa: sem desde lê tudo; com desde, só o que veio depois', async () => {
    const urls: string[] = []
    const b = async (url: string) => { urls.push(url); return new Response(JSON.stringify({ conversaId: 'c', mensagens: [], pendente: null })) }
    await lerConversa('a/b', undefined, b)
    await lerConversa('a/b', 3, b)
    assert.deepEqual(urls, ['/api/operations/assistente/conversas/a%2Fb', '/api/operations/assistente/conversas/a%2Fb?desde=3'])
  })
})

/** Relógio falso: `agendar` guarda a rodada; `tique()` roda a próxima e espera ela assentar. */
function relogio() {
  const fila: Array<() => void> = []
  return {
    agendar: (fn: () => void) => {
      fila.push(fn)
      return () => {
        const i = fila.indexOf(fn)
        if (i >= 0) fila.splice(i, 1)
      }
    },
    pendentes: () => fila.length,
    async tique() {
      fila.shift()?.()
      await new Promise((r) => setImmediate(r))
    },
  }
}
const assentar = () => new Promise((r) => setImmediate(r))
const conversa = (mensagens: MensagemDoAssistente[], pendente: boolean): ConversaDoAssistente => ({
  conversaId: 'c',
  mensagens,
  pendente: pendente ? { respostaId: 'r', etapa: 'pensando', desde: '2026-10-17T11:00:00.000Z' } : null,
})

describe('assistente: acompanhamento', () => {
  it('pergunta enquanto há pendente, com o desde do maior n, e para quando a resposta chega', async () => {
    const r = relogio()
    const pedidos: Array<number | undefined> = []
    const respostas = [conversa([msg(1, 'oi', 'romulo')], true), conversa([], true), conversa([msg(2)], false)]
    let terminou = false
    const recebidas: number[] = []
    acompanhar('c', undefined, (c) => recebidas.push(c.mensagens.length), {
      agendar: r.agendar,
      ouvirVisibilidade: () => () => {},
      buscar: async (_id, desde) => { pedidos.push(desde); return respostas.shift()! },
      aoTerminar: () => { terminou = true },
    })
    await assentar()
    assert.deepEqual(pedidos, [undefined])
    await r.tique()
    await r.tique()
    assert.deepEqual(pedidos, [undefined, 1, 1])
    assert.deepEqual(recebidas, [1, 0, 1])
    assert.equal(terminou, true)
    assert.equal(r.pendentes(), 0)
  })

  it('aba escondida não pergunta; volta a perguntar ao mostrar', async () => {
    const r = relogio()
    let visivel = false
    let aoMostrar: (() => void) | null = null
    let chamadas = 0
    acompanhar('c', 0, () => {}, {
      agendar: r.agendar,
      visivel: () => visivel,
      ouvirVisibilidade: (fn) => { aoMostrar = fn; return () => { aoMostrar = null } },
      buscar: async () => { chamadas += 1; return conversa([], false) },
    })
    await assentar()
    assert.equal(chamadas, 0)
    visivel = true
    aoMostrar!()
    await assentar()
    assert.equal(chamadas, 1)
    assert.equal(aoMostrar, null, 'para de escutar a aba quando termina')
  })

  it('parar() cancela a próxima rodada e ignora a resposta em voo', async () => {
    const r = relogio()
    let soltar: (c: ConversaDoAssistente) => void = () => {}
    let recebeu = 0
    const a = acompanhar('c', 0, () => { recebeu += 1 }, {
      agendar: r.agendar,
      ouvirVisibilidade: () => () => {},
      buscar: () => new Promise((ok) => { soltar = ok }),
    })
    a.parar()
    soltar(conversa([msg(1)], true))
    await assentar()
    assert.equal(recebeu, 0)
    assert.equal(r.pendentes(), 0)
  })

  it('404 desiste na hora; rede desiste na terceira seguida', async () => {
    const r = relogio()
    const falhas: string[] = []
    acompanhar('c', 0, () => {}, {
      agendar: r.agendar,
      ouvirVisibilidade: () => () => {},
      buscar: async () => { throw new ErroDoAssistente('outro', 'não existe', 404) },
      aoFalhar: (e) => falhas.push(`${e.status}`),
    })
    await assentar()
    assert.deepEqual(falhas, ['404'])
    assert.equal(r.pendentes(), 0)

    let tentativas = 0
    acompanhar('c', 0, () => {}, {
      agendar: r.agendar,
      ouvirVisibilidade: () => () => {},
      buscar: async () => { tentativas += 1; throw new ErroDoAssistente('rede', 'sem rede') },
      aoFalhar: (e) => falhas.push(e.tipo),
    })
    await assentar()
    await r.tique()
    await r.tique()
    assert.equal(tentativas, 3)
    assert.deepEqual(falhas, ['404', 'rede'])
  })

  it('desiste depois do máximo de rodadas pendentes', async () => {
    const r = relogio()
    const falhas: string[] = []
    acompanhar('c', 0, () => {}, {
      agendar: r.agendar,
      maximoDeRodadas: 2,
      ouvirVisibilidade: () => () => {},
      buscar: async () => conversa([], true),
      aoFalhar: (e) => falhas.push(e.tipo),
    })
    await assentar()
    await r.tique()
    await r.tique()
    assert.deepEqual(falhas, ['outro'])
  })
})

// Fase 2 (17/10/2026): o gasto falado vira cartão NA ABA, por regra fixa, e nunca vai ao servidor do
// Assistente; só o toque grava, pela rota das finanças.
describe('assistente: o gasto falado fica na aba', () => {
  const casos: Array<[string, { centavos: number; onde: string } | null]> = [
    ['gastei 30 no mercado', { centavos: 3000, onde: 'mercado' }],
    ['paguei R$ 45,90 na farmácia', { centavos: 4590, onde: 'farmácia' }],
    ['quanto gastei esse mês?', null],
    ['o que respondo para a Kulniski?', null],
  ]
  for (const [texto, esperado] of casos) it(`gastoDoTexto(${JSON.stringify(texto)})`, () => assert.deepEqual(gastoDoTexto(texto), esperado))

  it('textoDoValor: o valor só na tela, no formato do real', () => {
    assert.equal(textoDoValor(120050).replace(/\s/g, ' '), 'R$ 1.200,50')
  })

  const msg = (n: number): MensagemDoAssistente => ({ id: `m${n}`, n, autor: n % 2 ? 'romulo' : 'assistente', texto: `t${n}`, quando: '2026-10-17T14:00:00Z', fontes: [], cartoes: [] })
  const gasto = (id: string, depoisDe: number): GastoNaTela => ({ id, texto: 'gastei 30 no mercado', gasto: { centavos: 3000, onde: 'mercado' }, depoisDe, estado: 'proposto' })

  it('linhaDoTempo: cada gasto logo depois da mensagem que já estava na tela, na ordem escrita', () => {
    const itens = linhaDoTempo([msg(2), msg(1), msg(3)], [gasto('a', 0), gasto('b', 2), gasto('c', 2), gasto('d', 9)])
    assert.deepEqual(itens.map((i) => i.chave), ['g:a', 'm:1', 'm:2', 'g:b', 'g:c', 'm:3', 'g:d'])
  })

  it('mandar uma frase de gasto não chama rede nenhuma; o toque grava só pela rota das finanças', async () => {
    const original = globalThis.fetch
    const chamadas: Array<{ url: string; corpo: any }> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null })
      return new Response(JSON.stringify({ ok: true, categoria: 'Mercado', novo: true, texto: 'Anotado: Mercado' }), { status: 200 })
    }) as typeof fetch
    try {
      const as = useAssistente()
      as.novaConversa()
      assert.equal(await as.mandar('gastei 30 no mercado', { pagina: 'hoje' }), true)
      assert.equal(chamadas.length, 0, 'nada vai ao servidor do Assistente')
      assert.equal(as.gastos.value.length, 1)
      const g = as.gastos.value[0]
      assert.equal(g.estado, 'proposto')
      await as.anotarGasto(g.id)
      assert.deepEqual(chamadas, [{ url: '/api/financas/gasto', corpo: { texto: 'gastei 30 no mercado', origem: g.id } }])
      assert.equal(as.gastos.value[0].estado, 'confirmado')
      assert.equal(as.gastos.value[0].resultado, 'Anotado: Mercado')
      await as.anotarGasto(g.id)
      assert.equal(chamadas.length, 1, 'cartão feito não grava de novo')
      as.novaConversa()
      assert.equal(as.gastos.value.length, 0)
    } finally {
      globalThis.fetch = original
    }
  })

  it('gravarGasto: o erro do servidor volta como texto', async () => {
    const buscar = async () => new Response(JSON.stringify({ error: 'Não reconheci um gasto.' }), { status: 400 })
    await assert.rejects(gravarGasto('x', 'abcdefgh-1', buscar), /Não reconheci um gasto/)
  })
})
