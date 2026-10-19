/** Leitura dirigida na sessão existente. Nenhum sendMessage/readMessages/typing. */
import fs from 'node:fs'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export function chaveDoNumero(valor) {
  let d = String(valor || '').split('@')[0].replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  return d.length >= 10 && d.length <= 11 ? d.slice(0, 2) + d.slice(-8) : ''
}

export function createSquadoneHistory({ home, session, getSocket, getContent, baixarAudio, agora = Date.now, arquivar }) {
  const pedidos = new Map()
  const audios = new Map()
  const pasta = path.join(home, '.local/state/whatsapp-observador')
  const segredo = path.join(home, '.config/claude-ops/whatsapp-observador-segredo')
  const ancoras = path.join(home, '.local/share/squadone-operations/historico-ancoras.json')
  const permitidos = () => {
    const file = path.join(pasta, 'leads.json')
    if (agora() - fs.statSync(file).mtimeMs > 30 * 60_000) throw new Error('Lista de leads desatualizada.')
    const lista = new Set(JSON.parse(fs.readFileSync(file, 'utf8')))
    // Escopo finito de auditoria, gerado a partir do CRM pelo leitor manual. Não muda a captura normal.
    try {
      const leitura = JSON.parse(fs.readFileSync(path.join(home, '.local/share/squadone-operations/historico-leads.json'), 'utf8'))
      if (Math.abs(agora() - leitura.geradoEm) < 30 * 60_000 && Array.isArray(leitura.chaves)) {
        for (const chave of leitura.chaves.slice(0, 3000)) if (/^\d{10}$/.test(chave)) lista.add(chave)
      }
    } catch { /* sem auditoria em andamento */ }
    return lista
  }
  const autenticar = (valor) => {
    try { const a = Buffer.from(String(valor || '')); const b = Buffer.from(fs.readFileSync(segredo, 'utf8').trim()); return a.length === b.length && b.length > 16 && timingSafeEqual(a, b) } catch { return false }
  }
  const resolver = (key) => {
    for (const jid of [key?.remoteJidAlt, key?.remoteJid]) {
      if (String(jid).endsWith('@s.whatsapp.net')) return chaveDoNumero(jid)
      if (String(jid).endsWith('@lid')) {
        const id = String(jid).split('@')[0]
        if (!/^\d+$/.test(id)) continue
        try { const tel = JSON.parse(fs.readFileSync(path.join(session, `lid-mapping-${id}_reverse.json`), 'utf8')); return chaveDoNumero(tel) } catch { /* sem mapa não adivinha */ }
      }
    }
    return ''
  }
  function receber({ messages = [] } = {}) {
    let lista
    try { lista = permitidos() } catch { return }
    const lotes = new Map()
    for (const m of messages.slice(0, 5000)) {
      const chave = resolver(m.key)
      const pedido = pedidos.get(chave)
      if (!lista.has(chave) || !pedido || agora() - pedido.solicitadoEm > 120_000) continue
      const ts = Number(m.messageTimestamp)
      if (!Number.isFinite(ts) || ts < 1 || ts * 1000 > agora() + 300_000 || !m.key?.id) continue
      const c = getContent(m) || {}
      if (c.audioMessage && m.key.id) {
        if (audios.size >= 50) audios.delete(audios.keys().next().value)
        audios.set(`${chave}:${m.key.id}`, { m, em: agora() })
        pedido.audios = [...(pedido.audios || []).filter((a) => a.id !== m.key.id), { id: m.key.id, segundos: Number(c.audioMessage.seconds) || 0 }].slice(-10)
      }
      const texto = String(c.conversation ?? c.extendedTextMessage?.text ?? (c.audioMessage ? (Number(c.audioMessage.seconds) > 0 ? `[áudio ${Number(c.audioMessage.seconds)}s]` : '[áudio]') : c.imageMessage ? `[imagem] ${c.imageMessage.caption || ''}` : c.videoMessage ? `[vídeo] ${c.videoMessage.caption || ''}` : c.documentMessage ? `[documento] ${c.documentMessage.fileName || ''}` : '')).slice(0, 2000)
      if (!texto) continue
      const lote = lotes.get(chave) || []
      if (lote.length >= 200) continue
      lote.push({ chave, ts, direcao: m.key.fromMe ? 'saida' : 'entrada', texto, id: String(m.key.id).slice(0, 200) })
      lotes.set(chave, lote)
    }
    for (const [chave, lote] of lotes) {
      const pedido = pedidos.get(chave)
      try {
        const r = arquivar ? arquivar(lote) : spawnSync('python3', [path.join(home, '.local/bin/squadone-historico-arquivar')], { input: JSON.stringify(lote), encoding: 'utf8', timeout: 8000, maxBuffer: 100_000 })
        if (r.status !== 0) throw new Error('Falha ao arquivar o retorno.')
        const salvo = JSON.parse(r.stdout)
        pedidos.set(chave, { ...pedido, recebidoEm: agora(), recebidas: (pedido.recebidas || 0) + lote.length, gravadas: (pedido.gravadas || 0) + salvo.gravadas })
      } catch { pedidos.set(chave, { ...pedido, erro: 'O histórico retornou, mas não foi arquivado.' }) }
    }
  }
  async function consultar(req, res) {
    if (!autenticar(req.headers['x-observador'])) return res.status(403).json({ error: 'Não autorizado.' })
    const chave = req.body?.chave
    try {
      if (typeof chave !== 'string' || !/^\d{10}$/.test(chave) || !permitidos().has(chave)) return res.status(404).json({ error: 'Lead não encontrado.' })
      const anterior = pedidos.get(chave)
      if (anterior && agora() - anterior.solicitadoEm < 120_000 && !(req.body?.audio === true && !anterior.comAudio)) return res.json({ ...anterior, cobertura: 'parcial' })
      const lista = JSON.parse(fs.readFileSync(ancoras, 'utf8'))[chave] || []
      const ancora = lista.filter((a) => a.id && a.jid && Number.isFinite(a.ts)).sort((a, b) => b.ts - a.ts)[0]
      const numero = String(req.body?.numero || '')
      const semAncora = !ancora && /^55\d{10,11}$/.test(numero) && chaveDoNumero(numero) === chave
      if (!ancora && !semAncora) return res.status(409).json({ error: 'Sem identificador real nem telefone completo conferido para pedir o histórico deste lead.' })
      if (ancora && resolver({ remoteJid: ancora.jid }) !== chave) return res.status(409).json({ error: 'Identidade da âncora não conferida para este lead.' })
      const sock = getSocket()
      if (!sock?.fetchMessageHistory) return res.status(503).json({ error: 'Hermes sem conexão de histórico.' })
      if (pedidos.size >= 100) pedidos.delete(pedidos.keys().next().value)
      pedidos.set(chave, { solicitadoEm: agora(), recebidas: 0, gravadas: 0, metodo: ancora ? 'ancora-real' : 'janela-sem-id', comAudio: req.body?.audio === true })
      // Campo oldestMsgId opcional no protocolo instalado. Nunca inventa um identificador.
      await sock.fetchMessageHistory(50, ancora ? { remoteJid: ancora.jid, id: ancora.id, fromMe: ancora.fromMe } : { remoteJid: `${numero}@s.whatsapp.net` }, ancora ? ancora.ts * 1000 : agora())
      return res.status(202).json({ ...pedidos.get(chave), cobertura: 'parcial', aviso: 'Pedido enviado ao aparelho. Ainda não confirma recebimento do histórico.' })
    } catch { return res.status(503).json({ error: 'Não foi possível consultar o histórico agora.' }) }
  }
  async function audio(req, res) {
    if (!autenticar(req.headers['x-observador'])) return res.status(403).json({ error: 'Não autorizado.' })
    try {
      const { chave, id } = req.body || {}
      if (!permitidos().has(chave) || typeof id !== 'string' || id.length > 200) return res.status(404).json({ error: 'Áudio não encontrado.' })
      const salvo = audios.get(`${chave}:${id}`)
      if (!salvo || agora() - salvo.em > 30 * 60_000 || !baixarAudio) return res.status(404).json({ error: 'Áudio indisponível nesta consulta.' })
      const c = getContent(salvo.m)?.audioMessage
      if (Number(c?.seconds) > 120 || Number(c?.fileLength) > 5 * 1024 * 1024) return res.status(413).json({ error: 'Áudio ultrapassa o limite de leitura.' })
      let dados
      try { dados = await baixarAudio(salvo.m) } catch {
        // A Evolution já usa este caminho para mídia sem mensagens no banco. Tudo continua no Dell.
        const env = fs.readFileSync(path.join(home, 'workspace/evolution/.env'), 'utf8')
        const apikey = env.split('\n').find((l) => l.startsWith('EVOLUTION_APIKEY='))?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '')
        if (!apikey) throw new Error('Evolution sem chave configurada.')
        const r = await fetch('http://127.0.0.1:8081/chat/getBase64FromMediaMessage/prumo', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey }, body: JSON.stringify({ message: salvo.m, convertToMp4: false }), signal: AbortSignal.timeout(20_000) })
        if (!r.ok) throw new Error('Evolution não devolveu a mídia.')
        const corpo = await r.json()
        if (typeof corpo.base64 !== 'string' || corpo.base64.length > 7_000_000) throw new Error('Mídia inválida.')
        dados = Buffer.from(corpo.base64.replace(/^data:[^,]+,/, ''), 'base64')
      }
      if (!Buffer.isBuffer(dados) || dados.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Áudio ultrapassa o limite de leitura.' })
      return res.json({ base64: dados.toString('base64'), mimetype: c?.mimetype || 'audio/ogg' })
    } catch { return res.status(503).json({ error: 'Não foi possível baixar este áudio.' }) }
  }
  return { receber, consultar, audio }
}
