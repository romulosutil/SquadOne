#!/usr/bin/env python3
"""Remenda a bridge do WhatsApp do Hermes com a leitura dirigida do histórico de UM lead.

O que faz (idempotente, com backup em ~/.local/share/claude-ops/backups/historico-hermes-*):
- no bridge.js (~/.hermes/hermes-agent/scripts/whatsapp-bridge) liga o evento `messaging-history.set` e as rotas
  POST /squadone/historico e /squadone/historico/audio, marcadas por `// squadone:historico`;
- copia squadone_history.mjs para a pasta da bridge (a lógica: só lê, nunca envia, nunca marca como lida, só chaves
  da lista de leads do observador, segredo em ~/.config/claude-ops/whatsapp-observador-segredo);
- instala squadone-historico-arquivar em ~/.local/bin (ele grava o retorno do aparelho na conversa do lead, com
  origem `hermes-historico`, usando a classe Conversas do whatsapp-observador instalado; nunca chama n8n).

Quem consome: o bloco de histórico da Ficha (CrmHistorico.vue, POST /api/operations/crm/historico em server/operations.ts) chama
http://127.0.0.1:3000/squadone/historico na bridge; conferir-historicos.py (deploy/dell/whatsapp-observador) é o
leitor manual em lote.

Um `hermes update` troca o bridge.js e leva o remendo junto: a rota da Central passa a dar 503 sem aviso. Por isso o
aplicar-hermes.py chama este script e confere a marca no bridge.js. Aplicar não reinicia o Hermes (o aplicar-hermes
reinicia o gateway no fim).
"""
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

home = Path.home()
pasta = home / '.hermes/hermes-agent/scripts/whatsapp-bridge'
bridge = pasta / 'bridge.js'
s = bridge.read_text()
original = s
if '// squadone:historico' not in s:
    imports = "import express from 'express';"
    evento = "  sock.ev.on('messages.upsert', async ({ messages, type }) => {"
    rota = "// Poll for new messages (long-poll style)"
    if any(s.count(a) != 1 for a in (imports, evento, rota)):
        raise SystemExit('Bridge incompatível: nenhuma mudança aplicada.')
    s = s.replace(imports, imports + "\nimport { createSquadoneHistory } from './squadone_history.mjs'; // squadone:historico")
    s = s.replace(evento, "  sock.ev.on('messaging-history.set', (lote) => squadoneHistory().receber(lote)); // squadone:historico\n" + evento)
    bloco = """// squadone:historico — só leitura, lista de leads e segredo do observador.
let squadoneHistoryInstance;
function squadoneHistory() {
  return squadoneHistoryInstance ??= createSquadoneHistory({ home: process.env.HOME, session: SESSION_DIR, getSocket: () => sock, getContent: getMessageContent });
}
app.post('/squadone/historico', (req, res) => squadoneHistory().consultar(req, res));

"""
    s = s.replace(rota, bloco + rota)
s = s.replace('getContent: getMessageContent });', "getContent: getMessageContent, baixarAudio: (msg) => downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: (m) => sock.updateMediaMessage(m) }) });")
if '// squadone:historico-ancoras' not in s:
    evento = "  sock.ev.on('messages.upsert', async ({ messages, type }) => {"
    if s.count(evento) != 1:
        raise SystemExit('Bridge incompatível: captura de âncoras não aplicada.')
    s = s.replace(evento, evento + "\n    squadoneHistory().observar({ messages }); // squadone:historico-ancoras")
if "app.post('/squadone/historico/audio'" not in s:
    s = s.replace("app.post('/squadone/historico',", "app.post('/squadone/historico/audio', (req, res) => squadoneHistory().audio(req, res));\napp.post('/squadone/historico',")
if s != original:
    # O Node do Hermes muda de versão em cada atualização: pega o mais novo que houver, e o do PATH se não houver.
    nodes = sorted((home / '.hermes/tools').glob('node-*/bin/node'))
    node = nodes[-1] if nodes else Path(shutil.which('node') or 'node')
    with tempfile.NamedTemporaryFile(suffix='.mjs', mode='w') as f:
        f.write(s); f.flush()
        subprocess.run([str(node), '--check', f.name], check=True)
    backup = home / '.local/share/claude-ops/backups' / ('historico-hermes-' + time.strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(bridge, backup / 'bridge.js')
    bridge.write_text(s)
    print('Bridge atualizada; backup:', backup)
else:
    print('Leitura dirigida já instalada.')
shutil.copy2(Path(__file__).with_name('squadone_history.mjs'), pasta / 'squadone_history.mjs')
destino = home / '.local/bin/squadone-historico-arquivar'
shutil.copy2(Path(__file__).with_name('squadone-historico-arquivar.py'), destino)
destino.chmod(0o700)
