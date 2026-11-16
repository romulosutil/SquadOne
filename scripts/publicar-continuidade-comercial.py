"""Publica somente o delta de continuidade no Dell, com backup e testes antes da ativação."""
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

H = Path.home()
REPO = H/'SquadOne'
BASE = H/'.cache/mel-work/disparos-20261112'
STAGE = BASE/'stage'


def main():
    import fcntl
    agora = dt.datetime.now(dt.timezone.utc)
    backup = BASE/('backup-'+agora.strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700, parents=True)
    run = lambda *args: subprocess.run(args, check=True, capture_output=True, text=True, cwd=REPO).stdout
    executor = H/'.local/bin/frente-comercial'
    origem = executor.read_text()
    assert (REPO/'deploy/dell/frente-comercial.py').read_text() == origem, 'Executor instalado difere da fonte'
    assert 'def rodada_operacional()' not in origem, 'Delta já aplicado; conferir estado'
    # Extrai apenas a função nova do PC; todo o restante continua sendo a produção atual.
    local = (STAGE/'deploy/dell/frente-comercial.py').read_text()
    tree = ast.parse(local)
    func = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'rodada')
    wrapper = ast.get_source_segment(local, func)
    assert origem.count('def rodada():') == 1
    novo = origem.replace('def rodada():', wrapper+'\n\ndef rodada_operacional():', 1)
    compile(novo, str(executor), 'exec')
    testrepo = STAGE/'testrepo'
    testbase = testrepo/'deploy/dell'; testbase.mkdir(parents=True, exist_ok=True)
    (testrepo/'config').mkdir(exist_ok=True)
    shutil.copy2(REPO/'config/feriados-nacionais.json', testrepo/'config/feriados-nacionais.json')
    (testrepo/'src/operations').mkdir(parents=True, exist_ok=True)
    for p in (REPO/'src/operations').glob('*.ts'): shutil.copy2(p, testrepo/'src/operations'/p.name)
    (testrepo/'server').mkdir(exist_ok=True)
    for p in (REPO/'server').glob('*.ts'): shutil.copy2(p, testrepo/'server'/p.name)
    for p in (REPO/'deploy/dell').glob('*.py'): shutil.copy2(p, testbase/p.name)
    for sub in ['lib', 'claude-ops']:
        (testbase/sub).mkdir(exist_ok=True)
        for p in (REPO/'deploy/dell'/sub).glob('*.py'): shutil.copy2(p, testbase/sub/p.name)
    for nome in ['continuidade_comercial.py', 'continuidade-comercial.test.py', 'prospeccao-continua.test.py',
                 'prospeccao_diaria.py', 'prospeccao-diaria.test.py', 'campanha_site.py', 'pesquisa_leads.py',
                 'frente-comercial-curadoria.test.py']:
        shutil.copy2(STAGE/'deploy/dell'/nome, testbase/nome)
    shutil.copy2(STAGE/'deploy/dell/claude-ops/pesquisa-leads-n8n.py', testbase/'claude-ops/pesquisa-leads-n8n.py')
    (testbase/'frente-comercial.py').write_text(novo)
    testes = ['continuidade-comercial.test.py', 'prospeccao-continua.test.py', 'prospeccao-diaria.test.py',
              'campanha-site.test.py', 'campanha-liberacao.test.py', 'descoberta-site.test.py',
              'pesquisa-leads.test.py', 'frente-comercial.test.py', 'frente-comercial-abertura.test.py',
              'frente-comercial-curadoria.test.py', 'frente-comercial-qualidade.test.py',
              'filtro-leads.test.py']
    for nome in testes:
        r = subprocess.run(['python3', str(testbase/nome)], capture_output=True, text=True, cwd=testbase)
        (backup/(nome+'.log')).write_text(r.stdout+r.stderr)
        print(nome, r.returncode, (r.stderr+r.stdout)[-500:], flush=True)
        assert r.returncode == 0, 'Teste falhou: '+nome
    for unit in ['prospeccao-diaria.service', 'prospeccao-diaria.timer']:
        r = subprocess.run(['systemd-analyze', '--user', 'verify', str(STAGE/'deploy/dell'/unit)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    if '--testar' in sys.argv: return
    run('systemctl', '--user', 'stop', 'frente-comercial.timer')
    restaurar = []
    with (H/'.local/share/frente-comercial/rodada.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        assert executor.read_text() == origem, 'Executor alterado durante os testes'
        def instalar(src, dest, mode=0o644):
            bak = backup/dest.relative_to(H)
            if dest.exists():
                bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(dest, bak)
            else: bak = None
            restaurar.append((dest, bak)); dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(dest.name+'.continuidade.tmp'); shutil.copy2(src, tmp); tmp.chmod(mode); os.replace(tmp, dest)
        try:
            db = H/'.local/share/frente-comercial/registro.sqlite'
            with sqlite3.connect(db.as_uri()+'?mode=ro', uri=True) as con, sqlite3.connect(backup/'registro.sqlite') as out:
                con.backup(out)
            for nome in ['campanha_site.py', 'pesquisa_leads.py', 'continuidade_comercial.py', 'prospeccao_diaria.py']:
                source = testbase/nome
                instalar(source, REPO/'deploy/dell'/nome)
                instalar(source, H/'.local/bin'/nome)
                if nome == 'pesquisa_leads.py': instalar(source, H/'.local/share/claude-ops'/nome, 0o600)
            instalar(testbase/'frente-comercial.py', executor, 0o755)
            instalar(testbase/'frente-comercial.py', REPO/'deploy/dell/frente-comercial.py')
            for nome in testes[:3]: instalar(testbase/nome, REPO/'deploy/dell'/nome)
            instalar(testbase/'frente-comercial-curadoria.test.py', REPO/'deploy/dell/frente-comercial-curadoria.test.py')
            for nome in ['prospeccao-diaria.service', 'prospeccao-diaria.timer']:
                instalar(STAGE/'deploy/dell'/nome, REPO/'deploy/dell'/nome)
                instalar(STAGE/'deploy/dell'/nome, H/'.config/systemd/user'/nome)
            manifesto = REPO/'deploy/dell/instalados.json'
            instalado = json.loads(manifesto.read_text())
            for nome in ['continuidade_comercial.py', 'prospeccao_diaria.py']:
                entrada = {'repo': 'deploy/dell/'+nome, 'instalado': '~/.local/bin/', 'modo': '644'}
                if not any(x.get('repo') == entrada['repo'] for x in instalado['arquivos']): instalado['arquivos'].append(entrada)
            (backup/'instalados-novo.json').write_text(json.dumps(instalado, ensure_ascii=False, indent=2))
            instalar(backup/'instalados-novo.json', manifesto)
            script = testbase/'claude-ops/pesquisa-leads-n8n.py'
            instalar(script, REPO/'deploy/dell/claude-ops/pesquisa-leads-n8n.py')
            instalar(script, H/'.local/share/claude-ops/pesquisa-leads-n8n.py', 0o600)
            # O publicador não recria outros workflows nem religa caçadores pagos.
            sys.path.insert(0, str(H/'.local/share/claude-ops'))
            from n8n import api, put
            w = api('GET', '/workflows/pwNiZI1rBGzMJ2dP')
            (backup/'workflow-pesquisa.json').write_text(json.dumps(w))
            node = next(n for n in w['nodes'] if n['name'] == 'Conferir semana autorizada')
            assert '2026-11-06' in node['parameters']['jsCode'], 'Janela de pesquisa mudou'
            node['parameters']['jsCode'] = "// O manifesto atual decide escopo e período no Python.\nreturn [{json:{limite:10}}];"
            put(w)
            atual = api('GET', '/workflows/'+w['id'])
            assert atual['active'] == w['active'], 'Estado do workflow foi alterado'
            run('systemctl', '--user', 'daemon-reload')
            # O servidor da pesquisa mantém import em memória.
            run('systemctl', '--user', 'restart', 'luna-workflows.service')
            (BASE/'publicacao.json').write_text(json.dumps({'backup': str(backup), 'testes': testes,
                  'instalado': True, 'mensagensDeTeste': 0}, ensure_ascii=False, indent=2))
            print('PUBLICADO', str(backup), flush=True)
        except BaseException:
            for dest, bak in reversed(restaurar):
                if bak: shutil.copy2(bak, dest)
                else: dest.unlink(missing_ok=True)
            run('systemctl', '--user', 'daemon-reload')
            raise
        finally:
            run('systemctl', '--user', 'start', 'frente-comercial.timer')


if __name__ == '__main__': main()
