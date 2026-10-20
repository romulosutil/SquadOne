import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import { build } from 'esbuild'
import { acaoDoLead } from './operations/proxima-venda.ts'

// Renderizador Vue em memória: sem navegador, disco de cliente ou serviço real.
const arquivo = fileURLToPath(new URL('./operations/CrmConfirmarPasso.vue', import.meta.url))
const { descriptor } = parse(await fs.readFile(arquivo, 'utf8'))
const script = compileScript(descriptor, { id: 'spiced-ui-test', inlineTemplate: true })
const bundle = await build({ stdin: { contents: `${script.content}\nexport { createRenderer, nextTick } from 'vue'`, sourcefile: 'CrmConfirmarPasso.ts', resolveDir: path.dirname(arquivo), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', define: { 'process.env.NODE_ENV': '"test"' } })
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

const montar = (lead: any, acao: any) => { const raiz = novo('root'); const app = renderer.createApp(runtime.default, { lead, acao, disponivel: true }); app.mount(raiz); return { raiz, app } }
const iso = (dia: string) => dia + 'T15:00:00.000Z'
const lead = () => ({ id:'site:fixture',chave:'fixture',produto:'site',empresa:'Empresa fictícia',etapa:'proposta',sinal:'proposta',proposta:{em:iso('2026-10-15'),data:'2026-10-15'},marcos:{},conversa:{desde:iso('2026-10-15'),mensagens:1,ultima:{direcao:'saida',em:iso('2026-10-15'),trecho:'Proposta enviada'}},eventos:[],links:{whatsapp:'https://wa.me/5511999990000'} } as any)
const visao = (l: any) => ({estado:'ok',leads:[l],hoje:[{id:'proposta',titulo:'',explicacao:'',itens:[{leadId:l.id,acao:'',detalhe:'',ordem:1,links:[]}]}]} as any)
describe('Ficha real: confirmação da cadência', () => {
 it('follow-up só confirma braço A e versão depois do envio humano', async()=>{
  const relogio=Date.now,anterior=globalThis.fetch;Date.now=()=>Date.parse(iso('2026-10-19'))
  const l=lead();Object.assign(l,{etapa:'contato',proposta:undefined,marcos:{enviado:iso('2026-10-15')},links:{whatsapp:'https://wa.me/5511999990000',followup:'https://wa.me/5511999990000?text=Pergunta%20de%20controle'}})
  const v=visao(l);v.hoje[0].id='followup';v.hoje[0].itens[0].links=[{rotulo:'Follow-up',url:l.links.followup}]
  const acao=acaoDoLead(v,l.id,Date.now())!;assert.equal(acao.anota,'followup_enviado');assert.ok(acao.textoDoRegistro)
  const posts:any[]=[];globalThis.fetch=(async(_u,op)=>{if(op?.method){posts.push(JSON.parse(String(op.body)));return new Response('{}',{status:201})}return new Response(JSON.stringify(v))}) as typeof fetch
  const{raiz,app}=montar(l,acao)
  try{assert.equal(posts.length,0);todos(raiz).find(n=>n.tagName==='INPUT').props['onUpdate:modelValue'](true);await runtime.nextTick();await todos(raiz).find(n=>n.type==='button').props.onClick();assert.equal(posts.length,1);assert.match(posts[0].texto,/followup-2026-10-19/);assert.match(posts[0].texto,/"braco":"A"/)}finally{app.unmount();Date.now=relogio;globalThis.fetch=anterior}
 })
 it('dia zero sem cobrança; abertura não grava; confirmação grava degrau, reload conserva e dia3 libera', async () => {
  const relogio = Date.now, fetchAnterior=globalThis.fetch
  let agora=Date.parse(iso('2026-10-15')); Date.now=()=>agora
  const l=lead(); let v=visao(l)
  assert.equal(acaoDoLead(v,l.id,agora),null)
  agora=Date.parse(iso('2026-10-16'))
  const acao=acaoDoLead(v,l.id,agora)!; assert.equal(acao.anota,'cadencia_enviada')
  const chamadas:any[]=[]
  globalThis.fetch=(async (_u,op)=>{ if(!op?.method)return new Response(JSON.stringify(v));const corpo=JSON.parse(String(op.body));chamadas.push(corpo);l.eventos.push({tipo:corpo.tipo,texto:corpo.texto,origem:'manual',em:iso('2026-10-16'),rotulo:'',fonte:'fixture'});return new Response('{}',{status:201}) }) as typeof fetch
  const {raiz,app}=montar(l,acao)
  try {
   await runtime.nextTick();assert.equal(chamadas.length,0)
   const link=todos(raiz).find(n=>n.type==='a'); assert.equal(link.props.onClick,undefined)
   const botao=todos(raiz).find(n=>n.type==='button');await botao.props.onClick();assert.equal(chamadas.length,0)
   todos(raiz).find(n=>n.tagName==='INPUT').props['onUpdate:modelValue'](true);await runtime.nextTick()
   await botao.props.onClick();await runtime.nextTick()
   assert.equal(chamadas.length,1);assert.deepEqual(JSON.parse(chamadas[0].texto),JSON.parse(acao.textoDoRegistro!))
   assert.match(texto(raiz),/Aguardando a Ficha atualizada/)
   agora=Date.parse(iso('2026-10-19'));assert.equal(acaoDoLead(visao(l),l.id,agora),null)
   agora=Date.parse(iso('2026-10-20'));assert.equal(JSON.parse(acaoDoLead(visao(l),l.id,agora)!.textoDoRegistro!).degrau,'dia-3')
  }finally{app.unmount();globalThis.fetch=fetchAnterior;Date.now=relogio}
 })
 it('resposta nova na fonte recusa cartão antigo sem registrar',async()=>{
  const relogio=Date.now, anterior=globalThis.fetch;Date.now=()=>Date.parse(iso('2026-10-16'))
  const l=lead(),v=visao(l),acao=acaoDoLead(v,l.id,Date.now())!;let posts=0
  globalThis.fetch=(async(_u,op)=>{if(op?.method){posts++;return new Response('{}')}return new Response(JSON.stringify({...v,leads:[{...l,resposta:{tipo:'neutra',trecho:'vamos conversar',em:iso('2026-10-16')}}]}))})as typeof fetch
  const{raiz,app}=montar(l,acao)
  try{todos(raiz).find(n=>n.tagName==='INPUT').props['onUpdate:modelValue'](true);await runtime.nextTick();await todos(raiz).find(n=>n.type==='button').props.onClick();assert.equal(posts,0);assert.match(texto(raiz),/mudou/)}finally{app.unmount();Date.now=relogio;globalThis.fetch=anterior}
 })
})
