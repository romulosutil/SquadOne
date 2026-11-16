import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import { build } from 'esbuild'
import { PREFIXO_CICLO, textoEventoCiclo, type EventoCiclo } from './operations/ciclo-comercial.ts'
import { spicedVazio } from './operations/spiced.ts'

// Componente real com renderizador Vue, fontes fictícias e fetch substituído. Nenhuma rede é usada.
async function componente() {
  const arquivo = path.resolve('src/operations/CrmCicloComercial.vue')
  const { descriptor } = parse(await fs.readFile(arquivo, 'utf8'), { filename: arquivo })
  const script = compileScript(descriptor, { id: 'ciclo-ui', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } })
  const bundle = await build({ stdin: { contents: `${script.content}\nexport { createRenderer, nextTick, reactive, h } from 'vue'`, resolveDir: path.dirname(arquivo), sourcefile: 'ciclo-ui.ts', loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', define: { 'process.env.NODE_ENV': '"test"' } })
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'ciclo-ui-'))
  const modulo = path.join(pasta, 'componente.mjs'); await fs.writeFile(modulo, bundle.outputFiles[0].text)
  const runtime = await import(pathToFileURL(modulo).href)
  const novo = (type: string, text = '') => ({ type, text, tagName: type.toUpperCase(), checked: false, children: [] as any[], props: {} as Record<string, any>, parent: null as any, addEventListener() {}, removeEventListener() {}, getRootNode() { return { activeElement: null } }, get options(): any[] { return this.children } })
  const renderer = runtime.createRenderer({ createElement: novo, createText: (t: string) => novo('text', t), createComment: (t: string) => novo('comment', t), setText: (n: any, t: string) => { n.text = t }, setElementText: (n: any, t: string) => { n.text = t; n.children = [] }, parentNode: (n: any) => n.parent, nextSibling: (n: any) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    insert: (n: any, p: any, a: any) => { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = p; const i = a ? p.children.indexOf(a) : -1; p.children.splice(i < 0 ? p.children.length : i, 0, n) }, remove: (n: any) => { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1) }, patchProp: (n: any, k: string, _a: unknown, b: unknown) => { n.props[k] = b; n[k] = b } })
  return { runtime, pasta, montar(props: any) { const raiz = novo('root'), estado = runtime.reactive(props); const app = renderer.createApp({ setup: () => () => runtime.h(runtime.default, estado) }); app.mount(raiz); return { raiz, app, estado } } }
}
if (!globalThis.Document) (globalThis as any).Document = class Document {}
if (!globalThis.ShadowRoot) (globalThis as any).ShadowRoot = class ShadowRoot {}
const tela = await componente()
after(async () => { await fs.rm(tela.pasta, { recursive: true, force: true }) })
const agora = Date.parse('2026-10-23T18:00:00Z'), originalNow = Date.now, fetchOriginal = globalThis.fetch
let chamadas: any[] = []
beforeEach(() => { Date.now = () => agora; chamadas = []; globalThis.fetch = (async (_u, op) => { chamadas.push(JSON.parse(String(op?.body))); return new Response('{"estado":"aguardando_projecao"}', { status: 202 }) }) as typeof fetch })
afterEach(() => { Date.now = originalNow; globalThis.fetch = fetchOriginal })
const todos = (n: any): any[] => [n, ...n.children.flatMap(todos)]
const texto = (n: any): string => n.text + n.children.map(texto).join('')
function campo(raiz: any, rotulo: string) {
  const label = todos(raiz).find(n => n.tagName === 'LABEL' && texto(n).trimStart().startsWith(rotulo))
  assert.ok(label, `Campo ausente: ${rotulo}`)
  return label.children.find((n: any) => ['SELECT', 'INPUT', 'TEXTAREA'].includes(n.tagName))
}
async function mudar(raiz: any, rotulo: string, valor: unknown) { campo(raiz, rotulo).props['onUpdate:modelValue'](valor); await tela.runtime.nextTick() }
function botao(raiz: any, rotulo: string) { const b = todos(raiz).find(n => n.tagName === 'BUTTON' && texto(n) === rotulo); assert.ok(b, `Botão ausente: ${rotulo}`); return b }
async function clicar(raiz: any, rotulo: string) { await botao(raiz, rotulo).props.onClick?.(); await tela.runtime.nextTick() }
async function revisar(raiz: any) { const f = todos(raiz).find(n => n.tagName === 'FORM'); assert.ok(f, 'Formulário ausente'); await f.props.onSubmit({ preventDefault() {} }); await tela.runtime.nextTick() }
async function confirmar(raiz: any) { await mudar(raiz, 'Conferi este fato', true); await clicar(raiz, 'Confirmar este registro na aba CRM') }
const registro = (t: string, extra: any = {}) => ({ tipo: 'nota', texto: t, registroTexto: t, em: new Date(agora).toISOString(), origem: 'manual', fonte: 'fixture', rotulo: 'Nota', ...extra })
const lead = (id: string, eventos: any[] = [], produto = 'site') => ({ id: `${produto}:${id}`, chave: id, produto, empresa: 'Empresa fictícia', etapa: 'contato', eventos, links: {}, marcos: {}, spiced: { ...spicedVazio(), dor: 'Necessidade fictícia', impacto: 'Impacto fictício', decisao: { decisor_confirmado: 'sim', quem: '', como_paga: '' } } }) as any
const proposta: EventoCiclo = { v: 1, id: 'prop-01', tipo: 'proposta', data: '2026-10-20', referencia: 'DOC-TESTE', humano: true, ofertaId: 'anuncios', versao: 1, valor: 10000, mensalidade: 0, escopo: 'Serviço fictício; mídia fora', prazo: 'Prazo acordado', condicoes: 'Condições fictícias no documento', responsavel: 'Operador' }
const fato = (tipo: EventoCiclo['tipo'], id: string, vinculo: string, extra: Partial<EventoCiclo> = {}): EventoCiclo => ({ v: 1, id, tipo, data: '2026-10-20', referencia: id, vinculo, humano: true, evidencia: 'Conferência humana fictícia', ...extra })
function fontes(p = proposta, ate: 'proposta' | 'aceite' | 'condicao' | 'cobranca' = 'cobranca') {
  const es: EventoCiclo[] = [p]
  if (ate !== 'proposta') es.push(fato('proposta_enviada', 'env-01', p.id), fato('aceite', 'aceite-01', p.id, { documento: 'DOC-TESTE v1' }))
  if (['condicao', 'cobranca'].includes(ate)) es.push(fato('condicao_cobranca', 'cond-01', 'aceite-01', { componente: 'inicial', valor: 10000, gatilho: p.ofertaId === 'encontrado' ? 'site_visto_no_ar' : 'aceite', condicao: 'Condição combinada', vigenciaInicio: '2026-10-20' }))
  if (ate === 'cobranca') es.push(fato('cobranca', 'cob-01', 'cond-01', { componente: 'inicial', valor: 10000, vencimento: '2026-10-25', forma: 'Forma combinada' }))
  return es.map(e => registro(textoEventoCiclo(e, agora)))
}
async function preencherProposta(raiz: any, incompleta = false) {
  for (const [nome, valor] of [['Oferta aprovada', 'anuncios'], ['Referência do documento', 'DOC-NOVO'], ['Escopo e entregáveis', 'Gestão; mídia paga separadamente'], ['Prazo e dependências', 'Prazo a conferir no documento'], ['Condições comerciais', 'Condições específicas'], ['Responsável pela entrega', 'Operador']]) await mudar(raiz, nome, valor)
  if (!incompleta) { await mudar(raiz, 'Valor inicial combinado', '100,00'); await mudar(raiz, 'Mensalidade combinada', '0') }
}

