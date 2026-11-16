#!/usr/bin/env python3
"""Private read-only production inventory/backup. Run on Mel, never prints secrets."""
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tarfile


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def main():
    home = Path.home()
    repo = home / 'SquadOne'
    stamp = dt.datetime.now().astimezone().strftime('%Y%m%d-%H%M%S')
    root = home / '.local/share/prumo-releases' / ('execucao-' + stamp)
    root.mkdir(parents=True, mode=0o700)
    os.chmod(root, 0o700)
    manifest = {'criadoEm': dt.datetime.now().astimezone().isoformat(), 'release': str(root),
                'commit': run('git', '-C', str(repo), 'rev-parse', 'HEAD'),
                'node': run('node', '--version'), 'python': run('python3', '--version'),
                'grok': 'fora do escopo: Rômulo fará a configuração diretamente',
                'arquivos': {}}
    with tarfile.open(root / 'fontes-build.tar.gz', 'w:gz') as tar:
        for name in ('server', 'src', 'deploy', 'ops', 'scripts', 'dist', 'public',
                     'server.ts', 'package.json', 'bun.lock', 'tsconfig.json', 'vite.config.ts'):
            p = repo / name
            if p.exists():
                tar.add(p, arcname=name, filter=lambda t: None if '__pycache__' in t.name or 'node_modules' in t.name else t)
    with tarfile.open(root / 'estado-privado.tar.gz', 'w:gz') as tar:
        for rel in ('.config/squadone', '.local/share/squadone-operations', '.local/share/n8n-estado', '.local/share/claude-ops'):
            p = home / rel
            if p.exists():
                tar.add(p, arcname=rel, filter=lambda t: None if t.name.endswith(('.sqlite', '.sqlite-wal', '.sqlite-shm', '.db', '.db-wal', '.db-shm')) else t)
    db = home / '.local/share/frente-comercial/registro.sqlite'
    if db.exists():
        with sqlite3.connect(f'file:{db}?mode=ro', uri=True) as src, sqlite3.connect(root / 'frente-registro.sqlite') as dest:
            src.backup(dest)
    import sys
    sys.path.insert(0, str(home / '.local/share/claude-ops'))
    import n8n
    workflows = n8n.api('GET', '/workflows?limit=250')['data']
    saved = []
    wfdir = root / 'workflows'
    wfdir.mkdir(mode=0o700)
    for workflow in workflows:
        full = n8n.api('GET', '/workflows/' + workflow['id'])
        (wfdir / (workflow['id'] + '.json')).write_text(json.dumps(full, ensure_ascii=False), encoding='utf-8')
        saved.append({'id': workflow['id'], 'nome': workflow['name'], 'ativo': workflow['active'],
                      'versionId': full.get('versionId'), 'activeVersionId': full.get('activeVersionId')})
    manifest['workflows'] = saved
    manifest['servicos'] = run('systemctl', '--user', 'list-timers', '--all', '--no-pager')
    manifest['dirty'] = run('git', '-C', str(repo), 'status', '--short')
    for p in root.rglob('*'):
        if p.is_file():
            os.chmod(p, 0o600)
            manifest['arquivos'][str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
    (root / 'manifesto.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    os.chmod(root / 'manifesto.json', 0o600)
    print(json.dumps({'release': str(root), 'commit': manifest['commit'], 'node': manifest['node'],
                      'python': manifest['python'], 'workflows': saved, 'backupArquivos': len(manifest['arquivos'])}, ensure_ascii=False))


if __name__ == '__main__':
    main()
