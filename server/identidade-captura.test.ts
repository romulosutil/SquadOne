import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {criarLeitorIdentidadeCaptura, conferirIdentidadeCaptura, validarConfigIdentidadeCaptura, validarProvaIdentidadeCaptura, mensagemDaCaptura, type ProvaIdentidadeCaptura} from './identidade-captura.ts'
import {AtendimentoComercial, conferirFonteAtendimento, criarLeitorFonteAtendimento, criarInventarioCapturasAtendimento} from './atendimento-comercial.ts'
import {EntradaAtendimentoComercialDuravel, type EventoAtendimentoComercial} from './entrada-atendimento-comercial.ts'
import type {CrmLead} from '../src/operations/types.ts'

const AGORA=Date.parse('2026-10-24T10:00:00Z'),EM='2026-10-23T17:00:00Z',CAPTURADO='2026-10-24T09:00:00Z',DESDE='2026-10-24T08:00:00Z',CONVERSA='2799991234'
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
const config={v:1 as const,identidadePrumoHash:sha('conta-prumo-ficticia'),desde:DESDE}
const raw=(extra:Record<string,unknown>={})=>({id:'mensagem-ficticia-001',origem:'pessoal',direcao:'entrada',em:EM,texto:'Preciso organizar meus contatos',...extra})
const evento=(m=raw()):EventoAtendimentoComercial=>({idOriginal:String(m.id),origem:'whatsapp',conta:'prumo',canal:'whatsapp',conversa:CONVERSA,tipo:'resposta',direcao:'entrada',ocorridoEm:String(m.em),recebidoEm:new Date(AGORA).toISOString(),conteudoHash:sha(String(m.texto)),fonteId:String(m.id)})
function prova(m=raw(),delta:Partial<ProvaIdentidadeCaptura>={}):ProvaIdentidadeCaptura {
  return {v:1,coletor:'hermes',contaHash:config.identidadePrumoHash,garantia:'socket-hermes',sessaoHash:sha('sessao-ficticia'),instancia:null,capturadoEm:CAPTURADO,mensagem:mensagemDaCaptura(m)!,...delta}
}
const lead=():CrmLead=>({id:'site:fixture',produto:'site',empresa:'Empresa fictícia',etapa:'contato',links:{whatsapp:'https://wa.me/552799991234'},eventos:[],marcos:{},notas:0,
  conversa:{desde:EM,mensagens:1,ultima:{direcao:'entrada',em:EM,trecho:'Preciso organizar meus contatos'},ultimaEntrada:EM}} as CrmLead)
async function fixture(t:{after:(f:()=>Promise<unknown>)=>void},comConfig=true){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'identidade-captura-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const identidades=path.join(dir,'identidades'),capturas=path.join(dir,'capturas');await fs.mkdir(identidades);await fs.mkdir(capturas)
  if(comConfig)await fs.writeFile(path.join(identidades,'config.json'),JSON.stringify(config))
  const lerIdentidade=criarLeitorIdentidadeCaptura(identidades,()=>AGORA),lerFonte=criarLeitorFonteAtendimento(capturas,lerIdentidade)
  const inbox=new EntradaAtendimentoComercialDuravel(path.join(dir,'derivado/inbox.json'))
  let leads=[lead()]
  const visao=async()=>({estado:'ok' as const,geradoEm:new Date(AGORA).toISOString(),leads})
  const criar=()=>new AtendimentoComercial({inbox,lerFonte,lerIdentidade,inventariarCapturas:criarInventarioCapturasAtendimento(capturas,lerIdentidade),visao,agora:()=>AGORA})
  const controlador=criar()
  const escreverRaw=async(ms:unknown[],conversa=CONVERSA)=>fs.writeFile(path.join(capturas,conversa+'.jsonl'),ms.map(m=>typeof m==='string'?m:JSON.stringify(m)).join('\n'))
  const escreverProvas=async(ps:unknown[],conversa=CONVERSA)=>fs.writeFile(path.join(identidades,conversa+'.jsonl'),ps.map(p=>typeof p==='string'?p:JSON.stringify(p)).join('\n'))
  return {dir,identidades,capturas,lerIdentidade,lerFonte,inbox,controlador,criar,escreverRaw,escreverProvas,leads:()=>leads,setLeads:(v:CrmLead[])=>{leads=v}}
}

