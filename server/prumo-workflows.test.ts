import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

type WorkflowNode = {
  name: string
  type: string
  parameters: Record<string, any>
  credentials?: Record<string, { id: string; name: string }>
}

type Workflow = {
  id: string
  active: boolean
  nodes: WorkflowNode[]
  connections: Record<string, unknown>
}

const load = async (name: string): Promise<Workflow> => {
  const url = new URL(`../ops/n8n/workflows/${name}`, import.meta.url)
  return JSON.parse(await readFile(url, 'utf8'))[0]
}

const findNode = (workflow: Workflow, name: string) => {
  const found = workflow.nodes.find((candidate) => candidate.name === name)
  assert.ok(found, `nó ausente: ${name}`)
  return found
}

const runCode = async (
  code: string,
  context: { $?: (name: string) => unknown; $input?: unknown; $json?: unknown },
) => {
  const execute = new Function('$', '$input', '$json', `return (async () => { ${code} })()`) as (
    select: unknown,
    input: unknown,
    json: unknown,
  ) => Promise<Array<{ json: Record<string, any> }>>
  return execute(context.$, context.$input, context.$json)
}

const questionAnswers = {
  'Quando um vendedor precisa dar um desconto ou um prazo diferente do padrão': 'Existe regra escrita, publicada, todo mundo segue',
  'Como vocês decidem se um cliente novo pode comprar a prazo': 'Critério escrito e seguido por quem vende',
  'Se eu pedir o preço de um produto pra você': 'Sempre bate — tabela única, com dono e data de revisão',
  'Quando vocês abrem uma exceção de preço ou desconto': 'Registra e é consultado quando o caso se repete',
  'Como vocês escolhem entre dois fornecedores': 'Critério escrito e seguido',
  'Existe um valor a partir do qual uma compra': 'Limite definido, escrito e respeitado',
  'Existe um cadastro único de fornecedores': 'Cadastro único, atualizado, com responsável',
  'Quando vocês trocam de fornecedor': 'Registra e consulta quando decide de novo',
  'Quando um cliente com título vencido faz um pedido novo': 'Regra clara, todo mundo segue',
  'Existe uma sequência definida de quando ligar': 'Escrita e seguida',
  'Onde vocês veem quem está inadimplente hoje': 'Fonte única, atualizada, todo mundo consulta ali',
  'Quando decidem cortar ou manter um cliente que atrasa': 'Registra e consulta depois',
  'Se uma pessoa-chave faltasse duas semanas': 'Backup definido e treinado',
  'As pessoas sabem exatamente até onde podem decidir': 'Está escrito e todos conhecem',
  'Existe um organograma ou documento que mostra quem faz o quê': 'Documento existe e está atualizado',
  'Você lembra de decidir a mesma coisa mais de uma vez': 'Nunca acontece',
}

const response = (companyRef: string, role: string, timestamp: string) => ({
  Empresa: companyRef,
  'Sessão / papel de quem está respondendo': role,
  'Carimbo de data/hora': timestamp,
  ...questionAnswers,
})

test('Lead Scout cria company_id e prepara convite somente após aceite', async () => {
  const workflow = await load('prumo-lead-scout.json')
  const normalize = findNode(workflow, 'Normalizar empresas')
  const normalized = await runCode(normalize.parameters.jsCode, {
    $: () => ({ first: () => ({ json: { query: 'teste', city: 'São Paulo/SP', targetVertical: 'distribuidora' } }) }),
    $json: { places: [{ id: 'ChIJ-Teste', displayName: { text: 'Empresa Teste' }, formattedAddress: 'Rua 1' }] },
  })
  assert.equal(normalized[0].json.company_id, 'chij-teste')
  assert.equal(normalized[0].json.dedupe_key, 'chij-teste')

  const prepare = findNode(workflow, 'Preparar convite do diagnóstico')
  const ignored = await runCode(prepare.parameters.jsCode, {
    $input: { all: () => [{ json: { 'ID da empresa': 'lead-1', Empresa: 'Empresa', Etapa: 'Revisar' } }] },
  })
  assert.deepEqual(ignored, [])

  const prepared = await runCode(prepare.parameters.jsCode, {
    $input: { all: () => [{ json: { 'ID da empresa': 'lead-1', 'ID do lead': 'lead-1', Empresa: 'Empresa', Etapa: 'Contato aceito', 'Canal de contato': 'email', 'Destino do contato': 'contato@example.com' } }] },
  })
  assert.equal(prepared[0].json.Etapa, 'Convite pronto')
  assert.equal(prepared[0].json['Situação do diagnóstico'], 'Convite pronto')
  assert.match(prepared[0].json['Formulário do diagnóstico'], /entry\.171063854=lead-1%3A%3AEmpresa/u)
  assert.match(prepared[0].json['Enviar convite'], /^mailto:contato@example\.com/u)
  assert.deepEqual(findNode(workflow, 'Atualizar convite na fila').parameters.columns.matchingColumns, ['ID do lead'])

  const humanize = findNode(workflow, 'Humanizar linha da fila')
  const humanized = await runCode(humanize.parameters.jsCode, {
    $input: { all: () => [{ json: { dedupe_key: 'lead-1', company_id: 'lead-1', company_name: 'Empresa', lead_score: 55, status: 'REVIEW' } }] },
  })
  assert.equal(humanized[0].json.Empresa, 'Empresa')
  assert.equal(humanized[0].json.Etapa, 'Revisar')
  assert.equal(humanized[0].json.Prioridade, 55)
})

