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
  readyAt?: string;
  sentAt?: string;
  confirmedAt?: string;
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

function currentStage(artifacts: AutoArtifacts, record: AutoRecord): AutoStage {
  if (record.confirmed) return "confirmed";
  if (record.sent) return "sent";
  if (record.ready) return "ready";
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

export class AutoProductionStore {
  private queue: Promise<unknown> = Promise.resolve();
  readonly recordsPath: string;

  constructor(readonly rootDirectory: string, dataDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.recordsPath = path.join(dataDirectory, "auto-production.json");
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

  private async readClient(id: string, record: AutoRecord): Promise<AutoClient> {
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
    const stage = currentStage(artifacts, record);
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
      ...(record.ready ? { readyAt: record.ready.at } : {}),
      ...(record.sent ? { sentAt: record.sent.at } : {}),
      ...(record.confirmed ? { confirmedAt: record.confirmed.at } : {}),
    };
  }

  async overview(): Promise<AutoProductionOverview> {
    await this.queue;
    const records = await this.readRecords();
    const ids = await this.activeDirectoryIds();
    const clients = await Promise.all(ids.map((id) => this.readClient(id, records.clients[id] ?? {})));
    clients.sort((a, b) => {
      const stageOrder: Record<AutoStage, number> = { ready: 0, sent: 1, preparation: 2, generated: 3, confirmed: 4 };
      return stageOrder[a.stage] - stageOrder[b.stage] || a.name.localeCompare(b.name, "pt-BR");
    });
    const hasReady = (client: AutoClient) => Boolean(client.readyAt);
    const hasSent = (client: AutoClient) => Boolean(client.sentAt);
    const hasConfirmed = (client: AutoClient) => Boolean(client.confirmedAt);

    return {
      checkedAt: new Date().toISOString(),
      source: "leitura local",
      summary: {
        active: clients.length,
        preparing: clients.filter((client) => client.stage === "preparation").length,
        ready: clients.filter(hasReady).length,
        awaitingSend: clients.filter((client) => hasReady(client) && !hasSent(client)).length,
        awaitingConfirmation: clients.filter((client) => hasSent(client) && !hasConfirmed(client)).length,
        confirmed: clients.filter(hasConfirmed).length,
        attention: clients.filter((client) => client.alerts.length).length,
        discarded: await discardedCount(this.rootDirectory),
      },
      funnel: {
        materialReceived: clients.filter((client) => client.artifacts.content || client.artifacts.photos || client.artifacts.cover).length,
        contentAndImages: clients.filter((client) => client.artifacts.content && client.artifacts.photos && client.artifacts.cover).length,
        generated: clients.filter((client) => client.artifacts.generated).length,
        ready: clients.filter(hasReady).length,
        sent: clients.filter(hasSent).length,
        confirmed: clients.filter(hasConfirmed).length,
      },
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
        record.ready = { type, at, recordedAt, origin: "Hermes via WhatsApp", manual: true };
      } else if (type === "sent") {
        if (!record.ready) throw new InvalidAutoProductionInput("Registre primeiro o aviso do Hermes.");
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
