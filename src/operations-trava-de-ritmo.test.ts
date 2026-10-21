import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  REGRAS_DO_RITMO, gravarPrimeiros, instantesDePrimeiroContato, lerPrimeiros, marcarPrimeiro, ritmoDoEnvio, tetoDoDia, textoDoRitmo, somarPrimeiros,
  type RegrasDoRitmo,
} from './operations/trava-de-ritmo.ts'
import type { CrmLead } from './operations/types.ts'
import { noExpedienteDeVenda } from './operations/trava-de-horario.ts'

const MIN = 60_000
const REGRAS: RegrasDoRitmo = { intervaloMs: 4 * MIN, porHora: 8, tetosPorSemana: [10, 20, 30], inicioDoNumero: '2026-10-16', pausadoAte: null }
/** Hora de São Paulo num dia de outubro de 2026. */
const sp = (dia: string, hm: string) => Date.parse(`2026-10-${dia}T${hm}:00-03:00`)

describe('trava de ritmo dos primeiros contatos', () => {
  it('o caso de 15/10/2026: 25 envios em 25 min viram 1 a cada 4 min, 8 por hora e 10 no dia', () => {
    const agora = sp('16', '08:30')
    assert.deepEqual(ritmoDoEnvio([], agora, REGRAS), { motivo: null, ate: null, enviadosHoje: 0, teto: 10 })
    // Um envio às 08:30: o próximo só às 08:34.
    const um = [agora]
    assert.deepEqual(ritmoDoEnvio(um, agora + 30_000, REGRAS), { motivo: 'intervalo', ate: agora + 4 * MIN, enviadosHoje: 1, teto: 10 })
    assert.equal(ritmoDoEnvio(um, agora + 4 * MIN, REGRAS).motivo, null, 'exatamente 4 min depois já pode')
    // Oito em 28 min (um a cada 4): o 9º espera o primeiro sair da janela de 60 min.
    const oito = Array.from({ length: 8 }, (_, i) => agora + i * 4 * MIN)
    const depois = agora + 35 * MIN
    assert.deepEqual(ritmoDoEnvio(oito, depois, REGRAS), { motivo: 'hora', ate: agora + 60 * MIN, enviadosHoje: 8, teto: 10 })
    assert.equal(ritmoDoEnvio(oito, agora + 60 * MIN, REGRAS).motivo, null)
    // Dez no dia: só amanhã, à meia-noite de São Paulo.
    const dez = Array.from({ length: 10 }, (_, i) => agora + i * 10 * MIN)
    assert.deepEqual(ritmoDoEnvio(dez, sp('16', '17:00'), REGRAS), { motivo: 'dia', ate: sp('17', '00:00'), enviadosHoje: 10, teto: 10 })
    assert.equal(ritmoDoEnvio(dez, sp('17', '08:00'), REGRAS).motivo, null, 'o dia seguinte zera a conta')
  })

  it('o teto sobe por semana desde o início do número', () => {
    assert.equal(tetoDoDia(sp('14', '12:00'), REGRAS), 10, 'antes do início vale o da 1ª semana')
    assert.equal(tetoDoDia(sp('16', '00:30'), REGRAS), 10)
    assert.equal(tetoDoDia(sp('22', '23:59'), REGRAS), 10, 'dia 7 ainda é a 1ª semana')
    assert.equal(tetoDoDia(sp('23', '00:01'), REGRAS), 20)
    assert.equal(tetoDoDia(sp('30', '09:00'), REGRAS), 30)
    assert.equal(tetoDoDia(Date.parse('2027-03-01T12:00:00-03:00'), REGRAS), 30, 'depois da última semana fica no último')
    assert.equal(tetoDoDia(sp('20', '09:00'), { ...REGRAS, inicioDoNumero: 'lixo' }), 10, 'data ilegível: o mais baixo')
  })

  it('o dia é o de São Paulo: 22h de ontem não conta no teto de hoje', () => {
    const ontem22h = sp('16', '22:00') // 01:00 UTC do dia 17
    const r = ritmoDoEnvio(Array(10).fill(ontem22h), sp('17', '08:00'), REGRAS)
    assert.equal(r.enviadosHoje, 0)
    assert.equal(r.motivo, null)
  })

  it('pausa segura tudo até a data, antes de qualquer outra conta', () => {
    const regras = { ...REGRAS, pausadoAte: '2026-10-19T08:00:00-03:00' }
    assert.deepEqual(ritmoDoEnvio([], sp('17', '10:00'), regras), { motivo: 'pausa', ate: sp('19', '08:00'), enviadosHoje: 0, teto: 10 })
    assert.equal(ritmoDoEnvio([], sp('19', '08:00'), regras).motivo, null)
    assert.equal(ritmoDoEnvio([], sp('17', '10:00'), { ...REGRAS, pausadoAte: 'lixo' }).motivo, null, 'pausa ilegível não trava')
  })

  it('instante inválido ou no futuro distante não conta', () => {
    const agora = sp('16', '10:00')
    assert.equal(ritmoDoEnvio([Number.NaN, agora + 2 * 60 * MIN], agora, REGRAS).motivo, null)
  })

  it('o texto diz até quando e por quê', () => {
    const agora = sp('16', '10:00')
    assert.match(textoDoRitmo(ritmoDoEnvio([agora], agora, REGRAS), REGRAS), /sai às 10:04 \(intervalo interno de 4 min entre contatos/)
    assert.match(textoDoRitmo(ritmoDoEnvio(Array(10).fill(agora), agora, REGRAS), REGRAS), /10 de 10/)
    assert.equal(textoDoRitmo(ritmoDoEnvio([], agora, REGRAS), REGRAS), '0 de 10 primeiros contatos hoje (enviados ou convites abertos).')
  })

  it('o teto atual é 10 em todas as semanas, sem aumento pela idade do número', () => {
    assert.equal(REGRAS_DO_RITMO.inicioDoNumero, '2026-10-16')
    for (const dia of ['18', '19', '23', '30']) assert.equal(tetoDoDia(sp(dia, '08:00')), 10)
    assert.equal(tetoDoDia(Date.parse('2027-03-01T12:00:00-03:00')), 10)
    assert.equal(REGRAS_DO_RITMO.pausadoAte, null)
  })

  it('permite 10 contatos distribuídos no expediente e barra o 11º até o dia seguinte', () => {
    const inicio = sp('19', '08:00')
    const enviados: number[] = []
    for (let i = 0; i < 10; i++) {
      const agora = inicio + i * 15 * MIN
      assert.equal(noExpedienteDeVenda(agora), true)
      assert.equal(ritmoDoEnvio(enviados, agora).motivo, null, `contato ${i + 1}`)
      enviados.push(agora)
      if (i < 9) assert.notEqual(ritmoDoEnvio(enviados, agora + MIN).motivo, null, 'não libera rajada')
    }
    assert.equal(enviados[9], sp('19', '10:15'))
    assert.deepEqual(ritmoDoEnvio(enviados, sp('19', '10:30')), {
      motivo: 'dia', ate: sp('20', '00:00'), enviadosHoje: 10, teto: 10,
    })
    assert.equal(ritmoDoEnvio(enviados, sp('20', '08:00')).motivo, null)
  })

  it('o teto de 4 na hora e os 15 minutos seguram envios mesmo com cota diária disponível', () => {
    const agora = sp('19', '10:00')
    assert.equal(ritmoDoEnvio([agora], agora + 15 * MIN - 1).motivo, 'intervalo')
    assert.equal(ritmoDoEnvio([agora], agora + 15 * MIN).motivo, null)
    // Histórico de envios externos/importados mais próximos que o intervalo interno.
    const quatro = Array.from({ length: 4 }, (_, i) => agora + i * MIN)
    assert.deepEqual(ritmoDoEnvio(quatro, agora + 20 * MIN), {
      motivo: 'hora', ate: agora + 60 * MIN, enviadosHoje: 4, teto: 10,
    })
    assert.equal(ritmoDoEnvio(quatro, agora + 60 * MIN).motivo, null)
  })

  it('a pausa por restrição prevalece mesmo com o teto de 10', () => {
    const agora = sp('19', '10:00')
    const ate = sp('22', '10:00')
    assert.deepEqual(ritmoDoEnvio([], agora, { ...REGRAS_DO_RITMO, pausadoAte: new Date(ate).toISOString() }), {
      motivo: 'pausa', ate, enviadosHoje: 0, teto: 10,
    })
  })

  it('soma Central, Telegram e retrato sem duplicar o contato e sem oferecer o 11º', () => {
    const inicio = sp('19', '08:00')
    const toques = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`lead-${i}`, inicio + i * 15 * MIN]))
    const servidor = Object.fromEntries(Object.entries(toques).map(([id, em]) => [id, { em }]))
    const leads = Object.entries(toques).map(([id, t]) => ({ id, sinal: 'enviado' as const, marcos: { enviado: new Date(t).toISOString() } }))
    const instantes = instantesDePrimeiroContato(leads, somarPrimeiros(servidor, toques))
    assert.equal(instantes.length, 10)
    assert.equal(ritmoDoEnvio(instantes, sp('19', '10:30')).motivo, 'dia')
  })
})

