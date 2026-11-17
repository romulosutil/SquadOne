"""Publicador seletivo: palco Linux, merge de fontes, recibos e pausa obrigatória."""
import argparse
import base64
import json
from pathlib import Path
import shlex
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'outputs/simplificacao-dell-20261116'

def main():
    p=argparse.ArgumentParser()
    p.add_argument('modo',choices=['preparar','validar','aplicar','conferir','reverter','resolver','logs','finalizar'])
    p.add_argument('--arquivo')
    args=p.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    request={'modo':args.modo}
    if args.modo=='preparar':
        names=subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT,text=True).splitlines()
        names += subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()
        names=[n for n in names if not n.startswith('deploy/dell/auto-site/') and n!='scripts/prumo-workflow-guards.mjs']
        request['arquivos']=[]
        for name in sorted(set(names)):
            f=ROOT/name
            old=subprocess.run(['git','show','HEAD:'+name],cwd=ROOT,capture_output=True)
            request['arquivos'].append({'path':name,
                'antes':base64.b64encode(old.stdout).decode() if old.returncode==0 else None,
                'depois':base64.b64encode(f.read_bytes()).decode() if f.is_file() else None})
    else:
        request['release']=json.loads((OUT/'preparar.json').read_text(encoding='utf-8'))['release']
    if args.modo=='resolver':
        if not args.arquivo:p.error('--arquivo necessário')
        request['path']=args.arquivo
        request['depois']=base64.b64encode((ROOT/args.arquivo).read_bytes()).decode()
    if args.modo=='finalizar':
        names=['deploy/dell/dell-status.py','deploy/dell/dell-status.test.py','deploy/dell/operacao-minima-monitor.test.py',
            'deploy/dell/disparo-conversa.py','deploy/dell/disparo-conversa.test.py',
            'deploy/dell/claude-ops/workflow_minimo.py','deploy/dell/operacao_minima_deploy.py',
            'scripts/publicar-operacao-minima.py','ops/n8n/README.md','ops/n8n/CATALOGO.md',
            'deploy/dell/README.md','CLAUDE.md']
        request['arquivosFinalizacao']=[]
        for name in names:
            old=subprocess.run(['git','show','HEAD:'+name],cwd=ROOT,capture_output=True)
            request['arquivosFinalizacao'].append({'path':name,'antes':base64.b64encode(old.stdout).decode() if old.returncode==0 else None,
                'depois':base64.b64encode((ROOT/name).read_bytes()).decode()})
    request['engine']=base64.b64encode((ROOT/'deploy/dell/operacao_minima_deploy.py').read_bytes()).decode()
    command='python3 -c '+shlex.quote("import sys,json,base64;request=json.load(sys.stdin);exec(compile(base64.b64decode(request['engine']),'<operacao-minima-deploy>','exec'))")
    r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15','mel',command],
        input=json.dumps(request).encode(),capture_output=True)
    sys.stdout.reconfigure(encoding='utf-8')
    if r.stdout:
        s=r.stdout.decode('utf-8',errors='replace')
        try:
            data=json.loads(s)
            (OUT/(args.modo+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
            for name,content in data.get('conflitosConteudo',{}).items():
                dest=OUT/'conflitos'/name;dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(base64.b64decode(content))
            print(json.dumps({k:v for k,v in data.items() if k!='conflitosConteudo'},ensure_ascii=False))
        except ValueError:print(s)
    if r.stderr:print(r.stderr.decode('utf-8',errors='replace'),file=sys.stderr)
    raise SystemExit(r.returncode)

if __name__=='__main__':main()
