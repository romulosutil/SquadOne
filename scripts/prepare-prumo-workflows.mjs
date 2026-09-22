import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const [leadSource, diagnosticSource, outputDirectory = 'ops/n8n/workflows'] = process.argv.slice(2)

if (!leadSource || !diagnosticSource) {
  throw new Error('Uso: node scripts/prepare-prumo-workflows.mjs <lead-export.json> <diagnostico-export.json> [saida]')
}

const REVIEW_SHEET_ID = '1rkUJ41FguxIjibkEHS1paZdTxEXtelcqqYyBQqHhp7U'
const REVIEW_SHEET_GID = '957714022'
const RESPONSE_SHEET_ID = '17YaTuRFLSWyhRCcEE1LL4qSP81OLQHtZPV-jLO-xZXE'
const RESPONSE_SHEET_GID = '1819422736'
const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScknF_YOBUHrX94tfgykv37NaEryAzqzIdc55Hel8RX1wp2Sg/viewform'
const COMPANY_ENTRY_ID = '171063854'
const SHEETS_CREDENTIAL = { googleSheetsOAuth2Api: { id: '5Dy1tDUiFtAq7PHj', name: 'Google Sheets account' } }

const loadWorkflow = async (path) => {
  const parsed = JSON.parse(await readFile(resolve(path), 'utf8'))
  return Array.isArray(parsed) ? parsed[0] : parsed
}

