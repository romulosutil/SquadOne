import crypto from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import express from "express";

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
}

export interface OperationsConfig {
  displayName: string;
  tools: Record<OperationToolId, OperationToolConfig>;
}

export interface OperationsProject {
  id: string;
  name: string;
  target: string;
  kind: "url" | "linux_path";
  createdAt: string;
  updatedAt: string;
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
  const mode = (env.SQUADONE_MODE ?? "app").trim();
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
    };
  }
  return {
    displayName: typeof raw.displayName === "string" ? raw.displayName.trim().slice(0, 80) : "",
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

export function validateProjectInput(input: unknown): Pick<OperationsProject, "name" | "target" | "kind"> {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return { name: cleanName(body.name), ...classifyProjectTarget(body.target) };
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

export function mapOperationalState(ok: boolean, body: unknown, kind: OperationToolConfig["healthKind"]): OperationsState {
  if (!ok) return "unavailable";
  if (kind === "syncthing" && body && typeof body === "object") {
    const status = String((body as Record<string, unknown>).status ?? "").toLowerCase();
    if (["syncing", "scanning", "cleaning"].includes(status)) return "syncing";
  }
  return "healthy";
}

async function readHealth(tool: OperationToolConfig): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = new URL(tool.healthUrl);
  // Syncthing usa certificado local autoassinado no Dell. A exceção é restrita
  // ao health check fixo em loopback; nenhuma URL do navegador chega aqui.
  if (tool.healthKind === "syncthing" && url.protocol === "https:" && isLoopbackUrl(url)) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { rejectUnauthorized: false, timeout: 1800 }, (response) => {
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
  readAgenda: () => Promise<AgendaSummary>;
}): express.Router {
  const router = express.Router();

  router.get("/overview", async (_req, res) => {
    const [tools, agenda] = await Promise.all([
      Promise.all(OPERATION_TOOL_IDS.map((id) => checkTool(id, options.config.tools[id]))),
      options.readAgenda().catch((error: unknown) => ({
        state: "unavailable" as const,
        events: [] as [],
        message: error instanceof Error ? error.message : String(error),
      })),
    ]);
    res.json({
      displayName: options.config.displayName,
      checkedAt: new Date().toISOString(),
      tools,
      agenda,
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