test('schema exato vincula Hermes à sessão real e Evolution ao webhook da instância Prumo',()=>{
  assert.deepEqual(validarConfigIdentidadeCaptura(config),config)
  assert.deepEqual(validarProvaIdentidadeCaptura(prova()),prova())
  const evo=prova(raw(),{coletor:'evolution',garantia:'webhook-evolution',instancia:'prumo',sessaoHash:null})
  assert.deepEqual(validarProvaIdentidadeCaptura(evo),evo)
  for(const p of [{...prova(),sessaoHash:null},{...evo,sessaoHash:sha('inventada')},{...evo,instancia:null},{...prova(),garantia:'webhook-evolution'},{...prova(),extra:true},{...prova(),mensagem:{...prova().mensagem,conteudoHash:'invalido'}}])assert.throws(()=>validarProvaIdentidadeCaptura(p))
  for(const c of [{...config,extra:true},{...config,identidadePrumoHash:'conta'},{...config,desde:'2026-02-30T00:00:00Z'}])assert.throws(()=>validarConfigIdentidadeCaptura(c))
})

test('sem config preserva conferência legada e não reconcilia capturas pessoais',async t=>{
  const f=await fixture(t,false);await f.escreverRaw([raw()]);const estado=await f.lerIdentidade(CONVERSA)
  assert.equal(estado.ativa,false);assert.equal((await f.controlador.reconciliarCapturas()).modo,'legado');assert.deepEqual(await f.inbox.listar(),[])
  const e=evento(),fonte={conversa:CONVERSA,jsonl:JSON.stringify(raw({origem:'prumo'})),identidade:estado}
  assert.equal(conferirFonteAtendimento(e,fonte,AGORA).estado,'ok')
  assert.equal(conferirFonteAtendimento(e,{...fonte,jsonl:JSON.stringify(raw())},AGORA).estado,'invalida')
})

for(const origem of ['pessoal','prumo','hermes-historico','hermes-historico-transcrito'])test(`prova exata permite conta Prumo sem reescrever origem literal ${origem}`,async t=>{
  const f=await fixture(t),m=raw({origem,texto:'  Olá çã 😀\n  '});await f.escreverRaw([m]);await f.escreverProvas([prova(m)])
  const antes=await fs.readFile(path.join(f.capturas,CONVERSA+'.jsonl'),'utf8')
  const r=conferirFonteAtendimento(evento(m),await f.lerFonte(evento(m)),AGORA)
  assert.equal(r.estado,'ok');assert.ok(r.sourceProofHash);if(r.estado==='ok')assert.equal(r.texto,m.texto)
  assert.equal(await fs.readFile(path.join(f.capturas,CONVERSA+'.jsonl'),'utf8'),antes)
})

test('mesma conta em sessões ou coletores diferentes e duplicatas legítimas comprovam um evento',async t=>{
  const f=await fixture(t),p=prova();await f.escreverProvas([p,p,{...p,sessaoHash:sha('outra-sessao')},{...p,coletor:'evolution',garantia:'webhook-evolution',instancia:'prumo',sessaoHash:null}])
  assert.equal(conferirIdentidadeCaptura(p.mensagem,await f.lerIdentidade(CONVERSA),AGORA).estado,'verificada')
  await f.escreverRaw([raw()]);await f.controlador.reconciliarCapturas();assert.equal((await f.inbox.listar()).length,1)
})