const node = (workflow, name) => {
  const found = workflow.nodes.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Nó não encontrado: ${name}`)
  return found
}

const sheetLocator = (id, cachedResultName) => ({ __rl: true, value: id, mode: 'list', cachedResultName })

const sheetsNode = ({ id, name, position, documentId = REVIEW_SHEET_ID, sheetId = REVIEW_SHEET_GID, documentName = 'PRUMO — Fila de revisão', sheetName = 'Leads', operation = 'appendOrUpdate', matchingColumns = ['ID da empresa'] }) => ({
  parameters: operation === 'read'
    ? {
        operation,
        documentId: sheetLocator(documentId, documentName),
        sheetName: sheetLocator(sheetId, sheetName),
        filtersUI: { values: [] },
        combineFilters: 'AND',
        options: {},
      }
    : {
        operation,
        documentId: sheetLocator(documentId, documentName),
        sheetName: sheetLocator(sheetId, sheetName),
        columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns, schema: [] },
        options: {},
      },
  id,
  name,
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.7,
  position,
  credentials: SHEETS_CREDENTIAL,
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 2000,
})

const codeNode = (id, name, position, jsCode) => ({
  parameters: { jsCode },
  id,
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position,
})

const sanitize = (workflow) => [{
  id: workflow.id,
  name: workflow.name,
  description: workflow.description ?? null,
  active: workflow.active,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings ?? { executionOrder: 'v1' },
}]

const lead = await loadWorkflow(leadSource)
const diagnostic = await loadWorkflow(diagnosticSource)

lead.nodes = lead.nodes.filter((candidate) => !['10', '11', '12', '13', '14', '15', '16', '17'].includes(candidate.id))
diagnostic.nodes = diagnostic.nodes.filter((candidate) => !['7', '8', '9'].includes(candidate.id))

node(lead, 'Config — mercado-alvo').parameters.jsCode = `// Edite somente o mercado-alvo. O vínculo com o diagnóstico é estável e versionado.
const city = 'São Paulo/SP';
const targetVertical = 'distribuidora';
return [{ json: {
  city,
  targetVertical,
  query: \`${'${targetVertical}'} em ${'${city}'}\`,
  minimumReviewCount: 30,
  minimumRating: 4,
  reviewThreshold: 60,
  targetTerms: ['distribuidora', 'distribuidor', 'distribuicao', 'atacado', 'atacadista'],
  requiredContactChannel: 'WHATSAPP_VERIFIED',
  diagnosticFormUrl: '${FORM_URL}',
  diagnosticCompanyEntryId: '${COMPANY_ENTRY_ID}',
} }];`

node(lead, 'Normalizar empresas').parameters.jsCode = `const cfg = $('Config — mercado-alvo').first().json;
const places = $json.places ?? [];
const discoveredAt = new Date().toISOString();

return places.map((place) => {
  const companyName = place.displayName?.text ?? '';
  const address = place.formattedAddress ?? '';
  const placeId = place.id ?? '';
  const companyId = (placeId || \`${'${companyName}'}|${'${address}'}\`).toLowerCase();
  return {
    json: {
      dedupe_key: companyId,
      company_id: companyId,
      place_id: placeId,
      company_name: companyName,
      address,
      website: place.websiteUri ?? '',
      phone: place.nationalPhoneNumber ?? '',
      types: (place.types ?? []).join(', '),
      rating: Number(place.rating ?? 0),
      review_count: Number(place.userRatingCount ?? 0),
      business_status: place.businessStatus ?? 'UNKNOWN',
      discovered_at: discoveredAt,
      search_query: cfg.query,
      city: cfg.city,
      target_vertical: cfg.targetVertical,
    },
  };
});`

node(lead, 'Pontuar para revisão humana').parameters.jsCode = `const cfg = $('Config — mercado-alvo').first().json;

return $input.all().map(({ json: lead }) => {
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rating = clamp(Number(lead.rating ?? 0), 0, 5);
  const reviewCount = Math.max(0, Number(lead.review_count ?? 0));
  const types = String(lead.types ?? '').split(',').map(type => type.trim()).filter(Boolean);
  const targetTerms = Array.isArray(cfg.targetTerms) ? cfg.targetTerms.map(normalize).filter(Boolean) : [];
  const searchable = normalize([lead.company_name, lead.types].join(' '));

  const operationalScore = lead.business_status === 'OPERATIONAL' ? 10 : 0;
  const verticalScore = targetTerms.some(term => searchable.includes(term)) ? 15 : 0;
  const ratingScore = rating >= cfg.minimumRating
    ? Math.round(5 + (10 * (rating - cfg.minimumRating)) / Math.max(0.1, 5 - cfg.minimumRating))
    : Math.round(4 * rating / Math.max(0.1, cfg.minimumRating));
  const reviewScore = Math.round(15 * Math.log1p(Math.min(reviewCount, 500)) / Math.log1p(500));
  const addressScore = lead.address ? 5 : 0;
  const fit = clamp(operationalScore + verticalScore + ratingScore + reviewScore + addressScore, 0, 60);

  const footprintScore = Math.round(10 * Math.log1p(Math.min(reviewCount, 500)) / Math.log1p(500));
  const categoryScore = clamp(types.length - 1, 0, 5);
  const siteScore = lead.website ? 5 : 0;
  const complexity = clamp(footprintScore + categoryScore + siteScore, 0, 20);
  const reachability = lead.whatsapp_verified ? 20 : 0;
  const reasons = [];

  // Public signals only: priority for human research, never a diagnosis.
  if (operationalScore) reasons.push('operação ativa no Google');
  if (verticalScore) reasons.push('nome ou categoria aderente ao segmento-alvo');
  reasons.push(\`nota ${'${rating || 0}'} (${'${ratingScore}'}/15)\`);
  reasons.push(\`${'${reviewCount}'} avaliações (${'${reviewScore}'}/15 em aderência; ${'${footprintScore}'}/10 em complexidade)\`);
  if (addressScore) reasons.push('endereço comercial público');
  if (siteScore) reasons.push('site institucional público');
  if (categoryScore) reasons.push(\`${'${types.length}'} categorias públicas (${'${categoryScore}'}/5 em complexidade)\`);
  if (lead.whatsapp_verified) {
    reasons.push('WhatsApp publicado no site institucional (20/20)');
  } else {
    reasons.push('sem WhatsApp confirmado: inelegível para abordagem');
  }

  const leadScore = Math.min(100, fit + complexity + reachability);
  const whatsappEligible = cfg.requiredContactChannel === 'WHATSAPP_VERIFIED' && lead.whatsapp_verified === true;
  const status = whatsappEligible && leadScore >= cfg.reviewThreshold ? 'REVIEW' : 'DESCARTAR';
  const researchNote = !whatsappEligible
    ? 'Fora da fila: nenhum WhatsApp publicado foi confirmado no site institucional.'
    : status === 'REVIEW'
      ? 'Validar segmento, porte e decisor antes da abordagem pelo WhatsApp confirmado.'
      : \`WhatsApp confirmado, mas prioridade ${'${leadScore}'} ficou abaixo do corte ${'${cfg.reviewThreshold}'}.\`;

  return { json: {
    ...lead,
    whatsapp_eligible: whatsappEligible,
    fit_score: fit,
    complexity_score: complexity,
    reachability_score: reachability,
    lead_score: leadScore,
    score_reason: reasons.join('; '),
    status,
    research_note: researchNote,
  }};
});`

node(lead, 'Registrar falha de descoberta').parameters.jsCode = `const cfg = $('Config — mercado-alvo').first().json;
const error = $json.error ?? {};
const cause = error.message ?? error.description ?? $json.message ?? 'Falha sem detalhe retornado pelo Google Places';
const occurredAt = new Date().toISOString();
const companyId = \`google-places-error-${'${Date.now()}'}\`;
return [{ json: {
  dedupe_key: companyId,
  company_id: companyId,
  place_id: '',
  company_name: '[FALHA] Google Places',
  address: '', website: '', phone: '', types: '', rating: '', review_count: '', business_status: '',
  discovered_at: occurredAt,
  fit_score: '', complexity_score: '', reachability_score: '', lead_score: '', score_reason: '',
  status: 'ERROR',
  research_note: \`Consulta: ${'${cfg.query}'}. Após 3 tentativas, Google Places falhou. Causa: ${'${String(cause).slice(0, 800)}'}\`,
} }];`

node(lead, 'Persistir fila PRUMO').parameters.columns.matchingColumns = ['ID do lead']

lead.nodes.push(
  {
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } },
    id: '10',
    name: 'Sincronizar aceites — 5 min',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [-420, 500],
  },
  sheetsNode({ id: '11', name: 'Ler fila para convites', position: [-180, 500], operation: 'read' }),
  codeNode('12', 'Preparar convite do diagnóstico', [80, 500], `const FORM_URL = '${FORM_URL}';
const COMPANY_ENTRY_ID = '${COMPANY_ENTRY_ID}';
const now = new Date().toISOString();
const value = (lead, ...labels) => labels.map(label => lead[label]).find(candidate => candidate !== undefined && candidate !== null) ?? '';
const normalizeState = state => String(state ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

return $input.all().flatMap(({ json: lead }) => {
  const status = normalizeState(value(lead, 'Etapa', 'status'));
  const diagnosticStatus = normalizeState(value(lead, 'Situação do diagnóstico', 'diagnostic_status'));
  if (!['CONTATO ACEITO', 'CONTACT_ACCEPTED'].includes(status)) return [];
  if (['CONVITE PRONTO', 'INVITE_READY', 'CONVITE ENVIADO', 'INVITED', 'EM ANDAMENTO', 'IN_PROGRESS', 'AGUARDANDO RESPOSTAS', 'WAITING_FOR_SESSIONS', 'REVISAO NECESSARIA', 'REVIEW_REQUIRED', 'CONCLUIDO', 'COMPLETED'].includes(diagnosticStatus)) return [];

  const companyId = String(value(lead, 'ID da empresa', 'company_id', 'ID do lead', 'dedupe_key')).trim();
  const companyName = String(value(lead, 'Empresa', 'company_name')).trim();
  if (!companyId || !companyName) return [];

  const companyRef = \`${'${companyId}'}::${'${companyName}'}\`;
  const formUrl = \`${'${FORM_URL}'}?usp=pp_url&entry.${'${COMPANY_ENTRY_ID}'}=${'${encodeURIComponent(companyRef)}'}\`;
  const message = \`Olá! Conforme combinado, este é o diagnóstico operacional PRUMO de ${'${companyName}'}. Cada uma das cinco perspectivas deve responder uma vez: ${'${formUrl}'}\`;
  const channel = String(value(lead, 'Canal de contato', 'contact_channel')).trim().toLowerCase();
  const destination = String(value(lead, 'Destino do contato', 'contact_url')).trim();
  let actionUrl = formUrl;
  if (channel.includes('whatsapp')) {
    const directNumber = destination.match(/(?:wa\\.me\\/|[?&]phone=)(\\d{10,15})/i)?.[1] ?? '';
    let digits = directNumber || destination.replace(/\\D/g, '');
    if (digits.length === 10 || digits.length === 11) digits = \`55${'${digits}'}\`;
    if (digits.length >= 12 && digits.length <= 15) actionUrl = \`https://wa.me/${'${digits}'}?text=${'${encodeURIComponent(message)}'}\`;
    else if (/^https?:\\/\\/(?:wa\\.me|(?:api\\.|web\\.)?whatsapp\\.com)\\//i.test(destination)) actionUrl = destination;
  } else if (channel.includes('email') || destination.includes('@')) {
    const email = destination.replace(/^mailto:/i, '');
    actionUrl = \`mailto:${'${email}'}?subject=${'${encodeURIComponent(`Diagnóstico PRUMO — ${companyName}`)}'}&body=${'${encodeURIComponent(message)}'}\`;
  }

  return [{ json: {
    'ID da empresa': companyId,
    'ID do lead': String(value(lead, 'ID do lead', 'dedupe_key') || companyId),
    'Etapa': 'Convite pronto',
    'Situação do diagnóstico': 'Convite pronto',
    'Formulário do diagnóstico': formUrl,
    'Mensagem do convite': message,
    'Enviar convite': actionUrl,
    'Próxima ação': 'Envie o convite pelo canal validado. Depois, marque a situação do diagnóstico como “Convite enviado”.',
    'Atualizado em': now,
  } }];
});`),
  sheetsNode({ id: '13', name: 'Atualizar convite na fila', position: [360, 500], matchingColumns: ['ID do lead'] }),
  codeNode('14', 'Humanizar linha da fila', [980, 80], `const labels = {
  REVIEW: 'Revisar',
  DESCARTAR: 'Fora do perfil',
  ERROR: 'Erro na descoberta',
  CONTACT_ACCEPTED: 'Contato aceito',
  DIAGNOSTIC_INVITE_READY: 'Convite pronto',
  DIAGNOSTIC_IN_PROGRESS: 'Diagnóstico em andamento',
  DIAGNOSTIC_REVIEW: 'Diagnóstico para revisar',
};

return $input.all().map(({ json: lead }) => ({ json: {
  'ID do lead': lead.dedupe_key,
  'Google Place ID': lead.place_id,
  'Empresa': lead.company_name,
  'Endereço': lead.address,
  'Site': lead.website,
  'Telefone': lead.phone,
  'Categorias no Google': lead.types,
  'Nota no Google': lead.rating,
  'Avaliações no Google': lead.review_count,
  'Situação no Google': lead.business_status,
  'Encontrado em': lead.discovered_at,
  'Aderência': lead.fit_score,
  'Complexidade': lead.complexity_score,
  'Facilidade de contato': lead.reachability_score,
  'Prioridade': lead.lead_score,
  'Motivo da prioridade': lead.score_reason,
  'Etapa': labels[lead.status] ?? lead.status,
  'Próxima verificação': lead.research_note,
  'Busca de origem': lead.search_query,
  'Cidade': lead.city,
  'Segmento': lead.target_vertical,
  'ID da empresa': lead.company_id,
  ...(lead.whatsapp_verified ? {
    'Canal de contato': 'WhatsApp confirmado no site',
    'Destino do contato': lead.whatsapp_url,
  } : {}),
  'Erro técnico': lead.status === 'ERROR' ? lead.research_note : '',
} }));`),
  codeNode('15', 'Preparar busca de WhatsApp', [260, 100], `const privateIpv4 = host => {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
};

return $input.all().flatMap(({ json: lead }) => {
  try {
    const url = new URL(String(lead.website ?? '').trim());
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    const blockedHost = host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || host.endsWith('.internal')
      || host === '::1'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || host.startsWith('fe80:')
      || privateIpv4(host);
    if (!['http:', 'https:'].includes(url.protocol) || blockedHost) return [];
    return [{ json: { ...lead, website_lookup_url: url.toString() } }];
  } catch {
    return [];
  }
});`),
  {
    parameters: {
      url: '={{ $json.website_lookup_url }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (compatible; PRUMO-LeadScout/1.0)' }] },
      options: {
        timeout: 8000,
        response: { response: { neverError: true, responseFormat: 'text' } },
        redirect: { redirect: { followRedirects: true, maxRedirects: 4 } },
      },
    },
    id: '16',
    name: 'Site — procurar WhatsApp',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [260, 100],
    onError: 'continueRegularOutput',
  },
  codeNode('17', 'Confirmar WhatsApp publicado', [760, 100], `const responses = $input.all();
const leads = $('Preparar busca de WhatsApp').all();

return responses.map(({ json: response }, index) => {
  const lead = leads[index]?.json ?? {};
  const rawHtml = typeof response === 'string'
    ? response
    : String(response.data ?? response.body ?? response.html ?? '');
  const decodeEntities = value => value
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/&#x0*26;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');
  let decoded = decodeEntities(rawHtml);
  try {
    if (/%(?:2f|3a|3f|3d)/i.test(decoded)) decoded += \`\\n${'${decodeURIComponent(decoded)}'}\`;
  } catch {}
  const patterns = [
    /https?:\\/\\/(?:api\\.|web\\.)?whatsapp\\.com\\/(?:send\\/?)?\\?[^"'<>\\s]*/gi,
    /https?:\\/\\/wa\\.me\\/(?:message\\/)?[^"'<>\\s]*/gi,
    /whatsapp:\\/\\/send\\?[^"'<>\\s]*/gi,
  ];
  const candidates = patterns.flatMap(pattern => decoded.match(pattern) ?? []);
  let whatsappUrl = '';
  let whatsappNumber = '';

  for (const candidate of candidates) {
    const clean = candidate.replace(/[),.;]+$/u, '');
    const phoneParam = clean.match(/[?&]phone=(?:%2B|\\+)?(\\d{10,15})/i)?.[1] ?? '';
    const pathNumber = clean.match(/wa\\.me\\/(\\+?\\d{10,15})(?:[?/#]|$)/i)?.[1] ?? '';
    let digits = (phoneParam || pathNumber).replace(/\\D/g, '');
    if (digits.length === 10 || digits.length === 11) digits = \`55${'${digits}'}\`;
    if (digits.length >= 12 && digits.length <= 15) {
      whatsappNumber = digits;
      whatsappUrl = \`https://wa.me/${'${digits}'}\`;
      break;
    }
    if (!whatsappUrl && /wa\\.me\\/message\\//i.test(clean)) whatsappUrl = clean;
  }

  const phoneDigits = String(lead.phone ?? '').replace(/\\D/g, '');
  const localDigits = phoneDigits.startsWith('55') && phoneDigits.length >= 12 ? phoneDigits.slice(2) : phoneDigits;
  const phoneKind = localDigits.length === 11 && localDigits[2] === '9'
    ? 'CELULAR_PROVAVEL'
    : localDigits.length === 10
      ? 'FIXO_PROVAVEL'
      : lead.phone ? 'NAO_CLASSIFICADO' : 'AUSENTE';

  return { json: {
    ...lead,
    phone_kind: phoneKind,
    whatsapp_verified: Boolean(whatsappUrl),
    whatsapp_url: whatsappUrl,
    whatsapp_number: whatsappNumber,
    whatsapp_source: whatsappUrl ? 'Site institucional' : '',
  } };
});`),
)

