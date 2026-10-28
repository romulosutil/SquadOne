import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createSquadoneHistory } from './squadone_history.mjs'
const sha=s=>createHash('sha256').update(s).digest('hex'),agora=Date.parse('2026-10-26T22:00:00.000Z')
const chave='2799991234',pn='5527999991234',dono='5527999990000@s.whatsapp.net',segredo='segredo-ficticio-para-ensaio-0001'
async function fixture(t) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'historico-identidade-'))
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
  for(const p of ['.local/state/whatsapp-observador','.local/share/squadone-operations','.local/share/whatsapp-identidades','.config/claude-ops','sessao'])fs.mkdirSync(path.join(home,p),{recursive:true})
  fs.writeFileSync(path.join(home,'.local/state/whatsapp-observador/leads.json'),JSON.stringify([chave]))
  fs.writeFileSync(path.join(home,'.config/claude-ops/whatsapp-observador-segredo'),segredo)
  fs.writeFileSync(path.join(home,'.local/share/squadone-operations/historico-ancoras.json'),'{}')
  fs.writeFileSync(path.join(home,'.local/share/whatsapp-identidades/config.json'),JSON.stringify({v:1,identidadePrumoHash:sha(dono),desde:'2026-10-24T13:00:00Z'}))
  const pedidos=[]
  let socket={user:{id:dono},fetchMessageHistory:async(...args)=>{pedidos.push(args)}},arquivadas=0
  const h=createSquadoneHistory({home,session:path.join(home,'sessao'),getSocket:()=>socket,getContent:m=>m.message,agora:()=>agora,
    arquivar:lote=>{arquivadas+=lote.length;return {status:0,stdout:JSON.stringify({gravadas:0})}}})
  const consultar=async(body={})=>{const r={codigo:200,dado:null,status(n){this.codigo=n;return this},json(v){this.dado=v;return this}};await h.consultar({headers:{'x-observador':segredo},body:{chave,numero:pn,...body}},r);return r}
  const captura=()=>({socket,identidadeMe:dono,identidadePublica:new Uint8Array(32).fill(1)})
  const mensagem=(extras={})=>({key:{id:'ID-REAL-FICTICIO-123',remoteJid:pn+'@s.whatsapp.net',fromMe:false},messageTimestamp:Math.floor((agora-5*86400_000)/1000),message:{conversation:'Pode falar por aqui sim!'},...extras})
  const provas=()=>{try{return fs.readFileSync(path.join(home,'.local/share/whatsapp-identidades',chave+'.jsonl'),'utf8').trim().split('\n').map(JSON.parse)}catch(e){if(e.code==='ENOENT')return [];throw e}}
  return {home,h,consultar,captura,mensagem,provas,pedidos,trocar:()=>socket={user:{id:dono},fetchMessageHistory:async()=>{}},get arquivadas(){return arquivadas}}
}
test('retorno solicitado na sessão real registra prova atual da mensagem antiga, sem reenviar ou inventar ID',async t=>{
  const f=await fixture(t);assert.equal((await f.consultar()).codigo,202)
  f.h.receber({messages:[f.mensagem()]},f.captura())
  const [p]=f.provas();assert.equal(p.contaHash,sha(dono));assert.equal(p.mensagem.idOriginal,'ID-REAL-FICTICIO-123')
  assert.equal(Date.parse(p.mensagem.ocorridoEm),agora-5*86400_000);assert.equal(p.capturadoEm,new Date(agora).toISOString())
  assert.equal(p.mensagem.conteudoHash,sha('Pode falar por aqui sim!'));assert.equal(f.arquivadas,1)
  const estado=(await f.consultar({somenteConsultar:true})).dado
  assert.equal(estado.comprovadas,1);assert.doesNotMatch(JSON.stringify(estado),/identidadeMe|identidadePublica|socket|segredo-ficticio/)
})
test('repetir consulta e retorno mantém uma só prova da mesma mensagem',async t=>{
  const f=await fixture(t);await f.consultar();f.h.receber({messages:[f.mensagem()]},f.captura());f.h.receber({messages:[f.mensagem()]},f.captura())
  assert.equal(f.provas().length,1)
})
test('histórico sem solicitação e callback de socket antigo não comprovam nem arquivam mensagens',async t=>{
  const f=await fixture(t);f.h.receber({messages:[f.mensagem()]},f.captura());assert.equal(f.arquivadas,0)
  await f.consultar();const captura=f.captura();f.trocar();f.h.receber({messages:[f.mensagem()]},captura)
  assert.equal(f.arquivadas,0);assert.equal(f.provas().length,0)
})
test('outra conta, ausência de identidade e grupo nunca comprovam a âncora configurada',async t=>{
  const f=await fixture(t);await f.consultar()
  const semIdentidade={...f.captura(),identidadeMe:undefined}
  f.h.receber({messages:[f.mensagem()]},semIdentidade);assert.equal(f.provas().length,0)
  f.h.receber({messages:[f.mensagem({key:{id:'outro',remoteJid:'12345@g.us',remoteJidAlt:pn+'@s.whatsapp.net',fromMe:false}})]},f.captura())
  assert.equal(f.provas().length,0)
})
test('LID só é comprovado com o telefone explícito ou mapa da própria sessão',async t=>{
  const f=await fixture(t);await f.consultar()
  const m=f.mensagem({key:{id:'LID-MENSAGEM-123',remoteJid:'123456789@lid',fromMe:false}})
  f.h.receber({messages:[m]},f.captura());assert.equal(f.provas().length,0)
  fs.writeFileSync(path.join(f.home,'sessao/lid-mapping-123456789_reverse.json'),JSON.stringify(pn))
  f.h.receber({messages:[m]},f.captura());assert.equal(f.provas().length,1)
})
test('retorno sem metadados originais não ganha prova a partir do histórico importado',async t=>{
  const f=await fixture(t);await f.consultar()
  for(const m of [f.mensagem({key:{remoteJid:pn+'@s.whatsapp.net',fromMe:false}}),f.mensagem({messageTimestamp:NaN}),f.mensagem({key:{id:'sem-direcao',remoteJid:pn+'@s.whatsapp.net'}})])f.h.receber({messages:[m]},f.captura())
  assert.equal(f.provas().length,0);assert.equal(f.arquivadas,0)
})
test('captura de outra conta conserva o conflito de identidade, sem atribuir a âncora da Prumo',async t=>{
  const f=await fixture(t);await f.consultar();const c=f.captura()
  c.socket.user.id='5527999991111@s.whatsapp.net';c.identidadeMe=c.socket.user.id
  f.h.receber({messages:[f.mensagem()]},c)
  const [p]=f.provas();assert.notEqual(p.contaHash,sha(dono));assert.equal(p.contaHash,sha(c.identidadeMe))
})
test('janela recente usa o LID conferido do chat, sem reaproveitar ID antigo como limite da consulta',async t=>{
  const f=await fixture(t)
  fs.writeFileSync(path.join(f.home,'sessao/lid-mapping-123456789_reverse.json'),JSON.stringify(pn))
  fs.writeFileSync(path.join(f.home,'.local/share/squadone-operations/historico-ancoras.json'),JSON.stringify({[chave]:[{jid:'123456789@lid',id:'ANCORA-REAL',fromMe:true,ts:1000000000}]}))
  assert.equal((await f.consultar()).codigo,202)
  assert.equal(f.pedidos[0][1].remoteJid,'123456789@lid');assert.equal(f.pedidos[0][1].id,undefined)
  assert.equal(f.pedidos[0][2],agora)
})
test('um LID de outra conversa não é utilizado nem mesmo na janela recente',async t=>{
  const f=await fixture(t)
  fs.writeFileSync(path.join(f.home,'sessao/lid-mapping-123456789_reverse.json'),JSON.stringify('5527999991111'))
  fs.writeFileSync(path.join(f.home,'.local/share/squadone-operations/historico-ancoras.json'),JSON.stringify({[chave]:[{jid:'123456789@lid',id:'ANCORA-REAL',fromMe:true,ts:1000000000}]}))
  assert.equal((await f.consultar()).codigo,409);assert.equal(f.pedidos.length,0)
})
test('releitura individual usa somente IDs reais das âncoras da conversa autorizada e não os repete',async t=>{
  const f=await fixture(t),captura=f.captura(),pedidos=[]
  captura.socket.requestPlaceholderResend=async(...args)=>pedidos.push(args)
  fs.writeFileSync(path.join(f.home,'.local/share/squadone-operations/historico-ancoras.json'),JSON.stringify({[chave]:[
    {jid:pn+'@s.whatsapp.net',id:'ID-ORIGINAL-123',fromMe:false,ts:1000000000},
    {jid:'5527999991111@s.whatsapp.net',id:'OUTRA-CONVERSA',fromMe:false,ts:1000000000}]}))
  const r=await f.consultar({conferirOriginais:true,ids:['ID-INVENTADO']});assert.equal(r.codigo,200)
  assert.equal(pedidos.length,1);assert.equal(pedidos[0][0].id,'ID-ORIGINAL-123')
  await f.consultar({conferirOriginais:true});assert.equal(pedidos.length,1);assert.equal(f.provas().length,0)
})
