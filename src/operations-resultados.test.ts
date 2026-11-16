import './testes/politica-historica.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  amostraPequena, avisoDeHorario, chaveDe, enviadoNoPeriodo, enviosAnotados, faixaDoHorario, horaEmSP, leu, porcento, quisVer,
  respondeuDeGente, resultados, resumoDaLinha, taxaPorExpediente, textoDaSegunda, textoDoFollowup,
} from './operations/resultados.ts'
import { diagnosticoDeVenda } from './operations/por-que-nao-vende.ts'
import type { CrmLead } from './operations/types.ts'

const AGORA = Date.parse('2026-10-08T12:00:00Z')
const dias = (n: number) => new Date(AGORA - n * 864e5).toISOString()

const lead = (id: string, extra: Partial<CrmLead> = {}): CrmLead => ({
  id, produto: 'site', chave: id, empresa: id, nicho: 'advocacia', cidade: '', etapa: 'contato', sinal: 'enviado', subEtapa: '',
  estadoNaPlanilha: 'enviado', leitura: 'desconhecida', marcos: { enviado: dias(2) }, followupHoje: false, respostaNova: false,
  acervo: false, notas: 0, eventos: [], links: {}, divergencias: [], ...extra,
})

describe('resultados do funil', () => {
  const leads = [
    lead('viu', { marcos: { enviado: dias(2), visto: dias(1) } }),
    lead('quer', { etapa: 'contato', sinal: 'respondeu', marcos: { enviado: dias(3), respondeu: dias(2) }, resposta: { tipo: 'interesse', trecho: 'pode mandar' } }),
    lead('recusou', { nicho: 'dedetizadora', etapa: 'perdido', motivoPerda: 'recusou', marcos: { enviado: dias(5), respondeu: dias(4) },
      resposta: { tipo: 'negativa', trecho: 'não' }, abordagem: { mensagem: 'A', site: 'personalizado-v2' } }),
    lead('fechou', { etapa: 'ganho', marcos: { enviado: dias(20), respondeu: dias(19) }, abordagem: { mensagem: 'manual' } }),
    lead('robo', { marcos: { enviado: dias(1), respondeu: dias(1) }, resposta: { tipo: 'bot', trecho: '' } }),
    // Acervo de _recusados/ sem envio rastreado: não entra em nenhuma conta.
    lead('acervo', { etapa: 'perdido', motivoPerda: 'recusou', marcos: {} }),
    // Pronto, ainda não enviado.
    lead('pronto', { etapa: 'novo', sinal: 'pronto', marcos: {} }),
  ]

  it('só conta enviados no período, pela data de envio', () => {
    assert.equal(enviadoNoPeriodo(leads[3], '14', AGORA), false)
    assert.equal(enviadoNoPeriodo(leads[3], '30', AGORA), true)
    assert.equal(enviadoNoPeriodo(leads[5], 'tudo', AGORA), false)
    assert.equal(resultados(leads, 'nicho', '14', AGORA).total.enviados, 4)
    assert.equal(resultados(leads, 'nicho', 'tudo', AGORA).total.enviados, 5)
  })

  it('por nicho: viu inclui quem respondeu, robô não é resposta, recusa só entre enviados, fechou conta interesse', () => {
    const { linhas, total } = resultados(leads, 'nicho', 'tudo', AGORA)
    assert.deepEqual(linhas.map(l => l.chave), ['advocacia', 'dedetizadora'])
    assert.deepEqual(linhas[0], { chave: 'advocacia', enviados: 4, viram: 3, responderam: 2, interesse: 2, recusaram: 0, fecharam: 1 })
    assert.deepEqual(total, { chave: 'Total', enviados: 5, viram: 4, responderam: 3, interesse: 2, recusaram: 1, fecharam: 1 })
  })

  it('por mensagem e por versão: o que veio antes do registro fica num grupo próprio', () => {
    assert.equal(chaveDe(leads[2], 'mensagem'), 'Mensagem A')
    assert.equal(chaveDe(leads[3], 'mensagem'), 'Escrita à mão')
    assert.equal(chaveDe(leads[0], 'mensagem'), 'Sem registro (envios até 07/10)')
    assert.equal(chaveDe(leads[2], 'site'), 'Site personalizado-v2')
    assert.equal(chaveDe(lead('x', { abordagem: { mensagem: 'EN' } }), 'mensagem'), 'Em inglês')
    assert.equal(chaveDe(lead('y', { nicho: '  ' }), 'nicho'), 'Sem nicho')
  })

  it('por mensagem, sem letra: o regime pela data separa link na 1ª de pedido de licença; a letra continua mandando', () => {
    const casos: Array<[CrmLead['abordagem'], string]> = [
      [{ regime: 'curta_com_link' }, 'Com link na 1ª mensagem (curta, até 29/09)'],
      [{ regime: 'prumo_com_link' }, 'Com link na 1ª mensagem (30/09 a 04/10)'],
      [{ regime: 'duas_mensagens' }, 'Pedido de licença, sem link'],
      [{ mensagem: 'A', regime: 'duas_mensagens' }, 'Mensagem A'],
      [{ mensagem: 'manual', regime: 'duas_mensagens' }, 'Escrita à mão'],
      [undefined, 'Sem registro (envios até 07/10)'],
    ]
    for (const [abordagem, esperado] of casos) assert.equal(chaveDe(lead('r', abordagem ? { abordagem } : {}), 'mensagem'), esperado)
    const leads = [
      lead('l1', { abordagem: { regime: 'prumo_com_link' } }), lead('l2', { abordagem: { regime: 'prumo_com_link' } }),
      lead('l3', { abordagem: { regime: 'duas_mensagens' }, marcos: { enviado: dias(1), respondeu: dias(0.5) } }),
      lead('l4', { abordagem: { mensagem: 'B', regime: 'duas_mensagens' } }),
    ]
    assert.deepEqual(resultados(leads, 'mensagem', 'tudo', AGORA).linhas.map(l => `${l.chave}:${l.enviados}:${l.responderam}`),
      ['Com link na 1ª mensagem (30/09 a 04/10):2:0', 'Mensagem B:1:0', 'Pedido de licença, sem link:1:1'])
  })
})

