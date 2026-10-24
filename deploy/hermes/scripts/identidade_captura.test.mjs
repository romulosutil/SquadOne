import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import vm from 'node:vm'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {registrarProvaHermes,jidCanonico} from './identidade_captura.mjs'
const hash=s=>createHash('sha256').update(s).digest('hex')
const now=Date.parse('2026-10-24T13:30:00.000Z'),owner='5511999990001@s.whatsapp.net',chave='1199990002'
function caso(fn){const home=fs.mkdtempSync(path.join(os.tmpdir(),'identidade-hermes-'));try{
 const pasta=path.join(home,'.local/share/whatsapp-identidades');fs.mkdirSync(pasta,{recursive:true,mode:0o700})
 fs.writeFileSync(path.join(pasta,'config.json'),JSON.stringify({v:1,identidadePrumoHash:hash(owner),desde:'2026-10-24T13:00:00Z'}))
 const socket={user:{id:owner}},args={home,socket,socketAtual:()=>socket,identidadeMe:owner,identidadePublica:Buffer.alloc(32,3),chave,destinatario:'5511999990002',ts:Math.floor(now/1000)-1,texto:' conteudo privado \n',id:'ORIGINAL_FIXTURE_01',direcao:'entrada',agora:now}
 return fn({home,pasta,args,arquivo:path.join(pasta,chave+'.jsonl')})
}finally{fs.rmSync(home,{recursive:true,force:true})}}
test('normaliza JID do socket sem confundir LID ou destinatário',()=>{assert.equal(jidCanonico('5511999990001:17@s.whatsapp.net'),owner);for(const v of ['123@lid','@s.whatsapp.net','http://5511999990001','5511999990001'])assert.equal(jidCanonico(v),null)})
test('prova persistida semtexto nem identidade legível; raw intacto e repetição idempotente',()=>caso(({home,pasta,args,arquivo})=>{
 const raw=path.join(home,'historico.jsonl');fs.writeFileSync(raw,'histórico intocável\n');const antes=fs.readFileSync(raw)
 assert.equal(registrarProvaHermes(args).estado,'gravada');const linhas=fs.readFileSync(arquivo,'utf8').trim().split('\n');assert.equal(linhas.length,1)
 const p=JSON.parse(linhas[0]);assert.equal(p.contaHash,hash(owner));assert.equal(p.sessaoHash,hash(Buffer.alloc(32,3)));assert.equal(p.mensagem.conteudoHash,hash('conteudo privado'))
 assert.equal(p.mensagem.ocorridoEm,'2026-10-24T13:29:59Z');assert.equal(p.garantia,'socket-hermes')
 assert(!linhas[0].includes('conteudo privado'));assert(!linhas[0].includes(owner));assert.deepEqual(fs.readFileSync(raw),antes)
 assert.equal(registrarProvaHermes({...args,agora:now+2000}).estado,'repetida');assert.equal(fs.readFileSync(arquivo,'utf8').trim().split('\n').length,1)
 if(process.platform!=='win32')assert.equal(fs.statSync(arquivo).mode&0o777,0o600)
}))
test('socket antigo, conta divergente do estado auth e chave pública ausente não provam',()=>caso(({args,arquivo})=>{
 for(const extra of [{socketAtual:()=>({user:{id:owner}})},{identidadeMe:'5521999990001@s.whatsapp.net'},{identidadePublica:null}])assert.equal(registrarProvaHermes({...args,...extra}).estado,'sem_identidade')
 assert(!fs.existsSync(arquivo))
}))
test('outra conta e nova sessão mantêm observações próprias sem atribuir Prumo',()=>caso(({args,arquivo})=>{
 registrarProvaHermes(args)
 const outra='5521999990001@s.whatsapp.net',socket={user:{id:outra}}
 assert.equal(registrarProvaHermes({...args,socket,socketAtual:()=>socket,identidadeMe:outra}).estado,'fora_da_ancora')
 registrarProvaHermes({...args,identidadePublica:Buffer.alloc(32,4)})
 const ps=fs.readFileSync(arquivo,'utf8').trim().split('\n').map(JSON.parse);assert.equal(ps.length,3);assert.equal(new Set(ps.map(p=>p.contaHash)).size,2)
}))
test('sem config não interfere; config inválida bloqueia só prova',()=>caso(({args,pasta,arquivo})=>{
 const cfg=path.join(pasta,'config.json');fs.unlinkSync(cfg);assert.equal(registrarProvaHermes(args).estado,'desligado')
 fs.writeFileSync(cfg,'{}');assert.equal(registrarProvaHermes(args).estado,'config_invalida');assert(!fs.existsSync(arquivo))
}))
test('hash preserva Unicode e recorte real recebido do capturador',()=>caso(({args,arquivo})=>{
 const texto='\u0085'+ '😀'.repeat(2100)+'\u0085';registrarProvaHermes({...args,texto})
 assert.equal(JSON.parse(fs.readFileSync(arquivo,'utf8')).mensagem.conteudoHash,hash('😀'.repeat(2000)))
}))
test('não inventa ID, direção ou horário quando metadados faltam',()=>caso(({args,arquivo})=>{
 for(const extra of [{id:''},{direcao:'lido'},{ts:0},{ts:now/1000+1},{ts:1.1},{chave:'../arquivo'}])assert.equal(registrarProvaHermes({...args,...extra}).estado,'metadados_invalidos')
 assert(!fs.existsSync(arquivo))
}))
test('erro de disco não vira prova e preserva diagnóstico sem conteúdo',()=>caso(({args,pasta})=>{
 const orig=fs.writeSync;let falhou=false;fs.writeSync=(...a)=>{if(!falhou){falhou=true;throw Error('dado privado fixture')}return orig(...a)}
 try{assert.equal(registrarProvaHermes(args).estado,'falha_gravacao')}finally{fs.writeSync=orig}
 const status=fs.readFileSync(path.join(pasta,'status-hermes.json'),'utf8');assert(!status.includes('dado privado'));assert(JSON.parse(status).contagens.falha_gravacao)
}))

