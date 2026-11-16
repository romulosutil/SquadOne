import './testes/politica-historica.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { proximaAbertura, quandoFalado, recadoDasTravas, rotuloDoLiberar } from './operations/recado-de-travas.ts'
import { podeMandarPrimeiroContato } from './operations/trava-de-horario.ts'
import type { EstadoDoRitmo } from './operations/trava-de-ritmo.ts'

// 16/10/2026 é sexta, 17 sábado, 19 segunda (horário de São Paulo, UTC−3).
const em = (iso: string) => Date.parse(`${iso}-03:00`)
const livre: EstadoDoRitmo = { motivo: null, ate: null, enviadosHoje: 3, teto: 10 }

describe('proximaAbertura e quandoFalado: quando o expediente volta', () => {
  it('dentro do expediente é agora', () => {
    const t = em('2026-10-16T10:00:00')
    assert.equal(proximaAbertura(t), t)
  })

  it('antes das 8h de um dia útil é hoje às 8h; depois das 18h de quinta, amanhã', () => {
    const cedo = em('2026-10-15T06:30:00')
    assert.equal(proximaAbertura(cedo), em('2026-10-15T08:00:00'))
    assert.equal(quandoFalado(proximaAbertura(cedo)!, cedo), 'hoje às 8h')
    const noite = em('2026-10-15T19:00:00')
    assert.equal(quandoFalado(proximaAbertura(noite)!, noite), 'amanhã às 8h')
  })

  it('sexta à noite e o sábado inteiro pulam para segunda', () => {
    assert.equal(proximaAbertura(em('2026-10-16T17:30:00')), em('2026-10-16T17:30:00'))
    assert.equal(proximaAbertura(em('2026-10-16T17:59:00')), em('2026-10-16T17:59:00'))
    for (const t of [em('2026-10-16T18:00:00'), em('2026-10-17T11:00:00'), em('2026-10-18T23:59:00')]) {
      assert.equal(proximaAbertura(t), em('2026-10-19T08:00:00'))
    }
    assert.equal(quandoFalado(em('2026-10-19T08:00:00'), em('2026-10-17T11:00:00')), 'segunda às 8h')
  })

  it('hora quebrada vira "8h30"; instante inválido não tem abertura', () => {
    assert.equal(quandoFalado(em('2026-10-19T08:30:00'), em('2026-10-19T07:00:00')), 'hoje às 8h30')
    assert.equal(proximaAbertura(Number.NaN), null)
  })
})

