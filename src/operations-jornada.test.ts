import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { CARDAPIO } from './operations/colinha.ts'
import {
  OFERTAS_PROPRIAS, PASSOS, REGRAS_DA_OFERTA, caminhoDoLead, funilDoLead, guiaDaJornada, jornadaDoLead, ofertaDoLead, painelDaJornada, passoAtual, proximoDaJornada,
  type IdDaOferta, type IdDoPasso, type LeadDaJornada,
} from './operations/jornada.ts'

const lead = (extra: Partial<LeadDaJornada> = {}): LeadDaJornada => ({
  produto: 'site', etapa: 'novo', sinal: 'na-fila', marcos: {}, links: {}, followupHoje: false, ...extra,
})

const ids = (lista: { id: IdDaOferta }[]) => lista.map((o) => o.id)

describe('jornada: o passo atual pelo retrato do CRM', () => {
  const CASOS: { nome: string, lead: LeadDaJornada, passo: IdDoPasso }[] = [
    { nome: 'na fila do gerador: achado', lead: lead(), passo: 'achado' },
    { nome: 'publicado, sem o Balcão: Raio-X pronto', lead: lead({ sinal: 'publicado' }), passo: 'raio-x' },
    { nome: 'pronto: Raio-X pronto', lead: lead({ sinal: 'pronto' }), passo: 'raio-x' },
    { nome: 'enviado: primeira mensagem', lead: lead({ etapa: 'contato', sinal: 'enviado', marcos: { enviado: '2026-10-14T12:00:00Z' } }), passo: 'primeiro-contato' },
    { nome: 'só o robô respondeu: ainda primeira mensagem', lead: lead({ etapa: 'contato', sinal: 'so-robo', resposta: { tipo: 'bot', trecho: '' } }), passo: 'primeiro-contato' },
    { nome: 'respondeu com interesse: respondeu', lead: lead({ etapa: 'contato', sinal: 'respondeu', resposta: { tipo: 'interesse', trecho: 'pode mandar' } }), passo: 'resposta' },
    { nome: '2ª mensagem anotada: viu o Raio-X', lead: lead({ etapa: 'contato', sinal: 'respondeu', marcos: { segundaEnviada: '2026-10-14T13:00:00Z' } }), passo: 'segunda' },
    { nome: 'PRUMO com o Mapa respondido: Mapa', lead: lead({ produto: 'prumo', etapa: 'contato', sinal: 'diagnostico' }), passo: 'mapa' },
    { nome: 'Iris que respondeu: já é conversa', lead: lead({ produto: 'iris', etapa: 'contato', sinal: 'respondeu-prumo', resposta: { tipo: 'interesse', trecho: 'quero testar' } }), passo: 'conversa' },
    { nome: 'proposta', lead: lead({ etapa: 'proposta', sinal: 'proposta' }), passo: 'proposta' },
    { nome: 'fechou', lead: lead({ etapa: 'ganho', sinal: 'fechou' }), passo: 'ganho' },
    { nome: 'perdido', lead: lead({ etapa: 'perdido', sinal: 'expirou' }), passo: 'perdido' },
  ]
  for (const c of CASOS) it(c.nome, () => assert.equal(passoAtual(c.lead), c.passo))
})

describe('jornada: o caminho de cada funil', () => {
  it('PRUMO com equipe (ou porte a confirmar) tem os dois trilhos', () => {
    const c = caminhoDoLead(lead({ produto: 'prumo' }))
    assert.deepEqual(c, ['achado', 'raio-x', 'primeiro-contato', 'resposta', 'segunda', 'conversa', 'mapa-convite', 'mapa', 'devolutiva', 'proposta', 'ganho'])
  })
  it('PRUMO sem equipe e Site antes da venda não têm o trilho de dentro', () => {
    for (const l of [lead({ produto: 'prumo', equipe: false }), lead()]) assert.ok(!caminhoDoLead(l).includes('mapa'))
  })
  it('Iris e estamparias: o caminho curto, sem Raio-X nem Mapa', () => {
    for (const produto of ['iris', 'estampa'] as const) {
      const c = caminhoDoLead(lead({ produto }))
      assert.ok(!c.includes('raio-x') && !c.includes('mapa'))
    }
  })
  it('o Plus anda no funil da oferta dele', () => {
    assert.equal(funilDoLead(lead({ produto: 'plus', plus: { oferta: 'prumo', fixo: false, descricao: '' } })), 'prumo')
    assert.equal(funilDoLead(lead({ produto: 'plus' })), 'site')
  })
})