describe('follow-up e 2ª mensagem anotados (14/10/2026)', () => {
  const fu = (id: string, followup: number, extra: Partial<CrmLead> = {}) =>
    lead(id, { ...extra, marcos: { enviado: dias(5), followupEnviado: dias(followup), ...extra.marcos } })
  const leads = [
    fu('respondeu-depois', 2, { marcos: { respondeu: dias(1) } }),
    fu('respondeu-antes', 2, { marcos: { respondeu: dias(3) } }),
    fu('classificada-depois', 2, { resposta: { tipo: 'neutra', trecho: 'quanto?', em: dias(1) } }),
    fu('robo-depois', 2, { resposta: { tipo: 'bot', trecho: '', em: dias(1) } }),
    fu('calado', 2),
    lead('quer-com-link', { marcos: { enviado: dias(3), respondeu: dias(2), segundaEnviada: dias(1) }, resposta: { tipo: 'interesse', trecho: 'manda' } }),
    lead('quer-sem-link', { marcos: { enviado: dias(3), respondeu: dias(2) }, resposta: { tipo: 'interesse', trecho: 'pode sim' } }),
    lead('fora-do-periodo', { marcos: { enviado: dias(40), followupEnviado: dias(37) } }),
  ]

  it('conta follow-ups do período e quem respondeu (gente) depois; 2ª mensagem entre quem quis ver', () => {
    assert.deepEqual(enviosAnotados(leads, '30', AGORA), { followups: 5, responderamDepois: 2, quiseramVer: 2, segundas: 1 })
    assert.equal(enviosAnotados(leads, 'tudo', AGORA).followups, 6)
  })

  it('texto com a taxa e o aviso de amostra pequena; sem anotação, diz desde quando existe', () => {
    assert.equal(textoDoFollowup(enviosAnotados(leads, '30', AGORA)), 'Follow-up anotado em 5: 2 responderam depois (40%), amostra pequena.')
    assert.equal(textoDoFollowup({ followups: 10, responderamDepois: 1, quiseramVer: 0, segundas: 0 }), 'Follow-up anotado em 10: 1 respondeu depois (10%).')
    assert.match(textoDoFollowup({ followups: 0, responderamDepois: 0, quiseramVer: 0, segundas: 0 }), /^Nenhum follow-up anotado neste período \(a anotação começou em 14\/10\/2026\)\.$/)
    assert.equal(textoDaSegunda({ followups: 0, responderamDepois: 0, quiseramVer: 2, segundas: 1 }), '2ª mensagem anotada para 1 de 2 que quiseram ver.')
    assert.equal(textoDaSegunda({ followups: 0, responderamDepois: 0, quiseramVer: 0, segundas: 0 }), 'Ninguém disse que quer ver neste período.')
  })

  it('texto: plural certo, porcentagem inteira e sem taxa quando não há envio', () => {
    assert.equal(porcento(1, 3), '33%')
    assert.equal(porcento(0, 0), '—')
    assert.equal(resumoDaLinha({ chave: 'x', enviados: 4, viram: 1, responderam: 1, interesse: 1, recusaram: 1, fecharam: 1 }),
      '1 respondeu (25%) · 1 leu · 1 quis ver · 1 recusou · 1 ganhou')
    assert.equal(resumoDaLinha({ chave: 'x', enviados: 10, viram: 0, responderam: 2, interesse: 2, recusaram: 0, fecharam: 0 }),
      '2 responderam (20%) · 0 leram · 2 quiseram ver · 0 recusaram · 0 ganharam')
    assert.equal(amostraPequena({ chave: 'x', enviados: 9, viram: 0, responderam: 0, interesse: 0, recusaram: 0, fecharam: 0 }), true)
  })
})

