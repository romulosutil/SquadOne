import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

type WorkflowNode = {
  name: string
  type: string
  parameters: Record<string, any>
  credentials?: Record<string, { id: string; name: string }>
  alwaysOutputData?: boolean
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
  // Desligado no n8n desde 08/10/2026 (convite frio sem retorno); o export acompanha.
  assert.equal(workflow.active, false)
  const manualTrigger = findNode(workflow, 'Executar manualmente')
  const dailyTrigger = findNode(workflow, 'Agenda diária — 9h')
  const acceptanceTrigger = findNode(workflow, 'Sincronizar aceites — 5 min')
  assert.equal(manualTrigger.type, 'n8n-nodes-base.manualTrigger')
  assert.equal(dailyTrigger.type, 'n8n-nodes-base.scheduleTrigger')
  assert.deepEqual(dailyTrigger.parameters.rule.interval, [{ field: 'days', daysInterval: 1, triggerAtHour: 9 }])
  assert.equal(acceptanceTrigger.type, 'n8n-nodes-base.scheduleTrigger')
  assert.deepEqual(acceptanceTrigger.parameters.rule.interval, [{ field: 'minutes', minutesInterval: 5 }])
  const registeredCompanies = findNode(workflow, 'Ler empresas já registradas')
  assert.equal(registeredCompanies.type, 'n8n-nodes-base.googleSheets')
  assert.equal(registeredCompanies.parameters.operation, 'read')
  assert.equal(registeredCompanies.parameters.documentId.value, '1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U')
  assert.equal(registeredCompanies.parameters.sheetName.value, '957714022')
  assert.equal(registeredCompanies.alwaysOutputData, true)
  const prepareDiscovery = findNode(workflow, 'Preparar descoberta sem repetidos')
  const preparedDiscovery = await runCode(prepareDiscovery.parameters.jsCode, {
    $: () => ({ first: () => ({ json: { query: 'teste' } }) }),
    $input: { all: () => [{ json: { 'ID da empresa': 'ChIJ-Existente' } }, { json: { company_id: 'chij-outra' } }] },
  })
  assert.deepEqual(preparedDiscovery[0].json.existingCompanyIds, ['chij-existente', 'chij-outra'])
  const normalize = findNode(workflow, 'Normalizar empresas')
  const normalized = await runCode(normalize.parameters.jsCode, {
    $: (name) => ({ first: () => ({ json: name === 'Preparar descoberta sem repetidos'
      ? { existingCompanyIds: ['chij-existente'] }
      : { query: 'teste', city: 'São Paulo/SP', targetVertical: 'distribuidora' } }) }),
    $json: { places: [
      { id: 'ChIJ-Existente', displayName: { text: 'Empresa Existente' }, formattedAddress: 'Rua 1' },
      { id: 'ChIJ-Teste', displayName: { text: 'Empresa Teste' }, formattedAddress: 'Rua 2' },
      { id: 'ChIJ-Teste', displayName: { text: 'Empresa Teste repetida' }, formattedAddress: 'Rua 2' },
    ] },
  })
  assert.equal(normalized.length, 1)
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
  const persistence = findNode(workflow, 'Persistir fila PRUMO')
  assert.equal(persistence.parameters.operation, 'append')
  assert.equal(persistence.parameters.columns.matchingColumns, undefined)
  assert.equal(persistence.parameters.options.useAppend, true)
  assert.deepEqual(findNode(workflow, 'Atualizar convite na fila').parameters.columns.matchingColumns, ['ID do lead'])

  const humanize = findNode(workflow, 'Humanizar linha da fila')
  const humanized = await runCode(humanize.parameters.jsCode, {
    $input: { all: () => [{ json: { dedupe_key: 'lead-1', company_id: 'lead-1', company_name: 'Empresa', lead_score: 55, status: 'REVIEW', whatsapp_verified: true, whatsapp_url: 'https://wa.me/5511999999999' } }] },
  })
  assert.equal(humanized[0].json.Empresa, 'Empresa')
  assert.equal(humanized[0].json.Etapa, 'Revisar')
  assert.equal(humanized[0].json.Prioridade, 55)
  assert.equal(humanized[0].json['Canal de contato'], 'WhatsApp confirmado no site')
  assert.equal(humanized[0].json['Destino do contato'], 'https://wa.me/5511999999999')

  const prepareLookup = findNode(workflow, 'Preparar busca de WhatsApp')
  const lookup = await runCode(prepareLookup.parameters.jsCode, {
    $input: { all: () => [
      { json: { company_name: 'Empresa', website: 'https://empresa.example/contato' } },
      { json: { company_name: 'Empresa FC', website: 'https://fcempresa.example/whatsapp' } },
      { json: { company_name: 'Sem site', website: '' } },
      { json: { company_name: 'Host privado', website: 'http://127.0.0.1/admin' } },
      { json: { company_name: 'IPv6 privado', website: 'http://[::1]/admin' } },
    ] },
  })
  assert.equal(lookup.length, 2)
  assert.equal(lookup[0].json.website_lookup_url, 'https://empresa.example/contato')
  assert.equal(lookup[1].json.website_lookup_url, 'https://fcempresa.example/whatsapp')
  assert.equal(findNode(workflow, 'Site — procurar WhatsApp').parameters.url, '={{ $json.website_lookup_url }}')

  const continueWithoutWebsite = findNode(workflow, 'Continuar sem site válido')
  const withoutWebsite = await runCode(continueWithoutWebsite.parameters.jsCode, {
    $input: { all: () => [
      { json: { company_name: 'Empresa', website: 'https://empresa.example/contato' } },
      { json: { company_name: 'Sem site', website: '', phone: '(11) 99999-4444' } },
      { json: { company_name: 'Host privado', website: 'http://127.0.0.1/admin' } },
      { json: { company_name: 'IPv6 privado', website: 'http://[::1]/admin' } },
    ] },
  })
  assert.equal(withoutWebsite.length, 3)
  assert.equal(withoutWebsite[0].json.company_name, 'Sem site')
  assert.equal(withoutWebsite[0].json.whatsapp_verified, false)
  assert.equal(withoutWebsite[0].json.phone_kind, 'CELULAR_PROVAVEL')
  assert.equal(withoutWebsite[0].json.whatsapp_lookup_status, 'SEM_SITE')
  assert.equal(withoutWebsite[1].json.whatsapp_lookup_status, 'SITE_NAO_CONSULTAVEL')

  const reviewConnections = workflow.connections['Enviar para revisão?'] as {
    main: Array<Array<{ node: string }>>
  }
  assert.equal(reviewConnections.main[0][0].node, 'Humanizar linha da fila')
  assert.equal(reviewConnections.main[1][0].node, 'Humanizar linha da fila')

  const confirm = findNode(workflow, 'Confirmar WhatsApp publicado')
  const confirmed = await runCode(confirm.parameters.jsCode, {
    $: () => ({ all: () => [{ json: { phone: '(11) 3333-4444', website: 'https://empresa.example' } }] }),
    $input: { all: () => [{ json: { data: '<a href="https://api.whatsapp.com/send?phone=5511987654321">WhatsApp</a>' } }] },
  })
  assert.equal(confirmed[0].json.whatsapp_verified, true)
  assert.equal(confirmed[0].json.whatsapp_url, 'https://wa.me/5511987654321')
  assert.equal(confirmed[0].json.phone_kind, 'FIXO_PROVAVEL')

  const unconfirmed = await runCode(confirm.parameters.jsCode, {
    $: () => ({ all: () => [{ json: { phone: '(11) 99999-4444', website: 'https://empresa.example' } }] }),
    $input: { all: () => [{ json: { data: '<html>Telefone: (11) 99999-4444</html>' } }] },
  })
  assert.equal(unconfirmed[0].json.whatsapp_verified, false)
  assert.equal(unconfirmed[0].json.whatsapp_url, '')

  const fixedLink = await runCode(confirm.parameters.jsCode, {
    $: () => ({ all: () => [{ json: { phone: '0800 000 5100', website: 'https://empresa.example' } }] }),
    $input: { all: () => [{ json: { data: '<a href="https://wa.me/558000005100">Atendimento</a>' } }] },
  })
  assert.equal(fixedLink[0].json.whatsapp_verified, false)
  assert.equal(fixedLink[0].json.whatsapp_url, '')

  const encoded = await runCode(confirm.parameters.jsCode, {
    $: () => ({ all: () => [{ json: { website: 'https://empresa.example' } }] }),
    $input: { all: () => [{ json: { data: 'https%3A%2F%2Fwa.me%2F5511977776666' } }] },
  })
  assert.equal(encoded[0].json.whatsapp_url, 'https://wa.me/5511977776666')

  const score = findNode(workflow, 'Pontuar para revisão humana')
  const scoreConfig = {
    minimumRating: 4,
    reviewThreshold: 60,
    targetTerms: ['distribuidora', 'atacado'],
    requiredContactChannel: 'WHATSAPP_VERIFIED',
  }
  const [topRanked, lowerRanked, noWhatsapp] = await runCode(score.parameters.jsCode, {
    $: () => ({ first: () => ({ json: scoreConfig }) }),
    $input: { all: () => [
      { json: { company_name: 'Distribuidora Alpha', address: 'Rua 1', website: 'https://alpha.example', types: 'wholesaler, store, point_of_interest', rating: 4.8, review_count: 250, business_status: 'OPERATIONAL', whatsapp_verified: true } },
      { json: { company_name: 'Comercial Beta', address: 'Rua 2', website: 'https://beta.example', types: 'store', rating: 4.1, review_count: 35, business_status: 'OPERATIONAL', whatsapp_verified: true } },
      { json: { company_name: 'Distribuidora sem canal', address: 'Rua 3', website: 'https://sem-canal.example', types: 'wholesaler, store', rating: 5, review_count: 500, business_status: 'OPERATIONAL', whatsapp_verified: false } },
    ] },
  })
  assert.ok(topRanked.json.lead_score > lowerRanked.json.lead_score)
  assert.equal(topRanked.json.status, 'REVIEW')
  assert.equal(topRanked.json.reachability_score, 20)
  assert.equal(noWhatsapp.json.status, 'DESCARTAR')
  assert.equal(noWhatsapp.json.reachability_score, 0)
  assert.match(noWhatsapp.json.research_note, /Fora da fila/u)
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
  assert.equal(workflow.active, false)
  assert.equal(findNode(workflow, 'Executar manualmente').type, 'n8n-nodes-base.manualTrigger')
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

  const editableBuilder = findNode(workflow, 'Configurar células editáveis')
  const [editableResult] = await runCode(editableBuilder.parameters.jsCode, { $json: result.json })
  const editableRequests = editableResult.json.requests as Array<Record<string, any>>
  assert.ok(editableRequests.some((request) => request.repeatCell?.range.startColumnIndex === 18))
  assert.ok(editableRequests.some((request) => request.setDataValidation?.range.startColumnIndex === 21))
  const noContactValidation = editableRequests.find((request) => request.setDataValidation?.range.startColumnIndex === 26)?.setDataValidation
  assert.equal(noContactValidation?.rule.condition.type, 'ONE_OF_LIST')
  assert.deepEqual(noContactValidation?.rule.condition.values.map((value: any) => value.userEnteredValue), ['Sim', 'Não'])

  const api = findNode(workflow, 'Aplicar na planilha')
  assert.equal(api.parameters.authentication, 'predefinedCredentialType')
  assert.equal(api.credentials?.googleSheetsOAuth2Api?.id, '5Dy1tDUiFtAq7PHj')
})
