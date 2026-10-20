import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import { build } from 'esbuild'
import { aarrDoLead, textoDoRegistroReceita, opcoesDeterministicasDeReceita } from './operations/aarr.ts'

// Componentes reais, sem navegador nem rede: o renderizador exercita os eventos e os mesmos serializers.
async function componente(nome: string) {
  const arquivo = path.resolve('src/operations', nome + '.vue')
  const { descriptor } = parse(await fs.readFile(arquivo, 'utf8'), { filename: arquivo })
  const script = compileScript(descriptor, { id: nome, inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } })
  const bundle = await build({ stdin: { contents: `${script.content}\nexport { createRenderer, nextTick, reactive, h } from 'vue'`, resolveDir: path.dirname(arquivo), sourcefile: nome + '.ts', loader: 'ts' },
    plugins: [{ name: 'vue-real', setup(b) { b.onLoad({ filter: /\.vue$/ }, async ({ path: caminho }) => { const { descriptor: d } = parse(await fs.readFile(caminho, 'utf8'), { filename: caminho }); return { contents: compileScript(d, { id: caminho, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(caminho) } }) } }],
    bundle: true, write: false, platform: 'node', format: 'esm', define: { 'process.env.NODE_ENV': '"test"' } })
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'receita-ui-'))
  const modulo = path.join(pasta, 'componente.mjs'); await fs.writeFile(modulo, bundle.outputFiles[0].text)
  const runtime = await import(pathToFileURL(modulo).href)
  const novo = (type: string, text = '') => ({ type, text, tagName: type.toUpperCase(), children: [] as any[], props: {} as Record<string, any>, parent: null as any,
    addEventListener() {}, removeEventListener() {}, getRootNode() { return { activeElement: null } }, get options(): any[] { return this.children } })
  const renderer = runtime.createRenderer({ createElement: novo, createText: (t: string) => novo('text', t), createComment: (t: string) => novo('comment', t),
    setText: (n: any, t: string) => { n.text = t }, setElementText: (n: any, t: string) => { n.text = t; n.children = [] }, parentNode: (n: any) => n.parent, nextSibling: (n: any) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    insert: (n: any, p: any, a: any) => { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = p; const i = a ? p.children.indexOf(a) : -1; p.children.splice(i < 0 ? p.children.length : i, 0, n) }, remove: (n: any) => { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1) }, patchProp: (n: any, k: string, _a: unknown, b: unknown) => { n.props[k] = b; n[k] = b } })
  return { runtime, montar(props: any) { const raiz = novo('root'); const estado = runtime.reactive(props); const app = renderer.createApp({ setup: () => () => runtime.h(runtime.default, estado) }); app.mount(raiz); return { raiz, app, estado } } }
}
if (!globalThis.Document) (globalThis as any).Document = class Document {}
if (!globalThis.ShadowRoot) (globalThis as any).ShadowRoot = class ShadowRoot {}
const receita = await componente('CrmReceita')
const todos = (n: any): any[] => [n, ...n.children.flatMap(todos)]
const texto = (n: any): string => n.text + n.children.map(texto).join('')
const campo = (raiz: any, rotulo: string) => todos(raiz).find(n => n.tagName === 'LABEL' && texto(n).startsWith(rotulo)).children.find((n: any) => ['SELECT', 'INPUT'].includes(n.tagName))
const mudar = async (raiz: any, rotulo: string, valor: unknown) => { campo(raiz, rotulo).props['onUpdate:modelValue'](valor); await receita.runtime.nextTick() }
const enviar = async (raiz: any) => { await todos(raiz).find(n => n.tagName === 'FORM').props.onSubmit({ preventDefault() {} }); await receita.runtime.nextTick() }
const lead = (id: string, produto = 'site', eventos: any[] = []) => ({ id: `${produto}:${id}`, chave: id, produto, empresa: 'Empresa fictícia', etapa: 'contato', sinal: 'enviado', subEtapa: '', nicho: '', cidade: '', estadoNaPlanilha: 'enviado', marcos: {}, eventos, links: {}, notas: 0, divergencias: [], followupHoje: false, respostaNova: false, acervo: false }) as any
const registro = (tipo: string, texto: string) => ({ tipo, texto, registroTexto: texto, em: '2026-10-19T14:00:00Z', origem: 'manual', rotulo: '', fonte: 'fixture' })