describe('horário do envio', () => {
  const em = (iso: string) => Date.parse(iso)

  it('hora e dia em São Paulo, qualquer que seja o fuso da máquina', () => {
    assert.deepEqual(horaEmSP(em('2026-10-08T12:00:00Z')), { hora: 9, diaDaSemana: 4 })
    assert.deepEqual(horaEmSP(em('2026-10-09T03:00:00Z')), { hora: 0, diaDaSemana: 5 })
  })

  it('faixas na ordem do dia, e o placar por horário segue essa ordem', () => {
    assert.equal(faixaDoHorario(em('2026-10-08T12:00:00Z')), 'Manhã (8h–12h)')
    assert.equal(faixaDoHorario(em('2026-10-08T22:00:00Z')), 'Noite (18h–21h)')
    assert.equal(faixaDoHorario(em('2026-10-09T03:00:00Z')), 'Madrugada (21h–8h)')
    const leads = [
      lead('noite', { marcos: { enviado: '2026-10-07T22:00:00Z' } }),
      lead('noite2', { marcos: { enviado: '2026-10-07T23:00:00Z' } }),
      lead('manha', { marcos: { enviado: '2026-10-07T12:00:00Z' } }),
    ]
    assert.deepEqual(resultados(leads, 'horario', 'tudo', AGORA).linhas.map(l => l.chave), ['Manhã (8h–12h)', 'Noite (18h–21h)'])
  })

  it('aviso só fora do expediente, com a taxa medida dentro e fora; com pouca amostra, sem número', () => {
    const dentro = Array.from({ length: 12 }, (_, i) => lead(`d${i}`, {
      marcos: { enviado: '2026-10-07T13:00:00Z', ...(i < 3 ? { respondeu: '2026-10-07T15:00:00Z' } : {}) },
    }))
    const fora = Array.from({ length: 10 }, (_, i) => lead(`f${i}`, { marcos: { enviado: '2026-10-06T22:30:00Z' } }))
    const madrugada = em('2026-10-08T04:10:00Z')
    assert.equal(avisoDeHorario([...dentro, ...fora], em('2026-10-08T13:00:00Z')), null)
    const aviso = avisoDeHorario([...dentro, ...fora], madrugada) ?? ''
    assert.match(aviso, /Fora dele, 10 envios do Site tiveram 0 respostas \(0%\); dentro, 25% responderam\.$/)
    const pouco = avisoDeHorario([...dentro, ...fora.slice(0, 4)], madrugada) ?? ''
    assert.match(pouco, /costuma ficar sem resposta\.$/)
    assert.doesNotMatch(pouco, /%/)
  })

  it('AC-03: a Próxima venda (todos os leads) e a Triagem (só o Site) dão a mesma taxa', () => {
    const dentro = Array.from({ length: 10 }, (_, i) => lead(`d${i}`, {
      marcos: { enviado: '2026-10-07T13:00:00Z', ...(i < 2 ? { respondeu: '2026-10-07T15:00:00Z' } : {}) },
    }))
    const fora = Array.from({ length: 10 }, (_, i) => lead(`f${i}`, { marcos: { enviado: '2026-10-06T22:30:00Z' } }))
    // Outras ofertas respondendo no expediente: antes, só a Próxima venda as contava (18 % × 20 %).
    const outras = Array.from({ length: 5 }, (_, i) => lead(`o${i}`, {
      produto: i % 2 ? 'prumo' : 'plus', marcos: { enviado: '2026-10-07T13:00:00Z' },
    }))
    const todos = [...dentro, ...fora, ...outras]
    const madrugada = em('2026-10-08T04:10:00Z')
    const proximaVenda = avisoDeHorario(todos, madrugada)
    const triagem = avisoDeHorario(todos.filter(l => l.produto === 'site'), madrugada)
    assert.equal(proximaVenda, triagem)
    assert.match(proximaVenda ?? '', /dentro, 20% responderam/)
    assert.deepEqual([taxaPorExpediente(todos, madrugada).dentro.enviados, taxaPorExpediente(todos, madrugada).fora.enviados], [10, 10])
  })
})

