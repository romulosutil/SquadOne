import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  amostraPequena, avisoDeHorario, chaveDe, enviadoNoPeriodo, faixaDoHorario, horaEmSP, noHorarioComercial, porcento, resultados, resumoDaLinha,
} from './operations/resultados.ts'
import type { CrmLead } from './operations/types.ts'

const AGORA = Date.parse('2026-10-08T12:00:00Z')
const dias = (n: number) => new Date(AGORA - n * 864e5).toISOString()

const lead = (id: string, extra: Partial<CrmLead> = {}): CrmLead => ({
  id, produto: 'site', chave: id, empresa: id, nicho: 'advocacia', cidade: '', etapa: 'contatado', sinal: 'enviado', subEtapa: '',
  estadoNaPlanilha: 'enviado', leitura: 'desconhecida', marcos: { enviado: dias(2) }, followupHoje: false, respostaNova: false,
  acervo: false, notas: 0, eventos: [], links: {}, divergencias: [], ...extra,
})

describe('resultados do funil', () => {
  const leads = [
    lead('viu', { marcos: { enviado: dias(2), visto: dias(1) } }),
    lead('quer', { etapa: 'conversando', marcos: { enviado: dias(3), respondeu: dias(2) }, resposta: { tipo: 'interesse', trecho: 'pode mandar' } }),
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

  it('texto: plural certo, porcentagem inteira e sem taxa quando não há envio', () => {
    assert.equal(porcento(1, 3), '33%')
    assert.equal(porcento(0, 0), '—')
    assert.equal(resumoDaLinha({ chave: 'x', enviados: 4, viram: 1, responderam: 1, interesse: 1, recusaram: 1, fecharam: 1 }),
      '1 respondeu (25%) · 1 viu · 1 quis ver · 1 recusou · 1 fechou')
    assert.equal(resumoDaLinha({ chave: 'x', enviados: 10, viram: 0, responderam: 2, interesse: 2, recusaram: 0, fecharam: 0 }),
      '2 responderam (20%) · 0 viram · 2 quiseram ver · 0 recusaram · 0 fecharam')
    assert.equal(amostraPequena({ chave: 'x', enviados: 9, viram: 0, responderam: 0, interesse: 0, recusaram: 0, fecharam: 0 }), true)
  })
})

describe('horário do envio', () => {
  const em = (iso: string) => Date.parse(iso)

  it('hora e dia em São Paulo, qualquer que seja o fuso da máquina', () => {
    assert.deepEqual(horaEmSP(em('2026-10-08T12:00:00Z')), { hora: 9, diaDaSemana: 4 })
    assert.deepEqual(horaEmSP(em('2026-10-09T03:00:00Z')), { hora: 0, diaDaSemana: 5 })
  })

  it('expediente: seg–sex 8h–18h, sábado 8h–12h, domingo nunca', () => {
    assert.equal(noHorarioComercial(em('2026-10-08T11:00:00Z')), true, 'quinta 8h')
    assert.equal(noHorarioComercial(em('2026-10-08T21:00:00Z')), false, 'quinta 18h')
    assert.equal(noHorarioComercial(em('2026-10-10T14:00:00Z')), true, 'sábado 11h')
    assert.equal(noHorarioComercial(em('2026-10-10T16:00:00Z')), false, 'sábado 13h')
    assert.equal(noHorarioComercial(em('2026-10-11T13:00:00Z')), false, 'domingo 10h')
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
    assert.match(aviso, /Fora dele, 10 envios tiveram 0 respostas \(0%\); dentro, 25% responderam\.$/)
    const pouco = avisoDeHorario([...dentro, ...fora.slice(0, 4)], madrugada) ?? ''
    assert.match(pouco, /costuma ficar sem resposta\.$/)
    assert.doesNotMatch(pouco, /%/)
  })
})
