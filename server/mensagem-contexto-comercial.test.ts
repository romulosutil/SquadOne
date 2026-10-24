import assert from 'node:assert/strict'
import {test} from 'node:test'
import express from 'express'
import type {AddressInfo} from 'node:net'
import type {CrmLead,CrmVisao} from '../src/operations/types.ts'
import type {SugestaoNaFicha} from './copiloto.ts'
import {hashDoContexto} from '../src/operations/revisao-resposta.ts'
import {montarMensagemDaDecisao} from './mensagem-da-decisao.ts'
const EM='2026-10-24T14:00:00.000Z'
const lead=():CrmLead=>({id:'site:race',chave:'race',produto:'site',empresa:'Empresa fixture',nicho:'Serviços',cidade:'Vitória',etapa:'contato',sinal:'em-conversa',subEtapa:'Respondeu',marcos:{},eventos:[],notas:0,links:{whatsapp:'https://wa.me/5511999991234'},conversa:{desde:EM,mensagens:1,ultimaEntrada:EM,ultima:{direcao:'entrada',em:EM,trecho:'Como funciona?'}},resposta:{tipo:'neutra',trecho:'Como funciona?',em:EM}} as CrmLead)
const att:NonNullable<CrmLead['atendimentoComercial']>={id:'tarefa-1',tipo:'handoff',titulo:'Conferir o contexto',motivo:'Prova mudou',alvo:'operador',estado:'concluido',contextoHash:'a'.repeat(64),identidade:'confirmada',ocorridoEm:EM}
const sugestao={quando:EM,sugestao:{mensagem:'MENSAGEM-ANTIGA-NAO-RETORNAR',porque:'Fixture',ofertas:[],proposta:{itens:[]},faltaSaber:[]}} as unknown as SugestaoNaFicha
async function servidor(mudarNoCache:boolean,cachePresente=false){
 const original=lead();let atual=original,leiturasCache=0,geracoes=0
 const visao=()=>({estado:'ok',leads:[atual],hoje:[{id:'resposta',titulo:'Responder',explicacao:'',itens:[{leadId:original.id,acao:'Responder',detalhe:'',ordem:0,links:[]}]}]} as CrmVisao)
 const app=express();app.use(express.json());montarMensagemDaDecisao(app,{crm:{visao:async()=>visao()},copiloto:{ler:async()=>{leiturasCache++;if(mudarNoCache)atual={...original,atendimentoComercial:att};return cachePresente?sugestao:null},sugerir:async()=>{geracoes++;atual={...original,atendimentoComercial:att};return sugestao}}})
 const srv=app.listen(0,'127.0.0.1');await new Promise<void>(r=>srv.once('listening',r));return {pedir:async()=>fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/crm/decisao/mensagem`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({produto:original.produto,id:original.id,contextoHash:await hashDoContexto(original)})}),chamadas:()=>({leiturasCache,geracoes}),fechar:()=>new Promise<void>(r=>srv.close(()=>r()))}
}
test('hash inclui tarefa, identidade, horário original e prova, sem alterar a fonte',async()=>{
 const l=lead(),antes=JSON.stringify(l),base=await hashDoContexto(l),com=await hashDoContexto({...l,atendimentoComercial:att});assert.notEqual(base,com)
 for(const delta of [{id:'tarefa-2'},{identidade:'sem-prova' as const},{contextoHash:'b'.repeat(64)},{ocorridoEm:'2026-10-24T13:59:00.000Z'},{estado:'ambiguo'}])assert.notEqual(com,await hashDoContexto({...l,atendimentoComercial:{...att,...delta}}))
 assert.equal(com,await hashDoContexto({...l,atendimentoComercial:{...att}}));assert.equal(JSON.stringify(l),antes)
})
test('tarefa/prova surgida durante leitura do cache impede gerar novo modelo ou reutilizar mensagem',async()=>{
 for(const cachePresente of [false,true]){const api=await servidor(true,cachePresente);try{const r=await api.pedir(),p=await r.json();assert.equal(r.status,409);assert.equal(p.mensagem,undefined);assert.ok(!JSON.stringify(p).includes('MENSAGEM-ANTIGA'));assert.deepEqual(api.chamadas(),{leiturasCache:1,geracoes:0})}finally{await api.fechar()}}
})
test('tarefa/prova alterada durante geração invalida resposta e link antes de retornar ao usuário',async()=>{
 const api=await servidor(false);try{const r=await api.pedir(),p=await r.json();assert.equal(r.status,409);assert.equal(p.mensagem,undefined);assert.equal(p.podeAbrir,undefined);assert.ok(!JSON.stringify(p).includes('MENSAGEM-ANTIGA'));assert.deepEqual(api.chamadas(),{leiturasCache:1,geracoes:1})}finally{await api.fechar()}
})