test('conta estrangeira ou mistura de contas na mesma tuple nunca vira Prumo',async t=>{
  const f=await fixture(t),p=prova(),foreign={...p,contaHash:sha('outra-conta')}
  for(const ps of [[foreign],[p,foreign],[foreign,p]]){await f.escreverProvas(ps);assert.equal(conferirIdentidadeCaptura(p.mensagem,await f.lerIdentidade(CONVERSA),AGORA).estado,'conflito')}
  await f.escreverProvas([p]);await fs.writeFile(path.join(f.identidades,'config.json'),JSON.stringify({...config,identidadePrumoHash:sha('nova-ancora')}))
  assert.equal(conferirIdentidadeCaptura(p.mensagem,await f.lerIdentidade(CONVERSA),AGORA).estado,'conflito')
})

test('desde limita captura, não a data da mensagem histórica; futuro e prova anterior não autorizam',async t=>{
  const f=await fixture(t),p=prova();await f.escreverProvas([p]);assert.equal(conferirIdentidadeCaptura(p.mensagem,await f.lerIdentidade(CONVERSA),AGORA).estado,'verificada')
  for(const capturadoEm of ['2026-10-23T18:00:00Z','2026-10-25T18:00:00Z']){await f.escreverProvas([{...p,capturadoEm}]);assert.notEqual(conferirIdentidadeCaptura(p.mensagem,await f.lerIdentidade(CONVERSA),AGORA).estado,'verificada')}
})

test('conteúdo, ID, horário e prova inválida não recuperam silenciosamente prova antiga',async t=>{
  const f=await fixture(t),p=prova()
  for(const linhas of [[p,{...p,mensagem:{...p.mensagem,conteudoHash:sha('outro')}}],[p,{...p,mensagem:{...p.mensagem,ocorridoEm:'2026-10-23T17:01:00Z'}}],[p,'{invalida']]){
    await f.escreverProvas(linhas);assert.equal(conferirIdentidadeCaptura(p.mensagem,await f.lerIdentidade(CONVERSA),AGORA).estado,'conflito')
  }
  await f.escreverProvas([p]);assert.equal(conferirIdentidadeCaptura({...p.mensagem,idOriginal:'outro-id'},await f.lerIdentidade(CONVERSA),AGORA).estado,'ausente')
})

for(const origem of ['prumo','pessoal'])test(`captura ${origem} sem prova permanece handoff interno visível`,async t=>{
  const f=await fixture(t);await f.escreverRaw([raw({origem})]);const antes=JSON.stringify(f.leads())
  const c=await f.controlador.reconciliarCapturas();assert.equal(c.semProva,1);assert.equal(c.novos,1)
  await f.controlador.atualizar();const [p]=await f.controlador.listarPendencias()
  assert.equal(p.tipo,'handoff');assert.equal(p.alvo,'operador');assert.equal(p.texto,undefined);assert.equal(p.estado,'concluido')
  assert.match(p.motivo,/prova/);assert.equal(JSON.stringify(f.leads()),antes)
})

test('mudança de sessão válida invalida contexto, sem invalidar a identidade da mensagem',async t=>{
  const f=await fixture(t);await f.escreverRaw([raw()]);await f.escreverProvas([prova()]);await f.controlador.reconciliarCapturas();await f.controlador.atualizar()
  const [antes]=await f.controlador.listarPendencias();assert.equal(antes.tipo,'rascunho')
  await f.escreverProvas([prova(),prova(raw(),{sessaoHash:sha('sessao-renovada'),capturadoEm:'2026-10-24T09:30:00Z'})])
  assert.equal(conferirIdentidadeCaptura(prova().mensagem,await f.lerIdentidade(CONVERSA),AGORA).estado,'verificada')
  const [depois]=await f.controlador.listarPendencias();assert.notEqual(depois.contextoHash,antes.contextoHash);assert.equal(depois.tipo,'handoff');assert.equal(depois.texto,undefined)
})

