"""Fonte da agenda de primeiros contatos do WhatsApp no n8n do Dell."""
import argparse
import json

from agenda_n8n import com_recibo
from workflow_minimo import FALHAS

NOME = 'PRUMO · WhatsApp — repor fila e iniciar primeiros contatos'
PASTA = '/home/node/.n8n-files/estado/whatsapp-prospeccao'


def workflow():
    montar = """const pedido = {workflowId: String($workflow.id), criadoEm: new Date().toISOString()};
return [{json: pedido, binary: {data: {
  data: Buffer.from(JSON.stringify(pedido)).toString('base64'),
  mimeType: 'application/json', fileName: 'rodada.json',
}}}];"""
    preparar = 'Preparar rodada'
    entregar = 'Entregar ao Dell'
    agenda = 'A cada dois minutos'
    manual = 'Solicitar rodada agora'
    def ligar(nome):
        return {'main': [[{'node': nome, 'type': 'main', 'index': 0}]]}
    grafo = {
        'name': NOME,
        'nodes': [
            {'id': 'agenda', 'name': agenda, 'type': 'n8n-nodes-base.scheduleTrigger', 'typeVersion': 1.2,
             'position': [0, 0], 'parameters': {'rule': {'interval': [{'field': 'minutes', 'minutesInterval': 2}]}}},
            {'id': 'manual', 'name': manual, 'type': 'n8n-nodes-base.manualTrigger', 'typeVersion': 1,
             'position': [0, 160], 'parameters': {}},
            {'id': 'preparar', 'name': preparar, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
             'position': [240, 0], 'parameters': {'jsCode': montar}},
            {'id': 'entregar', 'name': entregar, 'type': 'n8n-nodes-base.readWriteFile', 'typeVersion': 1.1,
             'position': [480, 0], 'parameters': {'operation': 'write', 'dataPropertyName': 'data',
                                                  'fileName': f'{PASTA}/rodada.json'}},
        ],
        'connections': {agenda: ligar(preparar), manual: ligar(preparar), preparar: ligar(entregar)},
        'settings': {'timezone': 'America/Sao_Paulo', 'executionOrder': 'v1', 'executionTimeout': 60,
                     'saveDataErrorExecution': 'all', 'errorWorkflow': FALHAS},
    }
    return com_recibo(grafo, entregar, PASTA)


if __name__ == '__main__':
    argparse.ArgumentParser(description='Gera o grafo. Publique pelo operacao-minima-publicar.py.').parse_args()
    print(json.dumps(workflow(), ensure_ascii=False))
