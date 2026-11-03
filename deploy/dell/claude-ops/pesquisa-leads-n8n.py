"""Instala e valida pesquisa sem mensagem; execução limitada à semana autorizada."""
import copy
import json
from pathlib import Path
import sys

NOME = 'PRUMO · Pesquisa e higiene de leads'


def workflow(credencial):
    edge=lambda n:{'node':n,'type':'main','index':0}
    nodes=[
      {'id':'manual','name':'Pesquisar agora','type':'n8n-nodes-base.manualTrigger','typeVersion':1,'position':[0,180],'parameters':{}},
      {'id':'webhook','name':'Revisão autenticada','type':'n8n-nodes-base.webhook','typeVersion':2,'position':[0,360],
       'webhookId':'prumo-pesquisa-leads-20261101','parameters':{'httpMethod':'POST','path':'prumo-pesquisa-leads','authentication':'headerAuth','responseMode':'lastNode','options':{}},
       'credentials':{'httpHeaderAuth':{'id':credencial,'name':'Luna dos workflows (Dell)'}}},
      {'id':'agenda','name':'Revisar durante a semana','type':'n8n-nodes-base.scheduleTrigger','typeVersion':1.2,'position':[0,0],
       'parameters':{'rule':{'interval':[{'field':'cronExpression','expression':'10 7,12,18 * * 1-5'}]}}},
      {'id':'janela','name':'Conferir semana autorizada','type':'n8n-nodes-base.code','typeVersion':2,'position':[240,0],
       'parameters':{'jsCode':"const dia = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date()); const limite = dia >= '2026-11-01' && dia <= '2026-11-06' ? 10 : 0; return [{json:{limite}}];"}},
      {'id':'pesquisa','name':'Pesquisar e higienizar sem envio','type':'n8n-nodes-base.httpRequest','typeVersion':4.4,'position':[500,0],
       'parameters':{'method':'POST','url':'http://luna-workflows:8766/pesquisa-leads','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth',
                     'sendBody':True,'specifyBody':'json','jsonBody':'={{ JSON.stringify({limite:$json.limite}) }}','options':{'timeout':330000}},
       'credentials':{'httpHeaderAuth':{'id':credencial,'name':'Luna dos workflows (Dell)'}}},
      {'id':'conferir','name':'Conferir conclusão da pesquisa','type':'n8n-nodes-base.code','typeVersion':2,'position':[760,0],
       'parameters':{'jsCode':"const r=$input.first().json;if(r.ok!==true || (r.estado!=='pesquisa-em-andamento' && (!r.versao || r.mensagensEnviadas!==0 || r.registrosComerciaisAlterados!==0 || r.politicaCusto!=='zero' || !Array.isArray(r.provedoresPagosHabilitados) || r.provedoresPagosHabilitados.length!==0)))throw Error('Pesquisa sem conclusão verificável ou fora da política de custo zero');return [{json:r}];"}}
    ]
    return {'name':NOME,'nodes':nodes,'connections':{'Pesquisar agora':{'main':[[edge('Conferir semana autorizada')]]},'Revisão autenticada':{'main':[[edge('Conferir semana autorizada')]]},'Revisar durante a semana':{'main':[[edge('Conferir semana autorizada')]]},'Conferir semana autorizada':{'main':[[edge('Pesquisar e higienizar sem envio')]]},'Pesquisar e higienizar sem envio':{'main':[[edge('Conferir conclusão da pesquisa')]]}},
      'settings':{'timezone':'America/Sao_Paulo','executionOrder':'v1','executionTimeout':360,'saveDataSuccessExecution':'none','saveDataErrorExecution':'all','saveManualExecutions':False}}


def melhorar_cacador(w):
    from pesquisa_fluxos import melhorar_cacador as aplicar
    return aplicar(w)


def instalar():
    from n8n import api,put
    h=Path.home();base=h/'.cache/mel-work/leads-20261101';creds=(h/'.config/claude-ops/luna-workflows-cred').read_text().strip()
    existentes=api('GET','/workflows?limit=100')['data'];changes=[]
    for w in existentes:
        if w['name'] not in ['01 · Caçador','PRUMO · Iris — Caçador de clínicas','PRUMO · CRM de estamparia — Caçador de estamparias']:continue
        new,count=melhorar_cacador(w)
        if not count:continue
        before=api('GET','/workflows/'+w['id'])
        assert before['versionId']==w['versionId'],'Workflow alterado concorrentemente'
        result=put(new)
        check=api('GET','/workflows/'+w['id']);assert check['active']==w['active'],'Estado ativo foi alterado'
        changes.append({'id':w['id'],'nome':w['name'],'alteracoes':count,'ativo':check['active']})
    new=workflow(creds);existing=next((w for w in existentes if w['name']==NOME),None)
    if existing:new['id']=existing['id'];result=put(new)
    else:result=api('POST','/workflows',new)
    api('POST','/workflows/'+result['id']+'/activate')
    changes.append({'id':result['id'],'nome':NOME,'ativo':True,'fimDaJanela':'2026-11-06'})
    p=base/'n8n-publicacao.json';p.write_text(json.dumps(changes,ensure_ascii=False,indent=2));p.chmod(0o600)
    print(json.dumps(changes,ensure_ascii=False))


if __name__=='__main__':instalar()