test('Diagnóstico usa a planilha real, consolida uma sessão por papel e devolve briefing ao lead', async () => {
  const workflow = await load('prumo-diagnostico.json')
  const trigger = findNode(workflow, 'Verificar respostas do Form — 5 min')
  const manualTrigger = findNode(workflow, 'Reprocessar diagnóstico manualmente')
  const reader = findNode(workflow, 'Ler todas as sessões da empresa')
  assert.equal(trigger.type, 'n8n-nodes-base.scheduleTrigger')
  assert.equal(manualTrigger.type, 'n8n-nodes-base.manualTrigger')
  assert.equal(reader.parameters.documentId.value, '17YaTuRFLSWyhRCcEE1LL4qSP81OLQHtZPV-jLO-xZXE')
  assert.equal(reader.parameters.sheetName.value, '1819422736')
  assert.equal(reader.parameters.operation, 'read')
  assert.equal(reader.credentials?.googleSheetsOAuth2Api?.id, '5Dy1tDUiFtAq7PHj')

  const companyRef = 'chij-teste::Empresa Teste'
  const roles = ['Dono', 'Vendas', 'Compras', 'Financeiro/Cobrança', 'Operação/Entrega']
  const rows = roles.map((role, index) => response(companyRef, role, `22/09/2026 0${index}:00:00`))
  rows.splice(1, 0, response(companyRef, 'Dono', '22/09/2026 00:30:00'))

  const aggregate = findNode(workflow, 'Agrupar e calcular Índice Prumo')
  const aggregateResult = await runCode(aggregate.parameters.jsCode, {
    $input: { all: () => rows.map((json) => ({ json })) },
  })
  const result = aggregateResult[0].json
  assert.equal(result.company_id, 'chij-teste')
  assert.equal(result.sessionCount, 5)
  assert.equal(result.answerCount, 80)
  assert.equal(result.prumoIndex, 100)
  assert.equal(result.status, 'READY')
  assert.deepEqual(result.pendingRoles, [])

  const briefing = findNode(workflow, 'Briefing do relatório — revisão humana')
  const briefingResult = await runCode(briefing.parameters.jsCode, { $json: result })
  assert.equal(briefingResult[0].json.Etapa, 'Diagnóstico para revisar')
  assert.equal(briefingResult[0].json['Situação do diagnóstico'], 'Revisão necessária')
  assert.match(briefingResult[0].json['Briefing interno'], /Índice PRUMO: 100\/100/u)
  assert.ok(workflow.connections['Briefing do relatório — revisão humana'])
  assert.ok(workflow.connections['Aguardar sessões faltantes'])
})

test('Diagnóstico incompleto registra precisamente os papéis pendentes', async () => {
  const workflow = await load('prumo-diagnostico.json')
  const companyRef = 'chij-teste::Empresa Teste'
  const owner = response(companyRef, 'Dono', '22/09/2026 10:00:00')
  const aggregate = findNode(workflow, 'Agrupar e calcular Índice Prumo')
  const aggregateResult = await runCode(aggregate.parameters.jsCode, {
    $input: { all: () => [{ json: owner }] },
  })
  assert.equal(aggregateResult[0].json.status, 'WAITING_FOR_SESSIONS')
  assert.deepEqual(aggregateResult[0].json.pendingRoles, ['Vendas', 'Compras', 'Financeiro/Cobrança', 'Operação/Entrega'])

  const waiting = findNode(workflow, 'Aguardar sessões faltantes')
  const waitingResult = await runCode(waiting.parameters.jsCode, { $json: aggregateResult[0].json })
  assert.equal(waitingResult[0].json.Etapa, 'Diagnóstico em andamento')
  assert.match(waitingResult[0].json['Próxima ação'], /Vendas, Compras/u)
})

test('Preparação da planilha preserva o vínculo técnico e entrega uma fila humana', async () => {
  const workflow = await load('prumo-preparar-planilha.json')
  const builder = findNode(workflow, 'Montar visual e validações')
  const [result] = await runCode(builder.parameters.jsCode, {})
  const requests = result.json.requests as Array<Record<string, any>>

  const headerUpdate = requests.find((request) => request.updateCells)
  const headers = headerUpdate?.updateCells.rows[0].values.map((cell: any) => cell.userEnteredValue.stringValue)
  assert.equal(headers.length, 50)
  assert.equal(headers[2], 'Empresa')
  assert.equal(headers[16], 'Etapa')
  assert.equal(headers[31], 'ID da empresa')
  assert.equal(headers[46], 'Próxima ação')
  assert.ok(requests.some((request) => request.setBasicFilter))
  assert.ok(requests.some((request) => request.setDataValidation?.range.startColumnIndex === 16))

  const api = findNode(workflow, 'Aplicar na planilha')
  assert.equal(api.parameters.authentication, 'predefinedCredentialType')
  assert.equal(api.credentials?.googleSheetsOAuth2Api?.id, '5Dy1tDUiFtAq7PHj')
})
