import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { resolverSprite } from './catalogoSprites'

describe('identidade visual do escritório', () => {
  it('nomes antigos do roster preservam personagem e cor entre mapa e retrato', () => {
    const chars = JSON.parse(readFileSync(new URL('../../public/sprites/craftpix.manifest.json', import.meta.url), 'utf8')).chars
    assert.deepEqual(resolverSprite('antigo', undefined, 3, chars), { sprite: 'wraith_01', hue: 150 })
    assert.deepEqual(resolverSprite('wraith_02', 280, 3, chars), { sprite: 'wraith_02', hue: 280 })
  })
  it('preserva os três personagens e suas animações com dimensões completas', () => {
    const manifesto = JSON.parse(readFileSync(new URL('../../public/sprites/craftpix.manifest.json', import.meta.url), 'utf8'))
    for (const id of ['wraith_01', 'wraith_02', 'wraith_03']) {
      const sprite = manifesto.chars[id]
      assert.ok(sprite, `Personagem ausente: ${id}`)
      for (const nome of ['idle', 'walk']) {
        const anim = sprite.anims[nome]
        const png = readFileSync(new URL(`../../public${anim.file}`, import.meta.url))
        assert.equal(png.toString('ascii', 1, 4), 'PNG')
        assert.equal(png.readUInt32BE(16), sprite.frameW * anim.frames, `${id}/${nome}: largura da animação`)
        assert.equal(png.readUInt32BE(20), sprite.frameH, `${id}/${nome}: altura do personagem`)
      }
    }
  })
  it('o mapa não usa personagens ou fallback em emojis', () => {
    const mapa = readFileSync(new URL('../components/GameMap.vue', import.meta.url), 'utf8')
    assert.doesNotMatch(mapa, /\p{Extended_Pictographic}/u)
    assert.doesNotMatch(mapa, /actor__emoji|EMOJI_POR_PAPEL/)
  })
})
