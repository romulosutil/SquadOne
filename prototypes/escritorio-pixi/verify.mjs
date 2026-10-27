import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'

const output = fileURLToPath(new URL('../../output/escritorio-pixi/qa/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const report = { browser: await browser.version(), gpu: 'SwiftShader (software; não representa GPU de produção)',
  baselineAsset: 'Mesma imagem WebP e componente visual da esteira atuais nos dois lados; receberam alterações paralelas após o snapshot.',
  visual: [], interactions: [], benchmarks: [], errors: [] }
const base = process.env.OFFICE_PROTOTYPE_URL || 'http://127.0.0.1:4178/'
const benchmarkBase = process.env.OFFICE_BENCHMARK_URL || base
report.benchmarkBuild = process.env.OFFICE_BENCHMARK_URL ? 'Vite build otimizado, servido pelo preview' : 'Vite development (exploratório)'
const baselineAvailable = existsSync(new URL('../../output/escritorio-camadas-2026-10-26/baseline/src/components/GameMap.vue', import.meta.url))
report.baselineAvailable = baselineAvailable

async function ready(page, query = '', url = base) {
  await page.unroute('**/office/escritorio-cozy-v1.png')
  if (query.includes('baseline=1')) {
    const asset = await readFile(new URL('../../src/office/assets/escritorio-cozy-v1.webp', import.meta.url))
    await page.route('**/office/escritorio-cozy-v1.png', route => route.fulfill({ contentType: 'image/webp', body: asset }))
  }
  await page.goto(url + '?' + query)
  await page.locator('.comparacao[data-pronto="true"]').waitFor()
  await page.locator('.actor__strip').first().waitFor({ state: 'attached' })
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode().catch(() => {}))) })
  await page.waitForFunction(() => [...document.querySelectorAll('.actor')].every(el => el.style.transform.includes('translate3d')))
  await page.waitForTimeout(250)
  if (query.includes('renderer=pixi')) {
    await page.waitForFunction(() => document.querySelectorAll('.actor[data-pixi]').length === document.querySelectorAll('.actor').length)
  }
}
function difference(a, b) {
  const first = PNG.sync.read(a), second = PNG.sync.read(b)
  assert.equal(first.width, second.width); assert.equal(first.height, second.height)
  let pixels = 0, maximum = 0
  for (let i = 0; i < first.data.length; i += 4) {
    let changed = false
    for (let c = 0; c < 4; c++) { const delta = Math.abs(first.data[i + c] - second.data[i + c]); maximum = Math.max(maximum, delta); if (delta) changed = true }
    if (changed) pixels++
  }
  return { pixels, total: first.width * first.height, percent: +(100 * pixels / (first.width * first.height)).toFixed(4), maximum }
}
async function positions(page) {
  return page.locator('.actor').evaluateAll(els => els.map(el => ({ transform: el.style.transform, depth: el.style.zIndex,
    label: el.querySelector('button')?.getAttribute('aria-label') })))
}
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.stack ?? error.message))
    for (const scene of ['', '&scene=salas']) {
      const label = `${viewport.width}-${scene ? 'salas' : 'ilustracao'}`
      await ready(page, (baselineAvailable ? 'baseline=1&' : '') + 'freeze' + scene)
      if (baselineAvailable) assert.equal(await page.locator('.comparacao').getAttribute('data-referencia'), 'snapshot')
      const before = await page.locator('main').screenshot({ path: output + label + '-antes.png', animations: 'disabled' })
      const oldPositions = await positions(page)
      await ready(page, 'freeze' + scene)
      const after = await page.locator('main').screenshot({ path: output + label + '-depois.png', animations: 'disabled' })
      assert.deepEqual(await positions(page), oldPositions, `${label}: posições e nomes acessíveis`)
      const diff = difference(before, after)
      if (diff.pixels) {
        const a = PNG.sync.read(before), b = PNG.sync.read(after)
        for (let i = 0; i < a.data.length; i += 4) {
          const changed = [0,1,2,3].some(c => a.data[i+c] !== b.data[i+c])
          a.data[i] = changed ? 255 : 20; a.data[i+1] = changed ? 100 : 20; a.data[i+2] = changed ? 30 : 20; a.data[i+3] = 255
        }
        await writeFile(output + label + '-diff.png', PNG.sync.write(a))
      }
      if (baselineAvailable) {
        report.visual.push({ label, domBeforeAfter: diff })
        assert.ok(diff.pixels === 0 || diff.maximum <= 1 && diff.percent < .1, `${label}: diferença visual da refatoração`)
      }
      if (!scene) {
        await ready(page, 'renderer=pixi&freeze')
        const pixi = await page.locator('main').screenshot({ path: output + label + '-pixi.png', animations: 'disabled' })
        assert.deepEqual(await positions(page), oldPositions, `${label}: contrato de posições Pixi`)
        report.visual.push({ label, domPixi: difference(after, pixi) })
      }
    }
    for (const renderer of ['dom', 'pixi']) {
      await ready(page, `renderer=${renderer}&freeze`)
      const button = page.locator('.actor__hit').first()
      await button.focus(); await page.keyboard.press('Enter')
      await page.getByRole('dialog').waitFor(); await page.getByRole('button', { name: 'Fechar', exact: true }).click()
      await page.locator('.cena-tela--agentes').focus(); await page.keyboard.press('Enter')
      await page.getByRole('dialog', { name: 'Jornada do time', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Fechar', exact: true }).click()
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await page.locator('.actor__hit').count(), 18)
      if (viewport.width > 600) {
        await page.locator('.cena-tela--decisoes').click()
        await page.getByRole('dialog', { name: 'Sua vez', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Fechar', exact: true }).click()
      }
      await page.locator('.esteira-cena__placa').nth(2).focus(); await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.querySelector('[data-fase="3"]')?.getAttribute('data-selecionada') === 'true')
      await page.getByRole('button', { name: 'Simular passagem', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.comparacao')?.getAttribute('data-passagem') === '')
      report.interactions.push({ width: viewport.width, renderer, keyboardAgent: true, panelReturn: true, station: true, reducedMotion: true })
    }
    await context.close()
  }
  // Uma cena de cada vez. Aquecimento e observador de cadência iguais em ambos os modos.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.stack ?? error.message))
  for (const agents of [18, 60, 120]) for (const renderer of ['dom', 'pixi']) {
    await ready(page, `renderer=${renderer}&agents=${agents}`, benchmarkBase)
    await page.waitForTimeout(1000)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    const before = (await cdp.send('Performance.getMetrics')).metrics
    await page.getByRole('button', { name: 'Simular passagem', exact: true }).click()
    await page.getByRole('button', { name: 'Medir 5 segundos', exact: true }).click()
    await page.locator('[data-medicao]').waitFor({ timeout: 15000 })
    const after = (await cdp.send('Performance.getMetrics')).metrics
    const metric = (list, name) => list.find(m => m.name === name)?.value ?? 0
    report.benchmarks.push({ agents, renderer, ...JSON.parse(await page.locator('[data-medicao]').innerText()),
      mainThreadTaskMs: +((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000).toFixed(1),
      heapMiB: +(metric(after, 'JSHeapUsedSize') / 1024 ** 2).toFixed(1) })
    await cdp.detach()
    console.log(JSON.stringify(report.benchmarks.at(-1)))
  }
  await context.close()
  assert.deepEqual(report.errors, [], 'erros de execução no navegador')
} catch (error) {
  report.failure = error.stack
  process.exitCode = 1
} finally {
  await writeFile(output + 'report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