describe('uma regra por métrica (AC-03): o funil e o placar de Números contam igual', () => {
  const AGORA_17 = Date.parse('2026-10-17T11:15:00Z')
  const d = (n: number) => new Date(AGORA_17 - n * 864e5).toISOString()
  // Uma linha por caso que separava os dois números em 17/10/2026.
  const CASOS: Array<{ nome: string; lead: Partial<CrmLead>; leu: boolean; respondeu: boolean; quisVer: boolean }> = [
    { nome: 'só recibo', lead: { marcos: { enviado: d(3), visto: d(2) }, leitura: 'viu' }, leu: true, respondeu: false, quisVer: false },
    { nome: 'respondeu_em sem classificação (o funil não contava)', lead: { marcos: { enviado: d(3), respondeu: d(2) }, leitura: 'pela-resposta' },
      leu: true, respondeu: true, quisVer: false },
    { nome: 'classificada sem respondeu_em (o placar não contava)', lead: { marcos: { enviado: d(3) }, resposta: { tipo: 'interesse', trecho: 'manda' } },
      leu: true, respondeu: true, quisVer: true },
    { nome: 'só o robô (o funil contava como leitura)', lead: { marcos: { enviado: d(3) }, leitura: 'pela-resposta', resposta: { tipo: 'bot', trecho: '' } },
      leu: false, respondeu: false, quisVer: false },
    { nome: 'Plus: respondeu anotado, sem recibo nem classificação', lead: { produto: 'plus', marcos: { enviado: d(3), respondeu: d(1) }, leitura: 'pela-resposta' },
      leu: true, respondeu: true, quisVer: false },
    { nome: 'fechou sem resposta registrada não é "quero ver"', lead: { etapa: 'ganho', marcos: { enviado: d(10) } }, leu: false, respondeu: false, quisVer: false },
    { nome: 'proposta com resposta', lead: { etapa: 'proposta', marcos: { enviado: d(10), respondeu: d(9) } }, leu: true, respondeu: true, quisVer: true },
    { nome: 'sem recibo: não sei, não "não leu"', lead: { marcos: { enviado: d(3) } }, leu: false, respondeu: false, quisVer: false },
  ]
  for (const c of CASOS) {
    it(c.nome, () => {
      const l = lead(c.nome, c.lead)
      assert.deepEqual([leu(l), respondeuDeGente(l), quisVer(l)], [c.leu, c.respondeu, c.quisVer])
    })
  }

  it('o mesmo conjunto dá o mesmo número na barra e no resumo, na mesma janela de 30 dias', () => {
    const leads = [
      ...CASOS.map(c => lead(c.nome, c.lead)),
      // Na borda da janela: 29 entra nas duas, 31 em nenhuma.
      lead('dia-29', { marcos: { enviado: d(29), visto: d(28) } }),
      lead('dia-31', { marcos: { enviado: d(31), respondeu: d(30) } }),
    ]
    const barra = Object.fromEntries(diagnosticoDeVenda(leads, AGORA_17).degraus.map(g => [g.id, g.n]))
    const { total } = resultados(leads, 'nicho', '30', AGORA_17)
    assert.deepEqual(
      { enviados: barra.enviados, leram: barra.leram, responderam: barra.responderam, interesse: barra.interesse },
      { enviados: total.enviados, leram: total.viram, responderam: total.responderam, interesse: total.interesse },
    )
    assert.deepEqual([total.enviados, total.viram, total.responderam, total.interesse], [9, 6, 4, 2])
  })
})

