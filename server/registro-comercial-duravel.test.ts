import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RegistroComercialDuravel, RegistroComercialBloqueado, RegistroComercialConflitante, hashCanonicoComercial, type ChaveComercial, type FonteComercialReal } from './registro-comercial-duravel.ts'

const agora = new Date('2026-10-24T03:00:00Z')
const em = '2026-10-24T02:00:00Z'
const chave = (id = 'fato-1', oportunidade = 'site:ficticio'): ChaveComercial => ({ oportunidade, id, hash: hashCanonicoComercial({ id, valor: 100 }) })
const entrada = (id = 'fato-1', oportunidade = 'site:ficticio') => ({ ...chave(id, oportunidade), tentativaEm: em })
async function fixture(usar: (arquivo: string, dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'registro-comercial-teste-'))
  try { await usar(path.join(dir, 'privado', 'journal.json'), dir) }
  finally { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); await fs.rm(dir, { recursive: true, force: true }) }
}
async function processo(args: string[]) {
  const p = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  p.stdout.on('data', b => { stdout += b }); p.stderr.on('data', b => { stderr += b })
  const code = await new Promise<number | null>((resolve, reject) => { p.once('error', reject); p.once('close', resolve) })
  assert.equal(code, 0, stderr)
  return { pid: p.pid!, stdout }
}

test('hash canônico preserva valores e ignora somente ordem de chaves, inclusive aninhadas', () => {
  assert.equal(hashCanonicoComercial({ b: [1, { z: true, a: 'sim' }], a: 2 }), hashCanonicoComercial({ a: 2, b: [1, { a: 'sim', z: true }] }))
  assert.notEqual(hashCanonicoComercial({ valor: 100 }), hashCanonicoComercial({ valor: 101 }))
  assert.notEqual(hashCanonicoComercial([1, 2]), hashCanonicoComercial([2, 1]))
  for (const v of [undefined, NaN, Infinity, { campo: undefined }, new Date(), [undefined]]) assert.throws(() => hashCanonicoComercial(v))
  const ciclo: { valor?: object } = {}; ciclo.valor = ciclo
  assert.throws(() => hashCanonicoComercial(ciclo))
})

test('reserva concede uma única tentativa e reinício não autoriza repetir POST', async () => fixture(async arquivo => {
  const journal = new RegistroComercialDuravel(arquivo)
  assert.equal((await journal.reservar(entrada())).criada, true)
  assert.equal((await journal.reservar(entrada())).criada, false)
  const reiniciado = new RegistroComercialDuravel(arquivo)
  const repetido = await reiniciado.reservar(entrada())
  assert.equal(repetido.criada, false)
  assert.equal(repetido.registro.estado, 'pendente')
}))

test('ACK persiste aguardando projeção e bloqueia outra operação da oportunidade', async () => fixture(async arquivo => {
  const journal = new RegistroComercialDuravel(arquivo)
  await journal.reservar(entrada())
  const ack = await journal.confirmar({ ...chave(), em })
  assert.equal(ack.estado, 'aguardando_projecao')
  assert.equal(ack.fonteEm, undefined)
  await assert.rejects(journal.reservar(entrada('fato-2')), RegistroComercialBloqueado)
  assert.equal((await new RegistroComercialDuravel(arquivo).reservar(entrada())).criada, false)
}))

test('pendência ambígua não expira nem se resolve por ausência na fonte', async () => fixture(async arquivo => {
  const journal = new RegistroComercialDuravel(arquivo)
  await journal.reservar(entrada())
  await journal.marcarAmbiguo(chave())
  await journal.reconciliar({ origem: 'aba-crm', registros: [] }, new Date('2099-01-01T00:00:00Z'))
  assert.equal((await journal.listar())[0].estado, 'ambiguo')
  assert.equal((await journal.reservar(entrada())).criada, false)
  await assert.rejects(journal.reservar(entrada('fato-2')), RegistroComercialBloqueado)
}))