lead.connections['Normalizar empresas'] = { main: [[{ node: 'Preparar busca de WhatsApp', type: 'main', index: 0 }]] }
lead.connections['Preparar busca de WhatsApp'] = { main: [[{ node: 'Site — procurar WhatsApp', type: 'main', index: 0 }]] }
lead.connections['Site — procurar WhatsApp'] = { main: [[{ node: 'Confirmar WhatsApp publicado', type: 'main', index: 0 }]] }
lead.connections['Confirmar WhatsApp publicado'] = { main: [[{ node: 'Pontuar para revisão humana', type: 'main', index: 0 }]] }
lead.connections['Enviar para revisão?'].main[0] = [{ node: 'Humanizar linha da fila', type: 'main', index: 0 }]
lead.connections['Registrar falha de descoberta'] = { main: [[{ node: 'Humanizar linha da fila', type: 'main', index: 0 }]] }
lead.connections['Humanizar linha da fila'] = { main: [[{ node: 'Persistir fila PRUMO', type: 'main', index: 0 }]] }

lead.connections['Sincronizar aceites — 5 min'] = { main: [[{ node: 'Ler fila para convites', type: 'main', index: 0 }]] }
lead.connections['Ler fila para convites'] = { main: [[{ node: 'Preparar convite do diagnóstico', type: 'main', index: 0 }]] }
lead.connections['Preparar convite do diagnóstico'] = { main: [[{ node: 'Atualizar convite na fila', type: 'main', index: 0 }]] }

