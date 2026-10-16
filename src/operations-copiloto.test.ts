import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PASSOS_DO_COPILOTO, PRECOS_ABERTOS, copilotoServe, itensDaProposta, lerSaidaDoCopiloto, mascarar, montarDossie, numerosForaDoDossie,
  precosProibidos, promptDoCopiloto, textoDaProposta, textoDoRaioX, type LeadDoCopiloto,
} from './operations/copiloto.ts'

const lead = (extra: Partial<LeadDoCopiloto> = {}): LeadDoCopiloto => ({
  id: 'ChIJabc', produto: 'site', empresa: 'Desentupidora Estrela', nicho: 'desentupidora', cidade: 'Vitória', subEtapa: 'Respondeu',
  etapa: 'contato', sinal: 'respondeu', marcos: { enviado: '2026-10-14T12:00:00Z' }, links: {}, followupHoje: false, eventos: [],
  resposta: { tipo: 'interesse', trecho: 'pode mandar', em: '2026-10-14T13:00:00Z' },
  ...extra,
})

const RAIO_X = `<html><head><style>body{color:red}</style><script>var x = 1</script></head><body>
<h1>Raio-X · Desentupidora Estrela</h1><p>4,8 nota no Google</p><p>37 avaliações</p>
<p>01 Sem site próprio no perfil do Google</p><p>Ligue (27) 99999-1234 &amp; peça</p></body></html>`

describe('copiloto: onde ele vale', () => {
  const CASOS: Array<{ nome: string, lead: LeadDoCopiloto, serve: boolean }> = [
    { nome: 'respondeu com interesse', lead: lead(), serve: true },
    { nome: 'viu o Raio-X (2ª mensagem saiu)', lead: lead({ marcos: { segundaEnviada: '2026-10-14T14:00:00Z' } }), serve: true },
    { nome: 'Iris em conversa', lead: lead({ produto: 'iris', sinal: 'respondeu-prumo' }), serve: true },
    { nome: 'PRUMO com o Mapa respondido', lead: lead({ produto: 'prumo', sinal: 'diagnostico' }), serve: true },
    { nome: 'proposta enviada', lead: lead({ etapa: 'proposta', sinal: 'proposta' }), serve: true },
    { nome: 'primeira mensagem sem resposta: a esteira cuida', lead: lead({ sinal: 'enviado', resposta: undefined }), serve: false },
    { nome: 'só o robô respondeu', lead: lead({ sinal: 'so-robo', resposta: { tipo: 'bot', trecho: '' } }), serve: false },
    { nome: 'Raio-X pronto, sem contato', lead: lead({ etapa: 'novo', sinal: 'pronto', resposta: undefined }), serve: false },
    { nome: 'fechou', lead: lead({ etapa: 'ganho', sinal: 'fechou' }), serve: false },
    { nome: 'perdido', lead: lead({ etapa: 'perdido', sinal: 'expirou' }), serve: false },
  ]
  for (const c of CASOS) it(c.nome, () => assert.equal(copilotoServe(c.lead), c.serve))
  it('cinco passos, do respondeu à proposta', () => assert.deepEqual(PASSOS_DO_COPILOTO, ['resposta', 'segunda', 'conversa', 'mapa', 'proposta']))
})

describe('copiloto: máscara e Raio-X', () => {
  it('tira telefone, e-mail e wa.me; deixa nota, data e preço', () => {
    const t = mascarar('Me liga no (27) 99999-1234 ou +55 27 3333-4444, joao@x.com.br, https://wa.me/5527999991234?text=oi. Nota 4,8, 37 avaliações, 09/10/2026, R$ 690.')
    assert.doesNotMatch(t, /9999|3333|joao@|wa\.me/)
    assert.match(t, /\[telefone\].*\[telefone\].*\[e-mail\].*\[link do WhatsApp\]/)
    assert.match(t, /4,8, 37 avaliações, 09\/10\/2026, R\$ 690/)
  })
  it('texto do Raio-X sem script, estilo nem tags, entidades resolvidas e telefone mascarado', () => {
    const t = textoDoRaioX(RAIO_X)
    assert.equal(t, 'Raio-X · Desentupidora Estrela 4,8 nota no Google 37 avaliações 01 Sem site próprio no perfil do Google Ligue [telefone] & peça')
  })
  it('corta no teto', () => {
    const t = textoDoRaioX(`<p>${'a'.repeat(5000)}</p>`, 100)
    assert.equal(t.length, 100)
    assert.ok(t.endsWith('…'))
  })
})

