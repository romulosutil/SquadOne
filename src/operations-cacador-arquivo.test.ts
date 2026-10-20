import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { it } from 'node:test'

const arquivo = new URL('../ops/n8n/workflows/01-Cacador.sanitizado.json', import.meta.url)
const schema = JSON.parse(await fs.readFile(new URL('../ops/n8n/workflows/01-Cacador.schema.json', import.meta.url), 'utf8'))
const texto = await fs.readFile(arquivo, 'utf8')
const workflows = JSON.parse(texto)
const interno = JSON.parse(workflows[0].nodes.find((n: any) => n.type === 'n8n-nodes-base.executeWorkflow').parameters.workflowJson)
const todos = [workflows[0], interno]

it('arquivo do Caçador tem esquema explícito, dois grafos íntegros e ambos inativos', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.deepEqual(schema.items, { $ref: '#/$defs/workflow' })
  assert.equal(workflows.length, 1)
  assert.deepEqual(todos.map(w => w.nodes.length), [7, 32])
  for (const w of todos) {
    for (const campo of schema.$defs.workflow.required) assert.ok(Object.hasOwn(w, campo), campo)
    assert.ok(Object.keys(w).every(k => Object.hasOwn(schema.$defs.workflow.properties, k)))
    assert.equal(w.active, false)
    const nomes = new Set(w.nodes.map((n: any) => n.name))
    assert.equal(new Set(w.nodes.map((n: any) => n.id)).size, w.nodes.length)
    assert.equal(nomes.size, w.nodes.length)
    for (const n of w.nodes) {
      for (const campo of schema.$defs.node.required) assert.ok(Object.hasOwn(n, campo), campo)
      assert.ok(Object.keys(n).every(k => Object.hasOwn(schema.$defs.node.properties, k)), n.name)
      assert.match(n.type, /^n8n-nodes-base\./)
      assert.equal(n.position.length, 2)
      if (n.parameters.jsCode) {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
        assert.doesNotThrow(() => new AsyncFunction(n.parameters.jsCode), n.name)
      }
    }
    for (const [origem, saidas] of Object.entries(w.connections)) {
      assert.ok(nomes.has(origem), origem)
      for (const grupos of Object.values(saidas as any) as any[])
        for (const conexoes of grupos) for (const aresta of conexoes) assert.ok(nomes.has(aresta.node), aresta.node)
    }
  }
})

it('arquivo sanitizado não carrega estado de execução nem credenciais e sanitiza workflowJson também', () => {
  const segredo = /AIza[\w-]{20,}|(?:sk|gsk|ghp|gho|xoxb)[_-][A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]{20,}/
  assert.doesNotMatch(texto, segredo)
  let refs = 0
  const visitar = (v: any) => {
    if (!v || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) {
      assert.ok(!['pinData', 'staticData', 'shared', 'activeVersion', 'webhookId'].includes(k), k)
      if (k === 'credentials') {
        for (const ref of Object.values(x as object)) {
          assert.deepEqual(ref, { id: 'REDACTED_CREDENTIAL_ID', name: 'CONFIGURAR_MANUALMENTE' }); refs++
        }
      } else if (k === 'workflowJson') visitar(JSON.parse(x as string))
      else if (k === 'documentId') assert.equal((x as any).value, 'REDACTED_SPREADSHEET_ID')
      else visitar(x)
    }
  }
  visitar(workflows)
  assert.equal(refs, 9)
})

it('fonte do dedupe permanece auditável antes da criação do lead', () => {
  const montar = interno.nodes.find((n: any) => n.name === 'Montar lead').parameters.jsCode
  assert.match(montar, /Ler leads existentes/)
  assert.match(montar, /const vistos = new Set\(\)/)
  assert.match(montar, /if \(vistos\.has\(p\.place_id\)\) continue/)
  assert.match(montar, /vistos\.add\(p\.place_id\)/)
})
