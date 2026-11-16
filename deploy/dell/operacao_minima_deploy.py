"""Motor de publicação enviado por stdin ao Dell; nunca envia a clientes.

Chamado por scripts/publicar-operacao-minima.py, com request explícito.
Backups completos e fontes de workflow permanecem privados no Dell.
"""
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

H=Path.home(); LIVE=H/'SquadOne'; CACHE=H/'.cache/prumo-operacao-minima'
DATA=H/'.local/share/squadone-operations'
TIMERS=['frente-comercial.timer','prospeccao-diaria.timer','gerador-de-sites.timer','raio-x.timer',
        'curadoria-leads.timer','funil-aprendizado.timer','funil-revisao.timer',
        'disparo-conversa.timer','encontrado-materiais.timer']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
def state(n):
    r=subprocess.run(['systemctl','--user','show',n,'-p','LoadState','-p','ActiveState','-p','UnitFileState'],capture_output=True,text=True,check=True)
    return dict(x.split('=',1) for x in r.stdout.splitlines() if '=' in x)
def cmd(*args,cwd=None,env=None):
    r=subprocess.run(args,cwd=cwd,env=env,capture_output=True,text=True)
    if r.returncode:raise RuntimeError('Comando falhou: '+args[0]+' '+(args[1] if len(args)>1 else '')+'; '+r.stderr[-500:])
    return r.stdout.strip()
def atomic(p,data,mode=0o600):
    p.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix=p.name+'.minimo-',dir=p.parent)
    with os.fdopen(fd,'wb') as f:os.fchmod(f.fileno(),mode);f.write(data);f.flush();os.fsync(f.fileno())
    os.replace(temp,p)
def writejson(p,value):atomic(p,json.dumps(value,ensure_ascii=False,indent=2).encode())
def falhas(s):
    matches=list(re.finditer(r'(?m)^\s*not ok[^\n]*',s))
    if not matches:matches=list(re.finditer(r'(?m)^Traceback|^FAIL:|^ERROR:',s))
    return '\n'.join(s[max(0,m.start()-80):m.start()+2000] for m in matches)[:14000] or s[-3500:]
def api(path,method='GET',body=None):
    key=(H/'.config/claude-ops/n8n-api-key').read_text().strip()
    req=urllib.request.Request('http://127.0.0.1:5679/api/v1/'+path,method=method,
        headers={'X-N8N-API-KEY':key,'Content-Type':'application/json'},data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req,timeout=35) as r:
            data=r.read();return json.loads(data) if data else {}
    except urllib.error.HTTPError as e:raise RuntimeError('n8n '+method+' '+path+' HTTP '+str(e.code)) from None
def workflows():
    out=[];path='workflows?limit=100'
    while path:
        d=api(path);out+=d['data'];path='workflows?limit=100&cursor='+d['nextCursor'] if d.get('nextCursor') else None
    return {w['id']:w for w in out}
def central(path):
    with urllib.request.urlopen('http://127.0.0.1:9120'+path,timeout=45) as r:return json.load(r)
def quiet():
    limite=time.monotonic()+45
    while central('/api/runtime').get('ocupado') is not False:
        if time.monotonic()>=limite:raise RuntimeError('Central ocupada; sem interrupção')
        time.sleep(1)
def pause_guards():
    for n in ['frente-comercial.timer','prospeccao-diaria.timer']:
        s=state(n)
        if s['ActiveState']!='inactive' or s['UnitFileState'] not in ('disabled','masked'):raise RuntimeError('Disparo não está contido: '+n)
    for n in ['frente-comercial-config.json','campanha-site-ativa.json']:
        if json.loads((DATA/n).read_text()).get('ativo') is not False:raise RuntimeError('Campanha/frente não está contida')
def relpath(rel):
    p=Path(rel)
    if p.is_absolute() or '..' in p.parts or '\\' in rel or rel.startswith('.'):raise RuntimeError('Caminho de fonte inválido')
    return p

