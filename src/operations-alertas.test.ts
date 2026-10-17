import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RETRATO_VELHO_MS,
  linkExterno,
  quantidadeDaFila,
  remedioEmComum,
  juntarContainers,
  resumoDoDell,
  semFraseCortada,
  seloDoPasso,
  separarAlertas,
  soNoDell,
} from './operations/alertas.ts'
import type { DellCheck, DellStatus } from './operations/types.ts'

const c = (id: string, estado: DellCheck['estado'], extra: Partial<DellCheck> = {}): DellCheck => ({
  id, grupo: 'fluxos', nome: id, estado, detalhe: '', ...extra,
})

describe('separarAlertas', () => {
  it('vermelho nunca se esconde, fila é do CRM e o que resolve sozinho fica à parte', () => {
    const a = separarAlertas([
      c('ok', 'ok'),
      c('balcao', 'falha'),
      c('falha-sozinha', 'falha', { sozinho: true }),
      c('pend:site-enviar', 'atencao', { grupo: 'pendencias' }),
      c('pend:site-resposta', 'atencao', { grupo: 'pendencias', sozinho: true }),
      c('cacador', 'atencao', { sozinho: true }),
      c('cofre', 'atencao', { grupo: 'dados' }),
    ])
    assert.deepEqual(a.falhas.map(x => x.id), ['balcao', 'falha-sozinha'])
    assert.deepEqual(a.fila.map(x => x.id), ['pend:site-enviar'])
    assert.deepEqual(a.olhar.map(x => x.id), ['cofre'])
    assert.deepEqual(a.sozinhos.map(x => x.id), ['pend:site-resposta', 'cacador'])
  })
})

describe('links e filas', () => {
  it('loopback só abre no Dell; rota da Central abre aqui', () => {
    assert.equal(soNoDell('http://127.0.0.1:5679/workflow/1'), true)
    assert.equal(soNoDell('https://docs.google.com/spreadsheets/d/x'), false)
    assert.equal(soNoDell('/crm?produto=site'), false)
    assert.equal(linkExterno('/crm'), false)
    assert.equal(linkExterno('https://x.invalid/'), true)
  })

  it('conta a fila pelo começo do detalhe', () => {
    assert.equal(quantidadeDaFila(c('pend:site-enviar', 'atencao', { grupo: 'pendencias', detalhe: '53 · Clique no wa_link' })), 53)
    assert.equal(quantidadeDaFila(c('pend:sites-fila', 'atencao', { grupo: 'pendencias', detalhe: '14 lead(s) com pasta' })), 14)
    assert.equal(quantidadeDaFila(c('pend:x', 'ok', { grupo: 'pendencias', detalhe: 'nada' })), null)
    assert.equal(quantidadeDaFila(undefined), null)
  })

  it('selo do passo diz o estado por texto', () => {
    assert.deepEqual(seloDoPasso(c('x', 'falha')), { texto: 'Falhou agora', tom: 'falha' })
    assert.deepEqual(seloDoPasso(c('x', 'atencao', { sozinho: true })), { texto: 'Resolve sozinho', tom: 'sozinho' })
    assert.equal(seloDoPasso(c('x', 'ok')), null)
  })
})

describe('remedioEmComum', () => {
  it('junta falhas que pedem o mesmo gesto', () => {
    const cred = 'Reconecte a credencial "Google Sheets account" no n8n (Credentials › abrir › Reconnect, com a conta do Google).'
    const falhas = [
      c('balcao', 'falha', { oQueFazer: `${cred} Depois disso, a próxima rodada volta sozinha.` }),
      c('wa', 'falha', { oQueFazer: `${cred} Depois disso, clique em Retry.` }),
      c('hermes', 'falha', { oQueFazer: 'O Hermes parou.' }),
    ]
    assert.deepEqual(remedioEmComum(falhas), { texto: cred, quantas: 2 })
    assert.equal(remedioEmComum(falhas.slice(1)), null)
  })
})

