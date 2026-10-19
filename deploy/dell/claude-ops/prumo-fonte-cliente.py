#!/usr/bin/env python3
"""Cadastra uma base aprovada e um acesso vinculado a empresa/perfil.

Uso na Dell: python3 prumo-fonte-cliente.py --base empresa.json --perfil vendedor
O código fica em arquivo 600, nunca em URL, Git ou log. Reexecutar cria outro
acesso; cada um vence em até um ano. Este script não revoga: não há --revogar.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import secrets
import shutil
import tempfile
import time
import urllib.request
from fonte_luna import BASES, carregar_base, PERFIS

URL = 'https://aladdin-prumo-automacoes.jicnzg.easypanel.host'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base', type=Path, required=True)
    ap.add_argument('--perfil', choices=sorted(PERFIS), required=True)
    ap.add_argument('--dias', type=int, default=90)
    args = ap.parse_args()
    if not 1 <= args.dias <= 365:
        ap.error('validade deve estar entre 1 e 365 dias')
    base = json.loads(args.base.read_text(encoding='utf-8'))
    empresa = base.get('id', '')
    if not isinstance(empresa, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,60}', empresa) or empresa == 'vale-norte-demo':
        ap.error('use ID próprio para a empresa, sem sobrescrever a demonstração')
    with tempfile.TemporaryDirectory() as pasta:
        p = Path(pasta) / (empresa + '.json')
        p.write_text(json.dumps(base), encoding='utf-8')
        carregar_base(empresa, args.perfil, Path(pasta))
    BASES.mkdir(parents=True, exist_ok=True, mode=0o700)
    destino = BASES / (empresa + '.json')
    if destino.exists():
        copia = BASES.parent / 'backups' / (empresa + '-' + str(int(time.time())) + '.json')
        copia.parent.mkdir(exist_ok=True, mode=0o700)
        shutil.copy2(destino, copia)
        copia.chmod(0o600)
    destino.write_text(json.dumps(base, ensure_ascii=False, indent=2), encoding='utf-8')
    destino.chmod(0o600)
    codigo = secrets.token_urlsafe(32)
    token = (Path.home()/'.config/claude-ops/prumo-publico-token').read_text().strip()
    corpo = {'hash': hashlib.sha256(codigo.encode()).hexdigest(), 'empresa': empresa,
             'perfil': args.perfil, 'expira': time.time() + args.dias*86400}
    req = urllib.request.Request(URL+'/operacao/acessos', data=json.dumps(corpo).encode(),
        headers={'Authorization':'Bearer '+token, 'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=20) as resposta:
        assert json.load(resposta).get('cadastrado')
    pasta = Path.home()/'.config/prumo-fonte/clientes'
    pasta.mkdir(parents=True, exist_ok=True, mode=0o700)
    arquivo = pasta/(empresa+'-'+args.perfil+'-'+str(int(time.time()))+'.txt')
    arquivo.write_text(codigo)
    arquivo.chmod(0o600)
    print('Base instalada. Código privado guardado em '+str(arquivo))
    print('Entrada: https://prumo.services/fonte → Entrar na Fonte da sua empresa.')


if __name__ == '__main__':
    main()
