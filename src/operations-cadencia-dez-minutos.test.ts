import './testes/politica-historica.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { REGRAS_DO_RITMO, ritmoDoEnvio, tetoDoDia, instantesDePrimeiroContato, somarPrimeiros } from './operations/trava-de-ritmo.ts'

const MIN = 60_000
const inicio = Date.parse('2026-11-12T08:00:00-03:00')

test('cadência autorizada: aguarda dez minutos completos entre primeiros contatos', () => {
  assert.equal(REGRAS_DO_RITMO.intervaloMs, 10 * MIN)
  const r = ritmoDoEnvio([inicio], inicio + 10 * MIN - 1)
  assert.equal(r.motivo, 'intervalo')
  assert.equal(r.ate, inicio + 10 * MIN)
  assert.equal(ritmoDoEnvio([inicio], inicio + 10 * MIN).motivo, null)
})

test('seis por hora sustentam dez minutos; o teto anterior de dois não pode reter o terceiro', () => {
  assert.equal(REGRAS_DO_RITMO.porHora, 6)
  const envios: number[] = []
  for (let i = 0; i < 7; i++) {
    const agora = inicio + i * 10 * MIN
    assert.equal(ritmoDoEnvio(envios, agora).motivo, null, `contato ${i + 1}`)
    envios.push(agora)
  }
  const seis = Array.from({ length: 6 }, (_, i) => inicio + i * 10 * MIN)
  assert.equal(ritmoDoEnvio(seis, inicio + 60 * MIN - 1).motivo, 'hora')
  assert.equal(ritmoDoEnvio(seis, inicio + 60 * MIN).motivo, null)
})

test('vinte por dia permanecem limitados e o novo intervalo continua amanhã', () => {
  const envios = Array.from({ length: 20 }, (_, i) => inicio + i * 10 * MIN)
  assert.equal(tetoDoDia(inicio), 20)
  assert.equal(ritmoDoEnvio(envios, inicio + 200 * MIN).motivo, 'dia')
  const amanha = inicio + 24 * 60 * MIN
  assert.equal(ritmoDoEnvio(envios, amanha).motivo, null)
  assert.equal(ritmoDoEnvio([amanha], amanha + 10 * MIN - 1).motivo, 'intervalo')
  assert.equal(ritmoDoEnvio([amanha], amanha + 10 * MIN).motivo, null)
})

test('Central e Telegram compartilham o intervalo e a pausa continua tendo precedência', () => {
  const primeiros = somarPrimeiros({ 'site:a': { em: inicio } }, { 'site:b': { em: inicio + 10 * MIN } })
  const instantes = instantesDePrimeiroContato([], primeiros)
  assert.equal(ritmoDoEnvio(instantes, inicio + 20 * MIN - 1).motivo, 'intervalo')
  assert.equal(ritmoDoEnvio(instantes, inicio + 20 * MIN).motivo, null)
  const regras = { ...REGRAS_DO_RITMO, pausadoAte: new Date(inicio + 60 * MIN).toISOString() }
  assert.equal(ritmoDoEnvio(instantes, inicio + 20 * MIN, regras).motivo, 'pausa')
})
