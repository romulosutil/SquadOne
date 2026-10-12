import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import express from "express";
import {
  classifyProjectTarget,
  createOperationsRouter,
  HermesReadingsStore,
  listenHostForMode,
  mapOperationalState,
  OPERATION_REQUIRED_TOOL_IDS,
  OperationsProjectStore,
  readOperationsConfig,
  readSquadOneMode,
  todayWindow,
  validateProjectInput,
  type OperationsConfig,
} from "./operations.ts";

const temporaryDirectories: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function listen(server: http.Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// O config/operations.example.json como era até 12/10/2026, com a entrada do
// Syncthing no mesmo formato da configuração real do Dell. Precisa continuar
// válido: o Dell fica com a entrada até ela ser tirada à mão depois do deploy.
const EXEMPLO_ANTIGO_COM_SYNCTHING = {
  displayName: "Seu nome",
  autoDirectory: "/home/usuario/auto",
  autoNotificationStateFile: "/home/usuario/.hermes/leads-notificados.json",
  tools: {
    hermes: { label: "Hermes Chat Web", description: "Conversas e agentes", launchUrl: "http://127.0.0.1:9119/chat", healthUrl: "http://127.0.0.1:9119/api/status" },
    ide: { label: "IDE", description: "code-server", launchUrl: "http://127.0.0.1:8080/", healthUrl: "http://127.0.0.1:8080/healthz" },
    syncthing: {
      label: "Syncthing",
      description: "Arquivos locais",
      launchUrl: "http://127.0.0.1:8384/",
      healthUrl: "https://127.0.0.1:8384/rest/db/status?folder=seu-folder-id",
      healthKind: "syncthing",
      healthApiKeyFile: "/home/usuario/.local/state/syncthing/config.xml",
    },
    n8n: { label: "n8n", description: "Automações", launchUrl: "http://127.0.0.1:5679/", healthUrl: "http://127.0.0.1:5679/healthz" },
    remote: { label: "SquadOne remoto", description: "EasyPanel", launchUrl: "https://aladdin-squadone-app.jicnzg.easypanel.host/", healthUrl: "https://aladdin-squadone-app.jicnzg.easypanel.host/" },
  },
};

async function gravarConfig(conteudo: unknown): Promise<string> {
  const arquivo = path.join(await tempDir("squadone-operations-config-"), "operations.json");
  await fs.writeFile(arquivo, JSON.stringify(conteudo));
  return arquivo;
}

function semFerramenta(id: string) {
  const tools: Record<string, unknown> = { ...EXEMPLO_ANTIGO_COM_SYNCTHING.tools };
  delete tools[id];
  return { ...EXEMPLO_ANTIGO_COM_SYNCTHING, tools };
}

describe("configuração das ferramentas", () => {
  it("aceita a configuração antiga, com a entrada do Syncthing, como sempre", async () => {
    const config = await readOperationsConfig(await gravarConfig(EXEMPLO_ANTIGO_COM_SYNCTHING));
    assert.deepEqual(Object.keys(config.tools).sort(), ["hermes", "ide", "n8n", "remote", "syncthing"]);
    assert.deepEqual(config.tools.syncthing, {
      label: "Syncthing",
      description: "Arquivos locais",
      launchUrl: "http://127.0.0.1:8384/",
      healthUrl: "https://127.0.0.1:8384/rest/db/status?folder=seu-folder-id",
      healthKind: "syncthing",
      healthApiKeyFile: path.resolve("/home/usuario/.local/state/syncthing/config.xml"),
    });
    // As outras não mudam de formato.
    assert.deepEqual(config.tools.hermes, {
      label: "Hermes Chat Web",
      description: "Conversas e agentes",
      launchUrl: "http://127.0.0.1:9119/chat",
      healthUrl: "http://127.0.0.1:9119/api/status",
      healthKind: "http",
    });
  });

  it("aceita a configuração sem o Syncthing e não inventa a entrada", async () => {
    const config = await readOperationsConfig(await gravarConfig(semFerramenta("syncthing")));
    assert.deepEqual(Object.keys(config.tools).sort(), ["hermes", "ide", "n8n", "remote"]);
    assert.equal("syncthing" in config.tools, false);
  });

  it("o exemplo versionado é válido e já vem sem o Syncthing", async () => {
    const exemplo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "operations.example.json");
    const config = await readOperationsConfig(exemplo);
    assert.deepEqual(Object.keys(config.tools).sort(), ["hermes", "ide", "n8n", "remote"]);
  });

  for (const id of OPERATION_REQUIRED_TOOL_IDS) {
    it(`sem '${id}' a configuração continua inválida`, async () => {
      await assert.rejects(
        readOperationsConfig(await gravarConfig(semFerramenta(id))),
        new RegExp(`ferramenta '${id}' está incompleta`),
      );
    });
  }

  it("Syncthing presente mas incompleto é erro, não ferramenta desligada", async () => {
    const quebrado = {
      ...EXEMPLO_ANTIGO_COM_SYNCTHING,
      tools: { ...EXEMPLO_ANTIGO_COM_SYNCTHING.tools, syncthing: { label: "Syncthing" } },
    };
    await assert.rejects(readOperationsConfig(await gravarConfig(quebrado)), /ferramenta 'syncthing' está incompleta/);
  });
});

