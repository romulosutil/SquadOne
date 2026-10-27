/** Política do bundle da aplicação; o laboratório tem seu próprio build e dependências. */
export function validarRenderizadorPadrao(modulos: Iterable<string>): void {
  const ids = [...modulos].map(id => id.replace(/\\/g, '/').split('?')[0].toLowerCase())
  const experimental = ids.find(id => /(^|\/)node_modules\/pixi\.js(\/|$)/.test(id) || id.includes('/prototypes/escritorio-pixi/'))
  if (experimental) throw new Error('O build principal da Central usa DOM/CSS. PixiJS deve permanecer no laboratório isolado, fora do grafo da aplicação: ' + experimental)
  if (!ids.some(id => id.endsWith('/src/office/renderizador-dom.ts'))) throw new Error('O build principal precisa incluir o renderizador DOM do escritório.')
}
