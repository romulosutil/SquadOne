/**
 * A trava SPICED nas CINCO linhas com o marco REAL do material (auditoria da Fase 2, 19/10/2026).
 * O teste anterior (operations-spiced.test.ts) fixava `marcos.segundaEnviada` em todas e escondia que
 * Iris, Estamparia e o Plus dessas ofertas não têm 2ª mensagem: sem o marco real, nem o "Marque 10
 * minutos" nem a proposta apareciam. Aqui cada linha tem a fixture que o servidor monta de verdade.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cabeProposta, gostouDepoisDoLink, indicouInteresseDepoisDoLink, instanteDoMaterial, propostaDeUmToque } from './operations/mandar-proposta.ts'
import { filaDeVenda } from './operations/proxima-venda.ts'
import { qualificadoParaProposta, spicedVazio, type Spiced } from './operations/spiced.ts'
import type { CrmLead, CrmProduto } from './operations/types.ts'

const AGORA = Date.parse('2026-10-19T15:00:00Z')
const CONVITE = '2026-10-18T12:00:00Z'
const MATERIAL = '2026-10-19T12:00:00Z'
const RESPOSTA = '2026-10-19T14:00:00Z'

interface Linha { nome: string; produto: CrmProduto; oferta?: 'site' | 'prumo' | 'iris' | 'estampa'; materialPor: 'segunda' | 'conversa' }
const LINHAS: Linha[] = [
  { nome: 'site', produto: 'site', materialPor: 'segunda' },
  { nome: 'prumo', produto: 'prumo', materialPor: 'segunda' },
  { nome: 'iris (vídeo visto na conversa)', produto: 'iris', materialPor: 'conversa' },
  { nome: 'estampa (documento visto na conversa)', produto: 'estampa', materialPor: 'conversa' },
  { nome: 'plus oferta site', produto: 'plus', oferta: 'site', materialPor: 'segunda' },
  { nome: 'plus oferta prumo', produto: 'plus', oferta: 'prumo', materialPor: 'segunda' },
  { nome: 'plus oferta iris', produto: 'plus', oferta: 'iris', materialPor: 'conversa' },
  { nome: 'plus oferta estampa', produto: 'plus', oferta: 'estampa', materialPor: 'conversa' },
]

const ultima = { direcao: 'saida' as const, em: MATERIAL, trecho: '[vídeo]' }
type Resposta = { tipo: NonNullable<CrmLead['resposta']>['tipo']; trecho: string }

/** O lead como o servidor o monta, SEM segundaEnviada onde a linha não tem 2ª mensagem: o material é a mídia vista na conversa. */
function lead(l: Linha, resposta: Resposta | null = { tipo: 'interesse', trecho: 'gostei, quanto fica?' }, comMaterial = true): CrmLead {
  return {
    id: `${l.produto}:teste`, chave: 'teste', produto: l.produto, empresa: 'Empresa exemplo', etapa: 'contato', sinal: 'respondeu',
    nicho: 'teste', cidade: 'Vitória', respostaNova: true,
    marcos: { enviado: CONVITE, ...(comMaterial && l.materialPor === 'segunda' ? { segundaEnviada: MATERIAL } : {}) },
    ...(comMaterial ? { conversa: { desde: CONVITE, mensagens: 3, ultima, ultimaSaida: MATERIAL, linkEm: MATERIAL } } : {}),
    ...(resposta ? { resposta: { ...resposta, em: RESPOSTA } } : {}),
    links: { whatsapp: 'https://wa.me/5527999990000' },
    ...(l.produto === 'plus' ? { plus: { oferta: l.oferta!, fixo: false, descricao: '' } } : {}),
  } as CrmLead
}
const spiced = (bits: number, naoSim: 'nao' | 'nao-sei'): Spiced => {
  const s: Spiced = { ...spicedVazio(), dor: 'perde pedidos no WhatsApp', impacto: 'precisa refazer os pedidos', decisao: { decisor_confirmado: 'sim', quem: 'a dona', como_paga: '' } }
  if (!(bits & 1)) s.dor = ''
  if (!(bits & 2)) s.impacto = ''
  if (!(bits & 4)) s.decisao.decisor_confirmado = naoSim
  return s
}
const fila = (x: CrmLead) => filaDeVenda({ hoje: [], leads: [x] }, { primeiroLiberado: false, agora: AGORA })

describe('SPICED nas cinco linhas com o marco real do material', () => {
  for (const l of LINHAS) {
    for (const naoSim of ['nao', 'nao-sei'] as const) {
      for (let bits = 0; bits < 8; bits++) {
        it(`${l.nome}: P/I/D ${bits.toString(2).padStart(3, '0')} (sem decisor = ${naoSim})`, () => {
          const base = lead(l)
          if (l.materialPor === 'conversa') assert.equal(base.marcos.segundaEnviada, undefined, 'a fixture não tem 2ª mensagem')
          const x = { ...base, spiced: spiced(bits, naoSim) }
          assert.equal(qualificadoParaProposta(x), bits === 7)
          assert.equal(indicouInteresseDepoisDoLink(x), true)
          assert.equal(gostouDepoisDoLink(x), bits === 7)
          assert.equal(cabeProposta(x), bits === 7)
          assert.equal(Boolean(propostaDeUmToque(x)), bits === 7)
          const f = fila(x)
          assert.equal(f.some((a) => a.tipo === 'mandar-proposta'), bits === 7)
          if (bits !== 7) {
            assert.match(f[0]?.titulo ?? '', /Marque 10 minutos/)
            assert.equal(f[0].anota, undefined)
            assert.doesNotMatch(f[0].rascunho ?? '', /R\$/)
          }
        })
      }
    }
  }
})