mode=request['modo']
if mode=='preparar':
    pause_guards()
    ident='minimo-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    R=CACHE/ident;S=R/'palco';S.mkdir(parents=True,mode=0o700)
    baseline={}
    for folder in ['server','src','config','scripts','deploy','docs','public']:
        if not (LIVE/folder).is_dir():continue
        shutil.copytree(LIVE/folder,S/folder,ignore=shutil.ignore_patterns('__pycache__','node_modules','*.pyc'),symlinks=False)
        for f in (LIVE/folder).rglob('*'):
            if f.is_file() and '__pycache__' not in f.parts:baseline[f.relative_to(LIVE).as_posix()]=sha(f)
    for name in ['server.ts','package.json','package-lock.json','bun.lock','tsconfig.json','vite.config.ts','index.html','RULES.md','CLAUDE.md','ARCHITECTURE.md']:
        f=LIVE/name
        if f.is_file():shutil.copy2(f,S/name);baseline[name]=sha(f)
    (S/'node_modules').symlink_to(LIVE/'node_modules',target_is_directory=True)
    ws=workflows()
    for wid,w in ws.items():writejson(R/'backup/workflows'/f'{wid}.json',w)
    orig={}
    for f in (H/'.config/claude-ops').glob('workflow-*.json'):orig[str(f.relative_to(H))]=base64.b64encode(f.read_bytes()).decode()
    for name in ['frente-comercial-config.json','campanha-site-ativa.json','encontrado-automacao.json','estamparia-automacao.json']:
        f=DATA/name
        if f.exists():orig[str(f.relative_to(H))]=base64.b64encode(f.read_bytes()).decode()
    writejson(R/'backup/configs.json',orig)
    units={n:state(n) for n in TIMERS+['atualizar-central.timer','prumo-contexto.timer']}
    writejson(R/'backup/units.json',units)
    db=H/'.local/share/frente-comercial/registro.sqlite'
    with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True) as conn, sqlite3.connect(R/'backup/registro.sqlite') as dest:
        conn.backup(dest);contatos=conn.execute('select count(*) from contatos').fetchone()[0]
    (R/'backup/registro.sqlite').chmod(0o600)
    overlay=[];conflicts={}
    for x in request['arquivos']:
        rel=relpath(x['path']);f=LIVE/rel;old=f.read_bytes() if f.is_file() else None
        before=base64.b64decode(x['antes']) if x['antes'] is not None else None
        new=base64.b64decode(x['depois']) if x['depois'] is not None else None
        if new is None:
            if old is not None and before is not None and old.replace(b'\r\n',b'\n')!=before.replace(b'\r\n',b'\n'):
                conflicts[str(rel)]=base64.b64encode(old).decode();continue
            if (S/rel).exists():(S/rel).unlink()
        else:
            if old is not None and old.replace(b'\r\n',b'\n')!=new.replace(b'\r\n',b'\n') and before is not None:
                temp=R/'merge';temp.mkdir(exist_ok=True)
                for n,b in [('atual',old),('base',before),('novo',new)]:atomic(temp/n,b.replace(b'\r\n',b'\n'))
                merge=subprocess.run(['git','merge-file','-p',str(temp/'atual'),str(temp/'base'),str(temp/'novo')],capture_output=True)
                new=merge.stdout
                if merge.returncode:conflicts[str(rel)]=base64.b64encode(new).decode();continue
            atomic(S/rel,new,0o644)
        overlay.append(str(rel))
    meta={'release':ident,'baseline':baseline,'overlay':overlay,'conflitos':list(conflicts),'validado':False,
          'workflowVersions':{wid:w['versionId'] for wid,w in ws.items()},'contatosAntes':contatos}
    writejson(R/'meta.json',meta)
    print(json.dumps({'release':ident,'arquivos':len(overlay),'conflitos':list(conflicts),'conflitosConteudo':conflicts,'backup':str(R/'backup')},ensure_ascii=False))
