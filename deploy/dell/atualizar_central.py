#!/usr/bin/env python3
"""Atualização conservadora: valida um commit em staging antes de fast-forward.

Nunca força reinício ocupado, nem produz avisos. Falha fecha a aquisição.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path.home() / 'SquadOne'
DATA = Path.home() / '.local/share/squadone-operations'
STATE = Path.home() / '.local/state/atualizar-central'
API = 'http://127.0.0.1:9120'
TIMERS = ('frente-comercial.timer', 'prospeccao-diaria.timer')
SERVICES = ('frente-comercial.service', 'prospeccao-diaria.service')

class Bloqueado(RuntimeError):
    pass

def cmd(*args, cwd=None, capture=True, env=None):
    r = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=capture, check=False)
    if r.returncode:
        raise Bloqueado('Falhou: ' + args[0] + ' ' + (args[1] if len(args) > 1 else ''))
    return r.stdout.strip() if capture else ''

def ler_api(path):
    try:
        with urllib.request.urlopen(API + path, timeout=30 if path == '/api/operations/crm/frente' else 5) as r:
            if r.status != 200: raise Bloqueado('API indisponível')
            v = json.load(r)
        if not isinstance(v, dict): raise Bloqueado('API sem objeto válido')
        return v
    except (OSError, ValueError, urllib.error.URLError) as exc:
        raise Bloqueado('API indisponível ou inválida') from exc

def arquivo_desligado(name):
    try:
        obj = json.loads((DATA / name).read_text(encoding='utf8'))
        return isinstance(obj, dict) and obj.get('ativo') is False
    except (OSError, ValueError):
        return False

def guardas():
    for timer in TIMERS:
        if cmd('systemctl','--user','show',timer,'-p','UnitFileState','--value') != 'disabled':
            raise Bloqueado('Timer não está desabilitado: ' + timer)
        # is-active retorna 3 para inactive; usar show para não confundir código com estado.
        if cmd('systemctl','--user','show',timer,'-p','ActiveState','--value') != 'inactive':
            raise Bloqueado('Timer não está inativo: ' + timer)
    for unit in SERVICES:
        if cmd('systemctl','--user','show',unit,'-p','ActiveState','--value') != 'inactive':
            raise Bloqueado('Serviço não está inativo: ' + unit)
    if not all(arquivo_desligado(x) for x in ('frente-comercial-config.json','campanha-site-ativa.json')):
        raise Bloqueado('Frente ou campanha ausente, inválida ou ativa')
    frente = ler_api('/api/operations/crm/frente')
    aquisicao = frente.get('aquisicao')
    if not isinstance(aquisicao, dict) or aquisicao.get('estado') != 'bloqueada' or aquisicao.get('primeirosContatosAutomaticos') is not False:
        raise Bloqueado('Trava de aquisição não foi comprovada')
    if 'proximoEnvioEm' not in frente or frente['proximoEnvioEm'] is not None:
        raise Bloqueado('Próximo envio automático não está comprovadamente suspenso')

def ocioso():
    if ler_api('/api/runtime').get('ocupado') is not False:
        raise Bloqueado('Central ocupada ou estado de ocupação não comprovado')

def git(*args):
    return cmd('git', *args, cwd=ROOT)

def dependencias_mudaram(alterados, construido, alvo):
    locks={'package-lock.json','npm-shrinkwrap.json','bun.lock','bun.lockb'}
    if 'sem-base' in alterados or not construido or any(p in locks for p in alterados): return True
    if 'package.json' not in alterados: return False
    try:
        anterior=json.loads(git('show',construido+':package.json'))
        candidato=json.loads(git('show',alvo+':package.json'))
        if not isinstance(anterior,dict) or not isinstance(candidato,dict): return True
        campos=('dependencies','devDependencies','optionalDependencies','peerDependencies','overrides','engines')
        return any(anterior.get(k,{}) != candidato.get(k,{}) for k in campos)
    except (Bloqueado,ValueError,TypeError):
        return True

def construir(stage, target, dependencias=False, somente_docs=False):
    archive = subprocess.run(['git','archive','--format=tar',target],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=False)
    if archive.returncode: raise Bloqueado('Não foi possível gerar estágio do commit')
    # O tar é apenas do commit local; rejeitar caminhos ou links que escapam do estágio.
    import io
    with tarfile.open(fileobj=io.BytesIO(archive.stdout),mode='r:') as tar:
        for item in tar.getmembers():
            if item.issym() or item.islnk() or item.name.startswith('/') or '..' in Path(item.name).parts:
                raise Bloqueado('Commit contém caminho ou link não permitido no estágio')
        tar.extractall(stage)
    deps=ROOT/'node_modules'
    if not deps.is_dir(): raise Bloqueado('Dependências locais ausentes')
    if dependencias:
        if (stage/'package-lock.json').is_file() or (stage/'npm-shrinkwrap.json').is_file():
            cmd('npm','ci','--no-audit','--no-fund',cwd=stage,capture=False)
        else:
            cmd('npm','install','--no-package-lock','--no-audit','--no-fund',cwd=stage,capture=False)
    else:
        (stage/'node_modules').symlink_to(deps, target_is_directory=True)
    env=os.environ.copy()
    # A Central já carrega .env no build; só a variável VITE é necessária ao frontend.
    config=ROOT/'.env'
    if not config.is_file(): raise Bloqueado('Configuração de build ausente')
    for linha in config.read_text(encoding='utf8').splitlines():
        k, sep, v=linha.partition('=')
        if sep and k.strip() == 'VITE_GOOGLE_CLIENT_ID': env[k.strip()]=v.strip().strip('"\'')
    if not env.get('VITE_GOOGLE_CLIENT_ID'): raise Bloqueado('Configuração pública do build incompleta')
    cmd('npm','run','test:aquisicao',cwd=stage,capture=False,env=env)
    if somente_docs: return
    cmd(str(stage/'node_modules/.bin/tsx'),'--test','server/lead-quente-sombra.test.ts','server/roster-historico.test.ts',cwd=stage,capture=False,env=env)
    cmd('npm','run','test:envios',cwd=stage,capture=False,env=env)
    cmd('npm','run','lint',cwd=stage,capture=False,env=env)
    cmd('npm','run','build',cwd=stage,capture=False,env=env)
    if not (stage/'dist/server.cjs').is_file(): raise Bloqueado('Bundle não foi produzido')

def main():
    if sys.argv[1:] not in ([], ['--se-mudou']): raise Bloqueado('Argumento inválido')
    if not (ROOT/'.git').exists(): raise Bloqueado('Checkout não encontrado')
    guardas()
    # Estado não versionado também importa: nunca incorporar ou apagar trabalho prévio.
    if git('status','--porcelain','--untracked-files=no'):
        raise Bloqueado('Checkout contém alterações; integração manual necessária')
    git('fetch','-q','origin')
    atual=git('rev-parse','HEAD'); alvo=git('rev-parse','origin/main')
    try: instalado=(STATE/'construido').read_text(encoding='ascii').strip()
    except OSError: instalado=''
    if atual == alvo and instalado == alvo:
        print('Sem atualização; aquisição continua bloqueada.')
        return
    git('merge-base','--is-ancestor',atual,alvo)
    alterados=['sem-base']
    if instalado and instalado != alvo:
        try:
            git('cat-file','-e',instalado+'^{commit}')
            alterados=git('diff','--name-only',instalado,alvo).splitlines()
        except Bloqueado:
            pass
    dependencias=dependencias_mudaram(alterados,instalado,alvo)
    somente_docs=bool(alterados) and all(p.endswith('.md') for p in alterados)
    with tempfile.TemporaryDirectory(prefix='squadone-updater-') as temp:
        stage=Path(temp)
        construir(stage,alvo,dependencias,somente_docs)
        guardas(); ocioso()
        if git('status','--porcelain','--untracked-files=no') or git('rev-parse','HEAD') != atual or git('rev-parse','origin/main') != alvo:
            raise Bloqueado('Checkout ou alvo mudou durante a validação')
        if somente_docs:
            if atual != alvo: git('merge','--ff-only',alvo)
            guardas()
            STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
            tmp=STATE/('construido-'+str(os.getpid())+'.tmp')
            tmp.write_text(alvo+'\n',encoding='ascii');tmp.replace(STATE/'construido')
            print('Somente documentação mudou; candidato validado, sem build nem reinício.')
            return
        STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
        dist=ROOT/'dist'; deps=ROOT/'node_modules'
        tag=str(time.time_ns()); backup=STATE/('dist-backup-'+tag); backup_deps=STATE/('node_modules-backup-'+tag)
        if backup.exists() or backup_deps.exists() or not dist.is_dir() or not deps.is_dir(): raise Bloqueado('Bundle ou dependências atuais ausentes')
        if dist.stat().st_dev != STATE.stat().st_dev or deps.stat().st_dev != STATE.stat().st_dev: raise Bloqueado('Backup e artefatos precisam estar no mesmo filesystem')
        # Copiar antes do merge, para falha de cópia não mexer nem no checkout nem no serviço.
        with tempfile.TemporaryDirectory(prefix='.dist-updater-',dir=ROOT) as temp_dist:
            preparado=Path(temp_dist)/'dist'; shutil.copytree(stage/'dist',preparado,symlinks=True)
            deps_preparadas=Path(temp_dist)/'node_modules'
            if dependencias: shutil.copytree(stage/'node_modules',deps_preparadas,symlinks=True)
            guardas(); ocioso()
            if atual != alvo: git('merge','--ff-only',alvo)
            guardas(); ocioso()
            cmd('systemctl','--user','stop','squadone-operations.service')
            dist_trocado=False; deps_trocadas=False
            try:
                dist.rename(backup); dist_trocado=True; preparado.rename(dist)
                if dependencias:
                    deps.rename(backup_deps); deps_trocadas=True; deps_preparadas.rename(deps)
                cmd('systemctl','--user','start','squadone-operations.service')
                for _ in range(30):
                    try:
                        guardas()
                        tmp=STATE/('construido-'+str(os.getpid())+'.tmp')
                        tmp.write_text(alvo+'\n',encoding='ascii');tmp.replace(STATE/'construido')
                        print('Atualização validada; backups preservados.')
                        return
                    except Bloqueado: time.sleep(1)
                raise Bloqueado('Pós-verificação falhou')
            except (Bloqueado,OSError) as erro:
                # Uma resposta lenta pode esconder um turno novo em andamento.
                # Sem certeza de ociosidade, não interromper o serviço ativo.
                estado=cmd('systemctl','--user','show','squadone-operations.service','-p','ActiveState','--value')
                if estado == 'active':
                    try: ocioso()
                    except Bloqueado as ocupado:
                        raise Bloqueado('Recuperação adiada: Central ocupada ou estado incerto; serviço e backups preservados') from ocupado
                    cmd('systemctl','--user','stop','squadone-operations.service')
                elif estado not in ('inactive','failed'):
                    raise Bloqueado('Recuperação adiada: estado da Central incerto; serviço e backups preservados') from erro
                # O bundle antigo pode ler arquivos versionados em runtime. Voltar o
                # checkout só quando ele ainda é o que acabamos de instalar e não
                # contém edições concorrentes; --keep também recusa colisões.
                if git('status','--porcelain','--untracked-files=no') or git('rev-parse','HEAD') != alvo:
                    raise Bloqueado('Recuperação interrompida: checkout mudou; Central parada e backups preservados') from erro
                if atual != alvo:
                    try: git('reset','--keep',atual)
                    except Bloqueado as conflito:
                        raise Bloqueado('Recuperação interrompida: checkout não pôde voltar sem perda; Central parada e backups preservados') from conflito
                if deps_trocadas:
                    if deps.exists(): deps.rename(STATE/('node_modules-falho-'+tag))
                    backup_deps.rename(deps)
                if dist_trocado:
                    if dist.exists(): dist.rename(STATE/('dist-falho-'+tag))
                    backup.rename(dist)
                try:
                    cmd('systemctl','--user','start','squadone-operations.service')
                    guardas()
                except Bloqueado as recuperacao:
                    raise Bloqueado('Atualização falhou; artefatos antigos restaurados, recuperação da Central não confirmada') from recuperacao
                raise Bloqueado('Atualização falhou; artefatos antigos restaurados e Central recuperada') from erro

if __name__ == '__main__':
    try:
        import fcntl
        STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
        with (STATE/'atualizador.lock').open('a') as lock:
            try: fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise Bloqueado('Outra atualização está em andamento')
            main()
    except (Bloqueado, OSError, subprocess.SubprocessError) as e:
        print('Atualização interrompida:', str(e), file=sys.stderr)
        sys.exit(1)
