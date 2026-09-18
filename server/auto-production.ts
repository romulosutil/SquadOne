import crypto from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const RESERVED_DIRECTORIES = new Set([".agents", ".claude", ".codex", ".headroom", ".impeccable", ".logs", ".playwright-mcp", ".tokensave", "graphify-out", "_descartados"]);
const STALLED_AFTER_MS = 24 * 60 * 60 * 1000;

export type AutoStage = "preparation" | "generated" | "ready" | "sent" | "confirmed";
export type AutoEventType = "ready" | "sent" | "confirmed";

export interface AutoOperationalEvent {
  type: AutoEventType;
  at: string;
  recordedAt: string;
  origin: "Hermes via WhatsApp" | "registro manual";
  manual: true;
  channel?: string;
  recipient?: string;
}

interface AutoRecord {
  ready?: AutoOperationalEvent;
  sent?: AutoOperationalEvent;
  confirmed?: AutoOperationalEvent;
}

interface AutoRecordsFile {
  version: 1;
  clients: Record<string, AutoRecord>;
}

export interface AutoArtifacts {
  content: boolean;
  photos: number;
  cover: boolean;
  generated: boolean;
  publishedRecord: boolean;
  failure: boolean;
}

export interface AutoFileHistoryItem {
  name: string;
  changedAt: string;
  origin: "leitura local";
}

export interface AutoClient {
  id: string;
  name: string;
  stage: AutoStage;
  stageLabel: string;
  artifacts: AutoArtifacts;
  lastModified: string;
  thumbnailUrl?: string;
  alerts: string[];
  failureMessage?: string;
  fileHistory: AutoFileHistoryItem[];
  operationalHistory: AutoOperationalEvent[];
  hermesNotified: boolean;
  readyAt?: string;
  sentAt?: string;
  confirmedAt?: string;
}

export type AutoConnectionState = "connected" | "running" | "idle" | "attention" | "unknown" | "unavailable";

export interface AutoConnectionEvidence {
  state: AutoConnectionState;
  detail: string;
  evidence: string;
  updatedAt?: string;
}

export interface AutoAutomationStatus {
  folder: AutoConnectionEvidence;
  runner: AutoConnectionEvidence;
  hermes: AutoConnectionEvidence;
  whatsapp: AutoConnectionEvidence;
  notifier: AutoConnectionEvidence & { notifiedCount: number };
  syncthing?: AutoConnectionEvidence;
}

export interface AutoOverviewQuery {
  query?: string;
  stage?: AutoStage | "attention" | "all";
  sort?: "priority" | "recent" | "name";
  page?: number;
  pageSize?: number;
}

export interface AutoProductionOverview {
  checkedAt: string;
  source: "leitura local";
  summary: {
    active: number;
    preparing: number;
    ready: number;
    awaitingSend: number;
    awaitingConfirmation: number;
    confirmed: number;
    attention: number;
    discarded: number;
  };
  funnel: {
    materialReceived: number;
    contentAndImages: number;
    generated: number;
    ready: number;
    sent: number;
    confirmed: number;
  };
  automation: AutoAutomationStatus;
  page: {
    number: number;
    size: number;
    total: number;
    pages: number;
  };
  actionClients: AutoClient[];
  attentionClients: AutoClient[];
  clients: AutoClient[];
}

export class InvalidAutoProductionInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAutoProductionInput";
  }
}

