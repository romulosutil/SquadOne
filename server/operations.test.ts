import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  classifyProjectTarget,
  HermesReadingsStore,
  listenHostForMode,
  mapOperationalState,
  OperationsProjectStore,
  readSquadOneMode,
  todayWindow,
  validateProjectInput,
} from "./operations.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("perfil de execução", () => {
  it("mantém app como padrão e força loopback em operations", () => {
    assert.equal(readSquadOneMode({}), "app");
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
