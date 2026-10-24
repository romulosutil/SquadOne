import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type {AddressInfo} from 'node:net';
import {montarGarantiasAgenda} from './rotas-garantias-agenda.ts';
async function fixture(t:{after:(fn:()=>Promise<unknown>)=>void}){
 const app=express();app.use(express.json());let conferencias=0,tokens=0;
 montarGarantiasAgenda(app,{calendario:async id=>{assert.ok(id===undefined||id==='fixture');return 'calendario-privado-fixture'},garantias:{status:async()=>({operacoes:[{id:'a'.repeat(64),estado:'ambiguo',eventos:[]}]}),reconciliar:async()=>{conferencias++;return {confirmados:0,pendentes:1}}},demandas:{status:async()=>({pedidos:[]})},fila:{status:async()=>({entradas:[]})},token:async()=>{tokens++;return 'segredo-fixture'}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 return {base,conferencias:()=>conferencias,tokens:()=>tokens};
}
test('status mostra bloqueio sem ler Calendar nem expor credenciais ou conteúdo',async t=>{
 const f=await fixture(t),r=await fetch(f.base+'/api/agenda/garantias'),s=await r.text();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(s,/ambiguo/);assert.doesNotMatch(s,/segredo|calendario-privado/);assert.equal(f.tokens(),0);assert.equal(f.conferencias(),0);
});
test('conferência explícita permite só squad e nunca autoriza reenvio',async t=>{
 const f=await fixture(t),post=(body:unknown)=>fetch(f.base+'/api/agenda/conferir-reservas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({})).status,400);assert.equal((await post({squadId:'fixture',reenviar:true})).status,400);assert.equal(f.tokens(),0);
 const r=await post({squadId:'fixture'}),d=await r.json();assert.equal(r.status,200);assert.equal(d.reenvioAutorizado,false);assert.equal(d.pendentes,1);assert.equal(f.tokens(),1);assert.equal(f.conferencias(),1);
});
