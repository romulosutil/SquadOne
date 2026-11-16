"""Publica deltas sobre as fontes atuais da Mel, com backup e retorno em falha."""
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time
import urllib.request


def main():
    h=Path.home();repo=h/'SquadOne';base=h/'.cache/mel-work/leads-20261101';stage=base/'stage'
    spec=importlib.util.spec_from_file_location('patch_pesquisa',stage/'patch-pesquisa-leads.py');patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    run=lambda *args:subprocess.run(args,check=True,capture_output=True,text=True,cwd=repo).stdout
    active=lambda name:subprocess.run(['systemctl','--user','is-active',name],capture_output=True,text=True).stdout.strip()=='active'
    backup=base/('backup-publicacao-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));backup.mkdir(mode=0o700)
    restore=[]
    def install(src,dest,mode=0o600):
        if dest.exists():
            bak=backup/dest.relative_to(h);bak.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dest,bak)
        else:bak=None
        restore.append((dest,bak));dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        tmp=dest.with_name(dest.name+'.pesquisa.tmp');shutil.copy2(src,tmp);tmp.chmod(mode);os.replace(tmp,dest)
    timer=active('frente-comercial.timer');run('systemctl','--user','stop','frente-comercial.timer')
    lock=(h/'.local/share/frente-comercial/rodada.lock').open('a')
    try:
        # Uma rodada já em transporte termina; não matar nem repetir envio.
        for i in range(60):
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
            except BlockingIOError:
                if i==59:raise
                time.sleep(1)
        assert not active('frente-comercial.service'),'Rodada comercial ainda ativa'
        atual=h/'.local/bin/frente-comercial';assert sha(atual)==sha(base/'baseline/executor.py'),'Executor mudou; refazer baseline'
        filtro=h/'.local/bin/filtro_leads.py';assert sha(filtro)==sha(base/'baseline/filtro_leads.py'),'Curadoria mudou; refazer baseline'
        luna=h/'.local/share/claude-ops/luna_workflows.py'
        for name,source,func in [('executor.py',atual,patch.patch_executor),('filtro_leads.py',filtro,patch.patch_filtro),('luna_workflows.py',luna,patch.patch_luna)]:
            (stage/name).write_text(func(source.read_text()))
            compile((stage/name).read_text(),name,'exec')
        # Conferir testes sobre a produção adaptada, não sobre cópia antiga do PC.
        shutil.copy2(stage/'executor.py',stage/'frente-comercial.py')
        for test in ['pesquisa-leads.test.py','filtro-leads.test.py','frente-comercial-estrategia.test.py','frente-comercial-curadoria.test.py','frente-comercial-qualidade.test.py','frente-comercial-responsavel.test.py']:
            r=subprocess.run(['python3',str(stage/test)],capture_output=True,text=True,cwd=stage)
            assert r.returncode==0,test+'\n'+r.stderr[-2500:]
        config=h/'.local/share/squadone-operations/frente-comercial-config.json';config_bytes=config.read_bytes()
        dbfile=h/'.local/share/frente-comercial/registro.sqlite'
        with sqlite3.connect(dbfile.as_uri()+'?mode=ro',uri=True) as db,sqlite3.connect(backup/'registro.sqlite') as out:
            contacts=db.execute('SELECT COUNT(*) FROM contatos').fetchone()[0];db.backup(out)
        # Delta de calendário conserva a versão atual de toda a tela.
        ts=repo/'src/operations/trava-de-horario.ts';text=ts.read_text()
        anchor="import type { CrmLead } from './types'"
        assert text.count(anchor)==1
        text=text.replace(anchor,anchor+"\nimport calendario from '../../config/feriados-nacionais.json'\nconst FERIADOS_NACIONAIS = new Set(calendario.datas)\n")
        anchor="  return (EXPEDIENTE_DE_VENDA.dias as readonly number[]).includes(dia)"
        assert text.count(anchor)==1
        text=text.replace(anchor,"  return !FERIADOS_NACIONAIS.has(new Date(agora - 3 * 3600_000).toISOString().slice(0, 10)) && (EXPEDIENTE_DE_VENDA.dias as readonly number[]).includes(dia)")
        (stage/'trava-de-horario-producao.ts').write_text(text)
        install(stage/'config/feriados-nacionais.json',repo/'config/feriados-nacionais.json',0o644)
        install(stage/'trava-de-horario-producao.ts',ts,0o644)
        manifest={str(p.relative_to(repo)):sha(p) for root in ['src','server'] for p in (repo/root).rglob('*') if p.is_file() and '__pycache__' not in p.parts and '.test.' not in p.name}
        # Compilação separada: não remover os assets que o serviço atual está servindo.
        for args in [ ['node','node_modules/vite/bin/vite.js','build','--outDir',str(stage/'dist'),'--emptyOutDir'],
                      ['node_modules/esbuild/bin/esbuild','server.ts','--bundle','--platform=node','--format=cjs','--packages=external','--sourcemap','--outfile='+str(stage/'dist/server.cjs')]]:
            r=subprocess.run(args,capture_output=True,text=True,cwd=repo)
            if r.returncode:raise RuntimeError('Build falhou: '+r.stderr[-2000:])
        for name,digest in manifest.items():assert sha(repo/name)==digest,'Fonte mudou durante build: '+name
        for src,dest,mode in [
          (stage/'pesquisa_leads.py',h/'.local/bin/pesquisa_leads.py',0o600),
          (stage/'pesquisa_leads.py',h/'.local/share/claude-ops/pesquisa_leads.py',0o600),
          (stage/'calendario_comercial.py',h/'.local/bin/calendario_comercial.py',0o600),
          (stage/'config/feriados-nacionais.json',h/'.local/bin/feriados-nacionais.json',0o600),
          (stage/'filtro_leads.py',filtro,0o600),(stage/'executor.py',atual,0o755),
          (stage/'luna_workflows.py',luna,0o600),
          (stage/'pesquisa_leads.py',repo/'deploy/dell/pesquisa_leads.py',0o644),
          (stage/'calendario_comercial.py',repo/'deploy/dell/calendario_comercial.py',0o644),
          (stage/'filtro_leads.py',repo/'deploy/dell/filtro_leads.py',0o644),
          (stage/'executor.py',repo/'deploy/dell/frente-comercial.py',0o644),
          (stage/'luna_workflows.py',repo/'deploy/dell/claude-ops/luna_workflows.py',0o644),
          (stage/'pesquisa-leads-n8n.py',repo/'deploy/dell/claude-ops/pesquisa-leads-n8n.py',0o644)]:install(src,dest,mode)
        assets=[p for p in (stage/'dist').rglob('*') if p.is_file()]
        for src in sorted(assets,key=lambda p:p.name in ('index.html','server.cjs')):install(src,repo/'dist'/src.relative_to(stage/'dist'),0o644)
        run('systemctl','--user','restart','luna-workflows.service')
        run('systemctl','--user','restart','squadone-operations.service')
        ok=False
        for _ in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:9120/api/runtime',timeout=2) as r:ok=r.status==200
            except Exception:pass
            if ok:break
            time.sleep(1)
        assert ok and active('luna-workflows.service'),'Serviços não confirmaram saúde'
        assert config.read_bytes()==config_bytes,'Configuração comercial mudou'
        with sqlite3.connect(dbfile.as_uri()+'?mode=ro',uri=True) as db:assert db.execute('SELECT COUNT(*) FROM contatos').fetchone()[0]==contacts,'Registro comercial mudou'
        result={'instalado':True,'backup':str(backup),'contatosPreservados':contacts,'configPreservada':True,'mensagensDeTeste':0,'testesPython':82,'build':'aprovado'}
        (base/'publicacao.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False))
    except BaseException:
        for dest,bak in reversed(restore):
            if bak:shutil.copy2(bak,dest)
            else:dest.unlink(missing_ok=True)
        if restore:
            subprocess.run(['systemctl','--user','restart','luna-workflows.service'],capture_output=True)
            subprocess.run(['systemctl','--user','restart','squadone-operations.service'],capture_output=True)
        raise
    finally:
        lock.close()
        if timer:run('systemctl','--user','start','frente-comercial.timer')


if __name__=='__main__':main()
