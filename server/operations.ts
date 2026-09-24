import crypto from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import express from "express";
import { AutoProductionStore, InvalidAutoProductionInput, type AutoOverviewQuery, type AutoStage } from "./auto-production.ts";
import { lerStatusDoDell } from "./dell-status.ts";

export type SquadOneMode = "app" | "operations";
export type OperationsState = "healthy" | "syncing" | "unavailable" | "unknown";

export const OPERATION_TOOL_IDS = ["hermes", "ide", "syncthing", "n8n", "remote"] as const;
export type OperationToolId = (typeof OPERATION_TOOL_IDS)[number];

export interface OperationToolConfig {
  label: string;
  description: string;
  launchUrl: string;
  healthUrl: string;
  healthKind?: "http" | "syncthing";
  healthApiKeyFile?: string;
}

export interface OperationsConfig {
  displayName: string;
  autoDirectory?: string;
  autoNotificationStateFile?: string;
  tools: Record<OperationToolId, OperationToolConfig>;
}

export interface OperationsProject {
  id: string;
  name: string;
  description: string;
  category: string;
  pinned: boolean;
  target: string;
  kind: "url" | "linux_path";
  createdAt: string;
  updatedAt: string;
}

export type HermesReadingSeverity = "info" | "attention" | "action" | "done";

export interface HermesReading {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  summary: string;
  severity: HermesReadingSeverity;
  occurredAt: string;
  evidence: string;
  source: string;
}

export interface AgendaEventSummary {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink?: string;
  location?: string;
}

export type AgendaSummary =
  | { state: "connected"; events: AgendaEventSummary[] }
  | { state: "disconnected"; events: [] }
  | { state: "unavailable"; events: []; message: string };

export class InvalidOperationInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationInput";
  }
}

export function readSquadOneMode(env: NodeJS.ProcessEnv = process.env): SquadOneMode {
  // Ausente ou vazia = app, como as outras envs; só um valor presente e
  // desconhecido derruba o boot.
  const mode = (env.SQUADONE_MODE ?? "").trim() || "app";
  if (mode === "app" || mode === "operations") return mode;
  throw new Error("SQUADONE_MODE deve ser 'app' ou 'operations'.");
}

export function listenHostForMode(mode: SquadOneMode): "0.0.0.0" | "127.0.0.1" {
  return mode === "operations" ? "127.0.0.1" : "0.0.0.0";
}

function isLoopbackUrl(value: URL): boolean {
  return ["127.0.0.1", "localhost", "[::1]"].includes(value.hostname);
}