const responseTrigger = diagnostic.nodes.find((candidate) => ['Nova resposta do Form', 'Verificar respostas do Form — 5 min'].includes(candidate.name))
if (!responseTrigger) throw new Error('Nó não encontrado: Nova resposta do Form')
responseTrigger.name = 'Verificar respostas do Form — 5 min'
responseTrigger.type = 'n8n-nodes-base.scheduleTrigger'
responseTrigger.typeVersion = 1.2
responseTrigger.parameters = { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }
delete responseTrigger.credentials

const responseReader = node(diagnostic, 'Ler todas as sessões da empresa')
responseReader.parameters = {
  operation: 'read',
  documentId: sheetLocator(RESPONSE_SHEET_ID, 'Prumo — Roteiro do Mapa (Matriz de Domínios) (respostas)'),
  sheetName: sheetLocator(RESPONSE_SHEET_GID, 'Respostas ao formulário 1'),
  filtersUI: { values: [] },
  combineFilters: 'AND',
  options: {},
}
responseReader.credentials = SHEETS_CREDENTIAL
responseReader.typeVersion = 4.7

node(diagnostic, 'Agrupar e calcular Índice Prumo').parameters.jsCode = `const allRows = $input.all().map(item => item.json);
const companyRefs = [...new Set(allRows.map(row => String(row['Empresa'] ?? '').trim()).filter(Boolean))];
const requiredRoles = ['Dono', 'Vendas', 'Compras', 'Financeiro/Cobrança', 'Operação/Entrega'];
const questions = [
  { id: 'AR1', area: 'Vendas e precificação', prefix: 'Quando um vendedor precisa dar um desconto ou um prazo diferente do padrão', choices: ['Liga pro dono toda vez','Decide sozinho, mas sem regra escrita — cada um usa seu critério','Existe uma regra, mas nem todo mundo segue ou conhece','Existe regra escrita, publicada, todo mundo segue'] },
  { id: 'AR2', area: 'Vendas e precificação', prefix: 'Como vocês decidem se um cliente novo pode comprar a prazo', choices: ['O dono decide cada caso, sem critério fixo','Existe um critério, mas só na cabeça de quem decide','Existe critério escrito, mas nem sempre é consultado','Critério escrito e seguido por quem vende'] },
  { id: 'AD1', area: 'Vendas e precificação', prefix: 'Se eu pedir o preço de um produto pra você', choices: ['Não sei / provavelmente não','Às vezes bate, às vezes não','Geralmente bate, mas tem mais de um lugar com o preço','Sempre bate — tabela única, com dono e data de revisão'] },
  { id: 'AM1', area: 'Vendas e precificação', prefix: 'Quando vocês abrem uma exceção de preço ou desconto', choices: ['Nunca registra','Às vezes, informalmente (WhatsApp, e-mail avulso)','Registra, mas ninguém revisita depois','Registra e é consultado quando o caso se repete'] },
  { id: 'BR1', area: 'Compras', prefix: 'Como vocês escolhem entre dois fornecedores', choices: ['Cada compra é decidida na hora, sem critério','Existe um critério, mas informal/na cabeça de quem compra','Critério escrito, mas nem sempre seguido','Critério escrito e seguido'] },
  { id: 'BR2', area: 'Compras', prefix: 'Existe um valor a partir do qual uma compra', choices: ['Toda compra passa pelo dono','Tem uma noção de limite, mas não está definida','Limite definido, mas não é sempre respeitado','Limite definido, escrito e respeitado'] },
  { id: 'BD1', area: 'Compras', prefix: 'Existe um cadastro único de fornecedores', choices: ['Não existe cadastro, é tudo informal','Existe, mas espalhado em vários lugares','Existe um cadastro central, mas desatualizado','Cadastro único, atualizado, com responsável'] },
  { id: 'BM1', area: 'Compras', prefix: 'Quando vocês trocam de fornecedor', choices: ['Não','Só de cabeça, ninguém escreve','Registra, mas ninguém consulta depois','Registra e consulta quando decide de novo'] },
  { id: 'CR1', area: 'Cobrança', prefix: 'Quando um cliente com título vencido faz um pedido novo', choices: ['Libera de qualquer jeito, ou pergunta ao dono toda vez','Quem atende decide na hora, sem regra','Existe regra, mas nem sempre é seguida','Regra clara, todo mundo segue'] },
  { id: 'CR2', area: 'Cobrança', prefix: 'Existe uma sequência definida de quando ligar', choices: ['Caso a caso, sem sequência','Existe uma prática, mas não está escrita','Está escrita, mas nem sempre seguida','Escrita e seguida'] },
  { id: 'CD1', area: 'Cobrança', prefix: 'Onde vocês veem quem está inadimplente hoje', choices: ['Precisa perguntar/procurar em vários lugares','Existe uma planilha, mas não é sempre atualizada','Existe no sistema, mas nem todo mundo consulta lá','Fonte única, atualizada, todo mundo consulta ali'] },
  { id: 'CM1', area: 'Cobrança', prefix: 'Quando decidem cortar ou manter um cliente que atrasa', choices: ['Não','Só de memória','Registra, mas não revisita','Registra e consulta depois'] },
  { id: 'DR1', area: 'Decisões e conhecimento', prefix: 'Se uma pessoa-chave faltasse duas semanas', choices: ['Ninguém sabe, para tudo','Alguém tentaria, mas nunca fez','Tem backup, mas não treinado formalmente','Backup definido e treinado'] },
  { id: 'DR2', area: 'Decisões e conhecimento', prefix: 'As pessoas sabem exatamente até onde podem decidir', choices: ['Não, sempre perguntam','Mais ou menos, por experiência','Sabem, mas não está escrito em lugar nenhum','Está escrito e todos conhecem'] },
  { id: 'DD1', area: 'Decisões e conhecimento', prefix: 'Existe um organograma ou documento que mostra quem faz o quê', choices: ['Só na cabeça do dono','Existe uma ideia informal, não documentada','Existe documento, mas desatualizado','Documento existe e está atualizado'] },
  { id: 'DM1', area: 'Decisões e conhecimento', prefix: 'Você lembra de decidir a mesma coisa mais de uma vez', choices: ['Acontece toda hora','Acontece de vez em quando','É raro, mas já aconteceu','Nunca acontece'] }
];

const norm = value => String(value ?? '').trim().toLocaleLowerCase('pt-BR');
const output = [];
for (const companyRef of companyRefs) {
  const separator = companyRef.indexOf('::');
  if (separator <= 0) continue;
  const companyId = companyRef.slice(0, separator).trim();
  const company = companyRef.slice(separator + 2).trim();
  const matchingRows = allRows.filter(row => norm(row['Empresa']) === norm(companyRef));
  const latestByRole = new Map();
  for (const row of matchingRows) {
    const role = String(row['Sessão / papel de quem está respondendo'] ?? '').trim();
    if (requiredRoles.includes(role)) latestByRole.set(role, row);
  }

  const sessions = [];
  const areaScores = {};
  for (const [role, row] of latestByRole) {
    const answers = [];
    for (const question of questions) {
      const header = Object.keys(row).find(key => key.startsWith(question.prefix));
      const answer = header ? String(row[header] ?? '').trim() : '';
      const score = question.choices.indexOf(answer) + 1;
      if (score > 0) {
        answers.push({ id: question.id, area: question.area, score, answer });
        areaScores[question.area] ??= [];
        areaScores[question.area].push(score);
      }
    }
    sessions.push({ role, answers });
  }

  const rolesReceived = sessions.map(session => session.role);
  const incompleteRoles = sessions.filter(session => session.answers.length < questions.length).map(session => session.role);
  const missingRoles = requiredRoles.filter(role => !rolesReceived.includes(role));
  const pendingRoles = [...new Set([...missingRoles, ...incompleteRoles])];
  const allScores = sessions.flatMap(session => session.answers.map(answer => answer.score));
  const prumoIndex = allScores.length ? Math.round((allScores.reduce((a, b) => a + b, 0) / (4 * allScores.length)) * 1000) / 10 : null;
  const areas = Object.fromEntries(Object.entries(areaScores).map(([area, scores]) => [area, Math.round((scores.reduce((a, b) => a + b, 0) / (4 * scores.length)) * 1000) / 10]));
  const gaps = sessions.flatMap(session => session.answers.filter(answer => answer.score <= 2).map(answer => ({ ...answer, role: session.role })));
  const lastResponseAt = String(matchingRows.at(-1)?.['Carimbo de data/hora'] ?? '');
  const ready = pendingRoles.length === 0 && allScores.length === questions.length * requiredRoles.length;

  output.push({ json: {
    company_id: companyId,
    company,
    rolesReceived,
    missingRoles,
    incompleteRoles,
    pendingRoles,
    sessionCount: sessions.length,
    answerCount: allScores.length,
    prumoIndex,
    areas,
    gaps,
    sessions,
    lastResponseAt,
    status: ready ? 'READY' : 'WAITING_FOR_SESSIONS'
  } });
}
return output;`

