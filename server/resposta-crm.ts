import { createHash } from 'node:crypto'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { Request, Response } from 'express'

const comprimir = promisify(gzip)
// A projeção é imutável. Uma serialização e uma compressão por objeto, mesmo com vários leitores.
const respostas = new WeakMap<object, Promise<{ original: Buffer; gzip: Buffer; etag: string }>>()
async function representar(valor: object) {
  let leitura = respostas.get(valor)
  if (!leitura) {
    leitura = (async () => {
      const original = Buffer.from(JSON.stringify(valor))
      const etag = 'W/"' + createHash('sha256').update(original).digest('base64url') + '"'
      return { original, gzip: await comprimir(original), etag }
    })()
    respostas.set(valor, leitura)
    leitura.catch(() => respostas.delete(valor))
  }
  return leitura
}
export async function responderCrm(req: Request, res: Response, valor: object) {
  res.vary('Accept-Encoding')
  res.set('Cache-Control', 'no-cache')
  const formato = req.acceptsEncodings('gzip', 'identity')
  if (!formato) { res.status(406).end(); return }
  const corpo = await representar(valor)
  res.type('application/json').set('ETag', corpo.etag)
  if (formato === 'gzip') res.set('Content-Encoding', 'gzip')
  res.send(formato === 'gzip' ? corpo.gzip : corpo.original)
}
