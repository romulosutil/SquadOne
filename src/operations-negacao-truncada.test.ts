import test from 'node:test'
import assert from 'node:assert/strict'
import {classificarResposta,respostaParaAcompanhamento} from './operations/classificacao-resposta.ts'
const saida='2026-11-05T11:00:00Z',entrada='2026-11-05T11:02:00Z'
function conferir(texto:string){
 const fonte={tipo:'interesse' as const,trecho:texto,em:entrada}
 const l={marcos:{enviado:saida,respondeu:entrada},resposta:fonte}
 const ms=[{direcao:'saida' as const,em:saida,texto:'Sou o responsável pelo serviço de sites.'},{direcao:'entrada' as const,em:entrada,texto,papel:'gente'}]
 return {l,ms,c:classificarResposta(l,ms,Date.parse('2026-11-06T22:00:00Z'))}
}
for(const t of ["Obrigado pelo contato, mas 'ao tenho interesse", "Agradeço, mais ’ao temos interesse."]){
 test('negação truncada não vira interesse: '+t,()=>{const {l,c}=conferir(t);const before=JSON.stringify(l);assert.equal(c.classe,'recusa');assert.equal(c.revisar,true);assert.equal(c.materialSolicitado,false);assert.equal(respostaParaAcompanhamento(l.resposta,c)?.tipo,'negativa');assert.equal(JSON.stringify(l),before)})
}
for(const t of ['Tenho interesse, como funciona?','Obrigado pelo contato, mas tenho interesse no mensal.',"A palavra 'ao' saiu errada. Tenho interesse no site."]){
 test('interesse sem negação preservado: '+t,()=>assert.equal(conferir(t).c.classe,'interesse'))
}
test('nova resposta humana afirmativa não fica presa à revisão nominal',()=>{const {l,ms}=conferir("Obrigado, mas 'ao tenho interesse");const c=classificarResposta(l,[...ms,{direcao:'entrada',em:'2026-11-05T12:00:00Z',texto:'Reconsiderei. Quero contratar o site.',papel:'gente'}],Date.parse('2026-11-06T22:00:00Z'));assert.equal(c.classe,'interesse')})
test('recusa explícita e exclusão mantêm restrição',()=>{assert.equal(conferir('Não tenho interesse.').c.classe,'recusa');assert.equal(conferir('Remova meu número.').c.classe,'exclusao')})
