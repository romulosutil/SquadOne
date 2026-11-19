"""Gera o aviso geral com metadados operacionais aprovados."""

import json


ETAPAS_APOIO = {
    'TunkKi3HnYLXJati': ['Preparar rodada', 'Entregar ao Dell'],
    'Sk4A9PMCD35y6rrJ': ['Preparar pedido sem dados de contatos', 'Entregar ao agente do Dell'],
    'OhFg51gIIWnmIF6r': ['Consultar pesquisa Google do Prumo', 'Ler relatórios recentes',
                         'Ler JSON dos relatórios', 'Preparar relatório para Rômulo', 'Gravar pesquisa do dia'],
    'qA5R9UXZj4UgIjFi': ['Ler páginas publicadas', 'Ler registro de páginas', 'Registrar origens das páginas',
                         'Origens mudaram?', 'Autorizar páginas publicadas', 'Lembrar origens enviadas',
                         'Ler contagens duráveis', 'Preparar retrato da medição', 'Salvar medição no painel privado'],
}


def codigo(fluxos):
    etapas = {wid: [n['name'] for n in w['nodes']] for wid, w in fluxos.items()}
    etapas.update(ETAPAS_APOIO)
    for wid in ('TunkKi3HnYLXJati', 'Sk4A9PMCD35y6rrJ'):
        etapas[wid] = etapas[wid] + ['Preparar comprovante de entrega', 'Salvar comprovante no Dell']
    return 'const etapas = ' + json.dumps(etapas, ensure_ascii=False) + r""";
return $input.all().map(({json}) => {
  const workflowId = json.workflow?.id;
  const conhecido = typeof workflowId === 'string' && Object.hasOwn(etapas, workflowId);
  const execucao = String(json.execution?.id ?? '');
  const candidato = json.execution?.lastNodeExecuted;
  const etapa = conhecido && etapas[workflowId].includes(candidato)
    ? candidato : json.trigger ? 'gatilho' : 'execução (consulte o painel privado)';
  const horario = new Date().toISOString();
  const texto = [
    'Fluxo ' + (conhecido ? workflowId : 'fora do catálogo'),
    'Etapa: ' + etapa,
    'Detectado em: ' + horario,
    'Responsável: Operação n8n',
    ...(/^[0-9]{1,20}$/.test(execucao) ? ['Execução: ' + execucao] : []),
  ].join('\n');
  const aviso = {titulo:'Falha no n8n', texto, origem:('n8n:'+$workflow.name).slice(0,80)};
  return {json:{},binary:{data:{data:Buffer.from(JSON.stringify(aviso)).toString('base64'),
    mimeType:'application/json',fileName:'aviso.json'}}};
});"""