describe('jornada: o estado de cada passo', () => {
  const estados = (l: LeadDaJornada) => Object.fromEntries(jornadaDoLead(l).map((p) => [p.passo.id, p.estado]))
  it('no Mapa, a conversa (outro trilho) continua "depois", e o tronco está feito', () => {
    const e = estados(lead({ produto: 'prumo', etapa: 'contato', sinal: 'diagnostico' }))
    assert.equal(e.mapa, 'agora')
    assert.equal(e['mapa-convite'], 'feito')
    assert.equal(e.conversa, 'depois')
    assert.equal(e.segunda, 'feito')
    assert.equal(e.proposta, 'depois')
  })
  it('na proposta, os trilhos ficam "sem registro": o CRM não sabe por qual veio', () => {
    const e = estados(lead({ produto: 'prumo', etapa: 'proposta', sinal: 'proposta' }))
    assert.equal(e.proposta, 'agora')
    assert.equal(e.conversa, 'sem-registro')
    assert.equal(e.mapa, 'sem-registro')
    assert.equal(e.resposta, 'feito')
  })
  it('no Perdido, só o que tem data está feito', () => {
    const e = estados(lead({ etapa: 'perdido', sinal: 'expirou', marcos: { enviado: '2026-10-01T12:00:00Z' } }))
    assert.equal(e['primeiro-contato'], 'feito')
    assert.equal(e.resposta, 'sem-registro')
  })
  it('a data do passo vem dos marcos', () => {
    const p = jornadaDoLead(lead({ etapa: 'contato', sinal: 'enviado', marcos: { enviado: '2026-10-14T12:00:00Z' } })).find((x) => x.passo.id === 'primeiro-contato')!
    assert.equal(p.em, '2026-10-14T12:00:00Z')
  })
})

describe('jornada: o próximo passo', () => {
  it('o salvo à mão manda', () => {
    const p = proximoDaJornada(lead({ etapa: 'contato', sinal: 'respondeu', proximoPasso: { texto: 'Ligar às 10h', data: '2026-10-16', registradoEm: '' } }))
    assert.equal(p.acao, 'Ligar às 10h')
    assert.equal(p.marcadoAMao, true)
  })
  it('interesse: a 2ª mensagem em até 2 h', () => {
    const p = proximoDaJornada(lead({ etapa: 'contato', sinal: 'respondeu', resposta: { tipo: 'interesse', trecho: 'manda' } }))
    assert.match(p.acao, /2ª mensagem/)
    assert.equal(p.quando, 'em até 2 h')
  })
  it('PRUMO que viu o Raio-X: o Mapa e, se quiser, o site (o caso de 15/10/2026)', () => {
    const p = proximoDaJornada(lead({ produto: 'prumo', etapa: 'contato', sinal: 'respondeu-prumo', marcos: { segundaEnviada: '2026-10-15T12:00:00Z' } }))
    assert.match(p.acao, /Mapa/)
    assert.match(p.acao, /site/)
  })
  it('Site que viu o Raio-X: a conversa, sem Mapa', () => {
    const p = proximoDaJornada(lead({ etapa: 'contato', sinal: 'respondeu', marcos: { segundaEnviada: '2026-10-15T12:00:00Z' } }))
    assert.doesNotMatch(p.acao, /Mapa/)
  })
  it('publicado sem o Balcão: quem faz é o robô', () => {
    assert.equal(proximoDaJornada(lead({ sinal: 'publicado' })).quem, 'robô')
  })
})