node(diagnostic, 'Briefing do relatório — revisão humana').parameters.jsCode = `const input = $json;
const orderedAreas = Object.entries(input.areas).sort((a, b) => a[1] - b[1]);
const priorityAreas = orderedAreas.slice(0, 3);
const topGaps = input.gaps.slice(0, 6);
const band = input.prumoIndex < 45 ? 'dependência e informalidade altas' : input.prumoIndex < 70 ? 'processos parcialmente definidos, com aderência inconsistente' : 'base operacional padronizada, com oportunidades pontuais';
const priorities = priorityAreas.map(([area, score], index) => \`${'${index + 1}'}. ${'${area}'} (${'${score}'}/100): validar regra, responsável e fonte de dados antes de automatizar.\`).join('\\n');
const evidence = topGaps.map(gap => \`- [${'${gap.id}'}] ${'${gap.role}'}: ${'${gap.answer}'}\`).join('\\n') || '- Nenhuma resposta com pontuação 1 ou 2.';
const briefing = [
  \`Empresa: ${'${input.company}'}\`,
  \`Índice PRUMO: ${'${input.prumoIndex}'}/100 — ${'${band}'}.\`,
  \`Perspectivas concluídas: ${'${input.rolesReceived.join(", ")}'}\`,
  '',
  'Prioridades para revisão humana:',
  priorities,
  '',
  'Evidências de menor maturidade:',
  evidence,
  '',
  'Próximo passo: revisar o diagnóstico em workshop, confirmar regra, dono e dado-fonte e só então propor implementação.',
].join('\\n');
const now = new Date().toISOString();

return [{ json: {
  'ID da empresa': input.company_id,
  'Etapa': 'Diagnóstico para revisar',
  'Situação do diagnóstico': 'Revisão necessária',
  'Última resposta em': input.lastResponseAt,
  'Quem respondeu': input.rolesReceived.join(' | '),
  'Quem falta responder': '',
  'Sessões recebidas': input.sessionCount,
  'Respostas válidas': input.answerCount,
  'Índice PRUMO': input.prumoIndex,
  'Resultado por área': JSON.stringify(input.areas),
  'Lacunas observadas': JSON.stringify(input.gaps),
  'Briefing interno': briefing,
  'Próxima ação': 'Revise o briefing e conduza o workshop de priorização.',
  'Diagnóstico concluído em': now,
  'Atualizado em': now,
} }];`

