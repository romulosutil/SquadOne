import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {Request,Response} from 'express';
import {FilaTelegramDuravel} from './fila-telegram-duravel.ts';
import {criarBotDoTelegram,type DepsDoBot} from './telegram-bot.ts';
import {criarPollingDoTelegram} from './telegram-polling.ts';
const AGORA=Date.parse('2026-10-24T18:00:00Z');
const update=(id=1)=>({update_id:id,message:{message_id:id,chat:{id:123,type:'private'},date:Math.floor(AGORA/1000),text:'Organizar fixture'}});
const vazio=()=>({eventos_criados:[],tarefas_criadas:[],sugestoes:[],avisos:[],erros:[]});
async function fixture(t:{after:(fn:()=>Promise<unknown>)=>void}){
 const d=await fs.mkdtemp(path.join(os.tmpdir(),'telegram-fila-duravel-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));
 const arquivo=path.join(d,'fila.json'),fila=new FilaTelegramDuravel(arquivo),chamadas:string[]=[],envios:string[]=[];
 let agora=AGORA;
 const deps:DepsDoBot={filaDuravel:fila,segredo:'fixture',chatsPermitidos:new Set([123]),rodar:async(_,__,___,id)=>{chamadas.push(id!);return vazio()},enviar:async(_,s)=>{envios.push(s)},digitando:async()=>undefined,transcrever:async()=>{throw new Error('Não transcrever')},contratar:async()=>'',responderBotao:async()=>undefined,editar:async()=>undefined,fmt:{locale:'pt-BR',timeZone:'America/Sao_Paulo'},agora:()=>new Date(agora)};
 return {d,arquivo,fila,deps,chamadas,envios,setAgora:(n:number)=>{agora=n}};
}
const tick=()=>new Promise<void>(r=>setImmediate(r));

test('ACK do webhook só depois de persistir a entrada; callback vê reserva no disco',async t=>{
 const f=await fixture(t);let status:number|undefined;
 f.deps.rodar=async()=>{const dado=JSON.parse(await fs.readFile(f.arquivo,'utf8'));assert.equal(dado.entradas[0].estado,'processando');f.chamadas.push('rodou');return vazio()};
 const bot=criarBotDoTelegram(f.deps),res={sendStatus:(n:number)=>{status=n;assert.ok(requireExists);return res}};
 let requireExists=false;const real=f.fila.receber.bind(f.fila);f.fila.receber=async u=>{const r=await real(u);requireExists=true;return r};
 bot.processar({body:update()} as Request,res as unknown as Response,()=>undefined);assert.equal(status,undefined);
 for(let n=0;n<100&&status===undefined;n++)await new Promise(r=>setTimeout(r,2));
 assert.equal(status,200);await bot.ocioso();assert.equal(f.chamadas.length,1);assert.equal((await f.fila.status()).entradas[0].estado,'concluido');
});
test('falha de persistência retorna 503 sem chamar turno nem consumir dedupe',async t=>{
 const f=await fixture(t),real=f.fila.receber.bind(f.fila);f.fila.receber=async()=>{throw new Error('disco fixture')};
 const bot=criarBotDoTelegram(f.deps);let status=0;const res={sendStatus:(n:number)=>{status=n;return res}};
 bot.processar({body:update()} as Request,res as unknown as Response,()=>undefined);
 for(let n=0;n<100&&!status;n++)await new Promise(r=>setTimeout(r,2));assert.equal(status,503);assert.equal(f.chamadas.length,0);
 f.fila.receber=real;await bot.receber(update());await bot.ocioso();assert.equal(f.chamadas.length,1);
});
test('duplicata e restart de turno concluído nunca repetem modelo',async t=>{
 const f=await fixture(t),bot=criarBotDoTelegram(f.deps);await Promise.all([bot.receber(update()),bot.receber(update())]);await bot.ocioso();
 const novo=criarBotDoTelegram({...f.deps,filaDuravel:new FilaTelegramDuravel(f.arquivo)});await novo.retomar();await novo.receber(update());await novo.ocioso();
 assert.deepEqual(f.chamadas,['tg:123:1']);
 await assert.rejects(()=>f.fila.receber({...update(),message:{...update().message,text:'outra intenção'}}),/conflitante/);
});
test('entrada pendente sobrevive ao restart e retoma uma única vez',async t=>{
 const f=await fixture(t);await f.fila.receber(update());const bot=criarBotDoTelegram({...f.deps,filaDuravel:new FilaTelegramDuravel(f.arquivo)});
 await bot.retomar();await bot.ocioso();assert.equal(f.chamadas.length,1);assert.equal((await f.fila.status()).entradas[0].estado,'concluido');
});
test('turno processando com dono morto vira ambíguo sem nova execução',async t=>{
 const f=await fixture(t);await f.fila.receber(update());assert.ok(await f.fila.iniciar(1));
 const nova=new FilaTelegramDuravel(f.arquivo,()=>false),bot=criarBotDoTelegram({...f.deps,filaDuravel:nova});await bot.retomar();await bot.ocioso();
 assert.equal((await nova.status()).entradas[0].estado,'ambiguo');assert.equal(f.chamadas.length,0);assert.equal(await nova.iniciar(1),null);
});
test('retomada revalida idade e chat autorizado antes de modelo ou transcrição',async t=>{
 for(const revogada of [false,true]){
  const f=await fixture(t);await f.fila.receber(update());
  if(revogada)f.deps.chatsPermitidos=new Set();else f.setAgora(AGORA+11*60000);
  const bot=criarBotDoTelegram(f.deps);await bot.retomar();await bot.ocioso();assert.equal(f.chamadas.length,0);assert.equal((await f.fila.status()).entradas[0].estado,'concluido');
 }
});
test('demanda envelhecida enquanto esperava na fila não agenda depois',async t=>{
 const f=await fixture(t);let liberar:()=>void=()=>undefined;const espera=new Promise<void>(r=>{liberar=r});
 f.deps.rodar=async(_,__,___,id)=>{f.chamadas.push(id!);await espera;return vazio()};
 const bot=criarBotDoTelegram(f.deps);await bot.receber(update(1));
 while(!f.chamadas.length)await tick();await bot.receber(update(2));f.setAgora(AGORA+11*60000);liberar();await bot.ocioso();
 assert.deepEqual(f.chamadas,['tg:123:1']);assert.ok(f.envios.some(s=>s.includes('Não processei')));
});
test('polling aguarda persistência antes de avançar e gravar offset',async()=>{
 let liberar:()=>void=()=>undefined;const espera=new Promise<void>(r=>{liberar=r}),ordem:string[]=[];
 const p=criarPollingDoTelegram({buscar:async()=>[update()],receber:async()=>{ordem.push('recebendo');await espera;ordem.push('persistido')},lerOffset:async()=>null,gravarOffset:async()=>{ordem.push('offset')},esperar:async()=>undefined});
 const r=p.rodada();await tick();assert.deepEqual(ordem,['recebendo']);liberar();await r;assert.deepEqual(ordem,['recebendo','persistido','offset']);
});
test('erro de persistência não confirma offset do Telegram',async()=>{
 let offset=0;const p=criarPollingDoTelegram({buscar:async()=>[update()],receber:async()=>{throw new Error('fixture')},lerOffset:async()=>null,gravarOffset:async()=>{offset++},esperar:async()=>undefined});
 await assert.rejects(()=>p.rodada(),/fixture/);assert.equal(offset,0);
});
test('status da fila não expõe texto, número do chat ou credenciais',async t=>{
 const f=await fixture(t);await f.fila.receber(update());const status=JSON.stringify(await f.fila.status());assert.doesNotMatch(status,/Organizar|123|fixture|token/);
 if(process.platform!=='win32'){assert.equal((await fs.stat(f.arquivo)).mode&0o777,0o600);assert.equal((await fs.stat(f.d)).mode&0o777,0o700)}
});


test('pedido interrompido recebe aviso interno uma vez com tentativa persistida antes do transporte',async t=>{
 const f=await fixture(t);await f.fila.receber(update());await f.fila.iniciar(1);
 const nova=new FilaTelegramDuravel(f.arquivo,()=>false);f.deps.filaDuravel=nova;
 let avisos=0;f.deps.enviar=async(_,texto)=>{avisos++;assert.match(texto,/interrompido/);assert.doesNotMatch(texto,/Organizar/);assert.equal((await nova.status()).entradas[0].avisoTentado,true)};
 const bot=criarBotDoTelegram(f.deps);await bot.retomar();await bot.ocioso();await bot.retomar();
 assert.equal(avisos,1);assert.equal(f.chamadas.length,0);
});
