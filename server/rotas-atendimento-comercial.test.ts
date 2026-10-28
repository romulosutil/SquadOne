import assert from 'node:assert/strict'
import {test} from 'node:test'
import express from 'express'
import type {AddressInfo} from 'node:net'
import {entradaTecnicaAtendimento} from './rotas-atendimento-comercial.ts'
async function fixture(run:(url:string,c:{recebidos:number})=>Promise<void>,falhar=false){
 const c={recebidos:0},app=express()
 app.use(entradaTecnicaAtendimento({autenticar:async v=>{if(falhar)throw new Error('privado');return v==='fixture'},receber:async()=>{c.recebidos++;return {novo:c.recebidos===1,registro:{chave:'fixture-opaca'}}}}))
 const s=app.listen(0,'127.0.0.1');await new Promise<void>(r=>s.once('listening',r))
 try{await run(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/operations/crm/atendimento/evento`,c)}finally{await new Promise<void>((r,j)=>s.close(e=>e?j(e):r()))}
}
test('sem segredo não toca inbox; com segredo devolve só receipt durável sem Origin humana',()=>fixture(async(url,c)=>{
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);assert.equal(c.recebidos,0)
 const post=()=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CRM':'fixture'},body:'{}'})
 const r=await post();assert.equal(r.status,202);assert.deepEqual(await r.json(),{ok:true,persistido:true,estado:'pendente',chave:'fixture-opaca'})
 assert.equal((await (await post()).json()).estado,'repetido')
}))
test('falha de autenticação fecha integração sem expor causa privada',()=>fixture(async(url,c)=>{
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,409);assert.equal(c.recebidos,0);assert.ok(!(await r.text()).includes('privado'))
},true))

test('autorização de material exige segredo, ID fechado e nova decisão da Central',async()=>{
 const app=express();let chamadas=0,permitir=true
 app.use(entradaTecnicaAtendimento({autenticar:async v=>v==='fixture',receber:async()=>null,autorizarMaterial:async id=>{chamadas++;return permitir?{id}:null}}))
 const s=app.listen(0,'127.0.0.1');await new Promise<void>(r=>s.once('listening',r))
 const url=`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/operations/crm/encontrado/material/autorizar`
 const post=(body:unknown,segredo=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(segredo?{'X-CRM':'fixture'}:{})},body:JSON.stringify(body)})
 try{
  assert.equal((await post({id:'a'.repeat(64)},false)).status,403);assert.equal(chamadas,0)
  for(const body of [{id:'../comando'},{id:'a'.repeat(64),comando:'gerar'},{}])assert.equal((await post(body)).status,400)
  assert.equal(chamadas,0);const ok=await post({id:'a'.repeat(64)});assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');assert.equal(chamadas,1)
  permitir=false;assert.equal((await post({id:'a'.repeat(64)})).status,409)
 }finally{await new Promise<void>((r,j)=>s.close(e=>e?j(e):r()))}
})
