import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,type ChildProcess} from 'node:child_process';
import {GarantiasAgenda,DemandasAgendaDuraveis} from './garantias-agenda.ts';
import {FilaTelegramDuravel} from './fila-telegram-duravel.ts';
const agendaUrl=pathToFileURL(path.resolve('server/garantias-agenda.ts')).href;
const filaUrl=pathToFileURL(path.resolve('server/fila-telegram-duravel.ts')).href;
async function pasta(t:{after:(fn:()=>Promise<unknown>)=>void}){const d=await fs.mkdtemp(path.join(os.tmpdir(),'agenda-processos-fixture-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d}
function filho(codigo:string){const p=spawn(process.execPath,['--import','tsx','--input-type=module','-e',codigo],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let erro='';p.stderr?.on('data',b=>{erro+=String(b)});return {p,fim:new Promise<{codigo:number|null;erro:string}>(r=>p.once('exit',codigo=>r({codigo,erro})))} }
async function pronto(p:string){const fim=Date.now()+5000;while(Date.now()<fim){try{await fs.access(p);return}catch{await new Promise(r=>setTimeout(r,10))}}throw new Error('Fixture não iniciou a reserva.')}
async function matar(p:ChildProcess,fim:Promise<unknown>){p.kill('SIGKILL');await fim}

test('processos concorrentes com mesmo ID executam uma única intenção',async t=>{
 const d=await pasta(t),contador=path.join(d,'contador.txt');
 const codigo=`import fs from 'node:fs/promises';import {GarantiasAgenda} from ${JSON.stringify(agendaUrl)};const g=new GarantiasAgenda(${JSON.stringify(d)});await g.executar('primary','mesmo-id',{intencao:'fixture'},'token-ficticio',async()=>{await fs.appendFile(${JSON.stringify(contador)},'executou\\n');await new Promise(r=>setTimeout(r,30));return {ok:true}});`;
 const filhos=[filho(codigo),filho(codigo)];for(const f of filhos){const r=await f.fim;assert.equal(r.codigo,0,r.erro)}
 assert.equal((await fs.readFile(contador,'utf8')).trim(),'executou');
});
test('morte real após preparar POST preserva ambiguidade e recupera lock sem reenvio',async t=>{
 const d=await pasta(t),marcador=path.join(d,'pronto');
 const codigo=`import fs from 'node:fs/promises';import {GarantiasAgenda} from ${JSON.stringify(agendaUrl)};const g=new GarantiasAgenda(${JSON.stringify(d)},async()=>{await fs.writeFile(${JSON.stringify(marcador)},'fixture');return new Promise(()=>{})},60000);await g.executar('primary','incerta',{},'token-ficticio',s=>s.gravar({summary:'Fixture',start:{dateTime:'2026-10-26T12:00:00Z'},end:{dateTime:'2026-10-26T13:00:00Z'}}));`;
 const f=filho(codigo);t.after(async()=>{if(f.p.exitCode===null&&!f.p.killed)await matar(f.p,f.fim)});await pronto(marcador);await matar(f.p,f.fim);
 let callbacks=0;const g=new GarantiasAgenda(d);
 await assert.rejects(()=>g.executar('primary','incerta',{},'token-ficticio',async()=>{callbacks++;return {}}),/sem conclusão/);assert.equal(callbacks,0);
 assert.equal((await g.status('primary')).operacoes[0].eventos[0].estado,'tentando');
});
test('morte real de turno Telegram processando não volta a pendente',async t=>{
 const d=await pasta(t),arquivo=path.join(d,'fila.json'),marcador=path.join(d,'pronto');
 const codigo=`import fs from 'node:fs/promises';import {FilaTelegramDuravel} from ${JSON.stringify(filaUrl)};const f=new FilaTelegramDuravel(${JSON.stringify(arquivo)});await f.receber({update_id:1,message:{text:'Fixture'}});await f.iniciar(1);await fs.writeFile(${JSON.stringify(marcador)},'fixture');setInterval(()=>{},1000);`;
 const f=filho(codigo);t.after(async()=>{if(f.p.exitCode===null&&!f.p.killed)await matar(f.p,f.fim)});await pronto(marcador);await matar(f.p,f.fim);
 const q=new FilaTelegramDuravel(arquivo);assert.deepEqual(await q.pendentes(),[]);assert.equal((await q.status()).entradas[0].estado,'ambiguo');assert.equal(await q.iniciar(1),null);
});
test('morte real entre journal de intenção e resultado não executa outro turno',async t=>{
 const d=await pasta(t),marcador=path.join(d,'pronto');
 const codigo=`import fs from 'node:fs/promises';import {DemandasAgendaDuraveis} from ${JSON.stringify(agendaUrl)};await new DemandasAgendaDuraveis(${JSON.stringify(d)}).executar('ui:fixture',{},async()=>{await fs.writeFile(${JSON.stringify(marcador)},'fixture');setInterval(()=>{},1000);return new Promise(()=>{})});`;
 const f=filho(codigo);t.after(async()=>{if(f.p.exitCode===null&&!f.p.killed)await matar(f.p,f.fim)});await pronto(marcador);await matar(f.p,f.fim);
 let chamadas=0;await assert.rejects(()=>new DemandasAgendaDuraveis(d).executar('ui:fixture',{},async()=>{chamadas++;return {}}),/sem conclusão/);assert.equal(chamadas,0);
});
