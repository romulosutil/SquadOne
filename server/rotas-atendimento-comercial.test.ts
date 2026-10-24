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
