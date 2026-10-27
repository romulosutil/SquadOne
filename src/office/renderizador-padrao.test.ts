import { it } from 'node:test'
import assert from 'node:assert/strict'
import { validarRenderizadorPadrao } from '../../scripts/escritorio-renderizador-padrao'
const dom = '/repo/src/office/renderizador-dom.ts'
it('o grafo normal da aplicação conserva o DOM', () => assert.doesNotThrow(() => validarRenderizadorPadrao([dom,'/repo/node_modules/vue/index.js'])))
it('bloqueia PixiJS no grafo principal mesmo com DOM presente', () => assert.throws(() => validarRenderizadorPadrao([dom,'/repo/node_modules/pixi.js/lib/index.mjs']), /laboratório isolado/))
it('bloqueia o código do laboratório no bundle da Central', () => assert.throws(() => validarRenderizadorPadrao([dom,'/repo/prototypes/escritorio-pixi/renderizador-pixi.ts']), /laboratório isolado/))
it('normaliza caminhos Windows e consultas do bundler', () => assert.doesNotThrow(() => validarRenderizadorPadrao(['C:\\repo\\src\\office\\renderizador-dom.ts?import'])))
it('recusa um build que perdeu o renderizador padrão', () => assert.throws(() => validarRenderizadorPadrao(['/repo/src/main.ts']), /incluir o renderizador DOM/))
