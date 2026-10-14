import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { avisoDeHorario } from './operations/resultados.ts'
import { envioTravado, liberarEnvio } from './operations/trava-de-horario.ts'
import type { CrmLead } from './operations/types.ts'

const AVISO = 'Agora é fora do expediente de quem recebe.'

describe('trava de horário do envio', () => {
  it('só trava com aviso, e só até liberar aquele lead', () => {
    const nenhum = new Set<string>()
    assert.equal(envioTravado(null, nenhum, 'a'), false, 'no expediente (sem aviso) nada trava')
    assert.equal(envioTravado(undefined, nenhum, 'a'), false)
    assert.equal(envioTravado('', nenhum, 'a'), false, 'aviso vazio não é aviso')
    assert.equal(envioTravado(AVISO, nenhum, 'a'), true)
    assert.equal(envioTravado(AVISO, new Set(['a']), 'a'), false)
    assert.equal(envioTravado(AVISO, new Set(['a']), 'b'), true, 'liberar um lead não libera os outros')
  })

  it('liberar devolve um conjunto novo e não altera o de entrada', () => {
    const antes = new Set(['a'])
    const depois = liberarEnvio(antes, 'b')
    assert.deepEqual([...antes], ['a'])
    assert.deepEqual([...depois].sort(), ['a', 'b'])
    assert.notEqual(antes, depois)
    assert.deepEqual([...liberarEnvio(depois, 'b')].sort(), ['a', 'b'], 'liberar de novo é inofensivo')
  })

  it('acompanha o relógio de São Paulo: 19h trava, 10h de quarta não', () => {
    const leads: CrmLead[] = []
    const as19h = Date.parse('2026-10-14T22:00:00Z') // quarta, 19h em São Paulo
    const as10h = Date.parse('2026-10-14T13:00:00Z') // quarta, 10h em São Paulo
    const domingo = Date.parse('2026-10-18T15:00:00Z') // domingo, 12h
    assert.equal(envioTravado(avisoDeHorario(leads, as19h), new Set(), 'a'), true)
    assert.equal(envioTravado(avisoDeHorario(leads, as10h), new Set(), 'a'), false)
    assert.equal(envioTravado(avisoDeHorario(leads, domingo), new Set(), 'a'), true)
  })
})
