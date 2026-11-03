"""Custo zero exclusivamente na pesquisa e no enriquecimento de leads."""
import copy
import json
from urllib.parse import urlsplit

FLUXOS_PESQUISA = {'PRUMO · Pesquisa e higiene de leads', '01 · Caçador',
                   'PRUMO · Iris — Caçador de clínicas',
                   'PRUMO · CRM de estamparia — Caçador de estamparias'}
HOSTS_GRATUITOS = {'sheets.googleapis.com','minhareceita.org','brasilapi.com.br','servicodados.ibge.gov.br','127.0.0.1','localhost','luna-workflows','collector','172.23.0.1','romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net','aladdin-prumo-automacoes.jicnzg.easypanel.host'}


def como_codigo(n,codigo):
    n.update(type='n8n-nodes-base.code',typeVersion=2,parameters={'mode':'runOnceForAllItems','jsCode':codigo})
    for k in ['credentials','disabled','retryOnFail','maxTries','waitBetweenTries','continueOnFail','onError']:
        n.pop(k,None)


def preparar(w, _subfluxo=False):
    w=copy.deepcopy(w)
    if not _subfluxo and w.get('name') not in FLUXOS_PESQUISA:
        return w
    for n in w.get('nodes',[]):
        p=n.get('parameters',{});t=n.get('type','');url=str(p.get('url',''))
        if t=='n8n-nodes-base.executeWorkflow' and isinstance(p.get('workflowJson'),str):
            p['workflowJson']=json.dumps(preparar(json.loads(p['workflowJson']), _subfluxo=True),ensure_ascii=False)
        if any(x in t.lower() for x in ['googlegemini','openai','anthropic','lmchat','cohere']):
            como_codigo(n,"throw Error('Custo zero: modelo externo desabilitado; usar regra local ou revisão humana.');")
        elif t=='n8n-nodes-base.httpRequest':
            h=urlsplit(url).hostname or '';path=urlsplit(url).path
            proibido=h not in HOSTS_GRATUITOS or h in {'luna-workflows','127.0.0.1','172.23.0.1'} and path in {'/fonte','/inferir'}
            if proibido:
                como_codigo(n,"throw Error('Custo zero na pesquisa: API comercial ou não verificada desabilitada.');")
    return w
