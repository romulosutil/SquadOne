import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { AutoProductionStore, InvalidAutoProductionInput } from "./auto-production.ts";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ root: string; data: string; store: AutoProductionStore }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-auto-"));
  temporaryDirectories.push(directory);
  const root = path.join(directory, "auto");
  const data = path.join(directory, "data");
  await fs.mkdir(path.join(root, "cliente-pronto", "Logotipo"), { recursive: true });
  await fs.mkdir(path.join(root, "cliente-pronto", "Fotos"), { recursive: true });
  await fs.mkdir(path.join(root, "cliente-incompleto"), { recursive: true });
  await fs.mkdir(path.join(root, "_descartados", "cliente-antigo"), { recursive: true });
  await fs.writeFile(path.join(root, "cliente-pronto", "content.md"), "# Conteúdo\n");
  await fs.writeFile(path.join(root, "cliente-pronto", "index.html"), "<!doctype html>");
  await fs.writeFile(path.join(root, "cliente-pronto", "publicado.json"), JSON.stringify({ nome: "Cliente Pronto" }));
  await fs.writeFile(path.join(root, "cliente-pronto", "Logotipo", "capa.jpg"), "imagem");
  await fs.writeFile(path.join(root, "cliente-pronto", "Fotos", "foto.jpg"), "imagem");
  await fs.writeFile(path.join(root, "cliente-incompleto", "content.md"), "# Em andamento\n");
  return { root, data, store: new AutoProductionStore(root, data) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("Produção Auto", () => {
  it("deriva etapas e alertas somente dos artefatos locais", async () => {
    const { store } = await fixture();
    const overview = await store.overview();

    assert.equal(overview.summary.active, 2);
    assert.equal(overview.summary.discarded, 1);
    assert.equal(overview.funnel.generated, 1);
    assert.equal(overview.summary.ready, 0);
    assert.equal(overview.clients.find((client) => client.id === "cliente-pronto")?.stage, "generated");
    assert.deepEqual(
      overview.clients.find((client) => client.id === "cliente-incompleto")?.alerts,
      ["Nenhuma foto encontrada em Fotos/.", "Nenhuma capa ou logotipo encontrado em Logotipo/.", "index.html não encontrado."],
    );
  });

  it("registra os três marcos em ordem e preserva a origem", async () => {
    const { store } = await fixture();
    const ready = await store.updateEvent("cliente-pronto", { type: "ready", at: "2026-09-17T12:00:00-03:00" });
    const readyClient = ready.clients.find((client) => client.id === "cliente-pronto")!;
    assert.equal(readyClient.stage, "ready");
    assert.equal(readyClient.operationalHistory[0].origin, "Hermes via WhatsApp");
    assert.equal(readyClient.operationalHistory[0].manual, true);

    const sent = await store.updateEvent("cliente-pronto", {
      type: "sent",
      at: "2026-09-17T13:00:00-03:00",
      channel: "WhatsApp",
      recipient: "+55 •••• 4321",
    });
    assert.equal(sent.summary.awaitingConfirmation, 1);
    assert.equal(sent.clients.find((client) => client.id === "cliente-pronto")?.operationalHistory[1].origin, "registro manual");

    const confirmed = await store.updateEvent("cliente-pronto", { type: "confirmed", at: "2026-09-17T14:00:00-03:00" });
    assert.equal(confirmed.summary.confirmed, 1);
    assert.equal(confirmed.summary.awaitingConfirmation, 0);
  });

  it("recusa saltos de etapa e clientes fora da produção ativa", async () => {
    const { store } = await fixture();
    await assert.rejects(
      store.updateEvent("cliente-pronto", { type: "sent", at: "2026-09-17T13:00:00-03:00", channel: "WhatsApp" }),
      (error: unknown) => error instanceof InvalidAutoProductionInput && /Hermes/.test(error.message),
    );
    await assert.rejects(
      store.updateEvent("../fora", { type: "ready", at: "2026-09-17T13:00:00-03:00" }),
      /não encontrado/,
    );
  });
});
