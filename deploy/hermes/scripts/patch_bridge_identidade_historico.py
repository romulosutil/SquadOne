#!/usr/bin/env python3
"""Acrescenta prova ao histórico recebido, com backup e sem alterar a sessão ou enviar mensagens."""
from pathlib import Path
import hashlib,shutil,subprocess,time

repo=Path(__file__).resolve().parents[3]
pasta=Path.home()/'.hermes/hermes-agent/scripts/whatsapp-bridge'
bridge=pasta/'bridge.js'
modulo=pasta/'squadone_history.mjs'
fonte=repo/'deploy/hermes/scripts/squadone_history.mjs'
antes="  sock.ev.on('messaging-history.set', (lote) => squadoneHistory().receber(lote)); // squadone:historico"
depois="""  // squadone:identidade-historico-v1
  const squadoneSocketDoHistorico = sock;
  sock.ev.on('messaging-history.set', (lote) => squadoneHistory().receber(lote, {socket:squadoneSocketDoHistorico,identidadeMe:state.creds.me?.id,identidadePublica:state.creds.signedIdentityKey?.public})); // squadone:historico"""
s=bridge.read_text()
if depois in s and modulo.read_bytes()==fonte.read_bytes():
    print('Prova de histórico já instalada.');raise SystemExit(0)
if s.count(antes)!=1 or '// squadone:identidade-historico-v1' in s:raise SystemExit('Bridge mudou; conferir antes de aplicar.')
if '// squadone:identidade-historico-v1' not in fonte.read_text():raise SystemExit('Módulo sem a extensão de prova.')
if (pasta/'identidade_captura.mjs').read_bytes()!=(repo/'deploy/hermes/scripts/identidade_captura.mjs').read_bytes():raise SystemExit('Validador de identidade diverge; preservar o instalado.')
backup=Path.home()/'.local/share/claude-ops/backups'/('estamparia-historico-'+time.strftime('%Y%m%d-%H%M%S'))
backup.mkdir(parents=True,mode=0o700)
for p in (bridge,modulo):shutil.copy2(p,backup/p.name)
novo=bridge.with_name('bridge.estamparia-check.mjs');novo.write_text(s.replace(antes,depois))
try:
    subprocess.run(['node','--check',str(novo)],check=True)
    subprocess.run(['node','--check',str(fonte)],check=True)
    copia=modulo.with_name('squadone_history.mjs.novo');shutil.copy2(fonte,copia);copia.replace(modulo)
    novo.replace(bridge)
finally:
    if novo.exists():novo.unlink()
print('Prova de histórico instalada com backup; a sessão existente será preservada no reinício.')
