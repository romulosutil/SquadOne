/** Uma visão para a projeção da tela; os envios continuam sem visão fornecida. */
export function integrarLeituraEstamparia(servidor,atendimento) {
  const assinatura="async contextoDaEntrada(chave: string, visaoFornecida?: Awaited<ReturnType<DependenciasAtendimentoComercial['visao']>>) {"
  const leitura="const visao = visaoFornecida ?? await this.deps.visao()\n    return { registro, fonte, conferencia, visao }"
  const ancora='const automaticosEstamparia = await estampariaAutomatico.estados().catch(()=>new Map());'
  const nova='const automaticosEstamparia = await estampariaAutomatico.estados(v).catch(()=>new Map()); // leitura-estamparia-v1'
  if(servidor.includes(nova)&&atendimento.includes(assinatura)&&atendimento.includes(leitura))return {servidor,atendimento}
  const trocar=(s,a,b)=>{if(s.split(a).length!==2)throw new Error('Leitura do host mudou; conferir antes de substituir.');return s.replace(a,b)}
  atendimento=trocar(atendimento,'async contextoDaEntrada(chave: string) {',assinatura)
  atendimento=trocar(atendimento,'const visao = await this.deps.visao()\n    return { registro, fonte, conferencia, visao }',leitura)
  servidor=trocar(servidor,ancora,nova)
  return {servidor,atendimento}
}
