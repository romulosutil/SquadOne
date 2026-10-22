#!/usr/bin/env python3
"""Cadastra uma base aprovada e um acesso vinculado a empresa/perfil.

Uso na Dell: python3 prumo-fonte-cliente.py --base empresa.json --perfil vendedor
O código fica em arquivo 600, nunca em URL, Git ou log. Reexecutar cria outro
acesso; cada um vence em até um ano. Para retirar um acesso, use --revogar ARQUIVO-DO-CODIGO. --validar-base nao instala nem cadastra.
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


def validar_base(arquivo):
    base = json.loads(arquivo.read_text(encoding='utf-8'))
    empresa = base.get('id', '') if isinstance(base, dict) else ''
    if not isinstance(empresa, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,60}', empresa):
        raise ValueError('ID proprio da empresa invalido')
    with tempfile.TemporaryDirectory() as pasta:
        p = Path(pasta) / (empresa + '.json')
        p.write_text(json.dumps(base), encoding='utf-8')
        # Toda ficha e todo perfil sao conferidos, mesmo que o acesso seja de um so perfil.
        for perfil in sorted(PERFIS):
            carregar_base(empresa, perfil, Path(pasta))
    return base


def operacao(caminho, corpo):
    token = (Path.home()/'.config/claude-ops/prumo-publico-token').read_text().strip()
    req = urllib.request.Request(URL+caminho, data=json.dumps(corpo).encode(),
        headers={'Authorization':'Bearer '+token, 'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=20) as resposta:
        return json.load(resposta)


def gravar_privado(destino, texto):
    destino.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, nome = tempfile.mkstemp(prefix='.'+destino.name+'-', dir=destino.parent)
    import os
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as arquivo:
            arquivo.write(texto)
            arquivo.flush()
            os.fsync(arquivo.fileno())
        Path(nome).replace(destino)
    finally:
        Path(nome).unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    escolha = ap.add_mutually_exclusive_group(required=True)
    escolha.add_argument('--base', type=Path)
    escolha.add_argument('--revogar', type=Path, metavar='ARQUIVO-DO-CODIGO')
    ap.add_argument('--perfil', choices=sorted(PERFIS))
    ap.add_argument('--dias', type=int, default=90)
    ap.add_argument('--validar-base', action='store_true')
    args = ap.parse_args()
    if args.revogar:
        if args.validar_base or args.perfil:
            ap.error('revogacao nao recebe perfil nem validacao de base')
        codigo = args.revogar.read_text().strip()
        if not codigo:
            ap.error('arquivo de acesso vazio')
        if not operacao('/operacao/acessos/revogar', {'hash':hashlib.sha256(codigo.encode()).hexdigest()}).get('revogado'):
            raise RuntimeError('Servico nao confirmou a revogacao')
        print('Acesso revogado. Novas consultas e leituras privadas desse acesso foram bloqueadas.')
        return
    if not 1 <= args.dias <= 365:
        ap.error('validade deve estar entre 1 e 365 dias')
    base = validar_base(args.base)
    empresa = base['id']
    if args.validar_base:
        print('Base estruturalmente valida em todos os perfis. Ainda requer aprovacao do conteudo pelos responsaveis.')
        return
    if not args.perfil or empresa == 'vale-norte-demo':
        ap.error('informe --perfil e ID proprio da empresa, sem sobrescrever a demonstracao')
    BASES.mkdir(parents=True, exist_ok=True, mode=0o700)
    destino = BASES / (empresa + '.json')
    if destino.exists():
        copia = BASES.parent / 'backups' / (empresa + '-' + str(int(time.time())) + '.json')
        copia.parent.mkdir(exist_ok=True, mode=0o700)
        shutil.copy2(destino, copia)
        copia.chmod(0o600)
    gravar_privado(destino, json.dumps(base, ensure_ascii=False, indent=2))
    codigo = secrets.token_urlsafe(32)
    corpo = {'hash': hashlib.sha256(codigo.encode()).hexdigest(), 'empresa': empresa,
             'perfil': args.perfil, 'expira': time.time() + args.dias*86400}
    if not operacao('/operacao/acessos', corpo).get('cadastrado'):
        raise RuntimeError('Servico nao confirmou o cadastro')
    pasta = Path.home()/'.config/prumo-fonte/clientes'
    pasta.mkdir(parents=True, exist_ok=True, mode=0o700)
    arquivo = pasta/(empresa+'-'+args.perfil+'-'+str(int(time.time()))+'.txt')
    gravar_privado(arquivo, codigo)
    print('Base instalada. Código privado guardado em '+str(arquivo))
    print('Entrada: https://prumo.services/fonte → Entrar na Fonte da sua empresa.')


if __name__ == '__main__':
    main()