node(diagnostic, 'Aguardar sessões faltantes').parameters.jsCode = `const now = new Date().toISOString();
return [{ json: {
  'ID da empresa': $json.company_id,
  'Etapa': 'Diagnóstico em andamento',
  'Situação do diagnóstico': 'Aguardando respostas',
  'Última resposta em': $json.lastResponseAt,
  'Quem respondeu': $json.rolesReceived.join(' | '),
  'Quem falta responder': $json.pendingRoles.join(' | '),
  'Sessões recebidas': $json.sessionCount,
  'Respostas válidas': $json.answerCount,
  'Índice PRUMO': $json.prumoIndex,
  'Resultado por área': JSON.stringify($json.areas),
  'Lacunas observadas': JSON.stringify($json.gaps),
  'Briefing interno': '',
  'Próxima ação': \`Aguarde as respostas de: ${'${$json.pendingRoles.join(", ")}'}\`,
  'Atualizado em': now,
} }];`

diagnostic.nodes.push(
  sheetsNode({ id: '7', name: 'Devolver briefing ao lead', position: [700, 0] }),
  sheetsNode({ id: '8', name: 'Atualizar pendência no lead', position: [700, 220] }),
  {
    parameters: {},
    id: '9',
    name: 'Reprocessar diagnóstico manualmente',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [-520, -140],
  },
)
diagnostic.connections['Briefing do relatório — revisão humana'] = { main: [[{ node: 'Devolver briefing ao lead', type: 'main', index: 0 }]] }
diagnostic.connections['Aguardar sessões faltantes'] = { main: [[{ node: 'Atualizar pendência no lead', type: 'main', index: 0 }]] }
diagnostic.connections['Reprocessar diagnóstico manualmente'] = { main: [[{ node: 'Ler todas as sessões da empresa', type: 'main', index: 0 }]] }
diagnostic.connections['Verificar respostas do Form — 5 min'] = diagnostic.connections['Nova resposta do Form'] ?? diagnostic.connections['Verificar respostas do Form — 5 min']
delete diagnostic.connections['Nova resposta do Form']
diagnostic.settings = { ...(diagnostic.settings ?? {}), timezone: 'America/Sao_Paulo' }

const output = resolve(outputDirectory)
await mkdir(output, { recursive: true })
await Promise.all([
  writeFile(resolve(output, 'prumo-lead-scout.json'), `${JSON.stringify(sanitize(lead), null, 2)}\n`),
  writeFile(resolve(output, 'prumo-diagnostico.json'), `${JSON.stringify(sanitize(diagnostic), null, 2)}\n`),
])

console.log(`Workflows PRUMO preparados em ${output}`)