test('PN estrangeiro não ganha prova mesmo quando BR10 legado colide',()=>caso(({args,arquivo})=>{
 assert.equal(registrarProvaHermes({...args,destinatario:'12025550123',chave:'1225550123'}).estado,'metadados_invalidos')
 assert.equal(registrarProvaHermes({...args,destinatario:'5511999990003'}).estado,'metadados_invalidos');assert(!fs.existsSync(arquivo))
}))
test('nova vigência não reutiliza prova antiga como se fosse contemporânea',()=>caso(({args,pasta,arquivo})=>{
 registrarProvaHermes(args);const cfg=path.join(pasta,'config.json');fs.writeFileSync(cfg,JSON.stringify({v:1,identidadePrumoHash:hash(owner),desde:new Date(now+500).toISOString()}))
 assert.equal(registrarProvaHermes({...args,agora:now+1000}).estado,'gravada');assert.equal(fs.readFileSync(arquivo,'utf8').trim().split('\n').length,2)
}))

const scriptPython=fileURLToPath(new URL('./patch_bridge_envios.py',import.meta.url))
const blocos=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',['-c',"import importlib.util,json,sys;s=importlib.util.spec_from_file_location('p',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps({'entrada':m.RESPOSTAS,'saida':m.ENVIOS}))",scriptPython],{encoding:'utf8'}))
for(const [direcao,limite] of [['entrada',1000],['saida',2000]])test('bloco real '+direcao+' preserva emoji na borda e produz prova antes de arquivar',()=>caso(({home,args,pasta,arquivo})=>{
 const statePath=path.join(home,'.local/state/whatsapp-observador');fs.mkdirSync(statePath,{recursive:true});fs.writeFileSync(path.join(statePath,'leads.json'),JSON.stringify([chave]))
 const texto='x'.repeat(limite-1)+'😀'+'fim',msg={key:{id:'BLOCO_REAL_FIXTURE',remoteJid:'5511999990002@s.whatsapp.net',fromMe:direcao==='saida'},messageTimestamp:args.ts,message:{conversation:texto}}
 let provaAntesRaw=false
 vm.runInNewContext(blocos[direcao],{process:{env:{HOME:home},getBuiltinModule:()=>fs},path,chatId:msg.key.remoteJid,senderAltId:'',SESSION_DIR:path.join(home,'session'),getMessageContent:m=>m.message,msg,recentlySentIds:new Set(),writeJsonLine:()=>{},jidNormalizedUser:s=>s,squadoneSocketDaCaptura:args.socket,state:{creds:{me:{id:owner},signedIdentityKey:{public:args.identidadePublica}}},squadoneHistory:()=>({registrarIdentidade:p=>{const r=registrarProvaHermes({...p,home,socketAtual:()=>args.socket,agora:now});provaAntesRaw=fs.existsSync(arquivo);return r}})})
 const row=JSON.parse(fs.readFileSync(path.join(statePath,direcao==='entrada'?'respostas.jsonl':'enviadas.jsonl'),'utf8'))
 assert.equal(Array.from(row.texto).length,limite);assert(row.texto.endsWith('😀'));assert(provaAntesRaw)
 const prova=JSON.parse(fs.readFileSync(arquivo,'utf8'));assert.equal(prova.mensagem.conteudoHash,hash(row.texto.trim()));assert.equal(prova.mensagem.idOriginal,row.id)
}))

test('PN alternativo contraditório não escolhe identidade de conversa silenciosamente',()=>caso(({args,arquivo})=>{
 assert.equal(registrarProvaHermes({...args,destinatarioAlternativo:'5521999990002@s.whatsapp.net'}).estado,'metadados_invalidos');assert(!fs.existsSync(arquivo))
}))
