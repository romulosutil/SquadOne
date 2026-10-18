"""Troca só a inferência do Caçador; credencial vem do cofre do n8n."""
import copy
import json


def usar_luna(wf, credencial):
    wf = copy.deepcopy(wf)
    if wf.get('name') != '01 · Caçador':
        return wf
    for n in wf['nodes']:
        if n['type'] == 'n8n-nodes-base.executeWorkflow':
            filho = json.loads(n['parameters']['workflowJson'])
            filho['name'] = wf['name']
            n['parameters']['workflowJson'] = json.dumps(usar_luna(filho, credencial), ensure_ascii=False)
        tarefas = {'Gemini: classificar e checar na web': 'classificar', 'Gemini: resumir avaliações': 'resumir'}
        if n['name'] not in tarefas or n['type'] != '@n8n/n8n-nodes-langchain.googleGemini':
            continue
        prompt = n['parameters']['messages']['values'][0]['content']
        n['type'] = 'n8n-nodes-base.httpRequest'
        n['typeVersion'] = 4.4
        n['retryOnFail'] = False  # Uma tentativa por item, com prazo e teto no serviço.
        n['notes'] = 'Luna do Hermes (gpt-6-luna-900k). Nome preservado para os vínculos do fluxo. Sem envio ou ferramentas de escrita.'
        n['credentials'] = {'httpHeaderAuth': {'id': credencial, 'name': 'Luna dos workflows (Dell)'}}
        n['parameters'] = {'method': 'POST', 'url': 'http://luna-workflows:8766/inferir',
            'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth', 'sendBody': True,
            'bodyParameters': {'parameters': [{'name': 'tarefa', 'value': tarefas[n['name']]}, {'name': 'prompt', 'value': prompt}]},
            'options': {'timeout': 180000, 'batching': {'batch': {'batchSize': 1, 'batchInterval': 200}}}}
    return wf
