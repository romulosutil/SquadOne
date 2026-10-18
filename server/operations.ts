import crypto from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import express from "express";
import { CrmStore, RegistroFalhou, RegistroIndisponivel, RegistroInvalido, siteProprioDoLead } from "./crm.ts";
import { SiteBloqueado, type LeitorDeSinais } from "./sinais-do-site-leitor.ts";
import { CopilotoFalhou, LeadForaDoCrm, PassoSemCopiloto, TetoDoCopiloto, type Copiloto } from "./copiloto.ts";
import { lerConversaDoNumero } from "./conversa-do-lead.ts";
import { lerHistoricoDoVendedor, resumoDoVendedor } from "./vendedor.ts";
import { lerRegistrosDoLeadQuente } from "./lead-quente-sombra.ts";
import { resumoDoLeadQuente } from "./lead-quente.ts";
import { criarMemoriaDaVenda, MAX_CHAVE, type ComoResolveu, type MemoriaDaVenda } from "./venda-do-dia.ts";
import { MAX_CORPO_DO_BEACON, telaDoCorpo, type ContadorDeUso } from "./uso.ts";
import { lerPedidoDeMensagem, PedidoDoAssistenteInvalido, TetoDoAssistente, type Assistente } from "./assistente.ts";
import type { EstadoDoAssistente } from "../src/operations/assistente-contrato.ts";
import type { CrmProduto } from "../src/operations/types.ts";

