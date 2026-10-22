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
    assert.equal(janela.codigo, 202); assert.equal(janela.corpo.metodo, 'janela-recente')
    assert.deepEqual((chamadas[1] as any[])[1], { remoteJid: '5511999990001@s.whatsapp.net' })
    await h.consultar(req('1199990000', segredo, { audio: true }), res())
    h.receber({ messages: [{ key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'audio-1', fromMe: false }, messageTimestamp: 1792238300, message: { audioMessage: { seconds: 12, mimetype: 'audio/ogg' } } }] })
    const audio = res(); await h.audio(req('1199990000', segredo, { id: 'audio-1' }), audio)
    assert.equal(audio.codigo, 200); assert.equal(Buffer.from(audio.corpo.base64, 'base64').toString(), 'audio-teste')
    const outro = res(); await h.audio(req('2199990000', segredo, { id: 'audio-1' }), outro); assert.equal(outro.codigo, 404)
  } finally { await fs.rm(home, { recursive: true, force: true }) }
})

it('resolve o formato real da sessão, preserva saídas de outro aparelho e aceita histórico atrasado sem renovar o pedido', async () => {
  const { createSquadoneHistory, chaveDoNumero } = await import(pathToFileURL(path.resolve('deploy/hermes/scripts/squadone_history.mjs')).href)
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'squadone-historico-multisessao-'))
  try {
    for (const d of ['.config/claude-ops', '.local/state/whatsapp-observador', '.local/share/squadone-operations', 'session']) await fs.mkdir(path.join(home, d), { recursive: true })
    const segredo = 'segredo-de-teste-multisessao'
    const chave = '1199990000', jidReal = '551199990000@s.whatsapp.net'
    await fs.writeFile(path.join(home, '.config/claude-ops/whatsapp-observador-segredo'), segredo)
    await fs.writeFile(path.join(home, '.local/state/whatsapp-observador/leads.json'), JSON.stringify([chave]))
    const arquivo = path.join(home, '.local/share/squadone-operations/historico-ancoras.json')
    await fs.writeFile(arquivo, JSON.stringify({ [chave]: [{ jid: '5511999990000@s.whatsapp.net', id: 'id-real-anterior', ts: 1792238400, fromMe: true }] }))
    await fs.writeFile(path.join(home, 'session/lid-mapping-987654321_reverse.json'), JSON.stringify('551199990000'))
    let agora = 1792238500000
    const chamadas: any[] = [], lotes: any[] = []
    const h = createSquadoneHistory({ home, session: path.join(home, 'session'), agora: () => agora,
      getSocket: () => ({ fetchMessageHistory: (...args: any[]) => { chamadas.push(args); return Promise.resolve() } }),
      getContent: (m: any) => m.message,
      arquivar: (lote: any[]) => { lotes.push(lote); return { status: 0, stdout: JSON.stringify({ gravadas: lote.length }) } } })
    const req = (extra = {}) => ({ body: { chave, ...extra }, headers: { 'x-observador': segredo } })
    const res = () => ({ codigo: 200, corpo: null as any, status(codigo: number) { this.codigo = codigo; return this }, json(corpo: any) { this.corpo = corpo; return this } })
    const recente = res(); await h.consultar(req({ numero: '5511999990000' }), recente)
    assert.equal(recente.corpo.metodo, 'janela-recente')
    assert.equal(chamadas[0][1].remoteJid, jidReal, 'não usa o nono dígito que a sessão não reconhece')
    assert.equal(chamadas[0][1].id, undefined, 'não usa âncora antiga para buscar respostas posteriores à desconexão')
    assert.equal(chamadas[0][2], agora)
    assert.equal(chaveDoNumero('551199990000:12@s.whatsapp.net'), chave)
    h.observar({ messages: [
      { key: { remoteJid: '987654321@lid', id: 'saida-outro-aparelho', fromMe: true }, messageTimestamp: 1792238450, message: { conversation: 'Mensagem da nossa conta' } },
      { key: { remoteJid: '123456@g.us', remoteJidAlt: jidReal, id: 'grupo-nao-e-lead', fromMe: false }, messageTimestamp: 1792238490 },
    ] })
    const gravado = JSON.parse(await fs.readFile(arquivo, 'utf8'))
    assert.equal(gravado[chave][0].id, 'saida-outro-aparelho')
    assert.equal(gravado[chave][0].jid, '987654321@lid')
    assert.equal(gravado[chave][0].fromMe, true)
    assert.ok(!JSON.stringify(gravado).includes('grupo-nao-e-lead'))
    agora += 121_000
    h.receber({ messages: [
      { key: { remoteJid: '987654321@lid', id: 'grok-saida', fromMe: true }, messageTimestamp: 1792238401, message: { conversation: 'Retomando o assunto anterior' } },
      { key: { remoteJid: jidReal, id: 'menu', fromMe: false }, messageTimestamp: 1792238402, message: { listMessage: { description: 'Atendimento automático', footerText: 'Equipe virtual', buttonText: 'Escolha uma opção' } } },
      { key: { remoteJid: jidReal, id: 'sem-direcao' }, messageTimestamp: 1792238403, message: { conversation: 'Não presumir entrada' } },
      { key: { remoteJid: jidReal, id: 'configuracao', fromMe: false }, messageTimestamp: 1792238404, message: { protocolMessage: { type: 3 } } },
    ] })
    assert.equal(lotes.length, 1)
    assert.deepEqual(lotes[0].map((m: any) => m.direcao), ['saida', 'entrada'])
    for (const parte of ['Atendimento automático', 'Equipe virtual', 'Escolha uma opção']) assert.ok(lotes[0][1].texto.includes(parte))
    agora += 600_000
    const estado = res(); await h.consultar(req({ somenteConsultar: true }), estado)
    assert.equal(chamadas.length, 1, 'consultar resultado não envia outro pedido ao celular')
    assert.equal(estado.corpo.recebidas, 2)
    assert.equal(estado.corpo.mensagensRecebidas, 3)
    assert.equal(estado.corpo.mensagensSemTexto, 1)
    assert.equal(estado.corpo.diagnostico.solicitadas, 3)
    assert.equal(estado.corpo.diagnostico.semTextoPorFormato.protocolo, 1)
  } finally { await fs.rm(home, { recursive: true, force: true }) }
})