describe('Ciclo comercial: UI por etapas e fonte confirmada', () => {
  it('registra próxima ação com prévia humana sem fabricar proposta ou recebimento', async () => {
    const { raiz, app, estado } = tela.montar({ lead: lead('trabalho-interno'), disponivel: true })
    try {
      await clicar(raiz, 'Registrar próxima ação e responsável')
      for (const [rotulo, valor] of [['Área de trabalho', 'time'], ['Responsável pela ação', 'Operador'], ['Próxima ação', 'Conferir escopo'], ['Resultado esperado', 'Escopo conferido'], ['Condição para agir', 'Cliente confirmar dados'], ['Referência do documento', 'ACAO-01']]) await mudar(raiz, rotulo, valor)
      await revisar(raiz)
      assert.match(texto(raiz), /Confira antes de registrar/)
      assert.equal(chamadas.length, 0)
      await confirmar(raiz)
      assert.equal(chamadas.length, 1)
      const evento = JSON.parse(chamadas[0].texto.slice(PREFIXO_CICLO.length))
      assert.equal(evento.tipo, 'trabalho'); assert.equal(evento.fila, 'time')
      for (const campo of ['valor', 'mensalidade', 'vinculo', 'ofertaId']) assert.equal(evento[campo], undefined)
      assert.match(texto(raiz), /Aguardando a nota exata/)
      assert.equal(botao(raiz, 'Registrar próxima ação e responsável').disabled, true)
      estado.lead.eventos.push(registro(chamadas[0].texto)); await tela.runtime.nextTick()
      assert.match(texto(raiz), /Registro confirmado na fonte comercial/)
      assert.equal(botao(raiz, 'Registrar próxima ação e responsável').disabled, false)
    } finally { app.unmount() }
  })
  it('rejeição comprovadamente não enviada permite corrigir preservando o ID e exige nova revisão humana', async () => {
    globalThis.fetch = (async (_u, op) => { chamadas.push(JSON.parse(String(op?.body))); return new Response(JSON.stringify(chamadas.length === 1 ? { error: 'Confira a condição', naoEnviado: true } : { estado: 'aguardando_projecao' }), { status: chamadas.length === 1 ? 400 : 202 }) }) as typeof fetch
    const { raiz, app } = tela.montar({ lead: lead('rejeitada-segura'), disponivel: true })
    try {
      await preencherProposta(raiz); await revisar(raiz); await confirmar(raiz)
      assert.match(texto(raiz), /Registro não enviado/); assert.equal(botao(raiz, 'Revisar este registro').disabled, false)
      assert.doesNotMatch(texto(raiz), /Confira antes de registrar/)
      const primeiro = JSON.parse(chamadas[0].texto.slice(PREFIXO_CICLO.length))
      await mudar(raiz, 'Condições comerciais', 'Condição corrigida'); await revisar(raiz)
      assert.equal(campo(raiz, 'Conferi este fato').checked, false); await confirmar(raiz)
      const segundo = JSON.parse(chamadas[1].texto.slice(PREFIXO_CICLO.length))
      assert.equal(segundo.id, primeiro.id); assert.equal(segundo.condicoes, 'Condição corrigida')
      assert.match(texto(raiz), /Aguardando a nota exata/)
    } finally { app.unmount() }
  })
  it('HTTP 400 sem prova de não envio conserva o bloqueio de resultado ambíguo', async () => {
    globalThis.fetch = (async (_u, op) => { chamadas.push(JSON.parse(String(op?.body))); return new Response('{"error":"Journal bloqueado"}', { status: 400 }) }) as typeof fetch
    const { raiz, app } = tela.montar({ lead: lead('rejeitada-incerta'), disponivel: true })
    try { await preencherProposta(raiz); await revisar(raiz); await confirmar(raiz); assert.match(texto(raiz), /Gravação não confirmada/); assert.equal(botao(raiz, 'Revisar este registro').disabled, true); assert.equal(chamadas.length, 1) } finally { app.unmount() }
  })
  it('qualificação confirmada sem dor legada libera envio e mudança de oferta antes do POST bloqueia', async () => {
    const l = lead('qualificacao', fontes(proposta, 'proposta')); delete l.spiced
    const { raiz, app, estado } = tela.montar({ lead: l, disponivel: true })
    try {
      await mudar(raiz, 'Versão exata', proposta.id); await mudar(raiz, 'Referência do documento', 'ENV-QUAL'); await mudar(raiz, 'Evidência conferida', 'Mensagem conferida'); await revisar(raiz)
      assert.match(texto(raiz), /painel de qualificação/); assert.doesNotMatch(texto(raiz), /Confira antes de registrar/)
      const q = { v: 1, id: 'q-ui', em: new Date(agora).toISOString(), humano: true, necessidade: 'Automatizar atendimento', adequacao: { estado: 'confirmada', oferta: 'anuncios', motivo: 'Necessidade compatível' }, intencao: 'avaliar', decisao: 'Responsável avaliará a proposta', proximoPasso: { descricao: 'Revisar proposta', aceito: true }, fonte: 'Conversa conferida', evidencia: 'Permissão explícita' }
      estado.lead = { ...l, qualificacaoComercial: q }; await tela.runtime.nextTick(); await revisar(raiz)
      assert.match(texto(raiz), /Confira antes de registrar/)
      estado.lead = { ...l, qualificacaoComercial: { ...q, adequacao: { ...q.adequacao, oferta: 'redes' } } }; await tela.runtime.nextTick(); await confirmar(raiz)
      assert.equal(chamadas.length, 0); assert.match(texto(raiz), /corresponder à qualificação/); assert.doesNotMatch(texto(raiz), /Confira antes de registrar/)
      estado.lead = { ...l, qualificacaoComercial: q }; await tela.runtime.nextTick(); await revisar(raiz); await confirmar(raiz); assert.equal(chamadas.length, 1)
    } finally { app.unmount() }
  })
  it('mostra etapas claras e apenas campos da próxima etapa, com dinheiro vazio', () => {
    const { raiz, app } = tela.montar({ lead: lead('inicial'), disponivel: true })
    try {
      const t = texto(raiz); assert.match(t, /Preparar proposta.*Confirmar envio.*Registrar aceite e documento.*Definir cobrança.*Confirmar recebimento/)
      assert.equal(campo(raiz, 'Valor inicial combinado').value, ''); assert.equal(campo(raiz, 'Mensalidade combinada').value, '')
      assert.doesNotMatch(t, /proposta_enviada|condicao_cobranca|\[ciclo-comercial-v1\]|JSON/)
      assert.equal(todos(raiz).filter(n => n.tagName === 'FORM').length, 1)
      assert.ok(!todos(raiz).some(n => n.tagName === 'LABEL' && texto(n).startsWith('Vencimento combinado')))
    } finally { app.unmount() }
  })
  it('exige prévia e confirmação humana, não trata ACK como fonte nem repete POST', async () => {
    const l = lead('fonte'), { raiz, app, estado } = tela.montar({ lead: l, disponivel: true })
    try {
      await preencherProposta(raiz); assert.equal(chamadas.length, 0); await revisar(raiz)
      assert.match(texto(raiz), /Confira antes de registrar/); assert.equal(campo(raiz, 'Conferi este fato').checked, false)
      await clicar(raiz, 'Confirmar este registro na aba CRM'); assert.equal(chamadas.length, 0)
      await confirmar(raiz); assert.equal(chamadas.length, 1); assert.match(chamadas[0].texto, /^\[ciclo-comercial-v1\] /)
      assert.equal(chamadas[0].tipo, 'nota'); assert.equal(chamadas[0].produto, 'site'); assert.equal(chamadas[0].id, 'site:fonte'.split(':')[1])
      await clicar(raiz, 'Confirmar este registro na aba CRM'); assert.equal(chamadas.length, 1)
      assert.match(texto(raiz), /Aguardando a nota exata/); assert.doesNotMatch(texto(raiz), /Registro confirmado na fonte/)
      estado.lead = { ...l, eventos: [registro(chamadas[0].texto, { origem: 'automático' })] }; await tela.runtime.nextTick()
      assert.match(texto(raiz), /Aguardando a nota exata/)
      estado.lead = { ...l, eventos: [registro(chamadas[0].texto, { em: new Date(agora + 3600_000).toISOString() })] }; await tela.runtime.nextTick()
      assert.match(texto(raiz), /Aguardando a nota exata/)
      estado.lead = { ...l, eventos: [registro(chamadas[0].texto)] }; await tela.runtime.nextTick()
      assert.match(texto(raiz), /Registro confirmado na fonte/); assert.match(texto(raiz), /Versão exata da proposta/)
    } finally { app.unmount() }
  })
  it('rascunho incompleto preserva valores desconhecidos e não os serializa como zero', async () => {
    const l = lead('incompleta'), { raiz, app, estado } = tela.montar({ lead: l, disponivel: true })
    try {
      await preencherProposta(raiz, true); await revisar(raiz); assert.match(texto(raiz), /Rascunho incompleto/)
      await confirmar(raiz); const e = JSON.parse(chamadas[0].texto.slice(PREFIXO_CICLO.length)); assert.ok(!('valor' in e)); assert.ok(!('mensalidade' in e))
      estado.lead = { ...l, eventos: [registro(chamadas[0].texto)] }; await tela.runtime.nextTick()
      assert.match(texto(raiz), /Preparar proposta/); assert.doesNotMatch(texto(raiz), /Cobrança a receber/)
    } finally { app.unmount() }
  })
  it('mantém rascunho por produto, lead e fase durante releitura, troca e reabertura', async () => {
    const l = lead('memoria'), um = tela.montar({ lead: l, disponivel: true })
    await mudar(um.raiz, 'Referência do documento', 'MEMORIA-ORIGINAL')
    um.estado.lead = { ...l, eventos: [] }; await tela.runtime.nextTick(); assert.equal(campo(um.raiz, 'Referência do documento').value, 'MEMORIA-ORIGINAL')
    um.estado.lead = lead('outra-memoria'); await tela.runtime.nextTick(); assert.equal(campo(um.raiz, 'Referência do documento').value, '')
    um.estado.lead = lead('memoria', [], 'prumo'); await tela.runtime.nextTick(); assert.equal(campo(um.raiz, 'Referência do documento').value, '')
    um.app.unmount()
    const dois = tela.montar({ lead: l, disponivel: true })
    try { assert.equal(campo(dois.raiz, 'Referência do documento').value, 'MEMORIA-ORIGINAL'); assert.equal(chamadas.length, 0) } finally { dois.app.unmount() }
  })
  it('falha ambígua conserva ID e trava nova tentativa mesmo após troca e reabertura', async () => {
    globalThis.fetch = (async (_u, op) => { chamadas.push(JSON.parse(String(op?.body))); throw new Error('Conexão caiu') }) as typeof fetch
    const l = lead('incerta'), um = tela.montar({ lead: l, disponivel: true })
    await preencherProposta(um.raiz); await revisar(um.raiz); await confirmar(um.raiz)
    const enviado = chamadas[0].texto; assert.match(texto(um.raiz), /não repita o registro/)
    assert.equal(botao(um.raiz, 'Preparar nova versão ou proposta').disabled, true)
    await clicar(um.raiz, 'Preparar nova versão ou proposta'); assert.equal(chamadas.length, 1)
    um.estado.lead = lead('outro-incerta'); await tela.runtime.nextTick(); um.estado.lead = l; await tela.runtime.nextTick(); um.app.unmount()
    const dois = tela.montar({ lead: l, disponivel: true })
    try {
      assert.match(texto(dois.raiz), /Gravação não confirmada/); assert.equal(botao(dois.raiz, 'Confirmar este registro na aba CRM').disabled, true)
      assert.equal(chamadas.length, 1); dois.estado.lead = { ...l, eventos: [registro(enviado)] }; await tela.runtime.nextTick()
      assert.match(texto(dois.raiz), /Registro confirmado na fonte/)
    } finally { dois.app.unmount() }
  })
  it('resposta tardia de outra ficha não muda aviso ou rascunho do lead atual', async () => {
    let concluir!: () => void
    globalThis.fetch = (async (_u, op) => { chamadas.push(JSON.parse(String(op?.body))); await new Promise<void>(r => { concluir = r }); return new Response('{}', { status: 200 }) }) as typeof fetch
    const anterior = lead('lenta'), { raiz, app, estado } = tela.montar({ lead: anterior, disponivel: true })
    try {
      await preencherProposta(raiz); await revisar(raiz); await mudar(raiz, 'Conferi este fato', true)
      const gravando = botao(raiz, 'Confirmar este registro na aba CRM').props.onClick(); await tela.runtime.nextTick()
      estado.lead = lead('nova-ficha'); await tela.runtime.nextTick(); concluir(); await gravando; await tela.runtime.nextTick()
      assert.doesNotMatch(texto(raiz), /Aguardando a nota exata/); assert.equal(campo(raiz, 'Referência do documento').value, '')
      estado.lead = anterior; await tela.runtime.nextTick(); assert.match(texto(raiz), /Aguardando a nota exata/)
    } finally { app.unmount() }
  })
  it('pagamento parcial só altera saldo depois de nota humana exata e permite saldo restante', async () => {
    const l = lead('parcial', fontes()), { raiz, app, estado } = tela.montar({ lead: l, disponivel: true })
    try {
      assert.match(texto(raiz), /saldo R\$\s*100,00/); await mudar(raiz, 'Cobrança a receber', 'cob-01'); await mudar(raiz, 'Referência do recebimento', 'REC-FICTICIO'); await mudar(raiz, 'Data real do fato', '2026-10-23'); await mudar(raiz, 'Evidência conferida', 'Recebimento conferido'); await mudar(raiz, 'Valor recebido', '40,00')
      await revisar(raiz); await confirmar(raiz); assert.match(texto(raiz), /saldo R\$\s*100,00/)
      estado.lead = { ...l, eventos: [...l.eventos, registro(chamadas[0].texto)] }; await tela.runtime.nextTick()
      assert.match(texto(raiz), /Recebimento parcial/); assert.match(texto(raiz), /saldo R\$\s*60,00/)
      await clicar(raiz, 'Iniciar outro registro desta etapa'); assert.equal(campo(raiz, 'Valor recebido').value, '')
    } finally { app.unmount() }
  })
  it('recorrência cobra competência explícita sem preencher valor', async () => {
    const p = { ...proposta, mensalidade: 2500 }, es = fontes(p, 'aceite')
    es.push(registro(textoEventoCiclo(fato('condicao_cobranca', 'cond-mensal', 'aceite-01', { componente: 'mensal', valor: 2500, gatilho: 'aceite', condicao: 'Mensalidade acordada', vigenciaInicio: '2026-10-20' }), agora)))
    const { raiz, app } = tela.montar({ lead: lead('mensal', es), disponivel: true })
    try { await mudar(raiz, 'Condição contratada', 'cond-mensal'); assert.equal(campo(raiz, 'Valor desta cobrança').value, ''); assert.equal(campo(raiz, 'Competência da mensalidade').value, '') } finally { app.unmount() }
  })
  it('gate de site usa oferta aceita; origem site não impõe gate a anúncios', async () => {
    const site = tela.montar({ lead: lead('gate-site', fontes({ ...proposta, ofertaId: 'encontrado' }, 'aceite')), disponivel: true })
    try { await mudar(site.raiz, 'Aceite e documento', 'aceite-01'); assert.match(texto(site.raiz), /Site: cobrança somente depois/); assert.ok(!todos(site.raiz).some(n => n.tagName === 'SELECT' && texto(n).includes('Após aceite confirmado'))) } finally { site.app.unmount() }
    const anuncios = tela.montar({ lead: lead('gate-anuncios', fontes(proposta, 'aceite')), disponivel: true })
    try { await mudar(anuncios.raiz, 'Aceite e documento', 'aceite-01'); assert.doesNotMatch(texto(anuncios.raiz), /Site: cobrança somente depois/); assert.equal(campo(anuncios.raiz, 'Quando a cobrança').options[0].props.value, '') } finally { anuncios.app.unmount() }
  })
  it('copiar proposta/condições usa texto revisável, sem POST ou envio', async () => {
    const anterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), copias: string[] = []
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText(t: string) { copias.push(t) } } } })
    const { raiz, app } = tela.montar({ lead: lead('copiar', fontes(proposta, 'proposta')), disponivel: true })
    try { await clicar(raiz, 'Copiar proposta para revisão'); await clicar(raiz, 'Copiar condições comerciais'); assert.equal(copias.length, 2); assert.match(copias[0], /Proposta para revisão/); assert.doesNotMatch(copias[0], /\[ciclo-comercial-v1\]/); assert.equal(chamadas.length, 0); assert.match(texto(raiz), /Nenhuma mensagem foi enviada/) } finally { app.unmount(); if (anterior) Object.defineProperty(globalThis, 'navigator', anterior); else delete (globalThis as any).navigator }
  })
  it('editar depois da prévia invalida a confirmação humana sem trocar o ID', async () => {
    const { raiz, app } = tela.montar({ lead: lead('editar'), disponivel: true })
    try {
      await preencherProposta(raiz); await revisar(raiz); await mudar(raiz, 'Conferi este fato', true)
      await mudar(raiz, 'Condições comerciais', 'Condições revisadas'); assert.ok(!todos(raiz).some(n => n.tagName === 'SECTION' && n.props['aria-label'] === 'Prévia do registro'))
      await revisar(raiz); assert.equal(campo(raiz, 'Conferi este fato').checked, false); assert.equal(chamadas.length, 0)
    } finally { app.unmount() }
  })
  it('corrigir exige motivo, prévia e confirmação, preservando o fato anterior até a fonte', async () => {
    const pagamento = fato('pagamento', 'pag-01', 'cob-01', { componente: 'inicial', valor: 4000 }), l = lead('corrigir', [...fontes(), registro(textoEventoCiclo(pagamento, agora))])
    const { raiz, app } = tela.montar({ lead: l, disponivel: true })
    try {
      const li = todos(raiz).find(n => n.tagName === 'LI' && texto(n).startsWith('Confirmar recebimento · pag-01'))
      await li.children.find((n: any) => n.tagName === 'BUTTON').props.onClick(); await tela.runtime.nextTick()
      await mudar(raiz, 'Referência da correção', 'CORR-TESTE'); await mudar(raiz, 'Motivo e evidência', 'Referência anterior incorreta'); await revisar(raiz)
      assert.equal(chamadas.length, 0); await confirmar(raiz); assert.equal(JSON.parse(chamadas[0].texto.slice(PREFIXO_CICLO.length)).tipo, 'correcao')
      assert.match(texto(raiz), /Recebimento parcial/); assert.match(texto(raiz), /saldo R\$\s*60,00/)
    } finally { app.unmount() }
  })
  it('conclui o caminho proposta, envio, aceite, condição, cobrança e recebimento sem semear fatos', async () => {
    const { raiz, app, estado } = tela.montar({ lead: lead('caminho-inteiro'), disponivel: true })
    async function gravarNaFonte() {
      await revisar(raiz); assert.equal(campo(raiz, 'Conferi este fato').checked, false); await confirmar(raiz)
      const post = chamadas.at(-1), e = JSON.parse(post.texto.slice(PREFIXO_CICLO.length))
      estado.lead = { ...estado.lead, eventos: [...estado.lead.eventos, registro(post.texto)] }; await tela.runtime.nextTick()
      return e
    }
    async function comuns(ref: string) { await mudar(raiz, 'Referência do documento', ref); await mudar(raiz, 'Evidência conferida', 'Fato fictício conferido') }
    try {
      await preencherProposta(raiz); const p = await gravarNaFonte()
      await mudar(raiz, 'Versão exata da proposta', p.id); await comuns('ENVIO-TESTE'); await gravarNaFonte()
      await mudar(raiz, 'Versão exata da proposta', p.id); await comuns('ACEITE-TESTE'); await mudar(raiz, 'Documento de contratação', 'Documento fictício aceito versão 1'); const aceite = await gravarNaFonte()
      await mudar(raiz, 'Aceite e documento', aceite.id); await comuns('COND-TESTE'); await mudar(raiz, 'Componente combinado', 'inicial'); await mudar(raiz, 'Valor desta obrigação', '100'); await mudar(raiz, 'Quando a cobrança', 'aceite'); await mudar(raiz, 'Condição descrita', 'Condição acordada no documento'); await mudar(raiz, 'Início da vigência', '2026-10-23'); const cond = await gravarNaFonte()
      await mudar(raiz, 'Condição contratada', cond.id); await comuns('COBRANCA-TESTE'); await mudar(raiz, 'Valor desta cobrança', '100'); await mudar(raiz, 'Vencimento combinado', '2026-10-25'); await mudar(raiz, 'Forma de cobrança', 'Forma acordada'); const cobranca = await gravarNaFonte()
      await mudar(raiz, 'Cobrança a receber', cobranca.id); await mudar(raiz, 'Referência do recebimento', 'REC-CAMINHO'); await mudar(raiz, 'Evidência conferida', 'Dinheiro recebido e conferido'); await mudar(raiz, 'Valor recebido', '100'); await gravarNaFonte()
      assert.equal(chamadas.length, 6); assert.match(texto(raiz), /Recebimento integral/); assert.match(texto(raiz), /saldo R\$\s*0,00/); assert.match(texto(raiz), /Recebimento concluído para as obrigações registradas/)
      assert.equal(todos(raiz).filter(n => n.tagName === 'FORM').length, 0)
    } finally { app.unmount() }
  })
  it('pacote começa sem itens escolhidos e valor inválido não passa para a prévia', async () => {
    const { raiz, app } = tela.montar({ lead: lead('pacote'), disponivel: true })
    try {
      await preencherProposta(raiz); await mudar(raiz, 'Oferta aprovada', 'pacote'); await revisar(raiz)
      assert.match(texto(raiz), /Pacote exige ofertas/); assert.equal(chamadas.length, 0)
      await mudar(raiz, 'Site · Encontrado', ['encontrado', 'anuncios']); await mudar(raiz, 'Valor inicial combinado', '1.000,00'); await revisar(raiz)
      assert.match(texto(raiz), /sem separador de milhar/); assert.equal(chamadas.length, 0)
      await mudar(raiz, 'Valor inicial combinado', '100'); await revisar(raiz); assert.match(texto(raiz), /Pacote de ofertas/)
    } finally { app.unmount() }
  })
})