describe("/overview", () => {
  async function overview(config: OperationsConfig) {
    const dataDir = await tempDir("squadone-operations-overview-");
    const app = express();
    app.use("/api/operations", createOperationsRouter({
      config,
      store: new OperationsProjectStore(dataDir),
      readings: new HermesReadingsStore(dataDir),
      readAgenda: async () => ({ state: "disconnected", events: [] }),
      dataDir,
    }));
    const base = await listen(http.createServer(app));
    const response = await fetch(`${base}/api/operations/overview`);
    assert.equal(response.status, 200);
    return (await response.json()) as { tools: Array<{ id: string; state: string }> };
  }

  async function configLocal(comSyncthing: boolean): Promise<OperationsConfig> {
    // Dublê de saúde em loopback: toda ferramenta responde 200.
    const saude = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    }));
    const ferramenta = (label: string) => ({ label, description: label, launchUrl: `${saude}/`, healthUrl: `${saude}/healthz`, healthKind: "http" as const });
    return {
      displayName: "Teste",
      tools: {
        hermes: ferramenta("Hermes"),
        ide: ferramenta("IDE"),
        n8n: ferramenta("n8n"),
        remote: ferramenta("Remoto"),
        ...(comSyncthing ? { syncthing: { ...ferramenta("Syncthing"), healthKind: "syncthing" as const } } : {}),
      },
    };
  }

  it("sem o Syncthing na configuração, a ferramenta não aparece (nem como indisponível)", async () => {
    const body = await overview(await configLocal(false));
    assert.deepEqual(body.tools.map((tool) => tool.id), ["hermes", "ide", "n8n", "remote"]);
    assert.ok(body.tools.every((tool) => tool.state === "healthy"));
  });

  it("com o Syncthing na configuração, ele segue no lugar de antes", async () => {
    const body = await overview(await configLocal(true));
    assert.deepEqual(body.tools.map((tool) => tool.id), ["hermes", "ide", "syncthing", "n8n", "remote"]);
    assert.ok(body.tools.every((tool) => tool.state === "healthy"));
  });
});

describe("perfil de execução", () => {
  it("mantém app como padrão e força loopback em operations", () => {
    assert.equal(readSquadOneMode({}), "app");
    // Vazia vale o padrão, como as outras envs do projeto: um campo em branco
    // no Easypanel não pode derrubar o boot.
    assert.equal(readSquadOneMode({ SQUADONE_MODE: "" }), "app");
    assert.equal(readSquadOneMode({ SQUADONE_MODE: "  " }), "app");
    assert.equal(readSquadOneMode({ SQUADONE_MODE: "operations" }), "operations");
    assert.equal(listenHostForMode("app"), "0.0.0.0");
    assert.equal(listenHostForMode("operations"), "127.0.0.1");
  });

  it("recusa perfil desconhecido", () => {
    assert.throws(() => readSquadOneMode({ SQUADONE_MODE: "public-operations" }), /deve ser 'app' ou 'operations'/);
  });
});

