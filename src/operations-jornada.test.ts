import './testes/politica-historica.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { CARDAPIO } from './operations/colinha.ts'
import {
  OFERTAS_PROPRIAS, OFERTA_DO_ACHADO, PASSOS, REGRAS_DA_OFERTA, caminhoDoLead, fraseDoAchado, funilDoLead, guiaDaJornada, jornadaDoLead, ofertaDoLead,
  painelDaJornada, passoAtual, proximoDaJornada,
  type IdDaOferta, type IdDoPasso, type LeadDaJornada,
} from './operations/jornada.ts'
import type { AchadoDoRaioX } from './operations/types.ts'
import { OFERTAS_PROPRIAS as OFERTAS_DO_JSON } from '../server/ofertas.ts'

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
    for (const produto of OFERTAS_DO_JSON) {
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

describe('jornada: próximo passo orientado à necessidade', () => {
  it('o salvo à mão prevalece em conversa aberta', () => {
    const p = proximoDaJornada(lead({ etapa: 'contato', sinal: 'respondeu', proximoPasso: { texto: 'Ligar às 10h', data: '2026-10-16', registradoEm: '' } }))
    assert.equal(p.acao, 'Ligar às 10h')
    assert.equal(p.marcadoAMao, true)
  })
  it('interesse recebe resposta útil, sem proposta obrigatória após gostei', () => {
    const p = proximoDaJornada(lead({ etapa: 'contato', sinal: 'respondeu', resposta: { tipo: 'interesse', trecho: 'gostei' } }))
    assert.match(p.acao, /contexto suficiente/)
    assert.doesNotMatch(p.acao, /2ª mensagem|24 h/)
    assert.equal(p.quando, 'em até 2 h')
  })
  it('pedido de preço tem resposta direta, mesmo classificado como licença', () => {
    for (const tipo of ['interesse', 'licenca'] as const) for (const etapa of ['novo', 'contato'] as const) {
      const p = proximoDaJornada(lead({ etapa, sinal: 'respondeu', resposta: { tipo, trecho: 'Quanto custa?' } }))
      assert.match(p.acao, /Responder diretamente/)
      assert.match(p.acao, /sem exigir Raio-X, Mapa ou reunião/)
    }
  })
  it('licença autoriza só o material, não infere necessidade nem compra', () => {
    const p = proximoDaJornada(lead({ etapa: 'contato', sinal: 'respondeu', resposta: { tipo: 'licenca', trecho: 'Pode enviar' } }))
    assert.match(p.acao, /somente o material solicitado/)
    assert.match(p.acao, /não confirma necessidade nem compra/)
  })
  it('após material não obriga Mapa, reunião ou prazo universal de proposta', () => {
    for (const produto of ['site', 'prumo'] as const) {
      const p = proximoDaJornada(lead({ produto, etapa: 'contato', sinal: 'respondeu', equipe: true, marcos: { segundaEnviada: '2026-10-15T12:00:00Z' } }))
      assert.match(p.acao, /necessidade, processo de decisão e escopo/)
      assert.match(p.acao, /não exigir diagnóstico ou reunião/)
      assert.equal(p.quando, undefined)
    }
  })
  it('cadastro novo e demo publicada não recomendam disparo', () => {
    for (const sinal of ['na-fila', 'publicado', 'pronto'] as const) {
      const p = proximoDaJornada(lead({ sinal }))
      assert.match(p.acao, /Primeiros contatos automáticos bloqueados/)
      assert.equal(p.quem, 'você')
    }
  })
  it('recusa e exclusão prevalecem sobre próximo passo manual e oferta', () => {
    for (const tipo of ['negativa', 'exclusao'] as const) {
      const l = lead({ etapa: 'contato', sinal: 'respondeu', resposta: { tipo, trecho: 'Não contate' }, proximoPasso: { texto: 'Mandar oferta', data: '2026-11-17', registradoEm: '' } })
      const p = proximoDaJornada(l)
      assert.doesNotMatch(p.acao, /Mandar oferta/)
      assert.equal(p.marcadoAMao, undefined)
      assert.deepEqual(ofertaDoLead(l).agora, [])
      assert.deepEqual(ofertaDoLead(l).depois, [])
    }
  })
  it('silêncio não agenda follow-up automático nem expiração comercial', () => {
    const p = proximoDaJornada(lead({ etapa: 'contato', sinal: 'enviado', followupHoje: true, diasParaSair: 1 }))
    assert.match(p.acao, /Aguardar resposta ou o próximo passo combinado/)
    assert.equal(p.quando, undefined)
  })
})

describe('jornada: oferta cadastrada é hipótese, não diagnóstico automático', () => {
  const viuRaioX = { etapa: 'contato', sinal: 'respondeu-prumo', marcos: { segundaEnviada: '2026-10-15T12:00:00Z' } } as const
  it('Site antes e depois do Raio-X preserva hipótese sem impor diagnóstico', () => {
    for (const l of [lead({ sinal: 'pronto' }), lead({ ...viuRaioX })]) {
      const o = ofertaDoLead(l)
      assert.deepEqual(o.agora, [])
      assert.deepEqual(ids(o.depois), ['encontrado'])
      assert.match(o.depois[0].porque, /Hipótese.*Não exige Raio-X/)
      assert.ok(o.aConfirmar.some(t => t.startsWith('Necessidade')))
      assert.ok(o.aConfirmar.some(t => t.startsWith('Decisão')))
      assert.ok(o.aConfirmar.some(t => t.startsWith('Escopo')))
    }
  })
  it('PRUMO com equipe ou porte a confirmar não recebe Mapa/Fonte automaticamente', () => {
    for (const equipe of [true, undefined]) {
      const o = ofertaDoLead(lead({ ...viuRaioX, produto: 'prumo', equipe, porte: 'EPP' }))
      assert.deepEqual(o.agora, [])
      assert.deepEqual(ids(o.depois), ['respondido'])
      assert.ok(o.aConfirmar.some(t => t.startsWith('Mapa opcional')))
      assert.match(o.depois[0].porque, /Já ter site não comprova/)
    }
  })
  it('Mapa respondido mantém Fonte como avaliação e manutenção condicionada', () => {
    const o = ofertaDoLead(lead({ produto: 'prumo', etapa: 'contato', sinal: 'diagnostico' }))
    assert.deepEqual(o.agora, [])
    assert.match(o.depois.find(x => x.id === 'fonte')!.porque, /somente se a necessidade justificar/)
    assert.match(o.depois.find(x => x.id === 'fonte-em-dia')!.porque, /após Fonte contratada e os 30 dias/)
  })
  it('já temos site não provoca upsell de automação', () => {
    const o = ofertaDoLead(lead({ ...viuRaioX, resposta: { tipo: 'neutra', trecho: 'Já temos site' } }))
    assert.deepEqual(o.agora, [])
    assert.ok(!ids(o.depois).includes('respondido'))
  })
  it('Íris e estamparia preservam contexto de nicho e estados, sem abordagem automática', () => {
    for (const produto of ['iris', 'estampa'] as const) {
      const o = ofertaDoLead(lead({ produto }))
      assert.deepEqual(o.agora, [])
      assert.deepEqual(ids(o.depois), [produto === 'iris' ? 'iris' : 'crm-estamparia'])
      assert.match(o.depois[0].porque, produto === 'iris' ? /em uso/ : /em implantação/)
      assert.ok(o.aConfirmar.some(t => t.startsWith('Qualidade e operação')))
    }
  })
  it('Plus sem oferta não vira Site por padrão; com oferta mantém hipótese', () => {
    assert.deepEqual(ofertaDoLead(lead({ produto: 'plus' })).depois, [])
    assert.deepEqual(ids(ofertaDoLead(lead({ produto: 'plus', plus: { oferta: 'prumo', fixo: false, descricao: '' } })).depois), ['respondido'])
  })
  it('encerramento e ganho não recebem nova oferta', () => {
    for (const etapa of ['perdido', 'ganho'] as const) {
      const o = ofertaDoLead(lead({ etapa }))
      assert.deepEqual(o.agora, [])
      assert.deepEqual(o.depois, [])
    }
  })
})

describe('jornada: achados públicos preservam fatos, sem inferir compra', () => {
  const busca = 'dentista em Anápolis'
  const achados: AchadoDoRaioX[] = [
    { id: 'sem-site', consulta: busca, topoLidos: 3, topoComSite: 2 },
    { id: 'site-fora-do-ar', dominio: 'clinica.com.br' },
    { id: 'site-e-rede-social', rede: 'o Instagram' },
    { id: 'nota-baixa', nota: 4.1, consulta: busca, notasDoTopo: [4.8, 4.9, 5] },
    { id: 'poucas-avaliacoes', avaliacoes: 12, consulta: busca, medianaDaBusca: 80 },
    { id: 'sem-horario' },
    { id: 'posicao-na-busca', consulta: busca, lidos: 20 },
    { id: 'posicao-na-busca', consulta: busca, posicao: 7, lidos: 20 },
  ]
  for (const achado of achados) it(`${achado.id}: não seleciona automaticamente serviço`, () => {
    const o = ofertaDoLead(lead({ produto: 'prumo', achados: [achado] }))
    assert.deepEqual(o.agora, [])
    assert.deepEqual(ids(o.depois), ['respondido']) // Origem do cadastro, independente do achado.
    assert.ok(o.aConfirmar.some(t => t.includes(fraseDoAchado(achado)) && t.includes('não demonstra necessidade')))
    assert.doesNotMatch(o.depois[0].porque, /vira avaliação|Anúncios põem|O Encontrado resolve/)
  })
  it('Raio-X sem achados é consulta opcional, não gate comercial', () => {
    const o = ofertaDoLead(lead({ produto: 'prumo', links: { raioX: 'https://exemplo.test/raio-x' } }))
    assert.ok(o.aConfirmar.some(t => t.includes('consultar apenas se ajudar')))
    assert.deepEqual(o.agora, [])
  })

  it('a frase de cada ponto só diz o número que veio', () => {
    assert.equal(fraseDoAchado({ id: 'poucas-avaliacoes', avaliacoes: 1 }), '1 avaliação no Google')
    assert.equal(fraseDoAchado({ id: 'poucas-avaliacoes', avaliacoes: 0 }), 'nenhuma avaliação no Google')
    assert.equal(fraseDoAchado({ id: 'posicao-na-busca', consulta: busca }), 'fora dos primeiros em “dentista em Anápolis”')
    assert.equal(fraseDoAchado({ id: 'sem-site', consulta: busca, topoLidos: 3, topoComSite: 0 }), 'o perfil do Google não tem site')
    assert.equal(fraseDoAchado({ id: 'site-sem-celular-ou-whatsapp', dominio: 'x.com.br', celular: false, whatsapp: false }),
      'o site (x.com.br) não está pronto para celular e não tem botão de WhatsApp')
  })

  it('todo ponto que o Raio-X calcula tem um serviço do cardápio', () => {
    for (const [achado, servico] of Object.entries(OFERTA_DO_ACHADO)) assert.ok(CARDAPIO.some((s) => s.id === servico), achado)
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


it('regressão: Site com equipe mantém caminho histórico, sem impor Mapa e Fonte', () => {
  const l=lead({ produto:'site', equipe:true, etapa:'contato', sinal:'respondeu', marcos:{segundaEnviada:'2026-10-18T12:00:00Z'} })
  assert.ok(caminhoDoLead(l).includes('mapa'))
  assert.ok(!ofertaDoLead(l).agora.some(o=>o.id==='mapa'))
  assert.ok(ofertaDoLead(l).aConfirmar.some(t=>t.startsWith('Mapa opcional')))
  assert.match(proximoDaJornada(l).acao,/não exigir diagnóstico/)
})