function readHttpUrl(value: unknown, field: string, loopbackOnly: boolean): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} é obrigatório.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} deve ser uma URL válida.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${field} aceita somente http ou https.`);
  }
  if (loopbackOnly && !isLoopbackUrl(url)) {
    throw new Error(`${field} deve apontar para loopback.`);
  }
  return url.href;
}

export async function readOperationsConfig(filePath: string): Promise<OperationsConfig> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<OperationsConfig>;
  if (!raw.tools || typeof raw.tools !== "object") {
    throw new Error("Configuração de operações sem bloco 'tools'.");
  }
  const tools = {} as Record<OperationToolId, OperationToolConfig>;
  for (const id of OPERATION_TOOL_IDS) {
    const input = raw.tools[id] as Partial<OperationToolConfig> | undefined;
    if (!input || typeof input.label !== "string" || typeof input.description !== "string") {
      throw new Error(`Configuração da ferramenta '${id}' está incompleta.`);
    }
    const local = id !== "remote";
    tools[id] = {
      label: input.label.trim(),
      description: input.description.trim(),
      launchUrl: readHttpUrl(input.launchUrl, `tools.${id}.launchUrl`, local),
      healthUrl: readHttpUrl(input.healthUrl, `tools.${id}.healthUrl`, local),
      healthKind: input.healthKind === "syncthing" ? "syncthing" : "http",
      ...(input.healthApiKeyFile
        ? { healthApiKeyFile: path.resolve(String(input.healthApiKeyFile)) }
        : {}),
    };
  }
  return {
    displayName: typeof raw.displayName === "string" ? raw.displayName.trim().slice(0, 80) : "",
    ...(typeof raw.autoDirectory === "string" && raw.autoDirectory.trim()
      ? { autoDirectory: path.resolve(raw.autoDirectory.trim()) }
      : {}),
    ...(typeof raw.autoNotificationStateFile === "string" && raw.autoNotificationStateFile.trim()
      ? { autoNotificationStateFile: path.resolve(raw.autoNotificationStateFile.trim()) }
      : {}),
    tools,
  };
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new InvalidOperationInput("Informe o nome do projeto.");
  const name = value.trim();
  if (!name) throw new InvalidOperationInput("Informe o nome do projeto.");
  if (name.length > 80) throw new InvalidOperationInput("O nome deve ter no máximo 80 caracteres.");
  if(/[\u0000-\u001f\u007f]/.test(name)) throw new InvalidOperationInput("O nome contém caracteres inválidos.");
  return name;
}

export function classifyProjectTarget(value: unknown): { target: string; kind: OperationsProject["kind"] } {
  if (typeof value !== "string") {
    throw new InvalidOperationInput("Informe um caminho Linux absoluto ou uma URL http/https.");
  }
  const target = value.trim();
  if (!target || target.length > 1000 || /[\u0000-\u001f\u007f]/.test(target)) {
    throw new InvalidOperationInput("Informe um caminho Linux absoluto ou uma URL http/https válida.");
  }
  if (target.startsWith("/")) return { target, kind: "linux_path" };
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new InvalidOperationInput("Use um caminho Linux absoluto, começando com /, ou uma URL http/https.");
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new InvalidOperationInput("Links devem usar http ou https; esquemas como javascript: não são permitidos.");
  }
  return { target: url.href, kind: "url" };
}

function cleanOptionalText(value: unknown, maxLength: number): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new InvalidOperationInput("Os detalhes do projeto são inválidos.");
  const text = value.trim();
  if (text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new InvalidOperationInput("Os detalhes do projeto são inválidos.");
  }
  return text;
}

export function validateProjectInput(input: unknown): Pick<OperationsProject, "name" | "description" | "category" | "pinned" | "target" | "kind"> {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    name: cleanName(body.name),
    description: cleanOptionalText(body.description, 240),
    category: cleanOptionalText(body.category, 60),
    pinned: body.pinned === true,
    ...classifyProjectTarget(body.target),
  };
}

export class OperationsProjectStore {
  private queue: Promise<unknown> = Promise.resolve();
  readonly filePath: string;

  constructor(dataDirectory: string) {
    this.filePath = path.join(dataDirectory, "projects.json");
  }

  private async readUnsafe(): Promise<OperationsProject[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("projects.json deve conter uma lista.");
      return parsed.map((item) => {
        const validated = validateProjectInput(item);
        if (typeof item.id !== "string" || !item.id) throw new Error("Projeto sem id.");
        return {
          id: item.id,
          ...validated,
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString(),
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
        };
      });
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async list(): Promise<OperationsProject[]> {
    await this.queue;
    return this.readUnsafe();
  }

  private write<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async persist(projects: OperationsProject[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(projects, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, this.filePath);
  }

  create(input: unknown): Promise<OperationsProject> {
    return this.write(async () => {
      const projects = await this.readUnsafe();
      const now = new Date().toISOString();
      const project: OperationsProject = {
        id: crypto.randomUUID(),
        ...validateProjectInput(input),
        createdAt: now,
        updatedAt: now,
      };
      projects.push(project);
      await this.persist(projects);
      return project;
    });
  }

  update(id: string, input: unknown): Promise<OperationsProject> {
    return this.write(async () => {
      const projects = await this.readUnsafe();
      const index = projects.findIndex((project) => project.id === id);
      if (index < 0) throw new InvalidOperationInput("Projeto não encontrado.");
      const project = { ...projects[index], ...validateProjectInput(input), updatedAt: new Date().toISOString() };
      projects[index] = project;
      await this.persist(projects);
      return project;
    });
  }

  remove(id: string): Promise<void> {
    return this.write(async () => {
      const projects = await this.readUnsafe();
      const next = projects.filter((project) => project.id !== id);
      if (next.length === projects.length) throw new InvalidOperationInput("Projeto não encontrado.");
      await this.persist(next);
    });
  }
}

const HERMES_SEVERITIES = new Set<HermesReadingSeverity>(["info", "attention", "action", "done"]);

function readingText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Leitura do Hermes sem ${field}.`);
  const text = value.trim();
  if (text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`Leitura do Hermes com ${field} inválido.`);
  }
  return text;
}