describe('resumoDoDell: um número só no topo, na Hoje e no Mais (AC-17)', () => {
  const FUSO = 'America/Sao_Paulo'
  // 08:15 em Brasília.
  const GERADO = '2026-10-17T11:15:00.000Z'
  const AGORA = Date.parse(GERADO) + 60_000
  const retrato = (verificacoes: DellCheck[], geradoEm: string | null = GERADO): DellStatus => ({ geradoEm, verificacoes })
  const oks = (n: number, grupo: DellCheck['grupo'] = 'servicos') => Array.from({ length: n }, (_, i) => c(`ok${i}`, 'ok', { grupo }))

  const casos: Array<{
    nome: string
    status: DellStatus | null
    agora?: number
    semNoticia: boolean
    precisam: number
    sozinhas: number
    filas: number
    textoPrecisam: string
    topo: string
    mais: string
  }> = [
    {
      nome: 'sem retrato nenhum: não sabe, nunca zero',
      status: null,
      semNoticia: true, precisam: 0, sozinhas: 0, filas: 0,
      textoPrecisam: 'Sem notícia do Dell', topo: 'pendente Sem notícia do Dell ', mais: 'Sem notícia do Dell',
    },
    {
      nome: 'retrato sem horário',
      status: retrato(oks(3), null),
      semNoticia: true, precisam: 0, sozinhas: 0, filas: 0,
      textoPrecisam: 'Sem notícia do Dell', topo: 'pendente Sem notícia do Dell ', mais: 'Sem notícia do Dell · no último retrato, 3 de 3 ok',
    },
    {
      nome: 'retrato velho (mais de 5 min): diz desde quando, e a contagem é do último retrato',
      status: retrato([...oks(2), c('balcao', 'falha')]),
      agora: Date.parse(GERADO) + RETRATO_VELHO_MS + 1,
      semNoticia: true, precisam: 1, sozinhas: 0, filas: 0,
      textoPrecisam: 'Sem notícia do Dell desde 08:15',
      topo: 'pendente Sem notícia do Dell desde 08:15',
      mais: 'Sem notícia do Dell desde 08:15 · no último retrato, 2 de 3 ok · 1 precisa de você',
    },
    {
      nome: 'tudo ok',
      status: retrato(oks(4)),
      semNoticia: false, precisam: 0, sozinhas: 0, filas: 0,
      textoPrecisam: 'Nada no Dell precisa de você', topo: 'ok Dell: tudo certo às 08:15', mais: '4 de 4 ok',
    },
    {
      nome: 'só falhas (inclusive a marcada "sozinho": vermelho nunca se esconde)',
      status: retrato([...oks(2), c('balcao', 'falha'), c('wa', 'falha', { sozinho: true })]),
      semNoticia: false, precisam: 2, sozinhas: 0, filas: 0,
      textoPrecisam: '2 falhas precisam de você', topo: 'falha 2 precisam de você às 08:15', mais: '2 de 4 ok · 2 precisam de você',
    },
    {
      nome: 'só filas do CRM: não é saúde, não entra no número do Dell',
      status: retrato([
        ...oks(2),
        c('pend:site-enviar', 'atencao', { grupo: 'pendencias' }),
        c('pend:prumo-revisar', 'atencao', { grupo: 'pendencias' }),
        c('pend:sites-fila', 'atencao', { grupo: 'pendencias', sozinho: true }),
        c('pend:vazia', 'ok', { grupo: 'pendencias' }),
      ]),
      semNoticia: false, precisam: 0, sozinhas: 0, filas: 2,
      textoPrecisam: 'Nada no Dell precisa de você', topo: 'ok Dell: tudo certo às 08:15', mais: '2 de 2 ok',
    },
    {
      nome: 'só o que resolve sozinho',
      status: retrato([...oks(1), c('healthwatch', 'atencao', { sozinho: true }), c('pncp', 'atencao', { grupo: 'dados', sozinho: true })]),
      semNoticia: false, precisam: 0, sozinhas: 2, filas: 0,
      textoPrecisam: 'Nada no Dell precisa de você', topo: 'ok Dell: tudo certo às 08:15', mais: '1 de 3 ok · 2 resolvem sozinhas',
    },
    {
      nome: 'mistura do 17/10: 43 de 49 ok · 3 precisam de você · 3 resolvem sozinhas',
      status: retrato([
        ...oks(43),
        c('fila-avisos', 'falha'),
        c('p4f', 'falha', { grupo: 'containers' }),
        c('cofre', 'atencao', { grupo: 'dados' }),
        c('healthwatch', 'atencao', { sozinho: true }),
        c('pncp', 'atencao', { grupo: 'dados', sozinho: true }),
        c('espelho', 'atencao', { grupo: 'dados', sozinho: true }),
        c('pend:site-enviar', 'atencao', { grupo: 'pendencias' }),
        c('pend:site-resposta', 'atencao', { grupo: 'pendencias', sozinho: true }),
      ]),
      semNoticia: false, precisam: 3, sozinhas: 3, filas: 1,
      textoPrecisam: '2 falhas e 1 aviso precisam de você',
      topo: 'falha 3 precisam de você às 08:15',
      mais: '43 de 49 ok · 3 precisam de você · 3 resolvem sozinhas',
    },
    {
      nome: 'um aviso só (amarelo sem "sozinho"): singular e tom de atenção',
      status: retrato([...oks(1), c('cofre', 'atencao', { grupo: 'dados' })]),
      semNoticia: false, precisam: 1, sozinhas: 0, filas: 0,
      textoPrecisam: '1 aviso precisa de você', topo: 'pendente 1 precisa de você às 08:15', mais: '1 de 2 ok · 1 precisa de você',
    },
  ]

  for (const caso of casos) {
    it(caso.nome, () => {
      const r = resumoDoDell(caso.status, caso.agora ?? AGORA, FUSO)
      assert.equal(r.semNoticia, caso.semNoticia)
      assert.equal(r.precisam.length, caso.precisam)
      assert.equal(r.sozinhas.length, caso.sozinhas)
      assert.equal(r.filas.length, caso.filas)
      assert.equal(r.textoPrecisam, caso.textoPrecisam)
      assert.equal(`${r.topo.tom} ${r.topo.texto} ${r.topo.quando}`, caso.topo)
      assert.equal(r.textoDoMais, caso.mais)
      // O "N de M ok" do Mais bate com o que a Hoje e o topo dizem.
      assert.equal(r.total - r.ok, r.precisam.length + r.sozinhas.length)
    })
  }
})

