import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {conferirIdentidadeCaptura,reconciliacaoDeRelogioConfere,type ProvaIdentidadeCaptura} from './identidade-captura.ts'
import {hashCanonicoComercial as hash} from './registro-comercial-duravel.ts'
const sha=(s:string)=>createHash('sha256').update(s).digest('hex'),now=Date.parse('2026-11-04T22:00:00Z')
function fixture(){
 const config={v:1 as const,identidadePrumoHash:sha('account'),desde:'2026-11-01T00:00:00Z'}
 const msg={idOriginal:'same-id',direcao:'entrada' as const,ocorridoEm:'2026-11-04T20:09:17Z',conteudoHash:sha('same-content')}
 const original:ProvaIdentidadeCaptura={v:1,coletor:'evolution',garantia:'webhook-evolution',contaHash:config.identidadePrumoHash,sessaoHash:null,instancia:'prumo',capturadoEm:'2026-11-04T20:09:14.839Z',mensagem:{...msg,ocorridoEm:'2026-11-04T20:09:14Z'}}
 const late:ProvaIdentidadeCaptura={v:1,coletor:'hermes',garantia:'socket-hermes',contaHash:config.identidadePrumoHash,sessaoHash:sha('session'),instancia:null,capturadoEm:'2026-11-04T20:09:17.284Z',mensagem:msg}
 const cert:any={v:1,mensagem:msg,provasSha256:[hash(original),hash(late)].sort(),autorizadoEm:'2026-11-04T21:00:00Z',motivo:'Canonical late capture linked to earlier independent capture',autorizacao:'Explicit nominal correction by operator',reentregas:[{provaSha256:hash(late),origemSha256:hash(original)}],capturaCanonicaTardia:true}
 return {config,msg,original,late,cert}
}
function conferir(f:ReturnType<typeof fixture>,extra:ProvaIdentidadeCaptura[]=[]){
 f.cert.provasSha256=[hash(f.original),hash(f.late)].sort()
 return conferirIdentidadeCaptura(f.msg,{ativa:true,assinatura:'fixture',config:f.config,jsonl:[f.original,f.late,...extra].map(p=>JSON.stringify(p)).join('\n'),reconciliacoes:[f.cert]},now)
}
function atualizarLigacao(f:ReturnType<typeof fixture>){f.cert.reentregas=[{provaSha256:hash(f.late),origemSha256:hash(f.original)}]}
test('nominal late canonical capture retains both originals and verifies earlier anchor',()=>{const f=fixture(),before=JSON.stringify(f);assert.equal(conferir(f).estado,'verificada');assert.equal(JSON.stringify(f),before)})
test('late canonical mode requires explicit true and cannot be inferred by old certificates',()=>{for(const mode of ['absent','false','string']){const f=fixture();if(mode==='absent')delete f.cert.capturaCanonicaTardia;else f.cert.capturaCanonicaTardia=mode==='false'?false:'true';assert.equal(conferir(f).estado,'conflito')}})
test('earlier anchor must already be captured before the late occurrence',()=>{const f=fixture();f.original.capturadoEm=f.late.mensagem.ocorridoEm;atualizarLigacao(f);assert.equal(conferir(f).estado,'conflito')})
test('an anchor cannot precede its own alleged occurrence or late capture precede occurrence',()=>{for(const which of ['origin','late']){const f=fixture();if(which==='origin')f.original.capturadoEm='2026-11-04T20:09:13Z';else f.late.capturadoEm='2026-11-04T20:09:16Z';atualizarLigacao(f);assert.equal(conferir(f).estado,'conflito')}})
test('canonical tuple must exactly match the reviewed Hermes capture',()=>{const f=fixture();f.msg={...f.msg,ocorridoEm:'2026-11-04T20:09:18Z'};f.cert.mensagem=f.msg;assert.equal(conferir(f).estado,'conflito')})
test('account, content, direction and original ID divergences are never reconciled',()=>{for(const which of ['account','content','direction','id']){const f=fixture();if(which==='account')f.original.contaHash=sha('foreign');if(which==='content')f.original.mensagem={...f.original.mensagem,conteudoHash:sha('other')};if(which==='direction')f.original.mensagem={...f.original.mensagem,direcao:'saida'};if(which==='id')f.original.mensagem={...f.original.mensagem,idOriginal:'other'};atualizarLigacao(f);const resultado=conferir(f);if(which==='id'||which==='direction'){assert.equal(reconciliacaoDeRelogioConfere(f.msg,{ativa:true,assinatura:'fixture',config:f.config,jsonl:[f.original,f.late].map(v=>JSON.stringify(v)).join('\n'),reconciliacoes:[f.cert]},now),false);assert.equal(resultado.estado,'verificada')}else assert.equal(resultado.estado,'conflito')}})
test('new sessions invalidate exact proof set; foreign collectors cannot be the anchor',()=>{const f=fixture();assert.equal(conferir(f,[{...f.late,sessaoHash:sha('new')}]).estado,'conflito');const g=fixture();g.original={...g.original,coletor:'hermes',garantia:'socket-hermes',sessaoHash:sha('other'),instancia:null};atualizarLigacao(g);assert.equal(conferir(g).estado,'conflito')})
test('missing, duplicate, unused and reversed links fail closed',()=>{for(const which of ['missing','duplicate','unused','reversed']){const f=fixture();if(which==='missing')f.cert.reentregas=[];if(which==='duplicate')f.cert.reentregas.push({...f.cert.reentregas[0]});if(which==='unused')f.cert.reentregas.push({provaSha256:sha('unused'),origemSha256:hash(f.original)});if(which==='reversed')f.cert.reentregas=[{provaSha256:hash(f.original),origemSha256:hash(f.late)}];assert.equal(conferir(f).estado,'conflito')}})
test('future review and any unreviewed message stay blocked',()=>{const f=fixture();f.cert.autorizadoEm='2026-11-05T00:00:00Z';assert.equal(conferir(f).estado,'conflito');const g=fixture();g.msg={...g.msg,idOriginal:'unreviewed'};assert.notEqual(conferir(g).estado,'verificada')})
