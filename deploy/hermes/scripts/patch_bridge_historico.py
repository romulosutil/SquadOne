#!/usr/bin/env python3
"""Instala leitura dirigida, com backup. Aplicar não reinicia o Hermes."""
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
if "app.post('/squadone/historico/audio'" not in s:
    s = s.replace("app.post('/squadone/historico',", "app.post('/squadone/historico/audio', (req, res) => squadoneHistory().audio(req, res));\napp.post('/squadone/historico',")
if s != original:
    node = home / '.hermes/tools/node-26.7.0-linux-x64/bin/node'
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
