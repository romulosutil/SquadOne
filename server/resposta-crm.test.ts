import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import express from 'express'
import http from 'node:http'
import { responderCrm } from './resposta-crm.ts'

test('CRM preserva JSON, negocia gzip, revalida ETag e serializa uma vez por projeção', async t => {
  let serializacoes = 0
  const valor = { toJSON() { serializacoes++; return { leads: ['histórico completo '.repeat(500)] } } }
  const app = express()
  app.get('/', (req, res, next) => { responderCrm(req, res, valor).catch(next) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(r => server.once('listening', r))
  t.after(() => new Promise<void>(r => server.close(() => r())))
  const address = server.address() as { port: number }
  async function ler(headers: Record<string, string>, method = 'GET') {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: address.port, path: '/', method, headers }, res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
  }
  const [identidade, zip] = await Promise.all([ler({ 'Accept-Encoding': 'identity' }), ler({ 'Accept-Encoding': 'gzip' })])
  assert.equal(serializacoes, 1)
  assert.equal(zip.headers['content-encoding'], 'gzip')
  assert.match(String(zip.headers.vary), /Accept-Encoding/)
  assert.deepEqual(gunzipSync(zip.body), identidade.body)
  assert.ok(zip.body.length < identidade.body.length / 10)
  const etag = String(zip.headers.etag)
  assert.equal((await ler({ 'Accept-Encoding': 'gzip', 'If-None-Match': etag })).status, 304)
  assert.equal((await ler({ 'Accept-Encoding': 'gzip' }, 'HEAD')).body.length, 0)
  assert.equal((await ler({ 'Accept-Encoding': 'gzip;q=0, identity;q=1' })).headers['content-encoding'], undefined)
  assert.equal((await ler({ 'Accept-Encoding': 'gzip;q=0, identity;q=0' })).status, 406)
  assert.equal(serializacoes, 1)
})