test('somente fonte real exata projeta, libera próximo fato e conserva tombstone do anterior', async () => fixture(async arquivo => {
  const journal = new RegistroComercialDuravel(arquivo)
  await journal.reservar(entrada())
  await journal.confirmar({ ...chave(), em })
  const [projetado] = await journal.reconciliar({ origem: 'aba-crm', registros: [{ ...chave(), em }] }, agora)
  assert.equal(projetado.estado, 'projetado')
  assert.equal(projetado.fonteEm, em)
  assert.equal(projetado.projetadoEm, agora.toISOString())
  assert.equal((await journal.reservar(entrada('fato-2'))).criada, true)
  assert.equal((await journal.reservar(entrada())).criada, false)
  assert.equal((await journal.confirmar({ ...chave(), em })).estado, 'projetado', 'ACK atrasado não desfaz projeção')
  assert.equal((await journal.marcarAmbiguo(chave())).estado, 'projetado')
}))

test('mesmo ID com outro hash é conflito em reserva, ACK e fonte; nada é alterado', async () => fixture(async arquivo => {
  const journal = new RegistroComercialDuravel(arquivo)
  await journal.reservar(entrada())
  const antes = await fs.readFile(arquivo, 'utf8'), outro = { ...chave(), hash: hashCanonicoComercial({ outro: true }) }
  await assert.rejects(journal.reservar({ ...outro, tentativaEm: em }), RegistroComercialConflitante)
  await assert.rejects(journal.confirmar({ ...outro, em }), RegistroComercialConflitante)
  await assert.rejects(journal.reconciliar({ origem: 'aba-crm', registros: [{ ...outro, em }] }, agora), RegistroComercialConflitante)
  assert.equal(await fs.readFile(arquivo, 'utf8'), antes)
}))

test('fonte já existente é reconhecida sem reserva prévia nem append duplicado', async () => fixture(async arquivo => {
  const journal = new RegistroComercialDuravel(arquivo)
  const fonte = { origem: 'aba-crm' as const, registros: [{ ...chave(), em }] }
  await journal.reconciliar(fonte, agora)
  await journal.reconciliar(fonte, agora)
  assert.equal((await journal.reservar(entrada())).criada, false)
  assert.equal((await journal.listar()).length, 1)
}))

test('reconciliação rejeita origem otimista, data futura e conflito entre linhas da fonte', async () => fixture(async arquivo => {
  const journal = new RegistroComercialDuravel(arquivo)
  await journal.reservar(entrada())
  const antes = await fs.readFile(arquivo, 'utf8')
  await assert.rejects(journal.reconciliar({ origem: 'ui', registros: [{ ...chave(), em }] } as unknown as FonteComercialReal, agora), /fonte comercial real/)
  await assert.rejects(journal.reconciliar({ origem: 'aba-crm', registros: [{ ...chave(), em: '2099-01-01T00:00:00Z' }] }, agora), /data/)
  await assert.rejects(journal.reconciliar({ origem: 'aba-crm', registros: [{ ...chave(), em }, { ...chave(), hash: 'f'.repeat(64), em }] }, agora), RegistroComercialConflitante)
  assert.equal(await fs.readFile(arquivo, 'utf8'), antes)
}))

test('concorrência na mesma oportunidade concede uma reserva; oportunidades distintas são independentes', async () => fixture(async arquivo => {
  const a = new RegistroComercialDuravel(arquivo), b = new RegistroComercialDuravel(arquivo)
  const respostas = await Promise.allSettled([a.reservar(entrada()), b.reservar(entrada('fato-2'))])
  assert.equal(respostas.filter(r => r.status === 'fulfilled' && r.value.criada).length, 1)
  assert.equal(respostas.filter(r => r.status === 'rejected' && r.reason instanceof RegistroComercialBloqueado).length, 1)
  const outra = await b.reservar(entrada('fato-3', 'prumo:outro-ficticio'))
  assert.equal(outra.criada, true)
  assert.equal((await a.listar()).length, 2)
}))