describe('juntarContainers: o container parado é detalhe da verificação "Containers"', () => {
  const resumo = c('containers', 'atencao', { grupo: 'containers', nome: 'Containers', desde: '2026-10-14T18:26:36Z' })
  const a = c('container:p4f-a', 'falha', { grupo: 'containers', desde: '2026-10-14T18:31:06Z' })
  const b = c('container:p4f-b', 'falha', { grupo: 'containers', desde: '2026-10-14T18:26:36Z' })
  const ok = c('container:outro', 'ok', { grupo: 'containers' })

  it('o caso de 17/10: dois parados e a resumo amarela viram uma linha vermelha "Containers"', () => {
    const r = juntarContainers([resumo, a, b, ok, c('fila', 'falha')])
    assert.deepEqual(r.map((x) => x.id), ['containers', 'fila'])
    assert.equal(r[0].nome, 'Containers')
    assert.equal(r[0].estado, 'falha')
    assert.equal(r[0].desde, '2026-10-14T18:26:36Z')
  })
  it('tudo ok continua ok; sem a resumo, os individuais ficam como vieram', () => {
    assert.equal(juntarContainers([c('containers', 'ok'), c('container:x', 'ok')])[0].estado, 'ok')
    assert.deepEqual(juntarContainers([a, b]).map((x) => x.id), ['container:p4f-a', 'container:p4f-b'])
  })
  it('no resumoDoDell conta uma vez: 3 precisam de você, não 5', () => {
    const status: DellStatus = { geradoEm: '2026-10-17T11:15:00Z', verificacoes: [resumo, a, b, c('backup', 'atencao'), c('fila', 'falha')] }
    const r = resumoDoDell(status, Date.parse('2026-10-17T11:16:00Z'), 'America/Sao_Paulo')
    assert.equal(r.precisam.length, 3)
    assert.equal(r.total - r.ok, r.precisam.length + r.sozinhas.length)
    assert.ok(!r.precisam.some((x) => x.nome.startsWith('p4f-')))
  })
})

describe('semFraseCortada', () => {
  it('texto cortado no meio da palavra volta até a última frase inteira', () => {
    const cortado = 'Algum script gravou um aviso fora do formato. Peça ao Claude: "aviso recusado na fila do dell-status". Depois dê o visto; ele vai par'
    assert.equal(semFraseCortada(cortado), 'Algum script gravou um aviso fora do formato. Peça ao Claude: "aviso recusado na fila do dell-status".')
  })
  it('texto inteiro passa como veio; sem frase inteira nenhuma, também', () => {
    assert.equal(semFraseCortada('O Hermes parou.'), 'O Hermes parou.')
    assert.equal(semFraseCortada('Rode `dell-status --instalados`'), 'Rode `dell-status --instalados`')
    assert.equal(semFraseCortada('sem ponto nenhum'), 'sem ponto nenhum')
  })
})