describe('de onde vêm os primeiros contatos', () => {
  const lead = (id: string, marcos: CrmLead['marcos'], sinal: CrmLead['sinal'] = 'enviado') => ({ id, sinal, marcos })
  const t = (hm: string) => sp('16', hm)
  const iso = (ms: number) => new Date(ms).toISOString()

  it('retrato: enviado de todo produto e o reenvio do só-robô; follow-up de quem leu não conta', () => {
    const leads = [
      lead('a', { enviado: iso(t('09:00')) }),
      lead('b', { enviado: iso(t('09:05')), followupEnviado: iso(t('09:30')) }), // follow-up de sempre
      lead('c', { enviado: iso(sp('14', '09:00')), followupEnviado: iso(t('09:40')) }, 'so-robo'), // reenvio
      lead('d', {}),
    ]
    assert.deepEqual(instantesDePrimeiroContato(leads, {}).sort(), [t('09:00'), t('09:05'), sp('14', '09:00'), t('09:40')].sort())
  })

  it('o toque desta tela conta até o retrato confirmar, sem contar duas vezes', () => {
    const leads = [lead('a', { enviado: iso(t('09:00') + 20_000) }), lead('b', {})]
    const toques = { a: t('09:00'), b: t('09:02'), sumiu: t('09:03') }
    // a: o retrato já tem (20 s depois do toque); b e o lead fora do retrato: só o toque.
    assert.deepEqual(instantesDePrimeiroContato(leads, toques).sort(), [t('09:00') + 20_000, t('09:02'), t('09:03')].sort())
    // Toque de reenvio num lead enviado dias atrás não é o mesmo envio.
    const antigo = [lead('c', { enviado: iso(sp('13', '09:00')) }, 'so-robo')]
    assert.equal(instantesDePrimeiroContato(antigo, { c: t('10:00') }).length, 2)
  })

  it('os toques ficam 24 h no storage e repetir não renova', () => {
    const agora = t('10:00')
    let guardado: string | null = null
    const storage = { getItem: () => guardado, setItem: (_: string, v: string) => { guardado = v } }
    const um = marcarPrimeiro({}, 'a', agora)
    assert.deepEqual(marcarPrimeiro(um, 'a', agora + MIN), { a: agora })
    gravarPrimeiros(storage, { ...um, velho: agora - 25 * 60 * MIN })
    assert.deepEqual(lerPrimeiros(storage, agora), { a: agora })
    guardado = 'não é json'
    assert.deepEqual(lerPrimeiros(storage, agora), {})
    const quebrado = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    assert.deepEqual(lerPrimeiros(quebrado, agora), {})
    assert.doesNotThrow(() => gravarPrimeiros(quebrado, um))
  })
})
