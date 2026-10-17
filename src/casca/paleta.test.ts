import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { comandosDaPaleta, filtrarComandos, type Capacidades } from './destinos.ts'
import { LIMITE_DE_LEADS, comandosDeLeads, reaberturaDepoisDeIr, type LeadDaPaleta } from './paleta.ts'

const DELL: Capacidades = { perfil: 'operations', agentes: false }
const EASYPANEL: Capacidades = { perfil: 'app', agentes: true }

const lead = (id: string, empresa: string, oferta = 'Site antes da venda', etapa = 'Em contato'): LeadDaPaleta => ({ id, empresa, oferta, etapa })
const LEADS = [
  lead('s-1', 'Padaria do Zé'),
  lead('s-2', 'Clínica Sorriso', 'Iris · Clínicas', 'Novo'),
  lead('s-3', 'Zé Pneus'),
  lead('s-4', 'Estamparia Arte & Cor', 'CRM de estamparia', 'Proposta'),
]
const ids = (cmds: Array<{ id: string }>) => cmds.map((c) => c.id)

describe('paleta: abas e dicas (AC-23)', () => {
  it('no Dell, "triagem" acha a aba de Vendas, e as abas não existem no Easypanel', () => {
    assert.deepEqual(ids(filtrarComandos(comandosDaPaleta(DELL, [], null), 'triagem')), ['aba:vendas-triagem'])
    assert.equal(filtrarComandos(comandosDaPaleta(EASYPANEL, [], null), 'triagem').length, 0)
  })

  it('o Roteiro e a Manutenção levam ao Mais pelo ?abrir=', () => {
    const cmds = comandosDaPaleta(DELL, [], null)
    const href = (id: string) => { const a = cmds.find((c) => c.id === id)?.acao; return a?.tipo === 'ir' ? a.href : null }
    assert.equal(href('aba:mais-roteiro'), '/mais?abrir=roteiro')
    assert.equal(href('aba:mais-manutencao'), '/mais?abrir=manutencao')
    assert.equal(href('aba:vendas-funil'), '/crm?ver=funil')
    assert.equal(href('aba:financas-lancamentos'), '/financas/lancamentos')
  })

  it('nenhuma dica é um caminho cru', () => {
    for (const c of [...comandosDaPaleta(DELL, [], null), ...comandosDaPaleta({ perfil: 'operations', agentes: true }, [{ id: 'a', nome: 'A' }], null)]) {
      assert.ok(!c.dica.startsWith('/'), `${c.id}: ${c.dica}`)
    }
    assert.equal(comandosDaPaleta(DELL, [], null).find((c) => c.id === 'aba:vendas-triagem')?.dica, 'Vendas › Triagem')
  })
})

describe('comandosDeLeads', () => {
  const casos: Array<[string, string, string[]]> = [
    ['sem acento nem caixa', 'CLINICA', ['lead:s-2']],
    ['acento no termo também', 'clínica', ['lead:s-2']],
    ['prefixo de palavra, em qualquer palavra', 'pne', ['lead:s-3']],
    ['meio de palavra não conta', 'adaria', []],
    ['todas as palavras, cada uma prefixo de alguma', 'ze pad', ['lead:s-1']],
    ['quem começa pelo termo vem primeiro', 'ze', ['lead:s-3', 'lead:s-1']],
    ['símbolo no nome não atrapalha', 'arte cor', ['lead:s-4']],
    ['termo vazio não lista leads', '   ', []],
  ]
  for (const [nome, termo, esperado] of casos) {
    it(nome, () => assert.deepEqual(ids(comandosDeLeads(LEADS, termo, 'operations')), esperado))
  }

  it('mostra "Empresa · Oferta · Etapa" e leva à Ficha pelo id, sem o id no texto', () => {
    const [c] = comandosDeLeads([lead('a b/1', 'Clínica Sorriso', 'Iris · Clínicas', 'Novo')], 'sorriso', 'operations')
    assert.equal(c.rotulo, 'Clínica Sorriso')
    assert.equal(c.dica, 'Iris · Clínicas · Novo')
    assert.deepEqual(c.acao, { tipo: 'ir', href: '/crm?lead=a%20b%2F1' })
    assert.ok(!`${c.rotulo} ${c.dica}`.includes('a b/1'))
  })

  it('para no limite', () => {
    const muitos = Array.from({ length: 20 }, (_, i) => lead(`x-${i}`, `Barbearia ${i}`))
    assert.equal(comandosDeLeads(muitos, 'barb', 'operations').length, LIMITE_DE_LEADS)
    assert.equal(comandosDeLeads(muitos, 'barb', 'operations', 3).length, 3)
  })

  it('no perfil app não há leads, mesmo com a lista cheia', () => {
    assert.deepEqual(comandosDeLeads(LEADS, 'ze', 'app'), [])
  })
})

describe('reaberturaDepoisDeIr', () => {
  const casos: Array<[string, string, ReturnType<typeof reaberturaDepoisDeIr>]> = [
    ['/crm', '/crm?lead=s-1', 'popstate'],
    ['/crm?ver=funil', '/crm?ver=triagem', 'popstate'],
    ['/crm?ver=triagem', '/crm?ver=triagem', 'nada'],
    ['/', '/crm?lead=s-1', 'nada'],
    ['/mais', '/mais?abrir=manutencao', 'remontar'],
    ['/mais/', '/mais?abrir=roteiro', 'remontar'],
    ['/financas', '/financas/lancamentos', 'nada'],
  ]
  for (const [de, para, esperado] of casos) {
    it(`${de} -> ${para}: ${esperado}`, () => assert.equal(reaberturaDepoisDeIr(de, para), esperado))
  }
})
