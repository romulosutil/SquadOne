import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const base = process.env.OFFICE_PROTOTYPE_URL || 'http://127.0.0.1:4178/'
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })
await context.addInitScript(() => {
  const pedir = window.requestAnimationFrame.bind(window), cancelar = window.cancelAnimationFrame.bind(window)
  const pendentes = new Set()
  window.requestAnimationFrame = callback => {
    const id = pedir(agora => { pendentes.delete(id); callback(agora) })
    pendentes.add(id); return id
  }
  window.cancelAnimationFrame = id => { pendentes.delete(id); cancelar(id) }
  window.__officePendingFrames = () => pendentes.size
})
const page = await context.newPage()
const errors = [], checks = []
page.on('pageerror', e => errors.push(e.stack))
async function ready(mode) {
  await page.goto(base + '?renderer=' + mode)
  await page.locator('.comparacao[data-pronto="true"]').waitFor()
  await page.locator('.actor__strip').first().waitFor({ state: 'attached' })
  if (mode === 'pixi') await page.waitForFunction(() => document.querySelectorAll('.actor[data-pixi]').length === 18)
}
try {
  for (const renderer of ['dom', 'pixi']) {
    await ready(renderer)
    await page.getByRole('button', { name: 'Simular passagem', exact: true }).click()
    await page.locator('.actor__intencao[data-carregando]').waitFor({ timeout: 15000 })
    const carrying = page.locator('.actor').filter({ has: page.locator('.actor__intencao[data-carregando]') })
    const before = await carrying.getAttribute('style')
    await page.waitForTimeout(350)
    assert.notEqual(await carrying.getAttribute('style'), before, renderer + ': o corpo percorre a rota')
    await carrying.locator('.actor__hit').focus(); await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: 'Jornada de cliente-0', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.comparacao')?.getAttribute('data-passagem') === '', { timeout: 30000 })
    assert.equal(await page.locator('.actor__intencao[data-carregando]').count(), 0)
    checks.push({ renderer, pathMoves: true, carryingOpensClient: true, completion: true })
  }
  await ready('dom')
  for (let i = 0; i < 4; i++) {
    await page.getByRole('combobox', { name: 'Renderizador', exact: true }).selectOption('pixi')
    await page.waitForFunction(() => document.querySelectorAll('.actor[data-pixi]').length === 18)
    assert.equal(await page.locator('canvas.pixi-corpos').count(), 1)
    await page.getByRole('combobox', { name: 'Renderizador', exact: true }).selectOption('dom')
    await page.waitForFunction(() => document.querySelectorAll('canvas.pixi-corpos').length === 0)
    assert.equal(await page.locator('.actor__hit').count(), 18)
    await page.waitForFunction(() => window.__officePendingFrames() === 0)
  }
  checks.push({ rendererSwitches: 8, leakedCanvases: 0, leakedAnimationFrames: 0 })
  await ready('pixi')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Animar', exact: true }).waitFor()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Reduzir movimento', exact: true }).waitFor()
  checks.push({ systemMotionChange: true })
  await page.route('**/sprites/wraith_01_walk.png', route => route.abort())
  await page.goto(base + '?renderer=pixi')
  await page.locator('[data-backend]').filter({ hasText: 'DOM de reserva' }).waitFor()
  assert.equal(await page.locator('.actor[data-pixi]').count(), 0)
  assert.equal(await page.locator('.actor__strip--idle').first().evaluate(el => getComputedStyle(el).visibility), 'visible')
  checks.push({ failedTextureFallsBackToDom: true })
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(error.stack)
  process.exitCode = 1
} finally {
  await mkdir(new URL('../../output/escritorio-pixi/qa/', import.meta.url), { recursive: true })
  const report = { checks, errors }
  await writeFile(new URL('../../output/escritorio-pixi/qa/lifecycle.json', import.meta.url), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
