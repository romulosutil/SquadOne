import type { CharSheet } from './modelo'

let leitura: Promise<Record<string, CharSheet>> | null = null
const POOL = ['wraith_01', 'wraith_02', 'wraith_03']
const CORES = [0, 150, 45, 280, 200, 320]
/** Mantém a mesma identidade no mapa e no retrato, inclusive para nomes antigos do roster. */
export function resolverSprite(sprite: string, hue: number | undefined, ordem: number, chars: Record<string, CharSheet> | null) {
  const proprio = sprite && (!chars || chars[sprite]) ? sprite : ''
  return {
    sprite: proprio || POOL[ordem % POOL.length],
    hue: hue ?? (proprio ? undefined : CORES[Math.floor(ordem / POOL.length) % CORES.length]),
  }
}

/** Um catálogo para mapa e retrato da sala; falha pode ser tentada novamente. */
export function carregarCatalogoSprites(): Promise<Record<string, CharSheet>> {
  if (!leitura) leitura = buscar().catch(e => { leitura = null; throw e })
  return leitura
}

async function buscar(): Promise<Record<string, CharSheet>> {
  const r = await fetch('/sprites/craftpix.manifest.json', { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const chars = (await r.json())?.chars
  if (!chars || !['wraith_01', 'wraith_02', 'wraith_03'].every(id =>
    chars[id]?.frameW > 0 && chars[id]?.frameH > 0 && chars[id]?.anims?.idle?.frames > 0 && chars[id]?.anims?.idle?.file && chars[id]?.anims?.walk?.file
  )) throw new Error('Catálogo de sprites incompleto')
  return chars
}
