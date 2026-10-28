"""Instala o delta homologado no Dell com comparação, backup e retorno em falha."""
from pathlib import Path
import datetime as dt
import fcntl
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import time
import urllib.request


def main():
    h = Path.home(); base = h/'.cache/mel-work/filtro-leads-20261026'
    stage = base/'stage'; entrada = base/'entrada'; repo = h/'SquadOne'; data = h/'.local/share/squadone-operations'
    validacao = json.loads((base/'validacao.json').read_text())
    assert validacao['build'] == 'aprovado' and not any(validacao['python'].values())
    manifesto = json.loads((base/'baseline.json').read_text())
    def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
    def run(*args): return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()
    def ativo(nome): return subprocess.run(['systemctl', '--user', 'is-active', nome], capture_output=True, text=True).stdout.strip() == 'active'
    def conferir():
        for nome, digest in manifesto.items():
            p = h/'.local/bin/frente-comercial' if nome == 'executor' else repo/nome
            assert sha(p) == digest, 'Alteração concorrente: '+nome
        # O bundle só pode vir da mesma fonte homologada.
        for pasta in ('server', 'src'):
            for p in (repo/pasta).rglob('*'):
                if p.is_file() and '__pycache__' not in p.parts and '.test.' not in p.name:
                    nome = str(p.relative_to(repo))
                    if nome not in manifesto:
                        assert (stage/nome).is_file() and sha(p) == sha(stage/nome), 'Fonte mudou: '+nome
    conferir()
    backup = base/('backup-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    timer = ativo('frente-comercial.timer'); run('systemctl', '--user', 'stop', 'frente-comercial.timer')
    restaurar = []; lock = (h/'.local/share/frente-comercial/rodada.lock').open('a')
    def instalar(src, dest, modo=None):
        if dest.exists():
            bak = backup/'arquivos'/dest.relative_to(h); bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(dest, bak)
            restaurar.append((dest, bak))
        else: restaurar.append((dest, None))
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name+'.curadoria.tmp'); shutil.copy2(src, tmp)
        if modo is not None: tmp.chmod(modo)
        os.replace(tmp, dest)
    try:
        for tentativa in range(55):
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if tentativa == 54: raise
                time.sleep(1)
        assert not ativo('frente-comercial.service'), 'Aguardar rodada, sem interromper transporte'
        conferir()
        config = (data/'frente-comercial-config.json').read_bytes()
        dbp = h/'.local/share/frente-comercial/registro.sqlite'
        with sqlite3.connect(dbp.as_uri()+'?mode=ro', uri=True) as db, sqlite3.connect(backup/'registro.sqlite') as out:
            contatos = db.execute('SELECT COUNT(*) FROM contatos').fetchone()[0]; db.backup(out)
        shutil.copy2(data/'frente-comercial.json', backup/'frente-comercial.json')
        instalar(entrada/'deploy/dell/filtro_leads.py', h/'.local/bin/filtro_leads.py', 0o600)
        instalar(entrada/'deploy/dell/curadoria-leads.py', h/'.local/bin/curadoria-leads', 0o755)
        # A primeira revisão precisa existir e ter sido validada antes da ativação do gate.
        # Reutiliza a primeira revisão completa recém-validada em homologação.
        # Evita repetir uma consulta pesada ao CRM dentro da janela de instalação.
        revisao_arquivo = data/'filtro-leads.json'
        recente = json.loads(revisao_arquivo.read_text()) if revisao_arquivo.exists() else {}
        em = dt.datetime.fromisoformat(recente['geradoEm']) if recente.get('geradoEm') else None
        revisao = (json.dumps(recente, ensure_ascii=False) if em and recente.get('versao') == 'marina-curadoria-v1-20261026'
                   and 0 <= (dt.datetime.now(dt.timezone.utc)-em).total_seconds() < 300
                   else run('python3', str(h/'.local/bin/curadoria-leads')))
        (base/'primeira-revisao.json').write_text(revisao)
        instalar(stage/'deploy/dell/frente-comercial.py', h/'.local/bin/frente-comercial', 0o755)
        for nome in ['server.ts', 'server/assistente-ferramentas.ts', 'src/operations/assistente.ts',
                     'server/filtro-leads.ts', 'server/filtro-leads.test.ts', 'deploy/dell/frente-comercial.py',
                     'deploy/dell/filtro_leads.py', 'deploy/dell/curadoria-leads.py', 'deploy/dell/filtro-leads.test.py',
                     'deploy/dell/frente-comercial-curadoria.test.py', 'dist/server.cjs', 'dist/server.cjs.map']:
            instalar(stage/nome, repo/nome)
        for nome in ['curadoria-leads.service', 'curadoria-leads.timer']:
            instalar(entrada/'deploy/dell'/nome, h/'.config/systemd/user'/nome, 0o644)
            instalar(entrada/'deploy/dell'/nome, repo/'deploy/dell'/nome, 0o644)
        # Invalida só a fila ainda não enviada. Recibos e registros originais continuam intocados.
        estado = json.loads((data/'frente-comercial.json').read_text())
        estado['fila'] = [c for c in estado.get('fila', []) if c.get('estado') != 'pronto']
        estado.update(estado='avaliando', selecionados=len(estado['fila']),
                      detalhe='Marina revisou a base. O time está reavaliando os candidatos com a curadoria atual.',
                      atualizadoEm=dt.datetime.now(dt.timezone.utc).isoformat())
        tmp = data/'frente-comercial.curadoria.tmp'; tmp.write_text(json.dumps(estado, ensure_ascii=False)); tmp.chmod(0o600)
        os.replace(tmp, data/'frente-comercial.json')
        run('systemctl', '--user', 'restart', 'squadone-operations.service')
        ok = False
        for _ in range(25):
            try:
                with urllib.request.urlopen('http://127.0.0.1:9120/api/runtime', timeout=2) as r: ok = r.status == 200
            except Exception: pass
            if ok: break
            time.sleep(1)
        assert ok, 'Central não confirmou saúde'
        run('systemctl', '--user', 'daemon-reload')
        run('systemctl', '--user', 'enable', '--now', 'curadoria-leads.timer')
        assert (data/'frente-comercial-config.json').read_bytes() == config, 'Configuração mudou'
        with sqlite3.connect(dbp.as_uri()+'?mode=ro', uri=True) as db:
            assert db.execute('SELECT COUNT(*) FROM contatos').fetchone()[0] == contatos, 'Registro de contatos mudou'
        resultado = {'instalado': True, 'backup': str(backup), 'centralAtiva': ativo('squadone-operations.service'),
                     'curadoriaTimerAtivo': ativo('curadoria-leads.timer'), 'contatosPreservados': contatos,
                     'configPreservada': True, 'envioDeTeste': False, 'validacao': validacao}
        (base/'publicacao.json').write_text(json.dumps(resultado, ensure_ascii=False, indent=2)); print(json.dumps(resultado, ensure_ascii=False))
    except Exception:
        for dest, bak in reversed(restaurar):
            if bak is None: dest.unlink(missing_ok=True)
            else: shutil.copy2(bak, dest)
        if (backup/'frente-comercial.json').exists(): shutil.copy2(backup/'frente-comercial.json', data/'frente-comercial.json')
        if restaurar:
            subprocess.run(['systemctl', '--user', 'daemon-reload'], capture_output=True)
            subprocess.run(['systemctl', '--user', 'restart', 'squadone-operations.service'], capture_output=True)
        raise
    finally:
        lock.close()
        if timer: run('systemctl', '--user', 'start', 'frente-comercial.timer')


if __name__ == '__main__': main()
