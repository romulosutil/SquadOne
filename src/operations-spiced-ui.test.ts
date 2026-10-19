import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import { build } from 'esbuild'
import { spicedVazio } from './operations/spiced.ts'

// Renderizador Vue em memória: sem navegador, disco de cliente ou serviço real.
const arquivo = fileURLToPath(new URL('./operations/CrmSpiced.vue', import.meta.url))
const { descriptor } = parse(await fs.readFile(arquivo, 'utf8'))
const script = compileScript(descriptor, { id: 'spiced-ui-test', inlineTemplate: true })
const bundle = await build({ stdin: { contents: `${script.content}\nexport { createRenderer, nextTick } from 'vue'`, sourcefile: 'CrmSpiced.ts', resolveDir: path.dirname(arquivo), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', define: { 'process.env.NODE_ENV': '"test"' } })
const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'spiced-ui-'))
const modulo = path.join(pasta, 'componente.mjs')
await fs.writeFile(modulo, bundle.outputFiles[0].text)
const runtime = await import(pathToFileURL(modulo).href)
const documentAnterior = globalThis.Document
if (!documentAnterior) (globalThis as any).Document = class Document {}
if (!globalThis.ShadowRoot) (globalThis as any).ShadowRoot = class ShadowRoot {}
const novo = (type: string, text = '') => ({ type, text, tagName: type.toUpperCase(), children: [] as any[], props: {} as Record<string, any>, parent: null as any,
  addEventListener() {}, removeEventListener() {}, getRootNode() { return { activeElement: null } }, get options(): any[] { return this.children },
})
const renderer = runtime.createRenderer({
  createElement: novo, createText: (t: string) => novo('text', t), createComment: (t: string) => novo('comment', t),
  setText: (n: any, t: string) => { n.text = t }, setElementText: (n: any, t: string) => { n.text = t; n.children = [] },
  parentNode: (n: any) => n.parent, nextSibling: (n: any) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  insert: (n: any, p: any, a: any) => { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = p; const i = a ? p.children.indexOf(a) : -1; p.children.splice(i < 0 ? p.children.length : i, 0, n) },
  remove: (n: any) => { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1) },
  patchProp: (n: any, k: string, _a: unknown, b: unknown) => { n.props[k] = b; n[k] = b },
})
const todos = (n: any): any[] => [n, ...n.children.flatMap(todos)]
const texto = (n: any): string => n.text + n.children.map(texto).join('')
const lead = (id: string) => ({ id, chave: id, produto: 'site', spiced: spicedVazio() })
const montar = (id: string, extra = {}) => {
  const raiz = novo('root')
  const app = renderer.createApp(runtime.default, { lead: lead(id), disponivel: true, ...extra })
  const vm = app.mount(raiz)
  return { raiz, app, vm }
}

describe('Ficha SPICED: confirmação humana e rascunho', () => {
  it('ler sugestão e editar não grava; confirmar sugestões grava uma vez, sem liberar confirmado otimista', async () => {
    const anterior = globalThis.fetch
    const chamadas: unknown[] = []
    globalThis.fetch = (async (_url, opcoes) => { chamadas.push(JSON.parse(String(opcoes?.body))); return new Response('{}', { status: 200 }) }) as typeof fetch
    const { raiz, app } = montar('ui-confirmacao', { sugestao: { dor: { valor: 'Pedidos perdidos', citacao: 'Perco pedidos' } } })
    try {
      await runtime.nextTick()
      assert.equal(chamadas.length, 0)
      const confirmar = todos(raiz).find(n => n.type === 'button' && texto(n).includes('Confirmar sugestões exibidas'))
      await confirmar.props.onClick()
      await runtime.nextTick()
      assert.equal(chamadas.length, 1)
      const registro = chamadas[0] as any
      assert.equal(registro.tipo, 'spiced')
      assert.equal(JSON.parse(registro.texto).dor, 'Pedidos perdidos')
      assert.match(texto(raiz), /Dor: falta/)
      assert.match(texto(raiz), /Aguardando a confirmação/)
    } finally { app.unmount(); globalThis.fetch = anterior }
  })
  it('rascunho sobrevive a remontagem da Ficha e não aparece em outro lead', async () => {
    const primeira = montar('ui-rascunho')
    const campos = todos(primeira.raiz).filter(n => n.type === 'textarea')
    campos[1].props['onUpdate:modelValue']('Minha descoberta')
    await runtime.nextTick()
    primeira.app.unmount()
    const outra = montar('ui-outra')
    assert.equal(todos(outra.raiz).filter(n => n.type === 'textarea')[1].value, '')
    outra.app.unmount()
    const volta = montar('ui-rascunho')
    assert.equal(todos(volta.raiz).filter(n => n.type === 'textarea')[1].value, 'Minha descoberta')
    volta.app.unmount()
  })
})
