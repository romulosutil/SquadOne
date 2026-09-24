#!/usr/bin/env node
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3000';

async function requestCollection() {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/collect`, { method: 'POST' });
  return { statusCode: response.status, elapsedMs: Date.now() - startedAt, body: await response.json() };
}

const first = await requestCollection();
const second = await requestCollection();
if (first.statusCode !== 202 || second.statusCode !== 202) throw new Error('collector não respondeu 202');
if (first.body.collection_id !== second.body.collection_id) throw new Error('collector criou coleta duplicada');
if (first.body.duplicate || !second.body.duplicate) throw new Error('marcação de duplicidade inválida');
if (first.elapsedMs >= 2_000 || second.elapsedMs >= 2_000) throw new Error('collector demorou para confirmar a coleta');

const statusResponse = await fetch(`${baseUrl}${first.body.status_url}`);
const status = await statusResponse.json();
if (!statusResponse.ok || status.collection_id !== first.body.collection_id) {
  throw new Error('consulta de acompanhamento falhou');
}

console.log(JSON.stringify({
  collection_id: first.body.collection_id,
  first_response_ms: first.elapsedMs,
  duplicate_response_ms: second.elapsedMs,
  duplicate_reused_id: true,
  current_status: status.status,
}));
