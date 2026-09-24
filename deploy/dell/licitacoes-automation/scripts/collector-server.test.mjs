import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('tempo esgotado aguardando estado da coleta');
}

test('responde imediatamente, deduplica e permite acompanhar a coleta', async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'pncp-collector-'));
  process.env.RADAR_DATA_DIR = dataDir;
  const { createCollectorServer } = await import(`./collector-server.mjs?test=${Date.now()}`);

  let finishCollection;
  const collector = () => new Promise((resolve) => { finishCollection = resolve; });
  const server = createCollectorServer({ collector });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const startedAt = Date.now();
  const firstResponse = await fetch(`${baseUrl}/collect`, { method: 'POST' });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 202);
  assert.equal(first.status, 'collecting');
  assert.equal(first.duplicate, false);
  assert.ok(Date.now() - startedAt < 500);

  const duplicateResponse = await fetch(`${baseUrl}/collect`, { method: 'POST' });
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 202);
  assert.equal(duplicate.collection_id, first.collection_id);
  assert.equal(duplicate.duplicate, true);

  const running = await fetch(`${baseUrl}${first.status_url}`).then((response) => response.json());
  assert.equal(running.status, 'collecting');

  await waitFor(() => typeof finishCollection === 'function');
  finishCollection({ status: 'completed', counts: { fetched: 1 } });
  const completed = await waitFor(async () => {
    const job = await fetch(`${baseUrl}${first.status_url}`).then((response) => response.json());
    return job.status === 'completed' ? job : null;
  });
  assert.equal(completed.result.counts.fetched, 1);
});

test('persiste falha controlada sem derrubar o servidor', async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'pncp-collector-failure-'));
  process.env.RADAR_DATA_DIR = dataDir;
  const { createCollectorServer } = await import(`./collector-server.mjs?failure=${Date.now()}`);
  const server = createCollectorServer({ collector: async () => { throw new Error('PNCP lento'); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const accepted = await fetch(`${baseUrl}/collect`, { method: 'POST' }).then((response) => response.json());
  const failed = await waitFor(async () => {
    const job = await fetch(`${baseUrl}${accepted.status_url}`).then((response) => response.json());
    return job.status === 'failed' ? job : null;
  });
  assert.equal(failed.result.status, 'source_unavailable');
  assert.equal(failed.result.error, 'PNCP lento');

  const latest = JSON.parse(await readFile(path.join(dataDir, 'latest-run.json'), 'utf8'));
  assert.equal(latest.collection_id, accepted.collection_id);
  assert.equal(latest.status, 'source_unavailable');
});