describe('o marco do material', () => {
  it('é o último entre a 2ª mensagem anotada e o link ou a mídia vista na conversa', () => {
    const ms = (v: string) => Date.parse(v)
    assert.ok(Number.isNaN(instanteDoMaterial(lead(LINHAS[2], null, false))))
    assert.equal(instanteDoMaterial({ ...lead(LINHAS[2]), marcos: { enviado: CONVITE } }), ms(MATERIAL))
    assert.equal(instanteDoMaterial({ ...lead(LINHAS[0]), conversa: undefined }), ms(MATERIAL))
    const depois = '2026-10-19T13:00:00Z'
    assert.equal(instanteDoMaterial({ ...lead(LINHAS[0]), conversa: { ...lead(LINHAS[0]).conversa!, linkEm: depois } }), ms(depois))
  })

  it('resposta ANTES do material não é "gostei depois do material" em nenhuma linha', () => {
    // O botão secundário da Ficha (cabeProposta) segue só atrás da qualificação; aqui vale o gatilho do "gostei".
    for (const l of LINHAS) {
      const x = { ...lead(l), resposta: { tipo: 'interesse' as const, trecho: 'gostei', em: '2026-10-19T11:00:00Z' }, spiced: spiced(7, 'nao') }
      assert.equal(indicouInteresseDepoisDoLink(x), false, l.nome)
      assert.equal(gostouDepoisDoLink(x), false, l.nome)
      assert.equal(fila(x).some((a) => a.tipo === 'mandar-proposta'), false, l.nome)
    }
  })

  it('Iris e Estamparia SEM material registrado: o "quero ver" e a licença não abrem qualificação nem proposta', () => {
    for (const l of LINHAS.filter((x) => x.materialPor === 'conversa')) {
      for (const tipo of ['interesse', 'licenca'] as const) {
        const x = { ...lead(l, { tipo, trecho: 'pode mandar sim, quero ver' }, false), spiced: spiced(7, 'nao') }
        assert.equal(indicouInteresseDepoisDoLink(x), false, `${l.nome} ${tipo}`)
        assert.equal(gostouDepoisDoLink(x), false, `${l.nome} ${tipo}`)
        assert.equal(fila(x).some((a) => a.tipo === 'mandar-proposta'), false)
      }
    }
  })

  it('Iris e Estamparia SEM material: só a pergunta de preço depois do convite pede a qualificação, nunca a proposta', () => {
    for (const l of LINHAS.filter((x) => x.materialPor === 'conversa')) {
      const x = lead(l, { tipo: 'neutra', trecho: 'Qual o valor?' }, false)
      assert.equal(indicouInteresseDepoisDoLink(x), true, l.nome)
      const f = fila(x)
      assert.match(f[0]?.titulo ?? '', /Marque 10 minutos/, l.nome)
      assert.equal(f.some((a) => a.tipo === 'mandar-proposta'), false)
      assert.equal(propostaDeUmToque(x), null)
      // com tudo confirmado, a proposta sai (preço só do cardápio)
      assert.equal(Boolean(propostaDeUmToque({ ...x, spiced: spiced(7, 'nao') })), true, l.nome)
      // a licença que traz o preço no texto não conta; a resposta antes do convite também não
      assert.equal(indicouInteresseDepoisDoLink(lead(l, { tipo: 'licenca', trecho: 'pode mandar, quanto custa?' }, false)), false)
      assert.equal(indicouInteresseDepoisDoLink({ ...x, resposta: { ...x.resposta!, em: '2026-10-18T11:00:00Z' } }), false)
    }
  })

  it('Site e PRUMO sem 2ª mensagem não ganham o atalho do preço (só Iris e Estamparia o têm)', () => {
    for (const l of LINHAS.filter((x) => x.materialPor === 'segunda')) {
      assert.equal(indicouInteresseDepoisDoLink(lead(l, { tipo: 'neutra', trecho: 'Qual o valor?' }, false)), false, l.nome)
    }
  })

  it('recepção, robô, proposta já enviada e etapa fora de contato continuam fora', () => {
    for (const l of LINHAS) {
      const base = { ...lead(l), spiced: spiced(7, 'nao') }
      assert.equal(indicouInteresseDepoisDoLink({ ...base, conversa: { ...base.conversa!, ultima: { direcao: 'entrada', em: RESPOSTA, trecho: 'x', papel: 'recepcao' } } }), false, l.nome)
      assert.equal(indicouInteresseDepoisDoLink({ ...base, proposta: { em: RESPOSTA } } as CrmLead), false, l.nome)
      assert.equal(indicouInteresseDepoisDoLink({ ...base, etapa: 'perdido' }), false, l.nome)
    }
  })
})