describe('jornada: o que oferecer', () => {
  const viuRaioX = { etapa: 'contato', sinal: 'respondeu-prumo', marcos: { segundaEnviada: '2026-10-15T12:00:00Z' } } as const

  it('antes do Raio-X, só o Raio-X agora', () => {
    const o = ofertaDoLead(lead({ sinal: 'pronto' }))
    assert.deepEqual(ids(o.agora), ['raio-x'])
    assert.ok(ids(o.depois).includes('encontrado'))
  })
  it('sem site, depois do Raio-X: o Encontrado agora, o Respondido depois, sem Mapa', () => {
    const o = ofertaDoLead(lead({ ...viuRaioX, produto: 'site', sinal: 'respondeu' }))
    assert.deepEqual(ids(o.agora), ['encontrado'])
    assert.ok(ids(o.depois).includes('respondido'))
    assert.ok(ids(o.naoAgora).includes('mapa'))
  })
  it('PRUMO com equipe, depois do Raio-X: o Respondido e o Mapa agora; o site pode entrar também', () => {
    const o = ofertaDoLead(lead({ ...viuRaioX, produto: 'prumo', equipe: true }))
    assert.deepEqual(ids(o.agora), ['respondido', 'mapa'])
    assert.ok(ids(o.depois).includes('encontrado'))
    assert.ok(ids(o.depois).includes('fonte'))
  })
  it('PRUMO com o porte a confirmar: o Mapa fica depois e a pergunta aparece', () => {
    const o = ofertaDoLead(lead({ ...viuRaioX, produto: 'prumo' }))
    assert.ok(ids(o.depois).includes('mapa'))
    assert.ok(o.aConfirmar.some((t) => t.startsWith('Porte')))
  })
  it('Mapa respondido: a Fonte agora, a Manutenção depois', () => {
    const o = ofertaDoLead(lead({ produto: 'prumo', etapa: 'contato', sinal: 'diagnostico' }))
    assert.ok(ids(o.agora).includes('fonte'))
    assert.ok(ids(o.depois).includes('fonte-em-dia'))
  })
  it('"já temos site": não insiste no Encontrado', () => {
    const o = ofertaDoLead(lead({ ...viuRaioX, produto: 'site', sinal: 'respondeu', resposta: { tipo: 'negativa', trecho: 'Obrigado, mas já temos site' } }))
    assert.ok(!ids(o.agora).includes('encontrado'))
    assert.ok(ids(o.agora).includes('respondido'))
  })
  it('Iris e estamparias: a oferta própria, sem Raio-X', () => {
    assert.deepEqual(ids(ofertaDoLead(lead({ produto: 'iris' })).agora), ['iris'])
    assert.deepEqual(ids(ofertaDoLead(lead({ produto: 'estampa' })).agora), ['crm-estamparia'])
  })
  it('perdido: nada agora', () => {
    assert.deepEqual(ofertaDoLead(lead({ etapa: 'perdido', sinal: 'recusou' })).agora, [])
  })
})

describe('jornada: a vista do funil inteiro', () => {
  const comDias = (l: LeadDaJornada, diasNaEtapa: number) => ({ ...l, diasNaEtapa })
  it('agrupa por passo, conta quem espera quem e marca o parado com você', () => {
    const p = painelDaJornada([
      comDias(lead({ etapa: 'contato', sinal: 'respondeu', resposta: { tipo: 'interesse', trecho: 'manda' } }), 2),
      comDias(lead({ etapa: 'contato', sinal: 'enviado' }), 5),
      comDias(lead(), 0),
      comDias(lead({ etapa: 'perdido', sinal: 'expirou' }), 9),
    ])
    const resposta = p.passos.find((x) => x.passo.id === 'resposta')!
    assert.equal(resposta.leads.length, 1)
    assert.equal(resposta.parados, 1)
    // Esperar a resposta do dono há 5 dias não é "parado com você".
    assert.equal(p.passos.find((x) => x.passo.id === 'primeiro-contato')!.parados, 0)
    // O achado é estoque (naFila), não conversa esperando alguém.
    assert.deepEqual(p.porQuem, { robô: 0, você: 1, 'o dono': 1 })
    assert.equal(p.naFila, 1)
    assert.equal(p.parados, 1)
  })
})

describe('jornada: integridade', () => {
  it('ids de passo únicos, e todo serviço citado existe no cardápio', () => {
    assert.equal(new Set(PASSOS.map((p) => p.id)).size, PASSOS.length)
    for (const p of PASSOS) if (p.servico) assert.ok(CARDAPIO.some((s) => s.id === p.servico), p.id)
  })
  it('nenhum preço na jornada: preço só no cardápio', () => {
    const texto = JSON.stringify([PASSOS, OFERTAS_PROPRIAS, REGRAS_DA_OFERTA])
    assert.doesNotMatch(texto, /R\$/)
  })
  it('o guia no disco é o que o código gera (rode npx tsx scripts/jornada-guia.ts)', () => {
    const noDisco = readFileSync(new URL('../docs/referencia/jornada-do-cliente.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.equal(noDisco, guiaDaJornada())
  })
})
