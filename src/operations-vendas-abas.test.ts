import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ABAS_DE_VENDAS, ENDERECO_DO_ROTEIRO, SECOES_DE_ENTENDER, abaDaVista, enderecoDeVendas, lerEnderecoDeVendas, vistaDaAba,
} from './operations/vendas-abas.ts'

describe('abas de Vendas na ordem do trabalho', () => {
  it('Fazer → Triar → Entender, e Entender tem Funil, Números e Resultados', () => {
    assert.deepEqual(ABAS_DE_VENDAS.map((a) => a.id), ['afazer', 'triagem', 'entender'])
    assert.deepEqual(ABAS_DE_VENDAS.map((a) => a.rotulo), ['Conversas para você', 'Primeiros contatos', 'Entender'])
    assert.deepEqual(SECOES_DE_ENTENDER.map((s) => s.id), ['funil', 'numeros', 'resultados'])
  })

  it('cada vista cai na sua aba; Entender volta à última seção aberta', () => {
    assert.equal(abaDaVista('afazer'), 'afazer')
    assert.equal(abaDaVista('triagem'), 'triagem')
    for (const v of ['funil', 'numeros', 'resultados'] as const) assert.equal(abaDaVista(v), 'entender')
    assert.equal(vistaDaAba('entender'), 'funil')
    assert.equal(vistaDaAba('entender', 'resultados'), 'resultados')
    assert.equal(vistaDaAba('entender', 'afazer'), 'funil')
    assert.equal(vistaDaAba('triagem', 'numeros'), 'triagem')
  })
})

describe('lerEnderecoDeVendas: os links de antes continuam abrindo o mesmo lugar', () => {
  const vista = (busca: string) => {
    const l = lerEnderecoDeVendas(busca)
    return l.tipo === 'vendas' ? l.vista : l.para
  }

  it('?ver= de cada vista, e o vazio ou desconhecido na A fazer', () => {
    assert.equal(vista(''), 'afazer')
    assert.equal(vista('?ver=qualquer'), 'afazer')
    assert.equal(vista('?ver=triagem'), 'triagem')
    assert.equal(vista('?ver=funil'), 'funil')
    assert.equal(vista('?ver=numeros'), 'numeros')
    assert.equal(vista('?ver=resultados'), 'resultados')
  })

  it('?ver=jornada cai no Funil com o passo; o passo fora do Funil não vale', () => {
    const l = lerEnderecoDeVendas('?ver=jornada&passo=raio-x')
    assert.deepEqual(l, { tipo: 'vendas', vista: 'funil', produto: null, passo: 'raio-x', lead: null })
    const fora = lerEnderecoDeVendas('?ver=numeros&passo=raio-x')
    assert.equal(fora.tipo === 'vendas' && fora.passo, null)
  })

  it('?ver=roteiro e ?ver=colinha vão para o Roteiro no Mais', () => {
    assert.deepEqual(lerEnderecoDeVendas('?ver=roteiro'), { tipo: 'roteiro', para: ENDERECO_DO_ROTEIRO })
    assert.deepEqual(lerEnderecoDeVendas('?ver=colinha&lead=x'), { tipo: 'roteiro', para: '/mais?abrir=roteiro' })
  })

  it('?lead= e ?produto= passam em qualquer vista', () => {
    assert.deepEqual(lerEnderecoDeVendas('?lead=site-42'), { tipo: 'vendas', vista: 'afazer', produto: null, passo: null, lead: 'site-42' })
    assert.deepEqual(lerEnderecoDeVendas('?ver=resultados&produto=prumo'), { tipo: 'vendas', vista: 'resultados', produto: 'prumo', passo: null, lead: null })
  })
})

describe('enderecoDeVendas: o que a tela escreve de volta', () => {
  it('a A fazer é /crm; o resto leva ?ver=; "todos" não vai', () => {
    assert.equal(enderecoDeVendas({ vista: 'afazer' }), '/crm')
    assert.equal(enderecoDeVendas({ vista: 'afazer', produto: 'todos', lead: 'a b' }), '/crm?lead=a+b')
    assert.equal(enderecoDeVendas({ vista: 'resultados', produto: 'site' }), '/crm?ver=resultados&produto=site')
    assert.equal(enderecoDeVendas({ vista: 'funil', passo: 'raio-x' }), '/crm?ver=funil&passo=raio-x')
    assert.equal(enderecoDeVendas({ vista: 'numeros', passo: 'raio-x' }), '/crm?ver=numeros')
  })

  it('ida e volta: ler o que se escreveu dá a mesma vista', () => {
    for (const v of ['afazer', 'triagem', 'funil', 'numeros', 'resultados'] as const) {
      const l = lerEnderecoDeVendas(enderecoDeVendas({ vista: v, lead: 'x' }).replace('/crm', ''))
      assert.equal(l.tipo === 'vendas' && l.vista, v)
    }
  })

  it('os href das abas abrem a aba certa', () => {
    for (const a of ABAS_DE_VENDAS) {
      const l = lerEnderecoDeVendas(a.href.replace('/crm', ''))
      assert.equal(l.tipo === 'vendas' && abaDaVista(l.vista), a.id)
    }
  })
})