function isSafeClientId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,179}$/i.test(value) && !RESERVED_DIRECTORIES.has(value);
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toLocaleUpperCase("pt-BR")}${word.slice(1)}`)
    .join(" ");
}

function cleanDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const result = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  return result || fallback;
}

function cleanText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw new InvalidAutoProductionInput(`${field} é obrigatório.`);
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!text) throw new InvalidAutoProductionInput(`${field} é obrigatório.`);
  if (text.length > maximum) throw new InvalidAutoProductionInput(`${field} deve ter no máximo ${maximum} caracteres.`);
  return text;
}

function cleanOptionalText(value: unknown, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new InvalidAutoProductionInput("O destinatário deve ser texto.");
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (text.length > maximum) throw new InvalidAutoProductionInput(`O destinatário deve ter no máximo ${maximum} caracteres.`);
  return text || undefined;
}

function cleanDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new InvalidAutoProductionInput("Informe uma data e hora válidas.");
  }
  return new Date(value).toISOString();
}

async function entriesOrEmpty(directory: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

async function statOrNull(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readFirstLine(filePath: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 240);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    return "O arquivo falha.log existe, mas não pôde ser lido.";
  }
}

async function nameFromPublishedRecord(filePath: string, fallback: string): Promise<string> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
    return cleanDisplayName(parsed.nome, fallback);
  } catch {
    return fallback;
  }
}

const stageLabels: Record<AutoStage, string> = {
  preparation: "Em preparação",
  generated: "Site gerado",
  ready: "Pronto no worker · aguardando envio",
  sent: "Enviado · aguardando confirmação",
  confirmed: "Confirmado pelo cliente",
};

function currentStage(artifacts: AutoArtifacts, record: AutoRecord, hermesNotified: boolean): AutoStage {
  if (record.confirmed) return "confirmed";
  if (record.sent) return "sent";
  if (record.ready || hermesNotified) return "ready";
  return artifacts.generated ? "generated" : "preparation";
}

function buildAlerts(artifacts: AutoArtifacts, record: AutoRecord, failureMessage?: string): string[] {
  const alerts: string[] = [];
  if (failureMessage) alerts.push(`falha.log: ${failureMessage}`);
  if (!artifacts.content) alerts.push("content.md não encontrado.");
  if (!artifacts.photos) alerts.push("Nenhuma foto encontrada em Fotos/.");
  if (!artifacts.cover) alerts.push("Nenhuma capa ou logotipo encontrado em Logotipo/.");
  if (!artifacts.generated) alerts.push("index.html não encontrado.");
  if (record.ready && !record.sent && Date.now() - Date.parse(record.ready.at) >= STALLED_AFTER_MS) {
    alerts.push("Aviso do Hermes registrado há mais de 24 horas; o envio ao cliente segue pendente.");
  }
  return alerts;
}

async function discardedCount(rootDirectory: string): Promise<number> {
  const entries = await entriesOrEmpty(path.join(rootDirectory, "_descartados"));
  return entries.filter((entry) => !entry.name.startsWith(".")).length;
}

async function readJsonOrNull(filePath: string): Promise<{ value: unknown; changedAt: string } | null> {
  try {
    const [text, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
    return { value: JSON.parse(text), changedAt: stat.mtime.toISOString() };
  } catch (error: any) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function notifiedIds(value: unknown): Set<string> {
  if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === "string"));
  if (!value || typeof value !== "object") return new Set();
  const record = value as Record<string, unknown>;
  for (const key of ["slugs", "notificados", "notified", "leads"]) {
    if (Array.isArray(record[key])) return new Set((record[key] as unknown[]).filter((item): item is string => typeof item === "string"));
  }
  return new Set(Object.entries(record).filter(([, state]) => Boolean(state)).map(([id]) => id));
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value!)));
}

export class AutoProductionStore {
  private queue: Promise<unknown> = Promise.resolve();
  readonly recordsPath: string;
  readonly notificationStateFile?: string;
  readonly hermesHealthUrl?: string;

  constructor(
    readonly rootDirectory: string,
    dataDirectory: string,
    options: { notificationStateFile?: string; hermesHealthUrl?: string } = {},
  ) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.recordsPath = path.join(dataDirectory, "auto-production.json");
    this.notificationStateFile = options.notificationStateFile ? path.resolve(options.notificationStateFile) : undefined;
    this.hermesHealthUrl = options.hermesHealthUrl;
  }

  private async notificationEvidence(): Promise<{ ids: Set<string>; changedAt?: string }> {
    if (!this.notificationStateFile) return { ids: new Set() };
    const state = await readJsonOrNull(this.notificationStateFile);
    return state ? { ids: notifiedIds(state.value), changedAt: state.changedAt } : { ids: new Set() };
  }

  private async readRecords(): Promise<AutoRecordsFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.recordsPath, "utf8")) as Partial<AutoRecordsFile>;
      if (parsed.version !== 1 || !parsed.clients || typeof parsed.clients !== "object") {
        throw new Error("auto-production.json possui formato inválido.");
      }
      return { version: 1, clients: parsed.clients };
    } catch (error: any) {
      if (error?.code === "ENOENT") return { version: 1, clients: {} };
      throw error;
    }
  }

  private async persist(records: AutoRecordsFile): Promise<void> {
    await fs.mkdir(path.dirname(this.recordsPath), { recursive: true, mode: 0o700 });
    const temporary = `${this.recordsPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, this.recordsPath);
  }

  private write<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async activeDirectoryIds(): Promise<string[]> {
    const entries = await fs.readdir(this.rootDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && isSafeClientId(entry.name) && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  }

  private async readClient(id: string, record: AutoRecord, hermesNotified = false): Promise<AutoClient> {
    const directory = path.join(this.rootDirectory, id);
    const rootEntries = await entriesOrEmpty(directory);
    const byLowerName = new Map(rootEntries.map((entry) => [entry.name.toLocaleLowerCase("pt-BR"), entry]));
    const contentPath = path.join(directory, "content.md");
    const generatedPath = path.join(directory, "index.html");
    const publishedPath = path.join(directory, "publicado.json");
    const failurePath = path.join(directory, "falha.log");
    const logoDirectoryName = byLowerName.get("logotipo")?.name;
    const photosDirectoryName = byLowerName.get("fotos")?.name;
    const logoEntries = logoDirectoryName ? await entriesOrEmpty(path.join(directory, logoDirectoryName)) : [];
    const photoEntries = photosDirectoryName ? await entriesOrEmpty(path.join(directory, photosDirectoryName)) : [];
    const cover = logoEntries.find((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase("pt-BR")));
    const photos = photoEntries.filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase("pt-BR")));

    const [contentStat, generatedStat, publishedStat, failureStat, directoryStat] = await Promise.all([
      statOrNull(contentPath),
      statOrNull(generatedPath),
      statOrNull(publishedPath),
      statOrNull(failurePath),
      fs.stat(directory),
    ]);

    const artifacts: AutoArtifacts = {
      content: Boolean(contentStat?.isFile()),
      photos: photos.length,
      cover: Boolean(cover),
      generated: Boolean(generatedStat?.isFile()),
      publishedRecord: Boolean(publishedStat?.isFile()),
      failure: Boolean(failureStat?.isFile()),
    };
    const fallbackName = humanizeSlug(id);
    const name = publishedStat ? await nameFromPublishedRecord(publishedPath, fallbackName) : fallbackName;
    const failureMessage = failureStat ? await readFirstLine(failurePath) : undefined;
    const fileCandidates: Array<{ name: string; filePath: string; stat: Awaited<ReturnType<typeof fs.stat>> | null }> = [
      { name: "content.md", filePath: contentPath, stat: contentStat },
      { name: "index.html", filePath: generatedPath, stat: generatedStat },
      { name: "publicado.json", filePath: publishedPath, stat: publishedStat },
      { name: "falha.log", filePath: failurePath, stat: failureStat },
    ];
    if (cover && logoDirectoryName) {
      const filePath = path.join(directory, logoDirectoryName, cover.name);
      fileCandidates.push({ name: `${logoDirectoryName}/${cover.name}`, filePath, stat: await statOrNull(filePath) });
    }
    for (const photo of photos.slice(0, 12)) {
      const filePath = path.join(directory, photosDirectoryName!, photo.name);
      fileCandidates.push({ name: `${photosDirectoryName}/${photo.name}`, filePath, stat: await statOrNull(filePath) });
    }
    const fileHistory = fileCandidates
      .filter((item): item is typeof item & { stat: Awaited<ReturnType<typeof fs.stat>> } => Boolean(item.stat?.isFile()))
      .map((item) => ({ name: item.name, changedAt: item.stat.mtime.toISOString(), origin: "leitura local" as const }))
      .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt))
      .slice(0, 12);
    const latestFileTime = fileHistory.length ? Date.parse(fileHistory[0].changedAt) : directoryStat.mtimeMs;
    const stage = currentStage(artifacts, record, hermesNotified);
    const operationalHistory = [record.ready, record.sent, record.confirmed].filter((item): item is AutoOperationalEvent => Boolean(item));

    return {
      id,
      name,
      stage,
      stageLabel: stageLabels[stage],
      artifacts,
      lastModified: new Date(latestFileTime).toISOString(),
      ...(cover ? { thumbnailUrl: `/api/operations/auto/clients/${encodeURIComponent(id)}/thumbnail` } : {}),
      alerts: buildAlerts(artifacts, record, failureMessage),
      ...(failureMessage ? { failureMessage } : {}),
      fileHistory,
      operationalHistory,
      hermesNotified,
      ...(record.ready ? { readyAt: record.ready.at } : {}),
      ...(record.sent ? { sentAt: record.sent.at } : {}),
      ...(record.confirmed ? { confirmedAt: record.confirmed.at } : {}),
    };
  }

  private async automationStatus(notification: { ids: Set<string>; changedAt?: string }): Promise<AutoAutomationStatus> {
    const [folderStat, runnerState, runnerLogStat] = await Promise.all([
      statOrNull(this.rootDirectory),
      readJsonOrNull(path.join(this.rootDirectory, ".logs", "status.json")),
      statOrNull(path.join(this.rootDirectory, ".logs", "execucao-fila.log")),
    ]);
    const runner = (() => {
      if (runnerState?.value && typeof runnerState.value === "object") {
        const value = runnerState.value as Record<string, unknown>;
        const rawState = typeof value.estado === "string" ? value.estado.toLocaleLowerCase("pt-BR") : "";
        const lead = typeof value.lead === "string" && value.lead.trim() ? ` · ${value.lead.trim()}` : "";
        if (/execut|process|rodando|ativo/.test(rawState)) {
          return { state: "running" as const, detail: `Runner em execução${lead}`, evidence: ".logs/status.json", updatedAt: runnerState.changedAt };
        }
        if (/ocioso|idle|parado/.test(rawState)) {
          return { state: "idle" as const, detail: "Runner ocioso e disponível", evidence: ".logs/status.json", updatedAt: runnerState.changedAt };
        }
        return { state: "attention" as const, detail: rawState ? `Estado informado: ${rawState}${lead}` : "Status do runner sem estado reconhecido", evidence: ".logs/status.json", updatedAt: runnerState.changedAt };
      }
      if (runnerLogStat) {
        const stale = Date.now() - Number(runnerLogStat.mtimeMs) > 15 * 60 * 1000;
        return {
          state: stale ? "attention" as const : "unknown" as const,
          detail: stale ? "Log existe, mas não há status atual do runner" : "Atividade recente no log; status atual ausente",
          evidence: ".logs/execucao-fila.log",
          updatedAt: runnerLogStat.mtime.toISOString(),
        };
      }
      return { state: "unknown" as const, detail: "Runner ainda não publicou status nem log", evidence: ".logs/" };
    })();

    let hermes: AutoConnectionEvidence = { state: "unknown", detail: "Saúde do Hermes não configurada", evidence: "tools.hermes.healthUrl" };
    let whatsapp: AutoConnectionEvidence = { state: "unknown", detail: "Conexão do WhatsApp não verificada", evidence: "Hermes /api/status" };
    if (this.hermesHealthUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(this.hermesHealthUrl, { signal: controller.signal });
        const body = await response.json().catch(() => ({})) as Record<string, any>;
        const gatewayRunning = body.gateway_running === true || body.gateway_state === "running" || body.components?.gateway === "ok";
        const whatsappState = body.gateway_platforms?.whatsapp?.state ?? body.platforms?.whatsapp?.state;
        hermes = {
          state: response.ok && gatewayRunning ? "connected" : "attention",
          detail: response.ok && gatewayRunning ? "Gateway Hermes respondendo" : `Hermes respondeu sem gateway operacional${response.ok ? "" : ` · HTTP ${response.status}`}`,
          evidence: "Hermes /api/status",
        };
        whatsapp = {
          state: whatsappState === "connected" ? "connected" : "attention",
          detail: whatsappState === "connected" ? "Canal conectado agora" : `Canal informado como ${String(whatsappState ?? "desconhecido")}`,
          evidence: "Hermes /api/status",
        };
      } catch {
        hermes = { state: "unavailable", detail: "Hermes não respondeu no tempo limite", evidence: "Hermes /api/status" };
        whatsapp = { state: "unknown", detail: "Sem Hermes, o canal não pôde ser verificado", evidence: "Hermes /api/status" };
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      folder: folderStat
        ? { state: "connected", detail: "Pasta auto acessível para leitura", evidence: "autoDirectory", updatedAt: folderStat.mtime.toISOString() }
        : { state: "unavailable", detail: "Pasta auto não encontrada", evidence: "autoDirectory" },
      runner,
      hermes,
      whatsapp,
      notifier: this.notificationStateFile
        ? notification.changedAt
          ? { state: "connected", detail: `${notification.ids.size} site${notification.ids.size === 1 ? "" : "s"} registrado${notification.ids.size === 1 ? "" : "s"} como avisado${notification.ids.size === 1 ? "" : "s"}`, evidence: "leads-notificados.json", updatedAt: notification.changedAt, notifiedCount: notification.ids.size }
          : { state: "attention", detail: "Watcher ainda não publicou o estado de avisos", evidence: "leads-notificados.json", notifiedCount: 0 }
        : { state: "unknown", detail: "Estado do watcher não configurado", evidence: "autoNotificationStateFile", notifiedCount: 0 },
    };
  }

  async overview(query: AutoOverviewQuery = {}): Promise<AutoProductionOverview> {
    await this.queue;
    const [records, notification] = await Promise.all([this.readRecords(), this.notificationEvidence()]);
    const ids = await this.activeDirectoryIds();
    const allClients = await Promise.all(ids.map((id) => this.readClient(id, records.clients[id] ?? {}, notification.ids.has(id))));
    const sortPriority = (clients: AutoClient[]) => clients.sort((a, b) => {
      const stageOrder: Record<AutoStage, number> = { ready: 0, sent: 1, preparation: 2, generated: 3, confirmed: 4 };
      return stageOrder[a.stage] - stageOrder[b.stage] || a.name.localeCompare(b.name, "pt-BR");
    });
    sortPriority(allClients);
    const hasReady = (client: AutoClient) => Boolean(client.readyAt || client.hermesNotified);
    const hasSent = (client: AutoClient) => Boolean(client.sentAt);
    const hasConfirmed = (client: AutoClient) => Boolean(client.confirmedAt);
    const search = (query.query ?? "").trim().toLocaleLowerCase("pt-BR");
    const stage = query.stage ?? "all";
    const sort = query.sort ?? "priority";
    const filtered = allClients.filter((client) => {
      if (search && !`${client.name} ${client.id}`.toLocaleLowerCase("pt-BR").includes(search)) return false;
      if (stage === "attention") return client.alerts.length > 0;
      return stage === "all" || client.stage === stage;
    });
    if (sort === "recent") filtered.sort((a, b) => Date.parse(b.lastModified) - Date.parse(a.lastModified));
    else if (sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    else sortPriority(filtered);
    const pageSize = clampInteger(query.pageSize, 15, 5, 50);
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(clampInteger(query.page, 1, 1, Number.MAX_SAFE_INTEGER), pages);
    const clients = filtered.slice((page - 1) * pageSize, page * pageSize);
    const actionClients = allClients.filter((client) => hasReady(client) && !hasSent(client)).slice(0, 8);
    const attentionClients = allClients.filter((client) => client.alerts.length).slice(0, 8);

    return {
      checkedAt: new Date().toISOString(),
      source: "leitura local",
      summary: {
        active: allClients.length,
        preparing: allClients.filter((client) => client.stage === "preparation").length,
        ready: allClients.filter(hasReady).length,
        awaitingSend: allClients.filter((client) => hasReady(client) && !hasSent(client)).length,
        awaitingConfirmation: allClients.filter((client) => hasSent(client) && !hasConfirmed(client)).length,
        confirmed: allClients.filter(hasConfirmed).length,
        attention: allClients.filter((client) => client.alerts.length).length,
        discarded: await discardedCount(this.rootDirectory),
      },
      funnel: {
        materialReceived: allClients.filter((client) => client.artifacts.content || client.artifacts.photos || client.artifacts.cover).length,
        contentAndImages: allClients.filter((client) => client.artifacts.content && client.artifacts.photos && client.artifacts.cover).length,
        generated: allClients.filter((client) => client.artifacts.generated).length,
        ready: allClients.filter(hasReady).length,
        sent: allClients.filter(hasSent).length,
        confirmed: allClients.filter(hasConfirmed).length,
      },
      automation: await this.automationStatus(notification),
      page: { number: page, size: pageSize, total: filtered.length, pages },
      actionClients,
      attentionClients,
      clients,
    };
  }

  async thumbnailPath(id: string): Promise<string | null> {
    if (!isSafeClientId(id)) return null;
    const activeIds = await this.activeDirectoryIds();
    if (!activeIds.includes(id)) return null;
    const directory = path.join(this.rootDirectory, id);
    const rootEntries = await entriesOrEmpty(directory);
    const logoDirectoryName = rootEntries.find((entry) => entry.isDirectory() && entry.name.toLocaleLowerCase("pt-BR") === "logotipo")?.name;
    if (!logoDirectoryName) return null;
    const logoDirectory = path.join(directory, logoDirectoryName);
    const cover = (await entriesOrEmpty(logoDirectory)).find((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase("pt-BR")));
    return cover ? path.join(logoDirectory, cover.name) : null;
  }

  updateEvent(id: string, input: unknown): Promise<AutoProductionOverview> {
    return this.write(async () => {
      if (!isSafeClientId(id) || !(await this.activeDirectoryIds()).includes(id)) {
        throw new InvalidAutoProductionInput("Cliente não encontrado na produção ativa.");
      }
      const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      if (!(["ready", "sent", "confirmed"] as unknown[]).includes(body.type)) {
        throw new InvalidAutoProductionInput("Tipo de evento inválido.");
      }
      const type = body.type as AutoEventType;
      const records = await this.readRecords();
      const record = records.clients[id] ?? {};
      if (record[type]) throw new InvalidAutoProductionInput("Este marco já foi registrado.");
      const at = cleanDate(body.at);
      const recordedAt = new Date().toISOString();

      if (type === "ready") {
        const client = await this.readClient(id, record);
        if (!client.artifacts.generated) throw new InvalidAutoProductionInput("O site precisa ter index.html antes do aviso do Hermes.");
        record.ready = { type, at, recordedAt, origin: "registro manual", manual: true };
      } else if (type === "sent") {
        const notified = (await this.notificationEvidence()).ids.has(id);
        if (!record.ready && !notified) throw new InvalidAutoProductionInput("Aguarde uma evidência do watcher Hermes antes de registrar o envio.");
        const recipient = cleanOptionalText(body.recipient, 120);
        record.sent = {
          type,
          at,
          recordedAt,
          origin: "registro manual",
          manual: true,
          channel: cleanText(body.channel, "Canal de envio", 80),
          ...(recipient ? { recipient } : {}),
        };
      } else {
        if (!record.sent) throw new InvalidAutoProductionInput("Registre primeiro o envio ao cliente.");
        record.confirmed = { type, at, recordedAt, origin: "registro manual", manual: true };
      }
      records.clients[id] = record;
      await this.persist(records);
    }).then(() => this.overview());
  }
}
