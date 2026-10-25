import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {transporteEncontradoEvolution} from './encontrado-evolution.ts'
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
async function fixture(t:{after:(f:()=>Promise<unknown>)=>void},resposta:unknown) {
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'encontrado-transporte-'));t.after(()=>fs.rm(home,{recursive:true,force:true}))
  await fs.mkdir(path.join(home,'workspace/evolution'),{recursive:true});await fs.mkdir(path.join(home,'.local/share/whatsapp-identidades'),{recursive:true})
  await fs.writeFile(path.join(home,'workspace/evolution/.env'),'EVOLUTION_APIKEY=credencial-ficticia')
  await fs.writeFile(path.join(home,'.local/share/whatsapp-identidades/config.json'),JSON.stringify({v:1,identidadePrumoHash:sha('5527999999999@s.whatsapp.net')}))
  const chamadas:Array<{url:string;body?:string}>=[]
  const fetcher=(async(url:unknown,init:RequestInit)=>{chamadas.push({url:String(url),body:init.body as string|undefined});return new Response(JSON.stringify(resposta),{status:200})}) as typeof fetch
  return {chamadas,transporte:transporteEncontradoEvolution(fetcher,home)}
}
test('saúde confere instância, conexão e conta exata sem abrir sessão ou enviar',async t=>{
  const f=await fixture(t,[{name:'prumo',connectionStatus:'open',ownerJid:'5527999999999:4@s.whatsapp.net'}])
  await f.transporte.conferir();assert.equal(f.chamadas.length,1);assert.equal(f.chamadas[0].body,undefined)
})
test('outra conta, desconexão, múltiplas instâncias e schema desconhecido bloqueiam',async t=>{
  for(const resposta of [[{name:'prumo',connectionStatus:'open',ownerJid:'5511999999999@s.whatsapp.net'}],[{name:'prumo',connectionStatus:'close',ownerJid:'5527999999999@s.whatsapp.net'}],[],{},[{name:'outra',connectionStatus:'open',ownerJid:'5527999999999@s.whatsapp.net'}]]) {
    const f=await fixture(t,resposta);await assert.rejects(()=>f.transporte.conferir())
  }
})
test('recibo só confirma envio à conversa exata, com fromMe e ID',async t=>{
  const f=await fixture(t,{key:{fromMe:true,id:'mensagem-ficticia',remoteJid:'552799991234@s.whatsapp.net'}})
  assert.equal(await f.transporte.enviar('552799991234','Mensagem fictícia'),'mensagem-ficticia')
  assert.deepEqual(JSON.parse(f.chamadas[0].body!),{number:'552799991234',text:'Mensagem fictícia',linkPreview:false})
  for(const key of [{fromMe:true,id:'id',remoteJid:'551199991234@s.whatsapp.net'},{fromMe:false,id:'id',remoteJid:'552799991234@s.whatsapp.net'},{fromMe:true,remoteJid:'552799991234@s.whatsapp.net'},{fromMe:true,id:'id',remoteJid:'outro@lid'}]) {
    const g=await fixture(t,{key});await assert.rejects(()=>g.transporte.enviar('552799991234','Mensagem fictícia'))
  }
})
