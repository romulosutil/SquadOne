#!/usr/bin/env node
/**
 * Read-only PNCP collector for R SUTIL CORREA LTDA.
 * Writes auditable JSON/Markdown reports and keeps a local deduplication state.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API_BASE = process.env.PNCP_API_BASE ?? 'https://pncp.gov.br/pncp-consulta/v1';
const DATA_DIR = process.env.RADAR_DATA_DIR ?? '/data';
const TZ = 'America/Sao_Paulo';
const MAX_PAGES = Number(process.env.PNCP_MAX_PAGES ?? 5);
const REQUEST_TIMEOUT_MS = Number(process.env.PNCP_REQUEST_TIMEOUT_MS ?? 20_000);
const MAX_ATTEMPTS = Number(process.env.PNCP_MAX_ATTEMPTS ?? 2);
const RETRY_DELAY_MS = Number(process.env.PNCP_RETRY_DELAY_MS ?? 1_500);
const MIN_VALUE = 5_000;
const MAX_VALUE = 80_000;

const terms = [
  'design grafico', 'design', 'identidade visual', 'comunicacao visual',
  'ux', 'ui', 'interface', 'audiovisual', 'edicao de video', 'motion',
  'pos producao', 'design de interiores',
];
const exclusions = [
  'obra', 'engenharia', 'construcao', 'reforma', 'impressao', 'grafica',
  'fabricacao', 'instalacao', 'equipamento', 'hardware', 'licenca de software',
  'licencas de software', 'veiculacao de midia', 'midia paga', 'material permanente',
];

function normalize(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function brDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${value.year}${value.month}${value.day}`;
}

function brl(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
    : 'não divulgado';
}

function parseBrasilia(value) {
  if (!value) return null;
  return new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}-03:00`);
}

function publicUrl(item) {
  const cnpj = item?.orgaoEntidade?.cnpj;
  return cnpj && item.anoCompra != null && item.sequencialCompra != null
    ? `https://pncp.gov.br/app/editais/${cnpj}/${item.anoCompra}/${item.sequencialCompra}`
    : null;
}

async function getJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'licitacoes-radar/1.0 (read-only; contact: local)' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return response.json();
      lastError = new Error(`PNCP respondeu HTTP ${response.status} para ${url}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

function queryUrl(date, page) {
  const params = new URLSearchParams({ dataFinal: date, pagina: String(page), tamanhoPagina: '50' });
  return `${API_BASE}/contratacoes/proposta?${params}`;
}

function hasTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(text);
}

function scoreItem(item, now) {
  const object = item.objetoCompra ?? '';
  const text = normalize(object);
  const matches = terms.filter((term) => hasTerm(text, term));
  const blocked = exclusions.filter((term) => hasTerm(text, term));
  const end = parseBrasilia(item.dataEncerramentoProposta);
  const estimated = Number(item.valorTotalEstimado);

  if (!matches.length) return { keep: false, reason: 'fora do escopo de palavras-chave' };
  if (blocked.length) return { keep: false, reason: `objeto bloqueado: ${blocked.join(', ')}` };
  if (end && end <= now) return { keep: false, reason: 'prazo de proposta encerrado' };
  if (Number.isFinite(estimated) && (estimated < MIN_VALUE || estimated > MAX_VALUE)) {
    return { keep: false, reason: `valor estimado fora da faixa: ${brl(estimated)}` };
  }

  const location = item.unidadeOrgao?.ufSigla ?? '';
  const days = end ? Math.max(0, (end - now) / 86_400_000) : 0;
  const adherence = Math.min(30, 18 + (matches.length * 4));
  const effort = location === 'ES' ? 30 : 21;
  const qualification = /pregao eletronico|dispensa eletronic/.test(normalize(item.modalidadeNome)) ? 18 : 13;
  const economics = !Number.isFinite(estimated) ? 5 : estimated <= 30_000 ? 10 : 8;
  const timing = days >= 7 ? 10 : days >= 3 ? 7 : days >= 1 ? 4 : 1;
  const score = adherence + effort + qualification + economics + timing;

  return {
    keep: score >= 70,
    reason: score >= 70 ? 'triagem aprovada' : `score ${score} abaixo do mínimo`,
    score,
    matches,
    estimated: Number.isFinite(estimated) ? estimated : null,
    end: end?.toISOString() ?? null,
    location,
    days_remaining: Number(days.toFixed(1)),
  };
}

async function loadState(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { seen: {} };
    throw error;
  }
}

async function writeAtomically(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

function markdown(report) {
  const lines = [
    '# Radar PNCP — relatório de coleta',
    '',
    `- Executado: ${report.run_at}`,
    `- Estado: ${report.status ?? 'completed'}`,
    `- Fonte consultada: ${report.source.endpoint}`,
    `- Data de referência PNCP: ${report.source.data_final}`,
    `- Registros abertos retornados: ${report.counts.fetched}`,
    `- Objetos triados: ${report.counts.screened}`,
    `- Qualificados (score ≥70): ${report.counts.qualified}`,
    `- Novos ou atualizados: ${report.counts.new_or_updated}`,
    '',
  ];
  if (report.status === 'source_unavailable') {
    lines.push('## Fonte indisponível', '', `A coleta falhou de forma controlada: ${report.error}`, '', 'Uma nova tentativa ocorrerá no próximo acionamento agendado.');
    return `${lines.join('\n')}\n`;
  }
  if (!report.qualified.length) {
    lines.push('## Nenhuma oportunidade qualificada nesta coleta', '', 'O resultado é uma triagem automática de metadados. Leia o edital e anexos antes de decidir sobre habilitação.');
  } else {
    lines.push('## Oportunidades para avaliar edital');
    for (const item of report.qualified) {
      lines.push('', `### ${item.score}/100 — ${item.orgao}`, `- **Objeto:** ${item.objeto}`, `- **Local:** ${item.local}`, `- **Modalidade:** ${item.modalidade}`, `- **Prazo final:** ${item.prazo_final ?? 'não informado'}`, `- **Valor:** ${brl(item.valor_estimado)}`, `- **Aderência detectada:** ${item.termos.join(', ')}`, `- **Link oficial:** ${item.url ?? 'não disponível'}`, '- **Documentos:** requer leitura do edital; não confirmados por esta coleta.');
    }
  }
  lines.push('', '## Limites', '', '- Este relatório não confirma requisitos de habilitação, ME/EPP, atestados, visitas, documentos ou elegibilidade.', '- O coletor não realiza cadastro, contato, proposta, anexo ou lance.');
  return `${lines.join('\n')}\n`;
}

export async function runCollector({ collectionId = null, dataDir = DATA_DIR, now = new Date() } = {}) {
  const date = process.env.PNCP_DATE ?? brDate(now);
  const stateFile = path.join(dataDir, 'state.json');
  const historyDir = path.join(dataDir, 'history');
  await mkdir(historyDir, { recursive: true });

  const firstUrl = queryUrl(date, 1);
  const first = await getJson(firstUrl);
  const totalPages = Math.max(1, Math.min(Number(first.totalPaginas ?? 1), MAX_PAGES));
  const pages = [];
  for (let page = 2; page <= totalPages; page += 1) {
    pages.push(await getJson(queryUrl(date, page)));
  }
  const rows = [first, ...pages].flatMap((page) => page.data ?? []);
  const state = await loadState(stateFile);
  const qualified = [];
  let screened = 0;
  let newlyChanged = 0;

  for (const item of rows) {
    const decision = scoreItem(item, now);
    if (decision.reason !== 'fora do escopo de palavras-chave') screened += 1;
    if (!decision.keep) continue;
    const id = item.numeroControlePNCP ?? `${item.orgaoEntidade?.cnpj}-${item.anoCompra}-${item.sequencialCompra}`;
    const revision = item.dataAtualizacao ?? item.dataInclusao ?? '';
    const isNewOrUpdated = state.seen[id] !== revision;
    if (isNewOrUpdated) newlyChanged += 1;
    state.seen[id] = revision;
    qualified.push({
      id,
      score: decision.score,
      termos: decision.matches,
      orgao: item.orgaoEntidade?.razaoSocial ?? 'Órgão não informado',
      local: [item.unidadeOrgao?.municipioNome, item.unidadeOrgao?.ufSigla].filter(Boolean).join('/') || 'não informado',
      objeto: item.objetoCompra ?? '',
      modalidade: item.modalidadeNome ?? 'não informado',
      prazo_final: item.dataEncerramentoProposta ?? null,
      valor_estimado: decision.estimated,
      url: publicUrl(item),
      fonte_api: firstUrl,
      novo_ou_atualizado: isNewOrUpdated,
    });
  }

  const seenEntries = Object.entries(state.seen).slice(-10_000);
  state.seen = Object.fromEntries(seenEntries);
  const report = {
    schema_version: 1,
    collection_id: collectionId,
    status: 'completed',
    run_at: now.toISOString(),
    source: { endpoint: firstUrl, data_final: date, pages_read: totalPages },
    counts: { fetched: rows.length, screened, qualified: qualified.length, new_or_updated: newlyChanged },
    qualified,
  };
  await writeAtomically(stateFile, state);
  await writeAtomically(path.join(dataDir, 'latest-run.json'), report);
  await writeAtomically(path.join(dataDir, 'latest-report.md'), markdown(report));
  await writeAtomically(path.join(historyDir, `${now.toISOString().replace(/[:.]/g, '-')}.json`), report);
  return report;
}

export async function writeCollectorFailure(error, {
  collectionId = null,
  dataDir = DATA_DIR,
  now = new Date(),
} = {}) {
  const historyDir = path.join(dataDir, 'history');
  await mkdir(historyDir, { recursive: true });
  const report = {
    schema_version: 1,
    collection_id: collectionId,
    status: 'source_unavailable',
    run_at: now.toISOString(),
    source: { endpoint: API_BASE, data_final: process.env.PNCP_DATE ?? brDate(now), pages_read: 0 },
    error: error instanceof Error ? error.message : String(error),
    counts: { fetched: 0, screened: 0, qualified: 0, new_or_updated: 0 },
    qualified: [],
  };
  await writeAtomically(path.join(dataDir, 'latest-run.json'), report);
  await writeAtomically(path.join(dataDir, 'latest-report.md'), markdown(report));
  await writeAtomically(path.join(historyDir, `${now.toISOString().replace(/[:.]/g, '-')}.json`), report);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCollector()
    .then((report) => process.stdout.write(`${JSON.stringify(report)}\n`))
    .catch((error) => {
      console.error(JSON.stringify({ error: error.message, at: new Date().toISOString() }));
      process.exitCode = 1;
    });
}
