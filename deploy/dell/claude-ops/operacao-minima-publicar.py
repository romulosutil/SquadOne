"""Regenera o núcleo mínimo a partir das fontes privadas auditadas no Dell.

Sem --aplicar só valida. Não retoma campanha, timer, canal ou emissor.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
from workflow_minimo import compor, CORE

def candidatos():
    base=Path.home()/'.local/share/operacao-minima'
    manifesto=json.loads((base/'fontes-manifesto.json').read_text())
    fontes={}
    for wid,digest in manifesto.items():
        p=base/'fontes'/(wid+'.json')
        if hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise ValueError('Fonte privada alterada: '+wid)
        fontes[wid]=json.loads(p.read_text())
    mensagem=json.loads((Path.home()/'.local/bin/mensagem-inicial.json').read_text())
    return compor(fontes,mensagem)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--aplicar',action='store_true');a=p.parse_args()
    novos=candidatos()
    if a.aplicar:
        from n8n import api,put
        pasta=Path.home()/'.local/share/operacao-minima/backups'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        pasta.mkdir(parents=True,mode=0o700)
        antes={wid:api('GET','/workflows/'+wid) for wid in CORE}
        for wid,w in antes.items():
            f=pasta/(wid+'.json');f.write_text(json.dumps(w,ensure_ascii=False));f.chmod(0o600)
        for wid,w in novos.items():
            if api('GET','/workflows/'+wid)['versionId']!=antes[wid]['versionId']:raise RuntimeError('Alteração concorrente')
            put(w)
            if antes[wid]['active']:api('POST','/workflows/'+wid+'/activate')
    print(json.dumps({'aplicado':a.aplicar,'workflows':{wid:len(w['nodes']) for wid,w in novos.items()}}))

if __name__=='__main__':main()
