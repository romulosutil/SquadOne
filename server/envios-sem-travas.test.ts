import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { criarRodadaComercial } from './rodada-comercial.ts'
import { lerFrente } from './frente-comercial.ts'
import { ritmoDoEnvio, textoDoRitmo, REGRAS_DO_RITMO } from '../src/operations/trava-de-ritmo.ts'
import { noExpedienteDeVenda, envioTravado } from '../src/operations/trava-de-horario.ts'
import type { CrmLead } from '../src/operations/types.ts'

test('política atual: cotas, intervalo, pausa antiga, noite, fim de semana e feriado não retêm envios', () => {
  for (const data of ['2026-11-13T23:00:00-03:00', '2026-11-14T03:00:00-03:00', '2026-11-15T12:00:00-03:00']) {
    const agora = Date.parse(data)
    const r = ritmoDoEnvio(Array(200).fill(agora), agora, { ...REGRAS_DO_RITMO, pausadoAte: '2027-01-01T00:00:00Z' })
    assert.equal(r.motivo, null)
    assert.equal(r.ate, null)
    assert.equal(r.enviadosHoje, 200)
    assert.match(textoDoRitmo(r), /Sem cota ou intervalo/)
    assert.equal(noExpedienteDeVenda(agora), true)
    assert.equal(envioTravado('fora de hora', new Set(), 'lead'), false)
  }
})

test('rodada atual: inicia sem revisão, passa de dez e conserva dedupe e reservas incertas após reinício', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'envios-livres-'))
  try {
    const arquivo = path.join(dir, 'rodada.json')
    const r = criarRodadaComercial(arquivo)
    const lead = (i: number) => ({ id: `site:${i}`, links: { whatsapp: `https://wa.me/55119988${String(i).padStart(4,'0')}` }, marcos: {} } as CrmLead)
    for (let i=0;i<21;i++) assert.equal((await r.reservar(lead(i), [], async () => ({ ok:true }))).ok, true)
    assert.equal((await r.status([])).bloqueado, false)
    assert.equal((await r.status([])).pendentes, 21)
    assert.equal((await r.status([])).limite, null)
    await assert.rejects(r.reservar(lead(99), [], async () => { throw new Error('resultado incerto') }))
    const novo = criarRodadaComercial(arquivo)
    let repetiu = false
    assert.equal((await novo.reservar(lead(99), [], async () => { repetiu=true;return { ok:true } })).ok, false)
    assert.equal(repetiu, false)
  } finally { await fs.rm(dir, { recursive:true, force:true }) }
})

test('API: informa ausência de limites sem exibir a antiga cota como vigente', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'estado-livre-'))
  try {
    await fs.writeFile(path.join(dir, 'frente-comercial.json'), JSON.stringify({ atualizadoEm: new Date().toISOString(), estado: 'pronto' }))
    const f = await lerFrente(dir)
    assert.equal(f.limite, null)
    assert.equal('intervaloMinutos' in f && f.intervaloMinutos, 0)
    assert.equal('porHora' in f && f.porHora, null)
  } finally { await fs.rm(dir, { recursive:true, force:true }) }
})
