import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Integra a capacidade ao host que já tem inbox e prova de identidade, preservando seus demais fluxos. */
export function integrarEstamparia(fonte) {
  if(fonte.includes('// atendimento-estamparia-v1')) {
    if(!fonte.includes('estampariaAutomatico.executar()')||!fonte.includes("'/api/operations/crm/estamparia/automacao'"))throw new Error('Integração parcial; conferir antes de repetir.')
    return fonte
  }
  const uma=(antes,depois)=>{
    if(fonte.split(antes).length!==2)throw new Error('O host de atendimento mudou; nenhuma substituição automática é segura: '+antes.slice(0,75))
    fonte=fonte.replace(antes,depois)
  }
  uma('    autorizarMaterialEncontrado=id=>encontradoAutomatico.autorizarMaterial(id);',`    // atendimento-estamparia-v1
    const estampariaAutomatico = new EstampariaAutomatico({atendimento,
      saidas:new SaidasEncontrado(path.join(operationsDataDir,'estamparia-saidas')),
      politica:leitorPoliticaEstamparia(path.join(operationsDataDir,'estamparia-automacao.json')),
      transporte:transporteEncontradoEvolution(),
      comConversa:(conversa,acao)=>crm.comConversaExclusiva(conversa,acao),
      identidadeLead:lead=>identidadeDaConversa(lead)?.conversa??null,
      verificarMensagem:(m,identidade,agora)=>{
        const tuple=mensagemDaCaptura(m)
        return tuple&&conferirIdentidadeCaptura(tuple,identidade as Parameters<typeof conferirIdentidadeCaptura>[1],agora).estado==='verificada'?tuple:null
      },
      bloqueio:(lead,leads)=>crm.bloqueioDaConversa(lead,leads)});
    autorizarMaterialEncontrado=id=>encontradoAutomatico.autorizarMaterial(id);`)
  uma('await encontradoAutomatico.executar();',`const ofertas=await Promise.allSettled([encontradoAutomatico.executar(),estampariaAutomatico.executar()]);if(ofertas.some(r=>r.status==='rejected'))console.warn('[atendimento] Uma oferta aguarda conferência; as demais continuam independentes.');`)
  uma('      const automaticos = await encontradoAutomatico.estados().catch(()=>new Map());',`      const automaticos = await encontradoAutomatico.estados().catch(()=>new Map());
      const automaticosEstamparia = await estampariaAutomatico.estados().catch(()=>new Map());`)
  uma('const auto=automaticos.get(l.id);','const auto=automaticos.get(l.id)??automaticosEstamparia.get(l.id);')
  uma('id:`encontrado-${l.id}`',"id:`${l.produto==='estampa'?'estampa':'encontrado'}-${l.id}`")
  uma("titulo:auto.acao==='time'?'Time conduz o atendimento do Encontrado':'Decisão necessária no Encontrado'","titulo:auto.acao==='time'?`Time conduz o atendimento de ${l.produto==='estampa'?'Estamparia':'Site/Encontrado'}`:`Decisão necessária em ${l.produto==='estampa'?'Estamparia':'Site/Encontrado'}`")
  uma('motivo:auto.motivo,alvo:auto.acao',"motivo:auto.motivo,texto:'proximoPasso' in auto?auto.proximoPasso:undefined,alvo:auto.acao")
  uma("    app.get('/api/operations/crm/encontrado/automacao'",`    app.get('/api/operations/crm/estamparia/automacao',async(_req,res)=>{
      res.set('Cache-Control','no-store');
      try{res.json(await estampariaAutomatico.resumo())}catch{res.status(503).json({oferta:'estampa',estado:'indisponivel',error:'Conferir a política e o journal de Estamparia.'})}
    });
    app.get('/api/operations/crm/encontrado/automacao'`)
  return `import { EstampariaAutomatico, leitorPoliticaEstamparia } from './server/estamparia-automatico.ts';
import { identidadeDaConversa } from './src/operations/responsavel-conversa.ts';
import { mensagemDaCaptura, conferirIdentidadeCaptura } from './server/identidade-captura.ts';
`+fonte
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const arquivo=path.resolve(process.argv[2]??'server.ts'),pasta=path.resolve(process.argv[3]??'output/estamparia-automatica-2026-10-26')
  const antes=await fs.readFile(arquivo,'utf8'),depois=integrarEstamparia(antes)
  if(antes===depois){console.log('Integração de Estamparia já presente.');process.exit(0)}
  await fs.mkdir(pasta,{recursive:true})
  await fs.writeFile(path.join(pasta,'server.antes.ts'),antes,{flag:'wx'})
  await fs.writeFile(arquivo+'.estampa-novo',depois)
  await fs.rename(arquivo+'.estampa-novo',arquivo)
  console.log('Integração preparada. Política e ativação continuam pendentes.')
}