describe('Ficha: fatos comerciais explícitos', () => {
  it('não salva ao editar, calcula catálogo e só apresenta confirmação depois da fonte', async () => {
    const anterior = globalThis.fetch, chamadas: any[] = []
    globalThis.fetch = (async (_u, op) => { chamadas.push(JSON.parse(String(op?.body))); return new Response('{}', { status: 201 }) }) as typeof fetch
    const l = lead('confirmar'), { raiz, app, estado } = receita.montar({ lead: l, disponivel: true })
    try {
      await mudar(raiz, 'O que aconteceu?', 'pagamento_confirmado')
      await mudar(raiz, 'Item e valor', 'encontrado:implantacao')
      await mudar(raiz, 'Referência do fato', 'contrato-outubro')
      assert.equal(chamadas.length, 0)
      await enviar(raiz)
      assert.equal(chamadas.length, 1); assert.equal(JSON.parse(chamadas[0].texto).valor_centavos, 69000)
      assert.match(texto(raiz), /0 componentes de pagamento confirmados/); assert.match(texto(raiz), /Aguardando a confirmação/)
      const eventos = [registro('pagamento_confirmado', chamadas[0].texto)]
      estado.lead = { ...l, eventos, aarr: aarrDoLead({ ...l, eventos }, Date.now()) }; await receita.runtime.nextTick()
      assert.match(texto(raiz), /1 componentes de pagamento confirmados/); assert.match(texto(raiz), /Registro confirmado na Ficha/)
    } finally { app.unmount(); globalThis.fetch = anterior }
  })
  it('Iris exige quantidade confirmada, usa faixas marginais; Estampa bloqueia valor', async () => {
    const iris = receita.montar({ lead: lead('marginal', 'iris'), disponivel: true })
    try { assert.equal(campo(iris.raiz, 'Item e valor').disabled, true); await mudar(iris.raiz, 'Quantidade confirmada', '41'); await mudar(iris.raiz, 'Item e valor', 'iris:mensalidade'); assert.match(texto(iris.raiz), /1\.410,00/) } finally { iris.app.unmount() }
    const estampa = receita.montar({ lead: lead('pendente', 'estampa'), disponivel: true })
    try { assert.match(texto(estampa.raiz), /ainda não tem preço aprovado/); assert.equal(campo(estampa.raiz, 'Item e valor').disabled, true); assert.equal(todos(estampa.raiz).find(n => n.tagName === 'BUTTON' && texto(n).includes('Confirmar e registrar')).disabled, true) } finally { estampa.app.unmount() }
  })
  it('origem e motivo começam vazios e não se confirmam sem escolha', async () => {
    const anterior = globalThis.fetch; let posts = 0; globalThis.fetch = (async () => { posts++; return new Response('{}') }) as typeof fetch
    const { raiz, app } = receita.montar({ lead: lead('origem'), disponivel: true })
    try { for (const [tipo, rotulo] of [['origem', 'Origem confirmada'], ['motivo_perda', 'Razão informada']]) { await mudar(raiz, 'O que aconteceu?', tipo); assert.equal(campo(raiz, rotulo).options[0].props.value, ''); await enviar(raiz); assert.equal(posts, 0) } } finally { app.unmount(); globalThis.fetch = anterior }
  })
  it('rascunho sobrevive à releitura e troca de lead sem salvar automaticamente', async () => {
    const l = lead('rascunho'), { raiz, app, estado } = receita.montar({ lead: l, disponivel: true })
    try { await mudar(raiz, 'Referência do fato', 'meu-rascunho'); estado.lead = { ...l, eventos: [] }; await receita.runtime.nextTick(); assert.equal(campo(raiz, 'Referência do fato').value, 'meu-rascunho'); estado.lead = lead('outro'); await receita.runtime.nextTick(); assert.equal(campo(raiz, 'Referência do fato').value, ''); estado.lead = l; await receita.runtime.nextTick(); assert.equal(campo(raiz, 'Referência do fato').value, 'meu-rascunho') } finally { app.unmount() }
  })
  it('falha de gravação preserva rascunho e não confirma receita', async () => {
    const anterior = globalThis.fetch; globalThis.fetch = (async () => new Response('{"error":"indisponível"}', { status: 503 })) as typeof fetch
    const { raiz, app } = receita.montar({ lead: lead('falha'), disponivel: true })
    try { await mudar(raiz, 'Item e valor', 'encontrado:implantacao'); await mudar(raiz, 'Referência do fato', 'contrato-falha'); await enviar(raiz); assert.match(texto(raiz), /Não foi possível confirmar/); assert.match(texto(raiz), /0 componentes de pagamento confirmados/); assert.equal(campo(raiz, 'Referência do fato').value, 'contrato-falha') } finally { app.unmount(); globalThis.fetch = anterior }
  })
  it('retenção escolhe contrato canônico e exige situação conferida e data já ocorrida', async () => {
    const l = lead('retencao'), opcao = opcoesDeterministicasDeReceita(l).find(o => o.componente === 'mensalidade')!
    l.eventos = [registro('pagamento_confirmado', textoDoRegistroReceita('pagamento_confirmado', opcao, 'competencia-julho', '2026-07-19'))]
    const anterior = globalThis.fetch, relogio = Date.now, chamadas: any[] = []; Date.now = () => Date.parse('2026-10-19T15:00:00Z')
    globalThis.fetch = (async (_u, op) => { chamadas.push(JSON.parse(String(op?.body))); return new Response('{}', { status: 201 }) }) as typeof fetch
    const { raiz, app } = receita.montar({ lead: l, disponivel: true })
    try {
      await mudar(raiz, 'O que aconteceu?', 'retencao_3m'); await mudar(raiz, 'Contrato com mensalidade', 'encontrado')
      await enviar(raiz); assert.equal(chamadas.length, 0); assert.match(texto(raiz), /Confirme se a mensalidade/)
      await mudar(raiz, 'Situação conferida', true); await mudar(raiz, 'Data do fato', '2026-10-20'); await enviar(raiz); assert.equal(chamadas.length, 0)
      await mudar(raiz, 'Data do fato', '2026-10-19'); await enviar(raiz)
      assert.equal(chamadas.length, 1); assert.deepEqual(JSON.parse(chamadas[0].texto), { versao: 1, referencia: 'encontrado', inicio: '2026-07-19', data: '2026-10-19', ativa: true })
    } finally { app.unmount(); globalThis.fetch = anterior; Date.now = relogio }
  })
  it('resposta tardia de gravação não mistura aviso com outra Ficha', async () => {
    const anterior = globalThis.fetch; let resolver!: () => void
    globalThis.fetch = (async () => { await new Promise<void>(r => { resolver = r }); return new Response('{}', { status: 201 }) }) as typeof fetch
    const { raiz, app, estado } = receita.montar({ lead: lead('lento'), disponivel: true })
    try {
      await mudar(raiz, 'O que aconteceu?', 'origem'); await mudar(raiz, 'Origem confirmada', 'plus')
      const pendente = enviar(raiz); await receita.runtime.nextTick(); estado.lead = lead('depois'); await receita.runtime.nextTick(); resolver(); await pendente
      assert.doesNotMatch(texto(raiz), /Aguardando a confirmação|Gravado na planilha/)
      assert.match(texto(raiz), /0 componentes de pagamento confirmados/)
    } finally { app.unmount(); globalThis.fetch = anterior }
  })
  it('desfazer usa referência do registro confirmado sem apagar ou reduzir otimisticamente', async () => {
    const l = lead('desfazer'), opcao = opcoesDeterministicasDeReceita(l)[0]
    const t = textoDoRegistroReceita('pagamento_confirmado', opcao, 'contrato-teste', '2026-10-19'); l.eventos = [registro('pagamento_confirmado', t)]
    const anterior = globalThis.fetch, chamadas: any[] = []; globalThis.fetch = (async (_u, op) => { chamadas.push(JSON.parse(String(op?.body))); return new Response('{}', { status: 201 }) }) as typeof fetch
    const { raiz, app } = receita.montar({ lead: l, disponivel: true })
    try { await todos(raiz).find(n => n.tagName === 'BUTTON' && texto(n) === 'Desfazer este pagamento').props.onClick(); assert.equal(chamadas.length, 1); assert.equal(chamadas[0].tipo, 'receita_desfeita'); assert.match(JSON.parse(chamadas[0].texto).referencia, /contrato-teste/); assert.match(texto(raiz), /1 componentes de pagamento confirmados/) } finally { app.unmount(); globalThis.fetch = anterior }
  })
})

it('Números mantém estrela global com seleção de uma linha e faixa AARRR no topo', async () => {
  const numeros = await componente('CrmResultados'), anterior = globalThis.fetch
  globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch
  const site = lead('site-zero'), iris = lead('iris-pagou', 'iris')
  const opcao = opcoesDeterministicasDeReceita(iris, 41)[0]
  iris.eventos = [registro('pagamento_confirmado', textoDoRegistroReceita('pagamento_confirmado', opcao, 'competencia-outubro', '2026-10-19'))]
  const { raiz, app, estado } = numeros.montar({ leads: [site], todosLeads: [site, iris], agora: Date.parse('2026-10-19T15:00:00Z'), parte: 'numeros' })
  try { await numeros.runtime.nextTick(); assert.match(texto(raiz), /Estrela-guia: 1 recebimentos confirmados/); const titulos = todos(raiz).filter(n => n.tagName === 'H2'); assert.match(texto(titulos[0]), /AARRR/); assert.match(texto(raiz), /Histórico anterior: não medido/); estado.leads = [iris]; await numeros.runtime.nextTick(); assert.match(texto(raiz), /Estrela-guia: 1 recebimentos confirmados/) } finally { app.unmount(); globalThis.fetch = anterior }
})