test('só saída posterior comprovada da mesma conta e projetada no CRM suprime o cartão',async t=>{
  const f=await fixture(t),entrada=raw(),saida=raw({id:'saida-ficticia',direcao:'saida',em:'2026-10-23T17:05:00Z',texto:'Respondido'})
  await f.escreverRaw([entrada]);await f.escreverProvas([prova()]);await f.controlador.reconciliarCapturas();await f.controlador.atualizar()
  f.setLeads([{...lead(),conversa:{...lead().conversa!,ultimaSaida:String(saida.em),ultima:{direcao:'saida',em:String(saida.em),trecho:'Respondido'}}}]);await f.escreverRaw([entrada,saida])
  assert.equal((await f.controlador.listarPendencias()).length,1,'CRM e saída sem prova não bastam')
  await f.escreverProvas([prova(),prova(saida,{contaHash:sha('outra-conta')})]);assert.equal((await f.controlador.listarPendencias()).length,1)
  await f.escreverProvas([prova(),prova(saida)]);assert.equal((await f.controlador.listarPendencias()).length,0)
})

test('reconciliação cobre sem lead, sem ID, inválidos e colisões sem fabricar original nem perder conflito',async t=>{
  const f=await fixture(t),m=raw(),colisao=raw({texto:'Conteúdo divergente'})
  await f.escreverRaw([m,colisao,raw({id:null}),'{ilegivel'])
  await f.escreverRaw([raw({id:'sem-lead-original'})],'1199990000')
  const c=await f.controlador.reconciliarCapturas();assert.equal(c.novos,2);assert.equal(c.semId,1);assert.equal(c.invalidos,1);assert.ok(c.conflitos>=1);assert.equal(c.semOportunidade,1)
  assert.equal((await f.inbox.listar()).length,2)
  const novamente=await f.criar().reconciliarCapturas();assert.equal(novamente.novos,0);assert.ok(novamente.conflitos>=1)
  const ps=await f.controlador.listarPendencias();assert.ok(ps.some(p=>!p.leadIds.length&&p.tipo==='handoff'))
  const resumo=JSON.stringify(f.controlador.cobertura());assert.ok(!resumo.includes(CONVERSA));assert.ok(!resumo.includes('1199990000'));assert.ok(!resumo.includes(String(m.id)));assert.ok(!resumo.includes(String(m.texto)))
})

test('config inválida ou prova ilegível mantém proteção ativa e handoff sem fallback legado',async t=>{
  const f=await fixture(t);await f.escreverRaw([raw({origem:'prumo'})]);await fs.writeFile(path.join(f.identidades,'config.json'),'{invalida')
  assert.equal((await f.lerIdentidade(CONVERSA)).ativa,true);await f.controlador.reconciliarCapturas();await f.controlador.atualizar()
  assert.equal((await f.controlador.listarPendencias())[0].tipo,'handoff')
  await fs.writeFile(path.join(f.identidades,'config.json'),JSON.stringify(config));await f.escreverProvas(['{invalida'])
  assert.equal((await f.controlador.listarPendencias())[0].tipo,'handoff')
})

test('leitores rejeitam caminhos não canônicos e cobertura registra diretório ausente',async t=>{
  const f=await fixture(t);await assert.rejects(()=>f.lerIdentidade('../segredo'),/inválida/)
  await fs.rm(f.capturas,{recursive:true});const c=await f.controlador.reconciliarCapturas();assert.equal(c.falhasLeitura,1);assert.equal(c.estado,'atencao')
})

test('retry de prova, ordem e repetição não mudam assinatura nem contexto do rascunho',async t=>{
  const f=await fixture(t),p=prova(),outra=prova(raw(),{sessaoHash:sha('segunda-sessao')})
  await f.escreverRaw([raw()]);await f.escreverProvas([p,outra]);await f.controlador.reconciliarCapturas();await f.controlador.atualizar()
  const assinatura=(await f.lerIdentidade(CONVERSA)).assinatura,[antes]=await f.controlador.listarPendencias()
  assert.equal(antes.tipo,'rascunho')
  await f.escreverProvas([outra,{...p,capturadoEm:'2026-10-24T09:45:00Z'},p,outra])
  assert.equal((await f.lerIdentidade(CONVERSA)).assinatura,assinatura)
  const [depois]=await f.controlador.listarPendencias();assert.equal(depois.contextoHash,antes.contextoHash);assert.equal(depois.tipo,'rascunho')
})