describe('a licença nunca encolhe o "quero ver" (revisão de 17/10/2026)', () => {
  // Até 17/10 o "pode mandar" do Site era gravado como interesse; o tipo novo não pode tirar ninguém das contagens.
  const comTipo = (id: string, tipo: 'interesse' | 'licenca', extra: Partial<CrmLead> = {}) => lead(id, {
    sinal: 'respondeu', marcos: { enviado: dias(3), respondeu: dias(2), ...(extra.marcos ?? {}) },
    resposta: { tipo, trecho: 'pode mandar', em: dias(2) }, ...extra,
  })
  for (const tipo of ['interesse', 'licenca'] as const) {
    it(`${tipo}: conta em "quiseram ver" e na 2ª mensagem anotada`, () => {
      const leads = [comTipo('a', tipo, { marcos: { enviado: dias(3), respondeu: dias(2), segundaEnviada: dias(1) } }), comTipo('b', tipo)]
      const a = enviosAnotados(leads, 'tudo', AGORA)
      assert.equal(a.quiseramVer, 2)
      assert.equal(a.segundas, 1)
      assert.equal(resultados(leads, 'nicho', 'tudo', AGORA).total.interesse, 2)
    })
    it(`${tipo}: o degrau "Disseram quero ver" e o "Receberam a 2ª mensagem" do diagnóstico`, () => {
      const leads = [comTipo('a', tipo, { marcos: { enviado: dias(3), respondeu: dias(2), segundaEnviada: dias(1) } }), comTipo('b', tipo)]
      const d = diagnosticoDeVenda(leads, AGORA)
      const n = (id: string) => d.degraus.find((g) => g.id === id)?.n
      assert.equal(n('interesse'), 2)
      assert.equal(n('segunda'), 1)
      assert.equal(d.interessadosParados, 1)
    })
  }
})
