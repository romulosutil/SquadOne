/**
 * Assistente da Central (RULES 28), as regras PURAS de src/operations/assistente.ts: o que nem vai
 * ao modelo (finanças), a máscara de tudo o que vai ao modelo e ao arquivo, o prompt sem telefone,
 * R$ nem trabalhador, o que um pedido de ação pode virar (só cartão "proposto"), de onde veio a
 * resposta e a poda de 90 dias. Tudo fixture, sem rede, relógio nem disco.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  fontesDaResposta,
  historicoParaOPrompt,
  lerCartaoProposto,
  MAX_MENSAGENS_NO_HISTORICO,
  mesesParaPodar,
  prepararTexto,
  promptDoRoteador,
  RESPOSTA_DE_FINANCAS,
  rotearLocal,
  semValores,
  TEXTO_GUARDADO_DE_FINANCAS,
} from './operations/assistente.ts'
import { TRABALHADORES } from './office/trabalhadores.ts'

const VISAO = { leads: [{ produto: 'site' as const, id: 'ChIJkulniski', empresa: 'Kulniski Advocacia' }] }

describe('rotearLocal: finanças nem saem do processo', () => {
  const casos: Array<[string, 'financas' | 'recusa' | null]> = [
    ['gastei 30 no mercado', 'financas'],
    ['quanto gastei com R$ 200 de farmácia?', 'financas'],
    ['qual o saldo da conta?', 'financas'],
    ['meu salário caiu?', 'financas'],
    ['paguei a fatura do cartão', 'financas'],
    ['o que falta na Kulniski?', null],
    ['marca reunião amanhã às 10h', null],
    ['', 'recusa'],
    ['   ', 'recusa'],
    ['x'.repeat(2001), 'recusa'],
  ]
  for (const [texto, regra] of casos) {
    it(`${JSON.stringify(texto.slice(0, 40))} -> ${regra}`, () => assert.equal(rotearLocal(texto).regra, regra))
  }

  it('a resposta de finanças é fixa e o que fica guardado não tem o valor nem o lugar', () => {
    const r = rotearLocal('gastei 30 no mercado')
    assert.equal(r.regra, 'financas')
    const f = r as { resposta: string; guardado: string }
    assert.equal(f.resposta, RESPOSTA_DE_FINANCAS)
    assert.equal(f.guardado, TEXTO_GUARDADO_DE_FINANCAS)
    assert.doesNotMatch(f.guardado, /30|mercado/)
  })
})

describe('prepararTexto: identificador vira rótulo', () => {
  const casos: Array<[string, RegExp]> = [
    ['me liga no (41) 99999-1234', /\[(TEL|telefone)\]/],
    ['manda para joao.silva@exemplo.com.br', /\[(EMAIL|e-mail)\]/],
    ['https://wa.me/5541999991234?text=oi', /\[link do WhatsApp\]/],
    ['wa.me/5541999991234', /\[link do WhatsApp\]/],
    ['CPF 529.982.247-25', /\[DOC\]/],
    ['CNPJ 12.345.678/0001-95', /\[DOC\]/],
    ['o demo em https://demo-x.vercel.app/kulniski?id=99', /\[URL\]/],
  ]
  for (const [texto, rotulo] of casos) {
    it(JSON.stringify(texto), () => {
      const t = prepararTexto(texto)
      assert.match(t, rotulo)
      assert.doesNotMatch(t, /\d{8,}/)
      assert.doesNotMatch(t, /99999|1234-|@exemplo/)
    })
  }

  it('data ISO passa intacta (não é telefone) e o resto da frase também', () => {
    assert.equal(prepararTexto('próximo passo 2026-10-20, falar com o dono'), 'próximo passo 2026-10-20, falar com o dono')
    assert.equal(prepararTexto('em 2026-10-16T13:00:00.000Z ligou (41) 99999-1234').includes('2026-10-16T13:00:00.000Z'), true)
  })

  it('semValores tira o R$ com o número', () => {
    assert.equal(semValores('fechou por R$ 1.200,00 e R$900'), 'fechou por [valor] e [valor]')
  })
})

describe('promptDoRoteador', () => {
  const prompt = promptDoRoteador({
    pagina: '/crm?lead=5541999991234',
    lead: { produto: 'site', id: 'ChIJkulniski', empresa: 'Kulniski Advocacia (41) 99999-1234', etapa: 'Respondeu', passo: 'Conversa' },
    agoraLocal: 'sexta-feira, 17/10/2026, 14:05',
    hermes: false,
  })

  it('o lead da Ficha entra pelo nome e pelo id, sem telefone nem R$', () => {
    assert.match(prompt, /Kulniski Advocacia/)
    assert.match(prompt, /ChIJkulniski/)
    assert.doesNotMatch(prompt, /\d{8,}/)
    assert.doesNotMatch(prompt, /99999/)
    assert.doesNotMatch(prompt, /R\$/)
  })

  it('pede texto curto, só as ferramentas propor_* para agir e nunca dizer que fez', () => {
    assert.match(prompt, /texto curto/)
    assert.match(prompt, /propor_pedido_ao_time/)
    assert.match(prompt, /Nunca diga que enviou, anotou/)
  })

  it('sem o catálogo de trabalhadores (RULES 26) e sem o Hermes quando desligado', () => {
    for (const t of TRABALHADORES) assert.ok(!prompt.includes(t.nome), `o prompt cita ${t.nome}`)
    assert.doesNotMatch(prompt, /consultar_hermes/)
    assert.match(promptDoRoteador({ pagina: '/', agoraLocal: 'agora', hermes: true }), /consultar_hermes/)
  })
})

describe('lerCartaoProposto', () => {
  it('pedido ao time vira cartão proposto, mascarado, modo auto por padrão', () => {
    const r = lerCartaoProposto('propor_pedido_ao_time', { demanda: 'marca reunião amanhã com (41) 99999-1234' }, null, 'c1')
    assert.equal(r.ok, true)
    const c = (r as { cartao: any }).cartao
    assert.equal(c.estado, 'proposto')
    assert.equal(c.tipo, 'pedido_ao_time')
    assert.equal(c.dados.modo, 'auto')
    assert.doesNotMatch(c.dados.demanda, /99999/)
  })

  it('anotação e mensagem levam a empresa da visão, não do modelo', () => {
    const a = lerCartaoProposto('propor_anotacao_no_crm', { produto: 'site', id: 'ChIJkulniski', tipo: 'proximo_passo', texto: 'ligar de novo', data: '2026-10-20' }, VISAO, 'c2')
    assert.equal(a.ok, true)
    assert.deepEqual((a as { cartao: any }).cartao.dados, { produto: 'site', id: 'ChIJkulniski', empresa: 'Kulniski Advocacia', tipo: 'proximo_passo', texto: 'ligar de novo', data: '2026-10-20' })
    const m = lerCartaoProposto('propor_mensagem_ao_lead', { produto: 'site', id: 'ChIJkulniski', texto: 'Oi, tudo bem?', empresa: 'Outra' }, VISAO, 'c3')
    assert.equal((m as { cartao: any }).cartao.dados.empresa, 'Kulniski Advocacia')
  })

  const recusas: Array<[string, string, unknown, typeof VISAO | null]> = [
    ['lead fora do CRM', 'propor_mensagem_ao_lead', { produto: 'site', id: 'ChIJoutro', texto: 'oi' }, VISAO],
    ['produto fora do CRM', 'propor_mensagem_ao_lead', { produto: 'loja', id: 'ChIJkulniski', texto: 'oi' }, VISAO],
    ['CRM não lido', 'propor_anotacao_no_crm', { produto: 'site', id: 'ChIJkulniski', tipo: 'nota', texto: 'x' }, null],
    ['tipo fora de nota|proximo_passo', 'propor_anotacao_no_crm', { produto: 'site', id: 'ChIJkulniski', tipo: 'proposta', texto: 'x' }, VISAO],
    ['próximo passo sem data', 'propor_anotacao_no_crm', { produto: 'site', id: 'ChIJkulniski', tipo: 'proximo_passo', texto: 'x' }, VISAO],
    ['data torta', 'propor_anotacao_no_crm', { produto: 'site', id: 'ChIJkulniski', tipo: 'nota', texto: 'x', data: '20/10/2026' }, VISAO],
    ['texto > 1000', 'propor_anotacao_no_crm', { produto: 'site', id: 'ChIJkulniski', tipo: 'nota', texto: 'x'.repeat(1001) }, VISAO],
    ['nota vazia', 'propor_anotacao_no_crm', { produto: 'site', id: 'ChIJkulniski', tipo: 'nota', texto: '  ' }, VISAO],
    ['mensagem vazia', 'propor_mensagem_ao_lead', { produto: 'site', id: 'ChIJkulniski', texto: '' }, VISAO],
    ['R$ na mensagem', 'propor_mensagem_ao_lead', { produto: 'site', id: 'ChIJkulniski', texto: 'fica R$ 900' }, VISAO],
    ['R$ na anotação', 'propor_anotacao_no_crm', { produto: 'site', id: 'ChIJkulniski', tipo: 'nota', texto: 'proposta de R$ 900' }, VISAO],
    ['R$ no pedido', 'propor_pedido_ao_time', { demanda: 'cobrar R$ 50' }, null],
    ['finanças no pedido', 'propor_pedido_ao_time', { demanda: 'lembrar de pagar o boleto' }, null],
    ['modo inválido', 'propor_pedido_ao_time', { demanda: 'marca reunião', modo: 'urgente' }, null],
    ['demanda vazia', 'propor_pedido_ao_time', { demanda: '' }, null],
    ['demanda > 1000', 'propor_pedido_ao_time', { demanda: 'a'.repeat(1001) }, null],
    ['ferramenta que não existe', 'propor_envio', { texto: 'x' }, VISAO],
  ]
  for (const [caso, nome, args, visao] of recusas) {
    it(`recusa: ${caso}`, () => assert.equal(lerCartaoProposto(nome, args, visao, 'c').ok, false))
  }
})

describe('fontesDaResposta: só o que rodou, um rótulo por fonte', () => {
  it('rótulos com a hora de SP, sem repetição', () => {
    const f = fontesDaResposta([
      { tipo: 'crm', geradoEm: '2026-10-17T11:14:00Z' },
      { tipo: 'conversa', ate: '2026-10-17T19:40:00Z' },
      { tipo: 'crm', geradoEm: '2026-10-17T11:14:00Z' },
      { tipo: 'dell', geradoEm: '2026-10-17T11:15:00Z' },
      { tipo: 'agenda' },
      { tipo: 'hermes', ms: 24_300 },
    ])
    assert.deepEqual(f.map((x) => x.rotulo), ['Vendas às 08:14', 'conversa até 16:40', 'Dell às 08:15', 'agenda', 'Hermes (24 s)'])
  })
  it('nenhuma leitura, nenhuma fonte', () => assert.deepEqual(fontesDaResposta([]), []))
})

describe('historicoParaOPrompt', () => {
  it('as 12 últimas, mascaradas, papéis seguidos juntados', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({ autor: (i % 2 ? 'assistente' : 'romulo') as 'romulo' | 'assistente', texto: `m${i} (41) 99999-1234` }))
    const h = historicoParaOPrompt(msgs)
    assert.equal(h.length, MAX_MENSAGENS_NO_HISTORICO)
    assert.equal(h[0].parts[0].text.startsWith('m8'), true)
    assert.ok(h.every((c) => !/\d{8,}|99999/.test(c.parts[0].text)))
    const juntos = historicoParaOPrompt([{ autor: 'romulo', texto: 'a' }, { autor: 'romulo', texto: 'b' }, { autor: 'assistente', texto: 'c' }])
    assert.deepEqual(juntos.map((c) => c.role), ['user', 'model'])
  })
})

describe('mesesParaPodar: 90 dias', () => {
  it('o mês sai quando o último dia dele passa de 90 dias', () => {
    const arquivos = ['2026-06.jsonl', '2026-07.jsonl', '2026-08.jsonl', '2026-10.jsonl', 'notas.txt']
    // 17/10/2026: junho acabou em 30/06 (109 dias), julho em 31/07 (78 dias).
    assert.deepEqual(mesesParaPodar(arquivos, new Date('2026-10-17T12:00:00Z')), ['2026-06.jsonl'])
    assert.deepEqual(mesesParaPodar(arquivos, new Date('2026-11-05T12:00:00Z')), ['2026-06.jsonl', '2026-07.jsonl'])
  })
})