export function validateHermesReading(input: unknown): HermesReading {
  if (!input || typeof input !== "object") throw new Error("Leitura do Hermes inválida.");
  const item = input as Record<string, unknown>;
  const severity = item.severity;
  if (typeof severity !== "string" || !HERMES_SEVERITIES.has(severity as HermesReadingSeverity)) {
    throw new Error("Leitura do Hermes com severidade inválida.");
  }
  const occurredAt = readingText(item.occurredAt, "data", 64);
  if (Number.isNaN(Date.parse(occurredAt))) throw new Error("Leitura do Hermes com data inválida.");
  return {
    id: readingText(item.id, "id", 120),
    projectId: readingText(item.projectId, "projeto", 120),
    projectName: readingText(item.projectName, "nome do projeto", 120),
    title: readingText(item.title, "título", 180),
    summary: readingText(item.summary, "resumo", 1200),
    severity: severity as HermesReadingSeverity,
    occurredAt: new Date(occurredAt).toISOString(),
    evidence: readingText(item.evidence, "evidência", 1000),
    source: readingText(item.source, "origem", 120),
  };
}

export class HermesReadingsStore {
  readonly filePath: string;

  constructor(dataDirectory: string) {
    this.filePath = path.join(dataDirectory, "hermes-readings.json");
  }

  async list(): Promise<HermesReading[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("hermes-readings.json deve conter uma lista.");
      return parsed.map(validateHermesReading).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }
}

export function mapOperationalState(ok: boolean, body: unknown, kind: OperationToolConfig["healthKind"]): OperationsState {
  if (!ok) return "unavailable";
  if (kind === "syncthing" && body && typeof body === "object") {
    const source = body as Record<string, unknown>;
    const status = String(source.state ?? source.status ?? "").toLowerCase();
    if (["syncing", "scanning", "cleaning"].includes(status)) return "syncing";
  }
  return "healthy";
}

async function readHealth(tool: OperationToolConfig): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = new URL(tool.healthUrl);
  // Syncthing usa certificado local autoassinado no Dell. A exceção é restrita
  // ao health check fixo em loopback; nenhuma URL do navegador chega aqui.
  if (tool.healthKind === "syncthing" && url.protocol === "https:" && isLoopbackUrl(url)) {
    let apiKey: string | undefined;
    if (tool.healthApiKeyFile) {
      const config = await fs.readFile(tool.healthApiKeyFile, "utf8");
      apiKey = config.match(/<apikey>([^<]+)<\/apikey>/)?.[1]?.trim();
      if (!apiKey) throw new Error("API key do Syncthing ausente.");
    }
    return new Promise((resolve, reject) => {
      const request = https.get(url, {
        rejectUnauthorized: false,
        timeout: 1800,
        ...(apiKey ? { headers: { "X-API-Key": apiKey } } : {}),
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = null;
          try { body = JSON.parse(text); } catch { /* resposta não JSON */ }
          resolve({ ok: (response.statusCode ?? 500) < 400, status: response.statusCode ?? 500, body });
        });
      });
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", reject);
    });
  }
  const response = await fetch(tool.healthUrl, { signal: AbortSignal.timeout(1800) });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
  return { ok: response.ok, status: response.status, body };
}

