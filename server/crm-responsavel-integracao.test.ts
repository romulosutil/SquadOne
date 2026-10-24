import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { CrmStore, validarRegistro } from './crm.ts'
import { textoResponsavelConversa, projetarResponsavelConversa } from '../src/operations/responsavel-conversa.ts'
const agora=new Date('2026-10-24T03:00:00Z')
const nota=(id='dono-teste',anterior:string|null=null,responsavel:'romulo'|'time'='romulo')=>textoResponsavelConversa({v:2,id,conta:'prumo',canal:'whatsapp',conversa:'1190000000',responsavel,data:agora.toISOString(),motivo:'Decisão humana de fixture',humano:true,anterior},agora.getTime())
async function fixture(run:(f:{store:CrmStore;novo:()=>CrmStore;linhas:Record<string,string>[];salvar:()=>Promise<void>;escritas:()=>number})=>Promise<void>){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crm-dono-'));let n=0
 try{
 const linhas:Record<string,string>[]=[],arquivo=path.join(dir,'crm.json'),segredo=path.join(dir,'segredo')
 await fs.writeFile(segredo,'fixture-segredo')
 const salvar=()=>fs.writeFile(arquivo,JSON.stringify({versao:1,geradoEm:agora.toISOString(),fontes:{site:{linhas:[{place_id:'LEAD-UM',nome:'Fixture 1',status:'pronto',wa_me:'https://wa.me/5511990000000'},{place_id:'LEAD-DOIS',nome:'Fixture 2',status:'pronto',wa_me:'https://wa.me/551190000000'}]},prumo:{linhas:[]},iris:{linhas:[]},estampa:{linhas:[]},registros:{linhas}}}))
 await salvar()
 const novo=()=>new CrmStore({retrato:arquivo,segredoArquivo:segredo,registroUrl:'http://127.0.0.1/fixture'},async()=>{n++;return new Response(JSON.stringify({ok:true,em:agora.toISOString()}))})
 await run({store:novo(),novo,linhas,salvar,escritas:()=>n})
 }finally{await fs.rm(dir,{recursive:true,force:true})}
}
const entrada=(texto:string,id='LEAD-UM')=>({produto:'site',id,tipo:'nota',texto,data:''})
test('responsável valida schema sem truncar ou converter em nota genérica',()=>{
 assert.equal(validarRegistro(entrada(nota()),agora).texto,nota())
 assert.throws(()=>validarRegistro(entrada('[responsavel-conversa-v2] {}'),agora))
})
test('ACK do dono bloqueia mesma conversa entre oportunidades e reinício até fonte real',()=>fixture(async f=>{
 const r=await f.store.registrar(entrada(nota()),agora);assert.equal(r.estado,'aguardando_projecao')
 let v=await f.novo().visao(agora)
 assert.match((await f.novo().bloqueioDaConversa(v.leads[1]!,v.leads,agora.getTime()))!,/aguardando/)
 assert.equal(projetarResponsavelConversa(v.leads[0]!,v.leads,agora.getTime()).estado,'ausente')
 await assert.rejects(f.novo().registrar(entrada(nota('outro-dono'), 'LEAD-DOIS'),agora),/confirmação|projeção/)
 assert.equal(f.escritas(),1)
 f.linhas.push({...entrada(nota()),em:agora.toISOString()});await f.salvar();v=await f.novo().visao(agora)
 assert.match((await f.novo().bloqueioDaConversa(v.leads[1]!,v.leads,agora.getTime()))!,/assumiu/)
 assert.equal(projetarResponsavelConversa(v.leads[1]!,v.leads,agora.getTime()).registro?.responsavel,'romulo')
 assert.ok(v.leads[0]!.eventos.every(e=>!e.texto?.includes('1190000000')))
}))
test('credencial técnica exige valor exato e não aceita ausência',()=>fixture(async f=>{
 assert.equal(await f.store.autenticarAtendimento(undefined),false);assert.equal(await f.store.autenticarAtendimento('fixture-segredoX'),false);assert.equal(await f.store.autenticarAtendimento('fixture-segredo'),true)
}))

test('fonte regressiva não autoriza criar outra raiz de responsabilidade',()=>fixture(async f=>{
 await f.store.registrar(entrada(nota()),agora)
 f.linhas.push({...entrada(nota()),em:agora.toISOString()});await f.salvar()
 let v=await f.store.visao(agora);await f.store.bloqueioDaConversa(v.leads[0]!,v.leads,agora.getTime())
 f.linhas.length=0;await f.salvar()
 await assert.rejects(f.novo().registrar(entrada(nota('outra-raiz')),agora),/ausente da fonte/)
 assert.equal(f.escritas(),1)
}))
