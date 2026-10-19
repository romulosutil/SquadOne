import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cabeProposta, gostouDepoisDoLink, propostaDeUmToque } from './operations/mandar-proposta.ts'
import { filaDeVenda } from './operations/proxima-venda.ts'
import { lacunasDoSpiced, lerRegistroSpiced, lerSpiced, qualificadoParaProposta, spicedVazio, textoDoRegistroSpiced, type Spiced } from './operations/spiced.ts'
import type { CrmLead, CrmProduto } from './operations/types.ts'

const AGORA = Date.parse('2026-10-19T15:00:00Z')
const qualificado = (): Spiced => ({ ...spicedVazio(), dor: 'perde pedidos no WhatsApp', impacto: 'precisa refazer os pedidos', decisao: { decisor_confirmado: 'sim', quem: 'a dona', como_paga: '' } })
function lead(produto: CrmProduto): CrmLead {
  return { id: `${produto}:teste`, chave: 'teste', produto, empresa: 'Empresa exemplo', etapa: 'contato', sinal: 'respondeu',
    nicho: 'teste', cidade: 'Vitória', respostaNova: true, marcos: { segundaEnviada: '2026-10-19T12:00:00Z' },
    resposta: { tipo: 'interesse', trecho: 'gostei, quanto fica?', em: '2026-10-19T14:00:00Z' },
    links: { whatsapp: 'https://wa.me/5527999990000' }, plus: produto === 'plus' ? { oferta: 'site', fixo: false, descricao: '' } : undefined,
  } as CrmLead
}

describe('SPICED: proposta apenas com dor, impacto e decisor confirmados', () => {
  for (const produto of ['site', 'prumo', 'iris', 'estampa', 'plus'] as const) {
    for (let bits = 0; bits < 8; bits++) {
      it(`${produto}: P/I/D ${bits.toString(2).padStart(3, '0')}`, () => {
        const s = qualificado()
        if (!(bits & 1)) s.dor = ''
        if (!(bits & 2)) s.impacto = ''
        if (!(bits & 4)) s.decisao.decisor_confirmado = 'nao-sei'
        const l = { ...lead(produto), spiced: s }
        assert.equal(qualificadoParaProposta(l), bits === 7)
        assert.equal(gostouDepoisDoLink(l), bits === 7)
        assert.equal(cabeProposta(l), bits === 7)
        assert.equal(Boolean(propostaDeUmToque(l)), bits === 7)
        const fila = filaDeVenda({ hoje: [], leads: [l] }, { primeiroLiberado: false, agora: AGORA })
        assert.equal(fila.some(a => a.tipo === 'mandar-proposta'), bits === 7)
        if (bits !== 7) {
          assert.match(fila[0]?.titulo ?? '', /Marque 10 minutos/)
          assert.equal(fila[0].anota, undefined)
          assert.ok(fila[0].tatica.includes('?'))
        }
      })
    }
  }

  it('Plus respeita a oferta própria; Iris e Estamparia não herdam o preço do Site', () => {
    for (const oferta of ['iris', 'estampa'] as const) {
      const l = { ...lead('plus'), spiced: qualificado(), plus: { oferta, fixo: false, descricao: '' } }
      const p = propostaDeUmToque(l, { proposta: { itens: [{ id: 'encontrado', porque: 'modelo sugeriu' }] } })!
      assert.ok(p.completar)
      assert.doesNotMatch(p.texto, /690|Encontrado/)
      if (oferta === 'iris') {
        assert.match(p.texto, /R\$ 39/)
        assert.match(p.texto, /R\$ 32/)
        assert.match(p.texto, /R\$ 25/)
        assert.match(p.texto, /faixas marginais/)
      } else {
        assert.doesNotMatch(p.texto, /R\$/)
        assert.match(p.texto, /condições aprovadas do catálogo/)
      }
    }
  })

  it('recepção ou robô da conversa atual não recebe proposta apesar da qualificação anterior', () => {
    for (const papel of ['recepcao', 'robo'] as const) {
      const l = { ...lead('site'), spiced: qualificado(), conversa: { ultima: { direcao: 'entrada', papel } } } as CrmLead
      assert.equal(gostouDepoisDoLink(l), false)
      assert.equal(cabeProposta(l), false)
      assert.equal(propostaDeUmToque(l), null)
    }
  })

  it('leitura atual do copiloto sobre recepção/robô também impede a proposta na fila', () => {
    for (const quem of ['recepcao', 'robo'] as const) {
      const l = { ...lead('site'), spiced: qualificado() }
      const sugestoes = new Map([[l.id, { mensagem: 'Com quem posso falar?', porque: '', quando: '', momento: { quem, leitura: '', passo: 'Chegar a quem decide' } }]])
      assert.equal(filaDeVenda({ hoje: [], leads: [l] }, { primeiroLiberado: false, agora: AGORA, sugestoes }).some(a => a.tipo === 'mandar-proposta'), false)
    }
  })

  it('o convite para descobrir as lacunas não é trocado por uma proposta do modelo', () => {
    const l = lead('site')
    const sugestoes = new Map([[l.id, { mensagem: 'A proposta custa R$ 999', porque: '', quando: '' }]])
    const fila = filaDeVenda({ hoje: [], leads: [l] }, { primeiroLiberado: false, agora: AGORA, sugestoes })
    assert.match(fila[0].rascunho ?? '', /10 minutos/)
    assert.doesNotMatch(fila[0].rascunho ?? '', /R\$/)
  })
})

describe('SPICED: formato e evidência são preservados', () => {
  it('registro completo faz ida e volta sem converter vazios em fatos', () => {
    assert.deepEqual(lerRegistroSpiced(textoDoRegistroSpiced(qualificado())), qualificado())
    assert.deepEqual(lacunasDoSpiced({}), ['dor', 'impacto', 'decisor confirmado'])
    assert.notEqual(spicedVazio(), spicedVazio())
  })
  for (const data of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-10-32', '19/10/2026']) {
    it(`recusa data impossível ou inválida ${data}`, () => assert.equal(lerSpiced({ ...qualificado(), evento_critico: { fato: 'data informada', data } }), null))
  }
  it('aceita data real bissexta e evento ainda sem data', () => {
    assert.ok(lerSpiced({ ...qualificado(), evento_critico: { fato: 'fato', data: '2024-02-29' } }))
    assert.ok(lerSpiced(spicedVazio()))
  })
  it('recusa schema antigo, enum desconhecido, JSON malformado, campo e total excessivos sem truncar', () => {
    for (const v of [null, [], { dor: 'sugestão sem resto' }, { ...qualificado(), confirmado: true },
      { ...qualificado(), decisao: { ...qualificado().decisao, decisor_confirmado: 'talvez' } },
      { ...qualificado(), dor: 'x'.repeat(201) },
      { ...qualificado(), situacao: 'x'.repeat(200), dor: 'x'.repeat(200), impacto: 'x'.repeat(200), evento_critico: { fato: 'x'.repeat(200), data: '' }, decisao: { decisor_confirmado: 'sim', quem: 'x'.repeat(200), como_paga: 'x'.repeat(200) } },
    ]) assert.equal(lerSpiced(v), null)
    assert.equal(lerRegistroSpiced('{'), null)
    assert.equal(lerRegistroSpiced(textoDoRegistroSpiced(qualificado()) + ' '.repeat(1000)), null)
    assert.throws(() => textoDoRegistroSpiced({ ...qualificado(), dor: 'x'.repeat(201) }), /200 caracteres/)
  })
})
