"""Agenda LinkedIn no n8n. O agente e o navegador executam somente no Dell."""
import argparse
import json

from agenda_n8n import com_recibo
from workflow_minimo import FALHAS, edge

NOME = 'PRUMO · LinkedIn — prospectar e primeiro contato'
PASTA = '/home/node/.n8n-files/estado/linkedin'

def workflow():
    montar="""const agora=new Date();
const pedido={versao:1,origem:'n8n-linkedin',workflowId:String($workflow.id),execucaoId:String($execution.id),criadoEm:agora.toISOString(),expiraEm:new Date(agora.getTime()+15*60000).toISOString()};
return [{json:pedido,binary:{data:{data:Buffer.from(JSON.stringify(pedido)).toString('base64'),mimeType:'application/json',fileName:'rodada.json'}}}];"""
    grafo = {'name':NOME,'nodes':[
      {'id':'agenda-linkedin','name':'A cada 10 minutos','type':'n8n-nodes-base.scheduleTrigger','typeVersion':1.2,'position':[0,0],
       'parameters':{'rule':{'interval':[{'field':'cronExpression','expression':'0 */10 * * * *'}]}}},
      {'id':'manual-linkedin','name':'Solicitar rodada agora','type':'n8n-nodes-base.manualTrigger','typeVersion':1,'position':[0,180],'parameters':{}},
      {'id':'pedido-linkedin','name':'Preparar pedido sem dados de contatos','type':'n8n-nodes-base.code','typeVersion':2,'position':[280,0],'parameters':{'jsCode':montar}},
      {'id':'fila-linkedin','name':'Entregar ao agente do Dell','type':'n8n-nodes-base.readWriteFile','typeVersion':1.1,'position':[540,0],
       'parameters':{'operation':'write','dataPropertyName':'data','fileName':"={{ '"+PASTA+"/pedidos/rodada-' + $execution.id + '.json' }}"}}
    ],'connections':{
      'A cada 10 minutos':{'main':[[edge('Preparar pedido sem dados de contatos')]]},
      'Solicitar rodada agora':{'main':[[edge('Preparar pedido sem dados de contatos')]]},
      'Preparar pedido sem dados de contatos':{'main':[[edge('Entregar ao agente do Dell')]]}},
      'settings':{'timezone':'America/Sao_Paulo','executionOrder':'v1','executionTimeout':60,'saveDataSuccessExecution':'all','saveDataErrorExecution':'all','saveManualExecutions':True,'errorWorkflow':FALHAS}}
    return com_recibo(grafo, 'Entregar ao agente do Dell', PASTA)


if __name__ == '__main__':
    argparse.ArgumentParser(description='Gera o grafo. Publique pelo operacao-minima-publicar.py.').parse_args()
    print(json.dumps(workflow(), ensure_ascii=False))