test('trava de processo vivo e trava ilegível permanecem fechadas', async () => fixture(async arquivo => {
  await fs.mkdir(path.dirname(arquivo), { recursive: true })
  const journal = new RegistroComercialDuravel(arquivo, { tentativas: 2, esperaMs: 1 })
  for (const conteudo of [JSON.stringify({ pid: process.pid, token: 'vivo' }), '{']) {
    await fs.writeFile(arquivo + '.lock', conteudo)
    await assert.rejects(journal.reservar(entrada()), /trava/)
    assert.equal(await fs.readFile(arquivo + '.lock', 'utf8'), conteudo)
  }
}))

test('trava abandonada só é retirada após comprovar que o PID morreu', async () => fixture(async arquivo => {
  const filho = await processo(['-e', 'process.exit(0)'])
  assert.throws(() => process.kill(filho.pid, 0), (e: NodeJS.ErrnoException) => e.code === 'ESRCH')
  await fs.mkdir(path.dirname(arquivo), { recursive: true })
  await fs.writeFile(arquivo + '.lock', JSON.stringify({ pid: filho.pid, token: 'abandonado' }))
  assert.equal((await new RegistroComercialDuravel(arquivo).reservar(entrada())).criada, true)
}))

test('journal corrompido bloqueia e nunca é recriado como vazio', async () => fixture(async arquivo => {
  await fs.mkdir(path.dirname(arquivo), { recursive: true })
  await fs.writeFile(arquivo, '{')
  await assert.rejects(new RegistroComercialDuravel(arquivo).reservar(entrada()), /ilegível/)
  assert.equal(await fs.readFile(arquivo, 'utf8'), '{')
}))

test('arquivo privado é gravado atomicamente e não deixa temporários', async () => fixture(async arquivo => {
  await new RegistroComercialDuravel(arquivo).reservar(entrada())
  if (process.platform !== 'win32') assert.equal((await fs.stat(arquivo)).mode & 0o777, 0o600)
  assert.deepEqual(await fs.readdir(path.dirname(arquivo)), ['journal.json'])
  assert.equal(JSON.parse(await fs.readFile(arquivo, 'utf8')).versao, 1)
}))

test('dois processos também não recebem permissão para POST da mesma oportunidade', async () => fixture(async (arquivo, dir) => {
  const script = path.join(dir, 'reserva.mts')
  const modulo = new URL('./registro-comercial-duravel.ts', import.meta.url).href
  await fs.writeFile(script, `import {RegistroComercialDuravel,hashCanonicoComercial} from ${JSON.stringify(modulo)}; const id=process.argv[3]; try { const r=await new RegistroComercialDuravel(process.argv[2]).reservar({oportunidade:'site:ficticio',id,hash:hashCanonicoComercial({id}),tentativaEm:${JSON.stringify(em)}});console.log(JSON.stringify({criada:r.criada})); } catch(e) { if(e.name==='RegistroComercialBloqueado') console.log(JSON.stringify({bloqueado:true})); else throw e; }`)
  const cli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))
  const respostas = await Promise.all([processo([cli, script, arquivo, 'um']), processo([cli, script, arquivo, 'dois'])])
  assert.equal(respostas.filter(r => JSON.parse(r.stdout).criada).length, 1)
  assert.equal(respostas.filter(r => JSON.parse(r.stdout).bloqueado).length, 1)
  assert.equal((await new RegistroComercialDuravel(arquivo).listar()).length, 1)
}))

test('recusa explícita libera só a reserva pendente; ambígua, com ACK ou projetada não se apaga', async () => fixture(async arquivo => {
  const journal = new RegistroComercialDuravel(arquivo)
  await journal.reservar(entrada())
  assert.equal(await journal.liberarNaoGravado(chave()), true)
  assert.deepEqual(await journal.listar(), [])
  assert.equal((await journal.reservar(entrada())).criada, true, 'o mesmo fato pode ser tentado de novo')
  await journal.marcarAmbiguo(chave())
  assert.equal(await journal.liberarNaoGravado(chave()), false)
  assert.equal((await journal.listar())[0].estado, 'ambiguo')
  await assert.rejects(journal.liberarNaoGravado({ ...chave(), hash: hashCanonicoComercial({ outro: true }) }), RegistroComercialConflitante)
  assert.equal(await journal.liberarNaoGravado(chave('inexistente')), false)
}))