describe('recadoDasTravas: um recado, o próximo passo', () => {
  const sexta = em('2026-10-16T10:00:00')
  const sabado = em('2026-10-17T11:00:00')

  it('no expediente com o ritmo livre: pode enviar agora, sem "continua"', () => {
    const r = recadoDasTravas({ agora: sexta, liberado: false, ritmo: livre, contexto: 'venda' })
    assert.equal(r.pode, true)
    assert.equal(r.trava, 'nenhuma')
    assert.equal(r.titulo, 'Pode enviar agora')
    assert.equal(r.continua, '')
    assert.equal(r.podeLiberar, false)
    assert.match(r.detalhe, /3 de 10/)
  })

  it('fora do expediente: diz quando volta, oferece o Liberar e carrega a taxa', () => {
    const r = recadoDasTravas({ agora: sabado, liberado: false, ritmo: livre, contexto: 'triagem', taxa: 'Fora dele, 0 de 29.' })
    assert.equal(r.pode, false)
    assert.equal(r.trava, 'horario')
    assert.equal(r.titulo, 'Fora do expediente: volta segunda às 8h')
    assert.equal(r.podeLiberar, true)
    assert.equal(r.continua, 'Dispensar continua livre.')
    assert.equal(r.detalhe, 'Fora dele, 0 de 29.')
    assert.equal(r.ate, em('2026-10-19T08:00:00'))
  })

  it('liberado fora do expediente: pode, e diz que é por liberação', () => {
    const r = recadoDasTravas({ agora: sabado, liberado: true, ritmo: livre, contexto: 'ficha' })
    assert.equal(r.pode, true)
    assert.equal(r.titulo, 'Liberado fora do expediente: pode enviar agora')
  })

  it('intervalo do ritmo: "Libera às HH:MM (ritmo)", sem Liberar', () => {
    const ate = em('2026-10-16T14:20:00')
    const r = recadoDasTravas({ agora: em('2026-10-16T14:17:00'), liberado: false, ritmo: { motivo: 'intervalo', ate, enviadosHoje: 4, teto: 10 }, contexto: 'venda' })
    assert.equal(r.titulo, 'Libera às 14:20 (ritmo)')
    assert.equal(r.trava, 'ritmo')
    assert.equal(r.podeLiberar, false)
    assert.equal(r.continua, 'Respostas, propostas e follow-ups seguem livres.')
    assert.equal(r.ate, ate)
  })

  it('o ritmo vem antes do horário: nada de Liberar, e avisa que depois ainda é fora do expediente', () => {
    const ate = em('2026-10-17T11:04:00')
    const r = recadoDasTravas({ agora: sabado, liberado: false, ritmo: { motivo: 'hora', ate, enviadosHoje: 8, teto: 10 }, contexto: 'triagem' })
    assert.equal(r.trava, 'ritmo')
    assert.equal(r.podeLiberar, false)
    assert.match(r.detalhe, /Depois disso ainda é fora do expediente/)
  })

  it('teto do dia na sexta: volta segunda às 8h (o teto zera à meia-noite, o expediente abre na segunda)', () => {
    const meiaNoite = em('2026-10-17T00:00:00')
    const r = recadoDasTravas({ agora: em('2026-10-16T15:00:00'), liberado: false, ritmo: { motivo: 'dia', ate: meiaNoite, enviadosHoje: 10, teto: 10 }, contexto: 'venda' })
    assert.equal(r.titulo, 'Teto de hoje (10 de 10): volta segunda às 8h')
    assert.equal(r.ate, em('2026-10-19T08:00:00'))
  })

  it('pausa: diz até quando, com a data', () => {
    const ate = em('2026-10-18T09:00:00')
    const r = recadoDasTravas({ agora: sexta, liberado: false, ritmo: { motivo: 'pausa', ate, enviadosHoje: 0, teto: 10 }, contexto: 'ficha' })
    assert.equal(r.titulo, 'Pausado até 18/10 09:00 (aviso do WhatsApp)')
    assert.equal(r.continua, 'Responder e o follow-up seguem livres.')
  })

  it('`pode` é sempre a regra das travas (podeMandarPrimeiroContato), em toda combinação', () => {
    const ritmos: EstadoDoRitmo[] = [livre, { motivo: 'intervalo', ate: sexta + 60_000, enviadosHoje: 1, teto: 10 }]
    for (const agora of [sexta, sabado]) for (const liberado of [false, true]) for (const ritmo of ritmos) {
      const r = recadoDasTravas({ agora, liberado, ritmo, contexto: 'venda' })
      const esperado = podeMandarPrimeiroContato({ noExpediente: agora === sexta, liberado, ritmoLivre: ritmo.motivo === null })
      assert.equal(r.pode, esperado, `${agora} ${liberado} ${ritmo.motivo}`)
      // Travado sempre diz o que continua; liberável só quando é o horário que segura.
      if (!r.pode) assert.ok(r.continua)
      assert.equal(r.podeLiberar, r.trava === 'horario')
    }
  })
})

describe('rotuloDoLiberar: quem sai da trava', () => {
  it('o lote na Triagem, o lead no cartão e na Ficha', () => {
    assert.equal(rotuloDoLiberar('triagem', { quantos: 7 }), 'Liberar este lote (7) mesmo assim')
    assert.equal(rotuloDoLiberar('triagem', { quantos: 1 }), 'Liberar mesmo assim')
    assert.equal(rotuloDoLiberar('venda', { empresa: 'Padaria Sol' }), 'Liberar Padaria Sol mesmo assim')
    assert.equal(rotuloDoLiberar('ficha'), 'Liberar este lead mesmo assim')
  })
})