test('registros de print ou importação legada ficam ignorados, sem contar sem-ID ou falha de integração',async t=>{
  const f=await fixture(t);await f.escreverRaw([raw({origem:'print-importado',id:null}),raw({origem:'manual',id:null}),raw({origem:'pessoal',id:null})])
  const c=await f.controlador.reconciliarCapturas();assert.equal(c.ignorados,2);assert.equal(c.semId,1);assert.equal(c.invalidos,0);assert.equal(c.entradas,1)
  assert.deepEqual(await f.inbox.listar(),[])
})


test('saída comprovada posterior impede rascunho também na primeira derivação com CRM ainda atrasado',async t=>{
  const f=await fixture(t),saida=raw({id:'saida-antes-da-inbox',direcao:'saida',em:'2026-10-23T17:05:00Z',texto:'Já respondido'})
  await f.escreverRaw([raw(),saida]);await f.escreverProvas([prova(),prova(saida)])
  await f.controlador.reconciliarCapturas();const [p]=await f.controlador.listarPendencias()
  assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined);assert.match(p.motivo,/saída original posterior/)
})


test('marcador obrigatório conserva proteção após config apagada e leitor reiniciado',async t=>{
  const f=await fixture(t);await f.escreverRaw([raw({origem:'prumo'})]);await f.escreverProvas([prova(raw({origem:'prumo'}))])
  await fs.writeFile(path.join(f.identidades,'obrigatoria.json'),JSON.stringify({v:1}))
  assert.equal((await f.lerIdentidade(CONVERSA)).ativa,true)
  await fs.unlink(path.join(f.identidades,'config.json'))
  const lerNovo=criarLeitorIdentidadeCaptura(f.identidades,()=>AGORA),estado=await lerNovo(CONVERSA)
  assert.equal(estado.ativa,true);assert.match(estado.erro!,/Configuração/)
  const inbox=new EntradaAtendimentoComercialDuravel(path.join(f.dir,'reiniciado/inbox.json'))
  const controlador=new AtendimentoComercial({inbox,lerIdentidade:lerNovo,lerFonte:criarLeitorFonteAtendimento(f.capturas,lerNovo),inventariarCapturas:criarInventarioCapturasAtendimento(f.capturas,lerNovo),agora:()=>AGORA,visao:async()=>({estado:'ok',geradoEm:new Date(AGORA).toISOString(),leads:f.leads()})})
  await controlador.reconciliarCapturas();await controlador.atualizar()
  const [p]=await controlador.listarPendencias();assert.equal(p.tipo,'handoff');assert.equal(p.texto,undefined);assert.match(p.motivo,/Configuração/)
})

test('marcador exato inválido bloqueia mesmo com config válida; config ruim não vira legado',async t=>{
  const f=await fixture(t)
  for(const marcador of ['{invalido',JSON.stringify({v:2}),JSON.stringify({v:1,extra:true}),'null']){
    await fs.writeFile(path.join(f.identidades,'obrigatoria.json'),marcador)
    const r=await criarLeitorIdentidadeCaptura(f.identidades,()=>AGORA)(CONVERSA);assert.equal(r.ativa,true);assert.match(r.erro!,/Marcador/)
  }
  await fs.writeFile(path.join(f.identidades,'obrigatoria.json'),JSON.stringify({v:1}));await fs.writeFile(path.join(f.identidades,'config.json'),'{invalida')
  const r=await criarLeitorIdentidadeCaptura(f.identidades,()=>AGORA)(CONVERSA);assert.equal(r.ativa,true);assert.match(r.erro!,/Configuração/)
})

test('marcador inacessível como arquivo mantém proteção sem config e sem criar nada',async t=>{
  const f=await fixture(t,false);await fs.mkdir(path.join(f.identidades,'obrigatoria.json'))
  const r=await criarLeitorIdentidadeCaptura(f.identidades,()=>AGORA)(CONVERSA)
  assert.equal(r.ativa,true);assert.match(r.erro!,/Marcador/);assert.deepEqual(await fs.readdir(f.identidades),['obrigatoria.json'])
})
