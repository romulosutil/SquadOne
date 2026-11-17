// Contratos dos exports históricos. Não publica nem ativa workflows.
export function protectWorkflow(w) {
  const byName = name => w.nodes.find(n => n.name === name)
  const aggregate = byName('Agrupar e calcular Índice Prumo')
  if (aggregate && !aggregate.parameters.jsCode.includes('[empresa-por-id]')) {
    aggregate.parameters.jsCode = aggregate.parameters.jsCode
      .replace("const companyRefs = [...new Set(allRows.map(row => String(row['Empresa'] ?? '').trim()).filter(Boolean))];",
        "// [empresa-por-id] Nome e capitalização não mudam a identidade.\nconst companyRefs = [...new Map(allRows.map(row => String(row['Empresa'] ?? '').trim()).filter(ref => ref.includes('::')).map(ref => [ref.split('::')[0].trim().toLowerCase(),ref])).values()];")
      .replace("norm(row['Empresa']) === norm(companyRef)", "norm(String(row['Empresa'] ?? '').split('::')[0]) === norm(companyId)")
  }
  for (const name of ['Briefing do relatório — revisão humana', 'Aguardar sessões faltantes']) {
    const n = byName(name)
    if (!n || n.parameters.jsCode.includes('[todos-os-itens]')) continue
    let code = n.parameters.jsCode
    code = code.replace("'Etapa': 'Diagnóstico para revisar'", "'Etapa': $json._etapaPreservada || 'Diagnóstico para revisar'")
      .replace("'Etapa': 'Diagnóstico em andamento'", "'Etapa': $json._etapaPreservada || 'Diagnóstico em andamento'")
      .replace("'Diagnóstico concluído em': now", "'Diagnóstico concluído em': $json._concluidoEm || now")
      .replace("'Próxima ação': 'Revise o briefing e conduza o workshop de priorização.'", "'Próxima ação': $json._etapaPreservada ? $json._proximaAcao : 'Revise o briefing e conduza o workshop de priorização.'")
      .replace("'Próxima ação': `Aguarde as respostas de: ${$json.pendingRoles.join(\", \")}`", "'Próxima ação': $json._etapaPreservada ? $json._proximaAcao : `Aguarde as respostas de: ${$json.pendingRoles.join(\", \")}`")
    n.parameters.jsCode = "// [todos-os-itens] Uma saída por empresa.\nconst items = typeof $input !== 'undefined' && $input?.all ? $input.all() : [{json:$json}];\nreturn items.flatMap(({json:$json})=>{\n" + code + '\n});'
  }
  if (aggregate && !byName('Relacionar diagnóstico à fila')) {
    const writer = byName('Devolver briefing ao lead')
    const reader = structuredClone(writer)
    reader.id = 'diagnostico-ler-fila'; reader.name = 'Ler fila do diagnóstico'
    reader.parameters = {operation:'read',documentId:reader.parameters.documentId,sheetName:reader.parameters.sheetName,options:{}}
    reader.alwaysOutputData = true; reader.position = [-300,-200]
    const guard = {id:'diagnostico-relacionar',name:'Relacionar diagnóstico à fila',type:'n8n-nodes-base.code',typeVersion:2,position:[100,200],parameters:{mode:'runOnceForAllItems',jsCode:`const known=new Map($('Ler fila do diagnóstico').all().map(({json:l})=>[String(l['ID da empresa']??'').trim().toLowerCase(),l]));
return $input.all().flatMap(({json:d})=>{
 const l=known.get(String(d.company_id??'').toLowerCase());if(!l)return [];
 const etapa=String(l.Etapa??'').trim();
 const preservar=!['','Revisar','Contato aceito','Convite pronto','Diagnóstico em andamento','Diagnóstico para revisar'].includes(etapa);
 const proxima=d.status==='READY'?'Revisão necessária':'Aguardando respostas';
 const same=String(l['Última resposta em']??'')===String(d.lastResponseAt??'') && String(l['Índice PRUMO']??'')===String(d.prumoIndex??'') && String(l['Situação do diagnóstico']??'')===proxima && String(l['Resultado por área']??'')===JSON.stringify(d.areas) && String(l['Lacunas observadas']??'')===JSON.stringify(d.gaps);
 if(same)return [];
 return [{json:{...d,company_id:l['ID da empresa'],_etapaPreservada:preservar?etapa:'',_proximaAcao:l['Próxima ação']??'',_concluidoEm:l['Diagnóstico concluído em']??''}}];
});`}}
    const edge=name=>({node:name,type:'main',index:0})
    for (const trigger of w.nodes.filter(n => n.type.endsWith('scheduleTrigger') || n.type.endsWith('manualTrigger'))) {
      w.connections[trigger.name]={main:[[edge(reader.name)]]}
    }
    w.connections[reader.name]={main:[[edge('Ler todas as sessões da empresa')]]}
    w.connections[aggregate.name]={main:[[edge(guard.name)]]}
    w.connections[guard.name]={main:[[edge('Cinco sessões completas?')]]}
    w.nodes.push(reader,guard)
    for(const name of ['Devolver briefing ao lead','Atualizar pendência no lead'])byName(name).parameters.operation='update'
  }
  const invite=byName('Preparar convite do diagnóstico')
  if(invite && !invite.parameters.jsCode.includes('[nao-contatar]')) {
    invite.parameters.jsCode=invite.parameters.jsCode.replace("  const status = normalizeState", "  // [nao-contatar] Bloqueio humano prevalece sobre a etapa.\n  if (['SIM','TRUE','1','YES'].includes(normalizeState(value(lead,'Não contatar','do_not_contact')))) return [];\n  const status = normalizeState")
  }
  const confirm=byName('Confirmar WhatsApp publicado')
  if(confirm && !confirm.parameters.jsCode.includes('[escapes-html]')) {
    confirm.parameters.jsCode=confirm.parameters.jsCode.replace("  let decoded = decodeEntities(rawHtml);",String.raw`  // [escapes-html] Links serializados em JSON também são links publicados.
  let decoded = decodeEntities(rawHtml.replace(/\\\//g,'/').replace(/\\u0026/gi,'&'));`)
  }
  for(const n of w.nodes.filter(n=>['Preparar busca de WhatsApp','Continuar sem site válido'].includes(n.name))) {
    if(n.parameters.jsCode.includes('[ip-publico]'))continue
    n.parameters.jsCode=n.parameters.jsCode.replace('const blockedHost =',"// [ip-publico] IP abreviado, hexadecimal, octal e rede da tailnet não são destinos públicos.\n    const ambiguo = /^[0-9.]+$/.test(host) && (host.split('.').length !== 4 || host.split('.').some(x=>! /^(0|[1-9][0-9]{0,2})$/.test(x))) || /(^|\\.)0x[0-9a-f]+/i.test(host) || /^100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\./.test(host) || /^0\\./.test(host);\n    const blockedHost = ambiguo ||")
  }
  return w
}
