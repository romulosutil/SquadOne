import test from 'node:test';
import assert from 'node:assert/strict';
import {IdentidadeDoPedido} from './agentes/identidade-pedido.ts';
const intencao={demanda:'Fixture',modo:'auto',squadId:'fixture'};
const storage=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)},removeItem:(k:string)=>{m.delete(k)}}};
const uuid=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('retry técnico e reload conservam a identidade da mesma intenção',()=>{
 const s=storage(),p=new IdentidadeDoPedido(s,()=>uuid(1)),id=p.preparar(intencao);
 assert.equal(p.preparar(intencao),id);assert.equal(new IdentidadeDoPedido(s,()=>uuid(2)).preparar(intencao),id);
});
test('somente concluir após resultado e atualização termina intenção; outra usa novo ID',()=>{
 const s=storage();let n=0;const p=new IdentidadeDoPedido(s,()=>uuid(++n)),id=p.preparar(intencao);
 // Falha de transporte ou leitura posterior não chama concluir.
 assert.equal(p.preparar(intencao),id);p.concluir(id);assert.notEqual(p.preparar(intencao),id);
});
test('payload diferente troca identidade e conclusão atrasada não apaga a nova',()=>{
 const s=storage();let n=0;const p=new IdentidadeDoPedido(s,()=>uuid(++n)),a=p.preparar(intencao),b=p.preparar({...intencao,modo:'foco'});
 assert.notEqual(a,b);p.concluir(a);assert.equal(new IdentidadeDoPedido(s,()=>uuid(99)).preparar({...intencao,modo:'foco'}),b);
});
test('storage inválido ou indisponível não reutiliza ID arbitrário nem perde retry em memória',()=>{
 const s=storage();s.setItem('squadone-delegacao-pendente',JSON.stringify({assinatura:JSON.stringify(intencao),requestId:'ui:'+ '-'.repeat(36)}));
 const p=new IdentidadeDoPedido(s,()=>uuid(1));assert.equal(p.preparar(intencao),'ui:'+uuid(1));
 const ruim={getItem:()=>{throw new Error('fixture')},setItem:()=>{throw new Error('fixture')},removeItem:()=>{throw new Error('fixture')}};
 const q=new IdentidadeDoPedido(ruim,()=>uuid(2));const id=q.preparar(intencao);assert.equal(q.preparar(intencao),id);q.concluir(id);
});