async function checkTool(id: OperationToolId, tool: OperationToolConfig): Promise<{
  id: OperationToolId;
  label: string;
  description: string;
  launchUrl: string;
  state: OperationsState;
  detail: string;
}> {
  try {
    const response = await readHealth(tool);
    const state = mapOperationalState(response.ok, response.body, tool.healthKind);
    return {
      id,
      label: tool.label,
      description: tool.description,
      launchUrl: tool.launchUrl,
      state,
      detail: state === "healthy" ? "Respondendo agora" : state === "syncing" ? "Sincronização em andamento" : `HTTP ${response.status}`,
    };
  } catch {
    return {
      id,
      label: tool.label,
      description: tool.description,
      launchUrl: tool.launchUrl,
      state: "unavailable",
      detail: "Sem resposta no tempo limite",
    };
  }
}

export function createOperationsRouter(options: {
  config: OperationsConfig;
  store: OperationsProjectStore;
  readings: HermesReadingsStore;
  autoProduction?: AutoProductionStore;
  readAgenda: () => Promise<AgendaSummary>;
  dataDir: string;
}): express.Router {
  const router = express.Router();

  router.get("/overview", async (_req, res) => {
    const [tools, agenda, dell] = await Promise.all([
      Promise.all(OPERATION_TOOL_IDS.map((id) => checkTool(id, options.config.tools[id]))),
      options.readAgenda().catch((error: unknown) => ({
        state: "unavailable" as const,
        events: [] as [],
        message: error instanceof Error ? error.message : String(error),
      })),
      lerStatusDoDell(options.dataDir),
    ]);
    res.json({
      displayName: options.config.displayName,
      checkedAt: new Date().toISOString(),
      tools,
      agenda,
      dell,
    });
  });

  router.get("/projects", async (_req, res) => {
    try {
      res.json({ projects: await options.store.list() });
    } catch (error: any) {
      console.error("[operations] Falha ao ler projetos:", error);
      res.status(500).json({ error: "Não foi possível ler os projetos locais." });
    }
  });

  router.get("/readings", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() : "";
      const readings = await options.readings.list();
      res.json({ readings: projectId ? readings.filter((reading) => reading.projectId === projectId) : readings });
    } catch (error) {
      console.error("[operations] Falha ao ler as leituras do Hermes:", error);
      res.status(500).json({ error: "Não foi possível ler a caixa do Hermes." });
    }
  });

  router.post("/projects", async (req, res) => {
    try {
      res.status(201).json({ project: await options.store.create(req.body) });
    } catch (error: any) {
      const status = error instanceof InvalidOperationInput ? 400 : 500;
      if (status === 500) console.error("[operations] Falha ao criar projeto:", error);
      res.status(status).json({ error: status === 400 ? error.message : "Não foi possível salvar o projeto." });
    }
  });

  router.put("/projects/:id", async (req, res) => {
    try {
      res.json({ project: await options.store.update(String(req.params.id), req.body) });
    } catch (error: any) {
      const status = error instanceof InvalidOperationInput ? 400 : 500;
      if (status === 500) console.error("[operations] Falha ao atualizar projeto:", error);
      res.status(status).json({ error: status === 400 ? error.message : "Não foi possível salvar o projeto." });
    }
  });

  router.delete("/projects/:id", async (req, res) => {
    try {
      await options.store.remove(String(req.params.id));
      res.status(204).end();
    } catch (error: any) {
      const status = error instanceof InvalidOperationInput ? 404 : 500;
      if (status === 500) console.error("[operations] Falha ao excluir projeto:", error);
      res.status(status).json({ error: status === 404 ? error.message : "Não foi possível excluir o projeto." });
    }
  });

  router.get("/auto", async (req, res) => {
    if (!options.autoProduction) {
      res.status(503).json({ error: "A pasta auto ainda não foi configurada nesta Central." });
      return;
    }
    try {
      const validStages = new Set<AutoStage | "attention" | "all">(["preparation", "generated", "ready", "sent", "confirmed", "attention", "all"]);
      const validSorts = new Set<NonNullable<AutoOverviewQuery["sort"]>>(["priority", "recent", "name"]);
      const rawStage = typeof req.query.stage === "string" ? req.query.stage : "all";
      const rawSort = typeof req.query.sort === "string" ? req.query.sort : "priority";
      const query: AutoOverviewQuery = {
        query: typeof req.query.q === "string" ? req.query.q : "",
        stage: validStages.has(rawStage as AutoStage | "attention" | "all") ? rawStage as AutoOverviewQuery["stage"] : "all",
        sort: validSorts.has(rawSort as NonNullable<AutoOverviewQuery["sort"]>) ? rawSort as AutoOverviewQuery["sort"] : "priority",
        page: Number(req.query.page),
        pageSize: Number(req.query.pageSize),
      };
      const [overview, syncthing] = await Promise.all([
        options.autoProduction.overview(query),
        checkTool("syncthing", options.config.tools.syncthing),
      ]);
      overview.automation.syncthing = {
        state: syncthing.state === "healthy" ? "connected" : syncthing.state === "syncing" ? "running" : syncthing.state === "unavailable" ? "unavailable" : "unknown",
        detail: syncthing.detail,
        evidence: "health check do Syncthing",
      };
      res.json(overview);
    } catch (error) {
      console.error("[operations] Falha ao ler Produção Auto:", error);
      res.status(500).json({ error: "Não foi possível ler a pasta auto agora." });
    }
  });

  router.get("/auto/events", (req, res) => {
    if (!options.autoProduction) {
      res.status(503).end();
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("retry: 5000\n");
    res.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    const interval = setInterval(() => {
      res.write(`event: refresh\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }, 10_000);
    req.on("close", () => clearInterval(interval));
  });

  router.get("/auto/clients/:id/thumbnail", async (req, res) => {
    if (!options.autoProduction) {
      res.status(404).end();
      return;
    }
    try {
      const filePath = await options.autoProduction.thumbnailPath(String(req.params.id));
      if (!filePath) {
        res.status(404).end();
        return;
      }
      res.setHeader("Cache-Control", "private, max-age=60");
      res.sendFile(filePath);
    } catch (error) {
      console.error("[operations] Falha ao ler miniatura da Produção Auto:", error);
      res.status(500).end();
    }
  });

  router.post("/auto/clients/:id/events", async (req, res) => {
    if (!options.autoProduction) {
      res.status(503).json({ error: "A pasta auto ainda não foi configurada nesta Central." });
      return;
    }
    try {
      res.status(201).json(await options.autoProduction.updateEvent(String(req.params.id), req.body));
    } catch (error) {
      const status = error instanceof InvalidAutoProductionInput ? 400 : 500;
      if (status === 500) console.error("[operations] Falha ao registrar evento da Produção Auto:", error);
      res.status(status).json({ error: status === 400 ? error.message : "Não foi possível registrar o evento operacional." });
    }
  });

  return router;
}

function offsetAt(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(+value.year, +value.month - 1, +value.day, +value.hour, +value.minute, +value.second);
  return localAsUtc - date.getTime();
}

function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const requested = Date.UTC(year, month - 1, day);
  let instant = requested - offsetAt(new Date(requested), timeZone);
  instant = requested - offsetAt(new Date(instant), timeZone);
  return new Date(instant);
}

export function todayWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = +value.year;
  const month = +value.month;
  const day = +value.day;
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: localMidnight(year, month, day, timeZone),
    end: localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
  };
}
