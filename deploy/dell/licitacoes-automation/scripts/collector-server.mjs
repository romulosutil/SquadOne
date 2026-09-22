#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCollector, writeCollectorFailure } from './collect-pncp.mjs';

const host = process.env.COLLECTOR_HOST ?? '0.0.0.0';
const port = Number(process.env.COLLECTOR_PORT ?? 3000);
const dataDir = process.env.RADAR_DATA_DIR ?? '/data';
const jobsDir = path.join(dataDir, 'collections');
let activeJob = null;

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function writeAtomically(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

function jobFile(id) {
  return path.join(jobsDir, `${id}.json`);
}

function publicJob(job, duplicate = false) {
  return {
    status: job.status,
    collection_id: job.collection_id,
    message: duplicate
      ? 'É a mesma coleta; acompanhe este ID.'
      : 'Recebi; estou coletando em segundo plano.',
    duplicate,
    status_url: `/collections/${job.collection_id}`,
    requested_at: job.requested_at,
  };
}

async function readJob(id) {
  if (activeJob?.collection_id === id) return activeJob;
  try {
    return JSON.parse(await readFile(jobFile(id), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function collectInBackground(job, collector) {
  try {
    await writeAtomically(jobFile(job.collection_id), job);
    const report = await collector({ collectionId: job.collection_id });
    const completed = {
      ...job,
      status: 'completed',
      finished_at: new Date().toISOString(),
      result: report,
    };
    await writeAtomically(jobFile(job.collection_id), completed);
  } catch (error) {
    try {
      const failure = await writeCollectorFailure(error, {
        collectionId: job.collection_id,
        dataDir,
      });
      await writeAtomically(jobFile(job.collection_id), {
        ...job,
        status: 'failed',
        finished_at: failure.run_at,
        result: failure,
      });
      console.error(JSON.stringify({
        event: 'collection_failed',
        collection_id: job.collection_id,
        error: failure.error,
      }));
    } catch (persistenceError) {
      console.error(JSON.stringify({
        event: 'collection_failure_persistence_failed',
        collection_id: job.collection_id,
        error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
      }));
    }
  } finally {
    if (activeJob?.collection_id === job.collection_id) activeJob = null;
  }
}

export function createCollectorServer({ collector = runCollector } = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? 'collector'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        running: activeJob !== null,
        active_collection_id: activeJob?.collection_id ?? null,
      });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/collections/')) {
      const id = url.pathname.slice('/collections/'.length);
      if (!/^[0-9a-f-]{36}$/.test(id)) {
        return sendJson(response, 400, { error: 'ID de coleta inválido' });
      }
      const job = await readJob(id);
      return job
        ? sendJson(response, 200, job)
        : sendJson(response, 404, { error: 'coleta não encontrada' });
    }

    if (request.method === 'POST' && url.pathname === '/collect') {
      if (activeJob) return sendJson(response, 202, publicJob(activeJob, true));

      const job = {
        schema_version: 1,
        collection_id: randomUUID(),
        status: 'collecting',
        requested_at: new Date().toISOString(),
      };
      activeJob = job;
      sendJson(response, 202, publicJob(job));
      setImmediate(() => void collectInBackground(job, collector));
      return;
    }

    return sendJson(response, 404, { error: 'rota não encontrada' });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createCollectorServer();
  server.listen(port, host, () => console.log(`collector ready on ${host}:${port}`));
}
