import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GarantiasAgenda,DemandasAgendaDuraveis} from './garantias-agenda.ts';
import {comPrazoOperacional} from './estado-operacional-duravel.ts';
const corpo=(inicio=1792854000000)=>({summary:'Compromisso fictício',start:{dateTime:new Date(inicio).toISOString()},end:{dateTime:new Date(inicio+3600000).toISOString()},extendedProperties:{private:{squadone_squad:'fixture'}}});
async function pasta(t:{after:(fn:()=>Promise<unknown>)=>void}){const d=await fs.mkdtemp(path.join(os.tmpdir(),'garantias-agenda-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d}
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const fixtureFetch=(f:(url:string,init:RequestInit)=>Promise<Response>)=>f as unknown as typeof fetch;

test('duas instâncias com calendário atrasado alocam sem sobreposição usando ocupação durável',async t=>{
 const d=await pasta(t),gravados:Record<string,unknown>[]=[];
 const fetcher=fixtureFetch(async(_,i)=>{const b=JSON.parse(String(i.body));gravados.push(b);return json({id:b.id})});
 const executar=(g:GarantiasAgenda,id:string)=>g.executar('primary',id,{intencao:id},'token-ficticio',async s=>{const inicio=s.ocupacao.reduce((n,i)=>Math.max(n,i.fim),1792854000000);return s.gravar(corpo(inicio))});
 await Promise.all([executar(new GarantiasAgenda(d,fetcher),'ui:primeira'),executar(new GarantiasAgenda(d,fetcher),'tg:segunda')]);
 assert.equal(gravados.length,2);
 const starts=gravados.map(g=>Date.parse((g.start as {dateTime:string}).dateTime)).sort();assert.equal(starts[1]-starts[0],3600000);
 let reservas=0;await new GarantiasAgenda(d,fetcher).executar('primary','ui:terceira',{},'token-ficticio',async s=>{reservas=s.ocupacao.length;return {ok:true}});assert.equal(reservas,2);
});
test('mesmo ID concorrente e replay após reinício só executam callback e POST uma vez',async t=>{
 const d=await pasta(t);let chamadas=0;
 const f=fixtureFetch(async(_,i)=>{chamadas++;return json({id:JSON.parse(String(i.body)).id})});
 const run=(g:GarantiasAgenda)=>g.executar('primary','mesma-intencao',{texto:'fixture'},'token',s=>s.gravar(corpo()));
 const [a,b]=await Promise.all([run(new GarantiasAgenda(d,f)),run(new GarantiasAgenda(d,f))]);assert.deepEqual(a,b);assert.equal(chamadas,1);
 assert.deepEqual(await run(new GarantiasAgenda(d,f)),a);assert.equal(chamadas,1);
 await assert.rejects(()=>new GarantiasAgenda(d,f).executar('primary','mesma-intencao',{texto:'diferente'},'token',async()=>{throw new Error('Não executar')}),/outra intenção/);
});
test('timeout não confirma resposta tardia nem libera reenvio ou outra reserva',async t=>{
 const d=await pasta(t);let calls=0,terminar:(r:Response)=>void=()=>undefined,sinal:AbortSignal|undefined;
 const f=fixtureFetch(async(_,i)=>{calls++;sinal=i.signal??undefined;return new Promise(r=>{terminar=r})});
 const g=new GarantiasAgenda(d,f,10);
 await assert.rejects(()=>g.executar('primary','incerta',{},'token',s=>s.gravar(corpo())),/sem conclusão/);
 const antes=JSON.stringify(await g.status('primary'));terminar(json({},400));await new Promise(r=>setTimeout(r,15));
 assert.equal(sinal?.aborted,true);assert.equal(JSON.stringify(await g.status('primary')),antes);
 await assert.rejects(()=>g.executar('primary','outra',{},'token',s=>s.gravar(corpo())),/sem conclusão/);assert.equal(calls,1);
});
test('recusa inequívoca não mantém outra intenção bloqueada e não confirma ocupação',async t=>{
 const d=await pasta(t);let n=0;
 const g=new GarantiasAgenda(d,fixtureFetch(async(_,i)=>++n===1?json({},403):json({id:JSON.parse(String(i.body)).id})));
 await assert.rejects(()=>g.executar('primary','recusada',{},'token',s=>s.gravar(corpo())),/recusou/);
 await g.executar('primary','nova',{},'token',async s=>{assert.deepEqual(s.ocupacao,[]);return s.gravar(corpo())});assert.equal(n,2);
});
test('crash após confirmação mas antes do agregado não reexecuta gravação',async t=>{
 const d=await pasta(t);let n=0;
 const g=new GarantiasAgenda(d,fixtureFetch(async(_,i)=>{n++;return json({id:JSON.parse(String(i.body)).id})}));
 await assert.rejects(()=>g.executar('primary','parcial',{},'token',async s=>{await s.gravar(corpo());throw new Error('crash fixture')}),/crash/);
 await assert.rejects(()=>new GarantiasAgenda(d).executar('primary','parcial',{},'token',async()=>{throw new Error('Não deve executar')}),/sem conclusão/);assert.equal(n,1);
});
test('GET 404 de resultado ambíguo jamais autoriza retry de POST',async t=>{
 const d=await pasta(t);let posts=0,gets=0;
 const g=new GarantiasAgenda(d,fixtureFetch(async(_,i)=>{if(i.method==='POST'){posts++;throw new Error('rede fixture')}gets++;return json({},404)}));
 await assert.rejects(()=>g.executar('primary','incerta',{},'token',s=>s.gravar(corpo())),/sem conclusão/);
 assert.deepEqual(await g.reconciliar('primary','token'),{confirmados:0,pendentes:1});
 await assert.rejects(()=>g.executar('primary','incerta',{},'token',s=>s.gravar(corpo())),/sem conclusão/);assert.equal(posts,1);assert.equal(gets,1);
});
test('GET exato comprova evento após erro de transporte sem reenviar',async t=>{
 const d=await pasta(t);let criado:Record<string,unknown>={};let posts=0;
 const g=new GarantiasAgenda(d,fixtureFetch(async(_,i)=>{if(i.method==='POST'){posts++;criado=JSON.parse(String(i.body));throw new Error('ACK perdido fixture')}return json(criado)}));
 await assert.rejects(()=>g.executar('primary','incerta',{},'token',s=>s.gravar(corpo())),/sem conclusão/);
 assert.deepEqual(await g.reconciliar('primary','token'),{confirmados:1,pendentes:0});
 await g.executar('primary','outra',{},'token',async s=>{assert.equal(s.ocupacao.length,1);return {ok:true}});assert.equal(posts,1);
 await assert.rejects(()=>g.executar('primary','incerta',{},'token',s=>s.gravar(corpo())),/sem conclusão/);
});
test('journal ilegível não zera idempotência nem chama provedor',async t=>{
 const d=await pasta(t),g=new GarantiasAgenda(d);await g.status('primary');
 const {createHash}=await import('node:crypto');const arquivo=path.join(d,createHash('sha256').update('primary').digest('hex')+'.json');await fs.writeFile(arquivo,'{inválido');
 await assert.rejects(()=>g.executar('primary','nova',{},'token',async()=>{throw new Error('não executar')}),/ilegível/);
});
test('limite operacional encerra até provider que ignore AbortSignal',async()=>{
 let sinal:AbortSignal|undefined;await assert.rejects(()=>comPrazoOperacional(s=>{sinal=s;return new Promise(()=>undefined)},5),/não respondeu/);assert.equal(sinal?.aborted,true);
});
test('intenção completa é persistida antes do modelo; replay e conflito não reexecutam',async t=>{
 const d=await pasta(t),j=new DemandasAgendaDuraveis(d);let chamadas=0;
 const exec=()=>j.executar('ui:fixture',{demanda:'Fixture',modo:'auto'},async()=>{chamadas++;assert.equal((await fs.readdir(d)).some(f=>f.endsWith('.json')),true);return {eventos:[]}});
 await Promise.all([exec(),exec()]);await exec();assert.equal(chamadas,1);
 await assert.rejects(()=>j.executar('ui:fixture',{demanda:'Outra',modo:'auto'},async()=>{chamadas++;return {}}),/outra intenção/);assert.equal(chamadas,1);
});
test('intenção interrompida fica ambígua e não chama outro modelo após restart',async t=>{
 const d=await pasta(t);await assert.rejects(()=>new DemandasAgendaDuraveis(d).executar('ui:incerta',{},async()=>{throw new Error('crash fixture')}),/crash/);
 await assert.rejects(()=>new DemandasAgendaDuraveis(d).executar('ui:incerta',{},async()=>{throw new Error('modelo não pode rodar')}),/sem conclusão/);
});


test('conferência explícita reconhece remarcação e cancelamento sem criar eventos',async t=>{
 const d=await pasta(t);let evento:Record<string,unknown>={},posts=0;
 const g=new GarantiasAgenda(d,fixtureFetch(async(_,i)=>{if(i.method==='POST'){posts++;evento=JSON.parse(String(i.body));return json({id:evento.id})}return json(evento)}));
 await g.executar('primary','original',{},'token',s=>s.gravar(corpo()));
 evento={...evento,start:{dateTime:new Date(1792854000000+7200000).toISOString()},end:{dateTime:new Date(1792854000000+10800000).toISOString()}};
 assert.deepEqual(await g.reconciliar('primary','token'),{confirmados:1,pendentes:0});
 await g.executar('primary','depois-movido',{},'token',async s=>{assert.equal(s.ocupacao[0].inicio,1792854000000+7200000);return {ok:true}});
 evento={id:evento.id,status:'cancelled'};await g.reconciliar('primary','token');
 await g.executar('primary','depois-cancelado',{},'token',async s=>{assert.deepEqual(s.ocupacao,[]);return {ok:true}});assert.equal(posts,1);
 await assert.rejects(()=>g.executar('primary','original',{},'token',s=>s.gravar(corpo())),/sem conclusão/);
});
test('reserva real do alocador entre UI e Telegram revalida Calendar atrasado sob trava',async t=>{
 const d=await pasta(t),{AgendaDoTurno}=await import('./agenda.ts'),{agendarCompromisso}=await import('./agendamento.ts'),{lerJanela}=await import('./alocador.ts');
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let posts=0;
 const f=fixtureFetch(async(_,i)=>{if(i?.method==='POST'){posts++;return json({id:JSON.parse(String(i.body)).id})}return json({items:[]})});globalThis.fetch=f;
 const pedido=(id:string)=>({args:{titulo:'Fixture',tipo:'time_blocking',duracao_min:60},tipoForcado:null,baixaPrioridade:false,squadId:'fixture',calendarId:'primary',dominio:{id:'fixture',nome:'Fixture'},pessoa:{id:'fixture',nome:'Fixture',papel:'PO'},colorId:'1',operacaoId:id,
  agenda:new AgendaDoTurno({token:'token-ficticio',janela:lerJanela({}),agora:new Date('2026-10-26T12:00:00Z'),garantias:new GarantiasAgenda(d,f)})});
 const [a,b]=await Promise.all([agendarCompromisso(pedido('ui:fixture')),agendarCompromisso(pedido('tg:fixture'))]);
 assert.equal(posts,2);assert.ok(Date.parse(a.eventos[0].fim)<=Date.parse(b.eventos[0].inicio)||Date.parse(b.eventos[0].fim)<=Date.parse(a.eventos[0].inicio));
});
test('leitura de ocupação sem resposta termina sem POST nem reserva confirmada',async t=>{
 const d=await pasta(t),{AgendaDoTurno}=await import('./agenda.ts'),{agendarCompromisso}=await import('./agendamento.ts'),{lerJanela}=await import('./alocador.ts');
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let posts=0;
 const f=fixtureFetch(async(_,i)=>{if(i?.method==='POST')posts++;return new Promise(()=>undefined)});globalThis.fetch=f;
 const g=new GarantiasAgenda(d,f,5),agenda=new AgendaDoTurno({token:'fixture',janela:lerJanela({}),agora:new Date('2026-10-26T12:00:00Z'),garantias:g,prazoLeituraMs:5});
 await assert.rejects(()=>agendarCompromisso({args:{titulo:'Fixture',duracao_min:60},tipoForcado:null,baixaPrioridade:false,squadId:'fixture',calendarId:'primary',dominio:{id:'fixture',nome:'Fixture'},pessoa:{id:'fixture',nome:'Fixture',papel:'PO'},colorId:'1',operacaoId:'ui:sem-leitura',agenda}),/Não deu para ler/);
 assert.equal(posts,0);const status=await g.status('primary');assert.equal(status.operacoes[0].estado,'sem-envio');assert.deepEqual(status.operacoes[0].eventos,[]);
});


test('deadline transparente não vira ocupação durável nem bloqueia foco',async t=>{
 const d=await pasta(t),g=new GarantiasAgenda(d,fixtureFetch(async(_,i)=>json({id:JSON.parse(String(i.body)).id})));
 await g.executar('primary','prazo',{},'token',s=>s.gravar({...corpo(),transparency:'transparent'}));
 await new GarantiasAgenda(d).executar('primary','foco',{},'token',async s=>{assert.deepEqual(s.ocupacao,[]);return {ok:true}});
});
test('403 de escopo e401 preservam gesto de reconectar sem ecoar erro privado',async t=>{
 const {ErroCalendario}=await import('./calendar.ts'),{motivoDoErro}=await import('./orchestrator.ts');
 for(const [status,motivo] of [[401,'authError'],[403,'insufficientPermissions'],[403,'accessNotConfigured']] as const){
  const d=await pasta(t),g=new GarantiasAgenda(d,fixtureFetch(async()=>json({error:{message:'segredo ficticio',errors:[{reason:motivo}]}},status)));
  await assert.rejects(()=>g.executar('primary','fixture',{},'token',s=>s.gravar(corpo())),e=>{assert.ok(e instanceof ErroCalendario);assert.equal(e.status,status);assert.doesNotMatch(e.message,/segredo/);assert.equal(e.ehCredencial,motivo!=='accessNotConfigured');assert.equal(motivoDoErro(e),motivo!=='accessNotConfigured'?'precisaConectar':undefined);return true});
 }
});
test('crescimento além do teto não recebe ACK nem destrói último journal legível',async t=>{
 const {EstadoOperacionalDuravel}=await import('./estado-operacional-duravel.ts'),d=await pasta(t),arquivo=path.join(d,'fronteira.json');
 const validar=(v:unknown)=>v as {texto:string};const store=new EstadoOperacionalDuravel(arquivo,()=>({texto:'original'}),validar,1000,100);
 await store.usar(async(_,salvar)=>{await salvar()});const antes=await fs.readFile(arquivo);let ack=0;
 await assert.rejects(async()=>{await store.usar(async(e,salvar)=>{e.texto='x'.repeat(200);await salvar()});ack++},/limite/);
 assert.equal(ack,0);assert.deepEqual(await fs.readFile(arquivo),antes);assert.equal(await store.usar(async e=>e.texto),'original');
});