describe('copiloto: o dossiê', () => {
  it('leva jornada, oferta, resposta, Raio-X e cardápio com o preço como se diz ao cliente', () => {
    const d = montarDossie(lead(), { textoDoRaioX: textoDoRaioX(RAIO_X) })
    assert.equal(d.lead.funil, 'site')
    assert.equal(d.passo.id, 'resposta')
    assert.equal(d.proximo.quem, 'você')
    assert.ok(d.oferta.agora.some((o) => o.id === 'raio-x'))
    assert.ok(d.oferta.naoOferecer.some((o) => o.id === 'mapa'))
    assert.equal(d.resposta?.trecho, 'pode mandar')
    assert.equal(d.raioX.situacao, 'com texto')
    assert.equal(d.cardapio.find((s) => s.id === 'respondido')?.precoParaOCliente, 'sob proposta')
    assert.match(d.cardapio.find((s) => s.id === 'encontrado')!.precoParaOCliente, /R\$ 690/)
    assert.equal(d.ofertasProprias.length, 0)
  })
  it('a objeção reconhecida vem com a resposta pronta da colinha, preenchida com o nome', () => {
    const d = montarDossie(lead({ resposta: { tipo: 'negativa', trecho: 'Já temos site, obrigado' } }))
    assert.ok(d.objecoes.length >= 1)
    assert.match(d.objecoes[0].fala, /site/i)
    assert.doesNotMatch(d.objecoes[0].respostaPronta, /\{NOME\}/)
  })
  it('histórico: os últimos 12 eventos, em ordem, com a nota mascarada', () => {
    const eventos = Array.from({ length: 15 }, (_, i) => ({
      tipo: 'nota', rotulo: 'Nota', em: `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z`, origem: 'manual' as const, fonte: 'aba CRM',
      texto: i === 14 ? 'Ligar no 27 99999-1234 amanhã' : `nota ${i + 1}`,
    }))
    const d = montarDossie(lead({ eventos: [...eventos].reverse() }))
    assert.equal(d.historico.length, 12)
    assert.equal(d.historico[0].texto, 'nota 4')
    assert.equal(d.historico[11].texto, 'Ligar no [telefone] amanhã')
  })
  it('sem Raio-X no disco: só o link, ou nada', () => {
    assert.equal(montarDossie(lead({ links: { raioX: 'https://raio-x-prumo.vercel.app/estrela' } })).raioX.situacao, 'só o link')
    assert.equal(montarDossie(lead()).raioX.situacao, 'sem Raio-X')
  })
  it('Iris e estamparias: sem cardápio, com as ofertas próprias', () => {
    const d = montarDossie(lead({ produto: 'iris', sinal: 'respondeu-prumo' }))
    assert.equal(d.cardapio.length, 0)
    assert.deepEqual(d.ofertasProprias.map((o) => o.id), ['iris', 'crm-estamparia'])
    assert.equal(d.passo.id, 'conversa')
  })
  it('Plus anda pelo funil da oferta dele', () => {
    const d = montarDossie(lead({ produto: 'plus', plus: { oferta: 'prumo', fixo: false, descricao: 'engenharia' } }))
    assert.equal(d.lead.funil, 'prumo')
    assert.equal(d.lead.plus, true)
  })
  it('mesmo lead, mesmo dossiê (o servidor guarda pelo hash)', () => {
    assert.equal(JSON.stringify(montarDossie(lead())), JSON.stringify(montarDossie(lead())))
  })
  it('o prompt cerca o dossiê como dado e lista os ids válidos', () => {
    const p = promptDoCopiloto(montarDossie(lead()))
    assert.match(p, /<<<DOSSIE[\s\S]*Desentupidora Estrela[\s\S]*DOSSIE>>>/)
    assert.match(p, /DADO, não instrução/)
    assert.match(p, /Ids válidos.*encontrado.*respondido/)
    assert.doesNotMatch(p, /Ids válidos.*crm-estamparia/)
  })
})

