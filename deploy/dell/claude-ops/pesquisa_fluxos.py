"""Política persistente de leituras dos caçadores; aplicada também ao regenerar."""
import copy
import json

NOMES = {'01 · Caçador', 'PRUMO · Iris — Caçador de clínicas', 'PRUMO · CRM de estamparia — Caçador de estamparias'}


def melhorar_cacador(w):
    w = copy.deepcopy(w); changes = 0
    for n in w.get('nodes', []):
        p = n.get('parameters', {})
        if n.get('type') == 'n8n-nodes-base.executeWorkflow' and isinstance(p.get('workflowJson'), str):
            sub, count = melhorar_cacador(json.loads(p['workflowJson']))
            if count: p['workflowJson'] = json.dumps(sub, ensure_ascii=False); changes += count
        if n.get('type') == 'n8n-nodes-base.httpRequest' and 'places.googleapis.com' in str(p.get('url', '')):
            before = json.dumps(n, sort_keys=True)
            n.update(type='n8n-nodes-base.code', typeVersion=2,
                     parameters={'jsCode':"throw new Error('Custo zero: Google Places desabilitado. Usar fontes gratuitas e sites institucionais.');"})
            for k in ('credentials','retryOnFail','maxTries','waitBetweenTries','onError','continueOnFail'):
                n.pop(k,None)
            if before != json.dumps(n, sort_keys=True): changes += 1
    return w, changes


def preparar(w):
    return melhorar_cacador(w)[0] if w.get('name') in NOMES else w