describe("projetos locais", () => {
  it("aceita somente caminho Linux absoluto ou URL http/https", () => {
    assert.deepEqual(classifyProjectTarget("/home/user/projeto"), {
      target: "/home/user/projeto",
      kind: "linux_path",
    });
    assert.deepEqual(classifyProjectTarget("https://example.com/painel"), {
      target: "https://example.com/painel",
      kind: "url",
    });
    assert.throws(() => classifyProjectTarget("javascript:alert(1)"), /não são permitidos/);
    assert.throws(() => classifyProjectTarget("projeto/relativo"), /caminho Linux absoluto/);
  });

  it("valida os campos obrigatórios", () => {
    assert.deepEqual(validateProjectInput({ name: " SquadOne ", target: "/home/user/SquadOne" }), {
      name: "SquadOne",
      description: "",
      category: "",
      pinned: false,
      target: "/home/user/SquadOne",
      kind: "linux_path",
    });
    assert.throws(() => validateProjectInput({ name: "", target: "/tmp" }), /nome/);
  });

  it("persiste criação, edição e exclusão em JSON fora do Git", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-operations-"));
    temporaryDirectories.push(directory);
    const store = new OperationsProjectStore(directory);

    const created = await store.create({ name: "CRM", target: "/home/user/crm" });
    assert.equal((await store.list())[0].id, created.id);

    const updated = await store.update(created.id, { name: "CRM Silmer", target: "https://crm.example.com" });
    assert.equal(updated.kind, "url");
    assert.equal((await store.list())[0].name, "CRM Silmer");

    await store.remove(created.id);
    assert.deepEqual(await store.list(), []);
  });
});

describe("leituras do Hermes", () => {
  it("trata arquivo ausente como caixa vazia e ordena leituras válidas", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-hermes-"));
    temporaryDirectories.push(directory);
    const store = new HermesReadingsStore(directory);
    assert.deepEqual(await store.list(), []);

    await fs.writeFile(store.filePath, JSON.stringify([
      { id: "old", projectId: "iris", projectName: "Iris", title: "Fila revisada", summary: "Sem bloqueios novos.", severity: "info", occurredAt: "2026-09-16T10:00:00Z", evidence: "scan local", source: "Hermes agent" },
      { id: "new", projectId: "producao-auto", projectName: "Produção Auto", title: "Site pronto", summary: "Um artefato novo foi encontrado.", severity: "action", occurredAt: "2026-09-17T10:00:00Z", evidence: "index.html", source: "Hermes agent" },
    ]));

    const readings = await store.list();
    assert.deepEqual(readings.map(reading => reading.id), ["new", "old"]);
    assert.equal(readings[0].occurredAt, "2026-09-17T10:00:00.000Z");
  });

  it("recusa leitura sem evidência", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-hermes-invalid-"));
    temporaryDirectories.push(directory);
    const store = new HermesReadingsStore(directory);
    await fs.writeFile(store.filePath, JSON.stringify([{ id: "x" }]));
    await assert.rejects(store.list(), /severidade|evidência/);
  });
});

describe("estados operacionais", () => {
  it("não inventa saúde quando a resposta falha", () => {
    assert.equal(mapOperationalState(false, null, "http"), "unavailable");
    assert.equal(mapOperationalState(true, null, "http"), "healthy");
    assert.equal(mapOperationalState(true, { status: "syncing" }, "syncthing"), "syncing");
    assert.equal(mapOperationalState(true, { state: "scanning" }, "syncthing"), "syncing");
  });

  it("calcula a janela civil do dia no fuso configurado", () => {
    const window = todayWindow(new Date("2026-09-16T15:00:00.000Z"), "America/Sao_Paulo");
    assert.equal(window.start.toISOString(), "2026-09-16T03:00:00.000Z");
    assert.equal(window.end.toISOString(), "2026-09-17T03:00:00.000Z");
  });
});
