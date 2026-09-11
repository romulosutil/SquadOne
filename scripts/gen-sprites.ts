/**
 * gen-sprites.ts — geração dos sprites do escritório (spec §5).
 *
 * Gera as imagens BRUTAS (1024px, fundo magenta) via gemini-3.1-flash-lite-image
 * e salva em `assets/raw/`. A conversão para os 7 arquivos finais de 32px é do
 * `scripts/spritify.py` — este script não redimensiona nada.
 *
 * A ordem de geração é a da spec §5.3 e é ANCORADA: cada peça manda as peças
 * anteriores como imagem de referência, e `char_po_down` é um PORTÃO — a geração
 * para ali até você aprovar a arte de frente.
 *
 *   npx tsx scripts/gen-sprites.ts --list
 *   npx tsx scripts/gen-sprites.ts                      # gera até o portão
 *   npx tsx scripts/gen-sprites.ts --approve char_po_down
 *   npx tsx scripts/gen-sprites.ts                      # segue o resto
 *   npx tsx scripts/gen-sprites.ts --only prop_desk --force
 *
 * Flags:
 *   --list                 imprime a ordem e o estado de cada peça
 *   --only a,b             gera apenas essas peças (ignora o portão)
 *   --from <id>            começa a partir dessa peça
 *   --force                regera mesmo se o arquivo já existir
 *   --approve <id>         marca a peça como aprovada (libera o portão)
 *   --unapprove <id>       remove a aprovação
 *   --size 1K|2K           resolução da API (default 1K; o mínimo da API é 512)
 *   --model <id>           sobrescreve o modelo do manifesto
 *   --dry-run              monta os prompts e não chama a API
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = join(ROOT, 'scripts', 'sprites.manifest.json')
const API = 'https://generativelanguage.googleapis.com/v1beta/models'
const MAX_ATTEMPTS = 3

type Piece = {
  id: string
  kind: 'seamless' | 'cutout'
  cell: string
  prompt: string
  refs: string[]
  gate?: boolean
}

type Manifest = {
  model: string
  costPerImageUSD: number
  rawDir: string
  palette: { name: string; colors: string[] }
  style: { common: string; cutout: string; seamless: string }
  pieces: Piece[]
}

// ---------------------------------------------------------------- args / env

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }
  return flags
}

/** Lê GEMINI_API_KEY do ambiente ou do .env (sem depender de dotenv). */
function apiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  const envFile = join(ROOT, '.env')
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.*)\s*$/)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  throw new Error('GEMINI_API_KEY ausente: exporte a variável ou crie .env (ver .env.example).')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ prompts

function buildPrompt(piece: Piece, m: Manifest): string {
  const palette = m.palette.colors.join(' ')
  const common = m.style.common.replace('{PALETTE}', palette).replace('{CELL}', piece.cell)
  const kindRule = piece.kind === 'seamless' ? m.style.seamless : m.style.cutout
  const refRule = piece.refs.length
    ? `The attached image${piece.refs.length > 1 ? 's are' : ' is'} the already-approved reference${piece.refs.length > 1 ? 's' : ''} for this set (${piece.refs.join(', ')}). Match ${piece.refs.length > 1 ? 'them' : 'it'} exactly in palette, pixel density, lighting direction and viewing angle. Consistency with the reference outweighs any other consideration.`
    : ''
  return [piece.prompt, kindRule, common, refRule].filter(Boolean).join('\n\n')
}

// ---------------------------------------------------------------------- API

type GenOpts = { model: string; size: string; key: string }

async function generate(prompt: string, refs: Buffer[], opts: GenOpts): Promise<Buffer> {
  const parts: unknown[] = [{ text: prompt }]
  for (const ref of refs) {
    parts.push({ inlineData: { mimeType: 'image/png', data: ref.toString('base64') } })
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '1:1', imageSize: opts.size },
    },
  }

  let lastError = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${API}/${opts.model}:generateContent?key=${opts.key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json: any = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))

    if (json.error) {
      lastError = `${json.error.code ?? res.status} ${String(json.error.message).split('\n')[0]}`
      const retriable = res.status === 429 || res.status >= 500
      if (!retriable || attempt === MAX_ATTEMPTS) break
      const backoff = 4000 * attempt
      console.warn(`    retry ${attempt}/${MAX_ATTEMPTS - 1} em ${backoff / 1000}s — ${lastError}`)
      await sleep(backoff)
      continue
    }

    const candidate = json.candidates?.[0]
    const part = (candidate?.content?.parts ?? []).find((p: any) => p.inlineData ?? p.inline_data)
    if (!part) {
      lastError = `resposta sem imagem (finishReason=${candidate?.finishReason ?? '?'})`
      break
    }
    const data = part.inlineData ?? part.inline_data
    return Buffer.from(data.data, 'base64')
  }
  throw new Error(lastError || 'falha desconhecida na geração')
}

