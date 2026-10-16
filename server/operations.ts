import crypto from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import express from "express";
import { CrmStore, RegistroFalhou, RegistroIndisponivel, RegistroInvalido } from "./crm.ts";
import { CopilotoFalhou, LeadForaDoCrm, PassoSemCopiloto, TetoDoCopiloto, type Copiloto } from "./copiloto.ts";
import { lerConversa } from "./conversa-do-lead.ts";
import type { CrmProduto } from "../src/operations/types.ts";

const PRODUTOS_DO_CRM: readonly CrmProduto[] = ["site", "prumo", "iris", "estampa", "plus"];
import { lerStatusDoDell } from "./dell-status.ts";

export type SquadOneMode = "app" | "operations";
export type OperationsState = "healthy" | "syncing" | "unavailable" | "unknown";

// Sem uma destas a Central não sobe: são o que o painel Mais → Acessos abre.
export const OPERATION_REQUIRED_TOOL_IDS = ["hermes", "ide", "n8n", "remote"] as const;
// O Syncthing foi aposentado em 12/10/2026 (nenhum aparelho pareado desde
// 04/10). Fica opcional, e não removido, para a configuração do Dell que ainda
// tem a entrada continuar válida no deploy; sem ela, a ferramenta some do
// /overview e do painel em vez de aparecer como indisponível.
export const OPERATION_OPTIONAL_TOOL_IDS = ["syncthing"] as const;
// Ordem do /overview (a mesma de antes); o painel reordena pelo uso.
export const OPERATION_TOOL_IDS = ["hermes", "ide", "syncthing", "n8n", "remote"] as const;
export type OperationRequiredToolId = (typeof OPERATION_REQUIRED_TOOL_IDS)[number];
export type OperationOptionalToolId = (typeof OPERATION_OPTIONAL_TOOL_IDS)[number];
export type OperationToolId = (typeof OPERATION_TOOL_IDS)[number];

function isOptionalTool(id: OperationToolId): id is OperationOptionalToolId {
  return (OPERATION_OPTIONAL_TOOL_IDS as readonly string[]).includes(id);
}

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
  /** Bloco "crm" de operations.json (caminhos do retrato e do registro); ausente = padrões do Dell. */
  crm?: unknown;
  tools: OperationsTools;
}