else:
    ident=request['release']
    if not re.fullmatch(r'minimo-\d{8}T\d{6}Z',ident):raise RuntimeError('Release inválido')
    R=CACHE/ident;S=R/'palco';meta=json.loads((R/'meta.json').read_text())
    if mode=='resolver':
        rel=request['path'];relpath(rel)
        if rel not in meta['baseline']:meta['baseline'][rel]=sha(LIVE/rel)
        atomic(S/rel,base64.b64decode(request['depois']),0o644)
        if rel in meta['conflitos']:meta['conflitos'].remove(rel)
        if rel not in meta['overlay']:meta['overlay'].append(rel)
        meta['validado']=False;writejson(R/'meta.json',meta)
        print(json.dumps({'resolvido':rel,'restantes':meta['conflitos']}))
    elif mode=='validar':
        if meta['conflitos']:raise RuntimeError('Conflitos pendentes: '+','.join(meta['conflitos']))
        if not (S/'ops').exists() and (LIVE/'ops').exists():
            shutil.copytree(LIVE/'ops',S/'ops')
            for f in (LIVE/'ops').rglob('*'):
                if f.is_file():meta['baseline'][f.relative_to(LIVE).as_posix()]=sha(f)
        sys.path.insert(0,str(S/'deploy/dell/claude-ops'))
        from workflow_minimo import compor
        fontes={p.stem:json.loads(p.read_text()) for p in (R/'backup/workflows').glob('*.json')}
        novos=compor(fontes,json.loads((S/'config/mensagem-inicial.json').read_text()))
        for wid,w in novos.items():writejson(R/'candidatos'/f'{wid}.json',w)
        env=dict(os.environ)
        for name in ['.env','.env.local']:
            f=LIVE/name
            if f.exists():
                for line in f.read_text().splitlines():
                    if line.startswith('VITE_GOOGLE_CLIENT_ID='):env['VITE_GOOGLE_CLIENT_ID']=line.partition('=')[2].strip().strip('"\'')
        checks=[('workflows',['node','scripts/verificar-workflow-minimo.mjs',str(R/'candidatos')]),
            ('compositor',['python3','deploy/dell/claude-ops/workflow_minimo.test.py']),
            ('tipagem',['npm','run','lint']),('aquisicao',['npm','run','test:aquisicao']),
            ('contratos',['node','--import','tsx','--test','server/crm.test.ts','src/office/conversas-para-conduzir.test.ts','src/operations-mensagem-inicial.test.ts']),
            ('pesquisa',['python3','deploy/dell/prospeccao-diaria.test.py']),
            ('higiene',['python3','deploy/dell/pesquisa-leads.test.py']),
            ('testes',['npm','test']),('build',['npm','run','build'])]
        resultados={}
        for label,args in checks:
            r=subprocess.run(args,cwd=S,env=env,capture_output=True,text=True,timeout=240)
            atomic(R/(label+'.log'),(r.stdout+'\n'+r.stderr).encode());resultados[label]=r.returncode
            if r.returncode:break
        meta['validado']=all(v==0 for v in resultados.values()) and len(resultados)==len(checks)
        meta['checks']=resultados
        if meta['validado']:
            meta['overlayHashes']={rel:sha(S/rel) for rel in meta['overlay']}
            meta['dist']={f.relative_to(S/'dist').as_posix():sha(f) for f in (S/'dist').rglob('*') if f.is_file()}
        writejson(R/'meta.json',meta)
        print(json.dumps({'release':ident,'validado':meta['validado'],'checks':resultados,
            'falha':falhas((R/(label+'.log')).read_text()) if not meta['validado'] else None,'workflows':{wid:len(w['nodes']) for wid,w in novos.items()}},ensure_ascii=False))
    elif mode=='logs':
        print(json.dumps({'falhas':{label: falhas(s)
            for label,code in meta.get('checks',{}).items() if code and (s:=(R/(label+'.log')).read_text())}},ensure_ascii=False))
    elif mode=='conferir':
        ws=workflows();f=central('/api/operations/crm/frente')
        with sqlite3.connect((H/'.local/share/frente-comercial/registro.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            contatos=db.execute('select count(*) from contatos').fetchone()[0]
        dry=cmd('python3',str(H/'.local/share/claude-ops/operacao-minima-publicar.py')) if meta.get('aplicado') else None
        extras={}
        if meta.get('aplicado'):
            for oferta in ['encontrado','estamparia']:
                extras[oferta]=central('/api/operations/crm/'+oferta+'/automacao')
            secret=(H/'.config/claude-ops/whatsapp-observador-segredo').read_text().strip()
            with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:5679/webhook/whatsapp-telefones',headers={'X-Observador':secret}),timeout=40) as r:
                result=json.load(r);extras['numeros']={'http':r.status,'tipo':type(result).__name__,'campos':list(result) if isinstance(result,dict) else None}
            secret=(H/'.config/claude-ops/crm-segredo').read_text().strip()
            inicio=time.time()
            with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:5679/webhook/crm-atualizar',data=b'{}',headers={'X-CRM':secret,'Content-Type':'application/json'}),timeout=30) as r:
                extras['atualizarCrm']={'http':r.status}
            snapshot=H/'.local/share/n8n-estado/crm.json'
            nomes_projecoes=['crm.json','site-leads.json','prumo.json','site-antes-da-venda.json']
            for attempt in range(30):
                if all((H/'.local/share/n8n-estado'/name).exists() and (H/'.local/share/n8n-estado'/name).stat().st_mtime>=inicio for name in nomes_projecoes):break
                time.sleep(1)
            extras['crmAtualizado']=snapshot.exists() and snapshot.stat().st_mtime>=inicio
            extras['projecoes']={name:dt.datetime.fromtimestamp((H/'.local/share/n8n-estado'/name).stat().st_mtime,dt.timezone.utc).isoformat() for name in nomes_projecoes}
            extras['todasProjecoesAtualizadas']=all((H/'.local/share/n8n-estado'/name).stat().st_mtime>=inicio for name in nomes_projecoes)
            extras['errosRecentes']=[]
            marco=dt.datetime.fromtimestamp((H/'.config/claude-ops/workflow-minimo.json').stat().st_mtime,dt.timezone.utc).isoformat()
            for wid in ['AsjxktRCqRJSmj9P','fd8gz4uDQkJtEd9W','pwNiZI1rBGzMJ2dP','5FlXnne7lTMihLic']:
                for e in api('executions?workflowId='+wid+'&limit=10&includeData=false')['data']:
                    if e.get('status')=='error' and e.get('startedAt','')>=marco:
                        rd=api('executions/'+str(e['id'])+'?includeData=true').get('data',{}).get('resultData',{})
                        extras['errosRecentes'].append({'workflowId':wid,'em':e.get('startedAt'),'no':rd.get('lastNodeExecuted'),'tipo':rd.get('error',{}).get('name')})
            extras['servicos']={unit:state(unit) for unit in ['squadone-operations.service','luna-workflows.service','whatsapp-observador.service','whatsapp-observador-prumo.service','prumo-mapa.path','revisao-comercial-diaria.timer','atualizar-central.timer','prumo-contexto.timer']}
            extras['importacoes']=cmd('python3','-c',"import sys,pathlib;h=pathlib.Path.home();sys.path[:0]=[str(h/'.local/share/claude-ops'),str(h/'.local/bin')];import pesquisa_operacao_minima,prospeccao_diaria,mensagem_inicial;assert mensagem_inicial.mensagem();print('ok')")
        print(json.dumps({'release':ident,'workflows':[{'id':w['id'],'nome':w['name'],'ativo':w['active'],'arquivado':w.get('isArchived')} for w in ws.values()],
            'frente':{k:f.get(k) for k in ['ativo','estado','aquisicao','pausaAutomatica']},'timers':{n:state(n) for n in TIMERS},'backup':str(R/'backup'),
            'contatos':contatos,'publicador':json.loads(dry) if dry else None,'verificacoes':extras},ensure_ascii=False))
    elif mode=='finalizar':
        if not meta.get('aplicado'):raise RuntimeError('Núcleo ainda não publicado')
        pause_guards()
        permitidos={'deploy/dell/dell-status.py','deploy/dell/dell-status.test.py','deploy/dell/operacao-minima-monitor.test.py',
            'deploy/dell/disparo-conversa.py','deploy/dell/disparo-conversa.test.py',
            'deploy/dell/claude-ops/workflow_minimo.py','deploy/dell/operacao_minima_deploy.py',
            'scripts/publicar-operacao-minima.py','ops/n8n/README.md','ops/n8n/CATALOGO.md','deploy/dell/README.md','CLAUDE.md'}
        updates={}
        for x in request['arquivosFinalizacao']:
            rel=x['path']
            if rel not in permitidos:raise RuntimeError('Complemento fora do escopo validado')
            new=base64.b64decode(x['depois']);current=(LIVE/rel).read_bytes() if (LIVE/rel).is_file() else None
            base=base64.b64decode(x['antes']) if x['antes'] is not None else ((S/rel).read_bytes() if (S/rel).is_file() else None)
            proprio = x['antes'] is None and sha(LIVE/rel) == meta.get('destinos',{}).get('SquadOne/'+rel,{}).get('depois')
            if current is not None and base is not None and not proprio:
                tmp=R/'merge-final';tmp.mkdir(exist_ok=True)
                for n,contents in [('atual',current),('base',base),('novo',new)]:atomic(tmp/n,contents.replace(b'\r\n',b'\n'))
                m=subprocess.run(['git','merge-file','-p',str(tmp/'atual'),str(tmp/'base'),str(tmp/'novo')],capture_output=True)
                if m.returncode and rel=='CLAUDE.md':
                    texto=new.decode().replace('\r\n','\n');start=texto.index('> Simplificação autorizada e publicada em 16/11:')
                    note=texto[start:texto.index('\n\n',start)]
                    atual=current.decode()
                    new=(atual if note in atual else atual.replace('# SquadOne\n','# SquadOne\n\n'+note+'\n',1)).encode()
                elif m.returncode:raise RuntimeError('Complemento conflitante: '+rel)
                else:new=m.stdout
            if rel.endswith('.py'):compile(new,rel,'exec')
            atomic(S/rel,new,0o644);updates[str(LIVE/rel)]=(new,0o644)
        for label,args in [('monitor',['python3','deploy/dell/dell-status.test.py']),
                           ('monitor-minimo',['python3','deploy/dell/operacao-minima-monitor.test.py']),
                           ('retomadas',['python3','deploy/dell/disparo-conversa.test.py']),
                           ('revisao-diaria',['python3','deploy/dell/revisao-comercial-diaria.test.py'])]:
            result=subprocess.run(args,cwd=S,capture_output=True,text=True,timeout=120)
            atomic(R/(label+'.log'),(result.stdout+'\n'+result.stderr).encode())
            if result.returncode:raise RuntimeError('Complemento não validado: '+label+'; '+falhas(result.stdout+'\n'+result.stderr))
        for rel,dest in [('deploy/dell/dell-status.py',H/'.local/bin/dell-status'),
                         ('deploy/dell/disparo-conversa.py',H/'.local/bin/disparo-conversa'),
                         ('deploy/dell/claude-ops/workflow_minimo.py',H/'.local/share/claude-ops/workflow_minimo.py')]:
            new=(S/rel).read_bytes();base=(LIVE/rel).read_bytes()
            if dest.exists() and dest.read_bytes().replace(b'\r\n',b'\n')!=base.replace(b'\r\n',b'\n'):
                tmp=R/'merge-instalado-final';tmp.mkdir(exist_ok=True)
                for n,contents in [('atual',dest.read_bytes()),('base',base),('novo',new)]:atomic(tmp/n,contents.replace(b'\r\n',b'\n'))
                m=subprocess.run(['git','merge-file','-p',str(tmp/'atual'),str(tmp/'base'),str(tmp/'novo')],capture_output=True)
                if m.returncode:raise RuntimeError('Instalado conflitante no complemento: '+str(dest.relative_to(H)))
                new=m.stdout
            compile(new,str(dest),'exec');updates[str(dest)]=(new,0o755 if dest.parent==H/'.local/bin' else 0o644)
        for timer in TIMERS:
            if state(timer)['LoadState']=='loaded':cmd('systemctl','--user','disable','--now',timer)
            marca=H/'.local/state/dell-status'/('pausa-'+timer.removesuffix('.timer'))
            updates[str(marca)]=(b'16/11/2026: operacao minima; nao retomar automaticamente.',0o600)
        for dest,(new,mode_) in updates.items():
            p=Path(dest);rel=str(p.relative_to(H))
            if rel not in meta['destinos']:
                if p.exists():backup=R/'backup/files'/rel;backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,backup);backup.chmod(0o600)
                meta['destinos'][rel]={'antes':sha(p),'modo':p.stat().st_mode&0o777 if p.exists() else None}
            atomic(p,new,mode_);meta['destinos'][rel]['depois']=sha(p)
        # Correção do retrato: leitura dos recibos uma vez por rodada, não por cadastro.
        w=api('workflows/AsjxktRCqRJSmj9P')
        reader=next(n for n in w['nodes'] if n['name']=='Site · Retrato: recibos da pasta auto')
        if reader.get('executeOnce') is not True:
            writejson(R/'backup/crm-antes-do-ajuste.json',w)
            reader['executeOnce']=True
            allowed={'executionOrder','timezone','errorWorkflow','executionTimeout','saveDataSuccessExecution','saveDataErrorExecution','saveManualExecutions','saveExecutionProgress','callerPolicy','callerIds'}
            api('workflows/'+w['id'],'PUT',{'name':w['name'],'nodes':w['nodes'],'connections':w['connections'],'settings':{k:v for k,v in w.get('settings',{}).items() if k in allowed}})
            api('workflows/'+w['id']+'/activate','POST')
        pause_guards();meta['finalizado']=True;writejson(R/'meta.json',meta)
        print(json.dumps({'release':ident,'finalizado':True,'monitor':'validado','retomadasAutomaticas':'bloqueadas','disparosRetomados':False,'backup':str(R/'backup')}))
    elif mode=='aplicar':
        CACHE.chmod(0o700);R.chmod(0o700)
        if not meta.get('validado') or meta.get('aplicado'):raise RuntimeError('Release não validado ou já aplicado')
        pause_guards();quiet()
        for rel,digest in meta['baseline'].items():
            if sha(LIVE/rel)!=digest:raise RuntimeError('Fonte mudou durante a preparação: '+rel)
        for rel,digest in meta['overlayHashes'].items():
            if sha(S/rel)!=digest:raise RuntimeError('Candidato alterado após validação: '+rel)
        for rel,digest in meta['dist'].items():
            if sha(S/'dist'/rel)!=digest:raise RuntimeError('Build alterado após validação')
        sys.path.insert(0,str(S/'deploy/dell/claude-ops'))
        from workflow_minimo import CORE,APOIO,MARCA,FALHAS
        ws=workflows()
        if any(ws[wid]['versionId']!=version for wid,version in meta['workflowVersions'].items()):raise RuntimeError('Workflow alterado durante a preparação')
        for timer in TIMERS:
            unit=timer.replace('.timer','.service')
            if state(unit)['ActiveState'] not in ('inactive','failed'):raise RuntimeError('Rotina em andamento; aguardar sem interromper: '+unit)
        aposentados=set(ws)-CORE-APOIO-{'yNLwUy5bdEmC4Qss'}
        instalacoes={}
        ledger=json.loads((S/'deploy/dell/instalados.json').read_text())['arquivos']
        for rel in meta['overlay']:
            src=S/rel
            if not src.is_file():continue
            dests=[]
            for x in ledger:
                if x['repo']==rel:
                    dest=Path(x['instalado'].replace('~',str(H)))
                    if x['instalado'].endswith('/'):dest=dest/src.name
                    dests.append((dest,int(x.get('modo','755' if '/.local/bin/' in str(dest) else '644'),8)))
            if rel.startswith('deploy/dell/claude-ops/') and src.suffix in ('.py','.js'):
                dests.append((H/'.local/share/claude-ops'/src.name,0o644))
            for dest,perms in dests:
                if not dest.resolve().is_relative_to(H.resolve()) or dest.is_symlink():raise RuntimeError('Destino instalado redirecionado')
                data=src.read_bytes();base=LIVE/rel
                if dest.is_file() and base.is_file() and dest.read_bytes().replace(b'\r\n',b'\n')!=base.read_bytes().replace(b'\r\n',b'\n'):
                    temp=R/'merge-instalado';temp.mkdir(exist_ok=True)
                    for name,contents in [('atual',dest.read_bytes()),('base',base.read_bytes()),('novo',data)]:atomic(temp/name,contents.replace(b'\r\n',b'\n'))
                    m=subprocess.run(['git','merge-file','-p',str(temp/'atual'),str(temp/'base'),str(temp/'novo')],capture_output=True)
                    if m.returncode:raise RuntimeError('Instalado diverge; conferir merge privado: '+str(dest.relative_to(H)))
                    data=m.stdout
                instalacoes[str(dest)]=(data,perms)
                if dest.suffix=='.py' or dest.name in ('frente-comercial','revisao-comercial-diaria'):
                    compile(data,str(dest),'exec')
        # As fontes são persistentes para regeneração; exports brutos nunca saem do Dell.
        fontes_manifesto={}
        for f in (R/'backup/workflows').glob('*.json'):
            fontes_manifesto[f.stem]=sha(f)
            instalacoes[str(H/'.local/share/operacao-minima/fontes'/f.name)]=(f.read_bytes(),0o600)
        instalacoes[str(H/'.local/share/operacao-minima/fontes-manifesto.json')]=(json.dumps(fontes_manifesto).encode(),0o600)
        min_config={'versao':1,'estado':'preparado-pausado','retirados':sorted(aposentados),
            'nomesReservados':sorted({w['name'] for w in ws.values()}|{'WhatsApp — entrada e passagem para Rômulo','PRUMO · Pesquisa de empresas'})}
        instalacoes[str(H/'.config/claude-ops/workflow-minimo.json')]=(json.dumps(min_config,ensure_ascii=False).encode(),0o600)
        op_path=H/'.config/claude-ops/workflow-operacao.json'
        operacao=json.loads(op_path.read_text())
        paused={x['id']:x for x in operacao['pausados']}
        for wid in aposentados:paused[wid]={'id':wid,'nome':ws[wid]['name'],'motivo':'Operação mínima de 16/11: aposentado; contratos migrados para o núcleo. Não reativar ou recriar.'}
        operacao['pausados']=list(paused.values())
        instalacoes[str(op_path)]=(json.dumps(operacao,ensure_ascii=False).encode(),0o600)
        for rel in meta['overlay']:
            p=LIVE/rel
            if p.is_symlink():raise RuntimeError('Fonte viva redirecionada: '+rel)
            instalacoes[str(p)]=((S/rel).read_bytes(),p.stat().st_mode&0o777 if p.exists() else 0o644) if (S/rel).is_file() else (None,None)
        before_units={n:state(n) for n in ['atualizar-central.timer','prumo-contexto.timer','whatsapp-observador.service','whatsapp-observador-prumo.service']}
        writejson(R/'backup/servicos-migracao.json',before_units)
        for p,(data,perms) in instalacoes.items():
            p=Path(p)
            if p.exists():
                dest=R/'backup/files'/p.relative_to(H);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest);dest.chmod(0o600)
        meta['destinos']={str(Path(p).relative_to(H)):{'antes':sha(Path(p)),'modo':(Path(p).stat().st_mode&0o777 if Path(p).exists() else None),'depois':hashlib.sha256(data).hexdigest() if data is not None else None} for p,(data,_) in instalacoes.items()}
        writejson(R/'meta.json',meta)
        for unit in ['atualizar-central.timer','prumo-contexto.timer']:cmd('systemctl','--user','stop',unit)
        for timer in TIMERS:
            if state(timer)['LoadState']=='loaded':cmd('systemctl','--user','disable','--now',timer)
        if state('prumo-mapa.path')['LoadState']=='loaded':cmd('systemctl','--user','disable','--now','prumo-mapa.path')
        # Um recibo parcial sempre mantém os disparos contidos.
        meta['emAplicacao']=True;writejson(R/'meta.json',meta)
        for unit in ['whatsapp-observador.service','whatsapp-observador-prumo.service']:cmd('systemctl','--user','stop',unit)
        try:
            for wid,w in ws.items():
                if wid in CORE|aposentados and w['active']:api('workflows/'+wid+'/deactivate','POST')
            for p,(data,perms) in instalacoes.items():
                p=Path(p)
                if data is None:
                    if p.exists():p.unlink()
                else:atomic(p,data,perms)
            # Campanha permanece desativada; a coorte antiga não é retomada implicitamente.
            campanha=DATA/'campanha-site-ativa.json';c=json.loads(campanha.read_text());c['ativo']=False
            c['pesquisaNovaDesde']=json.loads((S/'config/mensagem-inicial.json').read_text())['desde'];writejson(campanha,c)
            for file in (R/'candidatos').glob('*.json'):
                w=json.loads(file.read_text());wid=file.stem
                settings={k:v for k,v in w.get('settings',{}).items() if k in {'executionOrder','timezone','errorWorkflow','executionTimeout','saveDataSuccessExecution','saveDataErrorExecution','saveManualExecutions','saveExecutionProgress','callerPolicy','callerIds'}}
                api('workflows/'+wid,'PUT',{'name':w['name'],'nodes':w['nodes'],'connections':w['connections'],'settings':settings})
            for wid in aposentados:
                if not ws[wid].get('isArchived'):api('workflows/'+wid+'/archive','POST')
            # Medição é apoio; falhas usam o aviso sanitizado compartilhado.
            med=ws['qA5R9UXZj4UgIjFi'];med['settings']['errorWorkflow']=FALHAS
            allowed={'executionOrder','timezone','errorWorkflow','executionTimeout','saveDataSuccessExecution','saveDataErrorExecution','saveManualExecutions','saveExecutionProgress'}
            api('workflows/'+med['id'],'PUT',{'name':med['name'],'nodes':med['nodes'],'connections':med['connections'],'settings':{k:v for k,v in med['settings'].items() if k in allowed}})
            quiet();cmd('systemctl','--user','stop','squadone-operations.service')
            replacement=LIVE/('.dist-minimo-'+ident);shutil.copytree(S/'dist',replacement)
            os.replace(LIVE/'dist',R/'backup/dist');os.replace(replacement,LIVE/'dist')
            cmd('systemctl','--user','restart','luna-workflows.service')
            cmd('systemctl','--user','start','squadone-operations.service')
            for attempt in range(25):
                try:
                    f=central('/api/operations/crm/frente')
                    if f.get('ativo') is False and f.get('aquisicao',{}).get('primeirosContatosAutomaticos') is False:break
                except Exception:pass
                time.sleep(1)
            else:raise RuntimeError('Central não confirmou bloqueio após o deploy')
            for wid in CORE:api('workflows/'+wid+'/activate','POST')
            api('workflows/'+med['id']+'/activate','POST')
            for unit in ['whatsapp-observador.service','whatsapp-observador-prumo.service']:
                if before_units[unit]['ActiveState']=='active':cmd('systemctl','--user','start',unit)
            for unit in ['prumo-contexto.timer','atualizar-central.timer']:
                if before_units[unit]['ActiveState']=='active':cmd('systemctl','--user','start',unit)
            pause_guards()
            with sqlite3.connect((H/'.local/share/frente-comercial/registro.sqlite').as_uri()+'?mode=ro',uri=True) as db:
                contatos=db.execute('select count(*) from contatos').fetchone()[0]
            if contatos!=meta['contatosAntes']:raise RuntimeError('Registro de contatos mudou; conferir sem reenviar')
            meta['aplicado']=True;meta['emAplicacao']=False;writejson(R/'meta.json',meta)
            final=workflows()
            print(json.dumps({'release':ident,'aplicado':True,'nucleo':len(CORE),'ativos':sum(w['active'] for w in final.values()),
                'arquivados':sum(bool(w.get('isArchived')) for w in final.values()),'disparosRetomados':False,
                'contatosAntes':meta['contatosAntes'],'contatosDepois':contatos,'backup':str(R/'backup'),
                'aquisicao':f.get('aquisicao')},ensure_ascii=False))
        except Exception as exc:
            meta['erroAplicacao']=str(exc)[:500];writejson(R/'meta.json',meta)
            # Não improvisar uma reativação. A reversão explícita conserva o bloqueio.
            raise RuntimeError('Aplicação interrompida com disparos contidos; usar reverter: '+str(exc)) from None
    elif mode=='reverter':
        if not meta.get('emAplicacao') and not meta.get('aplicado'):raise RuntimeError('Nenhuma aplicação para reverter')
        for n in TIMERS:
            if state(n)['LoadState']=='loaded':cmd('systemctl','--user','disable','--now',n)
        quiet()
        current=workflows()
        for wid,w in current.items():
            if w['active']:api('workflows/'+wid+'/deactivate','POST')
        cmd('systemctl','--user','stop','squadone-operations.service')
        for rel,info in meta['destinos'].items():
            p=H/rel;backup=R/'backup/files'/rel
            if info['antes'] is None:
                if p.exists():p.unlink()
            else:atomic(p,backup.read_bytes(),info['modo'])
        if (R/'backup/dist').exists():
            if (LIVE/'dist').exists():os.replace(LIVE/'dist',R/('dist-revertido-'+str(int(time.time()))))
            shutil.copytree(R/'backup/dist',LIVE/'dist')
        for file in (R/'backup/workflows').glob('*.json'):
            w=json.loads(file.read_text());wid=file.stem;now=api('workflows/'+wid)
            if now.get('isArchived') and not w.get('isArchived'):api('workflows/'+wid+'/unarchive','POST')
            if w.get('isArchived'):continue
            allowed={'executionOrder','timezone','errorWorkflow','executionTimeout','saveDataSuccessExecution','saveDataErrorExecution','saveManualExecutions','saveExecutionProgress','callerPolicy','callerIds'}
            api('workflows/'+wid,'PUT',{'name':w['name'],'nodes':w['nodes'],'connections':w['connections'],'settings':{k:v for k,v in w.get('settings',{}).items() if k in allowed}})
            if w['active']:api('workflows/'+wid+'/activate','POST')
        cmd('systemctl','--user','restart','luna-workflows.service');cmd('systemctl','--user','start','squadone-operations.service')
        before=json.loads((R/'backup/servicos-migracao.json').read_text())
        for unit,info in before.items():
            if info['ActiveState']=='active':cmd('systemctl','--user','start',unit)
        pause_guards();meta['aplicado']=False;meta['emAplicacao']=False;meta['revertido']=True;writejson(R/'meta.json',meta)
        print(json.dumps({'revertido':True,'disparosRetomados':False,'backup':str(R/'backup')}))
    else:raise RuntimeError('Modo desconhecido')