// --------------------------------------------------------------------- main

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const m: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const model = (flags.model as string) || m.model
  const size = (flags.size as string) || '1K'
  const rawDir = join(ROOT, m.rawDir)
  const approvedDir = join(rawDir, '.approved')
  mkdirSync(approvedDir, { recursive: true })

  const rawPath = (id: string) => join(rawDir, `${id}.png`)
  const approvalPath = (id: string) => join(approvedDir, id)
  const isApproved = (id: string) => existsSync(approvalPath(id))

  if (flags.approve) {
    const id = flags.approve as string
    if (!existsSync(rawPath(id))) throw new Error(`nada gerado para "${id}" ainda.`)
    writeFileSync(approvalPath(id), new Date().toISOString())
    console.log(`portão liberado: ${id}`)
    return
  }
  if (flags.unapprove) {
    rmSync(approvalPath(flags.unapprove as string), { force: true })
    console.log(`aprovação removida: ${flags.unapprove}`)
    return
  }

  if (flags.list) {
    console.log(`modelo: ${model}   paleta: ${m.palette.name}   raw: ${m.rawDir}`)
    for (const [i, p] of m.pieces.entries()) {
      const state = existsSync(rawPath(p.id)) ? 'gerado' : '—'
      const gate = p.gate ? (isApproved(p.id) ? ' [portão: APROVADO]' : ' [portão: pendente]') : ''
      const refs = p.refs.length ? `  ref: ${p.refs.join(', ')}` : ''
      console.log(`${String(i + 1).padStart(2)}. ${p.id.padEnd(16)} ${state.padEnd(7)}${gate}${refs}`)
    }
    return
  }

  const only = flags.only ? String(flags.only).split(',').map((s) => s.trim()) : null
  let queue = m.pieces
  if (flags.from) {
    const idx = m.pieces.findIndex((p) => p.id === flags.from)
    if (idx < 0) throw new Error(`peça desconhecida em --from: ${flags.from}`)
    queue = m.pieces.slice(idx)
  }
  if (only) queue = queue.filter((p) => only.includes(p.id))

  const key = flags['dry-run'] ? 'DRY' : apiKey()
  let generated = 0

  for (const piece of queue) {
    const out = rawPath(piece.id)

    // Portão §5.3: nada depois da frente do personagem sai sem aprovação manual.
    const gateBlocker = m.pieces.find((p) => p.gate && !isApproved(p.id) && p.id !== piece.id)
    const gateIsBefore =
      gateBlocker && m.pieces.indexOf(gateBlocker) < m.pieces.indexOf(piece) && existsSync(rawPath(gateBlocker.id))
    if (gateIsBefore && !only) {
      console.log(
        `\nPORTÃO em "${gateBlocker!.id}": abra ${m.rawDir}/${gateBlocker!.id}.png e avalie.\n` +
          `  bom     → npx tsx scripts/gen-sprites.ts --approve ${gateBlocker!.id}\n` +
          `  ruim    → npx tsx scripts/gen-sprites.ts --only ${gateBlocker!.id} --force\n` +
          `Nada depois dele é gerado enquanto isso (spec §5.3).`
      )
      break
    }

    if (existsSync(out) && !flags.force) {
      console.log(`· ${piece.id} — já existe, pulando (use --force para regerar)`)
      continue
    }

    const missingRef = piece.refs.find((r) => !existsSync(rawPath(r)))
    if (missingRef) {
      console.log(`! ${piece.id} — referência "${missingRef}" ainda não existe, pulando`)
      continue
    }

    const prompt = buildPrompt(piece, m)
    console.log(`\n▸ ${piece.id}  (${piece.cell}, refs: ${piece.refs.join(', ') || 'nenhuma'})`)

    if (flags['dry-run']) {
      console.log(prompt.replace(/^/gm, '    '))
      continue
    }

    const refs = piece.refs.map((r) => readFileSync(rawPath(r)))
    const t0 = Date.now()
    const png = await generate(prompt, refs, { model, size, key })
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, png)
    generated++
    console.log(`  ok — ${(png.length / 1024).toFixed(0)} KB em ${((Date.now() - t0) / 1000).toFixed(1)}s → ${m.rawDir}/${piece.id}.png`)

    if (piece.gate && !isApproved(piece.id)) {
      console.log(
        `\nPORTÃO: avalie ${m.rawDir}/${piece.id}.png antes de seguir.\n` +
          `  npx tsx scripts/gen-sprites.ts --approve ${piece.id}`
      )
      break
    }
    await sleep(1200) // respiro entre chamadas
  }

  if (generated) {
    console.log(
      `\n${generated} imagem(ns) — custo aprox. US$ ${(generated * m.costPerImageUSD).toFixed(2)}.\n` +
        `Próximo passo: python scripts/spritify.py build`
    )
  }
  const pending = m.pieces.filter((p) => !existsSync(rawPath(p.id))).map((p) => p.id)
  if (pending.length) console.log(`pendentes: ${pending.join(', ')}`)
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`\nerro: ${msg}`)
  if (msg.startsWith('429')) {
    console.error(
      'Geração de imagem não tem free tier (spec §5.3): a chave precisa estar num projeto\n' +
        'com billing ativo. Console → Billing, e confira a cota de\n' +
        'generativelanguage.googleapis.com para gemini-3.1-flash-lite-image.'
    )
  }
  process.exit(1)
})