const PRODUTOS_DO_CRM: readonly CrmProduto[] = ["site", "prumo", "iris", "estampa", "plus"];
/** O que a Próxima venda anota num toque (AnotacaoDeVenda de src/operations/proxima-venda.ts). */
const TIPOS_DA_ANOTACAO_DE_VENDA: ReadonlySet<string> = new Set(["segunda_enviada", "followup_enviado", "plus_enviado", "proposta", "recusou"]);
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
  /** O "Enviei"/"Pular" do dia, dividido com o vendedor (OT-01); ausente, a rota cria a sua. */
  memoriaDaVenda?: MemoriaDaVenda;
  /** Contador de uso (server/uso.ts, AC-28); ausente, /uso responde 503. */
  uso?: ContadorDeUso;
  /** Assistente da Central (server/assistente.ts, RULES 28): null/ausente = desligado. */
  assistente?: Assistente | null;
  /** Leitor dos sinais do site de um lead (server/sinais-do-site-leitor.ts); ausente, POST /crm/sinais responde 503. */
  sinaisDoSite?: LeitorDeSinais;
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
      // O arquivo tem o nome do NÚMERO (o observador não conhece a planilha): o lead diz qual é.
      const lead = options.crm ? (await options.crm.visao()).leads.find((l) => l.chave === id) : undefined;
      const mensagens = lead ? await lerConversaDoNumero(lead.links.whatsapp, options.crm?.config.conversas) : null;
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
      responderErroDoRegistro(res, error);
    }
  });
  // Também a anotação da Próxima venda (/crm/venda/anotar): o mesmo POST à aba CRM, a mesma resposta.
  function responderErroDoRegistro(res: express.Response, error: unknown) {
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

  // As sugestões que o copiloto já fez sozinho e ainda valem para a conversa de agora (16/10/2026):
  // a Próxima venda põe a dele no lugar do texto pronto. Só lê o que está guardado: nunca chama o modelo.
  router.get("/crm/copiloto/prontas", async (_req, res) => {
    if (!options.copiloto || !options.crm) return void res.json({ sugestoes: {} });
    try {
      const prontas = await options.copiloto.prontas((await options.crm.visao()).leads);
      res.setHeader("Cache-Control", "no-store");
      res.json({ sugestoes: Object.fromEntries([...prontas].map(([id, s]) => [id, {
        mensagem: s.sugestao.mensagem, porque: s.sugestao.porque, quando: s.quando, ...(s.sugestao.momento ? { momento: s.sugestao.momento } : {}),
      }])) });
    } catch (error) {
      responderErroDoCopiloto(res, error);
    }
  });

  // O "Enviei" e o "Pular" da fila de venda (16/10/2026, OT-01): uma memória para a Próxima venda em
  // qualquer navegador e para o vendedor do Telegram (o mesmo arquivo). Não é funil: só a ordem do dia.
  // Desde 17/10/2026 (AC-06) o GET devolve também por onde cada ação se resolveu, as anotações já
  // feitas (uma por ação + tipo) e os primeiros contatos do dia das duas superfícies (a trava de ritmo),
  // e (AC-21) os leads liberados fora do expediente.
  const memoriaDaVenda = options.memoriaDaVenda ?? criarMemoriaDaVenda(path.join(options.dataDir, "venda-do-dia.json"));
  router.get("/crm/venda", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await memoriaDaVenda.ler());
  });
  // A Central resolve uma ação: { chave, como } (enviada | pulada | recusa), ou o formato de 16/10
  // ({ chave, pulou }) de uma aba aberta antes da atualização. Por onde é sempre "central": o
  // Telegram grava pelo vendedor, no mesmo processo.
  router.post("/crm/venda", express.json({ limit: "4kb" }), async (req, res) => {
    const { chave, pulou, como } = (req.body ?? {}) as { chave?: unknown; pulou?: unknown; como?: unknown };
    const comoFoi: ComoResolveu | null = como === "enviada" || como === "pulada" || como === "recusa" ? como
      : typeof pulou === "boolean" ? (pulou ? "pulada" : "enviada") : null;
    if (typeof chave !== "string" || !chave.trim() || chave.length > MAX_CHAVE || !comoFoi) {
      return void res.status(400).json({ error: "Diga a chave da ação e como ela se resolveu." });
    }
    try {
      res.json(await memoriaDaVenda.resolver(chave, comoFoi, "central"));
    } catch (error) {
      console.error("[venda] não gravou:", error);
      res.status(500).json({ error: "Não deu para guardar agora." });
    }
  });
  // O toque num link de primeiro contato na Central (17/10/2026, AC-06): a trava de ritmo das duas
  // superfícies conta daqui. Repetir o toque no mesmo lead não conta de novo. Não envia nada a lead.
  router.post("/crm/venda/primeiro", express.json({ limit: "4kb" }), async (req, res) => {
    const { leadId } = (req.body ?? {}) as { leadId?: unknown };
    if (typeof leadId !== "string" || !/^[A-Za-z0-9_:.-]{1,200}$/.test(leadId)) {
      return void res.status(400).json({ error: "Diga o lead do primeiro contato." });
    }
    try {
      res.json(await memoriaDaVenda.primeiroContato(leadId, "central"));
    } catch (error) {
      console.error("[venda] primeiro contato não gravou:", error);
      res.status(500).json({ error: "Não deu para guardar agora." });
    }
  });
  // O "Liberar" fora do expediente (17/10/2026, AC-21): um só, para a Próxima venda, a Triagem e a
  // Ficha, em qualquer aba, até a meia-noite de SP. Só destrava o link na tela (o toque segue sendo do
  // Rômulo); o ritmo não passa por aqui e nunca se libera. Devolve o dia, como os outros POST.
  router.post("/crm/venda/liberar", express.json({ limit: "4kb" }), async (req, res) => {
    const { leadId } = (req.body ?? {}) as { leadId?: unknown };
    if (typeof leadId !== "string" || !/^[A-Za-z0-9_:.-]{1,200}$/.test(leadId)) {
      return void res.status(400).json({ error: "Diga o lead a liberar." });
    }
    try {
      res.json(await memoriaDaVenda.liberar(leadId));
    } catch (error) {
      console.error("[venda] liberar não gravou:", error);
      res.status(500).json({ error: "Não deu para guardar agora." });
    }
  });
  // A anotação do toque da Próxima venda (2ª mensagem, follow-up, Plus, proposta, recusa): o mesmo
  // registro da Ficha, mas uma vez por ação no dia. Já saiu (pela Central ou pelo "Enviei" do
  // Telegram), responde 200 com jaEstava e não chama o n8n de novo.
  router.post("/crm/venda/anotar", express.json({ limit: "4kb" }), async (req, res) => {
    if (!options.crm) return void res.status(503).json({ error: "O CRM não está configurado nesta Central." });
    const crm = options.crm;
    const { chave, produto, id, tipo } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof chave !== "string" || chave.length > MAX_CHAVE || typeof produto !== "string" || typeof id !== "string"
      || typeof tipo !== "string" || !TIPOS_DA_ANOTACAO_DE_VENDA.has(tipo) || !chave.startsWith(`${produto}:${id}|`)) {
      return void res.status(400).json({ error: "Diga a ação, o lead e o que anotar." });
    }
    try {
      const r = await memoriaDaVenda.anotarUmaVez(chave, tipo, "central", () => crm.registrar({ produto, id, tipo, texto: "", data: "" }));
      res.status(r.anotou ? 201 : 200).json(r.anotou ? { anotou: true } : { anotou: false, jaEstava: true });
    } catch (error) {
      responderErroDoRegistro(res, error);
    }
  });

  // A medida do vendedor (16/10/2026, OT-09): avisos do Telegram e o que virou "Enviei", dos últimos
  // 30 dias. Só lê o histórico; sem vendedor ligado (ou antes do primeiro aviso) vem tudo zero.
  router.get("/crm/vendedor", async (_req, res) => {
    const eventos = await lerHistoricoDoVendedor(path.join(options.dataDir, "vendedor-historico.jsonl"));
    res.setHeader("Cache-Control", "no-store");
    res.json({ resumo: resumoDoVendedor(eventos, Date.now()), desde: eventos[0]?.em ?? null });
  });

  // A medida do agente do lead quente em sombra (17/10/2026): quantas decisões de cada tipo, os falsos
  // positivos do classificador de `interesse` (os 👎 num "responder") e quanto o lead esperou de fato pela
  // resposta humana. Só lê o JSONL; sem a sombra ligada (ou antes da primeira decisão) vem tudo zero.
  router.get("/crm/lead-quente", async (_req, res) => {
    const agora = Date.now();
    const registros = await lerRegistrosDoLeadQuente(path.join(options.dataDir, "lead-quente-sombra"), agora);
    res.setHeader("Cache-Control", "no-store");
    res.json({ resumo: resumoDoLeadQuente(registros, agora), desde: registros[0]?.quando ?? null });
  });

  // Os sinais do site de UM lead (17/10/2026), lidos sob demanda quando a Ficha abre: no máximo 3
  // requisições ao site dele, com cache em disco (server/sinais-do-site-leitor.ts). POST e não GET de
  // propósito: abrir uma Ficha faz a Central ir à rede, e o POST passa pela guarda da mesma origem.
  // Só informa; nada daqui vai a lead.
  router.post("/crm/sinais", express.json({ limit: "4kb" }), async (req, res) => {
    const leitor = options.sinaisDoSite;
    if (!leitor || !options.crm) return void res.status(503).json({ error: "A leitura dos sinais do site não está ligada nesta Central." });
    const alvo = leadDoPedido((req.body ?? {}) as Record<string, unknown>);
    if (!alvo) return void res.status(400).json({ error: "Diga o produto e o id do lead." });
    try {
      const lead = (await options.crm.visao()).leads.find((l) => l.produto === alvo.produto && l.chave === alvo.id);
      if (!lead) return void res.status(404).json({ error: "Lead não encontrado no retrato atual." });
      const site = siteProprioDoLead(lead);
      if (typeof site !== "string") return void res.status(409).json({ error: "Este lead não tem um site próprio para ler.", semSite: site === null });
      const r = await leitor.ler(lead.id, site, { forcar: (req.body as Record<string, unknown>).forcar === true });
      res.setHeader("Cache-Control", "no-store");
      res.json({ sinais: r.sinais, estado: r.estado, lidoEm: r.lidoEm, origem: r.origem, requisicoes: r.requisicoes });
    } catch (error) {
      if (error instanceof SiteBloqueado) return void res.status(422).json({ error: "Esse endereço não pode ser lido pela Central.", bloqueado: true });
      console.error("[operations] Falha ao ler os sinais do site:", error);
      res.status(500).json({ error: "Não foi possível ler o site agora." });
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

  // Telas vistas (AC-28): o beacon da casca (src/casca/rota.ts) a cada troca de rota. O sendBeacon
  // manda `text/plain` (tipo que não pede preflight), por isso o corpo chega como texto; passa pela
  // guarda de mesma origem como qualquer POST (o navegador põe Origin e Sec-Fetch-Site nele).
  const lerTextoDoBeacon = express.text({ type: "text/plain", limit: MAX_CORPO_DO_BEACON });
  router.post("/uso", (req, res, next) => {
    // Corpo grande demais é 413 curto, sem a pilha do erro no journal a cada tentativa.
    lerTextoDoBeacon(req, res, (erro?: unknown) => (erro ? void res.status(413).json({ error: "Corpo grande demais." }) : next()));
  }, (req, res) => {
    if (!options.uso) return void res.status(503).json({ error: "O contador de uso está desligado." });
    const tela = telaDoCorpo(req.body);
    if (!tela) return void res.status(400).json({ error: "Diga a rota da tela." });
    options.uso.contarTela(tela);
    res.status(204).end();
  });
  // O agregado por dia, para a auditoria (sem tela por enquanto). Só lê.
  router.get("/uso", async (req, res) => {
    if (!options.uso) return void res.status(503).json({ error: "O contador de uso está desligado." });
    const dias = Number.parseInt(typeof req.query.dias === "string" ? req.query.dias : "14", 10);
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ dias: await options.uso.ler(Number.isFinite(dias) ? dias : 14) });
    } catch (error) {
      console.error("[uso] não leu:", error instanceof Error ? error.message : error);
      res.status(500).json({ error: "Não deu para ler o uso agora." });
    }
  });

  // Assistente da Central (RULES 28), no contrato de src/operations/assistente-contrato.ts. Propõe,
  // nunca faz: nenhuma destas rotas escreve no CRM, na agenda nem no Google; o cartão confirmado vai
  // pela rota de sempre, chamada pelo painel depois do toque. Os POST passam pela guarda de mesma
  // origem do server.ts, como todos.
  const assistenteDesligado = (res: express.Response) =>
    void res.status(503).json({ error: "O Assistente está desligado nesta Central.", desligado: true });
  const ID_DO_ASSISTENTE = /^[A-Za-z0-9-]{8,64}$/;

  router.get("/assistente", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const desligado: EstadoDoAssistente = { ligado: false, hermes: false, tetoDia: 0, usadosHoje: 0 };
    res.json(options.assistente ? await options.assistente.estado() : desligado);
  });

  router.post("/assistente/mensagens", async (req, res) => {
    if (!options.assistente) return assistenteDesligado(res);
    try {
      res.status(202).json(await options.assistente.receber(lerPedidoDeMensagem(req.body)));
    } catch (error) {
      if (error instanceof PedidoDoAssistenteInvalido) res.status(400).json({ error: error.message, ...(error.pendente ? { pendente: true } : {}) });
      else if (error instanceof TetoDoAssistente) res.status(429).json({ error: error.message, teto: true });
      else {
        console.error("[assistente] não recebeu a mensagem:", error instanceof Error ? error.message : error);
        res.status(500).json({ error: "O Assistente não recebeu a mensagem agora." });
      }
    }
  });

  router.get("/assistente/conversas/:id", (req, res) => {
    if (!options.assistente) return assistenteDesligado(res);
    const id = String(req.params.id);
    const desde = typeof req.query.desde === "string" && /^\d{1,6}$/.test(req.query.desde) ? Number(req.query.desde) : 0;
    if (!ID_DO_ASSISTENTE.test(id)) return void res.status(400).json({ error: "Conversa inválida." });
    const conversa = options.assistente.conversa(id, desde);
    res.setHeader("Cache-Control", "no-store");
    if (!conversa) return void res.status(404).json({ error: "Conversa não encontrada." });
    res.json(conversa);
  });

  router.post("/assistente/avaliacao", async (req, res) => {
    if (!options.assistente) return assistenteDesligado(res);
    const { respostaId, nota, motivo } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof respostaId !== "string" || !ID_DO_ASSISTENTE.test(respostaId) || (nota !== 1 && nota !== -1)
      || (motivo !== undefined && (typeof motivo !== "string" || motivo.length > 1000))) {
      return void res.status(400).json({ error: "Diga a resposta e a nota (1 ou -1)." });
    }
    if (!(await options.assistente.avaliar(respostaId, nota, motivo as string | undefined))) {
      return void res.status(404).json({ error: "Resposta não encontrada." });
    }
    res.status(204).end();
  });

  router.post("/assistente/cartoes/:id", async (req, res) => {
    if (!options.assistente) return assistenteDesligado(res);
    const id = String(req.params.id);
    const { desfecho } = (req.body ?? {}) as Record<string, unknown>;
    if (!ID_DO_ASSISTENTE.test(id) || (desfecho !== "confirmado" && desfecho !== "descartado")) {
      return void res.status(400).json({ error: "Diga o cartão e o desfecho (confirmado ou descartado)." });
    }
    const r = await options.assistente.decidirCartao(id, desfecho);
    if (r === "naoAchou") return void res.status(404).json({ error: "Cartão não encontrado." });
    if (r === "jaDecidido") return void res.status(409).json({ error: "Este cartão já foi decidido." });
    res.status(204).end();
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
