"""Recibo local de entrega de um pedido, gravado depois da escrita da fila."""

from workflow_minimo import edge


RECIBO_JS = """const {workflowId, criadoEm} = $input.first().json;
const execucaoId = String($execution.id);
if (workflowId !== String($workflow.id) || !/^[0-9]{1,20}$/.test(execucaoId)
    || !Number.isFinite(Date.parse(criadoEm))) throw new Error('Pedido sem identificação');
const recibo = {versao: 1, workflowId, execucaoId, criadoEm};
return [{json: recibo, binary: {data: {
  data: Buffer.from(JSON.stringify(recibo)).toString('base64'),
  mimeType: 'application/json', fileName: 'ultima-entrega.json',
}}}];"""


def com_recibo(workflow, entrega, pasta):
    montar = 'Preparar comprovante de entrega'
    gravar = 'Salvar comprovante no Dell'
    workflow['nodes'].extend([
        {'id': 'comprovante-entrega', 'name': montar, 'type': 'n8n-nodes-base.code',
         'typeVersion': 2, 'position': [760, 0], 'parameters': {'jsCode': RECIBO_JS}},
        {'id': 'salvar-comprovante-entrega', 'name': gravar, 'type': 'n8n-nodes-base.readWriteFile',
         'typeVersion': 1.1, 'position': [980, 0],
         'parameters': {'operation': 'write', 'dataPropertyName': 'data',
                        'fileName': f'{pasta}/ultima-entrega.json'}},
    ])
    workflow['connections'][entrega] = {'main': [[edge(montar)]]}
    workflow['connections'][montar] = {'main': [[edge(gravar)]]}
    return workflow
