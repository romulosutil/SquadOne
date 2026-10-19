/**
 * Callback do OAuth com dois escopos: grava, recusa sem Calendar sem tocar a
 * credencial anterior, e `escoposConcedidos` lê o que ficou em disco. Roda num
 * diretório temporário: `auth-store.ts` fixa o caminho do arquivo a partir do
 * cwd NO IMPORT, por isso o chdir vem antes do import dinâmico (cada arquivo de
 * teste roda no seu próprio processo). `fetch` é dublê: nada toca o Google.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "squadone-auth-"));
process.chdir(tmp);
process.env.SQUADONE_DATA_DIR = path.join(tmp, "data");
process.env.VITE_GOOGLE_CLIENT_ID = "123-abc.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "segredo";
process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");

const auth = await import("./auth-store.ts");
const ARQUIVO = path.join(tmp, "data", "google-auth.json");
const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Um consentimento de verdade: o state só vale se saiu de urlDeConsentimento. */
function novoState(): string {
  return new URL(auth.urlDeConsentimento()).searchParams.get("state")!;
}

function googleDevolve(corpo: Record<string, unknown>): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: "at", expires_in: 3600, refresh_token: "rt", ...corpo }), {
      status: 200,
    })) as unknown as typeof fetch;
}

describe("urlDeConsentimento", () => {
  it("pede os dois escopos, incremental e com consent", () => {
    const u = new URL(auth.urlDeConsentimento());
    assert.equal(u.searchParams.get("scope"), `${auth.ESCOPO_CALENDAR} ${auth.ESCOPO_TASKS}`);
    assert.equal(u.searchParams.get("include_granted_scopes"), "true");
    assert.equal(u.searchParams.get("prompt"), "consent");
    assert.equal(u.searchParams.get("access_type"), "offline");
  });
});

describe("trocarCodigo + escoposConcedidos", () => {
  it("sem credencial: os dois false", async () => {
    await fs.rm(ARQUIVO, { force: true });
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: false, tasks: false });
  });

  it("scope ausente na resposta: grava só Calendar (tasks false)", async () => {
    googleDevolve({ scope: undefined });
    await auth.trocarCodigo("code", novoState());
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: true, tasks: false });
  });

  it("os dois concedidos: grava e tasks true", async () => {
    googleDevolve({ scope: `${auth.ESCOPO_CALENDAR} ${auth.ESCOPO_TASKS}` });
    await auth.trocarCodigo("code", novoState());
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: true, tasks: true });
  });

  it("Tasks desmarcado: grava normalmente, tasks false", async () => {
    googleDevolve({ scope: auth.ESCOPO_CALENDAR });
    await auth.trocarCodigo("code", novoState());
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: true, tasks: false });
  });

  it("Calendar desmarcado: EscopoNegado e a credencial anterior fica byte a byte", async () => {
    googleDevolve({ scope: `${auth.ESCOPO_CALENDAR} ${auth.ESCOPO_TASKS}` });
    await auth.trocarCodigo("code", novoState());
    const antes = await fs.readFile(ARQUIVO, "utf8");

    googleDevolve({ scope: auth.ESCOPO_TASKS, refresh_token: "rt-novo" });
    await assert.rejects(auth.trocarCodigo("code", novoState()), auth.EscopoNegado);

    assert.equal(await fs.readFile(ARQUIVO, "utf8"), antes);
    assert.deepEqual(await auth.escoposConcedidos(), { calendar: true, tasks: true });
  });

  it("Calendar desmarcado sem credencial anterior: nada é criado", async () => {
    await fs.rm(ARQUIVO, { force: true });
    googleDevolve({ scope: auth.ESCOPO_TASKS });
    await assert.rejects(auth.trocarCodigo("code", novoState()), auth.EscopoNegado);
    await assert.rejects(fs.access(ARQUIVO));
  });
});