export type OperationsTools =
  & Record<OperationRequiredToolId, OperationToolConfig>
  & Partial<Record<OperationOptionalToolId, OperationToolConfig>>;

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
  const tools = {} as OperationsTools;
  for (const id of OPERATION_TOOL_IDS) {
    const input = (raw.tools as Record<string, unknown>)[id] as Partial<OperationToolConfig> | null | undefined;
    // Opcional ausente fica fora; presente, vale a mesma validação das
    // obrigatórias (uma entrada quebrada é erro de digitação, não "desligada").
    if (input == null && isOptionalTool(id)) continue;
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
    ...(raw.crm && typeof raw.crm === "object" ? { crm: raw.crm } : {}),
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
  crm?: CrmStore;
  /** Copiloto do PRUMO (server/copiloto.ts): null/ausente = desligado, e a Ficha esconde o bloco. */
  copiloto?: Copiloto | null;
  readAgenda: () => Promise<AgendaSummary>;
  dataDir: string;
}): express.Router {
  const router = express.Router();

  router.get("/overview", async (_req, res) => {
    const [tools, agenda, dell] = await Promise.all([
      Promise.all(OPERATION_TOOL_IDS.flatMap((id) => {
        const tool = options.config.tools[id];
        return tool ? [checkTool(id, tool)] : [];
      })),
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

  // CRM (Site antes da venda + PRUMO). Leitura do retrato que o n8n grava; a
  // única escrita é o registro (nota, próximo passo, proposta), que vai para a
  // planilha pelo próprio n8n. A Central não guarda etapa de lead.
  router.get("/crm", async (_req, res) => {
    if (!options.crm) {
      res.status(503).json({ error: "O CRM não está configurado nesta Central." });
      return;
    }
    try {
      // no-cache (não no-store): o navegador revalida e o ETag devolve 304 quando nada mudou.
      res.setHeader("Cache-Control", "no-cache");
      res.json(await options.crm.visao());
    } catch (error) {
      console.error("[operations] Falha ao ler o CRM:", error);
      res.status(500).json({ error: "Não foi possível ler o CRM agora." });
    }
  });

  // A conversa do lead no WhatsApp (16/10/2026), como o observador gravou: só leitura, só leads.
  // `id` é a chave da planilha (a mesma do registro), nunca o telefone.
  router.get("/crm/conversa", async (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id.trim() : "";
    if (!/^[A-Za-z0-9_:.-]{1,200}$/.test(id)) {
      res.status(400).json({ error: "id inválido." });
      return;
    }
    try {
      const mensagens = await lerConversa(id);
      res.setHeader("Cache-Control", "no-store");
      res.json(mensagens === null ? { guardada: false, mensagens: [] } : { guardada: true, mensagens });
    } catch (error) {
      console.error("[operations] Falha ao ler a conversa do lead:", error);
      res.status(500).json({ error: "Não foi possível ler a conversa agora." });
    }
  });

  router.post("/crm/registro", async (req, res) => {
    if (!options.crm) {
      res.status(503).json({ error: "O CRM não está configurado nesta Central." });
      return;
    }
    try {
      res.status(201).json(await options.crm.registrar(req.body));
    } catch (error) {
      if (error instanceof RegistroInvalido) {
        res.status(400).json({ error: error.message });
      } else if (error instanceof RegistroIndisponivel) {
        res.status(503).json({ error: error.message, configuracao: true });
      } else if (error instanceof RegistroFalhou) {
        console.warn(`[operations] Registro do CRM recusado pelo n8n (${error.status ?? "sem resposta"}): ${error.message}`);
        res.status(502).json({ error: error.message, n8nFalhou: true });
      } else {
        console.error("[operations] Falha ao registrar no CRM:", error);
        res.status(500).json({ error: "Não foi possível registrar agora." });
      }
    }
  });

  // Copiloto do PRUMO (fase 1, em sombra): sugere, nunca envia. O lead sai da visão do CRM no
  // servidor, nunca do corpo do pedido; o navegador só diz qual (produto + id).
  const leadDoPedido = (fonte: Record<string, unknown>): { produto: CrmProduto; id: string } | null => {
    const produto = typeof fonte.produto === "string" ? fonte.produto : "";
    const id = typeof fonte.id === "string" ? fonte.id.trim() : "";
    return PRODUTOS_DO_CRM.includes(produto as CrmProduto) && /^[A-Za-z0-9_:.-]{1,200}$/.test(id) ? { produto: produto as CrmProduto, id } : null;
  };
  const responderErroDoCopiloto = (res: express.Response, error: unknown) => {
    if (error instanceof LeadForaDoCrm) res.status(404).json({ error: error.message });
    else if (error instanceof PassoSemCopiloto) res.status(409).json({ error: error.message, passo: error.passo });
    else if (error instanceof TetoDoCopiloto) res.status(429).json({ error: error.message, teto: true });
    else if (error instanceof CopilotoFalhou) {
      console.warn(`[copiloto] falhou: ${error.motivo}: ${error.detalhe}`);
      res.status(502).json({ error: error.message, falha: { motivo: error.motivo, detalhe: error.detalhe } });
    } else {
      console.error("[copiloto] erro inesperado:", error);
      res.status(500).json({ error: "O copiloto não respondeu agora." });
    }
  };

  router.get("/crm/copiloto", async (_req, res) => {
    if (!options.copiloto) {
      res.json({ ligado: false });
      return;
    }
    try {
      res.json(await options.copiloto.estado());
    } catch (error) {
      responderErroDoCopiloto(res, error);
    }
  });

  router.get("/crm/copiloto/sugestao", async (req, res) => {
    const alvo = leadDoPedido(req.query as Record<string, unknown>);
    if (!options.copiloto) return void res.status(503).json({ error: "O copiloto está desligado nesta Central." });
    if (!alvo) return void res.status(400).json({ error: "Diga o produto e o id do lead." });
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ sugestao: await options.copiloto.ler(alvo.produto, alvo.id) });
    } catch (error) {
      responderErroDoCopiloto(res, error);
    }
  });

  router.post("/crm/copiloto/sugestao", async (req, res) => {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const alvo = leadDoPedido(corpo);
    if (!options.copiloto) return void res.status(503).json({ error: "O copiloto está desligado nesta Central." });
    if (!alvo) return void res.status(400).json({ error: "Diga o produto e o id do lead." });
    try {
      res.json(await options.copiloto.sugerir(alvo.produto, alvo.id, corpo.forcar === true));
    } catch (error) {
      responderErroDoCopiloto(res, error);
    }
  });

  router.post("/crm/copiloto/copiou", async (req, res) => {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const alvo = leadDoPedido(corpo);
    const hash = typeof corpo.hash === "string" && /^[a-f0-9]{8,64}$/.test(corpo.hash) ? corpo.hash : "";
    const oQue = corpo.oQue === "mensagem" || corpo.oQue === "proposta" ? corpo.oQue : null;
    if (!options.copiloto) return void res.status(503).json({ error: "O copiloto está desligado nesta Central." });
    if (!alvo || !hash || !oQue) return void res.status(400).json({ error: "Pedido de cópia incompleto." });
    try {
      await options.copiloto.copiou(alvo.produto, alvo.id, hash, oQue);
      res.status(204).end();
    } catch (error) {
      responderErroDoCopiloto(res, error);
    }
  });

  // Rota operacional inexistente (ex.: a antiga /auto) responde 404 JSON em vez
  // de cair no fallback da SPA com HTML 200.
  router.use((_req, res) => {
    res.status(404).json({ error: "Rota operacional inexistente." });
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
