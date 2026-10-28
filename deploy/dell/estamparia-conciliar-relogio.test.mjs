import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createHash} from 'node:crypto'
import {planejarCorrecaoDeSegundo} from './estamparia-conciliar-relogio.mjs'
const sha=s=>createHash('sha256').update(s).digest('hex')
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canon(x)])):v
function exemplo(){const m={id:'original',direcao:'entrada',em:'2026-10-20T16:28:36Z',texto:'Mensagem original'},e={idOriginal:m.id,direcao:m.direcao,ocorridoEm:m.em,conteudoHash:sha(m.texto),recebidoEm:m.em},config={identidadePrumoHash:sha('conta'),desde:'2026-10-24T00:00:00Z'},provas=[{contaHash:config.identidadePrumoHash,capturadoEm:'2026-10-26T00:00:00Z',mensagem:{idOriginal:m.id,direcao:m.direcao,ocorridoEm:'2026-10-20T16:28:35Z',conteudoHash:e.conteudoHash}}],{recebidoEm,...original}=e;return {m,r:{chave:sha('chave'),hash:sha(JSON.stringify(canon(original))),evento:e,estado:'concluido'},config,provas}}
test('corrige somente um segundo com mesma conta, ID, texto e direção; preserva a chave',()=>{const f=exemplo(),p=planejarCorrecaoDeSegundo(f.r,f.m,f.provas,f.config);assert.equal(p.registro.chave,f.r.chave);assert.equal(p.registro.estado,'pendente');assert.equal(p.mensagem.em,f.provas[0].mensagem.ocorridoEm);assert.equal(p.mensagem.texto,f.m.texto)})
test('outra conta, texto diferente e horários divergentes não são conciliados',()=>{for(const mudar of [f=>f.provas[0].contaHash=sha('outra'),f=>f.provas[0].mensagem.conteudoHash=sha('outro'),f=>f.provas[0].mensagem.ocorridoEm='2026-10-20T16:28:30Z',f=>f.r.estado='processando']){const f=exemplo();mudar(f);assert.throws(()=>planejarCorrecaoDeSegundo(f.r,f.m,f.provas,f.config))}})