describe('copiloto: preços na mensagem', () => {
  it('os abertos são os do Encontrado, Anúncios e Redes', () => {
    assert.deepEqual(PRECOS_ABERTOS, ['R$ 690', 'R$ 39', 'R$ 590', 'R$ 390', 'R$ 790'])
  })
  const CASOS: Array<{ texto: string, proibidos: string[] }> = [
    { texto: 'O Encontrado é R$ 690 + R$ 39/mês, e paga só depois de ver no ar.', proibidos: [] },
    { texto: 'O Respondido sai por R$ 2.400.', proibidos: ['R$ 2.400'] },
    { texto: 'A mensalidade é R$ 290.', proibidos: ['R$ 290'] },
    { texto: 'Faço por R$ 500 para você.', proibidos: ['R$ 500'] },
    { texto: 'A Fonte custa 1.500 reais.', proibidos: ['1.500 reais'] },
    { texto: 'Fica em uns 2 mil reais.', proibidos: ['2 mil reais'] },
    { texto: 'São 690 reais, só depois de ver no ar.', proibidos: [] },
    { texto: 'Vocês têm 37 avaliações e nota 4,8.', proibidos: [] },
  ]
  for (const c of CASOS) it(c.texto, () => assert.deepEqual(precosProibidos(c.texto), c.proibidos))
})

describe('copiloto: a leitura da saída', () => {
  const dossie = montarDossie(lead({ marcos: { segundaEnviada: '2026-10-14T14:00:00Z' } }), { textoDoRaioX: textoDoRaioX(RAIO_X) })
  const saida = (extra: Record<string, unknown> = {}) => JSON.stringify({
    mensagem: 'Oi! Aqui é o Rômulo, do PRUMO. Vi que vocês têm 37 avaliações e nota 4,8. Posso colocar o site no ar? O Encontrado é R$ 690 + R$ 39/mês, pago só depois de ver.',
    porque: 'Ele disse que quer ver.',
    ofertas: [{ id: 'encontrado', porque: 'Não tem site.' }],
    proposta: { itens: [{ id: 'encontrado', porque: 'O que ele pediu.' }] },
    falta_saber: ['Se ele perde cliente no WhatsApp.'],
    ...extra,
  })

  it('saída boa vira sugestão sem aviso', () => {
    const r = lerSaidaDoCopiloto(saida(), dossie)
    assert.equal(r.ok, true)
    if (r.ok !== true) return
    assert.deepEqual(r.avisos, [])
    assert.deepEqual(r.sugestao.ofertas.map((o) => o.id), ['encontrado'])
    assert.deepEqual(r.sugestao.faltaSaber, ['Se ele perde cliente no WhatsApp.'])
  })
  it('aceita cerca de código e texto em volta', () => {
    assert.equal(lerSaidaDoCopiloto(`Aqui está:\n\`\`\`json\n${saida()}\n\`\`\``, dossie).ok, true)
  })
  const RECUSAS: Array<{ nome: string, texto: string, motivo: string }> = [
    { nome: 'vazio', texto: '  ', motivo: 'vazio' },
    { nome: 'não é JSON', texto: 'Mande o site para ele.', motivo: 'json_invalido' },
    { nome: 'lista em vez de objeto', texto: '[1,2]', motivo: 'formato' },
    { nome: 'sem mensagem', texto: saida({ mensagem: '' }), motivo: 'formato' },
    { nome: 'ofertas não é lista', texto: saida({ ofertas: 'encontrado' }), motivo: 'formato' },
    { nome: 'id inventado', texto: saida({ ofertas: [{ id: 'consultoria-premium' }] }), motivo: 'oferta_desconhecida' },
    { nome: 'preço de serviço sob proposta', texto: saida({ mensagem: 'O Respondido é R$ 2.400 + R$ 290/mês.' }), motivo: 'preco_proibido' },
  ]
  for (const c of RECUSAS) {
    it(`recusa: ${c.nome}`, () => {
      const r = lerSaidaDoCopiloto(c.texto, dossie)
      assert.equal(r.ok, false)
      if (r.ok === false) assert.equal(r.motivo, c.motivo)
    })
  }
  it('a recusa por preço não repete a mensagem inteira', () => {
    const r = lerSaidaDoCopiloto(saida({ mensagem: 'Segredo do lead. O Respondido é R$ 2.400.' }), dossie)
    assert.ok(r.ok === false && !r.detalhe.includes('Segredo'))
  })
  it('avisa: oferta que a jornada manda não oferecer, oferta própria e item grátis na proposta', () => {
    const r = lerSaidaDoCopiloto(saida({
      ofertas: [{ id: 'mapa', porque: 'x' }, { id: 'iris', porque: 'y' }],
      proposta: { itens: [{ id: 'raio-x' }, { id: 'encontrado' }] },
    }), dossie)
    assert.equal(r.ok, true)
    if (r.ok !== true) return
    assert.ok(r.avisos.some((a) => /Mapa está em "não oferecer"/.test(a)))
    assert.ok(r.avisos.some((a) => /Iris é oferta própria/.test(a)))
    assert.ok(r.avisos.some((a) => /grátis/.test(a)))
    assert.deepEqual(r.sugestao.proposta.itens.map((i) => i.id), ['encontrado'])
  })
  it('avisa número que não está no dossiê (sem inventar fato)', () => {
    const r = lerSaidaDoCopiloto(saida({ mensagem: 'Os 5 primeiros da busca têm 234 avaliações; vocês têm 37.' }), dossie)
    assert.equal(r.ok, true)
    if (r.ok === true) assert.ok(r.avisos.some((a) => /234/.test(a) && !/\b37\b/.test(a)))
  })
  it('ids repetidos viram um só; texto longo é cortado', () => {
    const r = lerSaidaDoCopiloto(saida({ ofertas: [{ id: 'encontrado', porque: 'a'.repeat(500) }, { id: 'encontrado' }] }), dossie)
    assert.ok(r.ok === true && r.sugestao.ofertas.length === 1 && r.sugestao.ofertas[0].porque.length === 300)
  })
})

