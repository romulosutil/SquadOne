import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mensagemDoConvite } from '../server/convite-mensagem.ts'
import { primeiraComEventoCritico } from '../server/site-mensagem.ts'
import { primeiraDoPlus } from '../server/plus-mensagem.ts'
import { classificarResposta, respostaParaAcompanhamento, type ClasseDaResposta } from './operations/classificacao-resposta.ts'
import type { CrmResposta } from './operations/types.ts'

// Contraexemplos sintéticos, não participantes, respostas previstas ou testes de conversão.
const ENVIO = '2026-10-27T11:00:00Z', ENTRADA = '2026-10-27T11:02:00Z'
const aberturas = [
  ['site', primeiraComEventoCritico('Empresa Teste', { raio_x_url: 'https://example.com/analise', raio_x_achados: [{ id: 'site-fora-do-ar', dominio: 'example.com' }] }, true)],
  ...['prumo', 'iris', 'estampa'].map(p => [p, mensagemDoConvite(p, 'Empresa Teste', '', new Date(ENVIO))]),
  ...(['site', 'prumo', 'iris', 'estampa'] as const).map(oferta => [`plus-${oferta}`, primeiraDoPlus({ empresa: 'Empresa Teste', oferta, whatsapp: '5527999990001' }).texto]),
]
const casos: Array<[string, string, ClasseDaResposta]> = [
  ['origem do contato', 'De onde você tirou meu número?', 'neutra'],
  ['desconfiança', 'Isso parece golpe. Não vou abrir nenhum link.', 'neutra'],
  ['fornecedor sem troca', 'Já tenho um sistema e não quero trocar.', 'recusa'],
  ['desinteresse', 'Não tenho interesse, obrigado.', 'recusa'],
  ['parar mensagens', 'Não me mande mais mensagens.', 'recusa'],
  ['exclusão explícita', 'Por favor, apague meu número da lista.', 'exclusao'],
  ['recusa educada do material', 'Não precisa mandar nada. Obrigado.', 'recusa'],
  ['recusa prevalece sobre pode mandar', 'Pode mandar, mas não tenho interesse em contratar agora.', 'recusa'],
  ['pergunta comercial não é compra', 'Quanto custa?', 'interesse'],
  ['aceite do exemplo não é compra', 'Sim', 'permissao'],
  ['cargo não vence recusa', 'Sou o responsável, mas não tenho interesse.', 'recusa'],
  ['restrição de formato', 'Pode explicar sem link?', 'neutra'],
]

describe('aberturas com clientes desconfiados e desinteressados — cenários sintéticos', () => {
  for (const [oferta, abertura] of aberturas) for (const [caso, texto, esperada] of casos) {
    it(`${oferta}: ${caso}`, () => {
      const fonte: CrmResposta = { tipo: 'neutra', trecho: texto, em: ENTRADA }
      const lead = { marcos: { enviado: ENVIO }, resposta: fonte }
      const antes = JSON.stringify(lead)
      const mensagens = [
        { em: ENVIO, direcao: 'saida' as const, texto: abertura },
        { em: ENTRADA, direcao: 'entrada' as const, texto, papel: 'gente' },
      ]
      const leitura = classificarResposta(lead, mensagens)
      assert.equal(leitura.classe, esperada)
      assert.equal(leitura.materialSolicitado, esperada === 'permissao')
      assert.equal(JSON.stringify(lead), antes, 'a classificação não reescreve o histórico')
      if (esperada === 'exclusao') assert.equal(respostaParaAcompanhamento(fonte, leitura)?.tipo, 'exclusao')
      if (esperada === 'recusa') assert.equal(respostaParaAcompanhamento(fonte, leitura)?.tipo, 'negativa')
    })
  }
})

describe('limites da identificação de exclusão', () => {
  for (const texto of ['Não apague meu número.', 'Por favor, não apague meu número.', 'Vocês apagam meu número depois?', 'Quero entender como vocês usam meus dados.']) {
    it(`não inventa pedido de exclusão: ${texto}`, () => {
      const leitura = classificarResposta({ marcos: { enviado: ENVIO }, resposta: { tipo: 'neutra', trecho: texto, em: ENTRADA } }, [
        { em: ENVIO, direcao: 'saida', texto: aberturas[0][1] },
        { em: ENTRADA, direcao: 'entrada', texto, papel: 'gente' },
      ])
      assert.notEqual(leitura.classe, 'exclusao')
      assert.equal(leitura.materialSolicitado, false)
    })
  }
  it('pedido humano observado sem rótulo prévio chega à leitura operacional', () => {
    const leitura = classificarResposta({ marcos: { enviado: ENVIO } }, [
      { em: ENVIO, direcao: 'saida', texto: aberturas[0][1] },
      { em: ENTRADA, direcao: 'entrada', texto: 'Me tire da lista.', papel: 'gente' },
    ])
    assert.equal(leitura.classe, 'exclusao')
    assert.equal(respostaParaAcompanhamento(undefined, leitura)?.tipo, 'exclusao')
  })
  it('agradecimento posterior não apaga a exclusão explícita', () => {
    const em = '2026-10-27T11:03:00Z'
    const leitura = classificarResposta({ marcos: { enviado: ENVIO }, resposta: { tipo: 'neutra', trecho: 'Obrigado', em } }, [
      { em: ENVIO, direcao: 'saida', texto: aberturas[0][1] },
      { em: ENTRADA, direcao: 'entrada', texto: 'Por favor, apague meu número da lista.', papel: 'gente' },
      { em, direcao: 'entrada', texto: 'Obrigado', papel: 'gente' },
    ])
    assert.equal(leitura.classe, 'exclusao')
    assert.match(leitura.evidencia!.trecho, /apague meu número/)
  })
})
