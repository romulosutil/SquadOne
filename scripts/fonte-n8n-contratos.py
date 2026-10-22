#!/usr/bin/env python3
"""Exercita nos reais do n8n com fixtures e webhooks temporarios, sem avisar pessoas."""
import copy
import importlib.util
import json
from pathlib import Path
import secrets
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0,str(Path.home()/'.local/share/claude-ops'))
from n8n import api, put
spec=importlib.util.spec_from_file_location('publico',Path(__file__).resolve().parents[1]/'deploy/dell/claude-ops/prumo-publico.py')
publico=importlib.util.module_from_spec(spec); spec.loader.exec_module(publico)


def main():
    casos=[]
    def rodar(nome,nos,dado,verificar):
        caminho='qa-fonte-'+secrets.token_hex(12)
        trigger={'id':'entrada','name':'Entrada QA','type':'n8n-nodes-base.webhook','typeVersion':2,
                 'position':[0,0],'webhookId':caminho,
                 'parameters':{'httpMethod':'POST','path':caminho,'responseMode':'lastNode','options':{}}}
        workflow=publico.base('QA Fonte contratos '+nome,nos)
        workflow['nodes']=[trigger,*nos]
        workflow['connections'].pop('A cada ciclo',None)
        workflow['connections'].pop('Executar manualmente',None)
        workflow['connections'][trigger['name']]={'main':[[publico.destino(nos[0]['name'])]]}
        novo=api('POST','/workflows',workflow); ident=novo['id']
        try:
            api('POST','/workflows/'+ident+'/activate')
            req=urllib.request.Request('http://127.0.0.1:5679/webhook/'+caminho,
                data=json.dumps(dado).encode(),headers={'Content-Type':'application/json'})
            for i in range(6):
                try:
                    with urllib.request.urlopen(req,timeout=30) as r: saida=json.load(r)
                    break
                except urllib.error.HTTPError as e:
                    if e.code!=404 or i==5: raise
                    e.close(); time.sleep(1)
            resultado={'caso':nome,'passou':verificar(saida),'resultado':saida}
            casos.append(resultado); print(json.dumps(resultado),flush=True)
        finally:
            try: api('POST','/workflows/'+ident+'/deactivate')
            finally: api('DELETE','/workflows/'+ident)

    w=api('GET','/workflows/yNLwUy5bdEmC4Qss')
    provider=copy.deepcopy(next(n for n in w['nodes'] if n['name']=='Consultar base com Luna'))
    provider['parameters']['jsonBody']='={{ JSON.stringify({empresa:"qa-fonte-inexistente",perfil:"vendedor",pergunta:"Fixture de homologacao"}) }}'
    provider['onError']='continueRegularOutput'
    rodar('falha-real-do-provedor',[provider,publico.code('Verificar recusa',
        "const d=JSON.stringify($input.first().json); return [{json:{recusado:/503/.test(d)}}];")],{},lambda d:d.get('recusado') is True)

    rodar('alerta-sem-conteudo',[
        publico.code('Ler fixture', 'return [{json:$input.first().json.body}];'),
        publico.code('Sanitizar alerta',publico.FALHA_JS),
        publico.code('Conferir alerta',"const t=Buffer.from($input.first().binary.data.data,'base64').toString('utf8'); return [{json:{semConteudo:!t.includes('SEGREDO-FICTICIO'),idPreservado:t.includes('12345')}}];")],
        {'execution':{'id':'12345','error':{'message':'SEGREDO-FICTICIO'},'data':{'pergunta':'SEGREDO-FICTICIO'}}},
        lambda d:d=={'semConteudo':True,'idPreservado':True})

    separar=copy.deepcopy(next(n for n in w['nodes'] if n['name']=='Separar pergunta'))
    expr=next(n for n in w['nodes'] if n['name']=='Confirmar resposta salva')['parameters']['jsonBody'].removeprefix('={{ ').removesuffix(' }}')
    confirmar=publico.code('Correlacionar conclusao','return {json:JSON.parse('+expr+')};')
    confirmar['parameters']['mode']='runOnceForEachItem'
    rodar('correlacao-de-dois-itens',[
        publico.code('Preparar fila ficticia',"return [{json:{pedidos:[{id:'um',lease:'lease-um'},{id:'dois',lease:'lease-dois'}]}}];"),
        separar,publico.code('Provedor ficticio',"return $input.all().map((x,i)=>({json:{tipo:'ok'},pairedItem:{item:i}}));"),
        confirmar,publico.code('Conferir pares',"const d=$input.all().map(x=>x.json);return [{json:{correto:d.length===2&&d[0].id==='um'&&d[0].lease==='lease-um'&&d[1].id==='dois'&&d[1].lease==='lease-dois'}}];")],
        {},lambda d:d.get('correto') is True)

    destino=Path.home()/'.local/state/prumo-fonte/homologacao-20261022/contratos-n8n.json'
    destino.parent.mkdir(parents=True,exist_ok=True)
    destino.write_text(json.dumps({'casos':casos,'passou':all(c['passou'] for c in casos)},indent=2)+'\n')
    return 0 if all(c['passou'] for c in casos) else 1


if __name__=='__main__': raise SystemExit(main())