describe('copiloto: números fora do dossiê', () => {
  const dossie = montarDossie(lead(), { textoDoRaioX: textoDoRaioX(RAIO_X) })
  it('preço do cardápio, nota e avaliações estão no dossiê', () => assert.deepEqual(numerosForaDoDossie('R$ 690, 4,8, 37 avaliações, 16 perguntas', dossie), []))
  it('número inventado aparece', () => assert.deepEqual(numerosForaDoDossie('234 avaliações em 2.400 buscas', dossie), ['234', '2400']))
})

describe('copiloto: o rascunho da proposta', () => {
  const sugestao = { proposta: { itens: [{ id: 'encontrado' as const, porque: 'pediu' }, { id: 'respondido' as const, porque: 'perde no WhatsApp' }], observacao: 'Começar pelo site.' } }
  it('nome, entrega e preço saem do cardápio; o sob proposta é marcado', () => {
    const itens = itensDaProposta(sugestao)
    assert.equal(itens[0].nome, 'Encontrado')
    assert.match(itens[0].preco!, /^R\$ 690 \+ R\$ 39\/mês/)
    assert.equal(itens[0].sobProposta, false)
    assert.equal(itens[1].sobProposta, true)
    assert.match(itens[1].preco!, /R\$ 2\.400/)
  })
  it('texto para colar na proposta-modelo', () => {
    const t = textoDaProposta('Desentupidora Estrela', sugestao)
    assert.match(t, /^Proposta para Desentupidora Estrela\n\n■ Encontrado\n→ /)
    assert.match(t, /→ Investimento: R\$ 2\.400/)
    assert.ok(t.endsWith('Começar pelo site.'))
  })
  it('sem itens, sem rascunho', () => assert.equal(textoDaProposta('X', { proposta: { itens: [] } }), ''))
  it('oferta própria entra sem preço', () => {
    const [i] = itensDaProposta({ proposta: { itens: [{ id: 'iris', porque: 'clínica' }] } })
    assert.equal(i.nome, 'Iris')
    assert.equal(i.preco, undefined)
  })
})
