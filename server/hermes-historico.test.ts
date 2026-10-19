import assert from 'node:assert/strict'
import { it } from 'node:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

it('consulta na conexão existente: autentica, filtra leads, usa âncora real e só arquiva retornos solicitados', async () => {
  const { createSquadoneHistory } = await import(pathToFileURL(path.resolve('deploy/hermes/scripts/squadone_history.mjs')).href)
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'squadone-hermes-historico-'))
  try {
    for (const d of ['.config/claude-ops', '.local/state/whatsapp-observador', '.local/share/squadone-operations', 'session']) await fs.mkdir(path.join(home, d), { recursive: true })
    const segredo = 'segredo-apenas-de-teste-123'
    await fs.writeFile(path.join(home, '.config/claude-ops/whatsapp-observador-segredo'), segredo)
    await fs.writeFile(path.join(home, '.local/state/whatsapp-observador/leads.json'), JSON.stringify(['1199990000', '1199990001']))
    await fs.writeFile(path.join(home, '.local/share/squadone-operations/historico-ancoras.json'), JSON.stringify({ '1199990000': [{ jid: '5511999990000@s.whatsapp.net', id: 'real-123', ts: 1792238400, fromMe: true }] }))
    const chamadas: unknown[] = [], lotes: any[] = []
    const h = createSquadoneHistory({ home, session: path.join(home, 'session'), getSocket: () => ({ fetchMessageHistory: (...args: unknown[]) => { chamadas.push(args); return Promise.resolve('pedido') } }), getContent: (m: any) => m.message, baixarAudio: async () => Buffer.from('audio-teste'), arquivar: (lote: any[]) => { lotes.push(lote); return { status: 0, stdout: JSON.stringify({ gravadas: lote.length }) } } })
    const req = (chave: string, token = segredo, extra = {}) => ({ body: { chave, ...extra }, headers: { 'x-observador': token } })
    const res = () => ({ codigo: 200, corpo: null as any, status(codigo: number) { this.codigo = codigo; return this }, json(corpo: any) { this.corpo = corpo; return this } })
    const negado = res(); await h.consultar(req('1199990000', 'errado'), negado); assert.equal(negado.codigo, 403)
    const fora = res(); await h.consultar(req('2199990000'), fora); assert.equal(fora.codigo, 404)
    const sem = res(); await h.consultar(req('1199990001'), sem); assert.equal(sem.codigo, 409)
    const aceito = res(); await h.consultar(req('1199990000'), aceito); assert.equal(aceito.codigo, 202); assert.equal(aceito.corpo.recebidas, 0)
    assert.deepEqual(chamadas, [[50, { remoteJid: '5511999990000@s.whatsapp.net', id: 'real-123', fromMe: true }, 1792238400000]])
    h.receber({ messages: [
      { key: { remoteJid: '5511999990000@s.whatsapp.net', id: '1', fromMe: false }, messageTimestamp: 1792238300, message: { conversation: 'Pode mandar' } },
      { key: { remoteJid: '5521999990000@s.whatsapp.net', id: '2' }, messageTimestamp: 1792238300, message: { conversation: 'Particular' } },
      { key: { remoteJid: '5511999990001@s.whatsapp.net', id: '3' }, messageTimestamp: 1792238300, message: { conversation: 'Não foi solicitado' } },
    ] })
    assert.equal(lotes.length, 1); assert.equal(lotes[0].length, 1); assert.equal(lotes[0][0].direcao, 'entrada')
    const retorno = res(); await h.consultar(req('1199990000'), retorno); assert.equal(retorno.corpo.recebidas, 1); assert.equal(retorno.corpo.gravadas, 1); assert.equal(chamadas.length, 1)
    const janela = res(); await h.consultar(req('1199990001', segredo, { numero: '5511999990001' }), janela)
    assert.equal(janela.codigo, 202); assert.equal(janela.corpo.metodo, 'janela-sem-id')
    assert.deepEqual((chamadas[1] as any[])[1], { remoteJid: '5511999990001@s.whatsapp.net' })
    await h.consultar(req('1199990000', segredo, { audio: true }), res())
    h.receber({ messages: [{ key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'audio-1', fromMe: false }, messageTimestamp: 1792238300, message: { audioMessage: { seconds: 12, mimetype: 'audio/ogg' } } }] })
    const audio = res(); await h.audio(req('1199990000', segredo, { id: 'audio-1' }), audio)
    assert.equal(audio.codigo, 200); assert.equal(Buffer.from(audio.corpo.base64, 'base64').toString(), 'audio-teste')
    const outro = res(); await h.audio(req('2199990000', segredo, { id: 'audio-1' }), outro); assert.equal(outro.codigo, 404)
  } finally { await fs.rm(home, { recursive: true, force: true }) }
})
